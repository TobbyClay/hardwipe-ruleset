import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { ABILITY_COLORS, DAMAGE_COLORS } from "./hardwipe-attack-cards.js";

/**
 * Card colours: one world setting (`cardColors`, overrides only) edited from a GM settings window.
 * Card types and results become CSS variables (--hw-c-<key>, with -glow and -deep variants) that the
 * stylesheet reads with Hardwipe's defaults as fallbacks; ability and damage-type colours update the
 * tables the card scripts read. Saving recolours every card already in the log.
 */
const SETTING = "cardColors";
// Copies taken before any override is applied.
const ABILITY_DEFAULTS = { ...ABILITY_COLORS };
const DAMAGE_DEFAULTS = { ...DAMAGE_COLORS };

const GROUPS = [
  { id: "cards", entries: [["item", "#8fcfb0"], ["feature", "#ff9f43"], ["implant", "#46e6dc"]] },
  {
    id: "results", entries: [["pending", "#ffc24d"], ["hit", "#8fcfb0"], ["critical", "#46e6dc"], ["miss", "#7d998e"], ["fumble", "#ff3f5f"],
      ["success", "#8fcfb0"], ["failure", "#ff3f5f"], ["targets", "#ffc24d"]]
  },
  {
    id: "system", entries: [["sys-edge", "#8fcfb0"], ["sys-downed", "#ffc24d"], ["sys-flatlined", "#ff3f5f"], ["sys-shield", "#4cc6ff"],
      ["sys-heat", "#ffc24d"], ["sys-calm", "#8fcfb0"], ["sys-lockdown", "#ff3f5f"], ["sys-wall", "#8fcfb0"], ["sys-breach", "#ff3f5f"], ["sys-review", "#ffc24d"]]
  },
  { id: "messages", entries: [["msg-roll", "#8fcfb0"], ["msg-turn", "#b48cff"], ["msg-request", "#ffc24d"]] },
  { id: "abilities", entries: Object.entries(ABILITY_DEFAULTS).map(([key, value]) => [`ability-${key}`, value]) },
  { id: "damage", entries: Object.entries(DAMAGE_DEFAULTS).map(([key, value]) => [`dmg-${key}`, value]) }
];
const DEFAULTS = Object.fromEntries(GROUPS.flatMap(group => group.entries));
const HEX = /^#[0-9a-f]{6}$/i;

export function registerCardColors() {
  game.settings.register(MODULE_ID, SETTING, {
    scope: "world", config: false, type: Object, default: {},
    onChange: () => { applyCardColors(); rerenderLog(); }
  });
  game.settings.registerMenu(MODULE_ID, "cardColorsMenu", {
    name: "HARDWIPE.Colors.Menu", label: "HARDWIPE.Colors.MenuLabel", hint: "HARDWIPE.Colors.MenuHint",
    icon: "fas fa-palette", type: CardColorsConfig, restricted: true
  });
  Hooks.once("setup", () => applyCardColors());
}

function overrides() {
  let stored = {};
  try { stored = game.settings.get(MODULE_ID, SETTING) ?? {}; } catch { stored = {}; }
  return Object.fromEntries(Object.entries(stored).filter(([key, value]) => key in DEFAULTS && HEX.test(String(value))));
}

/** Push the stored overrides into the page (CSS variables) and the colour tables. */
export function applyCardColors() {
  const set = overrides();
  for (const key of Object.keys(ABILITY_DEFAULTS)) ABILITY_COLORS[key] = set[`ability-${key}`] ?? ABILITY_DEFAULTS[key];
  for (const key of Object.keys(DAMAGE_DEFAULTS)) DAMAGE_COLORS[key] = set[`dmg-${key}`] ?? DAMAGE_DEFAULTS[key];
  const lines = Object.entries(set).filter(([key]) => !key.startsWith("ability-")).flatMap(([key, value]) => [
    `--hw-c-${key}: ${value};`,
    `--hw-c-${key}-glow: color-mix(in srgb, ${value} 45%, transparent);`,
    `--hw-c-${key}-deep: color-mix(in srgb, ${value} 60%, #000);`
  ]);
  let style = document.getElementById("hardwipe-card-colors");
  if (!style) {
    style = document.createElement("style");
    style.id = "hardwipe-card-colors";
    document.head.append(style);
  }
  style.textContent = lines.length ? `:root {\n  ${lines.join("\n  ")}\n}` : "";
}

/** Redraw every message in the chat log and in chat popouts. */
function rerenderLog() {
  for (const element of document.querySelectorAll("#chat .chat-message[data-message-id], .chat-popout .chat-message[data-message-id]")) {
    const message = game.messages.get(element.dataset.messageId);
    if (message) ui.chat?.updateMessage?.(message);
  }
}

function entryLabel(key) {
  if (key.startsWith("ability-")) {
    const config = CONFIG.DND5E.abilities?.[key.slice(8)];
    return config?.label ? game.i18n.localize(config.label) : key.slice(8);
  }
  if (key.startsWith("dmg-")) {
    const type = key.slice(4);
    const config = CONFIG.DND5E.damageTypes?.[type] ?? CONFIG.DND5E.healingTypes?.[type];
    return config?.label ? game.i18n.localize(config.label) : type;
  }
  return game.i18n.localize(`HARDWIPE.Colors.${key}`);
}

/** The GM's colour window: a picker per colour, grouped, each with its own reset. */
class CardColorsConfig extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "hardwipe-card-colors-config",
    tag: "form",
    classes: ["hardwipe-colors-config"],
    window: { title: "HARDWIPE.Colors.Title", icon: "fas fa-palette", resizable: true },
    position: { width: 440, height: 680 },
    form: { handler: CardColorsConfig.#save, closeOnSubmit: true },
    actions: { reset: CardColorsConfig.#reset, resetAll: CardColorsConfig.#resetAll }
  };

  async _renderHTML() {
    const set = overrides();
    const t = key => escapeHTML(game.i18n.localize(`HARDWIPE.Colors.${key}`));
    const groups = GROUPS.map(group => `<fieldset class="hardwipe-colors-group">
      <legend>${t(`Group-${group.id}`)}</legend>
      ${group.entries.map(([key, fallback]) => {
        const value = set[key] ?? fallback;
        return `<div class="hardwipe-colors-row${set[key] ? " is-changed" : ""}" data-key="${escapeHTML(key)}">
          <label for="hw-color-${escapeHTML(key)}">${escapeHTML(entryLabel(key))}</label>
          <input type="color" id="hw-color-${escapeHTML(key)}" name="${escapeHTML(key)}" value="${escapeHTML(value)}">
          <code>${escapeHTML(value)}</code>
          <button type="button" data-action="reset" data-key="${escapeHTML(key)}" data-tooltip="${t("Reset")}" aria-label="${t("Reset")}"><i class="fas fa-rotate-left" inert></i></button>
        </div>`;
      }).join("")}
    </fieldset>`).join("");
    return `<p class="hint">${t("Hint")}</p>
      <div class="hardwipe-colors-groups">${groups}</div>
      <footer class="form-footer">
        <button type="button" data-action="resetAll"><i class="fas fa-rotate-left" inert></i><span>${t("ResetAll")}</span></button>
        <button type="submit"><i class="fas fa-floppy-disk" inert></i><span>${t("Save")}</span></button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    // The hex beside each picker follows it, and a changed colour is marked.
    for (const input of content.querySelectorAll('input[type="color"]')) {
      input.addEventListener("input", () => {
        const row = input.closest(".hardwipe-colors-row");
        row.querySelector("code").textContent = input.value;
        row.classList.toggle("is-changed", input.value.toLowerCase() !== DEFAULTS[input.name].toLowerCase());
      });
    }
  }

  static #reset(event, target) {
    const input = this.element.querySelector(`input[name="${CSS.escape(target.dataset.key)}"]`);
    if (!input) return;
    input.value = DEFAULTS[input.name];
    input.dispatchEvent(new Event("input"));
  }

  static #resetAll() {
    for (const input of this.element.querySelectorAll('input[type="color"]')) {
      input.value = DEFAULTS[input.name];
      input.dispatchEvent(new Event("input"));
    }
  }

  static async #save(event, form, formData) {
    const values = formData.object;
    const stored = {};
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
      const value = String(values[key] ?? "").toLowerCase();
      if (HEX.test(value) && value !== fallback.toLowerCase()) stored[key] = value;
    }
    await game.settings.set(MODULE_ID, SETTING, stored);
  }
}
