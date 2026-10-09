const ID = "hardwipe-ruleset";
const FLAG = "rangedAdvisory";
const MANUAL_OPTIONS = "hardwipeManualAttackModes";
const MANUAL_TOP = "hardwipeManualAttackConfig";
const MODIFIER_LABELS = { ADV: "Advantage", DIS: "Disadvantage",
  NOADV: "Advantage prevented", NODIS: "Disadvantage prevented" };
const MANUAL_SOURCES = new Set(["workflowOptions", "options", "keyPress", "forcedKeyPress", "config-buttons"]);
const savedModes = value => Object.fromEntries(["advantage", "disadvantage"]
  .filter(key => Object.hasOwn(value ?? {}, key)).map(key => [key, value[key]]));
function restoreModes(target, saved) {
  for (const key of ["advantage", "disadvantage"]) {
    if (Object.hasOwn(saved, key)) target[key] = saved[key];
    else delete target[key];
  }
}

function emptyAdvisory() {
  return { version: 3, reasons: [], manual: true };
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

/** Read only sources already evaluated by Midi; never infer rules from actor data. */
export function collectRangedAdvisory(workflow, attackMode = workflow?.attackMode) {
  const data = emptyAdvisory();
  const activity = workflow?.activity;
  // A dialog can switch a melee weapon to Thrown after Midi checked it as melee.
  // That earlier attribution is not evidence for the newly selected attack mode.
  const resolvedType = activity?.getActionType?.(attackMode) ?? activity?.actionType;
  if (!isRangedAttack({ activity, attackMode }) || resolvedType !== activity?.actionType) return data;
  const attribution = workflow?.attackRollModifierTracker?.attribution;
  if (!attribution || typeof attribution !== "object") return data;
  for (const [type, label] of Object.entries(MODIFIER_LABELS)) {
    for (const [source, displayName] of Object.entries(attribution[type] ?? {})) {
      if (MANUAL_SOURCES.has(source) || typeof displayName !== "string" || !displayName.trim()) continue;
      data.reasons.push(`${label}: ${displayName.trim()}`);
    }
  }
  data.reasons = [...new Set(data.reasons)];
  return data;
}

/** Restore caller-supplied modes after native dnd5e merges actor attack-roll modifiers. */
export function restoreManualRangedModes(config, builtRoll, builtIndex = 0) {
  const explicit = config?.[MANUAL_OPTIONS];
  const attackMode = builtRoll?.options?.attackMode ?? config?.attackMode;
  if (!Array.isArray(explicit)) return;
  const workflow = config.workflow;
  if (workflow && !workflow.hardwipeRangedAutomaticState) {
    workflow.hardwipeRangedAutomaticState = {
      config: savedModes(config),
      rolls: (config.rolls ?? []).map(roll => savedModes(roll.options)),
      tracker: structuredClone(workflow.attackRollModifierTracker?.toJSON?.())
    };
  }
  if (!isRangedAttack({ activity: config.subject, attackMode })) {
    if (workflow?.hardwipeRangedManualApplied) {
      const automatic = workflow.hardwipeRangedAutomaticState;
      restoreModes(config, automatic.config);
      if (automatic.tracker) workflow.attackRollModifierTracker.restore(structuredClone(automatic.tracker));
      if (builtRoll) restoreModes(builtRoll.options, automatic.rolls[builtIndex] ?? {});
      workflow.hardwipeRangedManualApplied = false;
      workflow.hardwipeRangedAdvisory = undefined;
    }
    return;
  }
  const top = config[MANUAL_TOP] ?? {};
  for (const mode of ["advantage", "disadvantage"]) {
    if (Object.hasOwn(top, mode)) config[mode] = top[mode];
    else if (workflow?.workflowOptions?.[mode]) config[mode] = true;
    else delete config[mode];
  }
  // A thrown mode can be selected after Midi evaluated the activity as melee.
  // Rebuild only mode state; preserve critical/fumble and minimum/maximum modifiers.
  if (workflow && !workflow.hardwipeRangedManualApplied) {
    // Capture the real evaluated attribution before removing automatic mode changes.
    // Keep this snapshot separate from the tracker used for the player's chosen roll.
    workflow.hardwipeRangedAdvisory = collectRangedAdvisory(workflow, attackMode);
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
  }
  if (workflow) workflow.hardwipeRangedManualApplied = true;
  const rolls = builtRoll ? [[builtIndex, builtRoll]] : (config.rolls ?? []).entries();
  for (const [index, roll] of rolls) {
    roll.options ??= {};
    for (const mode of ["advantage", "disadvantage"]) {
      const saved = explicit[index] ?? {};
      if (Object.hasOwn(saved, mode)) roll.options[mode] = saved[mode];
      else delete roll.options[mode];
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
    // Midi must evaluate its normal rules and conditional flags. The native
    // preRollAttackV2 hook below snapshots attribution and restores manual mode.
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
            config.workflow.hardwipeRangedAutomaticState = undefined;
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
    const wasManual = config.workflow?.hardwipeRangedManualApplied;
    restoreManualRangedModes(config, roll, index);
    if (!wasManual && !isRangedAttack({ activity: config.subject, attackMode: roll.options?.attackMode ?? config.attackMode })) return;
    // Previews and fast-forward builds need a refreshed default after changing attack mode.
    // Final dialog builds already have the explicit clicked mode from _finalizeConfig.
    if (!this._finalizingDialogs.has(options.app) && Array.isArray(config[MANUAL_OPTIONS])) {
      CONFIG.Dice.D20Roll.applyKeybindings({ ...config, rolls: [roll] }, {}, {});
    }
  }

  static async _record(workflow) {
    if (!workflow.attackRoll || !workflow.chatCard) return;
    const card = workflow.chatCard;
    const finalMode = workflow.attackRoll.options?.attackMode ?? workflow.attackMode;
    const finalType = workflow.activity?.getActionType?.(finalMode) ?? workflow.activity?.actionType;
    const data = finalType === workflow.activity?.actionType
      ? workflow.hardwipeRangedAdvisory ?? emptyAdvisory() : emptyAdvisory();
    try {
      if (!workflow.hardwipeRangedManualApplied
        || !isRangedAttack({ activity: workflow.activity, attackMode: workflow.attackRoll.options?.attackMode ?? workflow.attackMode })) {
        this._attackerAdvisories.delete(card.id);
        if (card.getFlag(ID, FLAG)) await card.unsetFlag(ID, FLAG);
        return;
      }
      // Public chat flags are readable by other clients. Keep evaluated source names only
      // on the rolling client; their snapshot survives rerenders, never publishes NPC or defender state.
      this._attackerAdvisories.set(card.id, [...(data.reasons ?? [])]);
      if (this._attackerAdvisories.size > 200) this._attackerAdvisories.delete(this._attackerAdvisories.keys().next().value);
      const publicData = { version: 3, manual: true };
      if (JSON.stringify(card.getFlag(ID, FLAG)) !== JSON.stringify(publicData)) await card.setFlag(ID, FLAG, publicData);
    } catch (error) {
      console.warn(`${ID} | Midi attribution could not be attached to the attack card`, error);
    }
  }

  static _render(message, html) {
    const root = html?.querySelector ? html : html?.[0];
    root?.querySelectorAll(".hardwipe-ranged-advisory").forEach(node => node.remove());
    const data = message.getFlag(ID, FLAG);
    if (!root || data?.version !== 3 || !data.manual || message.visible === false || message.isContentVisible === false
      || message.isRollVisible === false || (message.blind && !game.user.isGM)) return;
    const content = root.querySelector(".message-content");
    if (!content) return;
    const actor = ChatMessage.getSpeakerActor(message.speaker);
    const reasons = [];
    if (game.user.isGM || actor?.isOwner) {
      reasons.push(...(this._attackerAdvisories.get(message.id) ?? []));
    }
    // Older flags were built from guesses. Discard them without rewriting chat history.
    const identified = [...new Set(reasons.filter(reason => typeof reason === "string" && reason.trim()))];
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
