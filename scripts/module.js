/**
 * Cypher Name Generator v1.3.3
 * Foundry VTT v13–v15 | Cypher System
 *
 * Extensible subsystem release:
 *  - Provider registry for pluggable generators
 *  - Formal public API on game[MODULE_ID]
 *  - Hook lifecycle for third-party integration
 *  - Default journal provider preserved for backward compatibility
 *  - UI now generates through subsystem API instead of internal-only logic
 */

const MODULE_ID = "cypher-name-generator";
const HOOKS = {
  READY: `${MODULE_ID}.apiReady`,
  OPENED: `${MODULE_ID}.opened`,
  CLOSED: `${MODULE_ID}.closed`,
  GENERATED: `${MODULE_ID}.generated`,
  PROVIDER_REGISTERED: `${MODULE_ID}.providerRegistered`,
  PROVIDER_UNREGISTERED: `${MODULE_ID}.providerUnregistered`,
  ACTOR_CREATED: `${MODULE_ID}.actorCreated`,
  BEFORE_GENERATE: `${MODULE_ID}.beforeGenerate`
};

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
function getDialogV2() {
  return foundry?.applications?.api?.DialogV2 ?? null;
}

const DEFAULT_TABS = [
  {
    id: "names",
    name: "Names",
    color: "#c8a96e",
    icon: "fa-bookmark",
    providerId: "journal-lines",
    journals: []
  }
];

function normalizeTab(tab) {
  if (!tab.journals) tab.journals = [];
  for (const j of tab.journals) {
    if (j.enabled === undefined) j.enabled = true;
  }
  if (!tab.color) tab.color = "#c8a96e";
  if (!tab.icon) tab.icon = "fa-bookmark";
  if (!tab.providerId) tab.providerId = "journal-lines";
  return tab;
}
function normalizeTabs(tabs) {
  return (tabs || []).map(t => normalizeTab(t));
}

function registerSettings() {
  game.settings.register(MODULE_ID, "tabs", {
    name: "Generator Tabs",
    hint: "Tabs with configured provider and source connections.",
    scope: "world",
    config: false,
    type: Array,
    default: clone(DEFAULT_TABS)
  });
  game.settings.register(MODULE_ID, "lastTab", {
    name: "Last Active Tab",
    scope: "client",
    config: false,
    type: String,
    default: ""
  });
}
async function getTabs() {
  try {
    return normalizeTabs(game.settings.get(MODULE_ID, "tabs") || clone(DEFAULT_TABS));
  } catch {
    return clone(DEFAULT_TABS);
  }
}
async function saveTabs(tabs) {
  await game.settings.set(MODULE_ID, "tabs", normalizeTabs(tabs));
}
function getLastTab() {
  try { return game.settings.get(MODULE_ID, "lastTab") || ""; } catch { return ""; }
}

Hooks.once("init", () => {
  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("gt", (a, b) => a > b);
  Handlebars.registerHelper("add", (a, b) => Number(a) + Number(b));
  Handlebars.registerHelper("journalName", (id) => {
    const j = game.journal?.get(id);
    return j ? j.name : "(missing)";
  });
});

const TAB_ICONS = [
  { id: "fa-bookmark", label: "Bookmark", cat: "General" },
  { id: "fa-mars", label: "Male", cat: "Gender" },
  { id: "fa-venus", label: "Female", cat: "Gender" },
  { id: "fa-venus-mars", label: "Any Gender", cat: "Gender" },
  { id: "fa-user", label: "Human", cat: "Race" },
  { id: "fa-leaf", label: "Elf", cat: "Race" },
  { id: "fa-tree", label: "Wood Elf", cat: "Race" },
  { id: "fa-gem", label: "Dwarf", cat: "Race" },
  { id: "fa-hammer", label: "Dwarf (Hammer)", cat: "Race" },
  { id: "fa-seedling", label: "Halfling", cat: "Race" },
  { id: "fa-apple-alt", label: "Halfling (Alt)", cat: "Race" },
  { id: "fa-dragon", label: "Dragonborn", cat: "Race" },
  { id: "fa-fire", label: "Tiefling", cat: "Race" },
  { id: "fa-moon", label: "Drow", cat: "Race" },
  { id: "fa-skull", label: "Orc", cat: "Race" },
  { id: "fa-cog", label: "Gnome", cat: "Race" },
  { id: "fa-feather-alt", label: "Aasimar", cat: "Race" },
  { id: "fa-water", label: "Triton", cat: "Race" },
  { id: "fa-paw", label: "Beastfolk", cat: "Race" },
  { id: "fa-scroll", label: "Scroll", cat: "General" },
  { id: "fa-book", label: "Book", cat: "General" },
  { id: "fa-quill", label: "Quill", cat: "General" },
  { id: "fa-crown", label: "Noble", cat: "General" },
  { id: "fa-shield-alt", label: "Warrior", cat: "General" },
  { id: "fa-hat-wizard", label: "Wizard", cat: "General" },
  { id: "fa-dungeon", label: "Dungeon", cat: "General" },
  { id: "fa-dice-d20", label: "D20", cat: "General" }
];
const TAB_PRESET_COLORS = [
  "#c8a96e", "#d94040", "#4095d9", "#40d970", "#d9a040",
  "#9b59b6", "#e91e63", "#00bcd4", "#ff5722", "#607d8b",
  "#8bc34a", "#ff9800", "#795548", "#3f51b5", "#009688"
];

class CNGProviderRegistry {
  constructor() {
    this.providers = new Map();
  }

  register(provider) {
    if (!provider?.id) throw new Error(`${MODULE_ID} | Provider requires an id.`);
    if (typeof provider.generate !== "function") throw new Error(`${MODULE_ID} | Provider '${provider.id}' requires a generate function.`);
    const normalized = {
      id: provider.id,
      label: provider.label ?? provider.id,
      supportsJournals: provider.supportsJournals ?? true,
      getSources: provider.getSources ?? null,
      generate: provider.generate,
      createActorData: provider.createActorData ?? null,
      onRegister: provider.onRegister ?? null,
      onUnregister: provider.onUnregister ?? null,
      meta: provider.meta ?? {}
    };
    this.providers.set(normalized.id, normalized);
    if (typeof normalized.onRegister === "function") normalized.onRegister(game[MODULE_ID]);
    Hooks.callAll(HOOKS.PROVIDER_REGISTERED, normalized, game[MODULE_ID]);
    return normalized;
  }

  unregister(providerId) {
    const provider = this.providers.get(providerId);
    if (!provider) return false;
    if (typeof provider.onUnregister === "function") provider.onUnregister(game[MODULE_ID]);
    this.providers.delete(providerId);
    Hooks.callAll(HOOKS.PROVIDER_UNREGISTERED, providerId, game[MODULE_ID]);
    return true;
  }

  get(providerId) {
    return this.providers.get(providerId) || null;
  }

  list() {
    return Array.from(this.providers.values());
  }

  has(providerId) {
    return this.providers.has(providerId);
  }
}

const providerRegistry = new CNGProviderRegistry();

function getJournalLinesFromTab(tab) {
  const parts = [];
  for (const entry of (tab?.journals || [])) {
    if (entry.enabled === false) continue;
    const journal = game.journal?.get(entry.id);
    if (!journal) continue;
    const pages = journal.pages?.contents || [];
    if (!pages.length) continue;

    const allLines = [];
    for (const page of pages) {
      const html = page.text?.content || page.text?.markdown || "";
      if (!html) continue;
      const text = html
        .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, "\n")
        .replace(/<(br|hr)\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);
      allLines.push(...text);
    }
    if (!allLines.length) continue;
    parts.push(allLines[Math.floor(Math.random() * allLines.length)]);
  }
  return parts;
}

function registerBuiltInProviders() {
  providerRegistry.register({
    id: "journal-lines",
    label: "Journal Lines",
    supportsJournals: true,
    meta: {
      description: "Combines one random line from each enabled journal in order."
    },
    async generate({ tab }) {
      const parts = getJournalLinesFromTab(tab);
      if (!parts.length) return { text: "", parts: [], providerId: "journal-lines" };
      return {
        text: parts.join(" "),
        parts,
        providerId: "journal-lines",
        metadata: { journalCount: (tab?.journals || []).filter(j => j.enabled !== false).length }
      };
    },
    async createActorData({ result }) {
      return {
        name: result.text,
        type: "npc"
      };
    }
  });
}

async function resolveTab(tabId) {
  const tabs = await getTabs();
  const tab = tabId ? tabs.find(t => t.id === tabId) : tabs[0];
  return tab ? normalizeTab(tab) : null;
}

async function generateFromTab(tabId, options = {}) {
  const tab = await resolveTab(tabId);
  if (!tab) throw new Error(`${MODULE_ID} | No tab found for '${tabId ?? "default"}'.`);
  const providerId = options.providerId || tab.providerId || "journal-lines";
  const provider = providerRegistry.get(providerId);
  if (!provider) throw new Error(`${MODULE_ID} | Provider '${providerId}' is not registered.`);

  const payload = {
    tab,
    tabId: tab.id,
    provider,
    providerId,
    options,
    moduleId: MODULE_ID,
    context: options.context || {}
  };

  Hooks.callAll(HOOKS.BEFORE_GENERATE, payload);
  const result = await provider.generate(payload);
  const normalized = {
    text: result?.text ?? "",
    parts: result?.parts ?? [],
    providerId,
    tabId: tab.id,
    tabName: tab.name,
    metadata: result?.metadata ?? {}
  };
  Hooks.callAll(HOOKS.GENERATED, normalized, payload);
  return normalized;
}

async function createActorFromResult(result, options = {}) {
  if (!result?.text) throw new Error(`${MODULE_ID} | Cannot create actor from empty result.`);
  const provider = providerRegistry.get(options.providerId || result.providerId || "journal-lines");
  const actorData = provider?.createActorData
    ? await provider.createActorData({ result, options, provider })
    : { name: result.text, type: "npc" };

  let folder = game.folders.find(f => f.type === "Actor" && f.name === (options.folderName || "NEW ACTORS"));
  if (!folder) {
    folder = await Folder.create({
      name: options.folderName || "NEW ACTORS",
      type: "Actor",
      parent: null
    });
  }

  const actor = await Actor.create({ ...actorData, folder: folder.id });
  if (options.renderSheet !== false) actor.sheet?.render(true);
  Hooks.callAll(HOOKS.ACTOR_CREATED, actor, result, options);
  return actor;
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class NameGeneratorDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this._tabs = [];
    this._activeTabId = "";
    this._results = {};
    this._outsideClickHandler = null;
  }

  static DEFAULT_OPTIONS = {
    id: "cypher-name-generator-dialog",
    classes: ["cypher-name-generator", "cgm-dark-dialog"],
    tag: "div",
    position: { width: 520, height: "auto" },
    window: { title: "Name Generator", resizable: false }
  };

  static PARTS = {
    body: {
      template: "modules/cypher-name-generator/templates/name-generator.hbs",
      scrollable: [".cng-tab-content"]
    }
  };

  async _prepareContext() {
    this._tabs = await getTabs();
    if (!this._activeTabId && this._tabs.length > 0) {
      const saved = getLastTab();
      this._activeTabId = saved && this._tabs.find(t => t.id === saved) ? saved : this._tabs[0].id;
    }

    const activeTab = this._tabs.find(t => t.id === this._activeTabId) || this._tabs[0];
    const usedIds = new Set(activeTab?.journals?.map(j => j.id) || []);
    const available = (game.journal?.contents || []).filter(j => !usedIds.has(j.id));
    const provider = providerRegistry.get(activeTab?.providerId || "journal-lines");

    return {
      tabs: this._tabs,
      activeTab,
      activeTabId: this._activeTabId,
      availableJournals: available.map(j => ({ id: j.id, name: j.name })),
      result: this._results[this._activeTabId] || "",
      providerLabel: provider?.label || activeTab?.providerId || "Unknown Provider"
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._bindListeners(this.element);
    Hooks.callAll(HOOKS.OPENED, this, { context, options });
  }

  _onClose(options) {
    super._onClose(options);
    if (this._outsideClickHandler) {
      document.removeEventListener("click", this._outsideClickHandler);
      this._outsideClickHandler = null;
    }
    Hooks.callAll(HOOKS.CLOSED, this, options);
    if (_dialogInstance === this) _dialogInstance = null;
  }

  _bindListeners(element) {
    element.querySelectorAll(".cng-tab-btn[data-tab-id]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._switchTab(btn.dataset.tabId);
      });
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._activeTabId = btn.dataset.tabId;
        this._customizeTab();
      });
    });

    element.querySelectorAll(".cng-container [data-action]").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        switch (el.dataset.action) {
          case "addTab": this._addTab(); break;
          case "renameTab": this._customizeTab(); break;
          case "deleteTab": this._deleteTab(); break;
          case "addJournal": this._addJournal(element); break;
          case "generate": this._generate(); break;
          case "copyResult": this._copyResult(); break;
          case "createNPC": this._createNPC(); break;
        }
      });
    });

    element.querySelectorAll(".cng-journal-remove").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._removeJournal(parseInt(btn.dataset.index, 10));
      });
    });

    element.querySelectorAll(".cng-journal-eye").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this._toggleJournal(parseInt(btn.dataset.index, 10));
      });
    });

    const searchInput = element.querySelector(".cng-journal-search");
    const dropdown = element.querySelector(".cng-journal-dropdown");
    const hiddenInput = element.querySelector(".cng-journal-selected-id");
    if (searchInput && dropdown && hiddenInput) {
      this._bindJournalSearch(searchInput, dropdown, hiddenInput);
    }
  }

  async _switchTab(tabId) {
    this._activeTabId = tabId;
    try { await game.settings.set(MODULE_ID, "lastTab", tabId); } catch {}
    this.render(false);
  }

  async _addTab() {
    const DV2 = getDialogV2();
    let name;
    if (DV2) {
      name = await DV2.prompt({
        window: { title: "New Tab" },
        content: `<div style="padding:8px 0"><label style="display:block;margin-bottom:6px;color:var(--color-text-secondary)">Tab name:</label><input type="text" name="name" value="New Tab" style="width:100%;padding:6px 10px;background:rgba(255,255,255,0.06);border:1px solid rgba(200,169,110,0.3);border-radius:6px;color:inherit;font:inherit"></div>`,
        ok: { label: "Create", callback: (_event, button) => button.form.elements.name.value }
      }).catch(() => null);
      if (action !== "save") return;
    } else {
      name = await Dialog.prompt({
        title: "New Tab",
        content: `<p><label>Tab name:</label></p><input type="text" name="name" value="New Tab" style="width:100%">`,
        callback: html => html.find("[name='name']").val(),
        rejectClose: false
      }).catch(() => null);
    }
    if (!name) return;

    const providers = providerRegistry.list();
    const defaultProviderId = providers[0]?.id || "journal-lines";
    const tabs = await getTabs();
    const newTab = {
      id: generateUUID(),
      name: name.trim() || "New Tab",
      color: "#c8a96e",
      icon: "fa-bookmark",
      providerId: defaultProviderId,
      journals: []
    };
    tabs.push(newTab);
    await saveTabs(tabs);
    this._tabs = tabs;
    this._activeTabId = newTab.id;
    try { await game.settings.set(MODULE_ID, "lastTab", newTab.id); } catch {}
    this.render(false);
  }

  async _customizeTab() {
    const tabs = await getTabs();
    const tab = tabs.find(t => t.id === this._activeTabId);
    if (!tab) return;

    const iconsByCat = {};
    for (const i of TAB_ICONS) {
      if (!iconsByCat[i.cat]) iconsByCat[i.cat] = [];
      iconsByCat[i.cat].push(i);
    }

    const providers = providerRegistry.list();
    const providerOptions = providers.map(p => `<option value="${p.id}" ${tab.providerId === p.id ? "selected" : ""}>${escapeHtml(p.label)}</option>`).join("");

    let iconGallery = "";
    for (const cat of Object.keys(iconsByCat)) {
      const catIcons = iconsByCat[cat].map(i => `<div class="cng-icon-tile ${tab.icon === i.id ? "cng-icon-active" : ""}" data-icon="${i.id}" title="${i.label}"><i class="fas ${i.id}"></i></div>`).join("");
      iconGallery += `<div class="cng-icon-category"><div class="cng-icon-cat-label">${cat}</div><div class="cng-icon-grid">${catIcons}</div></div>`;
    }
    const colorSwatches = TAB_PRESET_COLORS.map(c => `<div class="cng-color-swatch ${tab.color === c ? "cng-color-active" : ""}" data-color="${c}" style="background:${c}"></div>`).join("");

    const content = `
      <div class="cng-customize-form">
        <div class="cng-preview-row">
          <div class="cng-preview-label">Preview</div>
          <div class="cng-preview-tab" id="cng-preview-tab" style="--preview-color:${tab.color}">
            <span class="cng-preview-indicator" style="background:${tab.color}"></span>
            <i class="fas ${tab.icon}" id="cng-preview-icon"></i>
            <span id="cng-preview-name">${escapeHtml(tab.name)}</span>
          </div>
        </div>
        <div class="cng-field">
          <label>Tab Name</label>
          <input type="text" name="name" id="cng-name-input" value="${escapeHtml(tab.name)}" placeholder="Tab name...">
        </div>
        <div class="cng-field">
          <label>Provider</label>
          <select id="cng-provider-input" style="width:100%;padding:8px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--cng-border);border-radius:8px;color:inherit;font:inherit">${providerOptions}</select>
        </div>
        <div class="cng-field">
          <label>Icon</label>
          <div class="cng-icon-gallery">${iconGallery}</div>
          <input type="hidden" name="icon" id="cng-icon-input" value="${tab.icon}">
        </div>
        <div class="cng-field">
          <label>Color</label>
          <div class="cng-color-grid">${colorSwatches}</div>
          <input type="hidden" name="color" id="cng-color-input" value="${tab.color}">
        </div>
      </div>`;

    let selectedColor = tab.color;
    let selectedIcon = tab.icon;
    let savedName = tab.name;
    let selectedProviderId = tab.providerId || "journal-lines";
    const DV2 = getDialogV2();

    if (DV2) {
      const action = await DV2.wait({
        window: { title: "Customize Tab" },
        content,
        render: (_event, htmlElement) => {
          const previewTab = htmlElement.querySelector("#cng-preview-tab");
          const previewIcon = htmlElement.querySelector("#cng-preview-icon");
          const previewName = htmlElement.querySelector("#cng-preview-name");
          const indicator = htmlElement.querySelector(".cng-preview-indicator");
          const nameInput = htmlElement.querySelector("#cng-name-input");
          const providerInput = htmlElement.querySelector("#cng-provider-input");

          nameInput?.addEventListener("input", () => {
            if (previewName) previewName.textContent = nameInput.value || "Tab Name";
          });
          providerInput?.addEventListener("change", () => {
            selectedProviderId = providerInput.value;
          });
          htmlElement.querySelectorAll(".cng-color-swatch").forEach(swatch => {
            swatch.addEventListener("click", () => {
              htmlElement.querySelectorAll(".cng-color-swatch").forEach(s => s.classList.remove("cng-color-active"));
              swatch.classList.add("cng-color-active");
              selectedColor = swatch.dataset.color;
              htmlElement.querySelector("#cng-color-input").value = selectedColor;
              if (previewTab) previewTab.style.setProperty("--preview-color", selectedColor);
              if (indicator) indicator.style.background = selectedColor;
            });
          });
          htmlElement.querySelectorAll(".cng-icon-tile").forEach(tile => {
            tile.addEventListener("click", () => {
              htmlElement.querySelectorAll(".cng-icon-tile").forEach(t => t.classList.remove("cng-icon-active"));
              tile.classList.add("cng-icon-active");
              selectedIcon = tile.dataset.icon;
              htmlElement.querySelector("#cng-icon-input").value = selectedIcon;
              if (previewIcon) previewIcon.className = `fas ${selectedIcon}`;
            });
          });
        },
        buttons: [
          {
            action: "save",
            label: "Save",
            icon: "fas fa-check",
            default: true,
            callback: (_event, _button, dialog) => {
              const n = dialog.querySelector("#cng-name-input")?.value?.trim();
              const p = dialog.querySelector("#cng-provider-input")?.value?.trim();
              if (n) savedName = n;
              if (p) selectedProviderId = p;
            }
          },
          { action: "cancel", label: "Cancel", icon: "fas fa-times" }
        ]
      }).catch(() => null);
      if (action !== "save") return;
    } else {
      const confirmed = await new Promise(resolve => {
        new Dialog({
          title: `<i class="fas fa-paint-brush" style="margin-right:6px"></i> Customize Tab`,
          content,
          buttons: {
            save: {
              icon: '<i class="fas fa-check"></i>',
              label: "Save",
              callback: (html) => {
                const n = html.find("#cng-name-input").val().trim();
                const p = html.find("#cng-provider-input").val();
                if (n) savedName = n;
                if (p) selectedProviderId = p;
                resolve(true);
              }
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel", callback: () => resolve(false) }
          },
          default: "save",
          render: (html) => {
            const $previewTab = html.find("#cng-preview-tab");
            const $previewIcon = html.find("#cng-preview-icon");
            const $previewName = html.find("#cng-preview-name");
            const $indicator = html.find(".cng-preview-indicator");
            html.find("#cng-name-input").on("input", function () {
              $previewName.text($(this).val() || "Tab Name");
            });
            html.find("#cng-provider-input").on("change", function () {
              selectedProviderId = $(this).val();
            });
            html.find(".cng-color-swatch").click(function () {
              html.find(".cng-color-swatch").removeClass("cng-color-active");
              $(this).addClass("cng-color-active");
              selectedColor = $(this).data("color");
              html.find("#cng-color-input").val(selectedColor);
              $previewTab.css("--preview-color", selectedColor);
              $indicator.css("background", selectedColor);
            });
            html.find(".cng-icon-tile").click(function () {
              html.find(".cng-icon-tile").removeClass("cng-icon-active");
              $(this).addClass("cng-icon-active");
              selectedIcon = $(this).data("icon");
              html.find("#cng-icon-input").val(selectedIcon);
              $previewIcon.attr("class", "fas " + selectedIcon);
            });
          },
          close: () => resolve(false)
        }).render(true);
      });
      if (!confirmed) return;
    }

    tab.name = savedName;
    tab.icon = selectedIcon;
    tab.color = selectedColor;
    tab.providerId = selectedProviderId;
    await saveTabs(tabs);
    this._tabs = tabs;
    this.render(false);
  }

  async _deleteTab() {
    const DV2 = getDialogV2();
    let confirmed = false;
    if (DV2) {
      confirmed = await DV2.confirm({
        window: { title: "Delete Tab" },
        content: "<p>Delete this tab and all its source connections?</p>",
        yes: { label: "Delete", icon: "fas fa-trash" },
        no: { label: "Cancel" }
      }).catch(() => false);
    } else {
      confirmed = await Dialog.confirm({
        title: "Delete Tab",
        content: `<p>Delete this tab and its journal connections?</p>`,
        yes: () => true,
        no: () => false,
        defaultYes: false
      }).catch(() => false);
    }
    if (!confirmed) return;

    let tabs = await getTabs();
    const deletedTabId = this._activeTabId;
    tabs = tabs.filter(t => t.id !== deletedTabId);
    await saveTabs(tabs);
    this._tabs = tabs;
    this._activeTabId = tabs.length > 0 ? tabs[0].id : "";
    try { await game.settings.set(MODULE_ID, "lastTab", this._activeTabId); } catch {}
    delete this._results[deletedTabId];
    this.render(false);
  }

  _bindJournalSearch(searchInput, dropdown, hiddenInput) {
    const activeTab = this._tabs.find(t => t.id === this._activeTabId);
    const provider = providerRegistry.get(activeTab?.providerId || "journal-lines");
    searchInput.disabled = false;
    searchInput.placeholder = "Search journals…";
    if (provider && provider.supportsJournals === false) {
      searchInput.disabled = true;
      searchInput.value = "";
      hiddenInput.value = "";
      searchInput.placeholder = `Provider '${provider.label}' does not use journal sources`;
      dropdown.classList.remove("cng-dropdown-open");
      return;
    }

    const usedIds = new Set(activeTab?.journals?.map(j => j.id) || []);
    const allJournals = (game.journal?.contents || [])
      .filter(j => !usedIds.has(j.id))
      .map(j => ({ id: j.id, name: j.name }));

    const showResults = (items) => {
      dropdown.innerHTML = items.length === 0
        ? `<div class="cng-dropdown-empty">No journals found</div>`
        : items.map(j => `<div class="cng-dropdown-item" data-id="${j.id}">${escapeHtml(j.name)}</div>`).join("");
      dropdown.classList.add("cng-dropdown-open");
    };
    const hideResults = () => dropdown.classList.remove("cng-dropdown-open");

    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.trim().toLowerCase();
      hiddenInput.value = "";
      if (!query) return hideResults();
      showResults(allJournals.filter(j => j.name.toLowerCase().includes(query)));
    });
    searchInput.addEventListener("focus", () => {
      const query = searchInput.value.trim().toLowerCase();
      if (query) showResults(allJournals.filter(j => j.name.toLowerCase().includes(query)));
    });
    dropdown.addEventListener("click", (e) => {
      const item = e.target.closest(".cng-dropdown-item");
      if (!item) return;
      searchInput.value = item.textContent;
      hiddenInput.value = item.dataset.id;
      hideResults();
    });

    if (this._outsideClickHandler) document.removeEventListener("click", this._outsideClickHandler);
    this._outsideClickHandler = (e) => {
      if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) hideResults();
    };
    document.addEventListener("click", this._outsideClickHandler);
  }

  async _addJournal(element) {
    const tab = this._tabs.find(t => t.id === this._activeTabId);
    const provider = providerRegistry.get(tab?.providerId || "journal-lines");
    if (provider && provider.supportsJournals === false) {
      ui.notifications.warn(`Provider '${provider.label}' does not use journals.`);
      return;
    }

    const hiddenInput = element.querySelector(".cng-journal-selected-id");
    if (!hiddenInput) return;
    const journalId = hiddenInput.value;
    if (!journalId) {
      ui.notifications.warn("Please select a journal from the search.");
      return;
    }

    const tabs = await getTabs();
    const liveTab = tabs.find(t => t.id === this._activeTabId);
    if (!liveTab) return;
    if (!liveTab.journals) liveTab.journals = [];
    if (liveTab.journals.some(j => j.id === journalId)) {
      ui.notifications.warn("That journal is already connected.");
      return;
    }
    liveTab.journals.push({ id: journalId, enabled: true });
    await saveTabs(tabs);
    this._tabs = tabs;
    this.render(false);
    ui.notifications.info("Journal connected.");
  }

  async _removeJournal(index) {
    const tabs = await getTabs();
    const tab = tabs.find(t => t.id === this._activeTabId);
    if (!tab?.journals) return;
    tab.journals.splice(index, 1);
    await saveTabs(tabs);
    this._tabs = tabs;
    this.render(false);
  }

  async _toggleJournal(index) {
    const tabs = await getTabs();
    const tab = tabs.find(t => t.id === this._activeTabId);
    if (!tab?.journals?.[index]) return;
    tab.journals[index].enabled = !tab.journals[index].enabled;
    await saveTabs(tabs);
    this._tabs = tabs;
    this.render(false);
  }

  async _generate() {
    try {
      const result = await game[MODULE_ID].generate(this._activeTabId, { context: { source: "ui" } });
      if (!result.text) {
        ui.notifications.warn("No lines found in connected sources.");
        return;
      }
      this._results[this._activeTabId] = result.text;
      this.render(false);
    } catch (err) {
      console.error(err);
      ui.notifications.error(err.message || "Generation failed.");
    }
  }

  async _copyResult() {
    const result = this._results[this._activeTabId];
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      ui.notifications.info("Copied to clipboard!");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = result;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      ui.notifications.info("Copied to clipboard!");
    }
  }

  async _createNPC() {
    const text = this._results[this._activeTabId];
    if (!text) {
      ui.notifications.warn("Generate a name first!");
      return;
    }
    const tab = await resolveTab(this._activeTabId);
    const result = {
      text,
      parts: text.split(/\s+/),
      providerId: tab?.providerId || "journal-lines",
      tabId: tab?.id,
      tabName: tab?.name,
      metadata: { createdFromUI: true }
    };
    const actor = await game[MODULE_ID].createActor(result, { renderSheet: true });
    ui.notifications.info(`Created NPC: ${actor.name}`);
  }
}

/** Inject Name Generator button into Cypher GM Taskbar SECTION 1 */
function injectTaskbarButton() {
  const taskbarModule = game.modules.get("cypher-gm-taskbar");
  if (!taskbarModule?.active) return;
  // Try immediate injection first
  if (_addButtonToSection()) {
    _patchGMTaskbarRender();
    return;
  }
  // Retry loop: GM Taskbar may not be rendered yet
  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (_addButtonToSection()) {
      clearInterval(timer);
      _patchGMTaskbarRender();
      return;
    }
    if (attempts > 20) { // 5 seconds max
      clearInterval(timer);
      console.warn(`${MODULE_ID} | Failed to integrate with GM Taskbar SECTION 1 — not found after 5s`);
    }
  }, 250);
}

function _addButtonToSection() {
  const bar = document.querySelector("#cypher-gm-taskbar-bar");
  if (!bar) return false;
  const sectionButtons = bar.querySelector(".cgm-section-buttons");
  if (!sectionButtons) return false;
  // Aggressive cleanup: remove ANY non-Cypher-Log buttons (catches old cached buttons)
  const existing = sectionButtons.querySelectorAll(".cng-section-btn, .cng-taskbar-btn, [data-action=\'openNameGenerator\'], [title=\'Name Generator\'], [title=\'Open Name Generator\']");
  existing.forEach(el => el.remove());
  const btn = document.createElement("button");
  btn.className = "cgm-section-btn cng-section-btn";
  btn.type = "button";
  btn.title = "Name Generator";
  btn.setAttribute("aria-label", "Name Generator");
  btn.innerHTML = `<i class="fas fa-signature"></i>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openNameGenerator();
  });
  // Append after Cypher Log (which prepends itself)
  sectionButtons.append(btn);
  return true;
}

/** Patch GM Taskbar render to re-inject button after re-renders */
function _patchGMTaskbarRender() {
  const gm = window.cypherGMTaskbar;
  if (!gm || gm._cngPatched) return;
  gm._cngPatched = true;
  const originalRender = gm.render.bind(gm);
  gm.render = function(...args) {
    originalRender(...args);
    requestAnimationFrame(() => _addButtonToSection());
  };
}

let _dialogInstance = null;
function openNameGenerator() {
  if (_dialogInstance?.rendered) {
    _dialogInstance.close();
    return;
  }
  _dialogInstance = new NameGeneratorDialog();
  _dialogInstance.render(true);
  return _dialogInstance;
}

function buildPublicApi() {
  return {
    moduleId: MODULE_ID,
    hooks: HOOKS,
    open: openNameGenerator,
    async generate(tabId, options = {}) {
      return generateFromTab(tabId, options);
    },
    async createActor(result, options = {}) {
      return createActorFromResult(result, options);
    },
    providers: {
      register(provider) {
        return providerRegistry.register(provider);
      },
      unregister(providerId) {
        return providerRegistry.unregister(providerId);
      },
      get(providerId) {
        return providerRegistry.get(providerId);
      },
      list() {
        return providerRegistry.list();
      },
      has(providerId) {
        return providerRegistry.has(providerId);
      }
    },
    async getTabs() {
      return getTabs();
    },
    async getTab(tabId) {
      return resolveTab(tabId);
    },
    async saveTabs(tabs) {
      return saveTabs(tabs);
    },
    async addTab(tabData = {}) {
      const tabs = await getTabs();
      const providerId = tabData.providerId || providerRegistry.list()[0]?.id || "journal-lines";
      const tab = normalizeTab({
        id: tabData.id || generateUUID(),
        name: tabData.name || "New Tab",
        color: tabData.color || "#c8a96e",
        icon: tabData.icon || "fa-bookmark",
        providerId,
        journals: tabData.journals || []
      });
      tabs.push(tab);
      await saveTabs(tabs);
      return tab;
    },
    async updateTab(tabId, updates = {}) {
      const tabs = await getTabs();
      const index = tabs.findIndex(t => t.id === tabId);
      if (index === -1) throw new Error(`${MODULE_ID} | Tab '${tabId}' not found.`);
      tabs[index] = normalizeTab({ ...tabs[index], ...updates });
      await saveTabs(tabs);
      return tabs[index];
    },
    async removeTab(tabId) {
      const tabs = await getTabs();
      const next = tabs.filter(t => t.id !== tabId);
      if (next.length === tabs.length) throw new Error(`${MODULE_ID} | Tab '${tabId}' not found.`);
      await saveTabs(next);
      const lastTab = getLastTab();
      if (lastTab === tabId) {
        try { await game.settings.set(MODULE_ID, "lastTab", next[0]?.id || ""); } catch {}
      }
      return true;
    }
  };
}

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Cypher Name Generator v1.3.3`);
  registerSettings();
  registerBuiltInProviders();
  game[MODULE_ID] = buildPublicApi();
  Hooks.callAll(HOOKS.READY, game[MODULE_ID]);
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);
  if (game.modules.get("cypher-gm-taskbar")?.active) {
    console.log(`${MODULE_ID} | Cypher GM Taskbar detected — injecting button.`);
    injectTaskbarButton();
  }
});
