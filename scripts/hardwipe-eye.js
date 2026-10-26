import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";

/**
 * The Eye: the AIs behind the Blackwall want through, and sometimes they look back. A GM tool posts a card from
 * no sender at a chosen character. It comes in variants, each its own way of being watched (a swarm of eyes, a
 * wall of them, one close enough to see yourself in, eyes in the dark, an eye at a crack, every camera, a halo,
 * the words spelled in eyes, eyes waking), with what they say and whom they see. Everything is laid out from the
 * message's own id, so every client draws the same card. Motion stops for anyone with reduced motion turned on.
 */
const FLAG = "eye";
const FIELD = { width: 300, height: 220 };
const FRESH_MS = 6000;
export const VARIANTS = ["swarm", "wall", "closeup", "dark", "crack", "feeds", "halo", "letters", "waking"];

/* Pure helpers (unit-tested) ----------------------------------------------------------------- */

/** A 32-bit seed from text (FNV-1a). */
export function hashSeed(text) {
  let hash = 2166136261;
  for (const char of String(text ?? "")) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return hash >>> 0;
}

/** A small seeded random source (mulberry32): the same seed gives the same sequence everywhere. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Which variant a card shows: the GM's pick, or one chosen from the message's seed. */
export function variantFor(chosen, seed) {
  return VARIANTS.includes(chosen) ? chosen : VARIANTS[seed % VARIANTS.length];
}

function motion(random) {
  const pick = list => list[Math.floor(random() * list.length)];
  const range = (min, max) => Number((min + random() * (max - min)).toFixed(1));
  return { blink: range(5, 11), blinkDelay: range(-10, 0), look: range(6, 13), lookDelay: range(-12, 0), lx: pick([-7, -5, 5, 7]), ly: pick([-2, 0, 2]) };
}

/**
 * Scattered eyes that don't overlap, optionally around one huge eye.
 * @returns {Array<{x: number, y: number, w: number, rot: number, red: boolean, lid: number, main?: boolean}>}
 */
export function eyeLayout(seed, { width = FIELD.width, height = FIELD.height, count = 30, main = true, sizes } = {}) {
  const random = seededRandom(seed);
  const pick = list => list[Math.floor(random() * list.length)];
  const range = (min, max) => min + random() * (max - min);
  const eyes = [];
  const boxes = [];
  if (main) {
    const w = 156;
    eyes.push({ x: Math.round((width - w) / 2), y: 22, w, rot: 0, red: true, lid: 0, main: true, ...motion(random) });
    boxes.push([eyes[0].x, 22, w, w * 0.6]);
  }
  const widths = sizes ?? [12, 14, 16, 18, 20, 24, 28, 32, 38, 44, 52, 62];
  for (let attempts = 0; eyes.length < count + (main ? 1 : 0) && attempts < 6000; attempts++) {
    const w = pick(widths);
    const h = w * 0.6;
    const x = range(-8, width - w + 8);
    const y = range(-6, height - h);
    if (boxes.some(([bx, by, bw, bh]) => x < bx + bw + 2 && x + w + 2 > bx && y < by + bh + 2 && y + h + 2 > by)) continue;
    boxes.push([x, y, w, h]);
    eyes.push({ x: Math.round(x), y: Math.round(y), w, rot: Math.round(range(-28, 28)), red: random() < 0.3,
      lid: random() < 0.35 ? Number(range(0.38, 0.62).toFixed(2)) : 0, ...motion(random) });
  }
  return eyes;
}

/** The big line, with the first O opened into an eye ("WE SEE Y·U"). */
export function lineParts(line) {
  const text = String(line ?? "");
  const index = text.search(/o/i);
  return index < 0 ? { before: text, after: "", eye: false } : { before: text.slice(0, index), after: text.slice(index + 1), eye: true };
}

/* A 5×7 dot font for the Letters variant: each row is five bits, left to right. */
const FONT = {
  A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110", C: "01110 10001 10000 10000 10000 10001 01110",
  D: "11110 10001 10001 10001 10001 10001 11110", E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001", I: "01110 00100 00100 00100 00100 00100 01110",
  J: "00111 00010 00010 00010 00010 10010 01100", K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 10001 11001 10101 10011 10001 10001", O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000", Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100", U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100", W: "10001 10001 10001 10101 10101 10101 01010", X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111", "?": "01110 10001 00001 00010 00100 00000 00100",
  "!": "00100 00100 00100 00100 00100 00000 00100", ".": "00000 00000 00000 00000 00000 00000 00100", " ": "00000 00000 00000 00000 00000 00000 00000"
};

/**
 * The line as rows of dot-font cells: words wrapped to at most `perRow` characters (a longer word gets its own
 * row), every lit dot a {col, row} in one grid.
 */
export function dotMatrix(line, perRow = 9) {
  const words = String(line ?? "").toUpperCase().replace(/[^A-Z?!. ]/g, " ").split(/\s+/).filter(Boolean);
  const rows = [];
  for (const word of words) {
    const last = rows.at(-1);
    if (last && last.length + 1 + word.length <= perRow) rows[rows.length - 1] = `${last} ${word}`;
    else rows.push(word);
  }
  const width = Math.max(1, ...rows.map(row => row.length)) * 6 - 1;
  const dots = [];
  rows.forEach((row, r) => {
    const offset = Math.floor((width - (row.length * 6 - 1)) / 2);
    [...row].forEach((char, c) => {
      const bits = (FONT[char] ?? FONT[" "]).split(" ");
      bits.forEach((bitsRow, y) => [...bitsRow].forEach((bit, x) => {
        if (bit === "1") dots.push({ col: offset + c * 6 + x, row: r * 8 + y });
      }));
    });
  });
  return { cols: width, rows: Math.max(1, rows.length * 8 - 1), dots };
}

/* Drawing ------------------------------------------------------------------------------------------ */

const t = (key, data) => data ? game.i18n.format(`HARDWIPE.Eye.${key}`, data) : game.i18n.localize(`HARDWIPE.Eye.${key}`);
const ALMOND = "M2 30 Q50 -6 98 30 Q50 66 2 30 Z";
const pct = (value, of) => `${(value / of * 100).toFixed(2)}%`;

/** One eye in a 100×60 box: an almond, an iris (red or pale) with a slit and a glint, an optional heavy lid. */
function eyeSVG(uid, index, { red = false, lid = 0, img = "" } = {}) {
  const iris = `url(#ec-${red ? "red" : "pale"}-${uid})`;
  const lidPath = lid ? `<path class="ec-lid" d="M2 30 Q50 -6 98 30 L98 ${Math.round(lid * 60)} Q50 ${Math.round(lid * 60 - 10)} 2 ${Math.round(lid * 60)} Z"/>` : "";
  // In a close-up, the one looking back is reflected in the pupil.
  const reflection = img ? `<clipPath id="ec-p${index}-${uid}"><ellipse cx="50" cy="30" rx="5.5" ry="15"/></clipPath>`
    + `<image href="${escapeHTML(img)}" x="40" y="14" width="20" height="32" preserveAspectRatio="xMidYMid slice" clip-path="url(#ec-p${index}-${uid})" opacity="0.55"/>` : "";
  return `<svg viewBox="0 0 100 60"><defs><clipPath id="ec-c${index}-${uid}"><path d="${ALMOND}"/></clipPath></defs><path class="ec-white" d="${ALMOND}"/>`
    + `<g clip-path="url(#ec-c${index}-${uid})"><g class="ec-iris"><circle cx="50" cy="30" r="19" fill="${iris}"/>`
    + `<circle cx="50" cy="30" r="13.5" fill="none" stroke="${red ? "#ffb3c2" : "#0b2a17"}" stroke-width="0.6" stroke-dasharray="1 2.5" opacity="0.8"/>`
    + `<path d="M50 13 Q54.5 30 50 47 Q45.5 30 50 13 Z" fill="${red ? "#000" : "#020403"}"/>${reflection}<circle cx="44" cy="24" r="2.4" fill="#fff" opacity="0.85"/></g>`
    + `${lidPath}</g><path d="M0 30h3M97 30h3" stroke="#c4f3d0" stroke-width="1"/></svg>`;
}

function motionStyle(eye, index) {
  return `--r:${eye.rot ?? 0}deg;--bd:${eye.blink}s;--bdl:${eye.blinkDelay}s;--ld:${eye.look}s;--ldl:${eye.lookDelay}s;--lx:${eye.lx}px;--ly:${eye.ly}px;--open:${(index * 0.045).toFixed(3)}s`;
}

function placed(eye, index, uid, extra = "") {
  return `<span class="ec-eye${eye.main ? " is-main" : ""}" style="left:${pct(eye.x, FIELD.width)};top:${eye.y}px;width:${eye.w}px;${motionStyle(eye, index)}${extra}">${eyeSVG(uid, index, eye)}</span>`;
}

const FIELDS = {
  /** One huge eye, dozens around it. */
  swarm: (seed, uid) => eyeLayout(seed).map((eye, i) => placed(eye, i, uid)).join(""),

  /** A wall of eyes in rows, blinking in a wave from the middle and looking as one. */
  wall(seed, uid) {
    const random = seededRandom(seed);
    const cols = 9, rows = 7, w = 28;
    const red = Math.floor(random() * cols * rows);
    let html = "";
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = 6 + c * 32.5 + (r % 2 ? 16 : 0) - 8, y = 4 + r * 30;
      const distance = Math.hypot(c - cols / 2, r - rows / 2);
      const eye = { x, y, w, rot: 0, red: i === red, lid: 0, blink: 7, blinkDelay: Number((-(distance * 0.12)).toFixed(2)), look: 8, lookDelay: 0, lx: 6, ly: 0 };
      html += placed(eye, i, uid);
    }
    return html;
  },

  /** One eye, close enough to see yourself in it; code circles the iris. */
  closeup(seed, uid, data) {
    const ring = `<svg class="ec-ring" viewBox="0 0 200 200" aria-hidden="true"><defs><path id="ec-ring-${uid}" d="M100 100 m-84 0 a84 84 0 1 1 168 0 a84 84 0 1 1 -168 0"/></defs>`
      + `<text><textPath href="#ec-ring-${uid}">${escapeHTML(`${t("Crawl")} · 7F A3 0E C4 · `.repeat(5))}</textPath></text></svg>`;
    return ring + `<span class="ec-eye is-main is-close" style="${motionStyle({ blink: 9, blinkDelay: -3, look: 11, lookDelay: -2, lx: 4, ly: 1 }, 0)}">${eyeSVG(uid, 0, { red: true, img: data.img })}</span>`;
  },

  /** The dark, and pairs of slits at different depths. */
  dark(seed, uid) {
    const random = seededRandom(seed);
    let html = "";
    for (let i = 0; i < 16; i++) {
      const depth = random();
      const w = Math.round(10 + depth * 30), x = Math.round(random() * (FIELD.width - w * 2.4)), y = Math.round(random() * (FIELD.height - 20));
      const red = random() < 0.45;
      html += `<span class="ec-pair${red ? " is-red" : ""}" style="left:${pct(x, FIELD.width)};top:${y}px;--w:${w}px;--depth:${depth.toFixed(2)};${motionStyle({ blink: Number((4 + random() * 8).toFixed(1)), blinkDelay: Number((-random() * 9).toFixed(1)), look: 9, lookDelay: 0, lx: 0, ly: 0 }, i)}">`
        + "<i></i><i></i></span>";
    }
    return html;
  },

  /** A crack in the wall, and an enormous eye pressed to the other side. */
  crack(seed, uid) {
    return `<div class="ec-crackglow"><div class="ec-crack"><span class="ec-eye is-main is-behind" style="${motionStyle({ blink: 12, blinkDelay: -5, look: 7, lookDelay: -1, lx: 3, ly: 0 }, 0)}">${eyeSVG(uid, 0, { red: true })}</span></div></div>`;
  },

  /** Every camera: eight feeds of eyes and one of the subject. */
  feeds(seed, uid, data) {
    const random = seededRandom(seed);
    let html = "";
    for (let i = 0; i < 9; i++) {
      const cam = String(i + 1).padStart(2, "0");
      const subject = i === 4;
      const inner = subject && data.img
        ? `<img src="${escapeHTML(data.img)}" alt=""><b class="ec-mark"></b><em>${escapeHTML(t("Subject"))}</em>`
        : `<span class="ec-eye" style="left:${10 + Math.round(random() * 20)}%;top:${10 + Math.round(random() * 22)}%;width:${55 + Math.round(random() * 35)}%;${motionStyle({ rot: Math.round(random() * 40 - 20), ...motion(random) }, i)}">${eyeSVG(uid, i, { red: random() < 0.25, lid: random() < 0.3 ? 0.5 : 0 })}</span>`;
      html += `<div class="ec-feed${subject ? " is-subject" : ""}"><small><i></i>CAM ${cam}</small>${inner}</div>`;
    }
    return html;
  },

  /** A halo: the subject ringed by eyes, the rings turning against each other. */
  halo(seed, uid, data) {
    const random = seededRandom(seed);
    const rings = [[48, 8, true], [74, 12, false], [100, 16, false]];
    let html = data.img ? `<span class="ec-face"><img src="${escapeHTML(data.img)}" alt=""></span>` : `<span class="ec-face is-empty"></span>`;
    let index = 0;
    rings.forEach(([radius, count, red], r) => {
      let ring = "";
      for (let k = 0; k < count; k++) {
        const angle = (k / count) * 360;
        const w = 22 + r * 5;
        ring += `<span class="ec-eye" style="--a:${angle}deg;--rad:${radius}px;width:${w}px;${motionStyle({ rot: 0, ...motion(random) }, index)}">${eyeSVG(uid, index, { red: red || random() < 0.12 })}</span>`;
        index++;
      }
      html += `<div class="ec-orbit is-${r}">${ring}</div>`;
    });
    return html;
  },

  /** The words themselves, spelled in eyes. */
  letters(seed, uid, data) {
    const matrix = dotMatrix(data.line, 6);
    const random = seededRandom(seed);
    const lit = matrix.dots.map(({ col, row }, i) => {
      const style = `left:${pct(col + 0.5, matrix.cols)};top:${pct(row + 0.5, matrix.rows)};width:${pct(0.92, matrix.cols)};${motionStyle({ ...motion(random) }, i)}`;
      return `<span class="ec-dot${random() < 0.18 ? " is-red" : ""}" style="${style}"><i></i></span>`;
    }).join("");
    return `<div class="ec-matrix" style="aspect-ratio:${matrix.cols} / ${matrix.rows}">${lit}</div>`;
  },

  /** Closed eyes everywhere, a few half open, three awake. */
  waking(seed, uid) {
    const eyes = eyeLayout(seed, { count: 34, main: false, sizes: [16, 20, 24, 28, 32, 38, 44, 52] });
    const random = seededRandom(seed ^ 0x5bd1e995);
    const awake = new Set();
    while (awake.size < Math.min(3, eyes.length)) awake.add(Math.floor(random() * eyes.length));
    return eyes.map((eye, i) => {
      if (awake.has(i)) return placed({ ...eye, red: true, lid: 0 }, i, uid, ";--wake:1");
      const half = random() < 0.22;
      if (half) return placed({ ...eye, lid: 0.55 }, i, uid);
      return `<span class="ec-shut" style="left:${pct(eye.x, FIELD.width)};top:${eye.y}px;width:${eye.w}px;--r:${eye.rot}deg"><svg viewBox="0 0 100 60">`
        + `<path d="M4 30 Q50 52 96 30" stroke="#c4f3d0" stroke-width="3" fill="none"/>`
        + `<path d="M22 40 L18 50 M38 45 L36 56 M50 46 L50 57 M62 45 L64 56 M78 40 L82 50" stroke="#c4f3d0" stroke-width="2"/></svg></span>`;
    }).join("");
  }
};

function defsHTML(uid) {
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>`
    + `<radialGradient id="ec-red-${uid}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ff6a85"/><stop offset="0.45" stop-color="#c8102e"/><stop offset="1" stop-color="#2a0008"/></radialGradient>`
    + `<radialGradient id="ec-pale-${uid}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#f2fff6"/><stop offset="0.5" stop-color="#9fe6b8"/><stop offset="1" stop-color="#1d4a2c"/></radialGradient>`
    + `</defs></svg>`;
}

const AVATAR = `<svg class="hardwipe-eye-avatar" viewBox="0 0 100 100" aria-hidden="true"><path d="M8 50 Q50 14 92 50 Q50 86 8 50 Z" fill="#050b07" stroke="#c4f3d0" stroke-width="4"/>`
  + `<circle cx="50" cy="50" r="17" fill="#c8102e"/><path d="M50 35 Q54 50 50 65 Q46 50 50 35 Z" fill="#000"/></svg>`;

/** The whole card, from the message's data and id. */
export function eyeCardHTML(message, data) {
  const uid = String(message.id ?? "x").replace(/[^A-Za-z0-9]/g, "");
  const seed = hashSeed(message.id);
  const variant = variantFor(data.variant, seed);
  const line = data.line || t(`Lines.${variant}`);
  const parts = lineParts(line);
  // The O as an eye: a round letter-weight ring, a red iris and a slit pupil, the height of the capitals.
  const bigO = `<svg class="ec-o" viewBox="0 0 40 50" aria-hidden="true"><ellipse cx="20" cy="25" rx="15.5" ry="20.5" fill="#050b07" stroke="#f2fff6" stroke-width="7"/>`
    + `<circle cx="20" cy="25" r="9.5" fill="url(#ec-red-${uid})"/><path d="M20 15 Q22.6 25 20 35 Q17.4 25 20 15 Z" fill="#000"/><circle cx="16.5" cy="20.5" r="1.8" fill="#fff" opacity="0.85"/></svg>`;
  const where = [data.name, data.scene, data.round ? t("Round", { round: data.round }) : ""].filter(Boolean).map(escapeHTML).join(" · ");
  const crawl = Array.from({ length: 8 }, (_, i) => i % 2 ? `<b>${escapeHTML(t("Crawl"))}</b>` : escapeHTML(t("Crawl"))).join(" · ");
  const field = FIELDS[variant](seed, uid, { ...data, line });
  // The Letters variant spells the line in eyes; the others say it underneath.
  const big = variant === "letters" ? "" : `<strong>${escapeHTML(parts.before)}${parts.eye ? bigO : ""}${escapeHTML(parts.after)}</strong>`;
  return `${defsHTML(uid)}<div class="hw-eyecard is-${variant}">`
    + `<div class="ec-top"><i></i>${escapeHTML(t("Incoming"))}<span>${escapeHTML(t("Channel"))}</span></div>`
    + `<div class="ec-field">${field}</div>`
    + `<div class="ec-text"><small>${escapeHTML(t("Refused"))} · <b>${escapeHTML(t("Accepted"))}</b></small>${big}${where ? `<span>${where}</span>` : ""}</div>`
    + `<div class="ec-foot"><span>${crawl} · ${crawl} · </span></div></div>`;
}

/** Draw an Eye message: the card, a sender with no name, an eye for a face. */
export function renderEyeMessage(message, html) {
  const data = message.flags?.[MODULE_ID]?.[FLAG];
  const element = html?.querySelector ? html : html?.[0];
  if (!data || !element) return;
  element.classList.add("hardwipe-eye-message");
  element.classList.toggle("is-fresh", Date.now() - (message.timestamp ?? 0) < FRESH_MS);
  eyeHeader(message, element);
  const content = element.querySelector(".message-content");
  if (content) content.innerHTML = eyeCardHTML(message, data);
}

/**
 * The sender: no name, an eye for a face. Run again after D&D5e's own pass, where the shared portrait patch gives
 * compact cards a default portrait and the author's name.
 */
function eyeHeader(message, html) {
  const element = html?.querySelector ? html : html?.[0];
  if (!message.flags?.[MODULE_ID]?.[FLAG] || !element) return;
  const sender = element.querySelector(".message-header .message-sender");
  if (!sender) return;
  const doc = element.ownerDocument;
  const avatar = doc.createElement("span");
  avatar.className = "avatar";
  avatar.innerHTML = AVATAR;
  const names = doc.createElement("span");
  names.className = "name-stacked";
  // A private card still says whom it went to.
  const to = (message.whisper ?? []).map(id => game.users.get(id)?.name).filter(Boolean);
  const subtitle = to.length ? t("NoSourceTo", { names: to.join(", ") }) : t("NoSource");
  names.innerHTML = `<span class="title">${escapeHTML(t("Sender"))}</span><span class="subtitle">${escapeHTML(subtitle)}</span>`;
  sender.replaceChildren(avatar, names);
}

/* Posting ------------------------------------------------------------------------------------------ */

/**
 * Post the Eye at a character. GM only.
 * @param {Actor|null} actor
 * @param {{ line?: string, variant?: string, onlyThem?: boolean }} [options]
 */
export async function postEye(actor, { line = "", variant = "", onlyThem = false } = {}) {
  if (!game.user.isGM) return null;
  const said = String(line ?? "").trim().toUpperCase();
  const round = game.combat?.started ? game.combat.round : null;
  const gms = game.users.filter(user => user.isGM).map(user => user.id);
  const owners = actor ? game.users.filter(user => !user.isGM && actor.testUserPermission(user, "OWNER")).map(user => user.id) : [];
  return ChatMessage.implementation.create({
    speaker: { alias: t("Sender") },
    content: `<p>${escapeHTML(said || t("Lines.swarm"))}${actor ? ` · ${escapeHTML(actor.name)}` : ""}</p>`,
    whisper: onlyThem && owners.length ? [...new Set([...owners, ...gms])] : [],
    flags: { [MODULE_ID]: { [FLAG]: { variant: VARIANTS.includes(variant) ? variant : "", actorId: actor?.id ?? null, name: actor?.name ?? "",
      img: actor?.img ?? "", line: said, scene: canvas?.scene?.name ?? "", round } } }
  });
}

/** The GM's window: whom it sees, how, what it says, who gets the message. */
export async function openEye() {
  if (!game.user.isGM) return;
  const characters = game.actors.filter(actor => actor.type === "character" && actor.hasPlayerOwner).sort((a, b) => a.name.localeCompare(b.name));
  const pointed = [...(game.user.targets ?? [])][0]?.actor ?? canvas?.tokens?.controlled?.[0]?.actor ?? null;
  const preset = characters.includes(pointed) ? pointed.id : characters[0]?.id ?? "";
  const who = [`<option value="">${escapeHTML(t("NoOne"))}</option>`,
    ...characters.map(actor => `<option value="${actor.id}"${actor.id === preset ? " selected" : ""}>${escapeHTML(actor.name)}</option>`)].join("");
  const how = [`<option value="">${escapeHTML(t("Random"))}</option>`,
    ...VARIANTS.map(variant => `<option value="${variant}">${escapeHTML(t(`Variants.${variant}`))}</option>`)].join("");
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: t("Title"), icon: "fa-solid fa-eye" },
    classes: ["hardwipe-dialog", "is-eye"],
    position: { width: 400 },
    content: `<div class="form-group"><label>${escapeHTML(t("Who"))}</label><div class="form-fields"><select name="actor">${who}</select></div></div>
      <div class="form-group"><label>${escapeHTML(t("How"))}</label><div class="form-fields"><select name="variant">${how}</select></div></div>
      <div class="form-group"><label>${escapeHTML(t("Says"))}</label><div class="form-fields"><input type="text" name="line" placeholder="${escapeHTML(t("SaysHint"))}" maxlength="40"></div></div>
      <div class="form-group"><label>${escapeHTML(t("Audience"))}</label><div class="form-fields"><select name="audience">
        <option value="all">${escapeHTML(t("Everyone"))}</option><option value="them">${escapeHTML(t("OnlyThem"))}</option></select></div></div>`,
    buttons: [
      { action: "post", label: t("Post"), icon: "fa-solid fa-eye", default: true, callback: (event, button) => {
        const form = button.form.elements;
        return { actor: form.actor.value, variant: form.variant.value, line: form.line.value, audience: form.audience.value };
      } },
      { action: "cancel", label: game.i18n.localize("Cancel") }
    ],
    rejectClose: false
  });
  if (!result || result === "cancel") return;
  await postEye(game.actors.get(result.actor) ?? null, { line: result.line, variant: result.variant, onlyThem: result.audience === "them" });
}

export function registerEye() {
  Hooks.on("renderChatMessageHTML", (message, html) => renderEyeMessage(message, html));
  // After the other D&D5e card passes (the shared portrait patch among them), still before the log first draws.
  Hooks.once("setup", () => Hooks.on("dnd5e.renderChatMessage", (message, html) => eyeHeader(message, html)));
  Hooks.on("getSceneControlButtons", controls => {
    const group = controls.tokens ?? controls.token;
    if (!group) return;
    group.tools ??= {};
    if (group.tools.hardwipeEye) return;
    group.tools.hardwipeEye = {
      name: "hardwipeEye", title: "HARDWIPE.Eye.Tool", icon: "fa-solid fa-eye", button: true, visible: !!game.user?.isGM,
      order: Object.values(group.tools).reduce((max, tool) => Math.max(max, Number(tool.order) || 0), 0) + 1,
      onChange: () => void openEye()
    };
  });
  Hooks.once("ready", () => {
    game.hardwipe ??= {};
    game.hardwipe.eye = { open: openEye, post: postEye, variants: VARIANTS };
  });
}
