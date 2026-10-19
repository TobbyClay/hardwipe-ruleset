import { hidesChallenge } from "./hardwipe-requests.js";
import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { abilityColor, advControlHTML, arrivalWindow, d20Drawer } from "./hardwipe-attack-cards.js";
import { renderInitiative } from "./hardwipe-initiative.js";
import { slimCheck, toolOrigin } from "./hardwipe-tool-cards.js";

/**
 * Check cards: ability checks, skill and tool checks, death saves, concentration and initiative post
 * a compact Hardwipe panel (initiative its own compact row: hardwipe-initiative.js). A bar in the ability's colour names the roll type, the skill or ability
 * is the title, the advantage switch sits beside it, and the roll itself (one box, the natural d20 on
 * its corner) opens its dice in a drawer. A DC shows success or failure when the viewer may see it.
 * A plain saving throw gets its own card instead (the dial, below).
 */
const KIND_ICONS = {
  skill: "fa-user-check", tool: "fa-screwdriver-wrench", ability: "fa-dice-d20", save: "fa-shield-halved",
  death: "fa-heart-pulse", concentration: "fa-brain", initiative: "fa-bolt"
};

export function isCheckCard(message) {
  if (!["check", "save"].includes(message.type) && !message.flags?.core?.initiativeRoll) return false;
  return (message.rolls ?? []).some(roll => roll instanceof CONFIG.Dice.D20Roll);
}

export function renderCheckCard(message, element) {
  const content = element.querySelector(".message-content");
  if (!content || content.querySelector(":scope > :is(.hardwipe-check, .hwsv)")) return false;
  const button = content.querySelector("button.dice-roll");
  const roll = (message.rolls ?? []).find(entry => entry instanceof CONFIG.Dice.D20Roll);
  if (!button || !roll) return false;
  const info = checkInfo(message, roll);
  const breakdown = button.nextElementSibling?.classList.contains("roll-breakdown") ? button.nextElementSibling : null;
  const row = button.parentElement?.closest(".message-content > *");
  element.classList.add("hardwipe-check-message");
  if (info.kind === "save") return renderSave(message, element, content, { button, breakdown, row, roll, info, result: challenge(message, roll) });
  if (info.kind === "initiative") return renderInitiative(message, element, content, { button, breakdown, row, roll });

  const panel = document.createElement("div");
  panel.className = `hardwipe-check is-${info.kind}`;
  panel.style.setProperty("--hw-check", info.color);
  const result = challenge(message, roll);
  if (result) panel.dataset.hwResult = result.state;
  const t = key => game.i18n.localize(`HARDWIPE.Check.${key}`);
  panel.innerHTML = `
    <div class="hardwipe-check-bar">
      <span class="hardwipe-check-kind"><i class="fas ${KIND_ICONS[info.kind] ?? "fa-dice-d20"}" inert></i>${escapeHTML(info.kindLabel)}</span>
      ${info.abbr ? `<span class="hardwipe-check-abbr">${escapeHTML(info.abbr)}</span>` : ""}
    </div>
    <div class="hardwipe-check-head">
      <div class="hardwipe-check-name"><b>${escapeHTML(info.title)}</b>${info.sub ? `<small>${escapeHTML(info.sub)}</small>` : ""}</div>
      ${advControlHTML(message, roll, button.dataset.rsmRollKey || "", {})}
    </div>
    <div class="hardwipe-check-roll"></div>
    ${result ? `<div class="hardwipe-check-result is-${result.state}">
      <span>${escapeHTML(game.i18n.format("HARDWIPE.Check.DC", { dc: result.dc }))}</span>
      <b>${escapeHTML(t(result.state === "success" ? "Success" : "Failure"))}</b>
      <i class="fas ${result.state === "success" ? "fa-check" : "fa-xmark"}" inert></i>
    </div>` : ""}`;
  if (info.kind === "concentration") concentrationHTML(message, panel, result, content);
  const slot = panel.querySelector(".hardwipe-check-roll");
  slot.append(button);
  if (breakdown) slot.append(breakdown);
  // The row the roll came from (dnd5e's die icon and the roll) is now empty.
  row?.classList.add("hardwipe-check-source");
  content.prepend(panel);
  d20Drawer(message, button, roll, info.title, "check");
  // A check rolled from a tool card: that card shows the result, this one folds to a row (hardwipe-tool-cards.js).
  const tool = toolOrigin(message);
  if (tool) slimCheck(message, element, panel, tool, roll);
  return true;
}

/* ---------------------------------------------------------------------------------------------
 * Saving throws: the dial. A gauge with the DC at the top of its arc: the reading sweeps right of
 * the DC by how much the save cleared it, or falls short to the left (up to 10 either way), with a
 * bonus added after the roll in violet, and Δ over Saved or Failed in the middle. Without a DC the
 * arc runs from the lowest total the roll could make to the highest, and the middle shows the total.
 * A natural 20 pegs the reading into a redline zone; a natural 1 cracks the gauge. Beside the dial:
 * SAVING THROW and the ability, what forced the save, the roll box (both dice of an advantage roll
 * side by side), Ready Set Midi's + button and the advantage switch.
 * ------------------------------------------------------------------------------------------- */
const SAVE_BASE = "saveBase";
const MARGIN_SPAN = 10; // The arc shows up to 10 either side of the DC.
const REDLINE = 84; // Where the redline zone starts, in percent along the arc.
const ARRIVAL_MS = 1400; // The natural 20 and natural 1 effects play once, on a fresh card.
const DIAL = { cx: 56, cy: 72, r: 44 };

function renderSave(message, element, content, { button, breakdown, row, roll, info, result }) {
  const t = key => game.i18n.localize(`HARDWIPE.Save.${key}`);
  const total = Number(roll.total);
  const state = result?.state ?? "open";
  const modifier = saveModifier(message, roll);
  const natural = naturalD20(roll);
  const redline = natural === 20 && state !== "failure";
  const cracked = natural === 1;
  const panel = document.createElement("div");
  panel.className = ["hwsv", `is-${state}`, redline ? "is-redline" : "", cracked ? "is-cracked" : ""].filter(Boolean).join(" ");
  panel.style.setProperty("--hwsv-acc", info.color);
  if (result) panel.dataset.hwResult = result.state;
  const chip = modifier
    ? `<span class="hwsv-mod" data-tooltip="${escapeHTML(game.i18n.format("HARDWIPE.Save.ModifierTip", { base: modifier.base }))}">${escapeHTML(signed(modifier.value))}${modifier.formula ? ` · ${escapeHTML(modifier.formula)}` : ""}</span>`
    : "";
  panel.innerHTML = `
    <div class="hwsv-dial">${dialHTML(message, roll, { total, dc: result?.dc, state, modifier, redline, cracked })}${chip}</div>
    <div class="hwsv-side">
      <span class="hwsv-kind">${escapeHTML(t("Kind"))}${info.abbr ? ` · ${escapeHTML(info.abbr)}` : ""}</span>
      <b class="hwsv-title">${escapeHTML(saveSource(message) || info.title)}</b>
      <div class="hwsv-roll hardwipe-check-roll"></div>
      <div class="hwsv-ctl">${advControlHTML(message, roll, button.dataset.rsmRollKey || "", {})}</div>
    </div>`;
  const slot = panel.querySelector(".hwsv-roll");
  slot.append(button);
  if (breakdown) slot.append(breakdown);
  row?.classList.add("hardwipe-check-source");
  content.prepend(panel);
  // The dice open across the whole card, under the dial, rather than inside the roll column.
  const drawer = d20Drawer(message, button, roll, info.title, "check");
  if (drawer) panel.append(drawer);
  // Ready Set Midi's bonus button (add Bless, Guidance or a number after the roll) moves in beside the
  // switch. It is the same element, so Ready Set Midi's own click handler still runs it.
  const moveBonus = () => {
    const bonus = element.querySelector(".message-header .rsr-addon-bonus-btn");
    const switcher = panel.querySelector(".hwsv-ctl > .hardwipe-adv");
    if (bonus && switcher) switcher.before(bonus);
  };
  moveBonus();
  setTimeout(moveBonus, 0);
  // The redline and the crack play their effect once, on a card that was just rolled. A re-render
  // mid-effect continues it (a negative delay) rather than starting it again.
  const left = redline || cracked ? arrivalWindow(message, "save-dial", ARRIVAL_MS) : 0;
  if (left && !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    panel.classList.add("is-arriving");
    panel.style.setProperty("--hwsv-elapsed", `${Math.round(left - ARRIVAL_MS)}ms`);
    setTimeout(() => panel.classList.remove("is-arriving"), left);
  }
  return true;
}

const signed = value => `${value >= 0 ? "+" : "−"}${Math.abs(value)}`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** The dial: the arc and its reading, the DC gate (or the roll's range at the ends), and Δ or the total in the middle. */
function dialHTML(message, roll, { total, dc, state, modifier, redline, cracked }) {
  const t = key => game.i18n.localize(`HARDWIPE.Save.${key}`);
  const { cx, cy, r } = DIAL;
  const hasDC = Number.isFinite(dc);
  const [low, high] = hasDC ? [dc - MARGIN_SPAN, dc + MARGIN_SPAN] : rollRange(roll);
  // 0 to 100 along the arc, left to right.
  const at = value => hasDC
    ? 50 + clamp(value - dc, -MARGIN_SPAN, MARGIN_SPAN) * (50 / MARGIN_SPAN)
    : high > low ? clamp((value - low) / (high - low) * 100, 0, 100) : 100;
  const n = value => value.toFixed(2);
  const point = (p, radius = r) => {
    const angle = Math.PI * (1 - p / 100);
    return [cx + radius * Math.cos(angle), cy - radius * Math.sin(angle)];
  };
  const arc = (from, to, cls, radius = r) => {
    if (!(to - from > 0.01)) return "";
    const [x0, y0] = point(from, radius), [x1, y1] = point(to, radius);
    return `<path class="${cls}" d="M${n(x0)} ${n(y0)}A${radius} ${radius} 0 0 1 ${n(x1)} ${n(y1)}"/>`;
  };
  const ray = (p, from, to, cls) => {
    const [x0, y0] = point(p, from), [x1, y1] = point(p, to);
    return `<line class="${cls}" x1="${n(x0)}" y1="${n(y0)}" x2="${n(x1)}" y2="${n(y1)}"/>`;
  };

  // The reading: from the DC (or the bottom of the scale) to the total, then a bonus's share in violet,
  // drawn over it between the total before the bonus and the total after. A redline pegs it at the top.
  const origin = hasDC ? 50 : 0;
  const end = at(total);
  let reading;
  if (redline) reading = arc(origin, REDLINE, "hwsv-seg") + arc(REDLINE, 100, "hwsv-hot");
  else {
    reading = arc(Math.min(origin, end), Math.max(origin, end), "hwsv-seg");
    if (modifier) { const base = at(modifier.base); reading += arc(Math.min(base, end), Math.max(base, end), "hwsv-bonus"); }
  }
  const dead = cracked ? [6, 15, 19, 31, 38, 47, 58, 66, 73, 81, 92].map(p => arc(p, p + 2.6, "hwsv-dead")).join("") : "";
  const gate = hasDC
    ? `<line class="hwsv-gate" x1="${cx}" y1="${cy - r - 9}" x2="${cx}" y2="${cy - r + 9}"/>
       <text class="hwsv-dc-label" x="${cx}" y="${cy - r - 13}">${escapeHTML(game.i18n.format("HARDWIPE.Cards.SaveDC", { dc }))}</text>`
    : `<text class="hwsv-end" x="${cx - r}" y="${cy + 15}">${low}</text>${redline ? "" : `<text class="hwsv-end" x="${cx + r}" y="${cy + 15}">${high}</text>`}`;
  const band = redline
    ? `<g class="hwsv-redzone">${arc(REDLINE, 100, "hwsv-band", r + 9)}${[86, 90, 94, 98].map(p => ray(p, r + 7, r + 12, "hwsv-tick")).join("")}
       <text class="hwsv-redline" x="111" y="90">${escapeHTML(t("Redline"))}</text></g>`
    : "";
  const needle = redline ? ray(97, r - 12, r + 13, "hwsv-needle") : "";
  const crack = cracked
    ? `<g class="hwsv-crack"><polyline points="25,41 15,36 6,38"/><polyline points="25,41 31,30 39,28 43,25"/><polyline points="25,41 19,52 22,61 14,74"/>
       <polyline class="is-thin" points="25,41 33,46"/><polyline class="is-thin" points="19,52 9,55"/><polyline class="is-thin" points="31,30 28,24"/>
       <circle cx="25" cy="41" r="1.6"/></g>`
    : "";

  // The middle: Δ over the verdict, or the total alone when there is no DC.
  const big = escapeHTML(hasDC ? signed(total - dc) : String(total));
  const y = cy - 8;
  const id = `hwsv-${message.id}-${foundry.utils.randomID(4)}`;
  const text = (x, cls = "", clip = "") => `<text class="hwsv-big${hasDC ? "" : " is-total"}${cls}" x="${x}" y="${y}"${clip ? ` clip-path="url(#${id}-${clip})"` : ""}>${big}</text>`;
  let number;
  if (redline) number = text(cx - 1.4, " hwsv-split-a") + text(cx + 1.4, " hwsv-split-b") + text(cx);
  else if (cracked) {
    // The number cut into strips: two knocked sideways (cyan high, magenta low), the rest in place.
    const strips = (key, ...rows) => `<clipPath id="${id}-${key}">${rows.map(([top, bottom]) => `<rect x="0" y="${top}" width="112" height="${bottom - top}"/>`).join("")}</clipPath>`;
    number = strips("rest", [0, y - 15], [y - 12, y - 6], [y - 4, 92]) + strips("a", [y - 15, y - 12]) + strips("b", [y - 6, y - 4])
      + text(cx, "", "rest") + text(cx + 3, " hwsv-slice-a", "a") + text(cx - 2.5, " hwsv-slice-b", "b");
  } else number = text(cx);
  const word = hasDC ? `<text class="hwsv-word" x="${cx}" y="${cy + 8}">${escapeHTML(t(state === "success" ? "Saved" : "Failed").toLocaleUpperCase(game.i18n.lang))}</text>` : "";
  const label = hasDC
    ? game.i18n.format("HARDWIPE.Save.MeterDC", { total, dc, margin: signed(total - dc) })
    : game.i18n.format("HARDWIPE.Save.MeterOpen", { total, low, high });
  return `<svg class="hwsv-gauge" viewBox="0 0 112 92" role="img" aria-label="${escapeHTML(label)}">
    ${band}<g class="hwsv-arc">${arc(0, 100, "hwsv-track")}${reading}${dead}</g>${gate}${needle}${crack}
    <g class="hwsv-middle">${number}${word}</g></svg>`;
}

/** The kept d20's natural result, or null. */
function naturalD20(roll) {
  const die = roll.dice?.find(term => term.faces === 20);
  const kept = (die?.results ?? []).filter(result => result.active !== false && !result.discarded);
  return kept.length === 1 ? Number(kept[0].result) : null;
}

/**
 * The lowest and highest totals the roll could have made: the scale for a save with no DC. Read from
 * the rolled terms (Ready Set Midi writes advantage as "2d20adv", which a fresh parse would read as two
 * dice added together), counting only the dice each term keeps.
 */
function rollRange(roll) {
  const { DiceTerm, NumericTerm, OperatorTerm } = foundry.dice.terms;
  let low = 0, high = 0, sign = 1, readable = true;
  for (const term of roll.terms ?? []) {
    if (term instanceof OperatorTerm) {
      if (term.operator === "+" || term.operator === "-") sign = term.operator === "-" ? -sign : sign;
      else readable = false;
      continue;
    }
    if (term instanceof DiceTerm) {
      const kept = (term.results ?? []).filter(result => result.active !== false && !result.discarded).length || Number(term.number) || 1;
      const [least, most] = [kept, kept * Number(term.faces)];
      if (sign > 0) { low += least; high += most; } else { low -= most; high -= least; }
    } else if (term instanceof NumericTerm) {
      low += sign * Number(term.number);
      high += sign * Number(term.number);
    } else readable = false;
    sign = 1;
  }
  if (readable && Number.isFinite(low) && Number.isFinite(high) && high > low) return [low, high];
  const flat = Number(roll.total) - (naturalD20(roll) ?? 0);
  return [flat + 1, flat + 20];
}

/** A modifier added after the roll: the total before it (recorded when it was added) and the terms added. */
function saveModifier(message, roll) {
  const base = message.getFlag(MODULE_ID, SAVE_BASE);
  const total = Number(roll.total), count = Number(base?.terms);
  if (!base || !Number.isFinite(Number(base.total)) || !(roll.terms?.length > count) || total === Number(base.total)) return null;
  const added = roll.terms.slice(count).map(term => term.formula ?? term.expression ?? "").join(" ").replace(/^\s*\+\s*/, "").replace(/\s+/g, " ").trim();
  return { base: Number(base.total), value: total - Number(base.total), formula: added };
}

/** The DC on the card that asked for this save, when it asked for this ability. */
function originDC(message) {
  const origin = game.messages.get(message.flags?.dnd5e?.originatingMessage ?? "");
  const saves = origin?.flags?.[MODULE_ID]?.saves;
  const ability = message.system?.ability ?? message.rolls?.[0]?.options?.ability;
  if (saves && Number.isFinite(Number(saves.dc)) && (!saves.ability || !ability || saves.ability === ability)) return Number(saves.dc);
  let activity = null;
  try { activity = origin?.getAssociatedActivity?.() ?? null; } catch { activity = null; }
  const dc = Number(activity?.save?.dc?.value);
  return Number.isFinite(dc) && (!ability || !activity.save?.ability?.size || activity.save.ability.has(ability)) ? dc : null;
}

/** What forced the save: the item on the card that asked for it. */
function saveSource(message) {
  const origin = game.messages.get(message.flags?.dnd5e?.originatingMessage ?? "");
  if (!origin) return "";
  let item = null;
  try { item = origin.getAssociatedItem?.() ?? null; } catch { item = null; }
  return item?.name ?? origin.system?.item?.name ?? "";
}

/**
 * When a bonus is added to a saving throw after the roll (Ready Set Midi appends its terms to the roll),
 * remember the total it was added to and where the added terms start, so the card can show the
 * modifier's share. Recorded once; later bonuses stack on the same base.
 */
export function registerSaveCards() {
  Hooks.on("preUpdateChatMessage", (message, changes) => {
    if (message.type !== "save" || !Array.isArray(changes.rolls) || message.getFlag(MODULE_ID, SAVE_BASE)) return;
    const before = message.rolls?.[0];
    let after = changes.rolls[0];
    try { after = typeof after === "string" ? JSON.parse(after) : after; } catch { return; }
    // Ready Set Midi rebuilds the roll from its terms (rewriting "2d20adv" as "1d20"), so compare the parts:
    // the same dice results first, then extra terms joined by an operator.
    const terms = before?.terms?.length ?? 0;
    if (!terms || !(after?.terms?.length > terms) || !/Operator/i.test(after.terms[terms]?.class ?? "")) return;
    const results = list => JSON.stringify(list.map(term => (term.results ?? []).map(result => result.result)));
    if (results(before.terms) !== results(after.terms.slice(0, terms))) return;
    foundry.utils.setProperty(changes, `flags.${MODULE_ID}.${SAVE_BASE}`, { total: Number(before.total), terms });
  });
}


function checkInfo(message, roll) {
  const system = message.system ?? {};
  const abilities = CONFIG.DND5E.abilities ?? {};
  const label = key => (key ? game.i18n.localize(key) : "");
  const t = key => game.i18n.localize(`HARDWIPE.Check.${key}`);
  const ability = system.ability ?? roll.options?.ability ?? null;
  const abilityLabel = label(abilities[ability]?.label) || ability || "";
  const abbr = String(abilities[ability]?.abbreviation ?? ability ?? "").toUpperCase();
  const color = abilityColor(ability);
  if (message.flags?.core?.initiativeRoll || system.type === "initiative") {
    return { kind: "initiative", kindLabel: t("KindCombat"), title: t("Initiative"), sub: "", abbr, color: "var(--hw-cyan)" };
  }
  if (message.type === "save") {
    if (system.type === "death") return { kind: "death", kindLabel: t("KindSave"), title: t("DeathSave"), sub: "", abbr: "", color: "var(--hw-alert)" };
    if (system.type === "concentration") {
      const held = (message.flags?.[MODULE_ID]?.concentration?.names ?? []).join(", ");
      return { kind: "concentration", kindLabel: t("KindConcentration"), title: abilityLabel, sub: held ? game.i18n.format("HARDWIPE.Check.Holding", { names: held }) : "", abbr, color };
    }
    return { kind: "save", kindLabel: t("KindSave"), title: abilityLabel, sub: "", abbr, color };
  }
  if (system.skill) {
    const skill = label(CONFIG.DND5E.skills?.[system.skill]?.label) || system.skill;
    return { kind: "skill", kindLabel: t("KindSkill"), title: skill, sub: abilityLabel, abbr, color };
  }
  if (system.tool) {
    let tool = "";
    try { tool = dnd5e.documents.Trait.keyLabel(system.tool, { trait: "tool" }); } catch { tool = ""; }
    tool ||= message.getAssociatedItem?.()?.name || system.tool;
    return { kind: "tool", kindLabel: t("KindTool"), title: tool, sub: abilityLabel, abbr, color };
  }
  return { kind: "ability", kindLabel: t("KindAbility"), title: abilityLabel || t("KindAbility"), sub: "", abbr, color };
}

/**
 * Concentration: the spells held when the save was rolled (recorded on the card as it is posted). A
 * success notes Concentration held; a failure stamps the card Concentration lost. While the
 * concentration effect is still on the actor (Ready Set Midi ends it itself on a failure unless set
 * not to), its owner and the GM get dnd5e's own Break Concentration button, as End concentration.
 */
function concentrationHTML(message, panel, result, content) {
  const stored = message.flags?.[MODULE_ID]?.concentration;
  const native = content.querySelector('.chat-card button[data-action="breakConcentration"]');
  native?.remove();
  if (!result) return;
  const names = (stored?.names ?? []).join(", ");
  const t = key => game.i18n.localize(`HARDWIPE.Check.${key}`);
  const row = document.createElement("div");
  if (result.state === "success") {
    row.className = "hardwipe-conc is-held";
    row.innerHTML = `<i class="fas fa-brain" inert></i><span>${escapeHTML(t("ConcentrationHeld"))}${names ? ` · ${escapeHTML(names)}` : ""}</span>`;
  } else {
    row.className = "hardwipe-conc is-lost";
    row.innerHTML = `<span class="hardwipe-stamp is-flatlined">${escapeHTML(t("ConcentrationLost"))}</span><span>${escapeHTML(names)}</span>`;
  }
  const actor = ChatMessage.implementation.getSpeakerActor(message.speaker);
  const live = (stored?.effects ?? []).some(id => actor?.effects?.get(id));
  if (native && live && actor?.isOwner) {
    native.className = "hardwipe-conc-end";
    native.innerHTML = `<i class="fas fa-power-off" inert></i>${escapeHTML(t("ConcentrationEnd"))}`;
    row.append(native);
  }
  panel.append(row);
}

/** Success or failure against the roll's DC, when it has one and this viewer may see it. */
function challenge(message, roll) {
  let dc = Number(roll.options?.target);
  const fromRoll = Number.isFinite(dc);
  // A save asked for by an item card (Ready Set Midi's save requests) carries no DC on its roll; the card has it.
  if (!fromRoll && message.type === "save") dc = originDC(message) ?? NaN;
  if (!Number.isFinite(dc) || message.shouldDisplayChallenge === false || hidesChallenge(message)) return null;
  const success = (fromRoll ? roll.isSuccess : undefined) ?? (Number(roll.total) >= dc);
  return { dc, state: success ? "success" : "failure" };
}
