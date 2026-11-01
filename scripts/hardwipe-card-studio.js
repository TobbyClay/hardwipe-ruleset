import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";

/**
 * The Card Studio: legendary cards the GM writes in HTML and CSS, kept in the world (setting `legendaryStudio`) and
 * shared as JSON files. A studio card is a weapon's head: it places {{status}} (the attack's status and the GM's crown)
 * where it likes, or Hardwipe adds a plain top row, and Hardwipe adds the card's working parts below (attack kind,
 * chips, verdict, targets, description), so a card can't break the attack. Its HTML is a template with tokens ({{name}}, {{title}}, {{line}}…); its CSS applies inside the card
 * only. Images, GIFs and videos may come from the world's files or any https site, and links (https) open in a new tab;
 * the studio names every outside site a card loads from. Everyone's client cleans both before use: no scripts, event
 * handlers, forms or frames, no fonts from other sites, nothing fixed over the screen.
 */
export const STUDIO = "legendaryStudio";
export const OUTCOMES = ["attack", "pending", "hit", "critical", "miss", "mixed", "fumble"];
const LIMITS = { name: 60, hint: 200, html: 20000, css: 40000, line: 120 };
const s = key => game.i18n.localize(`HARDWIPE.Studio.${key}`);
const sx = key => escapeHTML(s(key));

/* Pure helpers (unit-tested) ----------------------------------------------------------------- */

/**
 * Whether a URL may be used by a card: a path in this Foundry's files, a fragment, any https address, or (for images)
 * an inline image. No other schemes: no javascript:, no plain http, no protocol-relative addresses.
 */
export function safeURL(value, { image = false } = {}) {
  const url = String(value ?? "").trim();
  if (!url || url.startsWith("#")) return true;
  if (/^data:/i.test(url)) return image && /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(url);
  if (/^https:\/\/[^\s/]/i.test(url)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("//") && !url.startsWith("\\");
}

/** Whether a CSS declaration may stay: nothing fixed over the screen, addresses only as safeURL allows, no old script hooks. */
export function safeDeclaration(property, value) {
  const prop = String(property ?? "").toLowerCase();
  const text = String(value ?? "").toLowerCase();
  if (prop === "position" && text.includes("fixed")) return false;
  if (prop === "behavior" || prop === "-moz-binding" || /expression\s*\(|javascript:|vbscript:|-moz-binding/.test(text)) return false;
  if ([...text.matchAll(/([a-z][a-z0-9+.-]*):\/\//g)].some(([, scheme]) => scheme !== "https") || /(^|[\s('",])\/\//.test(text)) return false;
  for (const [, , url] of text.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) if (!safeURL(url, { image: true })) return false;
  return true;
}

/** The outside sites a card loads from or links to (https hosts in its HTML and CSS), for the studio to name. */
export function outsideSites(card) {
  const hosts = new Set();
  for (const [, host] of `${card?.html ?? ""}\n${card?.css ?? ""}`.matchAll(/https:\/\/([^\s/"'()<>?#]+)/gi)) hosts.add(host.toLowerCase());
  return [...hosts].sort();
}

const ELEMENTS = new Set([
  "div", "span", "p", "a", "b", "i", "em", "strong", "small", "s", "u", "br", "hr", "img", "video", "source", "figure", "figcaption", "ul", "ol", "li",
  "dl", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "sup", "sub", "mark", "header", "footer", "section", "article", "aside",
  "blockquote", "q", "cite", "code", "pre", "abbr", "time", "table", "thead", "tbody", "tr", "td", "th", "caption",
  "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "text", "tspan", "textPath", "defs", "symbol", "use",
  "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "title", "desc", "filter", "feGaussianBlur",
  "feColorMatrix", "feOffset", "feMerge", "feMergeNode", "feFlood", "feComposite", "feBlend", "feTurbulence", "feDisplacementMap"
]);
const ATTRIBUTES = new Set([
  "class", "style", "id", "title", "alt", "role", "width", "height", "viewbox", "xmlns", "xmlns:xlink", "version", "d", "cx", "cy",
  "r", "rx", "ry", "fx", "fy", "x", "y", "x1", "x2", "y1", "y2", "dx", "dy", "points", "fill", "fill-opacity", "fill-rule", "clip-rule",
  "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-opacity",
  "stroke-miterlimit", "opacity", "transform", "offset", "stop-color", "stop-opacity", "gradientunits", "gradienttransform",
  "spreadmethod", "patternunits", "patterntransform", "clippathunits", "maskunits", "text-anchor", "dominant-baseline",
  "alignment-baseline", "font-family", "font-size", "font-weight", "font-style", "letter-spacing", "word-spacing",
  "text-decoration", "preserveaspectratio", "clip-path", "mask", "filter", "visibility", "display", "pathlength", "startoffset",
  "lengthadjust", "textlength", "inert", "draggable", "loading", "decoding", "colspan", "rowspan", "stddeviation", "in", "in2",
  "result", "values", "type", "mode", "operator", "k1", "k2", "k3", "k4", "scale", "xchannelselector", "ychannelselector",
  "basefrequency", "numoctaves", "seed", "stitchtiles", "flood-color", "flood-opacity", "color",
  "autoplay", "loop", "muted", "playsinline", "poster", "target", "rel"
]);
const MEDIA = new Set(["img", "video", "source"]);

/** Whether an attribute may stay on an element of a card: no event handlers, media and links only from safe addresses. */
export function safeAttribute(tag, name, value) {
  const attr = String(name ?? "").toLowerCase();
  const text = String(value ?? "");
  if (attr.startsWith("on") || /javascript:|vbscript:/i.test(text)) return false;
  if (attr === "src") return MEDIA.has(tag) && safeURL(text, { image: tag === "img" });
  if (attr === "poster") return tag === "video" && safeURL(text, { image: true });
  if (attr === "href") return tag === "a" ? safeURL(text) && !/^data:/i.test(text.trim()) : text.trim().startsWith("#");
  if (attr === "xlink:href") return text.trim().startsWith("#");
  if (attr.startsWith("data-") || attr.startsWith("aria-")) return true;
  if (!ATTRIBUTES.has(attr)) return false;
  if (attr === "style") return true;
  return !/url\(/i.test(text) || /^\s*url\(\s*#[^)]*\)\s*$/i.test(text);
}

/**
 * Fill a card's template: {{key}} for a value, {{#key}}…{{/key}} where it has one, {{^key}}…{{/key}} where it hasn't.
 * The values are already escaped (or, for {{title}}, Hardwipe's own markup); unknown tokens are empty.
 */
export function renderTemplate(template, values) {
  const get = key => values[key] ?? "";
  return String(template ?? "")
    .replace(/\{\{([#^])\s*([\w-]+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g, (match, mode, key, inner) => (Boolean(get(key)) === (mode === "#") ? inner : ""))
    .replace(/\{\{\s*([\w-]+)\s*\}\}/g, (match, key) => get(key));
}

/** Point a card's animations at its own (renamed) keyframes. */
export function renameAnimations(value, names) {
  return String(value ?? "").replace(/[A-Za-z_][\w-]*/g, word => names.get(word) ?? word);
}

/** A card as stored, made safe to keep: bounded text, a name, the outcomes' lines. */
export function normalizeCard(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const text = (key, max) => String(input[key] ?? "").slice(0, max);
  const lines = Object.fromEntries(OUTCOMES.map(tone => [tone, String(input.lines?.[tone] ?? "").trim().slice(0, LIMITS.line)]).filter(([, line]) => line));
  return {
    schema: 1, name: text("name", LIMITS.name).trim() || "Untitled card", hint: text("hint", LIMITS.hint).trim(),
    unique: input.unique !== false, html: text("html", LIMITS.html), css: text("css", LIMITS.css), lines
  };
}

/** A new card's id: its name in letters and digits, and a short random tail. */
export function studioId(name, random) {
  const slug = String(name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  return `c-${slug || "card"}-${String(random ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "0"}`;
}

/** The cards in a shared file: one card, a set of them, or a bare card. Throws with the reason when it's none of these. */
export function parseCards(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("not JSON"); }
  const list = data?.type === "hardwipe-legendary-cards" ? data.cards : data?.type === "hardwipe-legendary-card" ? [data.card] : [data];
  if (!Array.isArray(list)) throw new Error("no cards");
  const cards = list.map(card => (card && typeof card === "object" && typeof card.html === "string") ? normalizeCard(card) : null);
  if (!cards.length || cards.some(card => !card)) throw new Error("a card is missing its HTML");
  return cards;
}

/** A file to share: one card, or a set. */
export function exportCards(cards) {
  const clean = cards.map(normalizeCard).filter(Boolean);
  return JSON.stringify(clean.length === 1 ? { type: "hardwipe-legendary-card", schema: 1, card: clean[0] }
    : { type: "hardwipe-legendary-cards", schema: 1, cards: clean }, null, 2);
}

/* Cleaning, in the browser ---------------------------------------------------------------------- */

const cleaned = new Map();

/** A card's HTML with only what a card may hold (see the tag and attribute lists above). Cached by its text. */
export function cleanCardHTML(html) {
  const key = String(html ?? "");
  if (cleaned.has(key)) return cleaned.get(key);
  const template = document.createElement("template");
  template.innerHTML = key;
  const walk = parent => {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType === Node.COMMENT_NODE) { node.remove(); continue; }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (!ELEMENTS.has(node.localName)) { node.remove(); continue; }
      for (const attr of [...node.attributes]) if (!safeAttribute(node.localName, attr.name, attr.value)) node.removeAttribute(attr.name);
      if (node.style) for (const prop of [...node.style]) if (!safeDeclaration(prop, node.style.getPropertyValue(prop))) node.style.removeProperty(prop);
      // A link opens in a new tab, and tells the other site nothing about where it came from.
      if (node.localName === "a") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      walk(node);
    }
  };
  walk(template.content);
  const out = template.innerHTML;
  if (cleaned.size >= 200) cleaned.delete(cleaned.keys().next().value);
  cleaned.set(key, out);
  return out;
}

/**
 * A card's CSS, cleaned and kept inside the card: every rule nests under the card's class (`&` is the chat message),
 * keyframes take the card's name, and @import, @font-face and the like are dropped.
 */
export function scopedCSS(scope, css) {
  const sheet = new CSSStyleSheet();
  // @import is never kept; dropping it first spares the browser's warning about it.
  try { sheet.replaceSync(String(css ?? "").replace(/@import[^;]*;?/gi, "")); } catch { return ""; }
  const names = new Map();
  for (const rule of sheet.cssRules) if (rule instanceof CSSKeyframesRule) names.set(rule.name, `${scope}-${rule.name}`);
  const clean = style => {
    for (const prop of [...style]) {
      const value = style.getPropertyValue(prop);
      if (!safeDeclaration(prop, value)) style.removeProperty(prop);
      else if (names.size && prop === "animation-name") style.setProperty(prop, renameAnimations(value, names), style.getPropertyPriority(prop));
    }
  };
  const walk = rules => { for (const rule of rules) { if (rule.style) clean(rule.style); if (rule.cssRules) walk(rule.cssRules); } };
  walk(sheet.cssRules);
  const out = [];
  for (const rule of sheet.cssRules) {
    if (rule instanceof CSSKeyframesRule) {
      rule.name = names.get(rule.name);
      out.push(rule.cssText);
    } else if (rule instanceof CSSStyleRule || rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
      out.push(`.${scope} { ${rule.cssText} }`);
    }
  }
  return out.join("\n");
}

/* The cards in the world ------------------------------------------------------------------------- */

/** The world's studio cards: id -> card. */
export function studioCards() {
  return game.settings.settings.has(`${MODULE_ID}.${STUDIO}`) ? game.settings.get(MODULE_ID, STUDIO) ?? {} : {};
}

/** Whether a card places the status (and the GM's crown) itself. */
export function placesStatus(card) {
  return /\{\{\s*status\s*\}\}/.test(card?.html ?? "");
}

const STATUS_MARK = '<i data-hwc-status=""></i>';

/**
 * A studio card's markup for a weapon: the template filled with this weapon's (escaped) values and cleaned. `p` is the
 * head's parts from hardwipe-legendary.js; its tone picks the card's line and the outcome tokens. `status` is Hardwipe's
 * own status and crown, put in after cleaning where the card placed {{status}} (the crown is a button, which a card
 * itself may not hold).
 */
export function studioBodyHTML(card, p, status = "") {
  const tone = OUTCOMES.includes(p.tone) ? p.tone : "attack";
  const values = { name: p.name, type: p.type, rarity: p.rarity, maker: p.maker, img: p.img, logo: p.logo, serial: p.serial, tone,
    line: escapeHTML(card.lines?.[tone] || card.lines?.attack || ""), title: `<div class="hardwipe-chat-title hwl-title">${p.name}</div>`,
    status: STATUS_MARK, ...Object.fromEntries(OUTCOMES.map(key => [key, key === tone ? "1" : ""])) };
  return cleanCardHTML(renderTemplate(card.html, values)).replaceAll(STATUS_MARK, status);
}

/** Every client's style for the world's studio cards, rebuilt when they change. */
function applyStudioStyles() {
  let style = document.getElementById("hardwipe-studio-styles");
  if (!style) {
    style = document.createElement("style");
    style.id = "hardwipe-studio-styles";
    document.head.append(style);
  }
  style.textContent = Object.entries(studioCards()).map(([id, card]) => scopedCSS(`hwc-${id}`, card.css)).join("\n");
}

/** A blank card that shows how the tokens work. */
const BLANK = {
  name: "New card", hint: "", unique: true,
  html: `<div class="hwl-top"><span class="hwl-rarity">{{rarity}}</span>{{status}}</div>
<div class="plate">
  {{#logo}}<img class="logo" src="{{logo}}" alt="">{{/logo}}
  <div class="kicker">{{maker}}</div>
  {{title}}
  <div class="sub">{{type}} · No. {{serial}}</div>
  {{#line}}<div class="line">{{line}}</div>{{/line}}
</div>`,
  css: `/* Everything here stays inside this card. "&" is the whole chat message. */
& { --l-rail: #46e6dc; }
.hwl-head { background: linear-gradient(160deg, #0c2a33, #050b0e 70%); }
.hwl-top { color: #8ffcf4; }
.plate { position: relative; margin: 2px 12px 0; padding: 14px; color: #eafff4; border: 1px solid #46e6dc; background: rgba(70, 230, 220, 0.06); }
.logo { float: right; width: 40px; height: 40px; object-fit: contain; }
.kicker, .sub { font: 700 9px var(--hw-font-mono); letter-spacing: 0.22em; text-transform: uppercase; opacity: 0.7; }
.hwl-title { margin: 4px 0; color: #eafff4; font: 800 26px/1 var(--hw-font-disp); text-transform: uppercase; }
.line { margin-top: 8px; font: italic 500 13px var(--hw-font-disp); }
.hwl-head.is-critical .plate { box-shadow: 0 0 14px #46e6dc; }
.hwl-head:is(.is-miss, .is-mixed) .plate { filter: grayscale(0.7) brightness(0.75); }`,
  lines: { hit: "Clean hit.", critical: "Not a scratch on it after.", miss: "Next time." }
};

/* The studio window ------------------------------------------------------------------------------ */

/**
 * @param {object} env
 * @param {(item: Item|object, spec: object, tone: string) => string} env.preview   A weapon's head as a card.
 * @param {() => Item[]} env.weapons                                                  The world's weapons, for the preview.
 * @param {(kind: string, id: string) => object} env.builtin                          A built-in card as a studio card.
 * @param {{signatures: string[], bases: string[], label: (kind: string, id: string) => string}} env.starts
 * @param {() => object} env.logos                                                    The world's card logos.
 * @param {(logos: object) => Promise} env.setLogos
 */
function buildStudio(env) {
  const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
  return class CardStudio extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "hardwipe-card-studio", tag: "form", classes: ["hardwipe-card-studio"],
      window: { title: "HARDWIPE.Studio.Title", icon: "fas fa-crown", resizable: true },
      position: { width: 1060, height: 780 },
      form: { handler: CardStudio.prototype._onSave, closeOnSubmit: false },
      actions: {
        create: CardStudio.prototype._onCreate, importCards: CardStudio.prototype._onImport, exportCard: CardStudio.prototype._onExport,
        exportAll: CardStudio.prototype._onExportAll, remove: CardStudio.prototype._onRemove
      }
    };
    static PARTS = { content: { template: "modules/hardwipe-ruleset/templates/card-studio.hbs" } };
    _selected = null;
    _sample = null;
    _tone = "hit";

    async _prepareContext() {
      const cards = studioCards();
      const ids = Object.keys(cards);
      if (!cards[this._selected]) this._selected = ids[0] ?? null;
      const card = this._selected ? cards[this._selected] : null;
      const weapons = env.weapons();
      if (!weapons.some(item => item.uuid === this._sample)) this._sample = weapons[0]?.uuid ?? "";
      return {
        cards: ids.map(id => ({ id, name: cards[id].name, selected: id === this._selected })).sort((a, b) => a.name.localeCompare(b.name)),
        card, id: this._selected, logo: (this._selected && env.logos()[this._selected]) || "", sites: card ? outsideSites(card).join(", ") : "",
        lines: OUTCOMES.map(tone => ({ tone, label: s(`Tone.${tone}`), value: card?.lines?.[tone] ?? "" })),
        tones: OUTCOMES.map(tone => ({ tone, label: s(`Tone.${tone}`), selected: tone === this._tone })),
        weapons: weapons.map(item => ({ uuid: item.uuid, name: item.actor ? `${item.name} · ${item.actor.name}` : item.name, selected: item.uuid === this._sample })),
        signatures: env.starts.signatures.map(id => ({ value: `signature:${id}`, label: env.starts.label("signature", id) })),
        bases: env.starts.bases.map(id => ({ value: `base:${id}`, label: env.starts.label("base", id) })),
        tokens: ["status", "title", "name", "type", "rarity", "maker", "img", "logo", "serial", "line", "tone", "outcome"].map(key => ({ key, text: s(`Token.${key}`) }))
      };
    }

    _onRender(context, options) {
      super._onRender(context, options);
      const form = this.element;
      this.element.querySelector("[name='selected']")?.addEventListener("change", event => this._select(event.target.value));
      const redraw = foundry.utils.debounce(() => this._drawPreview(), 150);
      form.addEventListener("input", event => { if (!["selected", "start"].includes(event.target.name)) redraw(); });
      form.addEventListener("change", event => { if (!["selected", "start"].includes(event.target.name)) redraw(); });
      this._drawPreview();
    }

    _onClose(options) {
      super._onClose(options);
      document.getElementById("hardwipe-studio-draft")?.remove();
    }

    /** The card as the form has it now. */
    _draft() {
      const data = new foundry.applications.ux.FormDataExtended(this.element).object;
      return { card: normalizeCard({ ...data, unique: !!data.unique, lines: Object.fromEntries(OUTCOMES.map(tone => [tone, data[`line-${tone}`]])) }),
        logo: String(data.logo ?? "").trim(), sample: data.sample, tone: OUTCOMES.includes(data.tone) ? data.tone : "hit" };
    }

    _drawPreview() {
      const stage = this.element?.querySelector(".hwc-stage");
      if (!stage || !this._selected) return;
      const { card, logo, sample, tone } = this._draft();
      this._sample = sample;
      this._tone = tone;
      let style = document.getElementById("hardwipe-studio-draft");
      if (!style) {
        style = document.createElement("style");
        style.id = "hardwipe-studio-draft";
        document.head.append(style);
      }
      style.textContent = scopedCSS("hwc-draft", card.css);
      const sites = this.element.querySelector(".hwc-sites");
      if (sites) {
        const hosts = outsideSites(card);
        sites.hidden = !hosts.length;
        sites.querySelector("span").textContent = hosts.join(", ");
      }
      const item = env.weapons().find(weapon => weapon.uuid === sample)
        ?? { name: s("SampleWeapon"), type: "weapon", img: "icons/svg/sword.svg", uuid: "sample", system: {}, flags: {} };
      stage.className = "hwc-stage hardwipe-legendary hwc hwc-draft";
      stage.innerHTML = env.preview(item, { kind: "studio", id: "draft", card, logo }, tone);
    }

    async _confirmLeave() {
      const stored = studioCards()[this._selected];
      if (!stored || !this.element.querySelector("[name='html']")) return true;
      if (JSON.stringify(this._draft().card) === JSON.stringify(normalizeCard(stored))) return true;
      return DialogV2.confirm({ classes: ["hardwipe-dialog", "is-danger"], window: { title: "HARDWIPE.Studio.Unsaved" },
        content: `<p>${escapeHTML(game.i18n.format("HARDWIPE.Studio.UnsavedBody", { name: stored.name }))}</p>`, rejectClose: false });
    }

    async _select(id) {
      if (id === this._selected) return;
      if (!await this._confirmLeave()) {
        this.element.querySelector("[name='selected']").value = this._selected;
        return;
      }
      this._selected = id;
      await this.render({ force: true });
    }

    async _write(cards, select) {
      await game.settings.set(MODULE_ID, STUDIO, cards);
      if (select) this._selected = select;
      await this.render({ force: true });
    }

    async _onCreate() {
      if (!await this._confirmLeave()) return;
      const start = this.element.querySelector("[name='start']")?.value ?? "blank";
      const [kind, id] = start.split(":");
      const card = normalizeCard(kind === "blank" ? BLANK : env.builtin(kind, id));
      const newId = studioId(card.name, foundry.utils.randomID(6));
      await this._write({ ...studioCards(), [newId]: card }, newId);
    }

    async _onImport() {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const added = parseCards(await foundry.utils.readTextFromFile(file));
          const cards = { ...studioCards() };
          let last = null;
          for (const card of added) cards[last = studioId(card.name, foundry.utils.randomID(6))] = card;
          await this._write(cards, last);
          const hosts = [...new Set(added.flatMap(outsideSites))];
          ui.notifications.info(game.i18n.format("HARDWIPE.Studio.Imported", { count: added.length }));
          if (hosts.length) ui.notifications.warn(game.i18n.format("HARDWIPE.Studio.ImportedSites", { sites: hosts.join(", ") }), { permanent: true });
        } catch (error) {
          ui.notifications.error(game.i18n.format("HARDWIPE.Studio.ImportBad", { error: error.message }));
        }
      });
      input.click();
    }

    _onExport() {
      const card = studioCards()[this._selected];
      if (!card) return;
      foundry.utils.saveDataToFile(exportCards([card]), "application/json", `${this._selected.replace(/^c-/, "")}.hardwipe-card.json`);
    }

    _onExportAll() {
      const cards = Object.values(studioCards());
      if (cards.length) foundry.utils.saveDataToFile(exportCards(cards), "application/json", "hardwipe-cards.json");
    }

    async _onRemove() {
      const cards = { ...studioCards() };
      const card = cards[this._selected];
      if (!card) return;
      const sure = await DialogV2.confirm({ classes: ["hardwipe-dialog", "is-danger"],
        window: { title: game.i18n.format("HARDWIPE.Studio.DeleteTitle", { name: card.name }) }, content: `<p>${sx("DeleteBody")}</p>`, rejectClose: false });
      if (!sure) return;
      delete cards[this._selected];
      const logos = { ...env.logos() };
      if (this._selected in logos) {
        delete logos[this._selected];
        await env.setLogos(logos);
      }
      await this._write(cards, null);
    }

    async _onSave() {
      if (!this._selected) return;
      const { card, logo } = this._draft();
      const logos = { ...env.logos() };
      if (logo) logos[this._selected] = logo;
      else delete logos[this._selected];
      if (!foundry.utils.equals(logos, env.logos())) await env.setLogos(logos);
      await this._write({ ...studioCards(), [this._selected]: card });
      ui.notifications.info(game.i18n.format("HARDWIPE.Studio.Saved", { name: card.name }));
    }
  };
}

let studioClass = null;

/** Open the studio (GM only). */
export function openCardStudio() {
  if (!game.user.isGM || !studioClass) return;
  const open = foundry.applications.instances.get("hardwipe-card-studio");
  if (open) open.bringToFront?.();
  else new studioClass().render({ force: true });
}

export function registerCardStudio(env) {
  studioClass = buildStudio(env);
  game.settings.register(MODULE_ID, STUDIO, {
    scope: "world", config: false, type: Object, default: {},
    onChange: () => { applyStudioStyles(); env.onChange?.(); }
  });
  game.settings.registerMenu(MODULE_ID, "cardStudioMenu", {
    name: "HARDWIPE.Studio.Menu", label: "HARDWIPE.Studio.MenuLabel", hint: "HARDWIPE.Studio.MenuHint", icon: "fas fa-crown",
    type: studioClass, restricted: true
  });
  Hooks.once("ready", applyStudioStyles);
}
