import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { arrivalWindow, messagesAfter } from "./hardwipe-attack-cards.js";

/**
 * Tool cards. Ready Set Midi's card for a tool's check activity offers no way to roll it (it treats a check as
 * something the targets roll), so the card gets its own Roll check. The tool check it rolls is linked to the card;
 * the card shows the result in a scope drawn by the tool's family, and the check's own card shrinks to a slim row
 * that keeps the roll's + and advantage switch.
 *
 *   breach  thieves' tools (and anything unrecognised): cipher columns locking into place
 *   spoof   disguise and forgery kits: a face mesh and an ID match
 *   synth   alchemist's, herbalism, poisoner's, brewer's, cook's: a molecule assembling, its purity
 *   fab     other artisan's tools: a blueprint drawing itself, its integrity
 *   nav     navigator's and cartographer's tools, vehicles: a radar sweep and a route locking on
 *   signal  instruments and gaming sets: a spectrum rising past a threshold
 *
 * Most rolls have no DC. Then the scope fills by how good the roll is for this character (from a 1 to a 20 on the
 * die, plus everything added), in neutral cyan, and the stamp names the highest standard DC the total beats. With a
 * DC set, it turns green or red with Success or Failure.
 */
const SYNTH = new Set(["alchemist", "herb", "pois", "brewer", "cook"]);
const SPOOF = new Set(["disg", "forg"]);
const NAV = new Set(["navg", "cartographer", "vehicle", "land", "water", "air", "space"]);
const SIGNAL = new Set(["music", "game", "card", "chess", "dice", "dragonchess", "bagpipes", "drum", "dulcimer", "flute", "horn", "lute", "lyre", "panflute", "shawm", "viol"]);
const ARTISAN = new Set(["art", "smith", "tinker", "carpenter", "calligrapher", "cobbler", "glassblower", "jeweler", "leatherworker", "mason", "painter", "potter", "weaver", "woodcarver"]);
export const LADDER = [[5, "VeryEasy"], [10, "Easy"], [15, "Medium"], [20, "Hard"], [25, "VeryHard"], [30, "NearlyImpossible"]];
const ARRIVAL_MS = 1400;

/* Pure helpers (unit-tested) ------------------------------------------------------------------ */

/** The tool's family, from its D&D5e base item or type; a GM can force one with flags.hardwipe-ruleset.toolFamily. */
export function toolFamily({ baseItem = "", type = "", flag = "" } = {}) {
  if (["breach", "spoof", "synth", "fab", "nav", "signal"].includes(flag)) return flag;
  for (const key of [baseItem, type].filter(Boolean)) {
    if (key === "thief") return "breach";
    if (SPOOF.has(key)) return "spoof";
    if (SYNTH.has(key)) return "synth";
    if (NAV.has(key)) return "nav";
    if (SIGNAL.has(key)) return "signal";
    if (ARTISAN.has(key)) return "fab";
  }
  return "breach";
}

/**
 * How a check reads: with a DC, success or failure and how close (total / DC); without one, where the total falls
 * between this roll's lowest and highest possible (the die from 1 to 20, everything else as rolled), and the highest
 * standard DC it beats.
 * @param {{total: number, natural: number, dc?: number|null}} roll
 */
export function checkScale({ total, natural, dc = null }) {
  const hasDC = Number.isFinite(dc);
  const rest = Number.isFinite(natural) ? total - natural : 0;
  const [min, max] = [rest + 1, rest + 20];
  const ratio = hasDC ? Math.max(0, Math.min(1, total / dc)) : Math.max(0, Math.min(1, (total - min) / (max - min)));
  const ladder = [...LADDER].reverse().find(([value]) => total >= value) ?? null;
  return { ratio, verdict: hasDC ? total >= dc : null, ladder: ladder ? { dc: ladder[0], key: ladder[1] } : null, min, max };
}

/* Art ------------------------------------------------------------------------------------------ */

const ART = {
  breach(r, verdict) {
    const locked = verdict === true ? 5 : Math.max(0, Math.round(5 * r));
    const glyphs = ["A7", "3F", "C9", "E2", "5D"];
    return glyphs.map((glyph, i) => {
      const x = 6 + i * 28, on = i < locked;
      return `<g class="${on ? "is-on" : ""}" style="--i:${i}"><rect x="${x}" y="2" width="22" height="52" class="${on ? "stroke glow" : "dim"}"/>
        ${on ? `<text x="${x + 11}" y="33" text-anchor="middle" class="glyph glow">${glyph}</text>`
          : `<text x="${x + 11}" y="15" text-anchor="middle" class="glyph off">7E</text><text x="${x + 11}" y="33" text-anchor="middle" class="glyph off">··</text><text x="${x + 11}" y="50" text-anchor="middle" class="glyph off">0B</text>`}</g>`;
    }).join("") + `<line x1="0" y1="28" x2="148" y2="28" class="dim" stroke-dasharray="2 3"/>`;
  },
  spoof(r) {
    return `<polygon points="75,2 98,11 106,28 98,45 75,54 52,45 44,28 52,11" class="stroke draw glow"/>
      <path class="dim" d="M75 2 L75 54 M44 28 L106 28 M52 11 L98 45 M98 11 L52 45 M60 22 L66 25 M84 25 L90 22 M64 39 Q75 44 86 39"/>
      <line x1="30" x2="120" y1="${4 + 48 * r}" y2="${4 + 48 * r}" class="stroke glow"/>`;
  },
  synth(r) {
    const nodes = [[30, 28], [52, 14], [76, 28], [52, 42], [100, 14], [122, 28], [100, 42]];
    const bonds = [[0, 1], [1, 2], [2, 3], [3, 0], [2, 4], [4, 5], [5, 6], [6, 2]];
    const lit = Math.round(bonds.length * r), on = Math.ceil(nodes.length * r);
    return bonds.map(([a, b], i) => `<line x1="${nodes[a][0]}" y1="${nodes[a][1]}" x2="${nodes[b][0]}" y2="${nodes[b][1]}" class="${i < lit ? "stroke glow draw" : "dim"}"/>`).join("")
      + nodes.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="4.5" class="${i < on ? "lit glow pop" : "dim"}" style="--i:${i}"/>`).join("");
  },
  fab(r) {
    const spokes = [0, 45, 90, 135, 180, 225, 270, 315].map(a => {
      const t = a * Math.PI / 180;
      return `<line x1="${(48 + 19 * Math.cos(t)).toFixed(1)}" y1="${(28 + 19 * Math.sin(t)).toFixed(1)}" x2="${(48 + 24 * Math.cos(t)).toFixed(1)}" y2="${(28 + 24 * Math.sin(t)).toFixed(1)}" class="stroke"/>`;
    }).join("");
    return `<rect x="2" y="2" width="146" height="52" class="dim" stroke-dasharray="2 4"/>
      <g style="stroke-dasharray:${Math.round(300 * r)} 400"><circle cx="48" cy="28" r="19" class="stroke glow"/><circle cx="48" cy="28" r="7" class="stroke"/>${spokes}
      <rect x="88" y="12" width="44" height="32" class="stroke"/><line x1="72" y1="28" x2="88" y2="28" class="stroke"/></g>`;
  },
  nav(r, verdict) {
    const x = 70 + 70 * r;
    return `<circle cx="30" cy="28" r="26" class="dim"/><circle cx="30" cy="28" r="15" class="dim"/><line x1="4" y1="28" x2="56" y2="28" class="dim"/><line x1="30" y1="2" x2="30" y2="54" class="dim"/>
      <path class="sweep" d="M30 28 L30 2 A26 26 0 0 1 52 14 Z"/>
      <path d="M30 28 C 56 ${8 + 18 * (1 - r)}, 88 ${44 - 18 * r}, ${x.toFixed(1)} 24" class="stroke draw glow" stroke-dasharray="4 3"/>
      <circle cx="${x.toFixed(1)}" cy="24" r="4" class="${verdict !== false && r > 0.5 ? "lit glow pop" : "stroke"}"/>`;
  },
  signal(r, verdict, dc) {
    const heights = [0.5, 0.8, 0.65, 1, 0.75, 0.9, 0.55, 0.85, 0.7, 0.95, 0.6, 0.8];
    const threshold = Number.isFinite(dc) ? 54 - 44 * Math.min(1, dc / 20) : null;
    return heights.map((h, i) => {
      const v = Math.min(52, 52 * h * r * 1.05);
      const lit = threshold === null || 54 - v < threshold;
      return `<rect x="${4 + i * 12}" y="${(54 - v).toFixed(1)}" width="8" height="${v.toFixed(1)}" class="${lit ? "lit glow" : "faint"}" style="--i:${i}"/>`;
    }).join("") + (threshold === null ? "" : `<line x1="0" x2="148" y1="${threshold.toFixed(1)}" y2="${threshold.toFixed(1)}" class="stroke" stroke-dasharray="4 2"/>`);
  }
};

function meterText(family, scale, t) {
  const pct = Math.min(100, Math.round(100 * scale.ratio));
  const of5 = Math.max(0, Math.round(5 * scale.ratio));
  const v = scale.verdict;
  switch (family) {
    case "breach": return v === true ? t("Meter.breachOpen") : `${t("Meter.breach", { n: of5 })}${v === false ? ` · ${t("Meter.breachLocked")}` : ""}`;
    case "spoof": return `${t("Meter.spoof", { n: pct })}${v === false ? ` · ${t("Meter.spoofFlagged")}` : ""}`;
    case "synth": return t("Meter.synth", { n: pct });
    case "fab": return t("Meter.fab", { n: pct });
    case "nav": return v === true ? t("Meter.navLocked") : v === false ? t("Meter.navLost") : t("Meter.nav", { n: Math.max(1, of5) });
    default: return v === true ? t("Meter.signalIn") : v === false ? t("Meter.signalOff") : t("Meter.signal", { n: pct });
  }
}

/* Card ------------------------------------------------------------------------------------------- */

const t = (key, data) => data ? game.i18n.format(`HARDWIPE.Tool.${key}`, data) : game.i18n.localize(`HARDWIPE.Tool.${key}`);

/** Tool checks rolled from this card, oldest first, that this viewer may see. */
function linkedChecks(message) {
  return messagesAfter(message).reverse().filter(entry => entry.type === "check" && entry.isContentVisible
    && (entry.flags?.dnd5e?.originatingMessage === message.id || entry._source?.system?.origin === message.id));
}

function naturalOf(roll) {
  const die = roll?.dice?.find(term => term.faces === 20);
  const kept = die?.results?.find(result => result.active !== false && !result.discarded);
  return Number(kept?.result);
}

/** Rebuild a tool's gear panel as a tool card. Runs on every render, after the gear card is built. */
export function renderTool(message, element, panel, item, activity) {
  const content = element.querySelector(".message-content");
  if (!content || !panel || activity?.type !== "check") return;
  const family = toolFamily({ baseItem: item.system?.type?.baseItem, type: item.system?.type?.value, flag: item.getFlag?.(MODULE_ID, "toolFamily") });
  const ability = activity.check?.ability || item.system?.ability || "";
  const abbr = String(CONFIG.DND5E.abilities?.[ability]?.abbreviation ?? ability).toUpperCase();
  const dc = Number(activity.check?.dc?.value);
  const DC = Number.isFinite(dc) && dc > 0 ? dc : null;
  const checks = linkedChecks(message);
  const latest = checks.at(-1);
  const roll = latest?.rolls?.[0];
  const total = Number(roll?.total);
  const scale = roll ? checkScale({ total, natural: naturalOf(roll), dc: Number.isFinite(Number(roll.options?.target)) ? Number(roll.options.target) : DC }) : null;
  const state = !scale ? "ready" : scale.verdict === true ? "success" : scale.verdict === false ? "failure" : "open";

  element.classList.add("hardwipe-cons-message");
  panel.classList.add("hardwipe-cons", "hardwipe-tool", `is-tool-${state}`, `is-family-${family}`);
  const prof = Number(item.system?.proficient ?? item.system?.prof?.multiplier ?? 0);
  const profKey = prof >= 2 ? "Expert" : prof >= 1 ? "Proficient" : prof > 0 ? "Half" : "";
  if (profKey) panel.querySelector(".hardwipe-gear-bar")?.insertAdjacentHTML("beforeend", `<span class="hardwipe-tool-prof">${escapeHTML(t(`Prof.${profKey}`))}</span>`);
  // The bar names the family; the line under the name gives the tool's own D&D5e name.
  const tag = panel.querySelector(".hardwipe-gear-tag");
  if (tag) {
    const label = `${game.i18n.localize("TYPES.Item.tool")} · ${t(`Family.${family}`)}`;
    tag.innerHTML = `<i class="fas fa-screwdriver-wrench" inert></i><span>${escapeHTML(label)}</span>`;
    tag.dataset.tooltip = label;
  }
  const toolKey = item.system?.type?.baseItem || item.system?.type?.value || "";
  let kind = "";
  try { kind = toolKey ? dnd5e.documents.Trait.keyLabel(toolKey, { trait: "tool" }) : ""; } catch { kind = ""; }
  if (!kind || kind === toolKey) kind = item.system?.type?.label && item.system.type.label !== game.i18n.localize("TYPES.Item.tool") ? item.system.type.label : "";
  panel.querySelector(".hardwipe-gear-activity")?.replaceWith(Object.assign(document.createElement("small"), { className: "hardwipe-cons-line", textContent: [kind, abbr].filter(Boolean).join(" · ") }));

  const scope = document.createElement("div");
  scope.className = "hardwipe-cons-scope hardwipe-tool-scope";
  scope.innerHTML = `<div class="hardwipe-tool-art" aria-hidden="true"><svg viewBox="0 0 150 56" width="150" height="56">${ART[family](Math.max(0.08, scale?.ratio ?? 0.12), scale?.verdict ?? null, scale && Number.isFinite(Number(roll.options?.target)) ? Number(roll.options.target) : DC)}</svg></div>
    <div class="hardwipe-cons-readout"></div>${scale ? `<div class="hardwipe-tool-meter">${escapeHTML(meterText(family, scale, t))}</div>` : ""}`;
  const readout = scope.querySelector(".hardwipe-cons-readout");
  const dcText = scale && Number.isFinite(Number(roll.options?.target)) ? Number(roll.options.target) : DC;
  const sub = [abbr, dcText ? t("DC", { dc: dcText }) : ""].filter(Boolean).join(" · ");
  let dice = null;
  if (scale) {
    const stamp = scale.verdict === null
      ? (scale.ladder ? t("Beats", { label: t(`Ladder.${scale.ladder.key}`), dc: scale.ladder.dc }) : t("BelowEasy"))
      : t(scale.verdict ? "Success" : "Failure");
    readout.innerHTML = `<button type="button" class="hardwipe-tool-total" aria-expanded="false" data-tooltip="${escapeHTML(t("OpenDice"))}">${escapeHTML(total)}</button>
      <span class="hardwipe-tool-stamp ${scale.verdict === null ? "is-ladder" : ""}">${escapeHTML(stamp)}</span><small>${escapeHTML(sub)}</small>`;
    // The dice, under the scope: the roll's own terms, read-only (the check's row below changes the roll).
    dice = document.createElement("div");
    dice.className = "hardwipe-cons-below hardwipe-tool-dice";
    dice.hidden = true;
    const faces = (roll.dice ?? []).flatMap(term => (term.results ?? []).map(result => `<span class="hardwipe-die d${escapeHTML(term.faces)}${result.active === false || result.discarded ? " is-dropped" : ""}">${escapeHTML(result.result)}</span>`)).join("");
    dice.innerHTML = `<div class="hardwipe-tool-dice-row">${faces}<em>${escapeHTML(roll.formula)}</em><b>${escapeHTML(total)}</b></div>`;
    readout.querySelector(".hardwipe-tool-total").addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      dice.hidden = !dice.hidden;
      event.currentTarget.setAttribute("aria-expanded", String(!dice.hidden));
    });
  } else {
    const actor = item.actor;
    const canRoll = !!actor?.isOwner;
    readout.innerHTML = `${canRoll ? `<button type="button" class="hardwipe-tool-roll"><i class="fas fa-gear" inert></i> ${escapeHTML(t("Roll"))}</button>` : `<span class="hardwipe-cons-word is-pending">${escapeHTML(t("Waiting"))}</span>`}
      <small>${escapeHTML([abbr, profKey ? t(`Prof.${profKey}`) : "", DC ? t("DC", { dc: DC }) : ""].filter(Boolean).join(" · "))}</small>`;
    const rollButton = readout.querySelector(".hardwipe-tool-roll");
    rollButton?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      rollButton.disabled = true;
      const tool = item.system?.type?.baseItem || item.system?.type?.value || item.system?.identifier;
      const config = { tool, ability, ...(DC ? { target: DC } : {}) };
      void actor.rollToolCheck(config, { event }, { data: { flags: { dnd5e: { originatingMessage: message.id } } } })
        .catch(error => console.error("Hardwipe |", error))
        .finally(() => { rollButton.disabled = false; });
    });
  }

  // Earlier tries (the latest is the readout) as rows.
  const rows = document.createElement("div");
  rows.className = "hardwipe-cons-rows";
  rows.innerHTML = checks.slice(0, -1).map(entry => {
    const r = entry.rolls?.[0];
    const s = checkScale({ total: Number(r?.total), natural: naturalOf(r), dc: Number.isFinite(Number(r?.options?.target)) ? Number(r.options.target) : DC });
    const label = s.verdict === null ? (s.ladder ? t("BeatsShort", { dc: s.ladder.dc }) : "") : t(s.verdict ? "Success" : "Failure");
    return `<div class="hardwipe-cons-row is-earlier"><span>${escapeHTML(entry.speaker?.alias ?? "")}</span><em>${escapeHTML(t("Earlier"))}</em><b>${escapeHTML(r?.total ?? "—")} · ${escapeHTML(label)}</b></div>`;
  }).join("");

  // The old result list goes (the readout replaces it); Details and the item's own buttons go in the foot.
  panel.querySelector(".hardwipe-gear-saves")?.remove();
  const desc = panel.querySelector(".hardwipe-desc");
  const foot = document.createElement("div");
  foot.className = "hardwipe-cons-foot";
  if (desc) {
    desc.hidden = true;
    foot.insertAdjacentHTML("beforeend", `<button type="button" class="hardwipe-cons-details" aria-expanded="false">${escapeHTML(game.i18n.localize("HARDWIPE.Cons.Details"))}</button>`);
    foot.querySelector(".hardwipe-cons-details").addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      desc.hidden = !desc.hidden;
      event.currentTarget.setAttribute("aria-expanded", String(!desc.hidden));
    });
  }
  const strip = content.querySelector(":scope > .hardwipe-gear-actions");
  if (strip) foot.append(strip);
  const acts = document.createElement("div");
  acts.className = "hardwipe-cons-acts is-empty";
  const parts = [scope, dice, acts, rows.childElementCount ? rows : null, desc, foot].filter(Boolean);
  panel.querySelector(".hardwipe-gear-body")?.after(...parts);
  content.querySelector(":scope > .midi-results")?.classList.add("hardwipe-cons-folded");

  const left = scale ? arrivalWindow(latest, "tool", ARRIVAL_MS) : 0;
  if (left && !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    panel.classList.add("is-arriving");
    setTimeout(() => panel.classList.remove("is-arriving"), left);
  }
}

/* The slim check row ------------------------------------------------------------------------------ */

/** The tool card this check was rolled from, if any. */
export function toolOrigin(message) {
  if (message.type !== "check") return null;
  const origin = game.messages.get(message.flags?.dnd5e?.originatingMessage ?? message._source?.system?.origin ?? "");
  let item = null;
  try { item = origin?.getAssociatedItem?.() ?? null; } catch { item = null; }
  return item?.type === "tool" ? { origin, item } : null;
}

/**
 * The check's own card, folded to one row: the total (it opens the dice, as on any check), what it was for and how it
 * read, Ready Set Midi's + and the advantage switch. Called by the check card with its panel already built.
 */
export function slimCheck(message, element, panel, { origin, item }, roll) {
  const dc = Number(roll.options?.target);
  const scale = checkScale({ total: Number(roll.total), natural: naturalOf(roll), dc: Number.isFinite(dc) ? dc : null });
  const read = scale.verdict === null ? (scale.ladder ? t("BeatsShort", { dc: scale.ladder.dc }) : t("BelowEasy")) : `${t("DC", { dc })} · ${t(scale.verdict ? "Success" : "Failure")}`;
  panel.classList.add("is-slim", `is-tool-${scale.verdict === true ? "success" : scale.verdict === false ? "failure" : "open"}`);
  const name = panel.querySelector(".hardwipe-check-name");
  if (name) name.innerHTML = `<span class="hardwipe-tool-slim-for">↑ ${escapeHTML(t("CheckFor", { name: item.name }))}</span><span class="hardwipe-tool-slim-read">${escapeHTML(read)}</span>`;
  panel.dataset.toolOrigin = origin.id;
  const head = panel.querySelector(".hardwipe-check-head");
  const slot = panel.querySelector(".hardwipe-check-roll");
  const drawer = slot?.querySelector(":scope > .hardwipe-roll-drawer");
  if (head && slot) head.prepend(slot);
  if (drawer) panel.append(drawer);
  panel.querySelector(".hardwipe-check-bar")?.remove();
  panel.querySelector(".hardwipe-check-result")?.remove();
  const moveBonus = () => {
    const bonus = element.querySelector(".message-header .rsr-addon-bonus-btn");
    const switcher = head?.querySelector(":scope > .hardwipe-adv");
    if (bonus && switcher) switcher.before(bonus);
  };
  moveBonus();
  setTimeout(moveBonus, 0);
}

/** A linked tool check changing (Ready Set Midi's retro advantage or +) redraws its tool card on every client. */
export function registerToolCards() {
  Hooks.on("updateChatMessage", message => {
    const link = toolOrigin(message);
    if (link) ui.chat?.updateMessage?.(link.origin);
  });
}
