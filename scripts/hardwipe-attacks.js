import { MODULE_ID, escapeHTML, plainActivityLabel } from "./hardwipe-state.js";
import { HardwipeRules } from "./hardwipe-rules.js";
import {
  bindBrief, briefHTML, decorateRollCard, fallenTargets, insertAfterDamage, markDamageTypes, stampHTML, propertyChipsHTML, rarityClasses, recordSaveTargets, saveBlock, saveState
} from "./hardwipe-attack-cards.js";
import { isSpellCard, renderSpellCard } from "./hardwipe-spell-cards.js";
import { isImplantCard, renderImplantCard } from "./hardwipe-implant-cards.js";
import { isCheckCard, renderCheckCard } from "./hardwipe-check-cards.js";
import { isGearCard, renderGearCard } from "./hardwipe-item-cards.js";

const CARD_FLAG = "attackReview";      // On the attack card: status and final outcomes, visible to everyone.
const REVIEW_FLAG = "attackReviewGM";  // On the GM-only review message: totals, AC and suggestions.
// Stored targets are arrays: flag updates would expand the dots in a token UUID used as a key.
const SETTING = "attackReview";
const MIDI = "midi-qol";
const OUTCOMES = new Set(["hit", "critical", "miss", "fumble"]);
const OUTCOME_ICONS = { hit: "fa-check", critical: "fa-burst", miss: "fa-xmark", fumble: "fa-skull" };
const VERDICT_ICONS = { ...OUTCOME_ICONS, pending: "fa-hourglass-half", mixed: "fa-list-check", attack: "fa-crosshairs" };
// Spell attacks read as cyber attacks in Hardwipe.
const ATTACK_KINDS = {
  melee: { icon: "fa-sword", label: "HARDWIPE.Attack.KindMelee" },
  ranged: { icon: "fa-crosshairs", label: "HARDWIPE.Attack.KindRanged" },
  cyber: { icon: "fa-microchip", label: "HARDWIPE.Attack.KindCyber" }
};

/**
 * GM-confirmed attacks. Every targeted attack shows the rolls
 * as a pending ATTACK card; the active GM confirms Hit, Critical or Miss on a whispered review card.
 * The attacker's Ready Set Midi workflow waits (after damage is rolled, before it is applied) and then
 * continues with the GM's outcome, so damage, effects and macros run through the normal workflow.
 * Natural crits and natural 1s keep their rule outcome, but still require confirmation.
 */
export class AttackReviewManager {
  static _pending = new Map();
  static _socket = null;
  static _initialized = false;
  static _deciding = new Set();

  static registerSettings() {
    if (game.settings.settings.has(`${MODULE_ID}.${SETTING}`)) return;
    game.settings.register(MODULE_ID, SETTING, {
      name: "HARDWIPE.Attack.Setting", hint: "HARDWIPE.Attack.SettingHint",
      scope: "world", config: true, type: Boolean, default: true
    });
  }

  /** Chat rendering hooks go in at init: the chat log renders stored messages before "ready". */
  static registerHooks() {
    Hooks.on("renderChatMessageHTML", (message, html) => this._onRender(message, html));
    // dnd5e rebuilds usage-card content after the core render hook; attack banners go in afterwards.
    // Registered at setup, after Ready Set Midi's init listener has stamped the roll elements.
    Hooks.once("setup", () => Hooks.on("dnd5e.renderChatMessage", (message, html) => this._onRenderAttack(message, html)));
    Hooks.on("updateChatMessage", (message, changes) => this._onUpdateCard(message, changes));
    Hooks.on("deleteChatMessage", message => this._abandon(message.id));
    // A saving throw or check linked to a card updates that card's results on every client.
    Hooks.on("createChatMessage", message => {
      const origin = message.type === "save" ? message.flags?.dnd5e?.originatingMessage
        : message.type === "check" ? message.flags?.dnd5e?.originatingMessage ?? message._source?.system?.origin : null;
      const card = origin && game.messages.get(origin);
      if (card) ui.chat?.updateMessage?.(card);
    });
  }

  static initialize() {
    if (this._initialized) return;
    this._initialized = true;
    this._registerSocket();
    Hooks.on("socketlib.ready", () => this._registerSocket());
    // Registered after the cover manager, so cover-adjusted hit results are captured.
    Hooks.on("midi-qol.targetHitResolved", context => this._onTargetHitResolved(context));
    // A confirmed roll finishes applying before another roll can replace its damage.
    Hooks.on("midi-qol.preAttackRoll", async workflow => {
      await this._pending.get(workflow.chatCard?.id)?.application;
    });
    Hooks.on("midi-qol.hitsChecked", workflow => this._guard(workflow, () => this._onHitsChecked(workflow)));
    Hooks.on("midi-qol.AttackRollComplete", workflow => this._guard(workflow, () => this._holdWithoutDamage(workflow)));
    Hooks.on("midi-qol.DamageRollComplete", workflow => this._guard(workflow, () => this._holdForDamage(workflow)));
    Hooks.on("midi-qol.preWaitForSaves", workflow => this._guard(workflow, () => this._beforeSaves(workflow)));
    // The caster's client records who must save, so every client can list them while they roll.
    Hooks.on("midi-qol.preCheckSaves", workflow => recordSaveTargets(workflow));
    Hooks.on("midi-qol.RollComplete", workflow => recordSaveTargets(workflow));
  }

  static async _onUpdateCard(message, changes) {
    const workflow = this._pending.get(message.id)?.workflow;
    if (workflow && !workflow.aborted && workflow.hardwipeAttack?.key !== attackKey(workflow)) {
      // Midi's retroactive roll controls update the card without firing hitsChecked.
      await this._guard(workflow, async () => {
        await workflow.checkHits();
        await this._onHitsChecked(workflow);
      });
    }
    if (!game.user.isGM) return;
    if (!foundry.utils.hasProperty(changes, `flags.${MIDI}.damageTotal`) && !("rolls" in changes)) return;
    const review = game.messages.get(message.getFlag(MODULE_ID, CARD_FLAG)?.reviewMessageId);
    if (review) ui.chat?.updateMessage?.(review);
  }

  static _abandon(cardId) {
    const pending = this._pending.get(cardId);
    if (!pending || pending.settled) return;
    pending.settled = true;
    pending.workflow.aborted = true;
    pending.resolve(null);
  }

  static _registerSocket() {
    if (this._socket || !globalThis.socketlib) return;
    this._socket = socketlib.registerModule(MODULE_ID);
    // Runs on the active GM: create the private review card for a player's pending attack.
    this._socket?.register("postAttackReview", function(payload) {
      return AttackReviewManager._createReview(payload, this.socketdata?.userId);
    });
    // Runs on the attacking client: resume the paused workflow with the GM's outcomes.
    this._socket?.register("resolveAttack", function(cardId, outcomes, key) {
      if (!game.users.get(this.socketdata?.userId)?.isGM) return false;
      return AttackReviewManager._resolveLocal(cardId, outcomes, key);
    });
    this._socket?.register("decideAttack", function(reviewId, outcomes) {
      if (!game.users.get(this.socketdata?.userId)?.isGM) return false;
      const review = game.messages.get(reviewId);
      return review ? AttackReviewManager.decide(review, outcomes) : false;
    });
  }

  static enabled() {
    return game.settings.get(MODULE_ID, SETTING) !== false;
  }

  /** All actors and users require approval when attacking a creature. */
  static isReviewedAttack(actor, targets) {
    if (!this.enabled() || !actor) return false;
    return [...(targets ?? [])].some(target => this._isReviewedTarget(target));
  }

  static isReviewedWorkflow(workflow) {
    return !!workflow?.activity?.attack && this.isReviewedAttack(workflow.actor, workflow.targets);
  }

  static _isReviewedTarget(token) {
    const actor = token?.actor;
    return !!actor;
  }

  static _onTargetHitResolved(context) {
    const workflow = context?.workflow;
    if (!this.isReviewedWorkflow(workflow) || !this._isReviewedTarget(context.targetToken)) return;
    workflow.hardwipeAttackTargets ??= new Map();
    workflow.hardwipeAttackTargets.set(context.targetToken.document.uuid, {
      total: Number(context.attackTotal), ac: Number(context.targetAC)
    });
  }

  static async _onHitsChecked(workflow) {
    const key = attackKey(workflow);
    if (!this.isReviewedWorkflow(workflow) || workflow.hardwipeAttack?.key === key || workflow.aborted) return;
    const card = workflow.chatCard;
    if (!card) throw new Error("The attack has no chat card for GM approval.");
    const melee = !!workflow.attackRoll && HardwipeRules._isMeleeAttack(workflow.attackRoll, workflow.activity);
    const entries = [];
    for (const token of workflow.targets) {
      if (!this._isReviewedTarget(token)) continue;
      const uuid = token.document.uuid;
      const captured = workflow.hardwipeAttackTargets?.get(uuid);
      const total = Number(captured?.total ?? workflow.attackTotal);
      const ac = Number(captured?.ac ?? token.actor.system?.attributes?.ac?.value);
      const isHit = workflow.hitTargets.has(token) || workflow.hitTargetsEC.has(token);
      const suggestion = suggestOutcome({ isHit, isCritical: workflow.isCritical, isFumble: workflow.isFumble, melee, total, ac });
      const playerName = workflow.hitDisplayData?.[uuid]?.playerName || token.name;
      entries.push({ token, uuid, name: token.name, playerName, img: token.document.texture?.src ?? token.actor.img, total, ac, ...suggestion,
        cover: coverSnapshot(workflow, token) });
    }
    if (!entries.length) return;
    const state = {
      version: 1, status: "pending", attackKey: key, natural: d20Natural(workflow), kind: attackKind(workflow.activity, melee),
      targets: entries.map(entry => ({
        uuid: entry.uuid, name: entry.playerName, img: entry.img,
        outcome: null, reason: entry.reason, cover: entry.cover
      }))
    };
    workflow.hardwipeAttack = { entries, pending: true, key };
    // Establish the wait before the review can render on the GM's client.
    if (!this._pending.get(card.id) || this._pending.get(card.id).settled) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      this._pending.set(card.id, { workflow, promise, resolve, settled: false });
    }
    await card.setFlag(MODULE_ID, CARD_FLAG, state);
    {
      let reviewId = null;
      try {
        const payload = {
            cardId: card.id, attackKey: key, melee, natural: state.natural, kind: state.kind,
            targets: entries.map(({ uuid, name, img, total, ac, suggested, locked, reason }) => ({
              uuid, name, img, total, ac: Number.isFinite(ac) ? ac : null, suggested, locked, reason
            }))
          };
        if (game.user.isGM) reviewId = await this._createReview(payload, game.user.id);
        else if (game.users.activeGM && this._socket) reviewId = await this._socket.executeAsGM("postAttackReview", payload);
      } catch (error) {
        console.warn(`${MODULE_ID} | Attack review could not reach a GM`, error);
      }
      if (reviewId) {
        // Damage is still rolled for pending targets; the GM's decision removes misses before it is applied.
        for (const entry of entries) {
          workflow.hitTargets.add(entry.token);
          const display = workflow.hitDisplayData?.[entry.uuid];
          if (display) { display.hitClass = "hardwipe-pending"; display.hitSymbol = "fa-hourglass-half"; }
        }
        await card.setFlag(MODULE_ID, `${CARD_FLAG}.reviewMessageId`, reviewId);
      } else {
        await this._stop(workflow);
      }
    }
  }

  /** Midi catches hook exceptions, so explicitly abort before it can continue. */
  static async _guard(workflow, action) {
    try { await action(); }
    catch (error) {
      console.error(`${MODULE_ID} | Attack approval stopped the workflow`, error);
      await this._stop(workflow);
    }
  }

  static async _stop(workflow) {
    workflow.aborted = true;
    workflow.hitTargets?.clear();
    workflow.hitTargetsEC?.clear();
    const card = workflow.chatCard;
    this._pending.get(card?.id)?.resolve(null);
    this._pending.delete(card?.id);
    try { if (card) await card.setFlag(MODULE_ID, `${CARD_FLAG}.unavailable`, true); }
    catch (error) { console.warn(`${MODULE_ID} | Could not record unavailable approval`, error); }
    ui.notifications.error(game.i18n.localize("HARDWIPE.Attack.ReviewUnavailable"));
  }

  /** Cover skipped damage and restore confirmed hits after Midi's manual-hit reset. */
  static async _beforeSaves(workflow) {
    if (!workflow.hardwipeAttack || workflow.aborted) return;
    if (workflow.hardwipeAttack.key !== attackKey(workflow)) {
      if (!this.isReviewedWorkflow(workflow)) return;
      await workflow.checkHits();
      await this._onHitsChecked(workflow);
    }
    const card = workflow.chatCard, pending = this._pending.get(card?.id);
    if (pending) await this._hold(workflow, card, pending);
    const state = (game.messages.get(card?.id) ?? card)?.getFlag(MODULE_ID, CARD_FLAG);
    if (state?.status !== "resolved") return;
    for (const entry of workflow.hardwipeAttack.entries) {
      const outcome = stateTarget(state, entry.uuid)?.outcome;
      if (["hit", "critical"].includes(outcome)) workflow.hitTargets.add(entry.token);
      else { workflow.hitTargets.delete(entry.token); workflow.hitTargetsEC.delete(entry.token); }
    }
  }

  static async _holdForDamage(workflow) {
    const card = workflow?.chatCard;
    const pending = card && this._pending.get(card.id);
    if (!pending || pending.workflow !== workflow) return;
    // The player sees the damage roll while the GM decides; it is applied only after the decision.
    await workflow.displayDamageRolls();
    await this._hold(workflow, card, pending);
  }

  static async _holdWithoutDamage(workflow) {
    // Midi omits hitsChecked when its automatic hit calculation is disabled.
    if (this.isReviewedWorkflow(workflow) && workflow.hardwipeAttack?.key !== attackKey(workflow)) {
      await workflow.checkHits();
      await this._onHitsChecked(workflow);
    }
    if (workflow?.activity?.hasDamage || workflow?.otherActivity?.hasDamage) return;
    const card = workflow?.chatCard;
    const pending = card && this._pending.get(card.id);
    if (!pending || pending.workflow !== workflow) return;
    await this._hold(workflow, card, pending);
  }

  static async _hold(workflow, card, pending) {
    const decision = await pending.promise;
    const current = this._pending.get(card.id);
    if (current && current !== pending) return this._hold(workflow, card, current);
    if (decision === null) return; // Card deleted: Ready Set Midi aborts the workflow.
    // A reroll may have another state transition waiting on the same decision.
    pending.application ??= Promise.resolve().then(() => this._applyDecision(workflow, card, decision));
    await pending.application;
    const replacement = this._pending.get(card.id);
    if (replacement && replacement !== pending) return this._hold(workflow, card, replacement);
    if (this._pending.get(card.id) === pending) this._pending.delete(card.id);
  }

  static _matchesAttack(card, key, workflow) {
    const state = (game.messages.get(card?.id) ?? card)?.getFlag(MODULE_ID, CARD_FLAG);
    return !!state && !state.unavailable && state.attackKey === key && (!workflow ||
      (!workflow.aborted && workflow.hardwipeAttack?.key === key && attackKey(workflow) === key));
  }

  static async _applyDecision(workflow, card, { key, outcomes }) {
    const current = () => this._matchesAttack(card, key, workflow);
    if (!current()) return;
    const attack = workflow.hardwipeAttack;
    const state = foundry.utils.deepClone((game.messages.get(card.id) ?? card).getFlag(MODULE_ID, CARD_FLAG) ?? {});
    const critTokens = [];
    for (const entry of attack.entries) {
      const outcome = entry.locked ? entry.suggested : OUTCOMES.has(outcomes?.[entry.uuid]) ? outcomes[entry.uuid] : entry.suggested;
      if (outcome === "miss" || outcome === "fumble") {
        workflow.hitTargets.delete(entry.token);
        workflow.hitTargetsEC.delete(entry.token);
      } else {
        workflow.hitTargets.add(entry.token);
        if (outcome === "critical" && !workflow.isCritical) critTokens.push(entry.token);
      }
      const target = stateTarget(state, entry.uuid);
      if (target) target.outcome = outcome;
    }
    if (critTokens.length) {
      const bonus = await rollCriticalDice(workflow.damageRolls ?? []);
      if (!current()) return;
      const everyHitIsCritical = [...workflow.hitTargets, ...workflow.hitTargetsEC].every(token => critTokens.includes(token));
      if (bonus?.total > 0 && everyHitIsCritical) {
        // Every target that takes damage is a critical: add the extra dice to the workflow's own damage roll.
        await workflow.addDamageRolls(bonus.rolls);
        if (!current()) return;
        await workflow.displayDamageRolls();
      } else if (bonus?.total > 0) {
        await MidiQOL.applyTokenDamage(bonus.detail, bonus.total, new Set(critTokens), workflow.item, new Set(), { workflow, forceApply: true });
      }
      if (!current()) return;
      if (bonus?.total > 0) for (const token of critTokens) stateTarget(state, token.document.uuid).critBonus = bonus.total;
    }
    state.status = "resolved";
    state.application = "workflow";
    if (!current()) return;
    await card.setFlag(MODULE_ID, CARD_FLAG, state);
    if (current()) attack.pending = false;
  }

  static _resolveLocal(cardId, outcomes, key) {
    const pending = this._pending.get(cardId);
    if (!pending) return false;
    // A live replacement roll must not be mistaken for a disconnected workflow.
    if (!this._matchesAttack(game.messages.get(cardId), key, pending.workflow)) return null;
    if (!pending.settled) {
      pending.settled = true;
      const clean = {};
      for (const [uuid, outcome] of Object.entries(outcomes ?? {})) if (OUTCOMES.has(outcome)) clean[uuid] = outcome;
      pending.resolve({ key, outcomes: clean });
    }
    return true;
  }

  /** GM side: check the request comes from the card's author, then create the private review. */
  static async _createReview(payload, senderId) {
    if (!game.user.isGM || (game.user.id !== game.users.activeGM?.id && game.user.id !== senderId)) return null;
    const sender = game.users.get(senderId);
    const card = game.messages.get(payload?.cardId);
    if (!sender || !card || card.author?.id !== sender.id) return null;
    const attacker = ChatMessage.implementation.getSpeakerActor(card.speaker);
    if (!attacker?.testUserPermission(sender, "OWNER")) return null;
    // Totals, AC and suggestions are the attacker's Ready Set Midi results (cover, flanking and AC effects included).
    const natural = Number(payload.natural);
    const targets = (payload.targets ?? []).filter(target => typeof target?.uuid === "string" && OUTCOMES.has(target.suggested)).map(target => ({
      uuid: target.uuid, name: String(target.name ?? ""), img: String(target.img ?? ""), total: Number(target.total),
      ac: target.ac === null || target.ac === undefined || !Number.isFinite(Number(target.ac)) ? null : Number(target.ac),
      suggested: target.suggested, locked: !!target.locked, reason: String(target.reason ?? "")
    }));
    if (!targets.length) return null;
    const gmIds = game.users.filter(user => user.isGM).map(user => user.id);
    const kind = ATTACK_KINDS[payload.kind] ? payload.kind : payload.melee ? "melee" : "ranged";
    const data = { cardId: card.id, attackKey: payload.attackKey, attackerUserId: sender.id, natural: Number.isFinite(natural) ? natural : null, melee: !!payload.melee, kind, targets, decision: null };
    const item = card.getAssociatedItem?.();
    const review = await ChatMessage.implementation.create({
      content: reviewHTML(data, {
        weapon: item?.name ?? card.system?.item?.name ?? "", activity: card.getAssociatedActivity?.()?.name ?? "", rarity: rarityClasses(item)
      }),
      speaker: card.speaker, whisper: gmIds, flags: { [MODULE_ID]: { [REVIEW_FLAG]: data } }
    });
    return review?.id ?? null;
  }

  /** GM: record the decision, resume the attacker's workflow, or apply damage directly if it is gone. */
  static async decide(review, outcomes) {
    if (!game.user.isGM) throw new Error(game.i18n.localize("HARDWIPE.Attack.GMOnly"));
    const activeGM = game.users.activeGM;
    if (activeGM && activeGM.id !== game.user.id) {
      if (!this._socket) throw new Error(game.i18n.localize("HARDWIPE.Attack.ReviewUnavailable"));
      return this._socket.executeAsUser("decideAttack", activeGM.id, review.id, outcomes);
    }
    if (this._deciding.has(review.id)) return false;
    this._deciding.add(review.id);
    try { return await this._decide(review, outcomes); }
    finally { this._deciding.delete(review.id); }
  }

  static async _decide(review, outcomes) {
    if (!game.user.isGM) throw new Error(game.i18n.localize("HARDWIPE.Attack.GMOnly"));
    const data = review.getFlag(MODULE_ID, REVIEW_FLAG);
    if (!data || data.decision) return false;
    const card = game.messages.get(data.cardId);
    const state = card?.getFlag(MODULE_ID, CARD_FLAG);
    if (!card || state?.unavailable || (data.attackKey && data.attackKey !== state?.attackKey)) return false;
    const final = {};
    for (const target of data.targets) {
      const chosen = outcomes?.[target.uuid];
      final[target.uuid] = target.locked ? target.suggested : OUTCOMES.has(chosen) && chosen !== "fumble" ? chosen : target.suggested;
    }
    const decision = data.targets.map(target => final[target.uuid]);
    await review.setFlag(MODULE_ID, REVIEW_FLAG, { ...data, decision, decidedBy: game.user.id, decidedAt: Date.now() });
    if (!this._matchesAttack(card, data.attackKey)) return false;
    let delivered = false;
    try {
      if (data.attackerUserId === game.user.id) delivered = this._resolveLocal(data.cardId, final, data.attackKey);
      else if (this._socket && game.users.get(data.attackerUserId)?.active) {
        delivered = await this._socket.executeAsUser("resolveAttack", data.attackerUserId, data.cardId, final, data.attackKey);
      }
    } catch (error) {
      console.warn(`${MODULE_ID} | Attacking client did not answer; applying the outcome from the GM client`, error);
    }
    if (delivered === null) return false;
    if (!delivered) await this._applyFromGM(data, final);
    return true;
  }

  /** The attacker's workflow is gone (reload or disconnect): apply rolled damage from the stored card. */
  static async _applyFromGM(data, final) {
    const card = game.messages.get(data.cardId);
    const current = () => this._matchesAttack(card, data.attackKey, this._pending.get(data.cardId)?.workflow);
    if (!current()) return;
    const midi = card.flags?.[MIDI] ?? {};
    const detail = (midi.damageDetail ?? []).map(part => ({ type: part.type, value: Number(part.value ?? part.damage) || 0 })).filter(part => part.value);
    const total = Number(midi.damageTotal) || detail.reduce((sum, part) => sum + part.value, 0);
    const item = await fromUuid(card.flags?.dnd5e?.item?.uuid ?? "").catch(() => null);
    if (!current()) return;
    const state = foundry.utils.deepClone(card.getFlag(MODULE_ID, CARD_FLAG) ?? { version: 1, targets: [] });
    const hits = new Set(), crits = new Set();
    for (const [uuid, outcome] of Object.entries(final)) {
      const token = foundry.utils.fromUuidSync(uuid)?.object;
      const target = stateTarget(state, uuid);
      if (target) target.outcome = outcome;
      if (!token || !["hit", "critical"].includes(outcome)) continue;
      hits.add(token);
      if (outcome === "critical" && !midi.isCritical) crits.add(token);
    }
    if (detail.length && hits.size) await MidiQOL.applyTokenDamage(detail, total, hits, item, new Set(), { forceApply: true });
    if (crits.size) {
      const damageRolls = (card.rolls ?? []).filter(roll => roll instanceof CONFIG.Dice.DamageRoll);
      const bonus = await rollCriticalDice(damageRolls);
      if (!current()) return;
      if (bonus?.total > 0) {
        await MidiQOL.applyTokenDamage(bonus.detail, bonus.total, crits, item, new Set(), { forceApply: true });
        for (const token of crits) stateTarget(state, token.document.uuid).critBonus = bonus.total;
      }
    }
    state.status = "resolved";
    state.application = "gm";
    if (!current()) return;
    await card.setFlag(MODULE_ID, CARD_FLAG, state);
  }

  // ---- Rendering ----

  static _onRender(message, html) {
    const element = html?.querySelector ? html : html?.[0];
    if (element && message.getFlag(MODULE_ID, REVIEW_FLAG)) this._renderReview(message, element);
  }

  static _onRenderAttack(message, html) {
    const element = html?.querySelector ? html : html?.[0];
    if (!element) return;
    // Checks, saves, death saves and initiative: the check panel.
    if (isCheckCard(message)) {
      renderCheckCard(message, element);
      return;
    }
    markDamageTypes(message, element);
    // Once a GM has ruled on a reviewed attack, its roll is settled: the advantage switch locks.
    const locked = reviewSettled(message);
    // Spells: the program window, for every spell card (spell attacks carry their verdict inside it).
    if (isSpellCard(message)) {
      const view = attackView(message) ?? midiAttackView(message);
      // Retroactive advantage stays available while the GM decides; afterwards the roll is settled.
      element.classList.toggle("hardwipe-review-pending", !!view?.pending);
      renderSpellCard(message, element, view ? { pending: view.pending, tone: view.tone, locked, verdict: verdictHTML(view), targets: targetsHTML(view) } : null);
      return;
    }
    // Implants: the diagnostic panel, with the same verdict and targets for attack implants.
    if (isImplantCard(message)) {
      const view = attackView(message) ?? midiAttackView(message);
      element.classList.toggle("hardwipe-review-pending", !!view?.pending);
      renderImplantCard(message, element, view ? { pending: view.pending, tone: view.tone, locked, verdict: verdictHTML(view), targets: targetsHTML(view) } : null);
      return;
    }
    const view = attackView(message) ?? weaponView(message);
    const saves = message.type === "usage" ? saveState(message, element) : null;
    if (view) {
      const item = message.getAssociatedItem?.();
      element.querySelectorAll(".hardwipe-attack-head").forEach(node => node.remove());
      element.classList.add("hardwipe-attack-message", "hardwipe-weapon-message");
      element.classList.toggle("hardwipe-review-pending", view.pending);
      element.querySelector(".message-content")?.insertAdjacentHTML("afterbegin", weaponHeadHTML(view, item, message.getAssociatedActivity?.()));
      bindBrief(message, element, item);
      decorateRollCard(message, element, { pending: view.pending, saves, tone: view.tone, locked });
      return;
    }
    // Every other item use: potions, tools, gear, class features, feats, monster abilities.
    if (isGearCard(message)) {
      renderGearCard(message, element);
      return;
    }
    // Plain Ready Set Midi cards (an NPC's poisoned blade, say): the save block still sits under the damage.
    const results = element.querySelector(".midi-results");
    if (!saves || !results) return;
    results.querySelector(":scope > .hardwipe-save-block")?.remove();
    insertAfterDamage(results, saveBlock(message, saves, { variant: "card" }));
  }

  static _renderReview(message, element) {
    const data = message.getFlag(MODULE_ID, REVIEW_FLAG);
    const slot = element.querySelector(".hardwipe-review-actions");
    element.querySelectorAll(".hardwipe-review-outcomes, .hardwipe-review-decision").forEach(node => node.remove());
    const card = game.messages.get(data.cardId);
    syncReviewTotals(element, data, card);
    const damage = element.querySelector(".hardwipe-review-damage");
    const total = Number(card?.flags?.[MIDI]?.damageTotal);
    if (damage) damage.innerHTML = Number.isFinite(total) && total > 0
      ? `<i class="fas fa-droplet" inert></i>${escapeHTML(game.i18n.format("HARDWIPE.Attack.DamageRolled", { total }))}`
      : `<i class="fas fa-hourglass-half" inert></i>${escapeHTML(game.i18n.localize("HARDWIPE.Attack.DamagePending"))}`;
    if (data.decision) {
      element.querySelector(".hardwipe-review-card")?.classList.add("is-resolved");
      for (const [index, target] of data.targets.entries()) {
        const block = element.querySelector(`.hardwipe-review-target[data-uuid="${CSS.escape(target.uuid)}"]`);
        const outcome = data.decision[index];
        if (!OUTCOMES.has(outcome)) continue;
        block?.insertAdjacentHTML("beforeend", `<div class="hardwipe-review-decision is-${outcome}"><i class="fas ${OUTCOME_ICONS[outcome]}" inert></i>${escapeHTML(outcomeLabel(outcome))}</div>`);
      }
      return;
    }
    const state = card?.getFlag(MODULE_ID, CARD_FLAG);
    if (state?.unavailable || (data.attackKey && data.attackKey !== state?.attackKey)) {
      if (slot) slot.replaceChildren();
      return;
    }
    if (!game.user.isGM) return;
    const open = data.targets;
    const selected = Object.fromEntries(open.map(target => [target.uuid, target.suggested]));
    for (const target of open) {
      const block = element.querySelector(`.hardwipe-review-target[data-uuid="${CSS.escape(target.uuid)}"]`);
      if (!block) continue;
      const row = element.ownerDocument.createElement("div");
      row.className = "hardwipe-review-outcomes";
      for (const outcome of target.locked ? [target.suggested] : ["hit", "critical", "miss"]) {
        const button = element.ownerDocument.createElement("button");
        button.type = "button";
        button.dataset.outcome = outcome;
        button.className = `hardwipe-hud-btn ${outcome === target.suggested ? "is-primary is-suggested" : ""}`;
        const label = target.locked ? game.i18n.format("HARDWIPE.Attack.ConfirmOutcome", { outcome: outcomeLabel(outcome) }) : outcomeLabel(outcome, true);
        button.innerHTML = `<i class="fas ${OUTCOME_ICONS[outcome]}" inert></i><span>${escapeHTML(label)}</span>`;
        button.addEventListener("click", async event => {
          event.preventDefault();
          if (open.length === 1) return this._submit(message, element, { [target.uuid]: outcome });
          selected[target.uuid] = outcome;
          row.querySelectorAll("button").forEach(other => other.classList.toggle("is-primary", other === button));
        });
        row.append(button);
      }
      block.append(row);
    }
    if (open.length > 1 && slot) {
      slot.innerHTML = "";
      const confirm = element.ownerDocument.createElement("button");
      confirm.type = "button";
      confirm.className = "hardwipe-hud-btn is-primary hardwipe-review-confirm";
      confirm.innerHTML = `<i class="fas fa-gavel" inert></i><span>${escapeHTML(game.i18n.localize("HARDWIPE.Attack.Confirm"))}</span>`;
      confirm.addEventListener("click", event => { event.preventDefault(); void this._submit(message, element, selected); });
      slot.append(confirm);
    }
  }

  static async _submit(message, element, outcomes) {
    element.querySelectorAll(".hardwipe-review-card button").forEach(button => { button.disabled = true; });
    try { await this.decide(message, outcomes); }
    catch (error) {
      console.error(`${MODULE_ID} | Attack review failed`, error);
      ui.notifications.error(error.message ?? String(error));
      element.querySelectorAll(".hardwipe-review-card button").forEach(button => { button.disabled = false; });
    }
  }
}

/** Natural crits and natural 1s are locked; a melee hit 10+ over AC proposes a critical. */
function suggestOutcome({ isHit, isCritical, isFumble, melee, total, ac }) {
  if (isFumble) return { suggested: "fumble", locked: true, reason: "natural1" };
  if (isCritical && isHit) return { suggested: "critical", locked: true, reason: "natural20" };
  if (isHit && melee && Number.isFinite(ac) && total >= ac + 10) return { suggested: "critical", locked: false, reason: "melee10" };
  if (isHit) return { suggested: "hit", locked: false, reason: "" };
  return { suggested: "miss", locked: false, reason: Number.isFinite(ac) ? "" : "cover" };
}

function stateTarget(state, uuid) {
  return state.targets?.find?.(target => target.uuid === uuid);
}

function d20Natural(workflow) {
  const value = Number(workflow.d20AttackRoll ?? workflow.attackRoll?.dice?.[0]?.total);
  return Number.isFinite(value) ? value : null;
}

/** A previous roll or target list cannot authorize a new attack result. */
function attackKey(workflow) {
  return JSON.stringify([workflow?.attackRollCount ?? 0, workflow?.attackTotal, d20Natural(workflow ?? {}),
    !!workflow?.isCritical, !!workflow?.isFumble, [...(workflow?.targets ?? [])].map(token => token.document.uuid).sort()]);
}

/** Roll the damage dice again (no modifiers) for a critical decided after the damage roll. */
async function rollCriticalDice(damageRolls) {
  const results = [];
  for (const roll of damageRolls) {
    const dice = (roll.dice ?? []).filter(die => die.number > 0 && die.faces > 0);
    if (!dice.length) continue;
    const formula = dice.map(die => `${die.number}d${die.faces}`).join(" + ");
    const type = roll.options?.type ?? "none";
    const extra = await new CONFIG.Dice.DamageRoll(formula, {}, { type, properties: roll.options?.properties ?? [], [MODULE_ID]: { critical: true } }).evaluate();
    results.push({ type, value: extra.total, roll: extra });
  }
  if (!results.length) return null;
  return {
    total: results.reduce((sum, part) => sum + part.value, 0),
    detail: results.map(({ type, value }) => ({ type, value })),
    rolls: results.map(part => part.roll)
  };
}

function attackKind(activity, melee) {
  if (["msak", "rsak"].includes(activity?.actionType)) return "cyber";
  return melee ? "melee" : "ranged";
}

/** Full-width bar on top of the card: the weapon (in its SC rarity glow) and the attack's status. */
function nameBarHTML(name, rarity, status) {
  return `<div class="hardwipe-attack-namebar">
    <span class="hardwipe-attack-name ${rarity}">${escapeHTML(name)}</span>
    <span class="hardwipe-attack-status">${escapeHTML(status)}</span>
  </div>`;
}

/** Attack type tag and the activity; the weapon heads the card and the actor heads the message. */
function kindRowHTML(kind, activity, weapon) {
  const config = ATTACK_KINDS[kind];
  const detail = activity && activity !== weapon ? activity : "";
  if (!config && !detail) return "";
  const tag = config ? `<span class="hardwipe-attack-kind is-${kind}"><i class="fas ${config.icon}" inert></i>${escapeHTML(game.i18n.localize(config.label))}</span>` : "";
  return `<div class="hardwipe-attack-kind-row">${tag}${detail ? `<span class="hardwipe-attack-activity">${escapeHTML(detail)}</span>` : ""}</div>`;
}

/** Show the card's current attack total on the review when it changed after the review was posted. */
function syncReviewTotals(element, data, card) {
  const roll = card?.rolls?.find(entry => entry.options?.[MIDI]?.rollType === "attack");
  const live = Number(roll?.total);
  element.querySelector(".hardwipe-review-changed")?.remove();
  if (!Number.isFinite(live)) return;
  let changed = false;
  for (const target of data.targets) {
    const block = element.querySelector(`.hardwipe-review-target[data-uuid="${CSS.escape(target.uuid)}"]`);
    if (!block || live === target.total) continue;
    changed = true;
    const total = block.querySelector(".is-roll-total > b");
    if (total) total.textContent = live;
    const margin = block.querySelector(".is-margin > b");
    if (margin && target.ac !== null) margin.textContent = `${live - target.ac >= 0 ? "+" : ""}${live - target.ac}`;
  }
  const natural = Number(card.flags?.[MIDI]?.d20AttackRoll);
  const d20 = element.querySelector(".hardwipe-review-natural");
  if (d20 && Number.isFinite(natural)) d20.textContent = `d20 ${natural}`;
  if (changed) element.querySelector(".hardwipe-review-roll")?.insertAdjacentHTML("afterend",
    `<div class="hardwipe-review-note hardwipe-review-changed"><i class="fas fa-rotate" inert></i> ${escapeHTML(game.i18n.localize("HARDWIPE.Attack.RollChanged"))}</div>`);
}

function outcomeLabel(outcome, short = false) {
  const key = { hit: "Hit", critical: short ? "CritShort" : "Critical", miss: "Miss", fumble: "Fumble" }[outcome] ?? "Attack";
  return game.i18n.localize(`HARDWIPE.Attack.${key}`);
}

/** The player-facing view of an attack card: reviewed state, or Ready Set Midi's own result. */
function attackView(message) {
  const midi = message.flags?.[MIDI];
  const state = message.getFlag(MODULE_ID, CARD_FLAG);
  if (!Array.isArray(state?.targets)) return null;
  const fallen = fallenTargets(message);
  const targets = state.targets.map(target => ({ ...target, outcome: target.outcome ?? "pending", fallen: fallen.get(target.uuid) }));
  // Other targets of the same attack (player characters) keep Ready Set Midi's own result.
  for (const target of midi?.targets ?? []) {
    if (!target?.uuid || stateTarget(state, target.uuid)) continue;
    const document = foundry.utils.fromUuidSync(target.uuid);
    const hit = (midi.hitTargetUuids ?? []).includes(target.uuid) || (midi.hitECTargetUuids ?? []).includes(target.uuid);
    const outcome = midi.isFumble ? "fumble" : hit ? (midi.isCritical ? "critical" : "hit") : "miss";
    targets.push({ uuid: target.uuid, name: document?.name ?? target.name ?? "", img: document?.texture?.src ?? document?.actor?.img ?? "", outcome,
      fallen: fallen.get(target.uuid) });
  }
  const pending = state.status === "pending";
  const outcomes = new Set(targets.map(target => target.outcome));
  const single = outcomes.size === 1 ? [...outcomes][0] : null;
  const tone = pending ? "pending" : single ?? "mixed";
  const reasons = state.targets.map(target => target.reason);
  const reviewed = !!state.reviewMessageId && !state.auto;
  const statusKey = state.auto ? "StatusAuto"
    : !reviewed && reasons.includes("natural1") ? "StatusNatural1"
      : !reviewed && reasons.includes("natural20") ? "StatusNatural20" : null;
  const activity = message.getAssociatedActivity?.();
  const item = message.getAssociatedItem?.();
  const melee = ["mwak", "msak"].includes(activity?.actionType);
  return {
    pending, tone, verdict: verdictLabel(tone, reviewed), status: statusKey ? game.i18n.localize(`HARDWIPE.Attack.${statusKey}`) : "",
    kind: ATTACK_KINDS[state.kind] ? state.kind : attackKind(activity, melee),
    weapon: item?.name ?? message.system?.item?.name ?? "", activity: plainActivityLabel(activity?.name), rarity: rarityClasses(item),
    targets, application: state.application
  };
}

/** A reviewed attack the GM has ruled on (or that resolved itself on a natural 20 or 1). */
function reviewSettled(message) {
  const state = message.getFlag(MODULE_ID, CARD_FLAG);
  return Array.isArray(state?.targets) && state.status !== "pending";
}

function verdictLabel(tone, reviewed) {
  const key = { pending: "VerdictPending", critical: "VerdictCritical", fumble: "VerdictFumble", mixed: "VerdictMixed" }[tone]
    ?? (tone === "miss" ? (reviewed ? "VerdictConfirmedMiss" : "VerdictMiss") : reviewed ? "VerdictConfirmedHit" : "VerdictHit");
  return game.i18n.localize(`HARDWIPE.Attack.${key}`);
}

/** Weapon presentation also applies to GM attacks and attacks without a reviewed target. */
function weaponView(message) {
  if (message.type !== "usage") return null;
  const item = message.getAssociatedItem?.();
  if (item?.type !== "weapon") return null;
  const activity = message.getAssociatedActivity?.();
  if (activity?.type !== "attack" && !activity?.attack) return null;
  const midi = message.flags?.[MIDI];
  const result = midiAttackView(message);
  // Without a target there is no hit/miss verdict. Show the attack and its rolls instead.
  const tone = midi?.isFumble ? "fumble" : midi?.isCritical ? "critical" : "attack";
  return {
    pending: false, tone, verdict: tone === "attack" ? game.i18n.localize("HARDWIPE.Attack.Attack") : verdictLabel(tone, false),
    status: "", targets: [], ...result,
    kind: attackKind(activity, ["mwak", "msak"].includes(activity?.actionType)),
    weapon: item.name, activity: plainActivityLabel(activity?.name), rarity: rarityClasses(item)
  };
}

/** Ready Set Midi's own result, for attacks outside the GM review (an NPC's, for example). */
function midiAttackView(message) {
  const midi = message.flags?.[MIDI];
  if (!midi || midi.d20AttackRoll === undefined || !midi.targets?.length) return null;
  const fallen = fallenTargets(message);
  const targets = midi.targets.filter(target => target?.uuid).map(target => {
    const document = foundry.utils.fromUuidSync(target.uuid);
    const hit = (midi.hitTargetUuids ?? []).includes(target.uuid) || (midi.hitECTargetUuids ?? []).includes(target.uuid);
    const outcome = midi.isFumble ? "fumble" : hit ? (midi.isCritical ? "critical" : "hit") : "miss";
    return { uuid: target.uuid, name: target.name ?? document?.name ?? "", img: document?.texture?.src ?? document?.actor?.img ?? "", outcome,
      fallen: fallen.get(target.uuid) };
  });
  const outcomes = new Set(targets.map(target => target.outcome));
  const tone = outcomes.size === 1 ? [...outcomes][0] : "mixed";
  return { pending: false, tone, verdict: verdictLabel(tone, false), status: "", targets };
}

/** The verdict strip: one word for the attack, in the result's colour. */
function verdictHTML(view) {
  return `<div class="hardwipe-verdict is-${view.tone}"><b>${escapeHTML(view.verdict)}</b><i class="fas ${VERDICT_ICONS[view.tone] ?? "fa-list-check"}" inert></i></div>`;
}

/** Target rows: no result text; colour, rail and the portrait's lock ring carry it. Mixed results add an icon. */
function targetsHTML(view) {
  if (!view.targets?.length) return "";
  const mixed = new Set(view.targets.map(target => target.outcome)).size > 1;
  return `<div class="hardwipe-targets">${view.targets.map(target => `<div class="hardwipe-target is-${target.outcome}${target.fallen ? ` is-fallen is-${target.fallen}` : ""}">
      <span class="hardwipe-lock">${target.img ? `<img src="${escapeHTML(target.img)}" alt="">` : ""}</span>
      <span class="hardwipe-target-text"><span class="hardwipe-target-name">${escapeHTML(target.name)}</span>${coverHTML(target.cover)}</span>
      ${stampHTML(target.fallen)}
      ${mixed ? `<em><i class="fas ${OUTCOME_ICONS[target.outcome] ?? "fa-hourglass-half"}" inert></i></em>` : ""}
    </div>`).join("")}</div>`;
}

const COVER_LABELS = { half: "CoverHalf", threeQuarters: "CoverThreeQuarters", total: "CoverTotal" };

/** "½ cover · Concrete": the target's cover when the attack was rolled. */
function coverHTML(cover) {
  const key = COVER_LABELS[cover?.level];
  if (!key) return "";
  const label = game.i18n.localize(`HARDWIPE.Attack.${key}`);
  return `<small class="hardwipe-target-cover is-${cover.level}"><i class="fas fa-shield-halved" inert></i>${escapeHTML(label)}${cover.material ? ` · ${escapeHTML(cover.material)}` : ""}</small>`;
}

/**
 * The target's cover when the attack resolves: Hardwipe wall cover (named after the wall's material)
 * or a cover status on the target, whichever is greater. Stored on the card, so moving tokens later
 * never changes what an old card shows.
 */
function coverSnapshot(workflow, token) {
  let wall = { coverBonus: 0 };
  if (game.settings.get(MODULE_ID, "wallCoverEnabled") !== false) {
    try {
      wall = game.hardwipe?.cover?.inspectCover?.({ attacker: workflow.token, target: token, activity: workflow.activity }) ?? wall;
    } catch (error) {
      console.warn(`${MODULE_ID} | Cover could not be read for the attack card`, error);
    }
  }
  const material = () => {
    const impact = wall.impact;
    const document = impact?.wall?.document ?? impact?.wall;
    const flag = document?.flags?.[MODULE_ID]?.cover ?? token.document?.parent?.walls?.get?.(impact?.wallId)?.flags?.[MODULE_ID]?.cover;
    return String(flag?.name || flag?.material || "");
  };
  if (wall.coverBonus === Infinity) return { level: "total", material: material() };
  const wallBonus = Number(wall.coverBonus) || 0;
  const statusBonus = Number(token.actor?.system?.attributes?.ac?.cover) || 0;
  const bonus = Math.max(wallBonus, statusBonus);
  if (!bonus) return null;
  return { level: bonus >= 5 ? "threeQuarters" : "half", material: wallBonus >= statusBonus ? material() : "" };
}

/** Weapon banner: type and rarity, the name as the title, attack type, property chips, verdict, targets, description. */
function weaponHeadHTML(view, item, activity) {
  const typeLabel = item?.system?.type?.label || (item ? game.i18n.localize(CONFIG.Item.typeLabels?.[item.type] ?? item.type) : "");
  const rarity = item?.system?.rarity;
  const rarityLabel = rarity ? game.i18n.localize(CONFIG.DND5E.itemRarity?.[rarity] ?? rarity) : "";
  const name = escapeHTML(view.weapon);
  const rarityClass = rarityClasses(item);
  return `<div class="hardwipe-attack-head hardwipe-weapon-head is-${view.tone}">
    <div class="hardwipe-attack-namebar"><span class="hardwipe-attack-type">${escapeHTML([typeLabel, rarityLabel].filter(Boolean).join(" · "))}</span>
      <span class="hardwipe-attack-status">${escapeHTML(view.status)}</span></div>
    <div class="hardwipe-title-row">${rarityClass ? `<span class="hardwipe-gem ${rarityClass}"></span>` : ""}<div class="hardwipe-chat-title hardwipe-item-title ${rarityClass}" data-text="${name}">${name}</div></div>
    ${kindRowHTML(view.kind, view.activity, view.weapon)}
    ${propertyChipsHTML(item, activity)}
    ${verdictHTML(view)}
    ${targetsHTML(view)}
    ${briefHTML(item)}
    ${view.application === "gm" ? `<div class="hardwipe-chat-meta">${escapeHTML(game.i18n.localize("HARDWIPE.Attack.AppliedByGM"))}</div>` : ""}
  </div>`;
}


function reviewHTML(data, { weapon, activity, rarity }) {
  const t = key => escapeHTML(game.i18n.localize(`HARDWIPE.Attack.${key}`));
  const title = t("ReviewTitle");
  const blocks = data.targets.map(target => {
    const hasAC = target.ac !== null && Number.isFinite(target.ac);
    const margin = hasAC ? target.total - target.ac : null;
    const chip = (value, key, extra = "") => `<span class="hardwipe-wall-chip ${extra}"><b>${escapeHTML(value)}</b>${t(key)}</span>`;
    const marginChip = margin === null ? "" : `<span class="hardwipe-wall-op">=</span>${chip(`${margin >= 0 ? "+" : ""}${margin}`, "Margin", "is-total is-margin")}`;
    const note = target.reason === "melee10" ? `<div class="hardwipe-review-note"><i class="fas fa-bolt" inert></i> ${t("NoteMelee")}</div>`
      : target.reason === "natural20" ? `<div class="hardwipe-review-note"><i class="fas fa-dice-d20" inert></i> ${t("NoteNatural20")}</div>`
        : target.reason === "natural1" ? `<div class="hardwipe-review-note"><i class="fas fa-dice-d20" inert></i> ${t("NoteNatural1")}</div>`
          : target.reason === "cover" ? `<div class="hardwipe-review-note"><i class="fas fa-block-brick" inert></i> ${t("NoteCover")}</div>` : "";
    return `<div class="hardwipe-review-target" data-uuid="${escapeHTML(target.uuid)}">
      <div class="hardwipe-review-head">${target.img ? `<img src="${escapeHTML(target.img)}" alt="">` : ""}<span>${escapeHTML(target.name)}</span>
        <small>${hasAC ? `${t("AC")} ${escapeHTML(target.ac)}` : t("FullCover")}</small></div>
      <div class="hardwipe-wall-math">${chip(target.total, "Total", "is-roll-total")}<span class="hardwipe-wall-op">${t("Versus")}</span>${chip(hasAC ? target.ac : "∞", "AC")}${marginChip}</div>
      ${note}
    </div>`;
  }).join("");
  return `<div class="hardwipe-chat-card hardwipe-review-card">
    ${nameBarHTML(weapon, rarity, game.i18n.localize("HARDWIPE.Attack.ReviewStatus"))}
    <div class="hardwipe-chat-title" data-text="${title}">${title}</div>
    ${kindRowHTML(data.kind, activity, weapon)}
    <div class="hardwipe-review-roll">${Number.isFinite(data.natural) ? `<span><i class="fas fa-dice-d20" inert></i><span class="hardwipe-review-natural">d20 ${escapeHTML(data.natural)}</span></span>` : ""}<span class="hardwipe-review-damage"></span></div>
    ${blocks}
    <div class="hardwipe-chat-meta">${t("ReviewMeta")}</div>
    <div class="hardwipe-review-actions"></div>
  </div>`;
}
