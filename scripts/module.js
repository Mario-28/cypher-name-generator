/**
 * Cypher Name Generator v1.1.2
 * Foundry VTT v14+ | Cypher System
 *
 * A modular name and text generator that integrates with Cypher GM Taskbar.
 * Uses ApplicationV2 (HandlebarsApplicationMixin) for v14+ compatibility.
 */

const MODULE_ID = "cypher-name-generator";

/* ── Utility: Escape HTML ── */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* ── Utility: Generate UUID ── */
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS
   ═══════════════════════════════════════════════════════════ */

const DEFAULT_TABS = [
  { id: "names", name: "Names", color: "#c8a96e", icon: "fa-bookmark", journals: [] }
];

function normalizeTabs(tabs) {
  for (const tab of tabs) {
    if (!tab.journals) tab.journals = [];
    for (const j of tab.journals) {
      if (j.enabled === undefined) j.enabled = true;
    }
    if (!tab.color) tab.color = "#c8a96e";
    if (!tab.icon) tab.icon = "fa-bookmark";
  }
  return tabs;
}

function registerSettings() {
  game.settings.register(MODULE_ID, "tabs", {
    name: "Generator Tabs",
    hint: "Tabs with configured journal connections.",
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
  await game.settings.set(MODULE_ID, "tabs", tabs);
}

function getLastTab() {
  try { return game.settings.get(MODULE_ID, "lastTab") || ""; } catch { return ""; }
}

/* ═══════════════════════════════════════════════════════════
   HANDLEBARS HELPERS
   ═══════════════════════════════════════════════════════════ */

Hooks.once("init", () => {
  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("gt", (a, b) => a > b);
  Handlebars.registerHelper("add", (a, b) => Number(a) + Number(b));
  Handlebars.registerHelper("journalName", (id) => {
    const j = game.journal?.get(id);
    return j ? j.name : "(missing)";
  });
});

/* ═══════════════════════════════════════════════════════════
   TAB ICONS
   ═══════════════════════════════════════════════════════════ */

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
  { id: "fa-apple-alt", label: "Halfling (Apple)", cat: "Race" },
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

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class NameGeneratorDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this._tabs = [];
    this._activeTabId = "";
    this._results = {};
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

  async _prepareContext(options) {
    this._tabs = await getTabs();
    if (!this._activeTabId && this._tabs.length > 0) {
      const saved = getLastTab();
      this._activeTabId = saved && this._tabs.find(t => t.id === saved)
        ? saved
        : this._tabs[0].id;
    }

    const activeTab = this._tabs.find(t => t.id === this._activeTabId) || this._tabs[0];
    const allJournals = game.journal?.contents || [];
    const usedIds = new Set(activeTab?.journals?.map(j => j.id) || []);
    const availableJournals = allJournals.filter(j => !usedIds.has(j.id));

    return {
      tabs: this._tabs,
      activeTab: activeTab,
      activeTabId: this._activeTabId,
      availableJournals: availableJournals.map(j => ({ id: j.id, name: j.name })),
      result: this._results[this._activeTabId] || ""
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._bindListeners(this.element);
  }

  _onClose(options) {
    super._onClose(options);
    if (_dialogInstance === this) _dialogInstance = null;
  }

  _bindListeners(element) {
    // Tab switching + right-click customize
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

    // Actions — ONLY inside our content, NOT window header controls
    element.querySelectorAll(".cng-container [data-action]").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const action = el.dataset.action;
        switch (action) {
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

    // Remove journal
    element.querySelectorAll(".cng-journal-remove").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        this._removeJournal(idx);
      });
    });

    // Toggle journal visibility (eye icon)
    element.querySelectorAll(".cng-journal-eye").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        this._toggleJournal(idx);
      });
    });

    // Journal search
    const searchInput = element.querySelector(".cng-journal-search");
    const dropdown = element.querySelector(".cng-journal-dropdown");
    const hiddenInput = element.querySelector(".cng-journal-selected-id");
    if (searchInput && dropdown && hiddenInput) {
      this._bindJournalSearch(searchInput, dropdown, hiddenInput);
    }
  }

  /* ── Actions ── */

  async _switchTab(tabId) {
    this._activeTabId = tabId;
    try { await game.settings.set(MODULE_ID, "lastTab", tabId); } catch {}
    this.render(false);
  }

  async _addTab() {
    const name = await Dialog.prompt({
      title: "New Tab",
      content: `<p><label>Tab name:</label></p><input type="text" name="name" value="New Tab" style="width:100%">`,
      callback: html => html.find("[name='name']").val(),
      rejectClose: false
    }).catch(() => null);

    if (!name) return;

    const tabs = await getTabs();
    const newTab = { id: generateUUID(), name: name.trim() || "New Tab", color: "#c8a96e", icon: "fa-bookmark", journals: [] };
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

    // Group icons by category
    const iconsByCat = {};
    for (const i of TAB_ICONS) {
      if (!iconsByCat[i.cat]) iconsByCat[i.cat] = [];
      iconsByCat[i.cat].push(i);
    }

    // Build icon gallery
    let iconGallery = '';
    for (const cat of Object.keys(iconsByCat)) {
      const catIcons = iconsByCat[cat].map(i =>
        `<div class="cng-icon-tile ${tab.icon === i.id ? 'cng-icon-active' : ''}" data-icon="${i.id}" title="${i.label}">
          <i class="fas ${i.id}"></i>
        </div>`
      ).join('');
      iconGallery += `
        <div class="cng-icon-category">
          <div class="cng-icon-cat-label">${cat}</div>
          <div class="cng-icon-grid">${catIcons}</div>
        </div>`;
    }

    // Color swatches
    const colorSwatches = TAB_PRESET_COLORS.map(c =>
      `<div class="cng-color-swatch ${tab.color === c ? 'cng-color-active' : ''}" data-color="${c}" style="background:${c}"></div>`
    ).join('');

    const content = `
      <div class="cng-customize-form">
        <!-- Live Preview -->
        <div class="cng-preview-row">
          <div class="cng-preview-label">Preview</div>
          <div class="cng-preview-tab" id="cng-preview-tab" style="--preview-color: ${tab.color}">
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
          <label>Icon</label>
          <div class="cng-icon-gallery">${iconGallery}</div>
          <input type="hidden" name="icon" id="cng-icon-input" value="${tab.icon}">
        </div>

        <div class="cng-field">
          <label>Color</label>
          <div class="cng-color-grid">${colorSwatches}</div>
          <input type="hidden" name="color" id="cng-color-input" value="${tab.color}">
        </div>
      </div>
    `;

    let selectedColor = tab.color;
    let selectedIcon = tab.icon;

    const dialog = new Dialog({
      title: `<i class="fas fa-paint-brush" style="margin-right:6px"></i> Customize Tab`,
      content: content,
      buttons: {
        save: {
          icon: '<i class="fas fa-check"></i>',
          label: "Save",
          callback: (html) => {
            const name = html.find("#cng-name-input").val().trim();
            if (name) tab.name = name;
            tab.icon = selectedIcon;
            tab.color = selectedColor;
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "save",
      render: (html) => {
        const previewTab = html.find("#cng-preview-tab");
        const previewIcon = html.find("#cng-preview-icon");
        const previewName = html.find("#cng-preview-name");
        const previewIndicator = html.find(".cng-preview-indicator");

        // Live name update
        html.find("#cng-name-input").on("input", function() {
          previewName.text($(this).val() || "Tab Name");
        });

        // Color selection
        html.find(".cng-color-swatch").click(function() {
          html.find(".cng-color-swatch").removeClass("cng-color-active");
          $(this).addClass("cng-color-active");
          selectedColor = $(this).data("color");
          html.find("#cng-color-input").val(selectedColor);
          // Update preview
          previewTab.css("--preview-color", selectedColor);
          previewIndicator.css("background", selectedColor);
        });

        // Icon selection
        html.find(".cng-icon-tile").click(function() {
          html.find(".cng-icon-tile").removeClass("cng-icon-active");
          $(this).addClass("cng-icon-active");
          selectedIcon = $(this).data("icon");
          html.find("#cng-icon-input").val(selectedIcon);
          // Update preview
          previewIcon.attr("class", "fas " + selectedIcon);
        });
      }
    });
    await dialog.render(true);

    await saveTabs(tabs);
    this._tabs = tabs;
    this.render(false);
  }

  async _deleteTab() {
    const confirmed = await Dialog.confirm({
      title: "Delete Tab",
      content: `<p>Delete this tab and its journal connections?</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false
    });
    if (!confirmed) return;

    let tabs = await getTabs();
    tabs = tabs.filter(t => t.id !== this._activeTabId);
    await saveTabs(tabs);
    this._tabs = tabs;
    this._activeTabId = tabs.length > 0 ? tabs[0].id : "";
    try { await game.settings.set(MODULE_ID, "lastTab", this._activeTabId); } catch {}
    delete this._results[this._activeTabId];
    this.render(false);
  }

  _bindJournalSearch(searchInput, dropdown, hiddenInput) {
    const activeTab = this._tabs.find(t => t.id === this._activeTabId);
    const usedIds = new Set(activeTab?.journals?.map(j => j.id) || []);
    const allJournals = (game.journal?.contents || [])
      .filter(j => !usedIds.has(j.id))
      .map(j => ({ id: j.id, name: j.name }));

    const showResults = (items) => {
      if (items.length === 0) {
        dropdown.innerHTML = `<div class="cng-dropdown-empty">No journals found</div>`;
        dropdown.classList.add("cng-dropdown-open");
        return;
      }
      dropdown.innerHTML = items.map(j =>
        `<div class="cng-dropdown-item" data-id="${j.id}">${escapeHtml(j.name)}</div>`
      ).join("");
      dropdown.classList.add("cng-dropdown-open");
    };

    const hideResults = () => {
      dropdown.classList.remove("cng-dropdown-open");
    };

    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.trim().toLowerCase();
      hiddenInput.value = "";
      if (!query) {
        hideResults();
        return;
      }
      const filtered = allJournals.filter(j => j.name.toLowerCase().includes(query));
      showResults(filtered);
    });

    searchInput.addEventListener("focus", () => {
      const query = searchInput.value.trim().toLowerCase();
      if (query) {
        const filtered = allJournals.filter(j => j.name.toLowerCase().includes(query));
        showResults(filtered);
      }
    });

    dropdown.addEventListener("click", (e) => {
      const item = e.target.closest(".cng-dropdown-item");
      if (!item) return;
      searchInput.value = item.textContent;
      hiddenInput.value = item.dataset.id;
      hideResults();
    });

    document.addEventListener("click", (e) => {
      if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
        hideResults();
      }
    }, { once: true });
  }

  async _addJournal(element) {
    const hiddenInput = element.querySelector(".cng-journal-selected-id");
    const searchInput = element.querySelector(".cng-journal-search");
    if (!hiddenInput) return;
    const journalId = hiddenInput.value;
    if (!journalId) {
      ui.notifications.warn("Please select a journal from the search.");
      return;
    }

    const tabs = await getTabs();
    const tab = tabs.find(t => t.id === this._activeTabId);
    if (!tab) return;

    if (!tab.journals) tab.journals = [];
    if (tab.journals.some(j => j.id === journalId)) {
      ui.notifications.warn("That journal is already connected.");
      return;
    }

    tab.journals.push({ id: journalId, enabled: true });
    await saveTabs(tabs);
    this._tabs = tabs;
    this.render(false);
    ui.notifications.info("Journal connected.");
  }

  async _removeJournal(index) {
    const tabs = await getTabs();
    const tab = tabs.find(t => t.id === this._activeTabId);
    if (!tab || !tab.journals) return;

    tab.journals.splice(index, 1);
    await saveTabs(tabs);
    this._tabs = tabs;
    this.render(false);
  }

  async _toggleJournal(index) {
    const tabs = await getTabs();
    const tab = tabs.find(t => t.id === this._activeTabId);
    if (!tab || !tab.journals || !tab.journals[index]) return;

    tab.journals[index].enabled = !tab.journals[index].enabled;
    await saveTabs(tabs);
    this._tabs = tabs;
    this.render(false);
  }

  async _generate() {
    const tabs = await getTabs();
    const tab = tabs.find(t => t.id === this._activeTabId);
    if (!tab || !tab.journals || tab.journals.length === 0) {
      ui.notifications.warn("Connect at least one journal first.");
      return;
    }

    const parts = [];
    for (const entry of tab.journals) {
      if (entry.enabled === false) continue;
      const journal = game.journal.get(entry.id);
      if (!journal) continue;

      const pages = journal.pages?.contents || [];
      if (pages.length === 0) continue;

      const allLines = [];
      for (const page of pages) {
        const html = page.text?.content || page.text?.markdown || "";
        if (!html) continue;
        // Split by HTML block elements FIRST, then strip tags
        const text = html
          .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, "\n")
          .replace(/<(br|hr)\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, " ")
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(l => l.length > 0);
        allLines.push(...text);
      }

      if (allLines.length === 0) continue;
      const randomLine = allLines[Math.floor(Math.random() * allLines.length)];
      parts.push(randomLine);
    }

    if (parts.length === 0) {
      ui.notifications.warn("No lines found in connected journals.");
      return;
    }

    const resultText = parts.join(" ");
    this._results[this._activeTabId] = resultText;
    this.render(false);
  }

  async _copyResult() {
    const result = this._results[this._activeTabId];
    if (!result) return;

    try {
      await navigator.clipboard.writeText(result);
      ui.notifications.info("Copied to clipboard!");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = result;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      ui.notifications.info("Copied to clipboard!");
    }
  }

  async _createNPC() {
    const result = this._results[this._activeTabId];
    if (!result) {
      ui.notifications.warn("Generate a name first!");
      return;
    }

    // Find or create "NEW ACTORS" folder
    let folder = game.folders.find(f => f.type === "Actor" && f.name === "NEW ACTORS");
    if (!folder) {
      folder = await Folder.create({
        name: "NEW ACTORS",
        type: "Actor",
        parent: null
      });
      ui.notifications.info("Created 'NEW ACTORS' folder.");
    }

    // Create the NPC actor (Cypher System uses lowercase 'npc')
    const actor = await Actor.create({
      name: result,
      type: "npc",
      folder: folder.id
    });

    ui.notifications.info(`Created NPC: ${result}`);

    // Open the actor sheet
    actor.sheet.render(true);
  }
}

/* ═══════════════════════════════════════════════════════════
   TASKBAR INTEGRATION
   ═══════════════════════════════════════════════════════════ */

function injectTaskbarButton() {
  const taskbarModule = game.modules.get("cypher-gm-taskbar");
  if (!taskbarModule?.active) return;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const bar = node.matches?.("#cypher-gm-taskbar-bar")
            ? node
            : node.querySelector?.("#cypher-gm-taskbar-bar");
          if (bar) _addButtonToBar(bar);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  const existingBar = document.querySelector("#cypher-gm-taskbar-bar");
  if (existingBar) _addButtonToBar(existingBar);
}

function _addButtonToBar(bar) {
  if (bar.querySelector(".cng-taskbar-btn")) return;

  const diffBox = bar.querySelector(".cgm-difficulty-box");
  if (!diffBox) return;

  const btn = document.createElement("button");
  btn.className = "cgm-icon-btn cng-taskbar-btn";
  btn.title = "Name Generator";
  btn.innerHTML = `<i class="fas fa-scroll"></i>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openNameGenerator();
  });

  diffBox.after(btn);
}

/* ═══════════════════════════════════════════════════════════
   PUBLIC API
   ═══════════════════════════════════════════════════════════ */

let _dialogInstance = null;

function openNameGenerator() {
  if (_dialogInstance?.rendered) {
    _dialogInstance.close();
    return;
  }
  _dialogInstance = new NameGeneratorDialog();
  _dialogInstance.render(true);
}

/* ═══════════════════════════════════════════════════════════
   HOOKS
   ═══════════════════════════════════════════════════════════ */

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing Cypher Name Generator...`);
  registerSettings();
  game[MODULE_ID] = { open: openNameGenerator };
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready`);
  if (game.modules.get("cypher-gm-taskbar")?.active) {
    console.log(`${MODULE_ID} | Cypher GM Taskbar detected — injecting button.`);
    injectTaskbarButton();
  }
});
