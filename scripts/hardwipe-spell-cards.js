import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { actionStrip, decorateRollCard, descriptionSource, fillDescription, placeActions, rerenderCards, saveBlock, saveState, schoolColor, spellColor } from "./hardwipe-attack-cards.js";

/**
 * Spell cards as a running program: a small window with Output and Info tabs above the shared roll
 * card. The tab a viewer picks stays on their client only. The item's own buttons (damage, healing,
 * template and so on) move into the window's footer; the saving-throw button and per-target results
 * come from the shared save block.
 */
const infoTabs = new Set(); // Message ids showing the Info tab on this client.
const FOOTER_SKIP = new Set(["rollAttack", "rollSave"]); // Rolled below, or replaced by the save block.

export function isSpellCard(message) {
  return message.type === "usage" && message.getAssociatedItem?.()?.type === "spell";
}

/**
 * @param {ChatMessage} message
 * @param {HTMLElement} element
 * @param {object} [attack]  For spell attacks: { pending, tone, verdict, targets } from the attack view (verdict and targets as HTML).
 */
export function renderSpellCard(message, element, attack = null) {
  const content = element.querySelector(".message-content");
  const item = message.getAssociatedItem?.();
  if (!content || !item || !content.querySelector(".midi-results")) return false;
  const activity = message.getAssociatedActivity?.();
  element.classList.add("hardwipe-attack-message", "hardwipe-spell-message");
  element.style.setProperty("--hw-spell", spellColor(message, item));
  content.querySelector(":scope > .hardwipe-program")?.remove();

  const saves = saveState(message, element);
  const pending = !!attack?.pending || !!saves?.pending.length;
  const t = key => game.i18n.localize(`HARDWIPE.Spell.${key}`);
  const status = attack?.pending ? t("StatusReview") : saves?.pending.length ? t("StatusSaves") : t("StatusDone");
  const statusTone = pending ? "is-running" : "is-done";

  const program = document.createElement("div");
  program.className = `hardwipe-program${infoTabs.has(message.id) ? " is-info" : ""}`;
  program.innerHTML = `
    ${browserChrome({
      tabs: [{ id: "output", label: fileName(item.name), title: t("TabOutput") }, { id: "info", label: t("TabInfo"), icon: "fas fa-circle-info" }],
      host: fileName(item.actor?.name ?? "host").slice(0, -4), pid: processId(message.id),
      icon: pending ? "fa-hourglass-half" : "fa-lock", status, tone: statusTone
    })}
    <div class="hardwipe-program-body">
      <div class="hardwipe-program-name">${gemHTML(item)}<b>${escapeHTML(item.name)}</b></div>
      ${metaHTML(item, activity)}
      ${descriptionHTML(item)}
      <div class="hardwipe-program-output">
        ${attack ? `${attack.verdict}${attack.targets}` : ""}
      </div>
      <div class="hardwipe-program-info">${infoHTML(item, activity)}</div>
    </div>
    <div class="hardwipe-program-foot"><span class="hardwipe-program-spacer"></span><span class="hardwipe-program-note">${escapeHTML(slotNote(item))}</span></div>`;

  // Output: the saving throws, in the window.
  if (saves) program.querySelector(".hardwipe-program-output").append(saveBlock(message, saves, { variant: "window" }));
  // The spell's own buttons go to the action strip under the roll card.
  const actions = actionStrip(content, "is-spell", action => FOOTER_SKIP.has(action));
  content.prepend(program);
  element.classList.add("hardwipe-program-ready");

  // Tabs and "Read more" switch views on this client only.
  const setTab = tab => {
    program.classList.toggle("is-info", tab === "info");
    if (tab === "info") infoTabs.add(message.id);
    else infoTabs.delete(message.id);
    for (const button of program.querySelectorAll(".hardwipe-web-tab[data-tab]")) button.setAttribute("aria-selected", String(button.dataset.tab === tab));
  };
  setTab(infoTabs.has(message.id) ? "info" : "output");
  program.querySelectorAll(".hardwipe-web-tab[data-tab]").forEach(button => button.addEventListener("click", event => {
    event.preventDefault();
    setTab(button.dataset.tab);
  }));
  program.querySelector(".hardwipe-program-more")?.addEventListener("click", event => {
    event.preventDefault();
    setTab("info");
  });
  program.querySelectorAll(".hardwipe-program-description").forEach(node => fillDescription(node, item));

  decorateRollCard(message, element, { pending, saveResults: saves, tone: attack?.tone ?? null, locked: !!attack?.locked });
  placeActions(content, program, actions);
  return true;
}

/**
 * Browser-style chrome for program windows: a tab strip and an address bar with the process path and
 * a status badge. Tabs with an `id` are buttons that switch views; a tab without one is just shown.
 * @param {object} options
 * @param {{label: string, id?: string, title?: string, icon?: string}[]} options.tabs
 * @param {string} options.host   Address host, already a slug.
 * @param {number} options.pid
 * @param {string} options.icon   Font Awesome icon in the address field.
 * @param {string} options.status
 * @param {string} options.tone   Status badge classes.
 */
export function browserChrome({ tabs, host, pid, icon, status, tone }) {
  const tabHTML = tabs.map(tab => {
    const inner = `<i class="${tab.icon ?? "fas fa-microchip"}" inert></i><span>${escapeHTML(tab.label)}</span><i class="fas fa-xmark" aria-hidden="true"></i>`;
    if (!tab.id) return `<span class="hardwipe-web-tab is-active">${inner}</span>`;
    const title = tab.title ? ` aria-label="${escapeHTML(tab.title)}" data-tooltip="${escapeHTML(tab.title)}"` : "";
    return `<button type="button" class="hardwipe-web-tab" role="tab" data-tab="${tab.id}"${title}>${inner}</button>`;
  }).join("");
  return `<div class="hardwipe-web-strip"${tabs.some(tab => tab.id) ? ' role="tablist"' : ""}>${tabHTML}
      <span class="hardwipe-web-win" aria-hidden="true"><i class="fas fa-minus"></i><i class="far fa-square"></i><i class="fas fa-xmark"></i></span>
    </div>
    <div class="hardwipe-web-nav">
      <span class="hardwipe-web-arrows" aria-hidden="true"><i class="fas fa-arrow-left"></i><i class="fas fa-arrow-right"></i><i class="fas fa-rotate-right"></i></span>
      <span class="hardwipe-web-url"><i class="fas ${icon}" inert></i><span>${escapeHTML(host)}<span class="dim">:</span>${pid}</span></span>
      <span class="hardwipe-program-status ${tone}">${escapeHTML(status)}</span>
    </div>`;
}

/** A stable four-digit process id from any text (an effect or message id). */
export const processId = text => 1000 + ([...String(text)].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 9000, 7));

function fileName(name) {
  const slug = String(name ?? "program").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${slug || "program"}.prg`;
}

function gemHTML(item) {
  const color = schoolColor(item.system?.school);
  return color ? `<span class="hardwipe-gem" style="--gem:${escapeHTML(color)}"></span>` : "";
}

function levelLabel(item) {
  const level = Number(item.system?.level ?? 0);
  return level ? game.i18n.format("HARDWIPE.Spell.Level", { level }) : game.i18n.localize("HARDWIPE.Spell.Cantrip");
}

function metaHTML(item, activity) {
  const labels = item.labels ?? {};
  const chips = [`<span class="is-accent"><i class="fas fa-microchip" inert></i>${escapeHTML(game.i18n.localize("HARDWIPE.Spell.Cyber"))} · ${escapeHTML(levelLabel(item))}</span>`];
  for (const value of [labels.school, activity?.labels?.target || labels.target, labels.activation, labels.components?.vsm]) {
    if (value) chips.push(`<span>${escapeHTML(value)}</span>`);
  }
  for (const tag of labels.components?.tags ?? []) chips.push(`<span>${escapeHTML(tag)}</span>`);
  return `<div class="hardwipe-program-meta">${chips.join("")}</div>`;
}

function descriptionHTML(item) {
  if (!descriptionSource(item)) return "";
  return `<div class="hardwipe-program-desc is-clamped"><div class="hardwipe-program-description"></div>
    <a class="hardwipe-program-more">${escapeHTML(game.i18n.localize("HARDWIPE.Spell.ReadMore"))}</a></div>`;
}

function infoHTML(item, activity) {
  const labels = item.labels ?? {};
  const t = key => escapeHTML(game.i18n.localize(`HARDWIPE.Spell.${key}`));
  const rows = [
    ["Components", labels.components?.full ?? labels.components?.vsm],
    ["Casting", activity?.labels?.activation || labels.activation],
    ["Range", activity?.labels?.range || labels.range],
    ["Target", activity?.labels?.target || labels.target],
    ["Duration", activity?.labels?.duration || labels.duration],
    ["School", labels.school],
    ["Save", activity?.labels?.save],
    ["LevelLabel", levelLabel(item)]
  ].filter(([, value]) => value && String(value).trim());
  return `${descriptionSource(item) ? '<div class="hardwipe-program-desc is-full"><div class="hardwipe-program-description"></div></div>' : ""}
    <dl class="hardwipe-program-specs">${rows.map(([key, value]) => `<dt>${t(key)}</dt><dd>${escapeHTML(value)}</dd>`).join("")}</dl>`;
}

function slotNote(item) {
  const method = item.system?.method ?? item.system?.preparation?.mode;
  if (!Number(item.system?.level)) return game.i18n.localize("HARDWIPE.Spell.Cantrip");
  if (method && method !== "spell" && method !== "prepared") {
    const label = CONFIG.DND5E.spellcasting?.[method]?.label ?? CONFIG.DND5E.spellPreparationModes?.[method]?.label;
    if (label) return game.i18n.localize(label);
  }
  return levelLabel(item);
}

/** The spell sheet's colour picker, shown when the world colours spell cards per spell. */
export function registerSpellSheetColor() {
  Hooks.on("updateItem", (item, changes) => {
    if (item.type === "spell" && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.cardColor`)) {
      rerenderCards(message => message.getAssociatedItem?.()?.uuid === item.uuid);
    }
  });
  Hooks.on("renderItemSheet5e", (app, html) => {
    const item = app.document;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (item?.type !== "spell" || !root || game.settings.get(MODULE_ID, "spellCardColorMode") !== "spell") return;
    const tab = root.querySelector('.tab[data-tab="details"]');
    if (!tab || tab.querySelector(".hardwipe-spell-color")) return;
    const value = item.getFlag(MODULE_ID, "cardColor") ?? "";
    tab.insertAdjacentHTML("afterbegin", `<fieldset class="hardwipe-spell-color">
      <legend>${escapeHTML(game.i18n.localize("HARDWIPE.Spell.SheetLegend"))}</legend>
      <div class="form-group"><label>${escapeHTML(game.i18n.localize("HARDWIPE.Spell.SheetColor"))}</label>
        <div class="form-fields"><color-picker name="flags.${MODULE_ID}.cardColor" value="${escapeHTML(value)}" ${app.isEditable ? "" : "disabled"}></color-picker></div>
        <p class="hint">${escapeHTML(game.i18n.localize("HARDWIPE.Spell.SheetColorHint"))}</p></div>
    </fieldset>`);
  });
}
