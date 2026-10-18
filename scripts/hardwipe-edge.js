import { MODULE_ID, EdgeManager, StrikesManager, DownedManager, canControlActor, resolveActor, escapeHTML } from "./hardwipe-state.js";
import { arrivalWindow, reruleTarget, saveState, resyncSaveTarget } from "./hardwipe-attack-cards.js";

/**
 * Edge plays. One point of Edge buys one immediate effect, chosen in the Spend picker:
 * - Reroll: any single die on any card, anyone's. The new die is rolled at once; the player who spent the Edge
 *   (or the GM) keeps either result, on the card the die came from. Taking the new one writes it the way
 *   Ready Set Midi's own die reroll does (through the Midi workflow on the client that holds it, else the
 *   message), so the card's own logic follows: an attack goes back to the GM's review, damage already applied
 *   is adjusted. A rerolled save also moves its target between the spell's saved and failed lists.
 * - Interrupt: one action or bonus action, now, even on someone else's turn. The Turn tab spends it on the next
 *   such use instead of asking about the reaction; it lapses when the turn moves on.
 * - Stabilize: from 0 back to 1 HP, Downed cleared, and the Strike from going down taken back.
 * - Execute: a targeted mook (an NPC without Legendary Resistance) drops to 0 HP with no damage roll.
 * Each play posts its own card (a slim line for Reroll); an award posts a Charged card.
 */

const FLAG = "edgePlay";        // Message flag: the play and its state.
const INTERRUPT = "edgeInterrupt"; // Actor flag: { combat, round, turn, state, messageId }.
const RECENT = 8;               // Cards offered by the Reroll die picker.
const ARRIVAL_MS = 1600;
const BOLT_PATH = "M18 0 L4 22 L13 22 L9 40 L27 14 L17 14 L23 0 Z";

const t = (key, data) => data ? game.i18n.format(`HARDWIPE.EdgePlay.${key}`, data) : game.i18n.localize(`HARDWIPE.EdgePlay.${key}`);
let socket = null;

export function registerEdgePlays() {
  registerSocket();
  Hooks.once("socketlib.ready", registerSocket);
  // After the other card renderers (registered earlier, also at setup), so the choice strip lands in the card's
  // finished layout; still before the chat log first draws.
  Hooks.once("setup", () => Hooks.on("dnd5e.renderChatMessage", (message, html) => onRender(message, html)));
  for (const hook of ["createChatMessage", "updateChatMessage"]) Hooks.on(hook, message => refreshSource(message));
  Hooks.on("combatTurnChange", () => {
    for (const message of game.messages.contents.slice(-40)) {
      if (message.flags?.[MODULE_ID]?.[FLAG]?.play === "interrupt") ui.chat?.updateMessage?.(message);
    }
  });
}

function registerSocket() {
  if (socket || !globalThis.socketlib) return;
  socket = socketlib.registerModule(MODULE_ID);
  socket?.register("edgeRerollApply", target => applyReroll(target));
  socket?.register("edgeExecute", (tokenUuid, actorUuid) => gmExecute(tokenUuid, actorUuid));
}

/* The picker ---------------------------------------------------------------------------------------- */

/** Spend opens the picker: the four plays (greyed with why when they can't apply now) and a plain spend. */
export async function openEdgePicker(actor) {
  actor = resolveActor(actor);
  if (!actor || !canControlActor(actor)) return;
  if (EdgeManager.get(actor) < 1) return ui.notifications.warn(game.i18n.localize("HARDWIPE.Edge.None"));
  const states = playStates(actor);
  const tile = play => {
    const state = states[play];
    return `<button type="button" class="hardwipe-edge-tile is-${play}" data-play="${play}"${state.ok ? "" : " disabled"}>
      <b>${escapeHTML(t(`${play}.Name`))}</b><span>${escapeHTML(t(`${play}.Rule`))}</span><small>${escapeHTML(state.note)}</small></button>`;
  };
  let chosen = null;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: t("PickerTitle"), icon: "fa-solid fa-bolt" },
    classes: ["hardwipe-dialog", "is-edge", "hardwipe-edge-picker"],
    position: { width: 380 },
    content: `<p class="hardwipe-edge-hold">${escapeHTML(t("PickerHold", { name: actor.name }))}</p>
      <div class="hardwipe-edge-tiles">${["reroll", "interrupt", "stabilize", "execute"].map(tile).join("")}</div>`,
    buttons: [
      { action: "other", label: t("Other"), icon: "fa-solid fa-bolt" },
      { action: "cancel", label: game.i18n.localize("Cancel"), default: true }
    ],
    render: (event, dialog) => {
      for (const button of dialog.element.querySelectorAll("[data-play]")) {
        button.addEventListener("click", () => { chosen = button.dataset.play; void dialog.close(); });
      }
    },
    rejectClose: false
  });
  if (answer === "other") return EdgeManager.spend(actor, game.i18n.localize("HARDWIPE.Edge.GenericReason"));
  if (!chosen || !states[chosen]?.ok) return;
  if (chosen === "reroll") return startReroll(actor);
  if (chosen === "interrupt") return interrupt(actor);
  if (chosen === "stabilize") return stabilize(actor);
  if (chosen === "execute") return execute(actor);
}

/** Whether each play applies right now, and the line under its name. */
function playStates(actor) {
  const hp = Number(actor.system?.attributes?.hp?.value);
  const dead = actor.statuses?.has("dead") || StrikesManager.get(actor) >= 3;
  const down = DownedManager.isDowned(actor) || hp <= 0;
  const combat = combatFor(actor);
  const live = liveInterrupt(actor);
  const target = executeTarget();
  return {
    reroll: recentRolls().length ? { ok: true, note: t("reroll.Ready") } : { ok: false, note: t("reroll.NoRolls") },
    interrupt: live ? { ok: false, note: t("interrupt.Held") } : combat?.started ? { ok: true, note: t("Ready") } : { ok: false, note: t("interrupt.NoCombat") },
    stabilize: !dead && down ? { ok: true, note: t("Ready") } : { ok: false, note: t(dead ? "stabilize.Dead" : "stabilize.NotDown") },
    execute: target.ok ? { ok: true, note: t("execute.Target", { name: target.token.name }) } : { ok: false, note: target.note }
  };
}

/* Cards ---------------------------------------------------------------------------------------------- */

async function postPlay(actor, data, fallback) {
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<div class="hardwipe-edge-play-text">${escapeHTML(fallback)}</div>`,
    flags: { [MODULE_ID]: { [FLAG]: { actorId: actor.id, userId: game.user.id, ...data } } }
  });
}

/** Award: Edge 0 -> 1 and a Charged card. One is the most anyone holds. */
export async function awardEdge(actor, by = game.user.name) {
  actor = resolveActor(actor);
  if (!actor) return false;
  if (EdgeManager.get(actor) >= 1) {
    ui.notifications.warn(t("AlreadyHolding", { name: actor.name }));
    return false;
  }
  if (!await EdgeManager.award(actor)) return false;
  await postPlay(actor, { play: "charged", by }, t("charged.Fallback", { name: actor.name }));
  return true;
}

function onRender(message, html) {
  const element = html instanceof HTMLElement ? html : html?.[0];
  if (!element || !message.isContentVisible) return;
  const data = message.flags?.[MODULE_ID]?.[FLAG];
  if (data) return renderPlay(message, element, data);
  decorateSource(message, element);
}

function renderPlay(message, element, data) {
  const content = element.querySelector(".message-content");
  if (!content) return;
  element.classList.add("hardwipe-edge-message");
  const actor = game.actors.get(data.actorId);
  const img = escapeHTML(actor?.img ?? "icons/svg/mystery-man.svg");
  const name = escapeHTML(actor?.name ?? message.speaker?.alias ?? "");
  const fresh = arrivalWindow(message, "edge", ARRIVAL_MS) > 0;
  if (data.play === "reroll") {
    content.innerHTML = rerollLine(data, img, name, fresh);
    return;
  }
  const view = PLAY_VIEWS[data.play]?.(data, actor, message);
  if (!view) return;
  const use = t(`${data.play}.Name`);
  content.innerHTML = `<div class="hwe is-${data.play}${fresh ? " is-fresh" : ""}">
    <div class="hwe-slash"><span class="hwe-band"></span><span class="hwe-kick">${escapeHTML(t("Kicker"))}</span>
      <span class="hwe-use${use.length > 7 ? " is-long" : ""}">${escapeHTML(use)}</span>${bolt("hwe-bolt")}</div>
    <div class="hwe-who"><img src="${img}" alt=""><div><b>${name}</b><small>${escapeHTML(view.sub)}</small></div>
      <span class="hwe-cell${data.play === "charged" ? " is-full" : ""}"><i></i>${data.play === "charged" ? "1" : "0"}/1</span></div>
    <div class="hwe-stage">${view.stage}<span class="hwe-line">${escapeHTML(view.line)}</span></div>
    ${view.stamp ? `<span class="hwe-stamp">${escapeHTML(view.stamp)}</span>` : ""}
    ${view.foot ? `<div class="hwe-foot">${view.foot}</div>` : `<div class="hwe-gap"></div>`}
  </div>`;
  for (const button of content.querySelectorAll("[data-edge-slot]")) {
    button.addEventListener("click", event => {
      event.preventDefault();
      if (actor) void useInterrupt(actor, button.dataset.edgeSlot, "");
    });
  }
}

const bolt = cls => `<svg class="${cls}" viewBox="0 0 30 40" aria-hidden="true"><path d="${BOLT_PATH}"/></svg>`;

const PLAY_VIEWS = {
  interrupt(data, actor) {
    const state = interruptState(data);
    const used = state === "used";
    const turnName = data.turnName || "";
    const canUse = state === "ready" && actor && canControlActor(actor);
    const slotLabel = used ? t(data.slot === "bonus" ? "interrupt.UsedBonus" : "interrupt.UsedAction") : t("interrupt.One");
    const stage = `<svg viewBox="0 0 278 96" class="hwe-tear" aria-hidden="true">
      <text class="hwe-lbl" x="8" y="16">${escapeHTML(t("interrupt.TurnOf", { round: data.round, name: turnName }).toLocaleUpperCase())}</text>
      <g class="hwe-tear-l"><path class="hwe-bar" d="M8 30 H100 L94 40 L102 50 L96 60 L100 70 H8 Z"/><path class="hwe-zig" d="M100 30 L94 40 L102 50 L96 60 L100 70"/></g>
      <g class="hwe-tear-r"><path class="hwe-bar is-after" d="M178 30 L184 40 L176 50 L182 60 L178 70 H270 V30 Z"/><path class="hwe-zig" d="M178 30 L184 40 L176 50 L182 60 L178 70"/>
        <text class="hwe-lbl" x="200" y="86">${escapeHTML(t(state === "ready" ? "interrupt.Paused" : "interrupt.Resumes").toLocaleUpperCase())}</text>
        ${state === "ready" ? `<rect class="hwe-pause" x="218" y="42" width="5" height="16"/><rect class="hwe-pause" x="227" y="42" width="5" height="16"/>` : ""}</g>
      <g class="hwe-pop"><rect class="hwe-slot" x="117" y="20" width="44" height="44"/>
        <image href="${escapeHTML(actor?.img ?? "")}" x="119" y="22" width="40" height="40" preserveAspectRatio="xMidYMid slice"/>
        <rect class="hwe-one" x="105" y="70" width="68" height="16"/><text class="hwe-one-t" x="139" y="78">${escapeHTML(used ? (data.item || slotLabel) : t("interrupt.OneAction")).toLocaleUpperCase()}</text></g></svg>`;
    return {
      sub: t("interrupt.Sub", { name: turnName }),
      stage,
      line: state === "ready" ? t("interrupt.LineReady") : state === "used" ? t("interrupt.LineUsed", { slot: slotLabel, name: turnName }) : t("interrupt.LineLapsed"),
      stamp: used ? t("interrupt.Done") : state === "lapsed" ? t("interrupt.Lapsed") : "",
      foot: canUse ? `<button type="button" class="hwe-btn is-go" data-edge-slot="action">${escapeHTML(t("interrupt.Action"))}</button>
        <span class="hwe-or">${escapeHTML(t("Or"))}</span>
        <button type="button" class="hwe-btn is-go" data-edge-slot="bonus">${escapeHTML(t("interrupt.Bonus"))}</button>` : ""
    };
  },
  stabilize(data) {
    const after = Math.max(0, Number(data.strikesAfter) || 0);
    const undone = Number(data.strikesBefore) > after;
    const pips = [0, 1, 2].map(i => {
      const cls = i < after ? "is-on" : undone && i === after ? "is-undo" : "";
      return `<rect class="hwe-spip ${cls}" x="${i * 18}" y="4" width="8" height="8" transform="rotate(45 ${i * 18 + 4} 8)"/>`;
    }).join("");
    return {
      sub: t("stabilize.Sub"),
      stage: `<svg viewBox="0 0 278 96" aria-hidden="true">
        <polyline class="hwe-ecg is-dead" points="0,58 70,58"/>
        <polyline class="hwe-ecg hwe-draw" points="70,58 86,58 92,50 98,66 104,58 120,58 128,18 136,84 144,58 168,58 174,48 180,64 186,58 210,58"/>
        <text class="hwe-big hwe-pop" x="270" y="40">1 HP</text><text class="hwe-small" x="270" y="54">${escapeHTML(t("stabilize.From"))}</text>
        <g transform="translate(222 66)">${pips}${undone ? `<line class="hwe-strike hwe-pop" x1="${after * 18 - 4}" y1="2" x2="${after * 18 + 12}" y2="16"/>` : ""}</g></svg>`,
      line: undone ? t("stabilize.LineUndone", { n: after }) : t("stabilize.Line", { n: after })
    };
  },
  execute(data) {
    const target = data.target ?? {};
    return {
      sub: target.name ?? "",
      stage: `<svg viewBox="0 0 278 96" aria-hidden="true">
        <image href="${escapeHTML(target.img ?? "")}" x="22" y="12" width="72" height="72" class="hwe-grey" preserveAspectRatio="xMidYMid slice"/>
        <g class="hwe-closein"><circle class="hwe-ret" cx="58" cy="48" r="30"/><line class="hwe-ret" x1="58" y1="10" x2="58" y2="26"/><line class="hwe-ret" x1="58" y1="70" x2="58" y2="86"/><line class="hwe-ret" x1="20" y1="48" x2="36" y2="48"/><line class="hwe-ret" x1="80" y1="48" x2="96" y2="48"/></g>
        <g class="hwe-slam"><rect class="hwe-stampbox" x="120" y="24" width="140" height="40" transform="rotate(-6 190 44)"/><text class="hwe-stampt" x="190" y="44" transform="rotate(-6 190 44)">${escapeHTML(t("execute.Dropped").toLocaleUpperCase())}</text></g></svg>`,
      line: t("execute.Line", { hp: target.hp ?? "?" })
    };
  },
  charged(data) {
    return {
      sub: data.by ? t("charged.From", { name: data.by }) : "",
      stage: `<svg viewBox="0 0 278 96" aria-hidden="true">
        <rect class="hwe-cellb" x="40" y="26" width="150" height="44"/><rect class="hwe-nub" x="190" y="38" width="8" height="20"/>
        <rect class="hwe-charge hwe-fill" x="46" y="32" width="138" height="32"/>
        <text class="hwe-plus hwe-pop" x="115" y="49">${escapeHTML(t("charged.Plus"))}</text>
        <path class="hwe-arc hwe-draw" d="M236 18 L222 50 L234 50 L224 80"/></svg>`,
      line: t("charged.Line")
    };
  }
};

/* Reroll --------------------------------------------------------------------------------------------- */

/** Cards with dice, newest first: what the die picker offers. */
function recentRolls() {
  const out = [];
  const list = game.messages.contents;
  for (let index = list.length - 1; index >= 0 && out.length < RECENT; index--) {
    const message = list[index];
    if (!message.isContentVisible || message.flags?.[MODULE_ID]?.[FLAG]) continue;
    const rolls = (message.rolls ?? []).map((roll, rollIndex) => ({ roll, rollIndex, dice: diceOf(roll) })).filter(entry => entry.dice.length);
    if (rolls.length) out.push({ message, rolls });
  }
  return out;
}

/** Every die result in a roll's own terms (not nested pools), with where it sits. */
function diceOf(roll) {
  const dice = [];
  (roll.terms ?? []).forEach((term, termIndex) => {
    if (!(term instanceof foundry.dice.terms.DiceTerm) || !Number(term.faces)) return;
    term.results.forEach((result, resultIndex) => dice.push({ termIndex, resultIndex, faces: Number(term.faces), value: Number(result.result), active: result.active !== false && !result.discarded }));
  });
  return dice;
}

function rollKind(message, roll) {
  if (roll instanceof CONFIG.Dice.DamageRoll) return "damage";
  if (roll instanceof CONFIG.Dice.D20Roll) {
    if (message.type === "usage" || message.flags?.["midi-qol"]) return "attack";
    return message.type === "save" || message.flags?.dnd5e?.roll?.type === "save" || roll.options?.rollType === "save" ? "save" : "d20";
  }
  return "other";
}

function rollLabel(message, roll) {
  const kind = rollKind(message, roll);
  const type = message.flags?.dnd5e?.roll?.type;
  const ability = message.flags?.dnd5e?.roll?.abilityId ?? roll.options?.ability ?? askedSave(message)?.ability;
  const abilityLabel = ability ? CONFIG.DND5E.abilities?.[ability]?.abbreviation?.toUpperCase?.() ?? String(ability).toUpperCase() : "";
  if (kind === "attack") return t("reroll.KindAttack");
  if (kind === "damage") return t("reroll.KindDamage", { formula: roll.formula });
  if (kind === "save") return t("reroll.KindSave", { ability: abilityLabel });
  if (type === "initiative" || message.getFlag?.("core", "initiativeRoll")) return t("reroll.KindInit");
  if (type === "skill") return t("reroll.KindCheck", { ability: CONFIG.DND5E.skills?.[message.flags.dnd5e.roll.skillId]?.label ?? "" });
  return roll.formula;
}

/** The save a card asked for (ability and DC), when this roll answers it: saves rolled through Midi carry neither. */
function askedSave(message) {
  const origin = game.messages.get(message.flags?.dnd5e?.originatingMessage ?? message.rolls?.[0]?.options?.originatingMessage);
  return origin?.flags?.[MODULE_ID]?.saves ?? null;
}

function cardLabel(message) {
  const item = message.getAssociatedItem?.() ?? null;
  const who = message.speaker?.alias ?? message.author?.name ?? "";
  return item ? `${who} · ${item.name}` : who;
}

/** Pick the die: recent cards and their dice, newest first; hovering a row lights its card in chat. */
async function startReroll(actor) {
  const cards = recentRolls();
  const html = cards.map(({ message, rolls }) => `<div class="hardwipe-edge-pick-card" data-message-id="${message.id}">
      <div class="hardwipe-edge-pick-head">${escapeHTML(cardLabel(message))}</div>
      ${rolls.map(({ roll, rollIndex, dice }) => `<div class="hardwipe-edge-pick-roll"><span>${escapeHTML(rollLabel(message, roll))}</span><span class="hardwipe-edge-pick-dice">
        ${dice.map(die => `<button type="button" class="hardwipe-edge-die${die.active ? "" : " is-dropped"}" data-roll="${rollIndex}" data-term="${die.termIndex}" data-result="${die.resultIndex}"
          data-tooltip="d${die.faces}">${die.value}</button>`).join("")}</span><b>${escapeHTML(roll.total)}</b></div>`).join("")}
    </div>`).join("");
  let picked = null;
  await foundry.applications.api.DialogV2.wait({
    window: { title: t("reroll.PickTitle"), icon: "fa-solid fa-dice-d20" },
    classes: ["hardwipe-dialog", "is-edge", "hardwipe-edge-pick"],
    position: { width: 380 },
    content: `<p class="hardwipe-edge-hold">${escapeHTML(t("reroll.PickHint"))}</p><div class="hardwipe-edge-pick-list">${html}</div>`,
    buttons: [{ action: "cancel", label: game.i18n.localize("Cancel"), default: true }],
    render: (event, dialog) => {
      for (const card of dialog.element.querySelectorAll(".hardwipe-edge-pick-card")) {
        const id = card.dataset.messageId;
        card.addEventListener("pointerenter", () => lightCard(id, true));
        card.addEventListener("pointerleave", () => lightCard(id, false));
      }
      for (const button of dialog.element.querySelectorAll(".hardwipe-edge-die")) {
        button.addEventListener("click", () => {
          const id = button.closest("[data-message-id]").dataset.messageId;
          picked = { messageId: id, rollIndex: Number(button.dataset.roll), termIndex: Number(button.dataset.term), resultIndex: Number(button.dataset.result) };
          lightCard(id, false);
          void dialog.close();
        });
      }
    },
    rejectClose: false
  });
  document.querySelectorAll(".hardwipe-edge-lit").forEach(node => node.classList.remove("hardwipe-edge-lit"));
  if (picked) return reroll(actor, picked);
}

function lightCard(id, on) {
  for (const node of document.querySelectorAll(`#chat .chat-message[data-message-id="${id}"], .chat-popout .chat-message[data-message-id="${id}"]`)) {
    node.classList.toggle("hardwipe-edge-lit", on);
    if (on) node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

/** Spend, roll the new die, and post the Reroll line: the choice itself waits on the source card. */
export async function reroll(actor, picked) {
  const message = game.messages.get(picked.messageId);
  const roll = message?.rolls?.[picked.rollIndex];
  const term = roll?.terms?.[picked.termIndex];
  const result = term?.results?.[picked.resultIndex];
  if (!roll || !result) return false;
  const old = Number(result.result);
  if (!await EdgeManager.spend(actor)) return false;
  const die = await new Roll(`1d${term.faces}`).evaluate();
  if (game.dice3d) await game.dice3d.showForRoll(die, game.user, true).catch(() => {});
  const value = Number(die.total);
  // A deep copy: a roll's JSON shares its dice results with the roll itself.
  const copy = Roll.fromData(foundry.utils.deepClone(roll.toJSON()));
  rewriteDie(copy, picked.termIndex, picked.resultIndex, value);
  const target = {
    ...picked, faces: Number(term.faces), old, value,
    oldTotal: Number(roll.total), newTotal: Number(copy.total), kind: rollKind(message, roll),
    who: message.speaker?.alias ?? "", what: rollLabel(message, roll), label: `${message.speaker?.alias ?? ""} · ${rollLabel(message, roll)}`
  };
  await postPlay(actor, { play: "reroll", target, state: "choosing" },
    t("reroll.Fallback", { name: actor.name, label: target.label, old: target.old, value }));
  return true;
}

/** A die rewritten in place: kept/dropped dice re-picked for kh/kl, the total recomputed. */
export function rewriteDie(roll, termIndex, resultIndex, value) {
  const term = roll?.terms?.[termIndex];
  const result = term?.results?.[resultIndex];
  if (!result) return false;
  result.result = value;
  if (term.modifiers?.some(modifier => /^(k|d)[hl]?/i.test(modifier))) {
    for (const entry of term.results) { entry.discarded = false; entry.active = true; }
    term._evaluateModifiers?.();
  }
  if (typeof roll._evaluateTotal === "function") roll._total = roll._evaluateTotal();
  roll.resetFormula?.();
  return true;
}

function rerollLine(data, img, name, fresh) {
  const target = data.target ?? {};
  const state = data.state;
  const result = state === "taken" ? `<s>${target.old}</s> <em>${target.value}</em>`
    : state === "kept" ? `<em>${target.old}</em> <s>${target.value}</s>`
    : `${target.old} <em>/ ${target.value}</em>`;
  const tail = state === "choosing" ? t("reroll.Choosing", { name }) : state === "taken" ? t("reroll.Taken") : state === "kept" ? t("reroll.Kept") : "";
  return `<div class="hwe-cut${fresh ? " is-fresh" : ""}"><span class="hwe-cut-u">${bolt("hwe-cut-bolt")}${escapeHTML(t("reroll.Name"))}</span>
    <span class="hwe-cut-t"><img src="${img}" alt="">${name} <em>▸</em> ${escapeHTML(target.who ?? target.label ?? "")}</span></div>
    <div class="hwe-cut-sub"><span class="hwe-cut-dice">${target.what ? `${escapeHTML(target.what)} · ` : ""}d${target.faces} ${result}</span><span>${escapeHTML(tail)}</span></div>`;
}

/**
 * Reroll lines that point at this card, oldest first. Searched among recent messages in any order: Ready Set Midi
 * re-stamps a card it redraws, so the card can sort after the lines that changed it.
 */
function rerollsFor(message) {
  const out = [];
  for (const edge of game.messages.contents.slice(-80)) {
    const data = edge.flags?.[MODULE_ID]?.[FLAG];
    if (data?.play === "reroll" && data.target?.messageId === message.id) out.push({ edge, data });
  }
  return out.sort((a, b) => a.edge.timestamp - b.edge.timestamp);
}

/** The source card: the choice strip while the spender decides, then a marker where the die changed. */
function decorateSource(message, element) {
  const entries = rerollsFor(message);
  if (!entries.length) return;
  element.querySelectorAll(".hardwipe-edge-strip").forEach(node => node.remove());
  for (const { edge, data } of entries) {
    const strip = document.createElement("div");
    const target = data.target;
    const actor = game.actors.get(data.actorId);
    const mine = game.user.isGM || data.userId === game.user.id;
    const verdict = total => verdictFor(message, target, total);
    if (data.state === "choosing") {
      strip.className = `hardwipe-edge-strip is-choosing${mine ? " is-mine" : ""}`;
      strip.innerHTML = `<span class="hardwipe-edge-cap">⚡ ${escapeHTML(mine ? t("reroll.YourCall", { name: actor?.name ?? "" }) : t("reroll.Waiting", { name: actor?.name ?? "" }))}</span>
        <div class="hardwipe-edge-opts">
          <button type="button" data-edge-pick="keep"${mine ? "" : " disabled"}><i>${escapeHTML(t("reroll.Keep"))}</i><b>${target.old}</b><small>= ${target.oldTotal}${verdict(target.oldTotal)}</small></button>
          <button type="button" class="is-new" data-edge-pick="take"${mine ? "" : " disabled"}><i>${escapeHTML(t("reroll.New"))}</i><b>${target.value}</b><small>= ${target.newTotal}${verdict(target.newTotal)}</small></button>
        </div>`;
      for (const button of strip.querySelectorAll("[data-edge-pick]")) {
        button.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          strip.querySelectorAll("button").forEach(node => { node.disabled = true; });
          void choose(edge.id, button.dataset.edgePick === "take");
        });
      }
    } else if (data.state === "taken" || data.state === "kept") {
      strip.className = `hardwipe-edge-strip is-settled is-${data.state}`;
      const ruledNow = Object.values(data.ruled ?? {}).at(-1);
      const text = data.state === "taken"
        ? t("reroll.MarkTaken", { name: actor?.name ?? "", old: target.old, value: target.value, from: target.oldTotal, to: target.newTotal })
          + (ruledNow ? ` · ${t("reroll.Ruled", { outcome: t(`reroll.Outcome.${ruledNow}`) })}` : "")
        : t("reroll.MarkKept", { name: actor?.name ?? "", old: target.old, value: target.value });
      strip.innerHTML = `<span>⚡ ${escapeHTML(text)}</span>`;
      if (data.state === "taken" && target.kind === "attack") rulingRows(message, edge, data, strip);
    } else continue;
    strip.dataset.edgeId = edge.id;
    anchorFor(element, target).append(strip);
  }
}

/**
 * A reroll that flips an attack the GM already ruled (a hit that now misses, a miss that now hits): the GM rules each
 * such target again here; everyone else sees that it waits on the GM. Hardwipe locks a ruled attack, so nothing
 * else would reopen it.
 */
function rulingRows(message, edge, data, strip) {
  const review = message.flags?.[MODULE_ID]?.attackReview;
  if (review?.status !== "resolved") return;
  const ruled = data.ruled ?? {};
  for (const target of review.targets ?? []) {
    if (ruled[target.uuid.replaceAll(".", "_")]) continue;
    const ac = Number(foundry.utils.fromUuidSync(target.uuid)?.actor?.system?.attributes?.ac?.value);
    if (!Number.isFinite(ac)) continue;
    const wasHit = ["hit", "critical"].includes(target.outcome);
    const nowHit = Number(data.target.newTotal) >= ac;
    if (wasHit === nowHit || target.outcome === "fumble") continue;
    const row = document.createElement("div");
    row.className = "hardwipe-edge-ruling";
    const ask = t(nowHit ? "reroll.NowHits" : "reroll.NowMisses", { name: target.name, total: data.target.newTotal, ac });
    if (game.user.isGM) {
      const flip = nowHit ? "hit" : "miss";
      row.innerHTML = `<span>${escapeHTML(ask)}</span>
        <button type="button" class="is-go" data-edge-rule="${flip}">${escapeHTML(t(nowHit ? "reroll.RuleHit" : "reroll.RuleMiss"))}</button>
        <button type="button" data-edge-rule="${target.outcome}">${escapeHTML(t(nowHit ? "reroll.MissStands" : "reroll.HitStands"))}</button>`;
      for (const button of row.querySelectorAll("[data-edge-rule]")) {
        button.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          row.querySelectorAll("button").forEach(node => { node.disabled = true; });
          void rule(message, edge, target.uuid, button.dataset.edgeRule);
        });
      }
    } else row.innerHTML = `<span>${escapeHTML(ask)}</span><em>${escapeHTML(t("reroll.WaitsOnGM"))}</em>`;
    strip.append(row);
  }
}

/** The GM's new ruling: the card's outcome for that target, its damage taken back or applied, noted on the line. */
async function rule(message, edge, uuid, outcome) {
  if (!game.user.isGM) return;
  const review = message.flags?.[MODULE_ID]?.attackReview;
  const before = review?.targets?.find(entry => entry.uuid === uuid)?.outcome;
  if (outcome !== before) await reruleTarget(message, uuid, outcome);
  await edge.update({ [`flags.${MODULE_ID}.${FLAG}.ruled.${uuid.replaceAll(".", "_")}`]: outcome });
  ui.chat?.updateMessage?.(game.messages.get(message.id));
}

/** " · hit"/" · miss" against the card's target AC, " · saved"/" · failed" against a save's DC, else nothing. */
function verdictFor(message, target, total) {
  if (target.kind === "save" || target.kind === "d20") {
    const dc = Number(message.rolls?.[target.rollIndex]?.options?.target ?? askedSave(message)?.dc);
    if (Number.isFinite(dc) && dc > 0) return ` · ${t(total >= dc ? "reroll.Saved" : "reroll.Failed")}`;
  }
  if (target.kind === "attack") {
    const midi = message.flags?.["midi-qol"] ?? {};
    const first = message.flags?.[MODULE_ID]?.attackReview?.targets?.[0]?.uuid ?? midi.targets?.[0]?.uuid ?? midi.targets?.[0] ?? midi.hitTargetUuids?.[0];
    const ac = Number(foundry.utils.fromUuidSync(typeof first === "string" ? first : "")?.actor?.system?.attributes?.ac?.value);
    if (Number.isFinite(ac) && ac > 0) return ` · ${t(total >= ac ? "reroll.Hit" : "reroll.Miss", { ac })}`;
  }
  return "";
}

/** Where the strip goes: under the attack roll, under the damage, else at the end of the card. */
function anchorFor(element, target) {
  if (target.kind === "attack") {
    const section = element.querySelector(".midi-qol-attack-roll");
    if (section) return section;
  }
  if (target.kind === "damage") {
    const summary = element.querySelector(".hardwipe-damage-summary");
    if (summary?.parentElement) return summary.parentElement;
  }
  return element.querySelector(".message-content") ?? element;
}

/** Keep or take: the spender (or a GM) decides; taking writes the die through whichever client can. */
async function choose(edgeId, take) {
  const edge = game.messages.get(edgeId);
  const data = edge?.flags?.[MODULE_ID]?.[FLAG];
  if (!data || data.state !== "choosing" || !(game.user.isGM || data.userId === game.user.id)) return;
  if (take) {
    let ok = false;
    try { ok = await writeDie(data.target); } catch (error) { console.error(`${MODULE_ID} | Edge reroll could not be written`, error); }
    if (!ok) {
      ui.notifications.warn(t("reroll.Unwritable"));
      ui.chat?.updateMessage?.(game.messages.get(data.target.messageId));
      return;
    }
  }
  await edge.update({ [`flags.${MODULE_ID}.${FLAG}.state`]: take ? "taken" : "kept" });
}

/**
 * Who writes the die: for a usage card with a Midi workflow, its author (whose client holds the workflow, as for
 * Ready Set Midi's own reroll); anything else, the GM, who can update any message and the spell a save answers.
 */
async function writeDie(target) {
  const message = game.messages.get(target.messageId);
  if (!message) return false;
  const author = message.author;
  const workflowCard = message.type === "usage" || !!message.flags?.["midi-qol"];
  const writer = workflowCard && author?.active ? author : game.users.activeGM ?? (message.isAuthor ? game.user : null);
  if (!writer) return false;
  if (writer.isSelf) return applyReroll(target);
  if (!socket) return false;
  return socket.executeAsUser("edgeRerollApply", writer.id, target);
}

/** On the writing client: rewrite the die in the workflow's roll (attack, damage) or the message's own rolls. */
export async function applyReroll(target) {
  const message = game.messages.get(target?.messageId);
  const source = message?.rolls?.[target.rollIndex];
  if (!source) return false;
  const workflow = midiWorkflow(message);
  if (workflow) {
    const slots = [
      ["attack", () => workflow.attackRoll ? [workflow.attackRoll] : []],
      ["damage", () => Array.from(workflow.damageRolls ?? [])],
      ["otherDamage", () => Array.from(workflow.otherDamageRolls ?? [])],
      ["bonusDamage", () => Array.from(workflow.bonusDamageRolls ?? [])]
    ];
    for (const [kind, list] of slots) {
      const rolls = list();
      const index = rolls.findIndex(roll => sameRoll(roll, source));
      if (index < 0) continue;
      const roll = rolls[index];
      if (!rewriteDie(roll, target.termIndex, target.resultIndex, target.value)) return false;
      if (kind === "attack") {
        await workflow.setAttackRoll(roll);
        await workflow.processAttackRoll?.();
        await workflow.checkHits?.();
        await workflow.displayAttackRoll?.();
        await workflow.displayHitTargets?.(false);
      } else {
        const setter = { damage: "setDamageRolls", otherDamage: "setOtherDamageRolls", bonusDamage: "setBonusDamageRolls" }[kind];
        await workflow[setter](rolls);
        await workflow.displayDamageRolls?.();
      }
      return true;
    }
  }
  if (!message.canUserModify(game.user, "update")) return false;
  const rolls = message.rolls.map(roll => Roll.fromData(foundry.utils.deepClone(roll.toJSON())));
  if (!rewriteDie(rolls[target.rollIndex], target.termIndex, target.resultIndex, target.value)) return false;
  await message.update({ rolls: rolls.map(roll => roll.toJSON()) });
  const total = Number(rolls[target.rollIndex].total);
  await followInitiative(message, total);
  await followSave(message, total);
  return true;
}

function midiWorkflow(message) {
  const Workflow = globalThis.MidiQOL?.Workflow;
  if (!Workflow?.getWorkflow) return null;
  return Workflow.getWorkflow(message.uuid) ?? Workflow.getWorkflow(message.id) ?? null;
}

function sameRoll(a, b) {
  if (!a || !b || a.formula !== b.formula || Number(a.total) !== Number(b.total)) return false;
  const faces = roll => JSON.stringify((roll.dice ?? []).map(die => die.results.map(result => result.result)));
  return faces(a) === faces(b);
}

/** An initiative roll moves the combatant to its new total. */
async function followInitiative(message, total) {
  if (!message.getFlag("core", "initiativeRoll")) return;
  for (const combat of game.combats ?? []) {
    const combatant = combat.combatants.find(entry => (message.speaker?.token && entry.tokenId === message.speaker.token) || entry.actorId === message.speaker?.actor);
    if (combatant?.isOwner) return combatant.update({ initiative: total });
  }
}

/** A save that answers a spell: the target moves between the spell's saved and failed lists, applied damage follows. */
async function followSave(message, total) {
  const originId = message.flags?.dnd5e?.originatingMessage;
  const origin = originId ? game.messages.get(originId) : null;
  if (!origin || !game.user.isGM) return;
  const state = saveState(origin, null);
  const token = message.speaker?.token;
  const target = token ? state?.targets.find(entry => entry.uuid === `Scene.${message.speaker.scene}.Token.${token}` || entry.uuid.endsWith(`.${token}`)) : null;
  if (!target) return;
  const saved = total >= state.dc;
  const midi = origin.flags?.["midi-qol"] ?? {};
  const savedList = new Set(midi.saveUuids ?? []);
  const failedList = new Set(midi.failedSaveUuids ?? []);
  if (savedList.has(target.uuid) || failedList.has(target.uuid)) {
    savedList.delete(target.uuid);
    failedList.delete(target.uuid);
    (saved ? savedList : failedList).add(target.uuid);
    await origin.update({ "flags.midi-qol.saveUuids": [...savedList], "flags.midi-qol.failedSaveUuids": [...failedList] });
  }
  await resyncSaveTarget(origin, target.uuid, saved ? (state.half ? 0.5 : 0) : 1);
  ui.chat?.updateMessage?.(game.messages.get(origin.id));
}

/** A Reroll line changed: redraw the card it points at. */
function refreshSource(message) {
  const data = message.flags?.[MODULE_ID]?.[FLAG];
  if (data?.play !== "reroll") return;
  const source = game.messages.get(data.target?.messageId);
  if (source) ui.chat?.updateMessage?.(source);
}

/* Interrupt ------------------------------------------------------------------------------------------ */

function combatFor(actor) {
  return game.combats?.find(combat => combat.combatants.some(entry => entry.actor === actor || entry.actorId === actor.id) && combat.started) ?? null;
}

function interruptState(data) {
  if (data.state === "used") return "used";
  const combat = game.combats?.get(data.combat);
  if (!combat || combat.round !== data.round || combat.turn !== data.turn) return "lapsed";
  return "ready";
}

/** The actor's Interrupt, if it is still good: bought on this very turn and not used. */
export function liveInterrupt(actor) {
  const data = actor?.getFlag?.(MODULE_ID, INTERRUPT);
  if (!data || data.state !== "ready") return null;
  return interruptState(data) === "ready" ? data : null;
}

async function interrupt(actor) {
  const combat = combatFor(actor);
  if (!combat) return false;
  if (!await EdgeManager.spend(actor)) return false;
  const data = { combat: combat.id, round: combat.round, turn: combat.turn, turnName: combat.combatant?.name ?? "", state: "ready" };
  const card = await postPlay(actor, { play: "interrupt", ...data }, t("interrupt.Fallback", { name: actor.name, turn: data.turnName }));
  await actor.setFlag(MODULE_ID, INTERRUPT, { ...data, messageId: card?.id ?? null });
  return true;
}

/** Spend the Interrupt on an action or bonus action (an item's name when an item used it). */
export async function useInterrupt(actor, slot, item = "") {
  const data = liveInterrupt(actor);
  if (!data || !canControlActor(actor)) return false;
  await actor.setFlag(MODULE_ID, INTERRUPT, { ...data, state: "used", slot, item });
  const card = game.messages.get(data.messageId);
  if (card?.canUserModify(game.user, "update")) {
    await card.update({ [`flags.${MODULE_ID}.${FLAG}.state`]: "used", [`flags.${MODULE_ID}.${FLAG}.slot`]: slot, [`flags.${MODULE_ID}.${FLAG}.item`]: item });
  }
  return true;
}

/* Stabilize and Execute ------------------------------------------------------------------------------ */

export async function stabilize(actor) {
  const before = StrikesManager.get(actor);
  if (!await EdgeManager.spend(actor)) return false;
  await actor.update({ "system.attributes.hp.value": 1 }, { hardwipeRecovery: true });
  await DownedManager.clear(actor);
  const after = Math.max(0, before - 1);
  if (before > 0) await StrikesManager.set(actor, after);
  await postPlay(actor, { play: "stabilize", strikesBefore: before, strikesAfter: after }, t("stabilize.Fallback", { name: actor.name }));
  return true;
}

/** The targeted token Execute would drop, or why it can't. */
function executeTarget() {
  const targets = [...(game.user.targets ?? [])];
  if (targets.length !== 1) return { ok: false, note: t(targets.length ? "execute.OneTarget" : "execute.NoTarget") };
  const token = targets[0];
  const actor = token.actor;
  if (!actor || actor.type === "character") return { ok: false, note: t("execute.NotMook") };
  if (Number(actor.system?.resources?.legres?.max) > 0) return { ok: false, note: t("execute.Legendary") };
  if (!(Number(actor.system?.attributes?.hp?.value) > 0)) return { ok: false, note: t("execute.AlreadyDown") };
  return { ok: true, token };
}

async function execute(actor) {
  const target = executeTarget();
  if (!target.ok) return ui.notifications.warn(target.note);
  const token = target.token;
  const tokenUuid = token.document?.uuid ?? token.uuid;
  if (!game.user.isGM && (!game.users.activeGM || !socket)) return ui.notifications.warn(t("execute.NeedsGM"));
  if (!await EdgeManager.spend(actor)) return false;
  const result = game.user.isGM ? await gmExecute(tokenUuid, actor.uuid) : await socket.executeAsGM("edgeExecute", tokenUuid, actor.uuid);
  if (!result) return ui.notifications.warn(t("execute.Failed"));
  await postPlay(actor, { play: "execute", target: result }, t("execute.Fallback", { name: actor.name, target: result.name }));
  return true;
}

/** On the GM's client: the mook goes to 0 HP. Checked again here, since a player asked. */
async function gmExecute(tokenUuid) {
  const token = foundry.utils.fromUuidSync(tokenUuid);
  const actor = token?.actor;
  if (!actor || actor.type === "character" || Number(actor.system?.resources?.legres?.max) > 0) return null;
  const hp = Number(actor.system?.attributes?.hp?.value) || 0;
  if (hp <= 0) return null;
  await actor.update({ "system.attributes.hp.value": 0 });
  return { name: token.name ?? actor.name, img: token.texture?.src ?? actor.img, hp, uuid: tokenUuid };
}

