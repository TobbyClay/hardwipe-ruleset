import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";

/**
 * Message cards, each in its own colour from the Card colours window:
 * - Hardwipe's system cards (Edge, Downed, Flatlined, wall impacts) and the GM reviews keep their markup;
 *   this marks each with its kind and an icon for the stylesheet. Cards already in the log are recognised
 *   by their classes and kicker.
 * - Shield Block is redrawn as a targeting HUD over the shield's HP; Heat as the mission's chosen style
 *   (threat broadcast, corrupted feed or police scanner) with its Heat meter.
 * - dnd5e's roll-only messages (Hit Die, Hit Points, a formula roll, a recharge, a plain roll) and party roll
 *   requests are framed as cards around their native content, so their dice breakdowns and buttons work as
 *   before. Turn starts are a slim strip, timeline or terminal line (world setting), with the turn's
 *   activities still usable.
 */
const t = (key, data) => data ? game.i18n.format(`HARDWIPE.Msg.${key}`, data) : game.i18n.localize(`HARDWIPE.Msg.${key}`);
const pad = n => String(Math.max(0, Math.trunc(Number(n) || 0))).padStart(2, "0");

// Kind -> icon. The kind also picks the colour (--hw-c-sys-<kind> / --hw-c-msg-<kind>).
const SYSTEM_ICONS = {
  edge: "fa-bolt", downed: "fa-heart-crack", flatlined: "fa-skull", shield: "fa-shield-halved", breach: "fa-burst",
  heat: "fa-temperature-arrow-up", calm: "fa-temperature-arrow-down", lockdown: "fa-lock", wall: "fa-block-brick", review: "fa-gavel"
};
const ROLL_KINDS = { hitDie: ["hitDie", "fa-heart-pulse"], hitPoints: ["hitPoints", "fa-heart"], generic: ["formula", "fa-calculator"], recharge: ["recharge", "fa-battery-half"] };
export const HEAT_STYLES = ["broadcast", "feed", "scanner"];
const TURN_STYLES = ["strip", "timeline", "terminal"];

export function registerMessageCards() {
  game.settings.register(MODULE_ID, "turnCardStyle", {
    name: "HARDWIPE.Msg.TurnStyle.Name", hint: "HARDWIPE.Msg.TurnStyle.Hint", scope: "world", config: true, type: String,
    choices: Object.fromEntries(TURN_STYLES.map(style => [style, `HARDWIPE.Msg.TurnStyle.${style}`])), default: "strip",
    onChange: () => rerender(message => message.type === "turn")
  });
  Hooks.on("preCreateChatMessage", message => {
    if (message.type === "turn") snapshotTurn(message);
  });
  Hooks.once("setup", () => Hooks.on("dnd5e.renderChatMessage", (message, html) => render(message, html)));
}

function rerender(filter) {
  for (const element of document.querySelectorAll("#chat .chat-message[data-message-id], .chat-popout .chat-message[data-message-id]")) {
    const message = game.messages.get(element.dataset.messageId);
    if (message && filter(message)) ui.chat?.updateMessage?.(message);
  }
}

function render(message, html) {
  const element = html?.querySelector ? html : html?.[0];
  const content = element?.querySelector(".message-content");
  if (!content) return;
  const card = content.querySelector(".hardwipe-chat-card");
  if (card?.matches(".hardwipe-heat-state-card, .hardwipe-lockdown-card")) return heatCard(message, element, card);
  if (card?.matches(".hardwipe-shield-card") && shieldCard(message, element, card)) return;
  if (card) return systemCard(message, element, card);
  if (message.type === "turn") return turnCard(message, element, content);
  if (message.type === "request") return requestCard(message, element, content);
  if (message.type in ROLL_KINDS || plainRoll(message, content)) return rollCard(message, element, content);
}

/* Hardwipe system cards ------------------------------------------------------------------------- */

function systemKind(message, card) {
  const flags = message.flags?.[MODULE_ID] ?? {};
  if (flags.kind) return flags.kind;
  const is = name => card.classList.contains(name);
  if (is("hardwipe-review-card") || flags.coverReview) return "review";
  if (is("hardwipe-wall-card")) return is("is-breach") ? "breach" : is("is-review") ? "review" : "wall";
  if (is("hardwipe-shield-card")) return is("hardwipe-card-danger") ? "breach" : "shield";
  if (flags.type === "hardwipe-death" || is("hardwipe-card-danger")) return "flatlined";
  const kicker = card.querySelector(".hardwipe-chat-kicker")?.textContent.trim();
  if (kicker === game.i18n.localize("HARDWIPE.Downed.Title")) return "downed";
  return "edge";
}

function systemCard(message, element, card) {
  const kind = systemKind(message, card);
  card.dataset.hwKind = kind;
  const kicker = card.querySelector(":scope > .hardwipe-chat-kicker");
  if (kicker && !kicker.querySelector(":scope > i")) kicker.insertAdjacentHTML("afterbegin", `<i class="fas ${SYSTEM_ICONS[kind]}" inert></i>`);
  element.classList.add("hardwipe-sys-message");
}

/* Shield Block: a targeting HUD over the shield's HP -------------------------------------------- */

/** Redraw a Shield Block card from its flags; false for a card without them (left in the plain card style). */
function shieldCard(message, element, card) {
  const flags = message.flags?.[MODULE_ID] ?? {};
  const max = Number(flags.max) || 0;
  if (!max) return false;
  const hp = Math.max(0, Number(flags.hp) || 0);
  const absorbed = Math.max(0, Number(flags.absorbed) || 0);
  const through = Math.max(0, Number(flags.remaining) || 0);
  const before = Math.min(max, hp + absorbed);
  const actor = game.actors.get(flags.actorId) ?? ChatMessage.implementation.getSpeakerActor(message.speaker);
  const name = actor?.items.get(flags.itemId)?.name ?? card.querySelector(".hardwipe-chat-title")?.textContent.trim() ?? "";
  const pct = value => `${Math.round(Math.min(1, Math.max(0, value / max)) * 100)}%`;
  const hud = document.createElement("div");
  hud.className = `hwsh${flags.broken ? " is-broken" : ""}`;
  hud.innerHTML = `<span class="hwsh-c is-tr"></span><span class="hwsh-c is-bl"></span>
    <div class="hwsh-lbl"><span>[${escapeHTML(t("Shield.Reaction"))}] ${escapeHTML(t("Shield.Label"))}</span><span>${escapeHTML(t("Shield.Dur", { hp: pad(hp), max: pad(max) }))}</span></div>
    <div class="hwsh-main"><div class="hwsh-icon">${escapeHTML(pad(Math.round(hp / max * 100)))}</div>
      <div><div class="hwsh-name">${escapeHTML(name)}</div><div class="hwsh-read"><span>${escapeHTML(t("Shield.In"))} <b>${absorbed + through}</b></span>`
    + `<span>${escapeHTML(t("Shield.Abs"))} <b class="is-abs">${absorbed}</b></span><span>${escapeHTML(t("Shield.Thru"))} <b class="is-thru">${through}</b></span></div></div></div>
    <div class="hwsh-ruler" style="--after: ${pct(hp)}; --before: ${pct(before)}; --cells: ${Math.min(max, 20)}" role="meter" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${hp}"><span class="hwsh-flash"></span></div>
    <div class="hwsh-ticks"><span>0</span><span>${Math.round(max / 2)}</span><span>${max}</span></div>
    ${flags.broken ? `<div class="hwsh-off">${escapeHTML(t("Shield.Offline"))}</div>` : ""}`;
  card.replaceWith(hud);
  element.classList.add("hardwipe-sys-message");
  return true;
}

/* Heat: the mission's chosen style ------------------------------------------------------------------ */

/** A meter cell per point of Heat (up to 24), coloured by the zone it falls in; new cells flash, cells lost stay as ghosts. */
function heatCells(heat) {
  const max = Number(heat?.max) || 0;
  if (!max) return "";
  const count = Math.min(max, 24);
  const from = Number(heat.from) || 0, to = Number(heat.to) || 0;
  const cells = [];
  for (let i = 1; i <= count; i++) {
    const value = i * max / count;
    const zone = value / max >= 0.75 ? "is-red" : value / max >= 0.5 ? "is-amber" : "is-green";
    if (value <= to) cells.push(`<i class="${zone}${value > from ? " is-new" : ""}"></i>`);
    else cells.push(`<i class="${value <= from ? "is-ghost" : ""}"></i>`);
  }
  const zones = ["clean", "hot", "critical", "lockdown"].map((zone, index) => `<span style="--at: ${[0, 50, 75, 100][index]}%">${escapeHTML(t(`Heat.Zone.${zone}`))}</span>`).join("");
  const reading = from === to ? `${pad(to)} / ${pad(max)}` : `${pad(from)} ▸ ${pad(to)} / ${pad(max)}`;
  return `<div class="hwh-meter"><div class="hwh-meter-top"><span>${escapeHTML(t("Heat.Meter"))}</span><b>${escapeHTML(reading)}</b></div>`
    + `<div class="hwh-cells" style="--count: ${count}">${cells.join("")}</div><div class="hwh-zones">${zones}</div></div>`;
}

// Radar contacts, in the order they appear as Heat climbs.
const BLIPS = [[58, 28], [30, 60], [66, 56], [22, 30], [44, 14], [14, 46], [72, 38], [46, 74], [40, 42]];
const BLIP_COUNT = { clean: 0, hot: 2, critical: 5, lockdown: 9 };

const HEAT_BUILDERS = {
  broadcast: ({ kicker, title, sub, meta, state, heat }) => `<div class="hwh-tape"></div>
    <span class="hwh-kick">${escapeHTML(kicker)}</span>
    <div class="hwh-title" data-text="${escapeHTML(title)}">${escapeHTML(title)}</div>
    ${state === "lockdown" ? `<span class="hwh-stamp">${escapeHTML(t("Heat.Stamp"))}</span>` : ""}
    ${heatCells(heat)}
    <div class="hwh-ticker"><span>${escapeHTML(`// ${sub} // ${kicker} // ${sub} //`)}</span></div>
    ${meta ? `<div class="hwh-meta">${escapeHTML(meta)}</div>` : ""}
    ${state === "critical" || state === "lockdown" ? `<div class="hwh-tape is-foot"></div>` : ""}`,
  feed: ({ kicker, title, sub, state, heat }) => {
    const letters = [...title].map(ch => ch === " " ? " " : `<span>${escapeHTML(ch)}</span>`).join("");
    const pct = heat?.max ? Math.round(Math.min(1, (Number(heat.to) || 0) / heat.max) * 100) : null;
    return `<div class="hwh-top"><span class="hwh-rec"></span>${state === "lockdown" ? "" : `${escapeHTML(t("Heat.Rec"))} · `}${escapeHTML(kicker)}`
      + `<span class="hwh-ch">${heat?.max ? `CH-${pad(heat.to)}` : ""}</span></div>
      <div class="hwh-body"><div class="hwh-title">${letters}</div>${pct === null ? "" : `<div class="hwh-pct">${pct}%<small>${escapeHTML(t("Heat.Meter"))}</small></div>`}</div>
      <div class="hwh-vu">${"<i></i>".repeat(14)}</div>
      <div class="hwh-sub">&gt; ${escapeHTML(sub)}_</div>
      <span class="hwh-wm">${escapeHTML(t(`Heat.Mark.${state}`))}</span>`;
  },
  scanner: ({ kicker, title, sub, meta, state, heat }) => {
    const blips = BLIPS.slice(0, BLIP_COUNT[state] ?? 0).map(([x, y]) => `<i style="left: ${x}px; top: ${y}px"></i>`).join("");
    const level = heat?.max ? `<span class="hwh-level">${pad(heat.to)}<span style="--p: ${Math.round(Math.min(1, (Number(heat.to) || 0) / heat.max) * 100)}%"></span>${pad(heat.max)}</span>` : "";
    return `<div class="hwh-radar">${blips}</div>
      <div class="hwh-side"><span class="hwh-kick">${escapeHTML(kicker)}</span><span class="hwh-title">${escapeHTML(title)}</span>
        <span class="hwh-sub">${escapeHTML(sub)}</span>${level}${meta ? `<span class="hwh-meta">${escapeHTML(meta)}</span>` : ""}</div>`;
  }
};

function heatCard(message, element, card) {
  const flags = message.flags?.[MODULE_ID] ?? {};
  const heat = flags.heat ?? null; // { from, to, max, style }, recorded since 0.7.40.
  const style = HEAT_STYLES.includes(heat?.style) ? heat.style : "broadcast";
  const state = ["lockdown", "critical", "hot", "clean"].find(key => flags.nextStatus === key || card.classList.contains(`is-${key}`)) ?? "hot";
  const down = (flags.direction ?? (card.classList.contains("is-down") ? "down" : "up")) === "down";
  const text = selector => card.querySelector(selector)?.textContent.trim() ?? "";
  const view = document.createElement("div");
  view.className = `hwh hwh-${style} is-${state}${down ? " is-down" : ""}`;
  view.innerHTML = HEAT_BUILDERS[style]({
    kicker: text(".hardwipe-chat-kicker"), title: text(".hardwipe-chat-title"), sub: text(".hardwipe-chat-subtitle"), meta: text(".hardwipe-chat-meta"),
    state, heat
  });
  card.replaceWith(view);
  element.classList.add("hardwipe-sys-message");
}

/* dnd5e messages framed as cards ---------------------------------------------------------------- */

/** A plain roll with nothing else in it (a /roll, a macro's roll), not another module's card. */
function plainRoll(message, content) {
  if (message.type !== "base" || !message.rolls?.length || message.flags?.["midi-qol"]) return false;
  const kids = [...content.children];
  return kids.length > 0 && kids.every(node => node.classList.contains("dice-roll"));
}

/** Wrap a message's native content in a card: a bar with an icon, label and tag, then a title. */
function frame(content, { kind, icon, label, tag = "", title = "" }) {
  const card = document.createElement("div");
  card.className = "hardwipe-chat-card hardwipe-msg-card";
  card.dataset.hwKind = kind;
  card.innerHTML = `<div class="hardwipe-chat-kicker"><i class="fas ${icon}" inert></i><span>${escapeHTML(label)}</span>`
    + `${tag ? `<span class="hardwipe-msg-tag">${escapeHTML(tag)}</span>` : ""}</div>`
    + `${title ? `<div class="hardwipe-chat-title">${escapeHTML(title)}</div>` : ""}<div class="hardwipe-msg-body"></div>`;
  card.querySelector(".hardwipe-msg-body").append(...content.childNodes);
  content.append(card);
  return card;
}

function rollCard(message, element, content) {
  const [kind, icon] = ROLL_KINDS[message.type] ?? ["roll", "fa-dice"];
  const roll = message.rolls?.[0];
  const flavor = String(message.flavor ?? "").trim();
  const item = associatedItem(message);
  const die = roll?.dice?.[0]?.faces;
  // The bar names the roll; the title says what it was for (the label already says "Hit Die").
  const title = { hitDie: "", hitPoints: item?.name ?? "", formula: item?.name ?? flavor.split(" - ")[0], recharge: item?.name ?? "" }[kind] ?? flavor;
  let tag = roll?.formula ?? "";
  if (kind === "hitDie" || kind === "hitPoints") tag = die ? `d${die}` : tag;
  if (kind === "formula" && flavor.includes(" - ")) tag = flavor.split(" - ").slice(1).join(" - ");
  if (kind === "recharge" && roll) tag = t(roll.isSuccess ? "Roll.Recharged" : "Roll.NotRecharged");
  const card = frame(content, { kind, icon, label: t(`Roll.${kind}`), tag, title });
  if (kind === "recharge" && roll) card.classList.add(roll.isSuccess ? "is-success" : "is-failure");
  element.classList.add("hardwipe-dice-message");
}

/** The message's item, if any. dnd5e's lookup can throw on a message with an actor and no item. */
function associatedItem(message) {
  try { return message.getAssociatedItem?.() ?? null; } catch { return null; }
}

function requestCard(message, element, content) {
  const system = message.system ?? {};
  const dc = Number(system.data?.target ?? system.data?.dc);
  // The title names the roll ("Dexterity Saving Throw"); the bar adds the DC when there is one.
  const handler = `HARDWIPE.Msg.Request.${system.handler}`;
  const title = String(message.flavor ?? "").trim() || (game.i18n.has(handler) ? game.i18n.localize(handler) : "");
  frame(content, { kind: "request", icon: "fa-bullhorn", label: t("Request.Label"), tag: Number.isFinite(dc) && dc > 0 ? t("DC", { dc }) : "", title });
  // Each Roll button says what it rolls, not just an icon.
  for (const button of content.querySelectorAll(".targets button[data-action=handleRequest]")) {
    if (!button.querySelector(".hardwipe-msg-button-label")) button.insertAdjacentHTML("beforeend", `<span class="hardwipe-msg-button-label">${escapeHTML(t("Request.Roll"))}</span>`);
  }
  element.classList.add("hardwipe-request-message");
}

/* Turn start ------------------------------------------------------------------------------------- */

/** The round and the turn order as posted (hidden combatants left out), so the card stays true to that moment. */
function snapshotTurn(message) {
  const combat = game.combats.get(message.system?.origin?.combat) ?? game.combat;
  if (!combat) return;
  const turns = (combat.turns ?? []).filter(combatant => !combatant.hidden);
  message.updateSource({
    [`flags.${MODULE_ID}.round`]: combat.round,
    [`flags.${MODULE_ID}.turn`]: {
      index: turns.findIndex(combatant => combatant.id === message.system?.origin?.combatant),
      order: turns.map(combatant => ({ name: combatant.name, init: Number.isFinite(combatant.initiative) ? combatant.initiative : null }))
    }
  });
}

const slug = name => String(name ?? "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s-]+/g, "_");

function turnCard(message, element, content) {
  const flags = message.flags?.[MODULE_ID] ?? {};
  let style = "strip";
  try { style = game.settings.get(MODULE_ID, "turnCardStyle"); } catch { /* Not registered yet. */ }
  if (!TURN_STYLES.includes(style)) style = "strip";
  // From the speaker: dnd5e's own actor getter fails on Ready Set Midi's message class.
  const name = ChatMessage.implementation.getSpeakerActor(message.speaker)?.name ?? message.alias ?? "";
  const round = Number.isFinite(flags.round) ? flags.round : null;
  const order = flags.turn?.order ?? [];
  const index = flags.turn?.index ?? -1;
  const current = order[index];
  const deltas = [...content.querySelectorAll(".deltas li.delta")].map(li => ({
    label: li.querySelector(".label")?.textContent.trim() ?? "", value: li.querySelector(".value")?.textContent.trim() ?? ""
  }));
  // The turn's activities stay dnd5e's own elements (their Use still works), shown as a play chip.
  const activities = [...content.querySelectorAll(".activities li.activity")];
  for (const li of activities) {
    const label = li.querySelector(".subtitle")?.textContent.trim() || li.querySelector(".title")?.textContent.trim() || "";
    li.querySelector("img")?.remove();
    const link = li.querySelector("[data-action=use]");
    if (link) link.innerHTML = `<span class="hwt-play">▶</span> ${escapeHTML(label)}`;
  }
  const acts = document.createElement("ul");
  acts.className = "hwt-acts";
  acts.append(...activities);
  const roundTag = round === null ? "" : `R${pad(round)}`;
  const deltaChips = deltas.map(delta => `<span class="hwt-chip">${escapeHTML(delta.label)} <b>${escapeHTML(delta.value)}</b></span>`).join("");

  const card = document.createElement("div");
  card.className = `hwt hwt-${style}`;
  if (style === "strip") {
    const ticks = order.length > 1 ? `<div class="hwt-ticks">${order.map((_, i) => `<i${i === index ? ' class="is-on"' : ""}></i>`).join("")}</div>` : "";
    const where = index >= 0 ? `${index + 1}/${order.length}${Number.isFinite(current?.init) ? ` · ${t("Init", { init: current.init })}` : ""}` : "";
    card.innerHTML = `<div class="hwt-row"><div class="hwt-rail"><i class="fas fa-hourglass-half" inert></i>${roundTag ? `<span>${roundTag}</span>` : ""}</div>
      <div class="hwt-main"><div class="hwt-top"><small>${escapeHTML(t("TurnLabel"))}</small><b>${escapeHTML(name)}</b>${where ? `<em>${escapeHTML(where)}</em>` : ""}</div>${ticks}</div></div>
      <div class="hwt-chips">${deltaChips}</div>`;
  } else if (style === "timeline") {
    const crowded = order.length > 5 ? " is-crowded" : "";
    const nodes = order.map((entry, i) => `<span class="hwt-node${i === index ? " is-on" : ""}"><span>${escapeHTML([...entry.name][0] ?? "?")}</span></span>`).join("");
    const names = order.map((entry, i) => `<span${i === index ? ' class="is-on"' : ""}>${escapeHTML(slug(entry.name))}${Number.isFinite(entry.init) ? ` ${entry.init}` : ""}</span>`).join("");
    card.innerHTML = `<div class="hwt-head">${roundTag ? `<span class="hwt-seg">${roundTag}</span>` : ""}<b>${escapeHTML(name)}</b><small>● ${escapeHTML(t("UpNow"))}</small></div>
      ${order.length > 1 ? `<div class="hwt-track">${nodes}</div><div class="hwt-names${crowded}">${names}</div>` : ""}
      <div class="hwt-chips">${deltaChips}</div>`;
  } else {
    const stamp = round === null ? "" : `r${pad(round)}${index >= 0 ? `.${pad(index + 1)}` : ""} ::`;
    const lines = deltas.map(delta => `<div class="hwt-line is-sub"><span class="hwt-d">└</span> <span class="hwt-g">${escapeHTML(delta.value)}</span> ${escapeHTML(delta.label.toLowerCase())}</div>`).join("");
    card.innerHTML = `<div class="hwt-line"><span class="hwt-p">▸</span> <span class="hwt-d">${escapeHTML(stamp)}</span> <span class="hwt-p">TURN_START</span> <span class="hwt-d">::</span> <span class="hwt-n">${escapeHTML(slug(name))}</span><span class="hwt-cur"></span></div>${lines}
      <div class="hwt-chips"></div>`;
  }
  card.querySelector(".hwt-chips").append(acts);
  if (!deltas.length && !activities.length) card.querySelector(".hwt-chips").remove();
  content.replaceChildren(card);
  element.classList.add("hardwipe-turn-message");
}
