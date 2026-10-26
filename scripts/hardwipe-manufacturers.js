import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { hashSeed, seededRandom } from "./hardwipe-eye.js";
import { rerenderCards } from "./hardwipe-attack-cards.js";

/**
 * Manufacturers: an item's maker, set on its Details tab. A weapon from a known maker gets that maker's attack
 * card (the bar and wordmark, an emblem, the title's type, a serial plate); a maker without a style keeps the base
 * card with its name on the bar; an unbranded weapon keeps the base card. The outcome colours never change.
 * Makers come from Cyberpunk 2077 and Cyberpunk RED, plus the campaign's own: PALE, ???? and Maelstrom.
 */
const FLAG = "manufacturer";
const SHEET_TYPES = new Set(["weapon", "equipment", "consumable", "tool"]);
const CLASSES = ["hardwipe-branded", "hw-mfr-clean", "hw-mfr-damaged"];

/** Suggestions for the field: the styled makers first, then the rest of Night City's. */
export const MAKERS = [
  "Arasaka", "Militech", "Kang Tao", "Tsunami Defense Systems", "Budget Arms", "Malorian Arms", "Constitutional Arms",
  "Techtronika", "PALE", "????", "Maelstrom",
  "Ameritech", "Chadran Arms", "Dai Lung", "Darra Polytechnic", "Fabrique Européenne", "Federated Arms", "GunMart",
  "Midnight Arms", "Mustang Arms", "Nokota", "Nova Arms", "Rhinemetall", "Rostović", "Smith & Wesserman", "Sternmeyer",
  "Stolbovoy", "Towa Manufacturing"
];

/* Pure helpers (unit-tested) ----------------------------------------------------------------- */

const ALIASES = {
  arasaka: ["arasaka", "arasakacorporation", "arasakacorp"],
  militech: ["militech", "militecharms"],
  "kang-tao": ["kangtao"],
  tsunami: ["tsunami", "tsunamidefensesystems", "tsunamidefense", "tsunamiarms"],
  "budget-arms": ["budgetarms"],
  malorian: ["malorian", "malorianarms", "malorianfirearms"],
  constitutional: ["constitutional", "constitutionalarms", "constitutionarms"],
  techtronika: ["techtronika", "tekhtronika", "техтроника"],
  pale: ["pale"],
  maelstrom: ["maelstrom"]
};
const BY_KEY = new Map(Object.entries(ALIASES).flatMap(([slug, keys]) => keys.map(key => [key, slug])));

/** A maker's name reduced to letters and digits, accents dropped: "Kang-Tao" and "kang tao" match. */
export function makerKey(name) {
  return String(name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** The style a maker's name calls for, or "" when it has none. Only question marks is the unknown maker. */
export function brandSlug(name) {
  const text = String(name ?? "").trim();
  if (/^\?+$/.test(text)) return "unknown";
  return BY_KEY.get(makerKey(text)) ?? "";
}

/* The brands ------------------------------------------------------------------------------------- */

const KT_RETICLE = '<svg class="hwm-emblem hwm-reticle" viewBox="0 0 60 60" fill="none" stroke="#f2d27e">'
  + '<polygon points="30,4 52,17 52,43 30,56 8,43 8,17" stroke-width="1.5"/><polygon points="30,17 43,30 30,43 17,30" stroke-width="1"/>'
  + '<path d="M30 0v9M30 51v9M0 30h9M51 30h9" stroke-width="1.5"/><circle cx="30" cy="30" r="2.5" fill="#f2d27e" stroke="none"/></svg>'
  + '<i class="hwm-emblem hwm-link"></i>';
const TT_WEDGE = '<svg class="hwm-emblem hwm-wedge" viewBox="0 0 78 72"><circle cx="46" cy="32" r="24" fill="#f1e4c6"/>'
  + '<circle cx="46" cy="32" r="24" fill="none" stroke="#0f0a09" stroke-width="2"/><polygon points="0,62 62,22 50,44" fill="#c8281c"/>'
  + '<rect x="6" y="66" width="44" height="4" fill="#f1e4c6"/></svg>';
const caSeal = uid => `<svg viewBox="0 0 40 40"><defs><path id="hwm-ring-${uid}" d="M20 20 m-14 0 a14 14 0 1 1 28 0 a14 14 0 1 1 -28 0"/></defs>`
  + '<circle cx="20" cy="20" r="19" fill="#13213f" stroke="#f3ead8" stroke-width="1"/><circle cx="20" cy="20" r="10" fill="none" stroke="#c8323a" stroke-width="1"/>'
  + `<text fill="#f3ead8" font-size="5.2" font-weight="700" letter-spacing="0.6"><textPath href="#hwm-ring-${uid}">CONSTITUTIONAL · ARMS · NUSA ·</textPath></text>`
  + '<text x="20" y="23.5" text-anchor="middle" fill="#c8323a" font-size="10">★</text></svg>';
const MAELSTROM = '<svg class="hwm-emblem hwm-optics" viewBox="0 0 70 50"><path d="M4 8 L60 2 L68 14 L64 44 L10 48 L2 30 Z" fill="#141416" stroke="#3a3a40"/>'
  + '<g fill="#ff1e2d" style="filter: drop-shadow(0 0 3px #ff1e2d)"><circle cx="20" cy="18" r="5"/><circle cx="36" cy="16" r="4"/><circle cx="50" cy="20" r="5.5"/>'
  + '<circle cx="24" cy="33" r="3"/><circle cx="40" cy="31" r="3.5"/><circle cx="53" cy="35" r="2.5"/></g>'
  + '<g fill="#fff" opacity=".75"><circle cx="18.5" cy="16.5" r="1.2"/><circle cx="48.5" cy="18.5" r="1.4"/></g></svg>'
  + '<i class="hwm-emblem hwm-bolts"></i>'
  + '<svg class="hwm-emblem hwm-tag" viewBox="0 0 90 40" fill="none" stroke="#ff1e2d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M6 34 L12 8 L24 26 L34 6 L40 33"/><path d="M50 30 C58 10, 70 10, 66 22 S 78 36, 86 18"/>'
  + '<circle cx="46" cy="37" r="1.5" fill="#ff1e2d" stroke="none"/><circle cx="18" cy="38" r="1" fill="#ff1e2d" stroke="none"/></svg>';
const PALE_DAMAGE = '<svg class="hwm-emblem hwm-scratch" viewBox="0 0 280 240" preserveAspectRatio="none" fill="none">'
  + '<path d="M14 52 L92 18" stroke="#eafff1" stroke-width="0.6" opacity="0.28"/><path d="M15 53 L93 19" stroke="#000" stroke-width="0.6" opacity="0.5"/>'
  + '<path d="M30 70 L58 58" stroke="#eafff1" stroke-width="0.5" opacity="0.22"/>'
  + '<path d="M196 214 L268 176" stroke="#eafff1" stroke-width="0.6" opacity="0.25"/><path d="M197 215 L269 177" stroke="#000" stroke-width="0.6" opacity="0.45"/></svg>'
  + '<i class="hwm-emblem hwm-deadrow"></i><i class="hwm-emblem hwm-dead" style="left:9px;top:118px"></i>';

/**
 * What each style adds to the card: the wordmark on the bar, the emblems behind the head, the serial plate under it,
 * something under the bar or at its end. `clean` drops the title's chromatic glitch; `damaged` chips the card.
 */
const BRANDS = {
  arasaka: { mark: "ARASAKA", emblems: () => '<div class="hwm-emblem hwm-sun"><span>荒坂</span></div>', plate: "Security division · NC-07", clean: true },
  militech: { mark: "MILITECH", emblems: () => '<i class="hwm-emblem hwm-rivets"></i>', plate: "<span><b>NSN</b>1005-01-4577</span><span><b>LOT</b>77-A</span>", clean: true },
  "kang-tao": { mark: "KANG TAO", emblems: () => KT_RETICLE, plate: "Smart-link ready · gyrojet", clean: true },
  tsunami: { mark: "TSUNAMI", emblems: () => '<div class="hwm-emblem hwm-seal">津波</div><i class="hwm-emblem hwm-waves"></i>',
    plate: "Osaka · tolerance ±0.01 mm", clean: true, afterBar: '<i class="hwm-ruler"></i>' },
  "budget-arms": { mark: "BUDGET ARMS<small>NEW!</small>",
    emblems: () => '<div class="hwm-emblem hwm-burst">VALUE!</div><div class="hwm-emblem hwm-tag">€$ 99<sup>.99</sup></div>',
    plate: "<span>⚠ Aim away from face</span><i></i>", clean: true },
  malorian: { mark: "MALORIAN ARMS",
    emblems: () => '<i class="hwm-emblem hwm-corners"></i><div class="hwm-emblem hwm-cartouche"><div>M·A<small>N.C.</small></div></div>',
    plate: "Hand-fitted · Night City", clean: true },
  constitutional: { mark: "CONSTITUTIONAL", emblems: () => '<i class="hwm-emblem hwm-flag"></i>', plate: uid => `${caSeal(uid)}Made in the NUSA`, clean: true },
  techtronika: { mark: "ТЕХТРОНИКА", emblems: () => TT_WEDGE, plate: "<b>ЗАВОД № 7</b> · arms & robotics", clean: true },
  pale: { mark: "PALE<small>[unsigned]</small>", emblems: uid => paleCircuits(uid) + PALE_DAMAGE, plate: "Every channel · <b>let us through</b>",
    clean: true, damaged: true },
  unknown: { mark: "????<small>no signature</small>", emblems: () => '<i class="hwm-emblem hwm-static"></i><i class="hwm-emblem hwm-dark"></i>',
    plate: "Signal 12% · <b>retry</b> <i></i>", clean: true, barEnd: '<i class="hwm-battery"></i>' },
  maelstrom: { mark: "MAELSTROM", emblems: () => MAELSTROM, plate: "Maelstrom-made · no warranty", clean: true }
};
export const STYLED = Object.keys(BRANDS);

/* PALE: a crowd of circuit hands forcing in through breaches on every edge, the traces dropping out and wobbling,
 * slices of the picture tearing sideways. Generated from the card's id, so every client draws the same one. */

/** One circuit hand in local coordinates: the wrist enters at (0, 0) from the right and the fingers reach left. */
export function circuitHand() {
  const fingers = [[[-156, -69], 3], [[-182, -43], 3], [[-190, -13], 3], [[-176, 17], 3], [[-124, 55], 2]];
  const palmX = -66, palmTop = -25, pitch = 4.2;
  const traces = [], vias = [], tips = [];
  let row = 0;
  for (const [[tx, ty], count] of fingers) {
    for (let k = 0; k < count; k++) {
      const sy = palmTop + row * pitch;
      const ey = ty + (k - (count - 1) / 2) * pitch;
      row++;
      // Left along the palm row, a 45° run to the finger's height, then on to the tip.
      const bend = palmX - 14 - (traces.length % 3) * 2;
      const points = [[palmX, sy], [bend, sy], [bend - Math.abs(ey - sy), ey], [tx + (count - 1 - k) * 1.5, ey]];
      traces.push(points);
      vias.push(points[1]);
    }
    tips.push([tx - 4, ty]);
  }
  const bus = Array.from({ length: row }, (_, i) => [[4, palmTop + i * pitch], [palmX, palmTop + i * pitch]]);
  return { traces, bus, vias, tips };
}

const HANDS = [[284, 112, 0, 0.82, 1, true], [226, -6, -90, 0.5, 0.7, false], [182, 222, 90, 0.46, 0.6, false],
  [284, 186, 14, 0.4, 0.48, false], [284, 34, -18, 0.36, 0.42, false], [-4, 150, 180, 0.36, 0.4, false], [120, -6, -70, 0.3, 0.33, false]];

function paleCircuits(uid) {
  const random = seededRandom(hashSeed(`pale-${uid}`));
  const int = (min, max) => min + Math.floor(random() * (max - min + 1));
  const range = (min, max) => (min + random() * (max - min)).toFixed(1);
  const { traces, bus, vias, tips } = circuitHand();
  const d = points => "M" + points.map(([x, y]) => `${+x.toFixed(1)} ${+y.toFixed(1)}`).join(" L");
  const pads = vias.map(([x, y]) => `<circle cx="${+x.toFixed(1)}" cy="${+y.toFixed(1)}" r="1.2"/>`).join("");
  const tipsSVG = tips.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#05110a" stroke="#eafff1" stroke-width="1.1"/><circle cx="${x}" cy="${y}" r="2.2" fill="#ff2d55"/>`).join("");
  const pulses = traces.map((points, i) => `<path class="hwm-pulse" style="animation-delay:${(-i * 0.37).toFixed(2)}s" d="${d([...points].reverse())}"/>`).join("");
  const hand = pulse => {
    // Each copy of the hand drops out in its own places.
    const lines = [...traces, ...bus].map(points => `<path stroke-dasharray="${int(8, 34)} ${range(1.5, 4)} ${int(4, 22)} ${range(1, 3)}" d="${d(points)}"/>`).join("");
    return `<g stroke="#c4f3d0" stroke-width="1" stroke-linejoin="round" opacity="0.8">${lines}</g>`
      + (pulse ? `<g stroke="#f6fff9" stroke-width="1.3" stroke-linecap="round" opacity="0.7">${pulses}</g>` : "")
      + `<g fill="#eafff1" opacity="0.8">${pads}</g>${tipsSVG}`;
  };
  let breaches = "", far = "", near = "";
  HANDS.forEach(([x, y, rot, scale, opacity, pulse], i) => {
    const move = `translate(${x} ${y}) rotate(${rot}) scale(${scale})`;
    const body = hand(pulse);
    breaches += `<ellipse cx="${x}" cy="${y}" rx="${Math.round(30 * scale)}" ry="${Math.round(58 * scale)}" transform="rotate(${rot} ${x} ${y})" fill="url(#pe-breach-${uid})" opacity="${opacity}"/>`;
    if (i === 0) {
      // The near hand doesn't hold its colour: a red and a cyan copy slip off it.
      near = `<g transform="translate(1.8 0) ${move}" opacity="0.38" filter="url(#pe-red-${uid})">${body}</g>`
        + `<g transform="translate(-1.4 0.6) ${move}" opacity="0.28" filter="url(#pe-cyan-${uid})">${body}</g>`
        + `<g transform="${move}" opacity="${opacity}">${body}</g>`;
    } else far += `<g transform="${move}" opacity="${opacity}">${body}</g>`;
  });
  const band = (y, h, dx) => `<svg x="0" y="${y}" width="282" height="${h}" viewBox="0 ${y} 282 ${h}" overflow="hidden">`
    + `<rect x="0" y="${y}" width="282" height="${h}" fill="#060d09"/><use href="#pe-all-${uid}" transform="translate(${dx} 0)"/></svg>`;
  return `<svg class="hwm-emblem hwm-circuit" viewBox="0 0 282 214" style="right:0;top:4px;width:282px;height:214px" fill="none" aria-hidden="true">`
    + `<defs><filter id="pe-wob-${uid}" x="-10%" y="-10%" width="120%" height="120%">`
    + `<feTurbulence type="fractalNoise" baseFrequency="0.05 0.018" numOctaves="2" seed="7" result="n"/>`
    + `<feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" result="d"/>`
    + `<feGaussianBlur in="d" stdDeviation="1.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="d"/></feMerge></filter>`
    + `<filter id="pe-red-${uid}"><feColorMatrix values="0 0 0 0 1  0 0 0 0 0.18  0 0 0 0 0.33  0 0 0 1 0"/></filter>`
    + `<filter id="pe-cyan-${uid}"><feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.95  0 0 0 0 0.9  0 0 0 1 0"/></filter>`
    + `<radialGradient id="pe-breach-${uid}"><stop offset="0" stop-color="#ffffff" stop-opacity="0.8"/><stop offset="1" stop-color="#c4f3d0" stop-opacity="0"/></radialGradient></defs>`
    + `<g id="pe-all-${uid}" filter="url(#pe-wob-${uid})">${breaches}${far}${near}</g>`
    + band(70, 7, 9) + band(150, 5, -7) + band(34, 3, 5) + "</svg>";
}

/* The card ------------------------------------------------------------------------------------------ */

/** The maker set on an item, trimmed. */
export function itemMaker(item) {
  return String(item?.getFlag?.(MODULE_ID, FLAG) ?? item?.flags?.[MODULE_ID]?.[FLAG] ?? "").trim();
}

/**
 * Brand a weapon attack card after its head is drawn: the maker's style, the plain name for a maker without one,
 * nothing for an unbranded weapon. Safe to run on every render.
 * @param {HTMLElement} element  The message element.
 * @param {string} maker
 * @param {string} uid           Something unique to the card (its message id), for the SVG ids.
 */
export function brandCard(element, maker, uid) {
  element.classList.remove(...CLASSES, ...[...element.classList].filter(name => name.startsWith("hw-mfr-")));
  const head = element.querySelector(".hardwipe-attack-head");
  const bar = head?.querySelector(".hardwipe-attack-namebar");
  if (!head || !bar || !maker) return;
  const slug = brandSlug(maker);
  const brand = BRANDS[slug];
  if (!brand) {
    bar.insertAdjacentHTML("afterbegin", `<span class="hwm-mark is-plain" data-tooltip="${escapeHTML(maker)}">${escapeHTML(maker)}</span>`);
    return;
  }
  const id = String(uid ?? "x").replace(/[^A-Za-z0-9]/g, "");
  element.classList.add("hardwipe-branded", `hw-mfr-${slug}`);
  if (brand.clean) element.classList.add("hw-mfr-clean");
  if (brand.damaged) element.classList.add("hw-mfr-damaged");
  bar.insertAdjacentHTML("afterbegin", `<span class="hwm-mark" aria-label="${escapeHTML(maker)}">${brand.mark}</span>`);
  if (brand.barEnd) bar.insertAdjacentHTML("beforeend", brand.barEnd);
  if (brand.afterBar) bar.insertAdjacentHTML("afterend", brand.afterBar);
  head.insertAdjacentHTML("afterbegin", brand.emblems(id));
  const plate = typeof brand.plate === "function" ? brand.plate(id) : brand.plate;
  head.insertAdjacentHTML("beforeend", `<div class="hwm-plate">${plate}</div>`);
}

/* The sheet -------------------------------------------------------------------------------------------- */

const t = key => game.i18n.localize(`HARDWIPE.Mfr.${key}`);

function sheetField(app, html) {
  const item = app.document;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!item || !SHEET_TYPES.has(item.type) || !root) return;
  const tab = root.querySelector('.tab[data-tab="details"]');
  if (!tab || tab.querySelector(".hardwipe-manufacturer")) return;
  const list = `hardwipe-mfr-${app.id}`;
  tab.insertAdjacentHTML("afterbegin", `<fieldset class="hardwipe-manufacturer">
    <legend>${escapeHTML(t("Legend"))}</legend>
    <div class="form-group"><label>${escapeHTML(t("Label"))}</label>
      <div class="form-fields"><input type="text" name="flags.${MODULE_ID}.${FLAG}" value="${escapeHTML(itemMaker(item))}" list="${list}"
        placeholder="${escapeHTML(t("Placeholder"))}" ${app.isEditable ? "" : "disabled"}></div>
      <p class="hint">${escapeHTML(t("Hint"))}</p></div>
    <datalist id="${list}">${MAKERS.map(name => `<option value="${escapeHTML(name)}"></option>`).join("")}</datalist>
  </fieldset>`);
}

export function registerManufacturers() {
  Hooks.on("renderItemSheet5e", sheetField);
  // A new maker redraws that weapon's cards already in the log.
  Hooks.on("updateItem", (item, changes) => {
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAG}`)) rerenderCards(message => message.getAssociatedItem?.()?.uuid === item.uuid);
  });
}
