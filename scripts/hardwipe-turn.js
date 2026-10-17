import { MODULE_ID, EdgeManager, StrikesManager, DownedManager, canControlActor, plainActivityLabel } from "./hardwipe-state.js";
import { CyberwareManager } from "./hardwipe-cyberware.js";
import { pendingSaveTargets, rollPendingSaves } from "./hardwipe-attack-cards.js";
import { pendingConcentration, rollConcentrationRequest } from "./hardwipe-concentration.js";
import { RollRequestComposer, abilityAbbr, createRequest, parseRoll, pendingFor, rollFor, rollName } from "./hardwipe-requests.js";
import { closedOf, limitWaiting, orderWaiting, waitingLimit } from "./hardwipe-comms.js";

/**
 * The Turn tab: what a character can do right now, and what this turn has already cost.
 * - One band per cost (Action, Bonus action, Reaction) lists the usable weapons, implants, features and programs,
 *   with to-hit, damage and range; clicking one uses it. The band header carries that resource's state. Equipped
 *   melee weapons also appear under Reaction as opportunity attacks. Standard actions (Dash, Disengage, Dodge, Hide,
 *   Grapple, Shove) are rows in the Action band: each spends the action, Dash, Disengage and Hide the bonus action
 *   once it's gone, and Grapple and Shove one attack of the Attack action.
 * - "Waiting on you" lists the rolls this character owes: a GM's targeted request (the GM's Request check posts
 *   one), a save on a spell or feature card, a concentration interrupt; each with its Roll button.
 * - Reaction and bonus action: Ready Set Midi's marker effects decide whenever Midi tracks them for this actor's
 *   type, and a marker that is present always counts (Shield Block forces one). Otherwise Hardwipe's own ledger
 *   decides. Shield Block reads this same reaction in combat.
 * - Action: Midi's action flag or the ledger. Midi sets its flag only for an action used on the actor's own turn,
 *   which the ledger records as well, so the panel never reads Ready while Midi reads used.
 * - The ledger (flags.hardwipe-ruleset.turnLedger) is written on dnd5e.postUseActivity by the client that used the
 *   activity and cleared on combatTurnChange when the actor's turn starts. Its entries carry the combat, round and
 *   turn they belong to, so a stale ledger already reads as empty before the clear lands.
 * - Movement is the cost of the combatant token's movement history, which Foundry records in a started combat and
 *   clears at every turn start, against the speed of the token's movement action; Dash doubles it.
 */
const LEDGER = "turnLedger";
const MIDI = "midi-qol";
const MARKERS = { reaction: "dnd5ereaction000", bonus: "dnd5ebonusaction" };
const MARKER_STATUS = { reaction: "reaction", bonus: "bonusaction" };
const ENFORCE = { reaction: "enforceReactions", bonus: "enforceBonusActions" };
export const SLOTS = ["action", "bonus", "reaction"];
/** Standard actions offered as rows in the Action band: the ones that change something here. */
export const GENERAL_MOVES = ["dash", "disengage", "dodge", "hide", "grapple", "shove"];
/** Grapple and Shove replace one attack of the Attack action with an Athletics check. */
const ATTACK_MOVES = new Set(["grapple", "shove"]);
const MOVE_ICONS = {
  dash: "fa-person-running", disengage: "fa-person-walking-arrow-right", dodge: "fa-shield-halved",
  hide: "fa-user-secret", grapple: "fa-hand-fist", shove: "fa-hand-back-fist"
};
/** Moves a class feature commonly lets a character take as a bonus action (Cunning Action, Step of the Wind). */
const BONUS_FALLBACK = new Set(["dash", "disengage", "hide"]);
/** How long the strip shows "Sent to the GM" after a roll answers a request. */
const SENT_MS = 3000;
const net = (key, data) => data ? game.i18n.format(`HARDWIPE.Turn.Net.${key}`, data) : game.i18n.localize(`HARDWIPE.Turn.Net.${key}`);
/** Moves recognised in an activity's own name, so Cunning Action's Dash counts as a Dash. */
const NAMED_MOVES = ["dash", "disengage", "dodge", "hide"];
const SLOT_ICONS = { action: "fa-circle-dot", bonus: "fa-diamond", reaction: "fa-rotate-left" };
const GROUP_ORDER = { weapon: 0, implant: 1, feature: 2, program: 3, gear: 4 };

/* Pure rules (unit-tested) ---------------------------------------------------------------------- */

const empty = () => ({ action: false, bonus: false, attacks: 0, moves: {}, dash: null, reaction: false });
const order = (round, turn) => (Number(round) || 0) * 1000 + (Number(turn) || 0);

/**
 * Read a stored ledger against the combat as it stands now. Action-side entries count only during the
 * same turn of the actor's own; a reaction counts until the actor's next turn starts.
 * @param {object|null} ledger
 * @param {{combat: string, round: number, turn: number, own: number|null, isTurn: boolean}|null} now
 *   `own` is the actor's index in the turn order.
 */
export function readLedger(ledger, now) {
  const result = empty();
  if (!ledger || !now?.combat || ledger.combat !== now.combat) return result;
  if (now.isTurn && ledger.round === now.round && ledger.turn === now.turn) {
    const copy = copyLedger(ledger);
    Object.assign(result, { action: copy.action, bonus: copy.bonus, attacks: Math.max(0, copy.attacks), moves: copy.moves });
    result.dash = copy.moves.dash ?? null;
  }
  result.reaction = reactionHeld(ledger.reaction, now);
  return result;
}

/** A reaction used at `stamp` is back when the actor's next turn after it starts. */
export function reactionHeld(stamp, now) {
  if (!stamp || !now) return false;
  const used = order(stamp.round, stamp.turn);
  const current = order(now.round, now.turn);
  if (current < used) return false;
  if (!Number.isInteger(now.own) || now.own < 0) return true;
  const resetRound = stamp.turn < now.own ? stamp.round : stamp.round + 1;
  return current < order(resetRound, now.own);
}

/**
 * The ledger after one activity use, or null when the use costs nothing the panel tracks.
 * @param {object|null} ledger
 * @param {{activation: string, attack: boolean, move: string|null}} use
 * @param {{combat: string, round: number, turn: number, isTurn: boolean}} now
 */
export function recordUse(ledger, use, now) {
  if (!now?.combat) return null;
  // Off-turn, an attack that costs an action is an opportunity attack: it spends the reaction.
  const reaction = use.activation === "reaction" || (!now.isTurn && use.activation === "action" && use.attack);
  if (!reaction && (!now.isTurn || !["action", "bonus"].includes(use.activation))) return null;
  const next = currentLedger(ledger, now);
  if (reaction) {
    next.reaction = { round: now.round, turn: now.turn };
    return next;
  }
  next[use.activation] = true;
  if (use.activation === "action" && use.attack) next.attacks += 1;
  if (use.move) next.moves[use.move] = use.activation;
  return next;
}

/** A copy of the stored ledger for this combat, its action-side entries reset if they belong to an earlier turn. */
export function currentLedger(stored, now) {
  const ledger = copyLedger(stored?.combat === now.combat ? stored : { combat: now.combat });
  if (ledger.round !== now.round || ledger.turn !== now.turn) {
    Object.assign(ledger, { round: now.round, turn: now.turn, action: false, bonus: false, attacks: 0, moves: {} });
  }
  return ledger;
}

/** A plain copy that keeps only the ledger's own fields. A ledger from before moves existed keeps its Dash. */
function copyLedger(ledger) {
  const moves = {};
  for (const [id, slot] of Object.entries(ledger.moves ?? {})) if (GENERAL_MOVES.includes(id) && ["action", "bonus"].includes(slot)) moves[id] = slot;
  if (!moves.dash && ["action", "bonus"].includes(ledger.dash)) moves.dash = ledger.dash;
  return {
    combat: ledger.combat, round: ledger.round, turn: ledger.turn, action: ledger.action === true, bonus: ledger.bonus === true,
    attacks: Math.trunc(Number(ledger.attacks)) || 0, moves,
    reaction: ledger.reaction ? { round: ledger.reaction.round, turn: ledger.reaction.turn } : null
  };
}

/**
 * Which resource a standard action spends: the action, or for Dash, Disengage and Hide the bonus action once it's
 * gone. Grapple and Shove take one attack of an Attack action in progress (`attacksLeft`), or start one.
 */
export function payFor(move, economy, attacksLeft = 0) {
  if (ATTACK_MOVES.has(move)) return attacksLeft > 0 ? "attack" : !economy.action.spent ? "action" : null;
  if (!economy.action.spent) return "action";
  if (BONUS_FALLBACK.has(move) && !economy.bonus.spent) return "bonus";
  return null;
}

const EXTRA_BY_IDENTIFIER = { "extra-attack": 2, "two-extra-attacks": 3, "three-extra-attacks": 4, "thirsting-blade": 2 };
const EXTRA_BY_NAME = [[/^three extra attacks$/i, 4], [/^two extra attacks$/i, 3], [/^extra attack(?:\s*\((\d)\))?$/i, null], [/^thirsting blade$/i, 2]];

/**
 * Attacks in one Attack action, from Extra Attack and similar features (by dnd5e identifier or name), or an
 * explicit `flags.hardwipe-ruleset.attacksPerAction` on a feature or a working implant. The highest wins.
 * @param {Iterable<object>} items
 * @param {(item: object) => boolean} [operational]   Whether an implant is installed and working.
 * @returns {{count: number, source: string|null}}
 */
export function attacksPerAction(items, operational = () => true) {
  let best = { count: 1, source: null };
  const offer = (count, item) => { if (count > best.count) best = { count, source: item.name ?? null }; };
  for (const item of items ?? []) {
    const flag = Math.trunc(Number(item.flags?.[MODULE_ID]?.attacksPerAction));
    const cyberware = item.type === "equipment" && String(item.system?.type?.value ?? "").startsWith("hardwipe-");
    if (flag >= 1 && (item.type === "feat" || (cyberware && operational(item)))) offer(Math.min(flag, 8), item);
    if (item.type !== "feat") continue;
    const identifier = String(item.system?.identifier ?? "").toLowerCase();
    if (identifier in EXTRA_BY_IDENTIFIER) offer(EXTRA_BY_IDENTIFIER[identifier], item);
    for (const [pattern, count] of EXTRA_BY_NAME) {
      const match = String(item.name ?? "").trim().match(pattern);
      if (match) offer(count ?? (match[1] ? Number(match[1]) + 1 : 2), item);
    }
  }
  return best;
}

/** The general action an activity performs, read from its name or its item's (Cunning Action's Dash, a Dodge item). */
export function generalMoveOf(activity) {
  const names = [activity?.name, activity?.item?.name, activity?.item?.system?.identifier].map(name => String(name ?? ""));
  return NAMED_MOVES.find(move => names.some(name => new RegExp(`(^|[\\s:(\\-–—])${move}($|[\\s:)\\-–—])`, "i").test(name))) ?? null;
}

/** A weapon or unarmed attack (not a spell attack): one of the attacks of the Attack action. */
export function isWeaponAttack(activity) {
  if (activity?.type !== "attack") return false;
  const classification = activity.attack?.type?.classification;
  if (classification) return classification !== "spell";
  return activity.item?.type === "weapon";
}

/** The band an activation cost belongs to, or null for anything outside the action economy. */
export function slotFor(activation) { return SLOTS.includes(activation) ? activation : null; }

/** Cantrips, spells that need no preparation, and prepared or always-prepared spells. */
export function isCastable(spell) {
  const { level, canPrepare, prepared } = spell?.system ?? {};
  if (!level || !canPrepare) return true;
  return (Number(prepared) || 0) >= 1;
}

export function isMeleeWeapon(item) {
  const type = String(item?.system?.type?.value ?? "");
  return item?.type === "weapon" && (type.endsWith("M") || type === "natural");
}

/** Weapon, implant (Hardwipe cyberware), feature, program (spell), or other gear. */
export function optionGroup(item) {
  if (item?.type === "weapon") return "weapon";
  if (item?.type === "equipment" && String(item.system?.type?.value ?? "").startsWith("hardwipe-")) return "implant";
  if (item?.type === "feat") return "feature";
  if (item?.type === "spell") return "program";
  return "gear";
}

/** Weapons in hand first, then implants, features, programs by level, gear; then by name. */
export function compareOptions(a, b) {
  return (GROUP_ORDER[a.group] - GROUP_ORDER[b.group]) || ((a.notDrawn ? 1 : 0) - (b.notDrawn ? 1 : 0))
    || ((a.level ?? 0) - (b.level ?? 0)) || String(a.name).localeCompare(String(b.name)) || String(a.sub ?? "").localeCompare(String(b.sub ?? ""));
}

/* Live state ------------------------------------------------------------------------------------- */

export class TurnTracker {
  static _registered = false;
  /** Activities used from the Reaction band although they cost an action: opportunity attacks. */
  static _pending = new Map();
  /** The last answer per actor, for the strip's "Sent to the GM" line. */
  static _sent = new Map();

  static register() {
    if (this._registered) return;
    this._registered = true;
    Hooks.on("dnd5e.postUseActivity", activity => { void this._onUse(activity).catch(reportError); });
    Hooks.on("combatTurnChange", combat => this._onTurnChange(combat));
    Hooks.on("updateCombat", combat => this._refreshCombat(combat));
    Hooks.on("deleteCombat", combat => this._onDeleteCombat(combat));
    for (const hook of ["createCombatant", "updateCombatant", "deleteCombatant"]) {
      Hooks.on(hook, combatant => this._refreshActor(combatant.actor));
    }
    // Requests, save cards and their answers change "Waiting on you".
    for (const hook of ["createChatMessage", "updateChatMessage", "deleteChatMessage"]) Hooks.on(hook, () => this._refreshAll());
    Hooks.on("createChatMessage", message => this._onAnswer(message));
    Hooks.on("updateChatMessage", (message, changes) => {
      if (foundry.utils.hasProperty(changes, "flags.dnd5e.requestResult")) this._onAnswer(message);
    });
    Hooks.on("updateToken", (token, changes) => {
      if (["x", "y", "elevation", "_movementHistory", "movementAction"].some(key => key in changes)) this._refreshActor(token.actor);
    });
  }

  /** The started combat this actor is in: the viewed one first. */
  static combatFor(actor) {
    const has = combat => combat?.started && !!combatantFor(combat, actor);
    if (has(game.combat)) return game.combat;
    return game.combats?.find(has) ?? null;
  }

  /** Where the actor stands in its combat, or null outside a started combat. */
  static now(actor) {
    const combat = this.combatFor(actor);
    if (!combat) return null;
    const same = combatant => sameActor(combatant?.actor, actor);
    const own = combat.turns.findIndex(same);
    return {
      combat: combat.id, round: combat.round, turn: combat.turn, own: own >= 0 ? own : null,
      isTurn: same(combat.combatant), combatDocument: combat,
      combatant: same(combat.combatant) ? combat.combatant : combatantFor(combat, actor)
    };
  }

  static ledger(actor) { return actor?.getFlag(MODULE_ID, LEDGER) ?? null; }

  /**
   * Does Ready Set Midi decide this resource for this actor? Midi marks a used reaction under "all", "displayOnly"
   * or the actor's type, but marks a bonus action on use only where it enforces bonus actions ("all" or the type).
   */
  static midiDecides(actor, kind) {
    const api = midiApi();
    if (!api || !(kind in ENFORCE)) return false;
    let setting;
    try { setting = api.configSettings?.()?.[ENFORCE[kind]]; } catch { return false; }
    return (kind === "reaction" ? ["all", "displayOnly", actor.type] : ["all", actor.type]).includes(setting);
  }

  /** Midi's marker for a reaction or bonus action, if present and not already expiring. */
  static midiMarker(actor, kind) {
    if (!midiApi()) return null;
    const marker = actor.effects?.get(MARKERS[kind]) ?? actor.effects?.find(effect => effect.statuses?.has(MARKER_STATUS[kind]));
    if (!marker || marker.disabled || foundry.utils.getProperty(marker, "duration.expired") === true) return null;
    return marker;
  }

  /** Spent, partly spent or ready for each of action, bonus action and reaction, with who decided. */
  static economy(actor, now) {
    const own = readLedger(this.ledger(actor), now);
    const midiActions = actor.flags?.[MIDI]?.actions ?? {};
    const economy = {};
    for (const kind of ["reaction", "bonus"]) {
      const marker = this.midiMarker(actor, kind);
      const decides = this.midiDecides(actor, kind) || !!marker;
      const used = kind === "reaction" ? midiActions.reactionsUsed : midiActions.bonusActionsUsed;
      const max = Math.max(1, Math.trunc(Number(kind === "reaction" ? midiActions.reactionsMax : midiActions.bonusActionsMax)) || 1);
      const count = marker ? Math.max(1, Math.trunc(Number(used)) || 1) : 0;
      economy[kind] = decides
        ? { source: "midi", used: Math.min(count, max), max, spent: count >= max }
        : { source: "hardwipe", used: own[kind] ? 1 : 0, max: 1, spent: own[kind] };
    }
    // Midi clears its action flag at turn start; on someone else's turn the action is not in play.
    const midiAction = !!midiApi() && now?.isTurn && midiActions.action === true;
    economy.action = { source: midiAction && !own.action ? "midi" : "hardwipe", used: (own.action || midiAction) ? 1 : 0, max: 1, spent: own.action || midiAction };
    return { economy, own };
  }

  /** Feet (or the scene's units) moved this turn: the summed cost of the token's movement history. */
  static movement(actor, combatant, dash) {
    const token = combatant?.token ?? null;
    let used = 0;
    for (const waypoint of token?.movementHistory ?? []) {
      const cost = Number(waypoint?.cost);
      if (Number.isFinite(cost) && cost > 0) used += cost;
    }
    const movement = actor.system?.attributes?.movement ?? {};
    const speeds = movement.speeds ?? movement;
    const types = CONFIG.DND5E?.movementTypes ?? {};
    const action = token?.movementAction;
    const type = action in types && Number(speeds[action]) > 0 ? action : "walk";
    const speed = Math.max(0, Number(speeds[type]) || 0);
    const budget = speed * (dash ? 2 : 1);
    const units = movement.units || token?.parent?.grid?.units || "ft";
    return { used: Math.round(used * 10) / 10, speed, budget, type, action: action ?? type, units, hasToken: !!token, over: used > budget + 0.01 };
  }

  /* Recording ---------------------------------------------------------------------------------- */

  static async _onUse(activity) {
    const actor = activity?.actor;
    if (!actor || actor.type !== "character" || !canControlActor(actor)) return;
    const now = this.now(actor);
    if (!now) return;
    const activation = this._pending.get(activity.uuid) ?? activity.activation?.type ?? "";
    const next = recordUse(this.ledger(actor), { activation, attack: isWeaponAttack(activity), move: generalMoveOf(activity) }, now);
    if (next) await writeLedger(actor, next);
  }

  /**
   * One client clears the ledger of the actor whose turn starts: the active GM, else that actor's first active owner.
   * A Dodge taken from the panel lasts until then, so its status comes off with it.
   */
  static _onTurnChange(combat) {
    this._refreshCombat(combat);
    // The GM clears movement histories just after the turn changes, without an updateToken hook: look again.
    if (!game.user.isActiveGM) for (const delay of [800, 2000]) setTimeout(() => this._refreshCombat(combat), delay);
    const actor = combat?.combatant?.actor;
    const ledger = this.ledger(actor);
    if (!actor || !ledger || !responsibleFor(actor)) return;
    const dodged = ledger.combat === combat.id && !!ledger.moves?.dodge;
    void actor.unsetFlag(MODULE_ID, LEDGER).catch(reportError);
    if (dodged && actor.statuses?.has("dodging")) void actor.toggleStatusEffect("dodging", { active: false }).catch(reportError);
  }

  static _onDeleteCombat(combat) {
    for (const combatant of combat.combatants ?? []) {
      const actor = combatant.actor;
      this._refreshActor(actor);
      if (actor && this.ledger(actor)?.combat === combat.id && responsibleFor(actor)) void actor.unsetFlag(MODULE_ID, LEDGER).catch(reportError);
    }
  }

  static _refreshCombat(combat) {
    for (const combatant of combat?.combatants ?? []) this._refreshActor(combatant.actor);
  }

  static _refreshAll() {
    for (const app of foundry.applications.instances.values()) {
      if (app.rendered && typeof app._hardwipeRefreshTurn === "function") app._hardwipeRefreshTurn();
    }
  }

  /** A roll answering a request: the strip prints a receipt for a few seconds. */
  static _onAnswer(message) {
    const flag = message.flags?.dnd5e?.requestResult;
    if (!flag?.actorUuid) return;
    const spec = message.flags?.[MODULE_ID]?.requestRoll;
    const total = message.isContentVisible ? Number(message.rolls?.[0]?.total) : NaN;
    const name = spec ? rollName(spec) : String(message.flavor ?? "");
    this._sent.set(flag.actorUuid, { label: Number.isFinite(total) ? `${name} · ${total}` : name, until: Date.now() + SENT_MS });
    const actor = foundry.utils.fromUuidSync(flag.actorUuid, { strict: false });
    setTimeout(() => this._refreshActor(actor), SENT_MS + 100);
  }

  static _refreshActor(actor) {
    if (!actor) return;
    for (const app of foundry.applications.instances.values()) {
      if (app.rendered && typeof app._hardwipeRefreshTurn === "function" && sameActor(app.actor, actor)) app._hardwipeRefreshTurn();
    }
  }

  /* Panel actions ------------------------------------------------------------------------------ */

  static async handle(actor, target, event, sheet) {
    if (!canControlActor(actor) || actor.limited) return;
    switch (target.dataset.turnAction) {
      case "use": return this.use(actor, target, event, sheet);
      case "general": return this.general(actor, target.dataset.move, event);
      case "waiting-roll": return this.rollWaiting(actor, target, event);
      case "waiting-more":
        if (sheet) {
          sheet._hardwipeNetlinkOpen = !sheet._hardwipeNetlinkOpen;
          sheet._hardwipeRefreshTurn?.();
        }
        return;
      case "request-check": return this.requestCheck(actor);
      case "toggle": return this.toggle(actor, target.dataset.slot);
      case "end-program": {
        const effect = actor.effects.get(target.dataset.effectId);
        if (effect) await actor.endConcentration(effect);
        return;
      }
      case "drop-condition": return this.dropCondition(actor, target.dataset.effectId);
    }
  }

  /** Use an option from a band. A spent band only warns: Action Surge and GM rulings exist. */
  static async use(actor, target, event, sheet) {
    const item = actor.items.get(target.dataset.itemId);
    const activity = item?.system.activities?.get(target.dataset.activityId);
    if (!activity) return;
    if (CyberwareManager.isCyberware(item) && !CyberwareManager.isOperational(item)) return;
    const slot = target.dataset.slot;
    const now = this.now(actor);
    if (now && SLOTS.includes(slot) && (slot === "reaction" || now.isTurn)) {
      const { economy, own } = this.economy(actor, now);
      const perAction = attacksPerAction(actor.items, entry => CyberwareManager.isOperational(entry)).count;
      const attackInProgress = slot === "action" && isWeaponAttack(activity) && own.attacks > 0 && own.attacks < perAction;
      if (economy[slot].spent && !attackInProgress) {
        ui.notifications.warn(game.i18n.format("HARDWIPE.Turn.AlreadySpent", { slot: game.i18n.localize(`HARDWIPE.Turn.Slot.${slot}`) }));
      }
    }
    if (slot === "reaction" && activity.activation?.type !== "reaction") this._pending.set(activity.uuid, "reaction");
    try { return await activity.use({ event }, { options: { sheet } }); }
    finally { this._pending.delete(activity.uuid); }
  }

  /**
   * Take a standard action, or take it back if it was taken from the panel this turn. Grapple and Shove roll every
   * time, as one attack each, so they are never taken back.
   */
  static async general(actor, move, event) {
    const now = this.now(actor);
    if (!now?.isTurn || !GENERAL_MOVES.includes(move)) return;
    const { economy, own } = this.economy(actor, now);
    const label = game.i18n.localize(`HARDWIPE.Turn.Move.${move}.Label`);
    const taken = own.moves[move];
    const attackMove = ATTACK_MOVES.has(move);
    if (taken && !attackMove) {
      const ledger = currentLedger(this.ledger(actor), now);
      delete ledger.moves[move];
      await writeLedger(actor, ledger);
      if (economy[taken]?.spent) await this.toggle(actor, taken);
      if (move === "dodge" && actor.statuses?.has("dodging")) await actor.toggleStatusEffect("dodging", { active: false });
      return;
    }
    const perAction = attacksPerAction(actor.items, item => CyberwareManager.isOperational(item)).count;
    const pay = payFor(move, economy, attacksInProgress(own, perAction));
    if (!pay) {
      ui.notifications.warn(game.i18n.format(BONUS_FALLBACK.has(move) ? "HARDWIPE.Turn.NothingLeftBonus" : "HARDWIPE.Turn.NothingLeft", { move: label }));
      return;
    }
    if (pay === "bonus" && economy.bonus.source === "midi") await midiApi().setBonusActionUsed(actor);
    const ledger = currentLedger(this.ledger(actor), now);
    if (attackMove) Object.assign(ledger, { action: true, attacks: ledger.attacks + 1 });
    else if (pay === "action" || economy.bonus.source !== "midi") ledger[pay] = true;
    ledger.moves[move] = attackMove ? "action" : pay;
    await writeLedger(actor, ledger);
    if (move === "dodge" && CONFIG.statusEffects.some(status => status.id === "dodging") && !actor.statuses?.has("dodging")) {
      await actor.toggleStatusEffect("dodging", { active: true });
    }
    if (move === "hide") await actor.rollSkill({ skill: "ste", event });
    if (attackMove) await this.contestOrRoll(actor, move, event);
  }

  /**
   * Grapple or Shove: with one target, a contest card (Athletics against the target's Athletics or Acrobatics, the GM
   * rolls the defence); without one, a plain Athletics roll. The contest is optional, never required.
   */
  static async contestOrRoll(actor, move, event) {
    const targets = [...(game.user.targets ?? [])].map(token => token.actor).filter(other => other && other.uuid !== actor.uuid);
    if (targets.length !== 1) return actor.rollSkill({ skill: "ath", event });
    const request = await createRequest({
      participants: [actor, targets[0]], roll: parseRoll("skill:ath"), kind: "contest", action: move,
      defenderRolls: [parseRoll("skill:ath"), parseRoll("skill:acr")]
    });
    if (request) await rollFor(request, actor, -1, event);
  }

  /** Roll something this character owes, as the card's own button would. */
  static async rollWaiting(actor, target, event) {
    const message = game.messages.get(target.dataset.messageId);
    if (!message) return;
    switch (target.dataset.source) {
      case "request": return rollFor(message, actor, Number(target.dataset.option ?? -1), event);
      case "save": {
        // Ready Set Midi may already have put this save's roll dialog in front of the player: bring it forward
        // rather than start a second roll for the same save.
        const ability = message.flags?.[MODULE_ID]?.saves?.ability;
        const open = [...foundry.applications.instances.values()].find(app => app.rendered
          && app.config?.subject?.uuid === actor.uuid && app.config?.ability === ability);
        if (open) return open.bringToFront?.();
        return rollPendingSaves(message, actor, event);
      }
      case "concentration": return rollConcentrationRequest(message, event);
    }
  }

  /** GM: open the roll request composer for this character. */
  static requestCheck(actor) {
    return RollRequestComposer.open([actor]);
  }

  /** The rolls this character still owes: targeted requests, saves on cards, a concentration interrupt. */
  /**
   * The rolls this character owes, for the netlink strip: roll calls and contests, saves on cards and a concentration
   * interrupt. Closed items are gone, saves owed right now come first, and past the GM's limit the rest fold under
   * "more". `seen` (per sheet) marks rows that are new since the last draw, which type in once.
   */
  static waiting(actor, canControl, { netlinkOpen = false, seen = null } = {}) {
    const roll = [{ index: -1, label: game.i18n.localize("HARDWIPE.Turn.Waiting.Roll") }];
    const items = [];
    for (const message of game.messages.contents.slice(-60)) {
      if (closedOf(message)) continue;
      if (message.type === "request") {
        const pending = pendingFor(message, actor);
        if (pending) items.push({ messageId: message.id, source: "request", ...pending });
      } else if (message.flags?.[MODULE_ID]?.saves) {
        const found = pendingSaveTargets(message, actor);
        if (!found) continue;
        let item = null;
        try { item = message.getAssociatedItem?.(); } catch { item = null; }
        items.push({
          messageId: message.id, source: "save", kind: "save", badge: abilityAbbr(found.state.ability), tag: net("Save"),
          name: rollName({ type: "save", ability: found.state.ability }), dc: found.state.dc, detail: item?.name ?? "", options: roll, at: message.timestamp
        });
      }
    }
    const interrupt = pendingConcentration(actor);
    if (interrupt && !closedOf(interrupt)) {
      const data = interrupt.flags[MODULE_ID].concentrationCheck;
      const spells = data.spells?.map(spell => spell.name).join(", ");
      items.push({
        messageId: interrupt.id, source: "concentration", kind: "interrupt", badge: abilityAbbr(data.ability ?? "con"), tag: net("Interrupt"),
        name: net("Concentration"), dc: data.dc, detail: spells ? net("Keeps", { spells }) : "", options: roll, at: interrupt.timestamp
      });
    }
    const ordered = orderWaiting(items).map(item => {
      const fresh = !!seen && !seen.has(item.messageId);
      seen?.add(item.messageId);
      const hasDC = !!item.dc || !!item.dcHidden;
      return { ...item, canRoll: canControl, fresh, hasDC, hasMeta: hasDC || !!item.detail };
    });
    const { shown, more, expanded } = limitWaiting(ordered, waitingLimit(), netlinkOpen);
    const sent = this._sent.get(actor.uuid);
    return {
      items: shown, count: ordered.length, more, expanded,
      handle: actor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unit",
      countLabel: ordered.length === 1 ? net("CountOne") : net("Count", { count: ordered.length }),
      moreLabel: expanded ? net("AllShown", { count: ordered.length }) : net("More", { count: more }),
      toggleLabel: net(expanded ? "ShowFewer" : "ShowAll"),
      sent: sent && sent.until > Date.now() ? sent : null
    };
  }


  /** Flip one resource between spent and ready, through Midi when Midi decides it. */
  static async toggle(actor, kind) {
    const now = this.now(actor);
    if (!now || !SLOTS.includes(kind) || (kind !== "reaction" && !now.isTurn)) return;
    const { economy } = this.economy(actor, now);
    const state = economy[kind];
    const api = midiApi();
    if (kind !== "action" && state.source === "midi") {
      if (state.used > 0 && (state.spent || state.max === 1)) {
        if (kind === "reaction") await api.removeReactionUsed(actor, true);
        else await api.removeBonusActionUsed(actor, true);
      } else if (kind === "reaction") await api.setReactionUsed(actor, true, { force: true });
      else await api.setBonusActionUsed(actor);
      return;
    }
    // Action-side entries of an earlier turn are dead already, so resetting them here changes nothing shown.
    const ledger = currentLedger(this.ledger(actor), now);
    if (kind === "reaction") ledger.reaction = state.spent ? null : { round: now.round, turn: now.turn };
    else {
      ledger[kind] = !state.spent;
      if (state.spent) {
        if (kind === "action") ledger.attacks = 0;
        for (const [move, slot] of Object.entries(ledger.moves)) if (slot === kind) delete ledger.moves[move];
        if (kind === "action" && actor.flags?.[MIDI]?.actions?.action === true) await api?.removeActionUsed?.(actor);
      }
    }
    await writeLedger(actor, ledger);
  }

  /** Clear one condition: a level off a levelled condition (exhaustion), otherwise its effect. */
  static async dropCondition(actor, effectId) {
    const effect = actor.effects.get(effectId);
    if (!effect || !conditionStatuses(effect).length || isSystemEffect(effect)) return;
    // dnd5e's own decrease() carries the original level its update handler needs.
    if (effect.system?.hasLevels && Number(effect.system.level) > 1) return effect.system.decrease(1);
    return effect.delete();
  }

  /* Panel context ------------------------------------------------------------------------------ */

  /** Every activity the character can start, sorted into the three bands and "outside combat". */
  static options(actor) {
    const bands = { action: [], bonus: [], reaction: [] };
    const outside = [];
    const slotsLeft = spellSlotsLeft(actor);
    for (const item of actor.items) {
      if (item.type === "spell" && !isCastable(item)) continue;
      const cyberware = CyberwareManager.isCyberware(item);
      // A carried implant can't activate; an installed one that is offline shows why.
      if (cyberware && !CyberwareManager.getState(item).installed) continue;
      const activities = [...(item.system.activities ?? [])].filter(activity => !activity.isHidden && !activity.midiProperties?.automationOnly
        && activity.activation?.type && activity.activation.type !== "none");
      const bySlot = new Map();
      for (const activity of activities) {
        const slot = slotFor(activity.activation.type) ?? "outside";
        bySlot.set(slot, [...(bySlot.get(slot) ?? []), activity]);
      }
      for (const [slot, list] of bySlot) {
        for (const activity of list) (slot === "outside" ? outside : bands[slot]).push(optionEntry(item, activity, slot, list.length > 1, slotsLeft));
      }
      if (isMeleeWeapon(item) && item.system.equipped) {
        const attack = activities.find(activity => activity.type === "attack" && activity.activation.type === "action");
        if (attack) bands.reaction.push(optionEntry(item, attack, "reaction", false, slotsLeft, { opportunity: true }));
      }
    }
    for (const list of [...Object.values(bands), outside]) list.sort(compareOptions);
    return { bands, outside };
  }

  static context(actor, { netlinkOpen = false, seen = null } = {}) {
    if (!actor || actor.limited) return { limited: true };
    const canControl = canControlActor(actor);
    const now = this.now(actor);
    const unstaged = !now && game.combats?.some(combat => !combat.started && combatantFor(combat, actor));
    const view = { canControl, isGM: game.user.isGM, inCombat: !!now, isTurn: !!now?.isTurn, unstaged, labels: labels() };
    const { bands, outside } = this.options(actor);
    const attacks = attacksPerAction(actor.items, item => CyberwareManager.isOperational(item));
    let economy = null;
    let own = readLedger(null, null);

    if (now) {
      ({ economy, own } = this.economy(actor, now));
      const combat = now.combatDocument;
      const visible = combat.turns.filter(combatant => !combatant.hidden || game.user.isGM);
      const index = visible.findIndex(combatant => combatant.id === combat.combatant?.id);
      view.roundTag = `R${String(combat.round).padStart(2, "0")}`;
      view.position = index >= 0 ? `${index + 1}/${visible.length}` : "";
      view.upNow = combat.combatant && (!combat.combatant.hidden || game.user.isGM) ? combat.combatant.name : "";
      const dash = now.isTurn && !!own.dash;
      view.movement = movementView(this.movement(actor, now.combatant, dash), dash, now.isTurn);
      if (now.isTurn) view.standard = standardMoves(own, economy, attacks.count, canControl);
    }

    const usedAttacks = Math.min(own.attacks, attacks.count);
    const attacking = !!now?.isTurn && usedAttacks > 0 && usedAttacks < attacks.count;
    if (now) {
      // The state chips at the top; the action reads "Attacking · N left" while the Attack action is in progress.
      view.economy = SLOTS.map(kind => ({
        kind, label: game.i18n.localize(`HARDWIPE.Turn.Slot.${kind}`), icon: SLOT_ICONS[kind], ...slotState(kind, economy[kind], now, canControl)
      }));
      if (attacking) {
        Object.assign(view.economy[0], { state: "partial", stateLabel: game.i18n.format("HARDWIPE.Turn.AttacksLeftShort", { n: attacks.count - usedAttacks }) });
      }
      // Every attack the Attack action gives, and how many are left: 2/2, 1/2, 0/2.
      const left = !now.isTurn ? attacks.count : attacking ? attacks.count - usedAttacks : economy.action.spent ? 0 : attacks.count;
      view.attacks = {
        left, count: attacks.count, source: attacks.source,
        state: !now.isTurn ? "standby" : !left ? "spent" : attacking ? "partial" : "ready",
        pips: Array.from({ length: attacks.count }, (_, i) => ({ on: i < left }))
      };
    }

    const slots = spellSlotRows(actor);
    view.bands = SLOTS.map(kind => {
      const state = view.economy?.find(card => card.kind === kind)?.state ?? null;
      const band = { kind, state, label: game.i18n.localize(`HARDWIPE.Turn.Slot.${kind}`), icon: SLOT_ICONS[kind] };
      // Mid-Attack the action is committed: only the remaining weapon attacks stay lit.
      const dimBand = ["spent", "standby"].includes(state) || (kind === "action" && attacking);
      const entries = bands[kind].map(entry => {
        const inProgress = kind === "action" && attacking && entry.weaponAttack;
        const ownTurnOpportunity = entry.opportunity && now?.isTurn;
        return {
          ...entry, slot: kind,
          off: entry.off || ownTurnOpportunity, dim: entry.dim || (dimBand && !inProgress),
          note: ownTurnOpportunity ? game.i18n.localize("HARDWIPE.Turn.Note.opportunityOwnTurn") : entry.note,
          canUse: canControl && !entry.off && !ownTurnOpportunity
        };
      });
      band.main = entries.filter(entry => !["program", "gear"].includes(entry.group));
      band.programs = entries.filter(entry => entry.group === "program");
      band.slots = band.programs.length ? slots : [];
      band.gear = entries.filter(entry => entry.group === "gear");
      band.gearLabel = game.i18n.format("HARDWIPE.Turn.Gear", { count: band.gear.length });
      // Standard actions spend the action, so their rows sit in its band.
      if (kind === "action") band.standard = view.standard ?? null;
      band.empty = !entries.length && !band.standard;
      return band;
    });
    view.outside = outside.map(entry => ({ ...entry, slot: "outside", canUse: canControl && !entry.off }));
    view.waiting = this.waiting(actor, canControl, { netlinkOpen, seen });
    view.canRequest = game.user.isGM;
    view.outsideLabel = game.i18n.format("HARDWIPE.Turn.Outside", { count: outside.length });

    view.programs = [...(actor.concentration?.effects ?? [])].map(effect => {
      const data = effect.getFlag("dnd5e", "item") ?? {};
      const item = actor.items.get(data.id) ?? (data.data ? { name: data.data.name, img: data.data.img } : null);
      return { id: effect.id, name: item?.name ?? effect.name, img: item?.img ?? effect.img, canEnd: canControl };
    });
    view.conditions = [];
    for (const effect of actor.allApplicableEffects?.() ?? actor.effects) {
      if (!effect.active || isSystemEffect(effect)) continue;
      if (!conditionStatuses(effect).length) continue;
      const own = effect.parent === actor;
      view.conditions.push({
        id: effect.id, name: effect.name, img: effect.img, canDrop: canControl && own,
        from: own ? "" : effect.parent?.name ?? "",
        dropLabel: game.i18n.format("HARDWIPE.Turn.DropCondition", { name: effect.name })
      });
    }

    const edge = EdgeManager.get(actor);
    const strikes = StrikesManager.get(actor);
    const downed = DownedManager.isDowned(actor);
    const dead = actor.statuses?.has("dead") || strikes >= 3;
    view.edge = {
      value: edge, ready: edge > 0, canSpend: canControl && edge > 0,
      canRecover: canControl && edge > 0 && !dead && (downed || Number(actor.system?.attributes?.hp?.value) <= 0)
    };
    view.strikes = {
      value: strikes,
      tone: dead ? "is-dead" : strikes >= 2 ? "is-alert" : strikes === 1 ? "is-warn" : "is-clean",
      status: game.i18n.localize(dead ? "HARDWIPE.Strikes.Dead" : downed ? "HARDWIPE.Downed.Title" : "HARDWIPE.Strikes.Stable"),
      pips: [1, 2, 3].map(n => ({ n, on: strikes >= n, label: game.i18n.format("HARDWIPE.Strikes.Pip", { n }) }))
    };
    return view;
  }
}

/** One usable activity, as a row: name, what it does (to-hit or DC, damage, range) and why it may be unavailable. */
function optionEntry(item, activity, slot, several, slotsLeft, { opportunity = false } = {}) {
  const t = key => game.i18n.localize(`HARDWIPE.Turn.${key}`);
  const group = optionGroup(item);
  const labels = activity.labels ?? {};
  const damage = (Array.isArray(labels.damages) ? labels.damages : []).map(part => part?.label ?? part?.formula ?? part).filter(Boolean).join(" + ");
  const lead = labels.toHit || String(labels.save ?? "").trim();
  const reach = labels.range && labels.range !== "Self" ? labels.range : "";
  const timed = labels.duration && !/instant/i.test(labels.duration) ? labels.duration : "";
  const meta = (lead || damage) ? [lead, damage, reach] : [labels.range, timed];
  const level = group === "program" ? Number(item.system.level) || 0 : null;
  const uses = activity.uses?.max ? activity.uses : item.system.uses?.max ? item.system.uses : null;
  let tag = "";
  if (group === "program") tag = level ? game.i18n.format("HARDWIPE.Turn.Tag.level", { level }) : t("Tag.cantrip");
  else if (uses) tag = `${uses.value ?? 0}/${uses.max}`;
  else if ((item.system.quantity ?? 1) > 1 && group === "gear") tag = `×${item.system.quantity}`;

  let note = opportunity ? t("Note.opportunity") : "";
  let off = false;
  let dim = false;
  if (CyberwareManager.isCyberware(item) && !CyberwareManager.isOperational(item)) {
    const state = CyberwareManager.getState(item);
    off = true;
    note = t(state.damaged ? "Note.implantDamaged" : "Note.implantOffline");
  } else if (group === "weapon" && !item.system.equipped) {
    dim = true;
    note = t("Note.notDrawn");
  } else if (uses && (Number(uses.value) || 0) <= 0) {
    dim = true;
    note = t("Note.noUses");
  } else if (level && activity.requiresSpellSlot !== false && activity.consumption?.spellSlot !== false && !slotsLeft(level)) {
    dim = true;
    note = t("Note.noSlots");
  }
  if (!note && labels.concentrationDuration && /concentration/i.test(labels.concentrationDuration)) note = t("Note.concentration");
  return {
    itemId: item.id, activityId: activity.id, uuid: item.uuid, img: item.img, name: item.name, group, level,
    sub: activity._source?.name ? plainActivityLabel(activity.name) : several ? plainActivityLabel(activity.name) : "",
    meta: meta.filter(Boolean).join(" · "), tag, note, off, dim, opportunity, notDrawn: group === "weapon" && !item.system.equipped,
    weaponAttack: isWeaponAttack(activity)
  };
}

/** Whether any slot of the level or higher (pact slots included) has a charge left. */
function spellSlotsLeft(actor) {
  const slots = Object.values(actor.system?.spells ?? {});
  return level => slots.some(slot => (Number(slot?.level) || 0) >= level && (Number(slot?.value) || 0) > 0);
}

function spellSlotRows(actor) {
  const rows = [];
  for (const [key, slot] of Object.entries(actor.system?.spells ?? {})) {
    const max = Math.max(0, Number(slot?.max) || 0);
    if (!max) continue;
    const value = Math.max(0, Number(slot?.value) || 0);
    const pact = key === "pact";
    rows.push({
      key, level: Number(slot.level) || 0, pact,
      label: pact ? game.i18n.format("HARDWIPE.Turn.Pact", { level: slot.level }) : game.i18n.format("HARDWIPE.Turn.Tag.level", { level: slot.level }),
      pips: Array.from({ length: Math.max(max, value) }, (_, i) => ({ on: i < value })), text: `${value}/${max}`
    });
  }
  return rows.sort((a, b) => (a.level - b.level) || (a.pact - b.pact));
}

function slotState(kind, state, now, canControl) {
  const offTurn = kind !== "reaction" && !now.isTurn;
  const partial = !state.spent && state.used > 0;
  const status = offTurn ? "standby" : state.spent ? "spent" : partial ? "partial" : "ready";
  const label = game.i18n.localize(`HARDWIPE.Turn.Slot.${kind}`);
  return {
    state: status,
    stateLabel: status === "partial" ? `${state.used}/${state.max}` : game.i18n.localize(`HARDWIPE.Turn.State.${status}`),
    canToggle: canControl && !offTurn,
    hint: offTurn ? game.i18n.localize("HARDWIPE.Turn.StandbyHint") : game.i18n.format("HARDWIPE.Turn.StateHint", { slot: label })
  };
}

/** Attacks left in an Attack action already under way (0 when none is). */
function attacksInProgress(own, perAction) {
  return own.attacks > 0 && own.attacks < perAction ? perAction - own.attacks : 0;
}

/** The standard actions as option rows: what each does, what it would cost now, and whether it's taken. */
function standardMoves(own, economy, perAction, canControl) {
  const left = attacksInProgress(own, perAction);
  return GENERAL_MOVES.map(move => {
    const t = key => game.i18n.localize(`HARDWIPE.Turn.Move.${move}.${key}`);
    const repeat = ATTACK_MOVES.has(move);
    const taken = repeat ? null : own.moves[move] ?? null;
    const pay = payFor(move, economy, left);
    let note = "";
    if (taken) note = game.i18n.localize(taken === "bonus" ? "HARDWIPE.Turn.Note.takenBonus" : "HARDWIPE.Turn.Note.taken");
    else if (pay === "bonus") note = game.i18n.localize("HARDWIPE.Turn.Note.asBonus");
    else if (pay === "attack") note = game.i18n.format("HARDWIPE.Turn.Note.asAttack", { n: left });
    return {
      move, label: t("Label"), meta: t("Effect"), hint: t("Hint"), icon: MOVE_ICONS[move], taken: !!taken, note,
      canUse: canControl && (!!taken || !!pay), dim: !taken && !pay
    };
  });
}

/** A cell per 5 units of the budget (up to 24); cells past the budget show overspend. */
function movementView(movement, dash, isTurn) {
  const step = movement.budget > 120 ? movement.budget / 24 : 5;
  const cells = Math.max(1, Math.min(24, Math.ceil(movement.budget / step) || 1));
  const lit = Math.min(cells, Math.round(movement.used / step));
  const over = movement.over ? Math.min(6, Math.ceil((movement.used - movement.budget) / step)) : 0;
  // The way the token moves (Walk, Crawl, Fly), not dnd5e's name for the speed ("Speed" for walking).
  const config = CONFIG.Token?.movement?.actions?.[movement.action] ?? CONFIG.DND5E?.movementTypes?.[movement.type];
  const typeLabel = game.i18n.localize(typeof config === "string" ? config : config?.label ?? movement.type);
  const units = CONFIG.DND5E?.movementUnits?.[movement.units];
  const unitLabel = typeof units === "string" ? movement.units : units?.abbreviation ?? movement.units;
  return {
    ...movement, dash, isTurn, unitLabel, typeLabel,
    left: Math.max(0, Math.round((movement.budget - movement.used) * 10) / 10),
    overBy: Math.max(0, Math.round((movement.used - movement.budget) * 10) / 10),
    cells: Array.from({ length: cells }, (_, index) => ({ on: index < lit })),
    overCells: Array.from({ length: over }),
    tone: movement.over ? "is-over" : movement.budget && movement.used >= movement.budget ? "is-full" : ""
  };
}

function labels() {
  const t = key => game.i18n.localize(`HARDWIPE.Turn.${key}`);
  return {
    title: t("Title"), movement: t("Movement"), standard: t("StandardActions"), programs: t("Programs"), running: t("Running"),
    waiting: t("Waiting.Label"), roll: t("Waiting.Roll"), requestCheck: t("Request.Button"),
    netIdle: t("Net.Idle"), netSent: t("Net.Sent"), dcHidden: t("Net.DcHidden"),
    conditions: t("Conditions"), runningPrograms: t("RunningPrograms"), noPrograms: t("NoPrograms"), noConditions: t("NoConditions"),
    resources: t("Resources"), attacks: t("Attacks"), attacksLeft: t("AttacksLeftLabel"), economy: t("Economy"), noCombat: t("NoCombat"), unstaged: t("Unstaged"), yourTurn: t("YourTurn"),
    upNow: t("UpNow"), nothing: t("Nothing"), dashOn: t("DashOn"), noToken: t("NoToken"), slots: t("Slots"),
    endProgram: game.i18n.localize("HARDWIPE.Conc.End"), edge: game.i18n.localize("HARDWIPE.Edge.Title"),
    strikes: game.i18n.localize("HARDWIPE.Strikes.Title"), spend: game.i18n.localize("HARDWIPE.Edge.SpendShort"),
    spendEdge: game.i18n.localize("HARDWIPE.Edge.Spend"), award: game.i18n.localize("HARDWIPE.Edge.Award"),
    recover: game.i18n.localize("HARDWIPE.Edge.RecoverShort"), from: t("From"), left: t("Left"), over: t("Over")
  };
}

/** Condition statuses an effect carries, leaving out what the panel shows elsewhere. */
function conditionStatuses(effect) {
  const types = CONFIG.DND5E?.conditionTypes ?? {};
  const skip = new Set([CONFIG.specialStatusEffects?.CONCENTRATING ?? "concentrating", "dead", ...Object.values(MARKER_STATUS)]);
  return [...(effect.statuses ?? [])].filter(status => status in types && !skip.has(status));
}

/** Hardwipe's Downed, Midi's markers and concentration have their own places in the panel. */
function isSystemEffect(effect) {
  if (effect.getFlag?.(MODULE_ID, "type") === "downed") return true;
  if (Object.values(MARKERS).includes(effect.id)) return true;
  return effect.statuses?.has?.(CONFIG.specialStatusEffects?.CONCENTRATING ?? "concentrating") ?? false;
}

/**
 * Store the whole ledger. setFlag merges objects, so moves taken back (or left from an earlier turn) would survive it.
 */
function writeLedger(actor, ledger) {
  const replace = foundry.data?.operators?.ForcedReplacement;
  if (replace) return actor.update({ [`flags.${MODULE_ID}.${LEDGER}`]: replace.create(ledger) });
  return actor.update({ [`flags.${MODULE_ID}.==${LEDGER}`]: ledger });
}

function combatantFor(combat, actor) {
  return combat?.combatants?.find(combatant => sameActor(combatant.actor, actor)) ?? null;
}

function sameActor(a, b) { return !!a && !!b && (a === b || a.uuid === b.uuid); }

function midiApi() {
  const active = game.modules.get("ready-set-midi")?.active || game.modules.get(MIDI)?.active;
  return active && globalThis.MidiQOL ? globalThis.MidiQOL : null;
}

/** The active GM, or with no GM online the actor's first active owner, so exactly one client writes. */
function responsibleFor(actor) {
  const gm = game.users.activeGM;
  if (gm) return gm.isSelf;
  const owners = game.users.filter(user => user.active && actor.testUserPermission(user, "OWNER")).sort((a, b) => a.id.localeCompare(b.id));
  return owners[0]?.isSelf ?? false;
}

function reportError(error) {
  console.error(`${MODULE_ID} | Turn panel`, error);
  ui.notifications?.error(error.message ?? String(error));
}
