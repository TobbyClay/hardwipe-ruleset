import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { rendersRequest } from "./hardwipe-requests.js";
import { arrivalWindow } from "./hardwipe-attack-cards.js";
import { cutInHTML, stabilize } from "./hardwipe-edge.js";
import { DownedManager, EdgeManager, StrikesManager, canControlActor } from "./hardwipe-state.js";

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
  // A Downed card's Stabilize button follows its actor (Edge spent, back on their feet).
  Hooks.on("updateActor", actor => rerender(message => message.flags?.[MODULE_ID]?.actorId === actor.id && message.flags?.[MODULE_ID]?.kind === "downed"));
}

/**
 * Hardwipe's cards are dark terminals in either colour scheme. In light mode Foundry's and dnd5e's light text colours
 * would reach inside them (a roll's total, its dice), so a card's content is pinned to the dark theme. Typed chat
 * follows the chat's own theme instead. Registered last, once every card renderer has marked its message.
 */
export function registerCardTheme() {
  Hooks.once("setup", () => Hooks.on("dnd5e.renderChatMessage", (message, html) => {
    const element = html instanceof HTMLElement ? html : html?.[0];
    if (!element || element.classList.contains("hardwipe-talk")) return;
    if (![...element.classList].some(name => /^hardwipe-.+-message$/.test(name))) return;
    element.querySelector(".message-content")?.classList.add("themed", "theme-dark");
  }));
}

function rerender(filter) {
  for (const element of document.querySelectorAll("#chat .chat-message[data-message-id], .chat-popout .chat-message[data-message-id]")) {
    const message = game.messages.get(element.dataset.messageId);
    if (message && filter(message)) ui.chat?.updateMessage?.(message);
  }
}

function render(message, html) {
  if (!message.isContentVisible) return;
  const element = html?.querySelector ? html : html?.[0];
  const content = element?.querySelector(".message-content");
  if (!content) return;
  const card = content.querySelector(".hardwipe-chat-card");
  if (card?.matches(".hardwipe-heat-state-card, .hardwipe-lockdown-card")) return heatCard(message, element, card);
  if (card?.matches(".hardwipe-shield-card") && shieldCard(message, element, card)) return;
  if (card) return systemCard(message, element, card);
  if (isTalk(message, content)) return talkCard(message, element, content);
  if (message.type === "turn") return turnCard(message, element, content);
  if (rollPrompt(message)) return promptCard(message, element, content);
  // Skill and save requests are drawn by hardwipe-requests.js; others (a party rest) keep this frame.
  if (message.type === "request" && !rendersRequest(message)) return requestCard(message, element, content);
  if (message.type in ROLL_KINDS || plainRoll(message, content)) return rollCard(message, element, content);
}

/* Typed messages ---------------------------------------------------------------------------------- */

const TALK_GROUP_MS = 5 * 60 * 1000;
const PHONE = "smartphone-widget";

/** Smartphone Widget's chat copy of a text (not its group notices). */
const phoneFlags = message => message.flags?.[PHONE]?.isSmartphoneMessage ? message.flags[PHONE] : null;

/**
 * Something a person typed: a plain message with no rolls and no card. Other modules' data rules a message out,
 * except a Smartphone Widget text, which is a message someone typed on their phone.
 */
function isTalk(message, content) {
  if (message.type !== "base" || message.rolls?.length) return false;
  if (Object.keys(message.flags ?? {}).some(scope => scope !== "core" && scope !== PHONE)) return false;
  if (message.flags?.[PHONE] && !phoneFlags(message)) return false;
  return !content.querySelector(".dice-roll, .chat-card, .card-buttons, [data-action]");
}

/** Public (Foundry's default mode) is the plain message; phone texts, in character, emotes and whispers are marked. */
function talkKind(message) {
  const phone = phoneFlags(message);
  if (phone) return phone.isSystemMessage ? "notice" : "phone";
  if (message.whisper?.length) return "whisper";
  if (message.style === CONST.CHAT_MESSAGE_STYLES.EMOTE) return "emote";
  if (message.style === CONST.CHAT_MESSAGE_STYLES.IC) return "ic";
  return "public";
}

/** Who a message really comes from: the speaking actor for phone texts (the GM's client posts them), else the author. */
function talkVoice(message, kind) {
  const actor = ChatMessage.implementation.getSpeakerActor?.(message.speaker) ?? null;
  return kind === "phone" || kind === "notice" ? `actor:${actor?.id ?? message.speaker?.alias ?? ""}` : `user:${message.author?.id ?? ""}`;
}

/** This viewer's own message, drawn on the right: what they typed, or a phone text from their character. */
function isMine(message, kind) {
  if (kind !== "phone") return message.author?.id === game.user.id;
  const actor = ChatMessage.implementation.getSpeakerActor?.(message.speaker) ?? null;
  if (!actor) return false;
  return game.user.isGM ? !actor.hasPlayerOwner : game.user.character?.id === actor.id || actor.isOwner;
}

/**
 * Typed messages as a comm feed: notched portraits and cut-corner bubbles, the viewer's own on the right. A name line
 * (the player's colour, the time) heads each run; messages in a row from the same voice join the bubble run. Public
 * names the player and their character. Marked: in character (cyan edge and a signal meter, red for anyone who isn't a
 * player character), an emote (a status line across the feed), a whisper (dashed violet, and to whom) and a phone text
 * from Smartphone Widget (to whom, by phone). Foundry's own header controls stay.
 */
function talkCard(message, element, content) {
  const kind = talkKind(message);
  const mine = isMine(message, kind);
  element.classList.add("hardwipe-talk", `is-${kind}`);
  element.classList.toggle("is-mine", mine);
  const color = message.author?.color?.css ?? (message.author?.color ? String(message.author.color) : "");
  const speaker = ChatMessage.implementation.getSpeakerActor?.(message.speaker) ?? null;
  // A phone text takes its sender's player colour, not the GM's who posted it.
  const owner = kind === "phone" && speaker ? game.users.find(user => !user.isGM && user.character?.id === speaker.id) : null;
  const tint = owner?.color?.css ?? color;
  if (tint) element.style.setProperty("--hw-talk-user", tint);
  if (kind === "ic" && speaker?.type !== "character") element.classList.add("is-npc");
  const subtitle = element.querySelector(".message-sender .subtitle");
  let tag = "";
  if (kind === "public") tag = message.author?.character?.name ?? "";
  else if (kind === "ic") tag = t("Talk.InCharacter");
  else if (kind === "whisper") {
    const names = message.whisper.filter(id => id !== message.author?.id).map(id => game.users.get(id)?.name).filter(Boolean);
    tag = names.length ? t("Talk.WhisperTo", { names: names.join(", ") }) : t("Talk.Whisper");
  } else if (kind === "phone" || kind === "notice") {
    // Smartphone Widget heads its chat copy "[PHONE] Mags → Juno": the recipient becomes the tag, the line goes.
    const header = content.querySelector(":scope > .phone-message-header");
    const text = header?.textContent.replace(/^\s*\[[^\]]*\]\s*/, "").trim() ?? "";
    header?.remove();
    const to = text.includes("→") ? text.split("→").slice(1).join("→").trim() : "";
    tag = kind === "notice" ? text : to ? t("Talk.PhoneTo", { names: to }) : t("Talk.Phone");
  }
  if (subtitle) {
    subtitle.textContent = tag;
    subtitle.classList.toggle("hardwipe-talk-tag", kind !== "public");
  }
  if (kind === "ic") element.querySelector(".message-sender .name-stacked")?.insertAdjacentHTML("afterbegin", '<span class="hardwipe-talk-signal" aria-hidden="true"><i></i><i></i><i></i></span>');
  if (kind === "emote") {
    // Foundry writes the speaker's name in front of an emote: it becomes the line's name.
    const alias = String(message.speaker?.alias ?? "");
    const first = content.firstChild;
    if (alias && first?.nodeType === Node.TEXT_NODE && first.textContent.trimStart().startsWith(alias)) {
      first.textContent = first.textContent.trimStart().slice(alias.length);
      const name = document.createElement("b");
      name.className = "hardwipe-talk-name";
      name.textContent = alias;
      content.prepend(name);
    }
  }
  if (joinsPrevious(message, kind)) element.classList.add("is-cont");
}

/** The same voice again, in the same mode, a moment later: it joins the run above (emotes and notices stand alone). */
function joinsPrevious(message, kind) {
  if (kind === "emote" || kind === "notice") return false;
  const list = game.messages.contents;
  const index = list.indexOf(message);
  const previous = index > 0 ? list[index - 1] : null;
  if (!previous?.visible) return false;
  if ((message.timestamp ?? 0) - (previous.timestamp ?? 0) > TALK_GROUP_MS) return false;
  const content = document.createElement("div");
  content.innerHTML = previous.content ?? "";
  if (!isTalk(previous, content) || talkKind(previous) !== kind || talkVoice(previous, kind) !== talkVoice(message, kind)) return false;
  if (kind === "whisper" && String(previous.whisper) !== String(message.whisper)) return false;
  if (kind === "phone") return previous.content.match(/phone-message-header">([^<]*)/)?.[1] === message.content.match(/phone-message-header">([^<]*)/)?.[1];
  return kind !== "ic" || (previous.speaker?.alias === message.speaker?.alias && previous.speaker?.token === message.speaker?.token);
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
  if (["edge", "downed", "flatlined"].includes(kind)) survivalCard(message, element, card, kind);
}

const TRACES = {
  edge: "",
  // A pulse that falters and nearly fades: still alive.
  downed: "0,58 40,58 46,50 52,66 58,58 100,58 105,53 110,63 115,58 160,58 163,56 166,60 169,58 210,58",
  // Two beats, then nothing.
  flatlined: "0,58 30,58 38,20 46,90 54,58 84,58 92,30 100,82 108,58 210,58"
};

/**
 * Edge spent, Downed and Flatline as cut-in cards, in the family of the Edge plays: the band in the card's own colour,
 * whose card it is, and a scope (a draining cell, a faltering pulse, a pulse that stops) over the posted line. The
 * card's words come from what was posted, so older cards redraw the same way. A Downed card offers its owner
 * Stabilize while they hold Edge.
 */
function survivalCard(message, element, card, kind) {
  const actor = game.actors.get(message.flags?.[MODULE_ID]?.actorId) ?? ChatMessage.implementation.getSpeakerActor?.(message.speaker);
  const text = selector => card.querySelector(selector)?.textContent.trim() ?? "";
  const kicker = text(":scope > .hardwipe-chat-kicker") || t(`Survival.${kind}.Kicker`);
  const subtitle = text(":scope > .hardwipe-chat-subtitle");
  const strikes = kind === "flatlined" ? 3 : Math.max(0, Math.min(3, Number(actor?.getFlag?.(MODULE_ID, "strikes")) || 0));
  const pips = [0, 1, 2].map(i => `<rect class="hwe-spip${i < strikes ? " is-on" : ""}" x="${i * 18}" y="4" width="8" height="8" transform="rotate(45 ${i * 18 + 4} 8)"/>`).join("");
  const stage = kind === "edge"
    ? `<svg viewBox="0 0 278 96" aria-hidden="true"><rect class="hwe-cellb" x="40" y="26" width="150" height="44"/><rect class="hwe-nub" x="190" y="38" width="8" height="20"/>
        <rect class="hwe-charge hwe-drain" x="46" y="32" width="138" height="32"/><text class="hwe-plus is-spent hwe-pop" x="115" y="49">${escapeHTML(t("Survival.edge.Minus"))}</text>
        <path class="hwe-arc is-dim" d="M236 18 L222 50 L234 50 L224 80"/></svg>`
    : `<svg viewBox="0 0 278 96" aria-hidden="true"><polyline class="hwe-ecg hwe-draw" points="${TRACES[kind]}"/>
        <text class="hwe-big hwe-pop" x="270" y="40">${escapeHTML(t(`Survival.${kind}.Big`))}</text>
        <g transform="translate(222 66)">${pips}</g></svg>`;
  const canStabilize = kind === "downed" && actor && canControlActor(actor) && EdgeManager.get(actor) > 0 && strikes < 3 && !actor.statuses?.has("dead")
    && (DownedManager.isDowned(actor) || Number(actor.system?.attributes?.hp?.value) <= 0);
  const content = card.parentElement;
  const holder = document.createElement("div");
  holder.innerHTML = cutInHTML({
    // The band says what happened; under the name, just which Strike this is.
    cls: `is-${kind} is-survival`, kicker, use: t(`Survival.${kind}.Use`),
    img: escapeHTML(actor?.img ?? "icons/svg/mystery-man.svg"), name: escapeHTML(actor?.name ?? message.speaker?.alias ?? ""),
    sub: kind === "edge" ? subtitle : strikes ? t("Survival.Strike", { n: strikes }) : "", stage,
    line: kind === "edge" ? t("Survival.edge.Line") : subtitle,
    cell: kind === "edge" ? `<span class="hwe-cell"><i></i>0/1</span>` : "",
    icon: `<i class="hwe-icon fas ${SYSTEM_ICONS[kind]}" inert></i>`,
    foot: canStabilize ? `<button type="button" class="hwe-btn is-go" data-hw-stabilize>${escapeHTML(t("Survival.Stabilize"))}</button>` : "",
    fresh: arrivalWindow(message, "survival", 1600) > 0
  });
  const cut = holder.firstElementChild;
  card.replaceWith(cut);
  cut.querySelector("[data-hw-stabilize]")?.addEventListener("click", event => {
    event.preventDefault();
    event.currentTarget.disabled = true;
    void stabilize(actor);
  });
  if (content) content.classList.add("hardwipe-survival-content");
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
  const chips = diceChips(message.rolls ?? []);
  if (chips) card.querySelector(".hardwipe-msg-body")?.insertAdjacentHTML("afterbegin", chips);
  element.classList.add("hardwipe-dice-message");
}

/**
 * Each die as a chip, in roll order (a die's highest face lit, a 1 dimmed red; dropped dice struck), and any flat
 * bonus: the roll at a glance. The native total below still opens the full breakdown.
 */
function diceChips(rolls) {
  const out = [];
  for (const roll of rolls) {
    for (const term of roll.terms ?? []) {
      if (term instanceof foundry.dice.terms.DiceTerm) {
        for (const result of term.results ?? []) {
          const dropped = result.active === false || result.discarded;
          const cls = dropped ? "is-dropped" : result.result === term.faces ? "is-max" : result.result === 1 ? "is-min" : "";
          out.push(`<i class="${cls}" data-tooltip="d${term.faces}">${escapeHTML(result.result)}</i>`);
        }
      } else if (term instanceof foundry.dice.terms.NumericTerm && Number(term.number)) out.push(`<span>${escapeHTML(term.expression ?? term.number)}</span>`);
      else if (term instanceof foundry.dice.terms.OperatorTerm) out.push(`<em>${escapeHTML(term.operator)}</em>`);
    }
  }
  return out.length ? `<div class="hardwipe-roll-chips">${out.join("")}</div>` : "";
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
  // The DC shows only where dnd5e would show it (its challenge visibility setting).
  const showDC = Number.isFinite(dc) && dc > 0 && message.shouldDisplayChallenge !== false;
  frame(content, { kind: "request", icon: "fa-bullhorn", label: t("Request.Label"), tag: showDC ? t("DC", { dc }) : "", title });
  // dnd5e heads the list "Party members"; a request for one character needs no heading.
  if ((system.targets?.length ?? 0) <= 1) content.querySelector(".targets > strong")?.remove();
  // Each Roll button says what it rolls, not just an icon.
  for (const button of content.querySelectorAll(".targets button[data-action=handleRequest]")) {
    if (!button.querySelector(".hardwipe-msg-button-label")) button.insertAdjacentHTML("beforeend", `<span class="hardwipe-msg-button-label">${escapeHTML(t("Request.Roll"))}</span>`);
  }
  element.classList.add("hardwipe-request-message");
}

/** A roll request posted from a roll link (dnd5e's "prompt"): checks, skills, saves and tools only. */
const PROMPT_ROLLS = new Set(["check", "skill", "save", "tool"]);
function rollPrompt(message) {
  const buttons = message.type === "prompt" ? message.system?.buttons ?? [] : [];
  return buttons.length > 0 && buttons.every(button => PROMPT_ROLLS.has(button.type));
}

/** "Athletics check", "Dexterity saving throw", "Strength check", "Thieves' Tools check". */
export function rollRequestTitle({ type, skill, ability, tool }) {
  const label = config => game.i18n.localize(config?.label ?? "");
  if (type === "skill") return t("Request.SkillTitle", { skill: label(CONFIG.DND5E.skills?.[skill]) || skill });
  if (type === "save") return t("Request.SaveTitle", { ability: label(CONFIG.DND5E.abilities?.[ability]) || ability });
  if (type === "tool") {
    const name = dnd5e.documents?.Trait?.keyLabel?.(tool, { trait: "tool" }) ?? tool;
    return t("Request.ToolTitle", { tool: name });
  }
  return t("Request.CheckTitle", { ability: label(CONFIG.DND5E.abilities?.[ability]) || ability });
}

/**
 * The GM's quick request from a roll link, framed like the party request: what to roll and, where dnd5e shows it,
 * the DC. dnd5e's own Roll buttons stay, so anyone can still roll it for their own character.
 */
function promptCard(message, element, content) {
  const buttons = message.system.buttons;
  const single = buttons.length === 1 ? buttons[0] : null;
  const dc = single && message.shouldDisplayChallenge && Number(single.dc) > 0 ? t("DC", { dc: single.dc }) : "";
  frame(content, { kind: "request", icon: "fa-bullhorn", label: t("Request.Label"), tag: dc, title: single ? rollRequestTitle(single) : String(message.flavor ?? "").trim() });
  content.querySelector(".hardwipe-msg-card")?.classList.add("is-prompt");
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
