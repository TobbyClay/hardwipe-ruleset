import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { hashSeed } from "./hardwipe-eye.js";
import { rerenderCards } from "./hardwipe-attack-cards.js";
import { itemMaker } from "./hardwipe-manufacturers.js";

/**
 * Legendary cards: a rare enough weapon can have a chat card of its own in place of the plain card and its maker's
 * style. The GM makes it from the crown on the weapon's attack card, one of two ways:
 * - its own card: a base design made this weapon's own, with its art, a hue, its title's type and colour and its own
 *   lines, saved on the weapon;
 * - a signature card: hand-built here for one known weapon, and on one weapon at a time.
 * The choice is saved on the item (`flags["hardwipe-ruleset"].cardIdentity`), so every card of that weapon wears it,
 * the ones already in chat too. Which weapons qualify is a rarity floor in the system's rarity order, so Custom D&D's
 * own tiers count as the GM ranks them. The verdict, the targets and the roll card keep their outcome colours
 * (styles/legendary.css). A player sees an unidentified weapon's plain card.
 */
export const FLAG = "cardIdentity";
const SETTING = "legendaryRarity";
const ROOT = "hardwipe-legendary";
const t = key => game.i18n.localize(`HARDWIPE.Legend.${key}`);
const tx = key => escapeHTML(t(key));

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

/** The item's rarity: D&D5e 6 keeps a set (`system.rarities`) and reads its first as `system.rarity`, the card's label. */
export function rarityKey(item) {
  return String(item?.system?.rarity?.value ?? item?.system?.rarity ?? "");
}

/** Title types a weapon's own card can use instead of its design's (styles/legendary.css has each stack). */
export const TITLE_FONTS = ["display", "serif", "typewriter", "mono", "brush", "script", "impact"];
const LIMITS = { art: 500, kicker: 48, subtitle: 72, badge: 20, quote: 160 };

/** A weapon's own card as stored, made safe: anything unknown or out of range falls back to the design's own. */
export function cleanOwn(own) {
  const text = key => String(own?.[key] ?? "").trim().slice(0, LIMITS[key]);
  const number = (value, min, max, fallback) => {
    const n = Math.round(Number(value));
    return value === "" || value === null || !Number.isFinite(n) ? fallback : Math.min(max, Math.max(min, n));
  };
  return {
    base: Object.hasOwn(BASES, own?.base) ? own.base : "",
    art: text("art"), artOpacity: number(own?.artOpacity, 10, 100, 35), hue: number(own?.hue, -180, 180, 0),
    font: TITLE_FONTS.includes(own?.font) ? own.font : "",
    color: /^#[0-9a-f]{6}$/i.test(own?.color ?? "") ? own.color.toLowerCase() : "",
    kicker: text("kicker"), subtitle: text("subtitle"), badge: text("badge"), quote: text("quote")
  };
}

/** What a flag asks for: the weapon's own card, a signature card, or null (the plain card, a newer schema, a design that's gone). */
export function cardSpec(flag) {
  if (flag?.schema !== 1) return null;
  if (flag.mode === "signature") return Object.hasOwn(SIGNATURES, flag.signature) ? { kind: "signature", id: flag.signature } : null;
  if (flag.mode !== "own") return null;
  const own = cleanOwn(flag.own);
  return own.base ? { kind: "own", own } : null;
}

/** The card a viewer sees for a weapon: one is set, the weapon is rare enough, and a player knows what it is. */
export function cardDesign(item, { table, chosen, isGM }) {
  if (item?.type !== "weapon") return null;
  const spec = cardSpec(item.flags?.[MODULE_ID]?.[FLAG]);
  if (!spec || !reachesFloor(rarityKey(item), table, chosen)) return null;
  if (item.system?.identified === false && !isGM) return null;
  return spec;
}

/** The other weapons wearing a signature card (one weapon at a time: applying it elsewhere takes it off them). */
export function heldElsewhere(items, id, uuid) {
  return items.filter(item => item.uuid !== uuid && cardSpec(item.flags?.[MODULE_ID]?.[FLAG])?.id === id);
}

/** A serial for the card, the same on every client: from the item, not the message. */
export function serialOf(uuid) {
  return String(hashSeed(uuid) % 10000).padStart(4, "0");
}

/* Shared pieces --------------------------------------------------------------------------------- */

const FILIGREE = '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">'
  + '<path d="M2 38V15C2 7.8 7.8 2 15 2h23"/><path d="M7 38V19c0-6.6 5.4-12 12-12h19"/>'
  + '<path d="M15 2c-2.4 6.4 1 11.4 6.6 11.4 5 0 6.6-5.8 3-7.4-2.8-1.2-5 1.8-2.6 3.6"/>'
  + '<path d="M2 15c6.4 2.4 11.4-1 11.4-6.6 0-1.4-.3-2.6-.8-3.6"/><circle cx="7.4" cy="7.4" r="1.7" fill="currentColor" stroke="none"/></svg>';
const CLIP = '<svg viewBox="0 0 14 38" fill="none" stroke-width="1.8" stroke-linecap="round">'
  + '<path d="M4.5 12V6a3.2 3.2 0 0 1 6.4 0v23a5.4 5.4 0 0 1-10.8 0V10" stroke="#aeb7bf"/></svg>';
const MARIGOLD = '<svg viewBox="0 0 24 24" fill="#ff9f1c">'
  + Array.from({ length: 10 }, (_, i) => `<ellipse cx="12" cy="5.6" rx="2.6" ry="5" transform="rotate(${i * 36} 12 12)"/>`).join("")
  + '<circle cx="12" cy="12" r="3.6" fill="#9a4207"/></svg>';
const PICADO = ["#ff4f9a", "#ff9f1c", "#2ec4b6", "#9b5de5", "#fee440", "#00bbf9", "#f15bb5", "#7bd389"];
const ENSO = '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-linecap="round">'
  + '<path d="M70 14C50 4 18 14 12 44S34 94 60 88s34-30 26-52" stroke-width="8" opacity="0.85"/>'
  + '<path d="M66 17C46 10 22 19 16 44s20 46 44 40" stroke-width="2.5" opacity="0.5"/></svg>';
const SCRAWL = '<svg class="hws-scrawl" viewBox="0 0 80 20" fill="none" stroke="#a8c8ff" stroke-width="1.4" stroke-linecap="round">'
  + '<path d="M2 14c6-10 9-10 9-3s3 6 7-4 6 9 10 2 4-8 8-1 7 3 11-3 6 5 10 1 8-2 14-3"/></svg>';
const STICKERS = '<svg class="hws-star" viewBox="0 0 24 24"><path d="M12 1l3.2 7 7.6.8-5.7 5.1 1.7 7.5L12 17.6 5.2 21.4l1.7-7.5L1.2 8.8 8.8 8z" fill="#ffe14d" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>'
  + '<svg class="hws-heart" viewBox="0 0 24 22"><path d="M12 21S1 13.7 1 7.2C1 3.6 3.7 1 7 1c2.2 0 4 1.2 5 3 1-1.8 2.8-3 5-3 3.3 0 6 2.6 6 6.2C23 13.7 12 21 12 21z" fill="#ff4fa3" stroke="#111" stroke-width="1.4"/></svg>'
  + '<svg class="hws-skull" viewBox="0 0 30 30"><path d="M15 3C8.4 3 4 7.6 4 13.4c0 3.6 1.7 6 4 7.4V25h14v-4.2c2.3-1.4 4-3.8 4-7.4C26 7.6 21.6 3 15 3z" fill="#fff" stroke="#111" stroke-width="1.4"/>'
  + '<circle cx="10.6" cy="13.6" r="2.8" fill="#111"/><circle cx="19.4" cy="13.6" r="2.8" fill="#111"/><path d="M13.6 19h2.8" stroke="#111" stroke-width="1.6"/>'
  + '<path d="M17 4l5-3.4 1 5.4zM17 4l-1.4 5.6 6.4-4.2z" fill="#ff4fa3" stroke="#111" stroke-width="1"/></svg>'
  + '<svg class="hws-bolt" viewBox="0 0 16 26"><path d="M10 1L1 15h6l-2 10 10-15H9z" fill="#3ff3ff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';

const title = p => `<div class="hardwipe-chat-title hwl-title">${p.name}</div>`;
const top = (p, label) => `${label}<span class="hardwipe-attack-status">${p.status}</span>${p.control}`;
// What every card keeps, in the base card's order: the attack's kind, the chips, the verdict, the targets, the brief.
const tail = p => `${p.kind}${p.props}${p.verdict}${p.targets}${p.brief}${p.meta}`;
const joined = (...parts) => parts.filter(Boolean).join(" · ");
// A weapon's own lines and art, where its design has room for them.
const kicker = p => p.kicker ? `<div class="hwl-kicker">${p.kicker}</div>` : "";
const quote = p => p.quote ? `<div class="hwl-quote">${p.quote}</div>` : "";
const art = p => p.art ? `<img class="hwl-art" src="${p.art}" alt="" draggable="false">` : "";
const OUTCOMES = new Set(["attack", "pending", "hit", "critical", "miss", "mixed", "fumble"]);
const outcome = tone => OUTCOMES.has(tone) ? tone : "attack";

/* The base designs ------------------------------------------------------------------------------ */

/**
 * The designs a weapon's own card starts from. Each lays out the card's parts in its own head; `p` holds them ready to
 * place: text already escaped, the shared blocks as HTML, and the weapon's own lines and art (empty for the design's
 * own). The panel each one shows the weapon in is `.hwl-show`: its art sits there, and its hue turns it.
 */
const BASES = {
  engraved: p => `<div class="hwl-rail">${top(p, `<span class="hwl-edition">${p.rarity}</span>`)}</div>
    <div class="hwl-plate hwl-show">${art(p)}${["tl", "tr", "bl", "br"].map(corner => `<i class="hwl-filigree is-${corner}">${FILIGREE}</i>`).join("")}
      ${p.kicker || p.maker ? `<div class="hwl-over">${p.kicker || p.maker}</div>` : ""}${title(p)}
      <div class="hwl-rule"><i></i><b></b><i></i></div>
      <div class="hwl-sub">${p.subtitle || joined(p.type, `No. ${p.serial}`)}</div>${quote(p)}</div>
    ${tail(p)}`,
  holo: p => `<div class="hwl-top">${top(p, `<span class="hwl-rarity">${p.rarity}</span>`)}</div>
    <div class="hwl-card hwl-show"><div class="hwl-window hwl-fold">${p.art || p.img ? `<img class="${p.art ? "is-art" : ""}" src="${p.art || p.img}" alt="" draggable="false">` : ""}<i class="hwl-seal">${p.badge || "✦"}</i></div>
      ${kicker(p)}<div class="hwl-namebox">${title(p)}<span class="hwl-num">No. ${p.serial}</span></div>
      <div class="hwl-sub">${p.subtitle || joined(p.type, p.maker)}</div>${quote(p)}<i class="hwl-foil"></i></div>
    ${tail(p)}`,
  evidence: p => `<div class="hwl-tab">${top(p, `<b>${tx("Evidence")}</b><span class="hwl-case">No. ${p.serial}</span>`)}</div>
    <div class="hwl-sheet hwl-show">${art(p)}<i class="hwl-clip hwl-fold">${CLIP}</i><span class="hwl-stamp">${p.badge || tx("Stamp")}</span>
      <div class="hwl-label">${p.kicker || tx("Item")}</div>${title(p)}${p.subtitle ? `<div class="hwl-sub">${p.subtitle}</div>` : ""}
      <dl class="hwl-fields hwl-fold"><div><dt>${tx("Class")}</dt><dd>${p.type || "—"}</dd></div>
        <div><dt>${tx("Grade")}</dt><dd>${p.rarity || "—"}</dd></div>
        <div><dt>${tx("Maker")}</dt><dd>${p.maker || `<s class="hwl-redact">${tx("Unknown")}</s>`}</dd></div></dl>${quote(p)}</div>
    ${tail(p)}`,
  neon: p => `<div class="hwl-top">${top(p, `<span class="hwl-tag">${p.rarity}</span>`)}</div>
    <div class="hwl-sign hwl-show">${art(p)}<i class="hwl-halo hwl-fold"></i>${kicker(p)}${title(p)}
      <div class="hwl-sub">${p.subtitle || joined(p.type, p.maker)}</div>${quote(p)}</div>
    ${tail(p)}`,
  backstage: p => `<i class="hwl-dots"></i><div class="hwl-top">${top(p, `<span class="hwl-tour">${p.rarity}</span>`)}</div>
    <div class="hwl-pass hwl-show">${art(p)}<i class="hwl-strap hwl-fold"></i><i class="hwl-punch"></i><i class="hwl-slash"></i><i class="hwl-burn hwl-fold"></i>
      <div class="hwl-access">${p.badge || tx("AllAccess")}</div>${kicker(p)}${title(p)}
      <div class="hwl-sub">${p.subtitle || joined(p.maker, p.type)}</div>${quote(p)}</div>
    ${tail(p)}`,
  gilded: p => `<div class="hwl-top">${top(p, `<span class="hwl-rarity">${p.rarity}</span>`)}</div>
    <div class="hwl-picado hwl-fold">${PICADO.map(color => `<i style="--c:${color}"></i>`).join("")}</div>
    <div class="hwl-gold hwl-show">${art(p)}<i class="hwl-flower is-l">${MARIGOLD}</i><i class="hwl-flower is-r">${MARIGOLD}</i>
      ${kicker(p)}${title(p)}<div class="hwl-sub">${p.subtitle || joined(p.type, p.maker)}</div>${quote(p)}</div>
    ${tail(p)}`,
  ink: p => `<div class="hwl-top">${top(p, `<span class="hwl-rarity">${p.rarity}</span>`)}</div>
    <div class="hwl-washi hwl-show">${art(p)}<i class="hwl-enso hwl-fold">${ENSO}</i><span class="hwl-hanko">${p.badge || "悟"}</span>
      ${kicker(p)}${title(p)}<div class="hwl-sub">${p.subtitle || joined(p.maker, p.type)}</div>${quote(p)}</div>
    ${tail(p)}`,
  smartlink: p => `<div class="hwl-top">${top(p, `<span class="hwl-rarity">${p.rarity}</span>`)}</div>
    <div class="hwl-screen hwl-show">${art(p)}<div class="hwl-chat"><span class="hwl-face"><i></i><i></i><b></b></span>
      <span class="hwl-bubble">${p.badge || tx(`Smartlink.${outcome(p.tone)}`)}</span></div>
      ${kicker(p)}${title(p)}<div class="hwl-sub">${p.subtitle || joined(p.type, p.maker)}</div>${quote(p)}</div>
    ${tail(p)}`
};
export const BASE_IDS = Object.keys(BASES);

/* The signature cards --------------------------------------------------------------------------- */

/**
 * Cards hand-built for one known weapon each. They take nothing from the editor: the weapon's name, type, maker, art and
 * the card's working parts go where each one has them.
 */
const SIGNATURES = {
  // Exhibit C, a sledgehammer used in a crime: tape across the top, the scene photo with its marker and scale, the bag.
  "exhibit-c": p => `<div class="hwl-top hws-tape">${top(p, `<span class="hws-tape-text">${tx("Sig.Tape")}</span>`)}</div>
    <div class="hws-scene">
      <div class="hws-photo hwl-fold">${p.img ? `<img src="${p.img}" alt="" draggable="false">` : ""}<i class="hws-ruler"></i><i class="hws-tent">C</i><i class="hws-spatter"></i><i class="hws-flash"></i></div>
      <div class="hws-bag"><div class="hws-zip"></div><div class="hws-print"><b>${tx("Evidence")}</b><span>${tx("Sig.Case")} ${p.serial}</span></div>
        ${title(p)}<div class="hws-note">${tx("Sig.Recovered")}</div>
        <div class="hws-custody"><span>${tx("Sig.Custody")}</span>${SCRAWL}<em>${tx("Sig.Sealed")}</em></div></div>
    </div>
    ${tail(p)}`,
  // Johnny Silverhand's Malorian Arms 3516: a worn record sleeve in his name, the record sliding out.
  "malorian-3516": p => `<div class="hwl-top">${top(p, `<span class="hwl-rarity">${p.rarity}</span>`)}</div>
    <div class="hws-deck"><i class="hws-record hwl-fold"><i class="hws-label"><b>3516</b><small>${tx("Sig.Side")}</small></i></i>
      <div class="hws-sleeve"><i class="hws-ring"></i><i class="hws-burn"></i>
        <div class="hws-artist">${tx("Sig.Artist")}</div>${title(p)}<div class="hws-live">${joined(tx("Sig.Live"), p.maker)}</div>
        <span class="hws-sticker hwl-fold">${tx("Sig.Sticker")}</span></div></div>
    ${tail(p)}`,
  // Skippy, the talking smart pistol: a message thread, and it has a word on every shot.
  skippy: p => {
    const tone = outcome(p.tone);
    const lines = [t(`Sig.Skippy.${tone}`), tone === "pending" ? "" : t(`Sig.Skippy.${tone}2`)].filter(Boolean);
    return `<div class="hwl-top">${top(p, `<span class="hwl-rarity">${p.rarity}</span>`)}</div>
      <div class="hws-phone"><div class="hws-contact"><span class="hws-avatar"><i></i><i></i><b></b></span>
        <span class="hws-who">${title(p)}<small>${tx(tone === "pending" ? "Sig.Typing" : "Sig.Online")}</small></span><span class="hws-aim">${tx("Sig.Aim")}</span></div>
        <div class="hws-thread">${lines.map(line => `<div class="hws-msg">${escapeHTML(line)}</div>`).join("")}
          ${tone === "pending" ? '<div class="hws-msg hws-dots"><i></i><i></i><i></i></div>' : ""}</div>
        <div class="hws-meta">${joined(p.type, p.maker)}</div></div>
      ${tail(p)}`;
  },
  // Guts, Rebecca's shotgun: a card bombed with stickers in pink and cyan.
  guts: p => `<div class="hwl-top">${top(p, `<span class="hwl-rarity">${p.rarity}</span>`)}</div>
    <div class="hws-bomb"><i class="hws-dots"></i><span class="hws-stickers hwl-fold">${STICKERS}</span><span class="hws-bang">${tx("Sig.Bang")}</span>
      <div class="hws-tag"><small>${tx("Sig.Hello")}</small><b>${tx("Sig.Owner")}</b></div>${title(p)}
      <div class="hws-sub">${joined(p.type, p.maker)}</div></div>
    ${tail(p)}`
};
export const SIGNATURE_IDS = Object.keys(SIGNATURES);

/** The design's classes on the message (they reach the roll card below the head): "" for the plain card. */
export function rootClasses(spec) {
  if (spec?.kind === "signature") return `${ROOT} hwl-sig hwl-sig-${spec.id}`;
  if (spec?.kind === "own") return `${ROOT} hwl-${spec.own.base}`;
  return "";
}

/**
 * A legendary head from the parts of the base one (hardwipe-attacks.js): the card adds the maker, the weapon's art and
 * the serial, and a weapon's own card its own lines, art, hue and title. The head keeps the base classes so the card's
 * own behaviour (folding, outcome) carries on.
 */
export function legendaryHeadHTML(spec, parts, item) {
  const p = { ...parts, maker: escapeHTML(itemMaker(item)), img: escapeHTML(item?.img ?? ""), serial: serialOf(item?.uuid),
    kicker: "", subtitle: "", badge: "", quote: "", art: "" };
  const head = (inner, classes = [], style = []) => `<div class="hardwipe-attack-head hardwipe-weapon-head hwl-head is-${parts.tone}${classes.map(c => ` ${c}`).join("")}"`
    + `${style.length ? ` style="${style.join(";")}"` : ""}>${inner}</div>`;
  if (spec.kind === "signature") return head(SIGNATURES[spec.id](p));
  const { own } = spec;
  for (const key of ["kicker", "subtitle", "badge", "quote", "art"]) p[key] = escapeHTML(own[key]);
  const classes = [own.hue && "has-hue", own.color && "has-color", own.font && `hwl-font-${own.font}`].filter(Boolean);
  const style = [own.hue && `--l-hue:${own.hue}deg`, own.color && `--l-title:${own.color}`, own.art && `--l-art:${own.artOpacity / 100}`].filter(Boolean);
  return head(BASES[own.base](p), classes, style);
}

/* The card -------------------------------------------------------------------------------------- */

function chosenFloor() {
  return game.settings.settings.has(`${MODULE_ID}.${SETTING}`) ? game.settings.get(MODULE_ID, SETTING) : "";
}

/** Whether a weapon is rare enough for a legendary card. */
export function canWearLegend(item) {
  return item?.type === "weapon" && reachesFloor(rarityKey(item), CONFIG.DND5E.itemRarity, chosenFloor());
}

/** The card this viewer sees on a weapon's attack card, or null. */
export function legendaryDesign(item) {
  return cardDesign(item, { table: CONFIG.DND5E.itemRarity, chosen: chosenFloor(), isGM: game.user.isGM });
}

/** The GM's crown on the card's bar: it opens the weapon's card. Nothing for players or for a weapon not rare enough. */
export function legendControlHTML(item) {
  if (!game.user.isGM || !canWearLegend(item)) return "";
  const label = tx("Pick");
  return `<button type="button" class="hwl-pick" data-tooltip="${label}" aria-label="${label}"><i class="fas fa-crown" inert></i></button>`;
}

/** Mark the message with its card (or clear it). */
export function dressLegendary(element, spec) {
  element.classList.remove(ROOT, ...[...element.classList].filter(name => name.startsWith("hwl-")));
  const classes = rootClasses(spec);
  if (classes) element.classList.add(...classes.split(" "));
}

/**
 * Wire the crown. `preview(spec)` draws this weapon's head as a card (null for the plain card), for the editor.
 * @param {HTMLElement} element
 * @param {Item} item
 * @param {(spec: object|null) => string} preview
 */
export function bindLegendControl(element, item, preview) {
  element.querySelector(".hwl-pick")?.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    void editCard(item, preview);
  });
}

/** Every weapon in the world's actors and items: where a signature card can be. Unlinked tokens follow their actor. */
function worldWeapons() {
  return [...game.items, ...game.actors.contents.flatMap(actor => [...actor.items])].filter(item => item.type === "weapon");
}

/** The editor's form as a flag. */
function flagFromForm(data) {
  const mode = ["own", "signature"].includes(data.mode) ? data.mode : "default";
  return { schema: 1, mode, own: cleanOwn(data), signature: mode === "signature" && SIGNATURE_IDS.includes(data.signature) ? data.signature : null };
}

async function editCard(item, preview) {
  const flag = item.getFlag(MODULE_ID, FLAG) ?? {};
  const spec = cardSpec(flag);
  const own = cleanOwn(flag.own);
  own.base ||= BASE_IDS[0];
  const mode = spec?.kind ?? "default";
  const signature = spec?.kind === "signature" ? spec.id : "";
  const weapons = worldWeapons();
  const checked = on => on ? " checked" : "";
  const field = (key, input, hint = "") => `<div class="form-group"><label>${tx(`Field.${key}`)}</label>
    <div class="form-fields">${input}</div>${hint ? `<p class="hint">${tx(hint)}</p>` : ""}</div>`;
  const textField = key => field(key, `<input type="text" name="${key}" maxlength="${LIMITS[key]}" value="${escapeHTML(own[key])}">`);
  const signatureChoice = id => {
    const holder = heldElsewhere(weapons, id, item.uuid)[0];
    const where = holder ? escapeHTML(game.i18n.format("HARDWIPE.Legend.SignatureHeld", { weapon: holder.name, owner: holder.actor?.name ?? "—" }))
      : tx(signature === id ? "SignatureHere" : "SignatureFree");
    return `<label class="hwl-sig-choice"><input type="radio" name="signature" value="${id}"${checked(signature === id || (!signature && id === SIGNATURE_IDS[0]))}>
      <span><b>${tx(`Sig.${id}`)}</b><small>${tx(`Sig.${id}Hint`)}</small><em class="${holder ? "is-held" : ""}">${where}</em></span></label>`;
  };
  const content = `<div class="hwl-editor">
    <div class="hwl-ed-form">
      <p class="hint">${tx("PickHint")}</p>
      <div class="hwl-modes">${["default", "own", "signature"].map(key => `<label><input type="radio" name="mode" value="${key}"${checked(mode === key)}><span>${tx(`Mode.${key}`)}</span></label>`).join("")}</div>
      <p class="hwl-ed-only is-default hint">${tx("StandardHint")}</p>
      <div class="hwl-ed-only is-own"><p class="hint">${tx("OwnHint")}</p>
        ${field("base", `<select name="base">${BASE_IDS.map(id => `<option value="${id}"${own.base === id ? " selected" : ""}>${tx(`Design.${id}`)}</option>`).join("")}</select>`)}
        ${field("art", `<file-picker name="art" type="image" value="${escapeHTML(own.art)}"></file-picker>`)}
        ${field("artOpacity", `<input type="range" name="artOpacity" min="10" max="100" step="5" value="${own.artOpacity}">`)}
        ${field("hue", `<input type="range" name="hue" min="-180" max="180" step="5" value="${own.hue}">`)}
        ${field("font", `<select name="font"><option value="">${tx("Font.own")}</option>${TITLE_FONTS.map(id => `<option value="${id}"${own.font === id ? " selected" : ""}>${tx(`Font.${id}`)}</option>`).join("")}</select>`)}
        ${field("color", `<color-picker name="color" value="${own.color}"></color-picker>`, "Field.colorHint")}
        ${textField("kicker")}${textField("subtitle")}
        ${field("badge", `<input type="text" name="badge" maxlength="${LIMITS.badge}" value="${escapeHTML(own.badge)}">`, "Field.badgeHint")}
        ${field("quote", `<textarea name="quote" maxlength="${LIMITS.quote}" rows="2">${escapeHTML(own.quote)}</textarea>`)}</div>
      <div class="hwl-ed-only is-signature"><p class="hint">${tx("SignatureHint")}</p>${SIGNATURE_IDS.map(signatureChoice).join("")}</div>
    </div>
    <div class="hwl-ed-preview"><div class="hwl-ed-stage"></div></div>
  </div>`;
  const FormData = foundry.applications.ux.FormDataExtended;
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.format("HARDWIPE.Legend.PickTitle", { name: item.name }), icon: "fas fa-crown" },
    classes: ["hardwipe-dialog", "is-legend"],
    position: { width: 760 },
    content,
    rejectClose: false,
    // The preview follows the form as the GM edits it.
    render: (event, dialog) => {
      const form = dialog.element.querySelector("form");
      const stage = dialog.element.querySelector(".hwl-ed-stage");
      const draw = () => {
        const next = cardSpec(flagFromForm(new FormData(form).object));
        stage.className = `hwl-ed-stage ${rootClasses(next)}`.trim();
        stage.innerHTML = preview(next);
      };
      form.addEventListener("input", draw);
      form.addEventListener("change", draw);
      draw();
    },
    buttons: [
      { action: "apply", label: "HARDWIPE.Legend.Apply", icon: "fas fa-check", default: true, callback: (event, button) => flagFromForm(new FormData(button.form).object) },
      { action: "cancel", label: "Cancel", icon: "fas fa-xmark" }
    ]
  });
  if (!picked || typeof picked !== "object") return;
  if (picked.mode === "signature" && !picked.signature) picked.mode = "default";
  // A signature card is on one weapon at a time: applying it here takes it off any other.
  if (picked.mode === "signature") {
    for (const other of heldElsewhere(worldWeapons(), picked.signature, item.uuid)) await other.setFlag(MODULE_ID, FLAG, { schema: 1, mode: "default" });
  }
  await item.setFlag(MODULE_ID, FLAG, picked);
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
  // A new card, rarity or identification redraws that weapon's cards already in the log.
  Hooks.on("updateItem", (item, changes) => {
    if (item.type !== "weapon") return;
    const has = path => foundry.utils.hasProperty(changes, path);
    if (has(`flags.${MODULE_ID}.${FLAG}`) || has("system.rarities") || has("system.rarity") || has("system.identified")) {
      rerenderCards(message => message.getAssociatedItem?.()?.uuid === item.uuid);
    }
  });
}
