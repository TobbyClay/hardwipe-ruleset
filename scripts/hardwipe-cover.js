import { classifyCoverOutcome, findFirstWallIntersection, getFiveFootPixels, planWallBreach } from "./hardwipe-cover-geometry.js";
import { WallAppearance, wallWearDataEqual } from "./hardwipe-wall-appearance.js";
import { coverRollSignatureData } from "./hardwipe-cover-rolls.js";
import { WallTypes, evaluateWallDamage } from "./hardwipe-wall-types.js";
import { WallTargeting } from "./hardwipe-wall-targeting.js";

const MODULE_ID = "hardwipe-ruleset";
const STATE_FLAG = "coverAttack";
const HISTORY_FLAG = "coverHistory";
const LEDGER_FLAG = "coverDamageLedger";
const copy = value => foundry.utils.deepClone(value);
const documentOf = token => token?.document ?? token;
const sceneOf = token => documentOf(token)?.parent;
const finite = value => Number.isFinite(Number(value));
const escape = value => foundry.utils.escapeHTML(String(value ?? ""));
const replace = value => foundry.data.operators.ForcedReplacement.create(value);

function shapeOf(token) {
  const document = documentOf(token);
  const scene = sceneOf(token);
  if (!document || !scene) return null;
  const size = Number(scene.grid?.size ?? scene.dimensions?.size ?? 100);
  const width = Number(token?.w ?? Number(document.width ?? 1) * size);
  const height = Number(token?.h ?? Number(document.height ?? 1) * size);
  const x = Number(document.x);
  const y = Number(document.y);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const center = token?.center ?? { x: x + width / 2, y: y + height / 2 };
  return { x, y, width, height, center: { x: center.x, y: center.y } };
}

function actionType(activity) {
  return activity?.actionType ?? activity?.item?.system?.actionType ?? "";
}

function isRanged(activity) {
  return ["rwak", "rsak"].includes(actionType(activity));
}

function isWeapon(activity) {
  return activity?.item?.type === "weapon" && actionType(activity) === "rwak";
}

function naturalResultOf(roll) {
  return roll?.dice?.find(die => die.faces === 20)?.results?.find(result => result.active !== false && !result.discarded)?.result;
}

function sameLevel(attacker, target) {
  const a = documentOf(attacker);
  const b = documentOf(target);
  if (!a || !b || sceneOf(attacker)?.id !== sceneOf(target)?.id) return false;
  if (a.level && b.level && a.level !== b.level) return false;
  return true;
}

function isBlocking(wall, attacker, target) {
  if (!Array.isArray(wall.c) || (wall.c[0] === wall.c[2] && wall.c[1] === wall.c[3])) return false;
  if (wall.isOpen || (Number(wall.door) > 0 && Number(wall.ds) === (CONST.WALL_DOOR_STATES?.OPEN ?? 1))) return false;
  const level = documentOf(attacker)?.level ?? documentOf(target)?.level;
  const levels = wall.levels instanceof Set ? [...wall.levels] : wall.levels;
  if (level && Array.isArray(levels) && levels.length && !levels.includes(level)) return false;
  const cover = wall.flags?.[MODULE_ID]?.cover;
  if (cover?.ballistic === false) return false;
  if (cover?.ballistic === true || cover?.material === "glass") return true;
  // An untagged solid wall remains an indestructible physical obstacle.
  return Number(wall.move) > 0 || Number(wall.sight) > 0;
}

function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(entry => stableJSON(entry) ?? "null").join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Scene walls are physical cover. Sight-through glass remains ballistic cover. */
export class CoverManager {
  static _initialized = false;
  static _controlsRegistered = false;
  static _queue = Promise.resolve();
  static _records = new WeakMap();
  static _socket = null;
  static _reviews = new Map();
  static _reviewHooksRegistered = false;
  static _wallConfigRegistered = false;

  static get api() {
    return {
      computeCover: context => this.computeCover(context),
      inspectCover: context => this.inspectCover(context),
      configureSelected: () => this.configureSelected(),
      undo: scene => this.undo(scene),
      confirmPending: messageId => this.confirmPending(messageId),
      dismissPending: messageId => this.dismissPending(messageId),
      get materials() { return WallTypes.materials; },
      manageWallTypes: () => WallTypes.manage(),
      targetWall: () => WallTargeting.startSelection(),
      clearWallTarget: () => WallTargeting.clear()
    };
  }

  static registerSettings() {
    WallTypes.registerSettings();
    if (game.settings.settings.has(`${MODULE_ID}.wallCoverEnabled`)) return;
    game.settings.register(MODULE_ID, "wallCoverEnabled", {
      name: "Automatic wall cover", hint: "Use scene walls for ranged cover and weapon impacts.",
      scope: "world", config: true, type: Boolean, default: true
    });
  }

  static registerControls() {
    WallTargeting.registerControls();
    this._registerReviewHooks();
    this._registerWallConfig();
    if (this._controlsRegistered) return;
    this._controlsRegistered = true;
    Hooks.on("getSceneControlButtons", controls => {
      const group = controls.walls ?? Object.values(controls).find(control => control.name === "walls");
      if (!group) return;
      group.tools ??= {};
      const order = Object.values(group.tools).reduce((value, tool) => Math.max(value, Number(tool.order) || 0), 0) + 1;
      // Wall-specific icons, so cover tools are not confused with Shield Block's shield.
      group.tools["hardwipe-cover-configure"] = {
        name: "hardwipe-cover-configure", title: "HARDWIPE.Cover.Configure", icon: "fa-solid fa-block-brick",
        order, visible: game.user.isGM, button: true, onChange: () => void this.configureSelected().catch(error => this._report(error))
      };
      group.tools["hardwipe-cover-undo"] = {
        name: "hardwipe-cover-undo", title: "HARDWIPE.Cover.Undo", icon: "fa-solid fa-trowel-bricks",
        order: order + 1, visible: game.user.isGM, button: true, onChange: () => void this.undo().catch(error => this._report(error))
      };
    });
  }

  static _registerWallConfig() {
    if (this._wallConfigRegistered) return;
    this._wallConfigRegistered = true;
    // Registration during init is queued by core; explicit world/document sheet choices still win.
    foundry.applications.apps.DocumentSheetConfig.registerSheet(CONFIG.Wall.documentClass, MODULE_ID,
      buildWallConfig(), { label: "HARDWIPE.Cover.WallConfig.Sheet", makeDefault: true });
  }

  static initialize() {
    if (this._initialized) return;
    this._initialized = true;
    WallTypes.initialize();
    WallTargeting.initialize({ cover: this });
    WallAppearance.initialize({ enqueue: task => this._enqueue(task), report: error => this._report(error) });
    this.registerControls();
    this._registerSocket();
    Hooks.on("socketlib.ready", () => this._registerSocket());
    Hooks.on("midi-qol.computeCoverBonus", context => {
      if (this._enabled() && isRanged(context.activity)) context.coverBonus = this.computeCover(context);
    });
    Hooks.on("midi-qol.computeTargetAC", context => {
      if (!this._enabled()) return;
      const { result, activity } = context;
      if (["mwak", "msak"].includes(actionType(activity))) {
        result.effectiveCoverBonus = 0;
        result.statusCoverBonus = 0;
        result.moduleCoverBonus = 0;
        result.appliedCoverDelta = 0;
        result.coverIgnored = true;
        result.effectiveAC = result.baseAC + result.targetACMod - result.flankingMod;
      } else if (isRanged(activity) && this.computeCover(context) === Infinity) {
        result.effectiveCoverBonus = Infinity;
        result.moduleCoverBonus = Infinity;
        result.appliedCoverDelta = Infinity;
        result.effectiveAC = Infinity;
      }
    });
    Hooks.on("midi-qol.wallCoverRange", context => {
      if (!this._enabled() || !isRanged(context.activity)) return;
      if ([...(context.targets ?? [])].some(target => this.inspectCover({ attacker: context.attacker, target, activity: context.activity }).blocked > 0)) context.ignoreWalls = true;
    });
    Hooks.on("midi-qol.targetHitResolved", context => this._onTargetResolved(context));
    Hooks.on("midi-qol.hitsChecked", workflow => this._persistAttack(workflow));
    Hooks.on("midi-qol.coverAutoRollDamage", context => {
      if (this._enabled() && context.workflow?.hardwipeCoverImpacts?.length && context.currentMode !== "none") context.autoRollDamage = "always";
    });
    Hooks.on("midi-qol.DamageRollComplete", workflow => this._onDamage(workflow));
  }

  static _registerReviewHooks() {
    if (this._reviewHooksRegistered) return;
    this._reviewHooksRegistered = true;
    // Register during init, before persisted chat history renders on reload.
    Hooks.on("renderChatMessageHTML", (message, element) => this._renderReview(message, element));
    // D&D5e can replace message contents after the core hook, removing button listeners.
    Hooks.on("dnd5e.renderChatMessage", (message, element) => this._renderReview(message, element));
    Hooks.on("updateChatMessage", source => {
      for (const [element, review] of this._reviews) {
        if (!element.isConnected) this._reviews.delete(element);
        else if (review.id === source.id || review.getFlag(MODULE_ID, "coverReview")?.sourceMessageId === source.id) this._renderReview(review, element);
      }
    });
    Hooks.on("deleteChatMessage", source => {
      for (const [element, review] of this._reviews) {
        if (review.id === source.id) this._reviews.delete(element);
        else if (review.getFlag(MODULE_ID, "coverReview")?.sourceMessageId === source.id) this._renderReview(review, element);
      }
    });
  }

  static _enabled() {
    return game.settings.get(MODULE_ID, "wallCoverEnabled") !== false;
  }

  static _registerSocket() {
    if (this._socket || !globalThis.socketlib) return;
    this._socket = socketlib.registerModule(MODULE_ID);
    this._socket?.register("applyWallImpact", function(messageId) {
      return CoverManager._receiveImpact(messageId, this.socketdata?.userId);
    });
    this._socket?.register("dismissWallImpact", function(messageId) {
      return CoverManager._receiveImpact(messageId, this.socketdata?.userId, { dismiss: true });
    });
  }

  static computeCover(context) {
    return this.inspectCover(context).coverBonus;
  }

  /** Nine inset footprint samples; all blocked is total cover (Infinity). */
  static inspectCover({ attacker, target, activity } = {}) {
    const empty = { coverBonus: 0, blocked: 0, samples: 9, fraction: 0, impact: null };
    if (!isRanged(activity) || !sameLevel(attacker, target)) return empty;
    const source = shapeOf(attacker);
    const destination = shapeOf(target);
    if (!source || !destination) return empty;
    const scene = sceneOf(attacker);
    const walls = scene.walls?.contents ?? scene.walls ?? [];
    const filter = wall => isBlocking(wall, attacker, target);
    let blocked = 0;
    const impacts = [];
    for (const row of [0.1, 0.5, 0.9]) {
      for (const column of [0.1, 0.5, 0.9]) {
        const point = { x: destination.x + destination.width * column, y: destination.y + destination.height * row };
        const hit = findFirstWallIntersection(source.center, point, walls, { isBlocking: filter });
        if (hit) { blocked++; impacts.push(hit); }
      }
    }
    const fraction = blocked / 9;
    const coverBonus = blocked === 9 ? Infinity : fraction >= 0.75 ? 5 : fraction >= 0.5 ? 2 : 0;
    const centerImpact = findFirstWallIntersection(source.center, destination.center, walls, { isBlocking: filter });
    const impact = centerImpact ?? impacts.sort((a, b) => a.t - b.t)[0] ?? null;
    return { coverBonus, blocked, samples: 9, fraction, impact };
  }

  static _onTargetResolved(context) {
    const { workflow, targetToken } = context;
    if (!this._enabled() || !workflow || !isRanged(workflow.activity)) return;
    const cover = this.inspectCover({ attacker: workflow.token, target: targetToken, activity: workflow.activity });
    const targetId = documentOf(targetToken)?.id;
    const records = this._records.get(workflow) ?? new Map();
    records.delete(targetId);
    this._records.set(workflow, records);
    const totalCover = cover.coverBonus === Infinity;
    if (totalCover) {
      // This hook runs after force-hit flags and natural critical handling.
      context.isHit = false;
      context.isHitEC = false;
    }
    const naturalOne = naturalResultOf(workflow.attackRoll) === 1;
    if (naturalOne) { context.isHit = false; context.isHitEC = false; }
    if (!isWeapon(workflow.activity) || !cover.impact || workflow.isFumble || naturalOne) return;
    let bareAC = Number(context.targetACWithoutCover);
    if (!Number.isFinite(bareAC)) {
      if (Number.isFinite(context.targetAC)) bareAC = context.targetAC - Number(context.acResult?.effectiveCoverBonus ?? cover.coverBonus ?? 0);
      else bareAC = Number(context.acResult?.baseAC) + Number(context.acResult?.targetACMod ?? 0);
    }
    if (!Number.isFinite(bareAC)) return;
    const resolvedFinalAC = Number(context.targetAC);
    const bonus = totalCover ? 0 : Math.max(0, Number.isFinite(resolvedFinalAC) ? resolvedFinalAC - bareAC : cover.coverBonus);
    const result = classifyCoverOutcome({
      attackTotal: Number(context.attackTotal), targetAC: bareAC, coverBonus: bonus,
      totalCover, hasObstacle: true, isNaturalOne: workflow.isFumble
    });
    if (result.outcome !== "cover" || (!totalCover && (context.isHit || context.isHitEC))) return;
    const descriptor = workflow.targetDescriptors?.find(entry => entry.token === documentOf(targetToken)?.uuid || entry.actor === targetToken.actor?.uuid);
    const statusCoverBonus = Number(targetToken.actor?.system?.attributes?.ac?.cover) || 0;
    const descriptorAC = Number.isFinite(descriptor?.ac) ? descriptor.ac : Number(targetToken.actor?.system?.attributes?.ac?.value);
    const descriptorBaseAC = descriptorAC - statusCoverBonus;
    records.set(targetId, {
      targetId, wallId: cover.impact.wallId, impact: { x: cover.impact.x, y: cover.impact.y },
      attackerShape: shapeOf(workflow.token), targetShape: shapeOf(targetToken), wallCoordinates: [...cover.impact.wall.c],
      attackTotal: Number(context.attackTotal), targetAC: bareAC, coverBonus: bonus, totalCover,
      physicalBlocked: cover.blocked,
      attackBonus: Number(context.attackTotal) - Number(workflow.attackRoll?.total),
      statusCoverBonus, defenseAdjustment: bareAC - descriptorBaseAC,
      referenceAC: result.referenceAC, threshold: result.threshold
    });
  }

  static async _persistAttack(workflow) {
    if (!this._enabled() || !isWeapon(workflow?.activity) || workflow.hardwipeDirectWall) return;
    const records = [...(this._records.get(workflow)?.values() ?? [])];
    workflow.hardwipeCoverImpacts = records;
    const message = game.messages.get(workflow.itemCardId);
    if (!message || (!game.user.isGM && message.author?.id !== game.user.id)) return;
    const previous = message.getFlag(MODULE_ID, STATE_FLAG) ?? {};
    await message.setFlag(MODULE_ID, STATE_FLAG, {
      ...previous, version: 1, workflowId: String(workflow.id), sceneId: sceneOf(workflow.token)?.id,
      attackerId: documentOf(workflow.token)?.id, itemUuid: workflow.item?.uuid,
      activityId: workflow.activity?.id, records, pending: false, reviewPosted: false,
      attackRoll: workflow.attackRoll?.toJSON(),
      targetDescriptors: copy(workflow.targetDescriptors ?? []),
      targets: [...(workflow.targets ?? [])].map(target => documentOf(target)?.uuid)
    });
  }

  static _enqueue(task) {
    const pending = this._queue.then(task);
    // Keep the queue usable while letting the initiating caller handle errors.
    this._queue = pending.catch(() => {});
    return pending;
  }

  static async _onDamage(workflow) {
    if (!this._enabled() || !isWeapon(workflow?.activity) || !workflow.hardwipeCoverImpacts?.length) return;
    const message = game.messages.get(workflow.itemCardId);
    const rolls = workflow.damageRolls ?? [];
    const damage = this._sumDamage(rolls);
    if (!damage) return;
    if (!message || message.author?.id !== game.user.id) return;
    const state = message.getFlag(MODULE_ID, STATE_FLAG);
    if (!state || state.reviewPosted || state.confirmedBy || state.dismissedBy) return;
    // Record the proposal only. The active GM applies it after an explicit decision.
    await workflow.displayDamageRolls();
    await workflow.performThrottledUpdate(message, {}, true);
    await message.setFlag(MODULE_ID, STATE_FLAG, { ...state, damageRolls: rolls.map(roll => roll.toJSON()), damageReady: true, pending: true,
      wallStates: this._snapshotWallStates(game.scenes.get(state.sceneId), state.records) });
    const gmIds = game.users.contents.filter(user => user.isGM).map(user => user.id);
    const scene = game.scenes.get(state.sceneId);
    const impacts = [], seen = new Set();
    for (const record of state.records) {
      if (seen.has(record.wallId)) continue;
      seen.add(record.wallId);
      const wall = scene?.walls.get(record.wallId), material = wall?.getFlag(MODULE_ID, "cover");
      const target = scene?.tokens.get(record.targetId)?.name ?? "target";
      if (!wall || !material || material.ballistic === false || !finite(material.max) || Number(material.max) <= 0) {
        impacts.push({ target, indestructible: true });
        continue;
      }
      const section = this._section(wall, record.impact, material, scene);
      const assessed = evaluateWallDamage(damage, material);
      impacts.push({ target, material: material.material, section: Number(section.key) + 1, ...assessed,
        before: section.hp, after: Math.max(0, section.hp - assessed.applied), max: Number(material.max) });
    }
    const review = await ChatMessage.create({
      content: this._wallCard("review", { attacker: message.alias || message.author.name, weapon: workflow.item.name, impacts }),
      whisper: gmIds, flags: { [MODULE_ID]: { coverReview: { sourceMessageId: message.id } } }
    });
    await message.setFlag(MODULE_ID, STATE_FLAG, { ...message.getFlag(MODULE_ID, STATE_FLAG), reviewPosted: true, reviewMessageId: review.id });
  }

  static _sumDamage(rolls) {
    return rolls.reduce((total, roll) => {
      const type = String(roll.options?.type ?? "").toLowerCase();
      if (["healing", "temphp"].includes(type) || !roll._evaluated || !Number.isFinite(roll.total)) return total;
      return total + Math.max(0, roll.total);
    }, 0);
  }

  static _snapshotWallStates(scene, records) {
    return Object.fromEntries(records.map(record => [record.wallId, copy(scene?.walls.get(record.wallId)?.getFlag(MODULE_ID, "cover") ?? null)]));
  }

  static _checkWallStates(state) {
    if (!state.wallStates) return; // Preserve legacy pending cards.
    const scene = game.scenes.get(state.sceneId);
    if (stableJSON(state.wallStates) !== stableJSON(this._snapshotWallStates(scene, state.records ?? [])))
      throw new Error("Wall durability changed after this proposal. Ignore the old card and roll a new wall attack.");
  }

  /** Only a message ID crosses the socket; actor ownership and rolls are re-derived on the GM. */
  static async _receiveImpact(messageId, senderId, { dismiss = false } = {}) {
    this._requireGM();
    if (!this._enabled()) throw new Error("Automatic wall cover is disabled.");
    if (typeof messageId !== "string" || !/^[a-zA-Z0-9]{16}$/.test(messageId)) throw new Error("Invalid originating message ID.");
    const sender = game.users.get(senderId);
    const message = game.messages.get(messageId);
    if (game.user.id !== game.users.activeGM?.id) throw new Error("Wall impacts must be resolved by the active GM.");
    if (!sender?.active || !sender.isGM) throw new Error("A GM must explicitly apply or ignore wall damage.");
    if (!message) throw new Error("The originating wall attack card is unavailable.");
    return this._enqueue(async () => {
      const state = message.getFlag(MODULE_ID, STATE_FLAG);
      if (!state?.pending) return false;
      if (dismiss) {
        await message.setFlag(MODULE_ID, STATE_FLAG, { ...state, pending: false, dismissedBy: sender.id });
        return true;
      }
      // Re-read inside the queue so duplicate approvals observe persisted receipts.
      const current = this._verifyCard(message);
      await this._applyRecords(current);
      await message.setFlag(MODULE_ID, STATE_FLAG, { ...message.getFlag(MODULE_ID, STATE_FLAG), pending: false, confirmedBy: sender.id });
      return { applied: true, workflowId: current.workflowId };
    });
  }

  static _rollFromData(data) {
    return typeof data === "string" ? Roll.fromJSON(data) : data?.toJSON ? data : data ? Roll.fromData(data) : null;
  }

  static _verifyCard(message, author = message.author) {
    const state = message.getFlag(MODULE_ID, STATE_FLAG);
    this._checkWallStates(state ?? {});
    if (state?.mode === "direct") return WallTargeting.verifyCard(message);
    if (state?.version !== 1 || !state.damageReady || typeof state.workflowId !== "string" || !Array.isArray(state.records)) throw new Error("The originating card has no completed wall attack.");
    if (state.workflowId !== message.uuid) throw new Error("The wall request does not match the originating workflow.");
    const scene = game.scenes.get(state.sceneId);
    const attacker = scene?.tokens.get(state.attackerId);
    const itemUuid = message.system?.item?.uuid ?? message.flags?.dnd5e?.item?.uuid;
    if (!itemUuid || itemUuid !== state.itemUuid) throw new Error("The wall request does not match the originating item card.");
    const item = fromUuidSync(itemUuid);
    if (!scene || !attacker?.actor || item?.actor?.uuid !== attacker.actor.uuid || !author || !attacker.actor.testUserPermission(author, "OWNER")) throw new Error("The originating author, actor, weapon, or scene could not be verified.");
    if (message.speaker?.scene !== scene.id || message.speaker?.token !== attacker.id) throw new Error("The originating speaker is not the attacking scene token.");
    const activity = item.system.activities?.get(state.activityId);
    const activityUuid = message.system?.activity?.uuid ?? message.flags?.["midi-qol"]?.activityUuid;
    if (!isWeapon(activity) || (activityUuid && activityUuid !== activity.uuid)) throw new Error("The originating ranged weapon activity could not be verified.");
    const midi = message.flags?.["midi-qol"] ?? {};
    const attackRoll = this._rollFromData(midi.attackRoll);
    const canonicalRolls = message.rolls ?? [];
    const signature = value => {
      const roll = this._rollFromData(value);
      if (!roll) return "null";
      const data = roll.toJSON();
      // Rendering and configuration add presentation options after the roll.
      // Formula, evaluated terms/results, total and damage type remain canonical.
      return stableJSON(coverRollSignatureData(data));
    };
    if (signature(state.attackRoll) !== signature(attackRoll) || !canonicalRolls.some(roll => signature(roll) === signature(attackRoll))) throw new Error("The cover snapshot does not match the originating attack roll.");
    if (!attackRoll?._evaluated || !Number.isFinite(attackRoll.total)) throw new Error("The originating card has no evaluated attack roll.");
    const natural = naturalResultOf(attackRoll);
    if (natural === 1) throw new Error("Natural-one attacks cannot strike cover.");
    const damageRolls = canonicalRolls.filter(roll => roll.options?.["midi-qol"]?.rollType === "defaultDamage");
    if (stableJSON((state.damageRolls ?? []).map(signature)) !== stableJSON(damageRolls.map(signature))) throw new Error("The cover snapshot does not match the originating damage rolls.");
    if (!damageRolls.length || damageRolls.some(roll => !roll?._evaluated)) throw new Error("The originating card has no evaluated weapon damage rolls.");
    const damage = this._sumDamage(damageRolls);
    if (!damage) throw new Error("The originating weapon has no positive damage.");
    const descriptors = message.system?.targets ?? [];
    const allowedTargets = new Set(descriptors.map(descriptor => descriptor.token));
    const resolutions = midi.resolvedTargetACs ?? [];
    if (stableJSON([...(state.targets ?? [])].sort()) !== stableJSON([...allowedTargets].sort())) throw new Error("The cover snapshot does not match the originating targets.");
    const records = [];
    for (const stored of state.records) {
      if ((scene.getFlag(MODULE_ID, LEDGER_FLAG) ?? []).some(entry => entry.key === `${state.workflowId}:${stored.wallId}`)) continue;
      const target = scene.tokens.get(stored.targetId);
      if (!target || !allowedTargets.has(target.uuid) || !sameLevel(attacker, target)) continue;
      const descriptor = descriptors.find(entry => entry.token === target.uuid || entry.actor === target.actor?.uuid);
      if (!descriptor) throw new Error("The wall impact target is absent from the originating target descriptors.");
      const current = this.inspectCover({ attacker, target, activity });
      if (!current.impact) continue;
      const resolved = resolutions.find(entry => entry.targetUuid === target.uuid);
      if (!resolved || resolved.isHit || resolved.isHitEC) throw new Error("The originating card has no matching cover miss resolution.");
      const targetAC = Number(resolved.targetACWithoutCover);
      const attackTotal = Number(resolved.attackTotal);
      const totalCover = current.coverBonus === Infinity;
      const coverBonus = totalCover ? 0 : Number(resolved.coverBonus);
      if (![targetAC, attackTotal, coverBonus].every(Number.isFinite) || coverBonus < 0) throw new Error("The persisted attack resolution is incomplete.");
      if (stored.targetAC !== targetAC || stored.attackTotal !== attackTotal || stored.coverBonus !== coverBonus || stored.totalCover !== resolved.totalCover) throw new Error("The cover snapshot does not match the originating target AC resolution.");
      if (stored.wallId !== current.impact.wallId || stored.totalCover !== totalCover || stored.physicalBlocked !== current.blocked) throw new Error("Physical cover changed after the originating shot; the impact was not applied.");
      const outcome = classifyCoverOutcome({ attackTotal, targetAC, coverBonus, totalCover, hasObstacle: true });
      if (outcome.outcome !== "cover") continue;
      records.push({ ...stored, targetAC, attackTotal, coverBonus, totalCover, wallId: current.impact.wallId });
    }
    return { workflowId: state.workflowId, scene, attacker, activity, records, damage, message };
  }

  static _renderReview(message, element) {
    if (!game.user.isGM) return;
    const state = message.getFlag(MODULE_ID, STATE_FLAG);
    const sourceId = message.getFlag(MODULE_ID, "coverReview")?.sourceMessageId ?? (state?.pending && !state.reviewPosted ? message.id : null);
    element.querySelectorAll(".hardwipe-cover-review-controls, .hardwipe-cover-confirm").forEach(node => node.remove());
    if (!sourceId) return;
    this._reviews.set(element, message);
    const source = game.messages.get(sourceId);
    const current = source?.getFlag(MODULE_ID, STATE_FLAG);
    // Cards from 0.7.9 carry an actions slot styled as street-deck controls; older prompts keep plain controls.
    const slot = element.querySelector(".hardwipe-wall-card .hardwipe-wall-actions");
    const card = (key, fallback) => {
      const id = `HARDWIPE.Cover.Card.${key}`, value = game.i18n.localize(id);
      return value === id ? fallback : value;
    };
    const controls = element.ownerDocument.createElement("div");
    controls.className = "hardwipe-cover-review-controls";
    if (!current?.pending) {
      const [status, icon] = current?.dismissedBy ? [slot ? card("Ignored", "Ignored") : "Wall impact ignored.", "fa-ban"] : current?.confirmedBy
        ? [slot ? card("Applied", "Applied") : "Wall damage applied.", "fa-block-brick"] : [slot ? card("Unavailable", "Unavailable") : "Originating wall impact unavailable.", "fa-circle-question"];
      controls.classList.add("is-resolved", current?.confirmedBy ? "is-applied" : "is-closed");
      controls.innerHTML = slot
        ? `<div class="hardwipe-wall-stamp ${current?.confirmedBy ? "is-applied" : "is-closed"}"><i class="fas ${icon}" inert></i>${escape(status)}</div>`
        : `<i class="fas ${icon}" inert></i><span>${escape(status)}</span>`;
    } else {
      for (const [label, action, className, icon] of [[slot ? card("Apply", "Apply damage") : "Apply wall damage", () => this.confirmPending(sourceId), "hardwipe-cover-confirm", "fa-block-brick"],
        [slot ? card("Ignore", "Ignore") : "Ignore", () => this.dismissPending(sourceId), "hardwipe-cover-dismiss", "fa-xmark"]]) {
        const button = element.ownerDocument.createElement("button");
        const primary = className === "hardwipe-cover-confirm" ? "is-primary" : "";
        button.type = "button"; button.className = `${slot ? "hardwipe-hud-btn" : "hardwipe-btn"} ${primary} ${className}`;
        button.innerHTML = `<i class="fas ${icon}" inert></i><span>${escape(label)}</span>`;
        button.addEventListener("click", async () => {
          controls.querySelectorAll("button").forEach(control => { control.disabled = true; });
          try { await action(); }
          catch (error) { this._report(error); }
          finally { if (element.isConnected) this._renderReview(message, element); }
        });
        controls.append(button);
      }
    }
    element.querySelector(".hardwipe-wall-card")?.classList.toggle("is-resolved", !current?.pending);
    (slot ?? element.querySelector(".message-content") ?? element).append(controls);
  }

  /** Explicit GM approval is required for every wall impact, including GM-authored attacks. */
  static async confirmPending(messageId) {
    this._requireGM();
    return this._requestDecision(messageId, "applyWallImpact");
  }

  static async dismissPending(messageId) {
    this._requireGM();
    return this._requestDecision(messageId, "dismissWallImpact");
  }

  static async _requestDecision(messageId, action) {
    if (!game.users.activeGM) throw new Error("Wall review requires a connected GM.");
    if (game.user.id === game.users.activeGM.id) return this._receiveImpact(messageId, game.user.id, { dismiss: action === "dismissWallImpact" });
    if (!this._socket) throw new Error("Wall review requires socketlib.");
    return this._socket.executeAsUser(action, game.users.activeGM.id, messageId);
  }

  static async _applyRecords({ workflowId, scene, attacker, activity, records, damage, message, direct = false }) {
    this._requireGM();
    if (!scene || !Number.isFinite(damage) || damage <= 0) return;
    const wallsUsed = new Set();
    for (const record of records) {
      if (wallsUsed.has(record.wallId)) continue;
      wallsUsed.add(record.wallId);
      const ledgerKey = `${workflowId}:${record.wallId}`;
      if ((scene.getFlag(MODULE_ID, LEDGER_FLAG) ?? []).some(entry => entry.key === ledgerKey)) continue;
      let target, current;
      if (direct) ({ target, current } = WallTargeting.resolveRecord({ scene, attacker, activity, record }));
      else {
        target = scene.tokens.get(record.targetId);
        if (!target || !sameLevel(attacker, target)) continue;
        if (record.attackerShape && stableJSON(shapeOf(attacker)) !== stableJSON(record.attackerShape)) throw new Error("The attacker moved after the shot. The wall impact was not applied.");
        if (record.targetShape && stableJSON(shapeOf(target)) !== stableJSON(record.targetShape)) throw new Error("The target moved after the shot. The wall impact was not applied.");
        current = this.inspectCover({ attacker, target, activity });
        // Re-derive the wall from current scene geometry; never trust an incoming wall ID alone.
        if (!current.impact || current.impact.wallId !== record.wallId) continue;
        if (record.physicalBlocked !== undefined && record.physicalBlocked !== current.blocked) throw new Error("Physical cover changed after the shot. The wall impact was not applied.");
        if (record.totalCover !== (current.coverBonus === Infinity)) throw new Error("The cover tier changed after the shot. The wall impact was not applied.");
        const result = classifyCoverOutcome({
          attackTotal: record.attackTotal, targetAC: record.targetAC, coverBonus: record.coverBonus,
          totalCover: record.totalCover, hasObstacle: true
        });
        if (result.outcome !== "cover") continue;
      }
      const wall = scene.walls.get(record.wallId);
      if (record.wallCoordinates && stableJSON(wall?.c) !== stableJSON(record.wallCoordinates)) throw new Error("The wall moved after the shot. The wall impact was not applied.");
      const material = wall?.getFlag(MODULE_ID, "cover");
      if (!material || material.ballistic === false || !finite(material.max) || Number(material.max) <= 0) {
        const ledger = [...(scene.getFlag(MODULE_ID, LEDGER_FLAG) ?? []), { key: ledgerKey, at: Date.now(), wallId: wall.id, damage: 0 }];
        await this._batch([{ action: "update", documentName: "Scene", updates: [{ _id: scene.id, [`flags.${MODULE_ID}.${LEDGER_FLAG}`]: ledger }] }]);
        await this._announce(this._wallCard("held", { attacker: attacker?.name, weapon: activity.item.name,
          impacts: [{ target: target.name, direct, indestructible: true }] }), scene, message);
        continue;
      }
      const assessed = evaluateWallDamage(damage, material);
      const { applied } = assessed;
      const section = this._section(wall, current.impact, material, scene);
      if (!applied) {
        const ledger = [...(scene.getFlag(MODULE_ID, LEDGER_FLAG) ?? []), { key: ledgerKey, at: Date.now(), wallId: wall.id, damage: 0 }];
        await this._batch([{ action: "update", documentName: "Scene", updates: [{ _id: scene.id, [`flags.${MODULE_ID}.${LEDGER_FLAG}`]: ledger }] }]);
        await this._announce(this._wallCard("held", { attacker: attacker?.name, weapon: activity.item.name,
          impacts: [{ target: target.name, direct, material: material.material, section: Number(section.key) + 1, ...assessed,
            before: section.hp, after: section.hp, max: Number(material.max) }] }), scene, message);
        continue;
      }
      const remaining = Math.max(0, section.hp - applied);
      const cover = { ...copy(material), ...section.metadata, sections: { ...copy(material.sections ?? {}) } };
      cover.sections[section.key] = { ...(cover.sections[section.key] ?? {}), hp: remaining, max: Number(material.max),
        impact: copy(cover.sections[section.key]?.impact ?? { x: current.impact.x, y: current.impact.y }) };
      const ledger = [...(scene.getFlag(MODULE_ID, LEDGER_FLAG) ?? []), { key: ledgerKey, at: Date.now(), wallId: wall.id, damage: applied }];
      const sceneUpdate = { _id: scene.id, [`flags.${MODULE_ID}.${LEDGER_FLAG}`]: ledger };
      let operations;
      let breached = false;
      let appearance;
      if (remaining <= 0) {
        const original = wall.toObject();
        const owned = WallAppearance.owned(scene, wall.id);
        WallAppearance.assertOwnedUnchanged(owned, material);
        const plan = planWallBreach(WallAppearance.base(original, material), section.center, section.length);
        delete cover.sections[section.key];
        delete cover.wear;
        const after = { walls: [], tiles: [] };
        for (const remainder of plan.remainders) {
          remainder._id = foundry.utils.randomID();
          remainder.c = remainder.c.map(Math.round);
          if (remainder.c[0] === remainder.c[2] && remainder.c[1] === remainder.c[3]) continue;
          remainder.flags ??= {};
          remainder.flags[MODULE_ID] ??= {};
          remainder.flags[MODULE_ID].cover = copy(cover);
          const child = WallAppearance.plan(scene, new CONFIG.Wall.documentClass(remainder, { parent: scene }).toObject(), cover);
          after.walls.push(...child.after.walls);
          after.tiles.push(...child.after.tiles);
        }
        appearance = { before: { walls: [original, ...owned.walls], tiles: owned.tiles }, after };
        operations = WallAppearance.operations(scene, appearance);
        breached = true;
      } else if (applied > 0) {
        appearance = WallAppearance.plan(scene, wall.toObject(), cover);
        operations = WallAppearance.operations(scene, appearance);
      } else {
        operations = [{ action: "update", documentName: "Wall", parent: scene, updates: [{ _id: wall.id, [`flags.${MODULE_ID}.cover`]: replace(cover) }] }];
      }
      if (appearance) sceneUpdate[`flags.${MODULE_ID}.${HISTORY_FLAG}`] = [...(scene.getFlag(MODULE_ID, HISTORY_FLAG) ?? []), {
        version: 2, id: foundry.utils.randomID(), at: Date.now(), userId: game.user.id,
        ...copy(appearance), workflowId, ledgerKey
      }].slice(-20);
      operations.push({ action: "update", documentName: "Scene", updates: [sceneUpdate] });
      await this._batch(operations);
      await this._announce(this._wallCard(breached ? "breach" : "hit", { attacker: attacker?.name, weapon: activity.item.name,
        impacts: [{ target: target.name, direct, material: material.material, section: Number(section.key) + 1, ...assessed,
          before: section.hp, after: remaining, max: Number(material.max) }] }), scene, message);
    }
  }

  static _section(wall, impact, cover, scene) {
    const c = wall.c;
    const length = Math.hypot(c[2] - c[0], c[3] - c[1]);
    const origin = cover.sectionOrigin ?? { x: c[0], y: c[1] };
    const direction = cover.sectionDirection ?? { x: (c[2] - c[0]) / length, y: (c[3] - c[1]) / length };
    const size = Number(cover.sectionPixels) > 0 ? Number(cover.sectionPixels) : getFiveFootPixels(scene);
    const distance = (impact.x - origin.x) * direction.x + (impact.y - origin.y) * direction.y;
    const start = (c[0] - origin.x) * direction.x + (c[1] - origin.y) * direction.y;
    const end = (c[2] - origin.x) * direction.x + (c[3] - origin.y) * direction.y;
    // Internal boundaries belong to the preceding section, but a surviving
    // segment endpoint cannot select a section removed by an earlier breach.
    const first = Math.max(0, Math.floor((Math.min(start, end) + 1e-7) / size));
    const last = Math.max(first, Math.ceil((Math.max(start, end) - 1e-7) / size) - 1);
    const key = String(Math.min(last, Math.max(first, Math.floor(Math.max(0, distance - 1e-7) / size))));
    const candidateHP = Number(cover.sections?.[key]?.hp ?? cover.hp ?? cover.max);
    const hp = Math.min(Number(cover.max), Math.max(0, Number.isFinite(candidateHP) ? candidateHP : Number(cover.max)));
    // The same anchored interval owns HP and the breach. Remainders retain the
    // original origin, so subsequent hits cannot reset surviving section HP.
    const intervalStart = Math.max(Math.min(start, end), Number(key) * size);
    const intervalEnd = Math.min(Math.max(start, end), (Number(key) + 1) * size);
    const midpoint = (intervalStart + intervalEnd) / 2;
    return {
      key, hp, center: { x: origin.x + direction.x * midpoint, y: origin.y + direction.y * midpoint },
      length: Math.max(1e-7, intervalEnd - intervalStart),
      metadata: { sectionOrigin: copy(origin), sectionDirection: copy(direction), sectionPixels: size }
    };
  }

  static async _batch(operations) {
    if (typeof foundry.documents.modifyBatch !== "function") throw new Error("Atomic wall changes require Foundry v14 modifyBatch; no wall data was changed.");
    return foundry.documents.modifyBatch(operations);
  }

  static async undo(scene = canvas.scene) {
    this._requireGM();
    return this._enqueue(async () => {
      const history = copy(scene?.getFlag(MODULE_ID, HISTORY_FLAG) ?? []);
      const entry = history.at(-1);
      if (!entry) { ui.notifications.info("There is no wall damage to undo in this scene."); return false; }
      if (entry.version === 2) {
        for (const name of ["walls", "tiles"]) {
          for (const expected of entry.after[name]) {
            const current = scene[name].get(expected._id);
            if (!current || !wallWearDataEqual(current.toObject(), expected)) throw new Error("A wall or damage visual changed after the impact. Undo stopped to preserve those changes.");
          }
          const afterIds = new Set(entry.after[name].map(data => data._id));
          if (entry.before[name].some(data => !afterIds.has(data._id) && scene[name].has(data._id))) throw new Error("A restored document ID is already in use; undo stopped.");
        }
        const operations = WallAppearance.operations(scene, { before: entry.after, after: entry.before });
        operations.push({ action: "update", documentName: "Scene", updates: [{ _id: scene.id, [`flags.${MODULE_ID}.${HISTORY_FLAG}`]: history.slice(0, -1) }] });
        await this._batch(operations);
        ui.notifications.info("Last wall damage restored.");
        return true;
      }
      if (scene.walls.get(entry.original._id)) throw new Error("The original wall ID is already in use; undo stopped.");
      for (const expected of entry.remainders) {
        const current = scene.walls.get(expected._id);
        if (!current || stableJSON(current.toObject()) !== stableJSON(expected)) throw new Error("A remaining wall segment changed after the breach. Undo stopped to preserve those changes.");
      }
      const operations = [];
      if (entry.remainders.length) operations.push({ action: "delete", documentName: "Wall", parent: scene, ids: entry.remainders.map(data => data._id), hardwipeWallWear: true });
      operations.push({ action: "create", documentName: "Wall", parent: scene, keepId: true, data: [entry.original], hardwipeWallWear: true });
      operations.push({ action: "update", documentName: "Scene", updates: [{ _id: scene.id, [`flags.${MODULE_ID}.${HISTORY_FLAG}`]: history.slice(0, -1) }] });
      await this._batch(operations);
      ui.notifications.info("Last wall breach restored.");
      return true;
    });
  }

  static async configureSelected() {
    this._requireGM();
    const selected = (canvas.walls?.controlled ?? []).map(wall => wall.document);
    const walls = [...new Map(selected.map(wall => {
      const parentId = wall.getFlag(MODULE_ID, "wallWear")?.parentId;
      const parent = parentId ? wall.parent.walls.get(parentId) : wall;
      return [parent?.id, parent];
    })).values()].filter(Boolean);
    if (!walls.length) { ui.notifications.warn("Select one or more walls first."); return; }
    const types = WallTypes.materials;
    const current = walls[0].getFlag(MODULE_ID, "cover") ?? { material: "concrete", max: 40, hp: 40, armor: 5, ac: 10, damageThreshold: 0 };
    const input = await foundry.applications.api.DialogV2.input({
      window: { title: `Configure cover: ${walls.length} wall${walls.length === 1 ? "" : "s"}` },
      content: `<p>Durability applies to each five-foot section. Open doors allow shots through.</p>
        <div class="form-group"><label>Wall type</label><select name="preset">
        <option value="current" selected>Keep each wall's current values</option>
        <option value="custom">Custom values below</option>
        ${Object.entries(types).map(([key, preset]) => `<option value="type:${escape(key)}">${escape(preset.name)}: ${preset.max} HP, ${preset.armor} armor, threshold ${preset.damageThreshold}</option>`).join("")}
        <option value="solid">Solid, indestructible</option></select></div>
        <p class="hint">Choose a saved type to use its values, or Custom to use the fields below. Manage saved types in Settings → Game Settings → Hardwipe Ruleset → Manage wall types.</p>
        <div class="form-group"><label>Custom material</label><input name="material" value="${escape(current.material)}"></div>
        <div class="form-group"><label>Custom AC</label><input type="number" name="ac" min="0" value="${escape(current.ac ?? 10)}"></div>
        <div class="form-group"><label>Custom maximum HP</label><input type="number" name="max" min="1" value="${escape(current.max)}"></div>
        <div class="form-group"><label>Custom starting HP</label><input type="number" name="hp" min="1" value="${escape(current.hp ?? current.max)}"></div>
        <div class="form-group"><label>Custom armor</label><input type="number" name="armor" min="0" value="${escape(current.armor)}"></div>
        <div class="form-group"><label>Custom damage threshold</label><input type="number" name="damageThreshold" min="0" value="${escape(current.damageThreshold ?? 0)}"></div>
        <p class="hint">A damage roll below the threshold deals no damage. Qualifying rolls then subtract armor.</p>
        <div class="form-group"><label>Reset section HP to starting HP</label><input type="checkbox" name="resetHP"></div>
        <div class="form-group"><label for="hardwipe-wall-appearance">Show damage and glimpses</label><input id="hardwipe-wall-appearance" type="checkbox" name="appearance" ${current.appearance !== false ? "checked" : ""}></div>
        <p class="hint">Damage leaves surface marks. At half HP, cracks allow light and vision; at quarter HP they widen. Shooting cover and movement remain unchanged until destruction.</p>`,
      ok: { label: "Apply material", icon: "fa-solid fa-shield-halved" }, rejectClose: false
    });
    if (!input) return;
    let material = this._wallMaterial(input.preset);
    if (input.preset === "custom") {
      material = WallTypes.validate({ ...input, id: "custom", name: String(input.material || "Custom wall") });
    }
    const reset = Boolean(input.resetHP);
    await this._enqueue(async () => {
      const operations = walls.flatMap(wall => this._wallConfigurationOperations(wall, {
        material, typeId: input.preset.startsWith("type:") ? material.id : null,
        reset, appearance: Boolean(input.appearance)
      }));
      await this._batch(operations);
    });
    ui.notifications.info(`Cover material applied to ${walls.length} wall${walls.length === 1 ? "" : "s"}.`);
  }

  static _wallMaterial(preset) {
    if (preset === "current" || preset === "custom") return null;
    if (preset === "solid") return { material: "solid", max: null, hp: null, armor: 0, ac: 10, damageThreshold: 0 };
    const material = preset?.startsWith("type:") ? WallTypes.get(preset.slice(5)) : null;
    if (!material) throw new Error("This wall type no longer exists. Reopen the wall configuration before saving.");
    return material;
  }

  /** Build the same durability snapshot for configuration previews and saved wall operations. */
  static _wallConfigurationCover(previous, { material, typeId, reset = false, appearance }) {
    const cover = material ? { ...copy(previous), ...copy(material), typeId, version: 2, ballistic: true } : copy(previous);
    if (appearance !== undefined) cover.appearance = appearance;
    if (!reset && material?.max && Number(previous.max) > 0 && finite(previous.hp ?? previous.max)) {
      cover.hp = Math.min(Number(previous.hp ?? previous.max), Number(material.max));
    }
    if (reset) {
      if (!material && Number(cover.max) > 0) cover.hp = Number(cover.max);
      Object.assign(cover, { sections: {}, sectionOrigin: null, sectionDirection: null, sectionPixels: null });
    }
    // A type change adopts its maximum immediately, clamping HP without healing or moving sections.
    // Keep-current edits preserve every recorded section value exactly.
    else if (previous.sections) {
      cover.sections = copy(previous.sections);
      if (Number(material?.max) > 0) {
        for (const section of Object.values(cover.sections)) {
          section.max = Number(material.max);
          if (finite(section.hp)) section.hp = Math.min(Number(section.hp), Number(material.max));
        }
      }
    }
    return cover;
  }

  /** Shared by the native single-wall sheet and the selected-walls dialog. */
  static _wallConfigurationOperations(document, { material, typeId, reset = false, appearance, updateData = {} }) {
    this._requireGM();
    const wall = document.parent?.walls.get(document.id);
    if (!wall || wall.getFlag(MODULE_ID, "wallWear")) throw new Error("Configure the original physical wall, not a damage visual.");
    const previous = copy(wall.getFlag(MODULE_ID, "cover") ?? {});
    const data = foundry.utils.mergeObject(wall.toObject(), updateData, { inplace: false });
    // Native WallConfig has no editable coordinates. Configuration never changes physical geometry.
    data.c = copy(wall.c);
    const cover = this._wallConfigurationCover(previous, { material, typeId, reset, appearance });
    if (cover.wear?.restrictions) {
      for (const key of ["sight", "light"]) if (key in updateData) cover.wear.restrictions[key] = data[key];
    }
    return WallAppearance.operations(wall.parent, WallAppearance.plan(wall.parent, data, cover, { reset }));
  }

  /**
   * Street-deck chat card for wall impacts. `review` is the GM proposal (controls are added on render);
   * `hit`, `breach` and `held` report an applied result. Each impact shows the damage math and section HP.
   */
  static _wallCard(kind, { attacker, weapon, impacts }) {
    const t = key => escape(game.i18n.localize(`HARDWIPE.Cover.Card.${key}`));
    const title = t(`${kind}Title`);
    const body = impacts.map(impact => {
      const head = `<div class="hardwipe-wall-head"><span class="hardwipe-wall-material">${impact.indestructible
        ? t("Indestructible") : escape(game.i18n.format("HARDWIPE.Cover.Card.Material", { material: impact.material ?? t("Wall") }))}</span>
        ${impact.section ? `<span class="hardwipe-wall-section">${t("Section")} ${escape(impact.section)}</span>` : ""}</div>
        <div class="hardwipe-wall-target">${impact.direct ? t("DirectTarget") : escape(game.i18n.format("HARDWIPE.Cover.Card.Protecting", { target: impact.target }))}</div>`;
      if (impact.indestructible) {
        return `<div class="hardwipe-wall-impact is-held">${head}<div class="hardwipe-wall-held"><i class="fas fa-shield" inert></i>${t("NoDamage")}</div></div>`;
      }
      const max = Math.max(1, impact.max);
      const keep = Math.round(Math.min(1, Math.max(0, impact.after / max)) * 100);
      const loss = Math.round(Math.min(1, Math.max(0, (impact.before - impact.after) / max)) * 100);
      const chip = (value, key, extra = "") => `<span class="hardwipe-wall-chip ${extra}"><b>${escape(value)}</b>${t(key)}</span>`;
      return `<div class="hardwipe-wall-impact">${head}
        <div class="hardwipe-wall-math">${chip(impact.rolled, "Rolled")}${impact.belowThreshold ? `<span class="hardwipe-wall-op">&lt;</span>${chip(impact.damageThreshold, "Threshold")}` : `<span class="hardwipe-wall-op">−</span>${chip(impact.armor, "Armor")}`}<span class="hardwipe-wall-op">=</span>${chip(impact.applied, "Damage", "is-total")}</div>
        ${impact.belowThreshold ? `<p class="hardwipe-wall-held">${t("BelowThreshold")}</p>` : impact.damageThreshold > 0 ? `<p class="hardwipe-wall-held">${t("Threshold")}: ${escape(impact.damageThreshold)}</p>` : ""}
        <div class="hardwipe-wall-bar" style="--keep: ${keep}%; --loss: ${loss}%" role="meter" aria-valuemin="0" aria-valuemax="${escape(max)}" aria-valuenow="${escape(impact.after)}"><span class="hardwipe-wall-keep"></span><span class="hardwipe-wall-loss"></span></div>
        <div class="hardwipe-wall-hp"><span>${t("SectionHP")}</span><b>${escape(impact.before)}<i class="fas fa-arrow-right-long" inert></i><em>${escape(impact.after)}</em></b><span>/ ${escape(max)}</span></div>
        ${impact.after <= 0 ? `<div class="hardwipe-wall-breach"><i class="fas fa-burst" inert></i>${t("BreachBadge")}</div>` : ""}</div>`;
    }).join("");
    return `<div class="hardwipe-chat-card hardwipe-wall-card is-${kind} ${kind === "breach" ? "hardwipe-card-danger" : ""}">
      <div class="hardwipe-chat-kicker">${t(`${kind}Kicker`)}</div>
      <div class="hardwipe-chat-title" data-text="${title}">${title}</div>
      <div class="hardwipe-chat-subtitle">${escape(attacker ?? "")} · ${escape(weapon ?? "")}</div>
      ${body}
      <div class="hardwipe-chat-meta">${t(kind === "review" ? "Awaiting" : "Overflow")}</div>
      <div class="hardwipe-wall-actions"></div>
    </div>`;
  }

  static async _announce(content, scene, source) {
    const data = { content, flags: { [MODULE_ID]: { coverResult: { sceneId: scene.id, sourceMessageId: source?.id } } } };
    if (source?.whisper?.length) data.whisper = [...source.whisper];
    if (source?.blind) data.blind = true;
    return ChatMessage.create(data);
  }

  static _requireGM() {
    if (!game.user.isGM) throw new Error("A GM must change wall durability or geometry.");
  }

  static _report(error) {
    console.error(`${MODULE_ID} | Wall cover`, error);
    ui.notifications.error(error.message ?? String(error));
  }
}

/** Extend the v14 native sheet so core validation and submission stay in their intended subclass lifecycle. */
function buildWallConfig() {
  const prefix = "hardwipeWall";
  const t = key => game.i18n.localize(`HARDWIPE.Cover.WallConfig.${key}`);
  return class HardwipeWallConfig extends foundry.applications.sheets.WallConfig {
    _wallTypesChangedHook = null;

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const cover = this.document.getFlag(MODULE_ID, "cover");
      // Damage uses optical helper walls. Show the physical wall's original restrictions in its native inputs.
      if (cover?.wear?.restrictions) context.source = { ...context.source, ...copy(cover.wear.restrictions) };
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      if (this._wallTypesChangedHook !== null) Hooks.off("hardwipe.wallTypesChanged", this._wallTypesChangedHook);
      this._wallTypesChangedHook = null;
      if (!game.user.isGM || !this.isEditable) return;
      const body = this.element.querySelector(".standard-form.scrollable");
      if (!body) return;
      body.querySelector(".hardwipe-wall-config")?.remove();
      const fieldset = this.element.ownerDocument.createElement("fieldset");
      fieldset.className = "hardwipe-wall-config";
      if (this.document.getFlag(MODULE_ID, "wallWear")) {
        fieldset.innerHTML = `<legend>${escape(t("Title"))}</legend><p class="hint">${escape(t("HelperWall"))}</p>`;
        body.append(fieldset);
        return;
      }
      const cover = this.document.getFlag(MODULE_ID, "cover") ?? {};
      let types = WallTypes.materials;
      const currentName = cover.name ?? types[cover.typeId]?.name ?? cover.material ?? t("Solid");
      const root = `${this.id}-hardwipe-wall`;
      fieldset.innerHTML = `<legend>${escape(t("Title"))}</legend>
        <div class="form-group hardwipe-wall-config-type"><label for="${escape(root)}-type">${escape(t("Type"))}</label>
          <div class="form-fields"><select id="${escape(root)}-type" name="${prefix}Type">
            <option value="current">${escape(t("KeepCurrent"))}: ${escape(currentName)}</option>
            ${Object.values(types).map(type => `<option value="type:${escape(type.id)}">${escape(type.name)}</option>`).join("")}
            <option value="solid">${escape(t("Solid"))}</option>
          </select><button type="button" class="hardwipe-wall-config-manage icon" aria-label="${escape(t("Manage"))}" data-tooltip="${escape(t("Manage"))}"><i class="fas fa-cubes" inert></i></button></div>
        </div>
        <dl class="hardwipe-wall-config-values" aria-live="polite"></dl>
        <details class="hardwipe-wall-config-options"><summary>${escape(t("Options"))}</summary>
          <div class="hardwipe-wall-config-toggles">
            <label for="${escape(root)}-reset" title="${escape(t("ResetHint"))}"><input id="${escape(root)}-reset" name="${prefix}ResetHP" type="checkbox">${escape(t("Reset"))}</label>
            <label for="${escape(root)}-appearance"><input id="${escape(root)}-appearance" name="${prefix}Appearance" type="checkbox" ${cover.appearance !== false ? "checked" : ""}>${escape(t("Appearance"))}</label>
          </div>
          <p class="hint">${escape(t("Hint"))}</p>
          <p class="hint hardwipe-wall-config-sections"></p>
        </details>`;
      const select = fieldset.querySelector("select");
      const updateSummary = () => {
        const material = select.value === "current" ? cover : select.value === "solid"
          ? CoverManager._wallMaterial("solid") : types[select.value.slice(5)];
        if (!material) {
          fieldset.querySelector("dl").textContent = t("Unavailable");
          return;
        }
        const preview = CoverManager._wallConfigurationCover(cover, {
          material: select.value === "current" ? null : material,
          typeId: material.id ?? null, reset: fieldset.querySelector(`[name='${prefix}ResetHP']`).checked
        });
        const destructible = Number(preview.max) > 0;
        const values = destructible ? [
          ["HP", `${preview.hp ?? preview.max} / ${preview.max}`], ["AC", preview.ac ?? 10],
          ["Armor", preview.armor ?? 0], ["Threshold", preview.damageThreshold ?? 0]
        ] : [["Durability", t("Solid")]];
        fieldset.querySelector("dl").innerHTML = values.map(([key, value]) => `<div title="${escape(t(key))}"><dt>${escape(t(`${key}Short`))}</dt><dd>${escape(value)}</dd></div>`).join("");
        const sections = Object.entries(preview.sections ?? {}).slice(0, 8).map(([key, section]) => game.i18n.format("HARDWIPE.Cover.WallConfig.SectionHP", {
          section: Number(key) + 1, hp: section.hp, max: section.max ?? preview.max
        })).join("; ");
        fieldset.querySelector(".hardwipe-wall-config-sections").textContent = game.i18n.format("HARDWIPE.Cover.WallConfig.Sections", {
          count: Object.keys(preview.sections ?? {}).length
        }) + (sections ? ` ${sections}${Object.keys(preview.sections).length > 8 ? "…" : ""}` : "");
      };
      this._wallTypesChangedHook = Hooks.on("hardwipe.wallTypesChanged", () => {
        const selected = select.value;
        types = WallTypes.materials;
        select.innerHTML = `<option value="current">${escape(t("KeepCurrent"))}: ${escape(currentName)}</option>
          ${Object.values(types).map(type => `<option value="type:${escape(type.id)}">${escape(type.name)}</option>`).join("")}
          <option value="solid">${escape(t("Solid"))}</option>`;
        if (selected.startsWith("type:") && !types[selected.slice(5)]) {
          select.insertAdjacentHTML("beforeend", `<option value="${escape(selected)}">${escape(t("Unavailable"))}</option>`);
        }
        select.value = selected;
        updateSummary();
      });
      select.addEventListener("change", updateSummary);
      fieldset.querySelector(`[name='${prefix}ResetHP']`).addEventListener("change", updateSummary);
      fieldset.querySelector(".hardwipe-wall-config-manage").addEventListener("click", () => WallTypes.manage());
      body.append(fieldset);
      updateSummary();
    }

    _onClose(options) {
      if (this._wallTypesChangedHook !== null) Hooks.off("hardwipe.wallTypesChanged", this._wallTypesChangedHook);
      this._wallTypesChangedHook = null;
      super._onClose(options);
    }

    _processFormData(event, form, formData) {
      // UI-only values must never reach WallDocument validation or PlaceableConfig's live preview.
      const object = Object.fromEntries(Object.entries(formData.object).filter(([key]) => !key.startsWith(prefix)));
      return super._processFormData(event, form, { object });
    }

    async _processSubmitData(event, form, submitData, options = {}) {
      const selector = form.elements[`${prefix}Type`];
      if (!selector) return super._processSubmitData(event, form, submitData, options);
      CoverManager._requireGM();
      const preset = selector.value;
      const reset = form.elements[`${prefix}ResetHP`].checked;
      const appearance = form.elements[`${prefix}Appearance`].checked;
      const previous = this.document.getFlag(MODULE_ID, "cover");
      if (preset === "current" && !reset && appearance === (previous?.appearance !== false) && !previous?.wear) {
        return super._processSubmitData(event, form, submitData, options);
      }
      if (!this.document.parent?.walls.has(this.document.id)) {
        throw new Error("Place this wall in the scene before assigning a wall type.");
      }
      await CoverManager._enqueue(async () => {
        const material = CoverManager._wallMaterial(preset);
        const operations = CoverManager._wallConfigurationOperations(this.document, {
          material, typeId: preset.startsWith("type:") ? material.id : null, reset, appearance, updateData: submitData
        });
        await CoverManager._batch(operations);
      });
      return { updated: this.document };
    }
  };
}
