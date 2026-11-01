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
  return { version: 3, reasons: [], sources: [], manual: true };
}

/** The roll mode the detected sources call for: 1 advantage, -1 disadvantage, 0 straight (none, or both cancelling). */
export function expectedMode(sources = []) {
  const has = type => sources.some(source => source?.type === type);
  const advantage = has("ADV") && !has("NOADV");
  const disadvantage = has("DIS") && !has("NODIS");
  return advantage === disadvantage ? 0 : advantage ? 1 : -1;
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

/** Copy Midi's evaluated attribution into an advisory, leaving out the roller's own choices. */
function readAttribution(attribution, data) {
  if (!attribution || typeof attribution !== "object") return data;
  for (const [type, label] of Object.entries(MODIFIER_LABELS)) {
    for (const [source, displayName] of Object.entries(attribution[type] ?? {})) {
      if (MANUAL_SOURCES.has(source) || typeof displayName !== "string" || !displayName.trim()) continue;
      const reason = `${label}: ${displayName.trim()}`;
      if (data.reasons.includes(reason)) continue;
      data.reasons.push(reason);
      // Midi keys a rule the target grants as "grants.<family> <target>": its name is the target's own effect.
      data.sources.push(String(source).startsWith("grants.") ? { type, name: displayName.trim(), grants: true } : { type, name: displayName.trim() });
    }
  }
  return data;
}

/**
 * What anyone but the GM may read of a scan: a rule the target grants is named only as coming from the target,
 * so a player never learns an NPC's effect names from their own attack. Duplicates left by that merge are dropped.
 */
export function maskTargetSources(sources = [], label = "Granted by the target") {
  const out = [];
  for (const source of sources) {
    const masked = source?.grants ? { type: source.type, name: label, grants: true }
      : source?.unlabelled ? { type: source.type, name: source.name, unlabelled: true } : { type: source?.type, name: source?.name };
    if (!out.some(entry => entry.type === masked.type && entry.name === masked.name)) out.push(masked);
  }
  return out;
}

/** What a player sees of a scan: target rules masked, and no unlabelled row, which is a note for the GM. */
export function playerSources(sources = [], label = "Granted by the target") {
  return maskTargetSources(sources, label).filter(source => !source.unlabelled);
}

/** Read only sources already evaluated by Midi; never infer rules from actor data. */
export function collectRangedAdvisory(workflow, attackMode = workflow?.attackMode) {
  const data = emptyAdvisory();
  const activity = workflow?.activity;
  // A dialog can switch a melee weapon to Thrown after Midi checked it as melee.
  // That earlier attribution is not evidence for the newly selected attack mode.
  const resolvedType = activity?.getActionType?.(attackMode) ?? activity?.actionType;
  if (!isRangedAttack({ activity, attackMode }) || resolvedType !== activity?.actionType) return data;
  return readAttribution(workflow?.attackRollModifierTracker?.attribution, data);
}

/**
 * Any attack. A ranged attack keeps the rules above (its mode is the player's). A melee attack reads Midi's live
 * tracker, whose mode Midi applied itself, so the readout explains what happened rather than what to roll.
 */
export function collectAttackAdvisory(workflow, attackMode = workflow?.attackMode) {
  const activity = workflow?.activity;
  if (isRangedAttack({ activity, attackMode })) return collectRangedAdvisory(workflow, attackMode);
  const data = { ...emptyAdvisory(), manual: false };
  if (!activity?.attack) return data;
  return readAttribution(workflow?.attackRollModifierTracker?.attribution, data);
}

/**
 * A mode the d20 carries that neither a listed source nor the roller's own choice explains: a module, a macro
 * or the system set it below Midi's attribution. The row says so instead of leaving the mode unexplained.
 * The roller's choices are keyboard modifiers and, when a roll dialog was actually shown, its buttons: Midi
 * labels a mode set on the configuration "Roll Dialog" even when the roll was fast-forwarded past one.
 */
export function unlabelledSource(sources, rolledMode, attribution = {}, labels = {}, { dialogUsed = true } = {}) {
  const rolled = Math.sign(Number(rolledMode) || 0);
  if (!rolled || rolled === expectedMode(sources)) return null;
  const type = rolled > 0 ? "ADV" : "DIS";
  const choices = new Set(["keyPress", "forcedKeyPress", ...(dialogUsed ? ["config-buttons"] : [])]);
  const chosen = Object.keys(attribution?.[type] ?? {}).some(source => choices.has(source));
  if (chosen) return null;
  const name = String(labels.name ?? "Unlabelled modifier").trim();
  const rule = String(labels.rule ?? "Set by a macro, a module or the system").trim();
  return { type, name: `${name} - ${rule}`, unlabelled: true };
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
      // A dialog really was shown for this roll: its buttons are the roller's choice, not a hidden modifier.
      if (this.config?.workflow) this.config.workflow.hardwipeDialogUsed = true;
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

  /**
   * Snapshot this attack's sources. A ranged attack keeps the snapshot taken before its mode went manual; a melee
   * attack reads Midi's live tracker, plus a row for a mode nothing named, and has a readout only when Midi put
   * advantage or disadvantage on its d20. Chat flags are readable by every client, so names reach the card only
   * for a player-owned attacker, with target-granted rules masked; an NPC's attack keeps its names in memory on
   * the rolling client, as before. The readout is drawn only for the attacker's owner and the GM.
   */
  static async _record(workflow) {
    if (!workflow.attackRoll || !workflow.chatCard || !workflow.activity?.attack) return;
    const card = workflow.chatCard;
    const finalMode = workflow.attackRoll.options?.attackMode ?? workflow.attackMode;
    const finalType = workflow.activity?.getActionType?.(finalMode) ?? workflow.activity?.actionType;
    let data;
    if (isRangedAttack({ activity: workflow.activity, attackMode: finalMode })) {
      data = workflow.hardwipeRangedManualApplied && finalType === workflow.activity?.actionType
        ? workflow.hardwipeRangedAdvisory ?? emptyAdvisory() : emptyAdvisory();
    } else {
      data = collectAttackAdvisory(workflow, finalMode);
      // Midi chose this mode itself: a straight d20 needs no explanation.
      if (!Math.sign(Number(workflow.attackRoll.options?.advantageMode) || 0)) data.sources = [];
      const extra = unlabelledSource(data.sources, workflow.attackRoll.options?.advantageMode, workflow.attackRollModifierTracker?.attribution,
        { name: game.i18n.localize("HARDWIPE.Advisory.Unlabelled"), rule: game.i18n.localize("HARDWIPE.Advisory.UnlabelledRule") },
        { dialogUsed: !!workflow.hardwipeDialogUsed });
      if (extra) data.sources.push(extra);
    }
    try {
      const sources = (data.sources ?? []).map(({ type, name, grants, unlabelled }) => grants ? { type, name, grants: true }
        : unlabelled ? { type, name, unlabelled: true } : { type, name });
      this._attackerAdvisories.set(card.id, [...sources]);
      if (this._attackerAdvisories.size > 200) this._attackerAdvisories.delete(this._attackerAdvisories.keys().next().value);
      const current = card.getFlag(ID, FLAG);
      if (!sources.length) {
        if (current) await card.unsetFlag(ID, FLAG);
        return;
      }
      const publicData = { version: 4, mode: data.manual ? "manual" : "auto" };
      if (workflow.actor?.hasPlayerOwner) publicData.sources = maskTargetSources(sources, game.i18n.localize("HARDWIPE.Advisory.FromTarget"));
      if (JSON.stringify(current) !== JSON.stringify(publicData)) await card.setFlag(ID, FLAG, publicData);
    } catch (error) {
      console.warn(`${ID} | Midi attribution could not be attached to the attack card`, error);
    }
  }

  static _render(message, html) {
    const root = html?.querySelector ? html : html?.[0];
    root?.querySelectorAll(".hardwipe-ranged-advisory").forEach(node => node.remove());
    // Ready Set Midi's info icon lists every source by name in its tooltip, to every viewer: an NPC's features, a
    // target's effects. The roll mode scan replaces it, masked, for the owner; only the GM keeps Midi's own list.
    if (!game.user.isGM) root?.querySelectorAll(".midi-attribution-info").forEach(node => node.remove());
    const data = message.getFlag(ID, FLAG);
    if (!root || !data || !(data.version === 4 || (data.version === 3 && data.manual)) || message.visible === false || message.isContentVisible === false
      || message.isRollVisible === false || (message.blind && !game.user.isGM)) return;
    const content = root.querySelector(".message-content");
    if (!content) return;
    const actor = ChatMessage.getSpeakerActor(message.speaker);
    const allowed = game.user.isGM || actor?.isOwner;
    // A player-owned attacker's card carries its (masked) names; otherwise they live in memory on the rolling
    // client. Older flags were built from guesses. Discard them without rewriting chat history.
    const stored = data.version === 4 && Array.isArray(data.sources);
    const remembered = this._attackerAdvisories.get(message.id);
    let sources = allowed ? (game.user.isGM && remembered ? remembered : stored ? data.sources : remembered) ?? [] : [];
    if (!game.user.isGM) sources = playerSources(sources, game.i18n.localize("HARDWIPE.Advisory.FromTarget"));
    sources = sources.filter(source => MODIFIER_LABELS[source?.type] && typeof source.name === "string" && source.name.trim());
    if (!sources.length) return;
    const box = this._readout(root.ownerDocument, message, sources, data.version === 4 ? data.mode : "manual");
    // The readout belongs to the attack roll: it sits right under it, above the damage.
    const section = content.querySelector(".midi-qol-attack-roll");
    (section ?? content).append(box);
  }

  /**
   * One row per detected source (what it does, then its name and the rule it comes from), and the mode those
   * sources call for, beside the title: advantage and disadvantage together cancel to a straight roll.
   */
  static _readout(doc, message, sources, mode = "manual") {
    const t = (key, data) => data ? game.i18n.format(`HARDWIPE.Advisory.${key}`, data) : game.i18n.localize(`HARDWIPE.Advisory.${key}`);
    const el = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const icon = name => {
      const node = el("i", `fas ${name}`);
      node.inert = true;
      return node;
    };
    const MODE = { 1: "adv", 0: "norm", [-1]: "dis" };
    const expected = MODE[expectedMode(sources)];
    const box = el("aside", `hardwipe-ranged-advisory hwra is-${expected}`);
    box.setAttribute("aria-label", t("Label"));

    const head = el("header", "hwra-head");
    const call = el("span", `hwra-call is-${expected}`);
    call.append(el("span", "hwra-k", t(mode === "auto" ? "Applied" : "Rules")), el("span", `hwra-mode is-${expected}`, t(`Short.${expected}`)));
    const cancel = expected === "norm" && sources.some(s => s.type === "ADV") && sources.some(s => s.type === "DIS");
    call.dataset.tooltip = cancel ? t("Cancel") : t(`Should.${expected}`);
    head.append(el("span", "hwra-title", t("Title")), call);

    const list = el("ul", "hwra-list");
    const ROW = {
      ADV: ["adv", "fa-chevrons-up", "Adv"],
      DIS: ["dis", "fa-chevrons-down", "Dis"],
      NOADV: ["block", "fa-ban", "NoAdv"],
      NODIS: ["block", "fa-ban", "NoDis"]
    };
    for (const { type, name } of sources) {
      const [kind, glyph, label] = ROW[type];
      // Ready Set Midi names a source "<effects> - <rule>"; the effect leads, the rule sits under it.
      const split = name.lastIndexOf(" - ");
      const source = split > 0 ? name.slice(0, split) : name;
      const rule = split > 0 ? name.slice(split + 3) : "";
      const row = el("li", `hwra-src is-${kind}`);
      // A blocked advantage (or disadvantage) still shows, struck through.
      if (sources.some(s => s.type === `NO${type}`)) row.classList.add("is-void");
      const chip = el("span", "hwra-chip");
      chip.append(icon(glyph), el("span", "", t(`Mode.${label}`)));
      const text = el("span", "hwra-name");
      text.append(el("b", "", source));
      if (rule) text.append(el("small", "", rule));
      row.append(chip, text);
      list.append(row);
    }
    box.append(head, list);
    return box;
  }
}
