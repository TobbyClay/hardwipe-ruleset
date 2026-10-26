import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { hashSeed } from "./hardwipe-eye.js";
import { rerenderCards } from "./hardwipe-attack-cards.js";
import { itemMaker } from "./hardwipe-manufacturers.js";

/**
 * Legendary cards: a weapon of a high enough rarity can wear a design of its own on its attack card, in place of the
 * base card and its maker's style. The GM picks it from the crown on the weapon's card in chat. It is saved on the item
 * (`flags["hardwipe-ruleset"].cardIdentity`), so every card of that weapon wears it, the ones already in chat too.
 * Which weapons qualify is a rarity floor in the system's rarity order, so Custom D&D's own tiers count as the GM ranks
 * them. Each design is a code-owned layout of the card's parts (styles/legendary.css): the verdict, the targets and the
 * roll card keep their outcome colours. A player sees an unidentified weapon's plain card.
 */
export const FLAG = "cardIdentity";
const SETTING = "legendaryRarity";
const ROOT = "hardwipe-legendary";
const t = key => game.i18n.localize(`HARDWIPE.Legend.${key}`);

/* Pure helpers (unit-tested) ----------------------------------------------------------------- */

/**
 * The rarity a weapon must reach: the chosen tier while it exists, else the top tier. Not D&D5e's "legendary" by
 * name: SC Item Rarity Colors can list D&D5e's tiers ahead of Custom D&D's, which would put every custom tier above it.
 */
export function rarityFloor(table, chosen) {
  const keys = Object.keys(table ?? {});
  if (chosen && keys.includes(chosen)) return chosen;
  return keys.at(-1) ?? "";
}

/** Whether a rarity is at or above the floor, in the table's order. No rarity never qualifies. */
export function reachesFloor(rarity, table, chosen) {
  const keys = Object.keys(table ?? {});
  const rank = keys.indexOf(String(rarity ?? ""));
  const floor = keys.indexOf(rarityFloor(table, chosen));
  return rank >= 0 && floor >= 0 && rank >= floor;
}

/** The design an item's flag names, or "" (no flag, the standard card, a newer schema, a design that's gone). */
export function flaggedDesign(flag) {
  if (flag?.schema !== 1 || flag.mode !== "preset") return "";
  return Object.hasOwn(DESIGNS, flag.preset) ? flag.preset : "";
}

/** The item's rarity: D&D5e 6 keeps a set (`system.rarities`) and reads its first as `system.rarity`, the card's label. */
export function rarityKey(item) {
  return String(item?.system?.rarity?.value ?? item?.system?.rarity ?? "");
}

/** The design a viewer sees on a weapon's card: one is set, the weapon is rare enough, and a player knows what it is. */
export function cardDesign(item, { table, chosen, isGM }) {
  if (item?.type !== "weapon") return "";
  const id = flaggedDesign(item.flags?.[MODULE_ID]?.[FLAG]);
  if (!id || !reachesFloor(rarityKey(item), table, chosen)) return "";
  if (item.system?.identified === false && !isGM) return "";
  return id;
}

/** A serial for the card, the same on every client: from the item, not the message. */
export function serialOf(uuid) {
  return String(hashSeed(uuid) % 10000).padStart(4, "0");
}

/* The designs ------------------------------------------------------------------------------------ */

const FILIGREE = '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">'
  + '<path d="M2 38V15C2 7.8 7.8 2 15 2h23"/><path d="M7 38V19c0-6.6 5.4-12 12-12h19"/>'
  + '<path d="M15 2c-2.4 6.4 1 11.4 6.6 11.4 5 0 6.6-5.8 3-7.4-2.8-1.2-5 1.8-2.6 3.6"/>'
  + '<path d="M2 15c6.4 2.4 11.4-1 11.4-6.6 0-1.4-.3-2.6-.8-3.6"/><circle cx="7.4" cy="7.4" r="1.7" fill="currentColor" stroke="none"/></svg>';
const CLIP = '<svg viewBox="0 0 14 38" fill="none" stroke-width="1.8" stroke-linecap="round">'
  + '<path d="M4.5 12V6a3.2 3.2 0 0 1 6.4 0v23a5.4 5.4 0 0 1-10.8 0V10" stroke="#aeb7bf"/></svg>';

const title = p => `<div class="hardwipe-chat-title hwl-title">${p.name}</div>`;
const top = (p, label) => `${label}<span class="hardwipe-attack-status">${p.status}</span>${p.control}`;
// What every design keeps, in the base card's order: the attack's kind, the chips, the verdict, the targets, the brief.
const tail = p => `${p.kind}${p.props}${p.verdict}${p.targets}${p.brief}${p.meta}`;
const joined = (...parts) => parts.filter(Boolean).join(" · ");

/**
 * Each design lays out the card's parts in its own head. `p` holds them ready to place: text already escaped, the
 * shared blocks as HTML. Every head keeps the status, the GM's crown and the tail.
 */
const DESIGNS = {
  engraved: p => `<div class="hwl-rail">${top(p, `<span class="hwl-edition">${p.rarity}</span>`)}</div>
    <div class="hwl-plate">${["tl", "tr", "bl", "br"].map(corner => `<i class="hwl-filigree is-${corner}">${FILIGREE}</i>`).join("")}
      ${p.maker ? `<div class="hwl-over">${p.maker}</div>` : ""}${title(p)}
      <div class="hwl-rule"><i></i><b></b><i></i></div>
      <div class="hwl-sub">${joined(p.type, `No. ${p.serial}`)}</div></div>
    ${tail(p)}`,
  holo: p => `<div class="hwl-top">${top(p, `<span class="hwl-rarity">${p.rarity}</span>`)}</div>
    <div class="hwl-card"><div class="hwl-window hwl-fold">${p.img ? `<img src="${p.img}" alt="" draggable="false">` : ""}<i class="hwl-seal">✦</i></div>
      <div class="hwl-namebox">${title(p)}<span class="hwl-num">No. ${p.serial}</span></div>
      <div class="hwl-sub">${joined(p.type, p.maker)}</div><i class="hwl-foil"></i></div>
    ${tail(p)}`,
  evidence: p => `<div class="hwl-tab">${top(p, `<b>${escapeHTML(t("Evidence"))}</b><span class="hwl-case">No. ${p.serial}</span>`)}</div>
    <div class="hwl-sheet"><i class="hwl-clip hwl-fold">${CLIP}</i><span class="hwl-stamp">${escapeHTML(t("Stamp"))}</span>
      <div class="hwl-label">${escapeHTML(t("Item"))}</div>${title(p)}
      <dl class="hwl-fields hwl-fold"><div><dt>${escapeHTML(t("Class"))}</dt><dd>${p.type || "—"}</dd></div>
        <div><dt>${escapeHTML(t("Grade"))}</dt><dd>${p.rarity || "—"}</dd></div>
        <div><dt>${escapeHTML(t("Maker"))}</dt><dd>${p.maker || `<s class="hwl-redact">${escapeHTML(t("Unknown"))}</s>`}</dd></div></dl></div>
    ${tail(p)}`,
  neon: p => `<div class="hwl-top">${top(p, `<span class="hwl-tag">${p.rarity}</span>`)}</div>
    <div class="hwl-sign"><i class="hwl-halo hwl-fold"></i>${title(p)}<div class="hwl-sub">${joined(p.type, p.maker)}</div></div>
    ${tail(p)}`
};
export const DESIGN_IDS = Object.keys(DESIGNS);

/**
 * A legendary head from the parts of the base one (hardwipe-attacks.js): the design adds the maker, the weapon's
 * art and the serial. The head keeps the base classes so the card's own behaviour (folding, outcome) carries on.
 */
export function legendaryHeadHTML(id, parts, item) {
  const p = { ...parts, maker: escapeHTML(itemMaker(item)), img: escapeHTML(item?.img ?? ""), serial: serialOf(item?.uuid) };
  return `<div class="hardwipe-attack-head hardwipe-weapon-head hwl-head is-${parts.tone}">${DESIGNS[id](p)}</div>`;
}

/* The card -------------------------------------------------------------------------------------- */

function chosenFloor() {
  return game.settings.settings.has(`${MODULE_ID}.${SETTING}`) ? game.settings.get(MODULE_ID, SETTING) : "";
}

/** Whether a weapon is rare enough for a legendary card. */
export function canWearLegend(item) {
  return item?.type === "weapon" && reachesFloor(rarityKey(item), CONFIG.DND5E.itemRarity, chosenFloor());
}

/** The design this viewer sees on a weapon's attack card, or "". */
export function legendaryDesign(item) {
  return cardDesign(item, { table: CONFIG.DND5E.itemRarity, chosen: chosenFloor(), isGM: game.user.isGM });
}

/** The GM's crown on the card's bar: it opens the designs. Nothing for players or for a weapon not rare enough. */
export function legendControlHTML(item) {
  if (!game.user.isGM || !canWearLegend(item)) return "";
  const label = escapeHTML(t("Pick"));
  return `<button type="button" class="hwl-pick" data-tooltip="${label}" aria-label="${label}"><i class="fas fa-crown" inert></i></button>`;
}

/** Mark the message with its design (or clear it): the design's palette reaches the roll card below the head. */
export function dressLegendary(element, id) {
  element.classList.remove(ROOT, ...[...element.classList].filter(name => name.startsWith("hwl-")));
  if (id) element.classList.add(ROOT, `hwl-${id}`);
}

/**
 * Wire the crown. `preview(id)` draws this weapon's head in a design ("" for the standard card), for the picker.
 * @param {HTMLElement} element
 * @param {Item} item
 * @param {(id: string) => string} preview
 */
export function bindLegendControl(element, item, preview) {
  element.querySelector(".hwl-pick")?.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    void pickDesign(item, preview);
  });
}

async function pickDesign(item, preview) {
  const current = flaggedDesign(item.getFlag(MODULE_ID, FLAG));
  const choice = (id, label, hint) => `<label class="hwl-choice">
      <input type="radio" name="design" value="${id}"${id === current ? " checked" : ""}>
      <span class="hwl-choice-text"><b>${escapeHTML(label)}</b><small>${escapeHTML(hint)}</small></span>
      <div class="hwl-preview${id ? ` ${ROOT} hwl-${id}` : ""}" inert>${preview(id)}</div>
    </label>`;
  const content = `<p class="hint">${escapeHTML(t("PickHint"))}</p><div class="hwl-choices">
    ${choice("", t("Standard"), t("StandardHint"))}${DESIGN_IDS.map(id => choice(id, t(`Design.${id}`), t(`Design.${id}Hint`))).join("")}</div>`;
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("HARDWIPE.Legend.PickTitle", { name: item.name }), icon: "fas fa-crown" },
    classes: ["hardwipe-dialog", "is-legend"],
    position: { width: 700 },
    content,
    rejectClose: false,
    buttons: [
      { action: "apply", label: "HARDWIPE.Legend.Apply", icon: "fas fa-check", default: true, callback: (event, button) => button.form.elements.design.value },
      { action: "cancel", label: "Cancel", icon: "fas fa-xmark" }
    ]
  });
  if (typeof picked !== "string" || picked === "cancel" || picked === current) return;
  await item.setFlag(MODULE_ID, FLAG, { schema: 1, mode: picked ? "preset" : "default", preset: picked || null });
}

/** The floor's choices, read when the settings open: Custom D&D can change the rarity list without a reload. */
function rarityChoices() {
  const table = CONFIG.DND5E.itemRarity ?? {};
  const label = key => game.i18n.localize(table[key]?.label ?? table[key] ?? key);
  const auto = rarityFloor(table, "");
  return {
    "": game.i18n.format("HARDWIPE.Legend.RarityAuto", { tier: auto ? label(auto) : "—" }),
    ...Object.fromEntries(Object.keys(table).map(key => [key, label(key)]))
  };
}

export function registerLegendary() {
  game.settings.register(MODULE_ID, SETTING, {
    name: "HARDWIPE.Legend.Rarity", hint: "HARDWIPE.Legend.RarityHint", scope: "world", config: true,
    type: String, default: "", choices: rarityChoices, onChange: () => rerenderCards()
  });
  // A new design, rarity or identification redraws that weapon's cards already in the log.
  Hooks.on("updateItem", (item, changes) => {
    if (item.type !== "weapon") return;
    const has = path => foundry.utils.hasProperty(changes, path);
    if (has(`flags.${MODULE_ID}.${FLAG}`) || has("system.rarities") || has("system.rarity") || has("system.identified")) {
      rerenderCards(message => message.getAssociatedItem?.()?.uuid === item.uuid);
    }
  });
}
