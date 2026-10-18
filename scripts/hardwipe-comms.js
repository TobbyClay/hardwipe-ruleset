import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { rollPendingSaves, saveState } from "./hardwipe-attack-cards.js";
import { openConcentration, rollConcentrationRequest } from "./hardwipe-concentration.js";
import { RollRequestComposer, participantsOf, requestData, rollFor, rollName, rollTitle, rollsHere } from "./hardwipe-requests.js";

/**
 * Comms: what the table still owes, for the Turn tab's netlink strip and the GM's queue.
 * - Open items: roll calls and contests (request messages with someone still to roll), saves on spell and attack
 *   cards, and concentration interrupts.
 * - The GM closes an item (flags.hardwipe-ruleset.closed). A roll call then takes no more rolls and its card says so; a
 *   save or an interrupt only leaves the strip and the queue, while its card and Ready Set Midi carry on.
 * - Roll calls also close on a timer (world settings): in combat at the end of the turn or round they were posted, or
 *   when combat ends; out of combat after some minutes. A pinned one stays open. Saves and interrupts never close on
 *   a timer: they leave when they're resolved.
 */
const SCAN = 80;
const SWEEP_MS = 30000;
export const CLOSE_RULES = ["round", "turn", "combat", "never"];
const t = (key, data) => data ? game.i18n.format(`HARDWIPE.Comms.${key}`, data) : game.i18n.localize(`HARDWIPE.Comms.${key}`);

/* Pure rules (unit-tested) ---------------------------------------------------------------------- */

/**
 * Has a roll call outlived its rule? `posted` is where combat stood when it was posted (null outside combat), `combat`
 * that combat now (null once it's gone). Outside combat it's the age against `idleMinutes` (0: never).
 */
export function rollCallExpired({ posted = null, timestamp = 0 } = {}, { combat = null, now = Date.now() } = {}, { inCombat = "round", idleMinutes = 10 } = {}) {
  if (posted?.combat) {
    if (inCombat === "never") return false;
    if (!combat?.started) return true;
    if (inCombat === "round") return combat.round > posted.round;
    if (inCombat === "turn") return combat.round !== posted.round || combat.turn !== posted.turn;
    return false;
  }
  return idleMinutes > 0 && now - timestamp >= idleMinutes * 60000;
}

const URGENT = new Set(["interrupt", "save"]);

/** Saves owed right now first, then the rest; newest first within each. */
export function orderWaiting(items) {
  return [...items].sort((a, b) => (URGENT.has(b.kind) - URGENT.has(a.kind)) || ((b.at ?? 0) - (a.at ?? 0)));
}

/** At most `limit` rows (0: all) unless expanded; `more` counts the rows past the limit. */
export function limitWaiting(items, limit, expanded = false) {
  const max = Number(limit) > 0 ? Number(limit) : Infinity;
  const more = Math.max(0, items.length - max);
  return { shown: expanded ? items : items.slice(0, max), more, expanded: expanded && more > 0 };
}

/* Settings and flags ---------------------------------------------------------------------------- */

function setting(key, fallback) {
  try { return game.settings.get(MODULE_ID, key); } catch { return fallback; }
}

export function closeRules() {
  // Choice keys aren't bare numbers ("10min", "3rows"), so the settings list keeps its order; "never" and "all" read as 0.
  return { inCombat: setting("rollCallCloseCombat", "round"), idleMinutes: Number.parseInt(setting("rollCallCloseIdle", "10min"), 10) || 0 };
}

export function waitingLimit() {
  return Number.parseInt(setting("waitingLimit", "3rows"), 10) || 0;
}

export const closedOf = message => message?.flags?.[MODULE_ID]?.closed ?? null;
export const pinnedOf = message => !!message?.flags?.[MODULE_ID]?.pinned;

/** GM: close an item for everyone. */
export async function closeItem(message, reason = "gm") {
  if (!game.user.isGM || !message || closedOf(message)) return;
  await message.setFlag(MODULE_ID, "closed", { reason, at: Date.now() });
}

/** GM: keep a roll call open past its timer, or let it close again. */
export async function pinItem(message, pinned = !pinnedOf(message)) {
  if (!game.user.isGM || message?.type !== "request") return;
  await message.setFlag(MODULE_ID, "pinned", !!pinned);
  // An unpinned roll call may already be past its rule.
  if (!pinned) soonSweep();
}

/* Open items ---------------------------------------------------------------------------------------- */

const recent = () => game.messages.contents.slice(-SCAN);

/** "online" when a player who owns this actor is connected, "offline" when none is, null for an NPC. */
function presenceOf(actor) {
  const owners = game.users.filter(user => !user.isGM && actor?.testUserPermission(user, "OWNER"));
  if (!owners.length) return null;
  return owners.some(user => user.active) ? "online" : "offline";
}

const owed = actor => ({ actor, name: actor.name, presence: presenceOf(actor), rollable: rollsHere(actor) });

/** When this item leaves on its own, for the queue's Closes column. */
function closesLabel(message, kind, now = Date.now()) {
  if (kind === "save" || kind === "interrupt") return t("Closes.resolved");
  if (pinnedOf(message)) return t("Closes.pinned");
  const rules = closeRules();
  const posted = message.flags?.[MODULE_ID]?.posted;
  if (posted?.combat) {
    if (rules.inCombat === "round") return t("Closes.round", { round: posted.round });
    return t(`Closes.${rules.inCombat}`);
  }
  if (!rules.idleMinutes) return t("Closes.never");
  const left = Math.max(1, Math.ceil((message.timestamp + rules.idleMinutes * 60000 - now) / 60000));
  return t("Closes.idle", { minutes: left });
}

function requestItem(message) {
  const people = participantsOf(message);
  const pending = people.filter(person => !person.rolled);
  if (!pending.length) return null;
  const data = requestData(message);
  const contest = data?.kind === "contest";
  const spec = data?.roll ?? (message.system?.handler === "skill" ? { type: "skill", skill: message.system.data?.skill }
    : message.system?.handler === "save" ? { type: "save", ability: message.system.data?.ability } : null);
  const name = contest
    ? t("VersusName", { name: people.find(p => p.uuid === data.contest.challenger)?.actor.name ?? "", target: people.find(p => p.uuid === data.contest.defender)?.actor.name ?? "" })
    : spec ? rollTitle(spec) : String(message.flavor ?? "");
  return {
    id: message.id, message, kind: contest ? "contest" : "rollcall", name, detail: data?.reason ?? "",
    owes: pending.map(person => owed(person.actor)), answered: people.length - pending.length, total: people.length,
    closes: closesLabel(message, "rollcall"), pinned: pinnedOf(message), canPin: true, at: message.timestamp
  };
}

function saveItem(message) {
  let state = null;
  try { state = saveState(message, null); } catch { state = null; }
  if (!state?.pending?.length) return null;
  const actors = [];
  for (const target of state.pending) {
    const actor = foundry.utils.fromUuidSync(target.uuid, { strict: false })?.actor;
    if (actor && !actors.some(other => other.uuid === actor.uuid)) actors.push(actor);
  }
  if (!actors.length) return null;
  let item = null;
  try { item = message.getAssociatedItem?.(); } catch { item = null; }
  return {
    id: message.id, message, kind: "save", name: rollName({ type: "save", ability: state.ability }), detail: item?.name ?? "",
    owes: actors.map(owed), answered: state.done, total: state.targets.length, closes: closesLabel(message, "save"), at: message.timestamp
  };
}

function interruptItem({ message, actor }) {
  const data = message.flags[MODULE_ID].concentrationCheck;
  return {
    id: message.id, message, kind: "interrupt", name: t("Concentration"), detail: data.spells?.map(spell => spell.name).join(", ") ?? "",
    owes: [owed(actor)], answered: 0, total: 1, closes: closesLabel(message, "interrupt"), at: message.timestamp
  };
}

/** Everything the table still owes, for the GM's queue. */
export function queueItems() {
  const items = [];
  for (const message of recent()) {
    if (closedOf(message)) continue;
    const item = message.type === "request" ? requestItem(message) : message.flags?.[MODULE_ID]?.saves ? saveItem(message) : null;
    if (item) items.push(item);
  }
  for (const entry of openConcentration()) if (!closedOf(entry.message)) items.push(interruptItem(entry));
  return orderWaiting(items);
}

export function queueCount() {
  try { return queueItems().length; } catch { return 0; }
}

const KIND_COLORS = { interrupt: "var(--hw-alert)", save: "var(--hw-alert)", rollcall: "var(--hw-warn)", contest: "var(--hw-cyan)" };

/** The queue tab of the Roll call window. */
export function queueHTML() {
  const items = queueItems();
  const button = (action, id, icon, label, extra = "") => `<button type="button" class="hardwipe-queue-btn ${extra}" data-action="queue" data-queue="${action}"
    ${id ? `data-id="${escapeHTML(id)}"` : ""} data-tooltip="${escapeHTML(label)}" aria-label="${escapeHTML(label)}"><i class="fas ${icon}" inert></i>${extra.includes("has-label") ? ` ${escapeHTML(label)}` : ""}</button>`;
  const rows = items.map(item => {
    const owes = item.owes.map(person => `<span class="hardwipe-queue-who ${person.presence ? `is-${person.presence}` : ""}">${escapeHTML(person.name)}</span>`).join("");
    const count = item.total > 1 ? `<small>${escapeHTML(t("Answered", { answered: item.answered, total: item.total }))}</small>` : "";
    const canRoll = item.owes.some(person => person.rollable);
    return `<div class="hardwipe-queue-row is-${item.kind}" style="--k: ${KIND_COLORS[item.kind]}">
      <span class="hardwipe-queue-kind">${escapeHTML(t(`Kind.${item.kind}`))}</span>
      <span class="hardwipe-queue-name"><b>${escapeHTML(item.name)}</b>${item.detail ? `<small>${escapeHTML(item.detail)}</small>` : ""}</span>
      <span class="hardwipe-queue-actions">
        ${canRoll ? button("roll", item.id, "fa-dice-d20", t("Queue.Roll"), "is-primary has-label") : ""}
        ${item.canPin ? button("pin", item.id, "fa-thumbtack", t(item.pinned ? "Queue.Unpin" : "Queue.Pin"), item.pinned ? "is-on" : "") : ""}
        ${button("close", item.id, "fa-xmark", t("Queue.Close"), "is-danger")}
      </span>
      <span class="hardwipe-queue-meta"><span class="hardwipe-queue-owes">${owes}${count}</span>
        <span class="hardwipe-queue-closes ${item.pinned ? "is-pinned" : ""}"><i class="fas ${item.pinned ? "fa-thumbtack" : "fa-clock"}" inert></i> ${escapeHTML(item.closes)}</span></span>
    </div>`;
  }).join("");
  return `<div class="hardwipe-queue">
    <header class="hardwipe-queue-head"><span>&gt; ${escapeHTML(t("Queue.Head", { count: items.length }))}</span>
      ${items.length ? button("close-all", null, "fa-xmark", t("Queue.CloseAll"), "is-danger has-label") : ""}</header>
    ${items.length ? rows
      : `<p class="hardwipe-queue-empty">&gt; ${escapeHTML(t("Queue.Empty"))}<i class="hardwipe-netlink-cursor" inert></i></p>`}
    <footer class="hardwipe-queue-legend">${escapeHTML(t("Queue.Legend"))}</footer>
  </div>`;
}

/** A queue button: roll for the participants the GM rolls for, pin, close one, or close all. */
export async function queueAction(action, id, event = null) {
  if (!game.user.isGM) return;
  if (action === "close-all") {
    const items = queueItems();
    if (!items.length) return;
    const ok = await foundry.applications.api.DialogV2.confirm({ classes: ["hardwipe-dialog"],
      window: { title: t("Queue.CloseAll") }, content: `<p>${escapeHTML(t("Queue.CloseAllConfirm", { count: items.length }))}</p>`
    });
    if (!ok) return;
    for (const item of items) await closeItem(item.message);
    return;
  }
  const item = queueItems().find(entry => entry.id === id);
  if (!item) return;
  if (action === "close") return closeItem(item.message);
  if (action === "pin") return pinItem(item.message);
  if (action !== "roll") return;
  for (const person of item.owes.filter(entry => entry.rollable)) {
    try {
      if (item.kind === "save") await rollPendingSaves(item.message, person.actor, event);
      else if (item.kind === "interrupt") await rollConcentrationRequest(item.message, event);
      else await rollFor(item.message, person.actor, item.kind === "contest" ? 0 : -1, event);
    } catch (error) {
      console.error(`${MODULE_ID} | Queue roll`, error);
    }
  }
}

/* Auto-close ------------------------------------------------------------------------------------------- */

let sweeping = false;

/** The active GM closes every roll call whose rule has run out. Returns how many closed. */
export async function sweep(now = Date.now()) {
  if (game.users.activeGM !== game.user || sweeping) return 0;
  sweeping = true;
  let closed = 0;
  try {
    const rules = closeRules();
    for (const message of recent()) {
      if (message.type !== "request" || closedOf(message) || pinnedOf(message)) continue;
      if (!(message.system?.targets ?? []).some(target => !target.result)) continue;
      const posted = message.flags?.[MODULE_ID]?.posted ?? null;
      const combat = posted?.combat ? game.combats.get(posted.combat) : null;
      const state = combat ? { started: combat.started, round: combat.round, turn: combat.turn } : null;
      if (!rollCallExpired({ posted, timestamp: message.timestamp }, { combat: state, now }, rules)) continue;
      await message.setFlag(MODULE_ID, "closed", { reason: "timer", at: now });
      closed++;
    }
  } catch (error) {
    console.error(`${MODULE_ID} | Roll call sweep`, error);
  } finally {
    sweeping = false;
  }
  return closed;
}

let sweepTimer = null;
const soonSweep = () => { clearTimeout(sweepTimer); sweepTimer = setTimeout(() => void sweep(), 400); };

let queueTimer = null;
const refreshQueue = () => { clearTimeout(queueTimer); queueTimer = setTimeout(() => RollRequestComposer.refreshQueue(), 150); };

/* Wiring --------------------------------------------------------------------------------------------- */

export function registerComms() {
  const choices = (prefix, keys) => Object.fromEntries(keys.map(key => [key, `HARDWIPE.Comms.Setting.${prefix}.${key}`]));
  game.settings.register(MODULE_ID, "rollCallCloseCombat", {
    name: "HARDWIPE.Comms.Setting.Combat.Name", hint: "HARDWIPE.Comms.Setting.Combat.Hint", scope: "world", config: true,
    type: String, choices: choices("Combat", CLOSE_RULES), default: "round", onChange: soonSweep
  });
  game.settings.register(MODULE_ID, "rollCallCloseIdle", {
    name: "HARDWIPE.Comms.Setting.Idle.Name", hint: "HARDWIPE.Comms.Setting.Idle.Hint", scope: "world", config: true,
    type: String, choices: choices("Idle", ["10min", "30min", "never"]), default: "10min", onChange: soonSweep
  });
  game.settings.register(MODULE_ID, "waitingLimit", {
    name: "HARDWIPE.Comms.Setting.Limit.Name", hint: "HARDWIPE.Comms.Setting.Limit.Hint", scope: "world", config: true,
    type: String, choices: choices("Limit", ["3rows", "5rows", "all"]), default: "3rows"
  });

  // Where combat stood when a request was posted: the in-combat rules count from there.
  Hooks.on("preCreateChatMessage", message => {
    if (message.type !== "request") return;
    const combat = game.combat;
    if (combat?.started) message.updateSource({ flags: { [MODULE_ID]: { posted: { combat: combat.id, round: combat.round, turn: combat.turn } } } });
  });
  Hooks.on("updateCombat", (combat, changes) => {
    if ("round" in changes || "turn" in changes) soonSweep();
    refreshQueue();
  });
  Hooks.on("deleteCombat", () => { soonSweep(); refreshQueue(); });
  for (const hook of ["createChatMessage", "updateChatMessage", "deleteChatMessage", "userConnected"]) Hooks.on(hook, refreshQueue);
  Hooks.once("ready", () => {
    game.hardwipe.comms = { open: () => RollRequestComposer.open(null, { tab: "queue" }), sweep, queueItems };
    soonSweep();
    // Out of combat, roll calls age by the clock; the queue's "In N min" ticks with it.
    setInterval(() => { void sweep(); refreshQueue(); }, SWEEP_MS);
  });
}
