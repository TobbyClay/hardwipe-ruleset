const ID = "hardwipe-ruleset";
const FLAG = "rangedAdvisory";
const MANUAL_OPTIONS = "hardwipeManualAttackModes";
const MANUAL_TOP = "hardwipeManualAttackConfig";
const ATTACKER_CONDITIONS = {
  blind: "Disadvantage: Blinded.", blinded: "Disadvantage: Blinded.",
  frightened: "Possible disadvantage: Frightened, if the source of fear is visible.",
  invisible: "Possible advantage: Invisible, depending on the target's senses.",
  hidden: "Possible advantage: Hidden, if the target cannot see the attacker.",
  poisoned: "Disadvantage: Poisoned.", prone: "Disadvantage: Prone.",
  restrained: "Disadvantage: Restrained.",
  heavilyEncumbered: "Possible disadvantage: Heavily encumbered, on a physical attack."
};
const LEGACY_GENERIC_REASONS = new Set([
  "Confirm target conditions, visibility, and nearby allies with the GM.",
  "Confirm range, conditions, and visibility with the GM.",
  "The attacker's conditions may affect advantage or disadvantage.",
  "An attacker advantage or disadvantage flag is present; check its conditions.",
  "Check the Heavy weapon requirement for the attacker.",
  "An attacker system roll modifier is configured; choose whether it applies."
]);

function emptyAdvisory() {
  return { version: 2, reasons: [], attackerReasons: [], manual: true };
}

/** Identify ranged activities without treating an ordinary melee-capable weapon as ranged. */
export function isRangedAttack(workflow) {
  const activity = workflow?.activity;
  const mode = workflow?.attackMode;
  if (mode && typeof activity?.getActionType === "function") {
    const actionType = activity.getActionType(mode);
    if (["rwak", "rsak"].includes(actionType)) return true;
    if (["mwak", "msak"].includes(actionType)) return false;
  }
  return !!activity?.attack && (["rwak", "rsak"].includes(activity.actionType)
    || activity.attack.type?.value === "ranged"
    || ["ranged", "thrown", "thrown-offhand"].includes(workflow.attackMode));
}

function hasFlagValue(value) {
  if (value && typeof value === "object") return Object.values(value).some(hasFlagValue);
  return value !== undefined && value !== null && value !== false && value !== 0
    && value !== "" && value !== "false" && value !== "0";
}

function attackFlagReasons(actor, actionType, activity) {
  const flags = actor?.flags?.["midi-qol"] ?? {};
  const ability = activity?.ability;
  const school = activity?.item?.system?.school;
  const reasons = [];
  const labels = { advantage: "Possible advantage", disadvantage: "Possible disadvantage",
    noAdvantage: "Advantage suppression", noDisadvantage: "Disadvantage suppression" };
  const actionLabels = { rwak: "ranged weapon attacks", rsak: "ranged spell attacks" };
  for (const [key, label] of Object.entries(labels)) {
    const data = flags[key];
    const scopes = [[data?.all, "all rolls"], [data?.attack?.all, "all attacks"],
      [data?.attack?.[actionType], actionLabels[actionType] ?? actionType],
      [ability && data?.attack?.[ability], `${ability} attacks`],
      [school && data?.attack?.school?.[school], `${school} spell attacks`]];
    for (const [value, scope] of scopes) {
      if (hasFlagValue(value)) reasons.push(`${label}: configured attacker flag (${scope}).`);
    }
  }
  return reasons;
}

function sceneUnitsPerUnit(unit, sceneUnit) {
  const feet = { ft: 1, feet: 1, foot: 1, m: 3.280839895, meter: 3.280839895, meters: 3.280839895,
    metre: 3.280839895, metres: 3.280839895, yd: 3, yards: 3, mi: 5280, miles: 5280, km: 3280.839895 };
  const from = feet[String(unit ?? "").toLowerCase()];
  const to = feet[String(sceneUnit ?? "").toLowerCase()];
  return from && to ? from / to : null;
}

function beyondNormalRange(workflow) {
  if (workflow.longRangeAttack || workflow.hardwipeDirectWall?.longRange) return true;
  if (!workflow.token || !globalThis.MidiQOL?.getDistance) return false;
  const activity = workflow.activity;
  // Prepared dnd5e 6 activity ranges can promote normal range to long range.
  const range = activity.range?.override ? activity.toObject().range : activity.item?.system?.range;
  if (!(Number(range?.value) > 0)) return false;
  const scale = sceneUnitsPerUnit(range.units, canvas.scene?.grid.units);
  if (!scale) return false;
  return [...(workflow.targets ?? [])].some(target => {
    const distance = MidiQOL.getDistance(workflow.token, target, { wallsBlock: false });
    return Number.isFinite(distance) && distance > Number(range.value) * scale + 1e-7;
  });
}

function nearbyVisibleFoe(workflow) {
  const attacker = workflow.token;
  const disposition = attacker?.document?.disposition;
  if (!attacker || !disposition || !canvas.ready || !globalThis.MidiQOL?.getDistance) return false;
  const reach = sceneUnitsPerUnit("ft", canvas.scene?.grid.units);
  if (!reach) return false;
  return (canvas.tokens?.placeables ?? []).some(token => {
    if (token === attacker || token.document?.hidden || token.visible !== true || !token.actor
      || token.document.disposition !== -disposition) return false;
    // A GM's canvas visibility alone is insufficient: exclude creatures the attacker cannot see.
    if (typeof MidiQOL.canSee !== "function" || MidiQOL.canSee(attacker, token) !== true) return false;
    const distance = MidiQOL.getDistance(attacker, token, { wallsBlock: true });
    return Number.isFinite(distance) && distance >= 0 && distance <= 5 * reach + 1e-7;
  });
}

/** Public geometry and owner-only attacker sources; never collect private defender state. */
export function collectRangedAdvisory(workflow) {
  const data = emptyAdvisory();
  if (beyondNormalRange(workflow)) data.reasons.push("Disadvantage: beyond normal range.");
  if (nearbyVisibleFoe(workflow)) data.reasons.push("Possible disadvantage: a visible hostile creature is within 5 feet.");
  for (const status of workflow.actor?.statuses ?? []) {
    if (ATTACKER_CONDITIONS[status]) data.attackerReasons.push(ATTACKER_CONDITIONS[status]);
  }
  const actionType = workflow.activity?.getActionType?.(workflow.attackMode) ?? workflow.activity?.actionType;
  data.attackerReasons.push(...attackFlagReasons(workflow.actor, actionType, workflow.activity));
  data.attackerReasons = [...new Set(data.attackerReasons)];
  return data;
}

/** Restore caller-supplied modes after native dnd5e merges actor attack-roll modifiers. */
export function restoreManualRangedModes(config, builtRoll, builtIndex = 0) {
  const explicit = config?.[MANUAL_OPTIONS];
  const attackMode = builtRoll?.options?.attackMode ?? config?.attackMode;
  if (!Array.isArray(explicit) || !isRangedAttack({ activity: config.subject, attackMode })) return;
  const workflow = config.workflow;
  const top = config[MANUAL_TOP] ?? {};
  for (const mode of ["advantage", "disadvantage"]) {
    if (Object.hasOwn(top, mode)) config[mode] = top[mode];
    else if (workflow?.workflowOptions?.[mode]) config[mode] = true;
    else delete config[mode];
  }
  // A thrown mode can be selected after Midi evaluated the activity as melee.
  // Rebuild only mode state; preserve critical/fumble and minimum/maximum modifiers.
  if (workflow && !workflow.hardwipeRangedManualApplied) {
    const tracker = workflow.attackRollModifierTracker;
    if (tracker?.toJSON && tracker?.restore) {
      const state = tracker.toJSON();
      state.advantage = { active: !!config.advantage, suppressed: false, override: false };
      state.disadvantage = { active: !!config.disadvantage, suppressed: false, override: false };
      const modeTypes = new Set(["ADV", "DIS", "NOADV", "NODIS"]);
      state.attribution = Object.fromEntries(Object.entries(state.attribution ?? {}).filter(([key]) => !modeTypes.has(key)));
      for (const key of ["legacyAttribution", "advReminderAttribution"]) {
        state[key] = (state[key] ?? []).filter(entry => !modeTypes.has(entry.split(":")[0]));
      }
      tracker.restore(state);
      tracker.processKeys(config);
    }
    try {
      workflow.hardwipeRangedAdvisory = collectRangedAdvisory({
        actor: workflow.actor, item: workflow.item, activity: config.subject, token: workflow.token,
        targets: workflow.targets, attackMode, longRangeAttack: workflow.longRangeAttack,
        hardwipeDirectWall: workflow.hardwipeDirectWall
      });
    } catch (error) {
      workflow.hardwipeRangedAdvisory = emptyAdvisory();
      console.warn(`${ID} | Ranged reminders could not be collected`, error);
    }
  }
  if (workflow) workflow.hardwipeRangedManualApplied = true;
  const nativeModifiers = new Set();
  const rolls = builtRoll ? [[builtIndex, builtRoll]] : (config.rolls ?? []).entries();
  for (const [index, roll] of rolls) {
    roll.options ??= {};
    for (const mode of ["advantage", "disadvantage"]) {
      const saved = explicit[index] ?? {};
      if (!Object.hasOwn(saved, mode) && roll.options[mode]) nativeModifiers.add(mode);
      if (Object.hasOwn(saved, mode)) roll.options[mode] = saved[mode];
      else delete roll.options[mode];
    }
  }
  const advisory = workflow?.hardwipeRangedAdvisory;
  if (advisory) {
    advisory.attackerReasons ??= [];
    for (const mode of nativeModifiers) {
      const reminder = `${mode === "advantage" ? "Advantage" : "Disadvantage"}: configured system attack modifier.`;
      if (!advisory.attackerReasons.includes(reminder)) advisory.attackerReasons.push(reminder);
    }
  }
}

export class RangedAttackManager {
  static _initialized = false;
  static _hooksRegistered = false;
  static _wrappedClasses = new Set();
  static _activeConfigs = new Set();
  static _finalizingDialogs = new WeakSet();
  static _attackerAdvisories = new Map();

  static registerHooks() {
    if (this._hooksRegistered) return;
    this._hooksRegistered = true;
    // V2 follows native actor-modifier merging and precedes keyboard/dialog choices.
    Hooks.on("dnd5e.preRollAttackV2", config => restoreManualRangedModes(config));
    Hooks.on("dnd5e.postBuildAttackRollConfig", (config, roll, index, options) => this._onPostBuild(config, roll, index, options));
    Hooks.on("renderChatMessageHTML", (message, html) => this._render(message, html));
    Hooks.once("setup", () => Hooks.on("dnd5e.renderChatMessage", (message, html) => this._render(message, html)));
  }

  static initialize() {
    if (this._initialized) return;
    this._initialized = true;
    this._registerWrappers();
    Hooks.on("midi-qol.preCheckAttackAdvantage", workflow => {
      if (!isRangedAttack({ activity: workflow.activity, attackMode: workflow.hardwipeRangedPendingMode })) return;
      workflow.hardwipeRangedManualApplied = true;
      // Failure to collect a reminder must never restore automatic roll-mode changes.
      try { workflow.hardwipeRangedAdvisory = collectRangedAdvisory(workflow); }
      catch (error) {
        workflow.hardwipeRangedAdvisory = emptyAdvisory();
        console.warn(`${ID} | Ranged reminders could not be collected`, error);
      }
      return false;
    });
    // Runs after the evaluated roll exists, before hit checks and any GM approval wait.
    Hooks.on("midi-qol.preCheckHits", workflow => this._record(workflow));
  }

  static _registerWrappers() {
    const manager = this;
    // Native _finalizeRolls calls _finalizeConfig BEFORE rebuilding and emitting postBuild.
    // Track that synchronous rebuild so its clicked-button advantageMode remains authoritative.
    libWrapper.register(ID, "dnd5e.applications.dice.RollConfigurationDialog.prototype._finalizeRolls", function(wrapped, action) {
      manager._finalizingDialogs.add(this);
      try { return wrapped(action); }
      finally { manager._finalizingDialogs.delete(this); }
    }, "WRAPPER");
    for (const key of ["attack", "midiAttack"]) {
      const documentClass = CONFIG.DND5E.activityTypes[key]?.documentClass;
      if (!documentClass || this._wrappedClasses.has(documentClass)) continue;
      this._wrappedClasses.add(documentClass);
      libWrapper.register(ID, `CONFIG.DND5E.activityTypes.${key}.documentClass.prototype.rollAttack`, async function(wrapped, config = {}, dialog = {}, message = {}) {
        const outer = !manager._activeConfigs.has(config);
        if (outer) {
          manager._activeConfigs.add(config);
          if (config.workflow) {
            config.workflow.hardwipeRangedManualApplied = false;
            config.workflow.hardwipeRangedAdvisory = undefined;
            config.workflow.hardwipeRangedPendingMode = config.attackMode ?? this.attackMode;
          }
          // Capture property presence as well as value: explicit false must beat native true.
          // Native rollAttack shifts its input rolls, so save an independent array first.
          config[MANUAL_OPTIONS] = (config.rolls ?? []).map(roll => {
            const modes = {};
            for (const mode of ["advantage", "disadvantage"]) {
              if (Object.hasOwn(roll.options ?? {}, mode)) modes[mode] = roll.options[mode];
            }
            return modes;
          });
          config[MANUAL_TOP] = {};
          for (const mode of ["advantage", "disadvantage"]) {
            if (Object.hasOwn(config, mode)) config[MANUAL_TOP][mode] = config[mode];
          }
        }
        try { return await wrapped(config, dialog, message); }
        finally { if (outer) manager._activeConfigs.delete(config); }
      }, "WRAPPER");
    }
  }

  static _onPostBuild(config, roll, index, options = {}) {
    restoreManualRangedModes(config, roll, index);
    if (!isRangedAttack({ activity: config.subject, attackMode: roll.options?.attackMode ?? config.attackMode })) return;
    // Previews and fast-forward builds need a refreshed default after changing attack mode.
    // Final dialog builds already have the explicit clicked mode from _finalizeConfig.
    if (!this._finalizingDialogs.has(options.app) && Array.isArray(config[MANUAL_OPTIONS])) {
      CONFIG.Dice.D20Roll.applyKeybindings({ ...config, rolls: [roll] }, {}, {});
    }
  }

  static async _record(workflow) {
    if (!workflow.attackRoll || !workflow.chatCard) return;
    const card = workflow.chatCard;
    const data = workflow.hardwipeRangedAdvisory ?? emptyAdvisory();
    try {
      if (!workflow.hardwipeRangedManualApplied
        || !isRangedAttack({ activity: workflow.activity, attackMode: workflow.attackRoll.options?.attackMode ?? workflow.attackMode })) {
        this._attackerAdvisories.delete(card.id);
        if (card.getFlag(ID, FLAG)) await card.unsetFlag(ID, FLAG);
        return;
      }
      // Public chat flags are readable by other clients. Keep named attacker sources only
      // on the rolling client; their snapshot survives rerenders, never leaks NPC state.
      this._attackerAdvisories.set(card.id, [...(data.attackerReasons ?? [])]);
      if (this._attackerAdvisories.size > 200) this._attackerAdvisories.delete(this._attackerAdvisories.keys().next().value);
      const publicData = { version: 2, reasons: data.reasons ?? [], manual: true };
      if (JSON.stringify(card.getFlag(ID, FLAG)) !== JSON.stringify(publicData)) await card.setFlag(ID, FLAG, publicData);
    } catch (error) {
      console.warn(`${ID} | Ranged reminders could not be attached to the attack card`, error);
    }
  }

  static _render(message, html) {
    const root = html?.querySelector ? html : html?.[0];
    root?.querySelectorAll(".hardwipe-ranged-advisory").forEach(node => node.remove());
    const data = message.getFlag(ID, FLAG);
    if (!root || !data?.manual || message.visible === false || message.isContentVisible === false
      || message.isRollVisible === false || (message.blind && !game.user.isGM)) return;
    const content = root.querySelector(".message-content");
    if (!content) return;
    const actor = ChatMessage.getSpeakerActor(message.speaker);
    const reasons = Array.isArray(data.reasons) ? [...data.reasons] : [];
    if (game.user.isGM || actor?.isOwner) {
      reasons.push(...(this._attackerAdvisories.get(message.id) ?? []));
    }
    // Old cards must also lose the unconditional banner without rewriting chat history.
    const identified = [...new Set(reasons.filter(reason => typeof reason === "string"
      && reason.trim() && !LEGACY_GENERIC_REASONS.has(reason)))];
    if (!identified.length) return;
    const box = root.ownerDocument.createElement("aside");
    box.className = "hardwipe-ranged-advisory";
    box.setAttribute("aria-label", "Detected attack modifiers");
    box.style.cssText = "margin-top:8px;padding:8px 10px;border:1px solid currentColor;border-radius:4px;font-size:0.85em;line-height:1.4";
    const title = root.ownerDocument.createElement("strong");
    title.textContent = "Advantage / disadvantage";
    box.append(title);
    if (identified.length) {
      const list = root.ownerDocument.createElement("ul");
      list.style.cssText = "margin:4px 0 0;padding-left:18px";
      for (const reason of identified) {
        const item = root.ownerDocument.createElement("li");
        item.textContent = reason;
        list.append(item);
      }
      box.append(list);
    }
    content.append(box);
  }
}
