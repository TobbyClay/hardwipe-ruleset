import {
  MODULE_ID,
  DownedManager,
  StrikesManager,
  isCharacter,
  postSystemCard,
  resolveActor
} from "./hardwipe-state.js";
import { AttackReviewManager } from "./hardwipe-attacks.js";

const RSR_MODULE_ID = "rsr5e";

export class HardwipeRules {
  static _lastHP = new Map();

  static initialize() {
    Hooks.on("dnd5e.preRollDeathSave", (config, dialog, message) => {
      return this._onPreRollDeathSave(config, dialog, message);
    });

    Hooks.on("preUpdateActor", (actor, changed, options) => this._recordHP(actor, changed, options));
    Hooks.on("updateActor", (actor, changed, options, userId) => this._onActorUpdate(actor, changed, options, userId));
    Hooks.on("dnd5e.restCompleted", (actor, result, config) => this._onRestCompleted(actor, result, config));
    Hooks.on("dnd5e.rollAttack", (rolls, data) => this._onRollAttack(rolls, data));
    Hooks.on("midi-qol.preCheckHits", (workflow) => this._onMidiPreCheckHits(workflow));
    Hooks.on("preCreateChatMessage", (message, data, options, userId) => this._onPreCreateChatMessage(message, data, options, userId));
    Hooks.on("createChatMessage", (message) => this._onCreateChatMessage(message));
    Hooks.on("renderChatMessageHTML", (message, html) => this._onRenderChatMessage(message, html));
  }

  static _onPreRollDeathSave(config) {
    const actor = resolveActor(config?.subject);
    if (!isCharacter(actor)) return true;

    ui.notifications.info(game.i18n.localize("HARDWIPE.DeathSaves.Blocked"));
    void postSystemCard({
      actor,
      kind: "downed",
      kicker: game.i18n.localize("HARDWIPE.Downed.Title"),
      title: game.i18n.localize("HARDWIPE.DeathSaves.ReplacedTitle"),
      subtitle: game.i18n.localize("HARDWIPE.DeathSaves.ReplacedSubtitle")
    }).catch(error => console.error(`${MODULE_ID} | Failed to post the death-save replacement card`, error));
    return false;
  }

  static _recordHP(actor, changed, options) {
    if (!isCharacter(actor)) return;
    if (!foundry.utils.hasProperty(changed, "system.attributes.hp.value")) return;
    options.hardwipePreviousHP = Number(actor.system?.attributes?.hp?.value) || 0;
  }

  static async _onActorUpdate(actor, changed, options, userId) {
    if (userId !== game.user.id || !isCharacter(actor)) return;
    if (!foundry.utils.hasProperty(changed, "system.attributes.hp.value")) return;
    if (options.hardwipeHandlingDowned) return;

    const previousHP = Number(options.hardwipePreviousHP ?? this._lastHP.get(actor.uuid) ?? 0);
    const currentHP = Number(actor.system?.attributes?.hp?.value) || 0;
    this._lastHP.set(actor.uuid, currentHP);

    if (previousHP > 0 && currentHP <= 0) {
      await StrikesManager.add(actor);
      if (StrikesManager.get(actor) < 3 && !actor.statuses?.has("dead")) await DownedManager.apply(actor);
    } else if (currentHP > 0 && !options.hardwipeRecovery) {
      // Explicit recovery awaits its own clear; the update hook must not delete the same effect twice.
      await DownedManager.clear(actor);
    }
  }

  static async _onRestCompleted(actor, result, config) {
    if (!isCharacter(actor) || config?.type !== "long" || actor.statuses?.has("dead")) return;
    await StrikesManager.reset(actor);
    await DownedManager.clear(actor);
    await actor.unsetFlag(MODULE_ID, "deathAnnounced");
  }

  static _onRollAttack(rolls, data) {
    void this._handleRollAttack(rolls, data);
  }

  static async _handleRollAttack(rolls, data) {
    const roll = rolls?.[0];
    const subject = data?.subject;
    if (!roll || !subject) return;

    if (!this._isMeleeAttack(roll, subject)) return;
    // Player attacks under GM review: the GM confirms a 10+ melee critical instead.
    if (AttackReviewManager.isReviewedAttack(subject.actor, game.user.targets)) return;

    const targets = this._getAttackTargets();
    if (targets.length !== 1) return;

    const target = targets[0];
    if (!Number.isFinite(target.ac)) return;
    if (Number(roll.total) < target.ac + 10) return;

    this._forceCriticalRoll(roll);
    roll.options ??= {};
    roll.options[MODULE_ID] ??= {};
    roll.options[MODULE_ID].meleeCritUpgrade = true;
    await this._persistAttackCrit(roll);
  }

  static async _onMidiPreCheckHits(workflow) {
    const roll = workflow?.attackRoll;
    const subject = workflow?.activity;
    if (!roll || !subject || !this._isMeleeAttack(roll, subject)) return;
    if (AttackReviewManager.isReviewedWorkflow(workflow)) return;

    const targets = Array.from(workflow.targets ?? []);
    if (targets.length !== 1) return;

    const targetArmor = targets[0]?.actor?.system?.attributes?.ac;
    const targetAC = Number(targetArmor?.value) - Number(targetArmor?.cover ?? 0);
    if (!Number.isFinite(targetAC) || Number(roll.total) < targetAC + 10) return;

    this._forceCriticalRoll(roll);
    roll.options[MODULE_ID].meleeCritUpgrade = true;

    // MIDI determines critical damage from the workflow, not only from the dnd5e
    // attack roll. Set both so the hybrid card and the subsequent damage roll agree.
    workflow.isCritical = true;
    workflow.rollOptions ??= {};
    workflow.rollOptions.isCritical = true;

    const message = workflow.chatCard;
    if (message) await this._persistMessageCrit(message);
  }

  static _onPreCreateChatMessage(message, data, options, userId) {
    if (userId !== game.user.id) return;

    const roll = message.rolls?.[0] ?? data?.rolls?.[0];
    const isHardwipeCrit = roll?.options?.[MODULE_ID]?.meleeCritUpgrade;
    if (!isHardwipeCrit) return;

    const updates = {
      [`flags.${MODULE_ID}.meleeCritUpgrade`]: true,
      [`flags.${MODULE_ID}.meleeCritLabel`]: "10-over-AC"
    };

    const rsrFlags = message.flags?.[RSR_MODULE_ID] ?? data?.flags?.[RSR_MODULE_ID];
    if (rsrFlags) updates[`flags.${RSR_MODULE_ID}.isCritical`] = true;

    message.updateSource(updates);
  }

  static async _onCreateChatMessage(message) {
    if (!message.isAuthor) return;
    if (!message.getFlag(MODULE_ID, "meleeCritUpgrade")) return;

    const updates = {};
    const rolls = message.rolls?.map(roll => this._cloneCriticalRoll(roll)) ?? [];
    if (rolls.length) updates.rolls = rolls.map(roll => roll.toJSON ? roll.toJSON() : roll);

    if (message.flags?.[RSR_MODULE_ID]) {
      const flags = foundry.utils.deepClone(message.flags);
      flags[RSR_MODULE_ID].isCritical = true;
      if (Array.isArray(flags[RSR_MODULE_ID].rolls)) {
        flags[RSR_MODULE_ID].rolls = flags[RSR_MODULE_ID].rolls.map((rollData, index) => {
          if (index !== 0) return rollData;
          const roll = hydrateRoll(rollData);
          return this._cloneCriticalRoll(roll)?.toJSON?.() ?? rollData;
        });
      }
      updates.flags = flags;
    }

    if (!foundry.utils.isEmpty(updates)) await message.update(updates);
  }

  static async _persistAttackCrit(roll) {
    const message = roll?.parent;
    if (!message?.id || message.documentName !== "ChatMessage") return;
    if (message.type !== "attack" && message.getFlag("dnd5e", "roll.type") !== "attack") return;

    await this._persistMessageCrit(message);
  }

  static async _persistMessageCrit(message) {
    const updates = {
      [`flags.${MODULE_ID}.meleeCritUpgrade`]: true,
      [`flags.${MODULE_ID}.meleeCritLabel`]: "10-over-AC"
    };

    if (message.rolls?.length) {
      updates.rolls = message.rolls.map((existing, index) => {
        const out = index === 0 ? this._cloneCriticalRoll(existing) : existing;
        return out?.toJSON ? out.toJSON() : out;
      });
    }

    if (message.flags?.[RSR_MODULE_ID]) {
      const flags = foundry.utils.deepClone(message.flags);
      flags[MODULE_ID] ??= {};
      flags[MODULE_ID].meleeCritUpgrade = true;
      flags[MODULE_ID].meleeCritLabel = "10-over-AC";
      flags[RSR_MODULE_ID].isCritical = true;
      if (Array.isArray(flags[RSR_MODULE_ID].rolls)) {
        flags[RSR_MODULE_ID].rolls = flags[RSR_MODULE_ID].rolls.map((rollData, index) => {
          if (index !== 0) return rollData;
          const existing = hydrateRoll(rollData);
          return this._cloneCriticalRoll(existing)?.toJSON?.() ?? rollData;
        });
      }
      updates.flags = flags;
    }

    await message.update(updates);
  }

  static _onRenderChatMessage(message, html) {
    const element = html;
    if (!element || !message.isContentVisible) return;

    if (message.getFlag(MODULE_ID, "meleeCritUpgrade")) {
      const header = element.querySelector(".message-content .dice-result, .message-content .chat-card, .message-content");
      if (header && !element.querySelector(".hardwipe-roll-tag")) {
        header.insertAdjacentHTML("afterbegin", `
          <div class="hardwipe-roll-tag">
            <i class="fas fa-bolt"></i>
            ${game.i18n.localize("HARDWIPE.Crit.MeleeUpgrade")}
          </div>
        `);
      }
    }

  }

  static _getAttackTargets() {
    const targets = [];
    for (const token of game.user.targets ?? []) {
      const actor = token.actor;
      const ac = actor?.system?.attributes?.ac?.value;
      targets.push({ token, actor, ac: Number(ac) - Number(actor?.system?.attributes?.ac?.cover ?? 0) });
    }
    return targets;
  }

  static _isMeleeAttack(roll, subject) {
    const mode = roll.options?.attackMode ?? subject.item?.getFlag?.("dnd5e", `last.${subject.id}.attackMode`);
    const actionType = this._getActionType(subject, mode);
    if (actionType) return ["mwak", "msak"].includes(actionType);
    if (mode) return this._isMeleeMode(mode);
    return false;
  }

  static _getActionType(subject, mode) {
    if (typeof subject?.getActionType !== "function") return null;
    try {
      return subject.getActionType(mode) ?? null;
    } catch (_err) {
      return null;
    }
  }

  static _isMeleeMode(mode) {
    const value = String(mode ?? "").toLowerCase();
    if (["onehanded", "twohanded", "offhand"].includes(value)) return true;
    if (["ranged", "thrown", "thrown-offhand"].includes(value)) return false;
    return value.includes("melee") || value === "mwak" || value === "msak";
  }

  static _forceCriticalRoll(roll) {
    roll.options ??= {};
    roll.options.criticalSuccess = 1;
    if (roll.d20) {
      roll.d20.options ??= {};
      roll.d20.options.criticalSuccess = 1;
    }
    roll.options[MODULE_ID] ??= {};
    roll.options[MODULE_ID].forceCritical = true;
  }

  static _cloneCriticalRoll(roll) {
    if (!roll) return roll;
    const clone = roll.constructor?.fromData ? roll.constructor.fromData(roll.toJSON()) : Roll.fromData(roll.toJSON());
    this._forceCriticalRoll(clone);
    return clone;
  }
}


function hydrateRoll(rollData) {
  if (!rollData) return null;
  if (rollData instanceof Roll) return rollData;
  const RollClass = CONFIG.Dice?.[rollData.class] ?? Roll;
  try {
    return RollClass.fromData(rollData);
  } catch (_err) {
    return Roll.fromData(rollData);
  }
}
