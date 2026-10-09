import { findFirstWallIntersection, getFiveFootPixels } from "./hardwipe-cover-geometry.js";
import { coverRollSignatureData } from "./hardwipe-cover-rolls.js";
import { evaluateWallDamage } from "./hardwipe-wall-types.js";

const ID = "hardwipe-ruleset";
const FLAG = "coverAttack";
const copy = value => foundry.utils.deepClone(value);
const stringify = value => JSON.stringify(value);
const natural = roll => roll?.dice?.find(die => die.faces === 20)?.results?.find(result => result.active !== false && !result.discarded)?.result;
const supported = activity => activity?.item?.type === "weapon" && !!activity.attack && ["mwak", "rwak"].includes(activity.actionType)
  && !activity.target?.template?.type && activity.target?.affects?.type !== "self";

function shape(token) {
  const document = token?.document ?? token;
  return { x: document.x, y: document.y, width: document.width, height: document.height, level: document.level ?? null, elevation: document.elevation };
}

function center(token, scene) {
  const document = token?.document ?? token;
  const size = Number(scene.grid.size) || 100;
  return { x: document.x + document.width * size / 2, y: document.y + document.height * size / 2 };
}

function physical(wall, token) {
  if (!Array.isArray(wall.c) || wall.c.every((coordinate, index) => coordinate === wall.c[index % 2])) return false;
  if (wall.isOpen || (wall.door > 0 && wall.ds === CONST.WALL_DOOR_STATES.OPEN)) return false;
  const document = token?.document ?? token;
  const levels = wall.levels instanceof Set ? [...wall.levels] : wall.levels;
  if (document.level && levels?.length && !levels.includes(document.level)) return false;
  const cover = wall.getFlag(ID, "cover");
  if (cover?.ballistic === false || wall.getFlag(ID, "wallWear")) return false;
  return cover?.ballistic === true || cover?.material === "glass" || wall.move > 0 || wall.sight > 0;
}

function projection(point, wall) {
  const [x, y, x2, y2] = wall.c;
  const dx = x2 - x, dy = y2 - y;
  const t = Math.max(0, Math.min(1, ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy)));
  return { x: x + dx * t, y: y + dy * t };
}

/** Local wall selection feeds a normal, targetless weapon activity. No proxy documents are created. */
export class WallTargeting {
  static _cover;
  static _initialized = false;
  static _controls = false;
  static _picking = false;
  static _selection = null;
  static _marker = null;
  static _view = null;
  static _abort = null;
  static _wrapping = new Set();
  static _blockClick = false;

  static registerControls() {
    if (this._controls) return;
    this._controls = true;
    Hooks.on("getSceneControlButtons", controls => {
      const tools = controls.tokens?.tools;
      if (!tools) return;
      tools["hardwipe-target-wall"] = {
        name: "hardwipe-target-wall", title: "Target wall", icon: "fas fa-crosshairs-simple",
        order: Math.max(0, ...Object.values(tools).map(tool => Number(tool.order) || 0)) + 1,
        visible: true, button: true, onChange: () => this.startSelection()
      };
    });
  }

  static initialize({ cover }) {
    if (this._initialized) return;
    this._initialized = true;
    this._cover = cover;
    this.registerControls();
    this._registerWrappers();
    Hooks.on("canvasReady", () => this._attach());
    Hooks.on("canvasTearDown", () => this._detach());
    Hooks.on("controlToken", (token, controlled) => {
      if (this._selection && ((token.id === this._selection.attackerId && !controlled)
        || (token.id !== this._selection.attackerId && controlled))) this.clear();
    });
    Hooks.on("updateToken", token => {
      if (this._selection?.attackerId === token.id && stringify(shape(token)) !== stringify(this._selection.attackerShape)) this.clear();
    });
    Hooks.on("midi-qol.preTargetingV2", context => this._preTargeting(context));
    // Midi rolls can be deferred to a usage-card button. Keep subsequently selected creature targets out of this use.
    Hooks.on("midi-qol.preAttackRoll", workflow => {
      if (!workflow.hardwipeDirectWall) return;
      workflow.setTargets(new Set());
      canvas.tokens.setTargets([]);
    });
    Hooks.on("dnd5e.preUseActivity", (activity, usage, dialog, message) => {
      const state = usage.workflow?.hardwipeDirectWall;
      if (!state) return;
      // Persist the completed attack after the roll. Midi caches the initial
      // usage-card data and would otherwise replay an obsolete pending state.
      foundry.utils.setProperty(message, "data.system.targets", []);
    });
    Hooks.on("midi-qol.AttackRollComplete", workflow => this._onAttack(workflow));
    Hooks.on("midi-qol.DamageRollComplete", workflow => this._onDamage(workflow));
    if (canvas.ready) this._attach();
  }

  static _registerWrappers() {
    for (const key of ["attack", "midiAttack"]) {
      const documentClass = CONFIG.DND5E.activityTypes[key]?.documentClass;
      if (!documentClass || this._wrapping.has(documentClass)) continue;
      this._wrapping.add(documentClass);
      const manager = this;
      libWrapper.register(ID, `CONFIG.DND5E.activityTypes.${key}.documentClass.prototype.use`, async function(wrapped, usage = {}, dialog = {}, message = {}) {
        if (usage.midiOptions?.workflowOptions?.hardwipeDirectWall || !manager._selection || !supported(this)) return wrapped(usage, dialog, message);
        try {
          return await manager._use(this, usage, dialog, message);
        } catch (error) {
          manager._report(error);
          return false;
        }
      }, "MIXED");
      libWrapper.register(ID, `CONFIG.DND5E.activityTypes.${key}.documentClass.prototype.configureAttackRoll`, async function(wrapped, config = {}) {
        if (config.workflow?.hardwipeDirectWall) {
          config.workflow.setTargets(new Set());
          canvas.tokens.setTargets([]);
          // Long range is an advisory on the attack card; roll mode stays manual.
        }
        return wrapped(config);
      }, "WRAPPER");
    }
  }

  static _attach() {
    this._detach();
    this._view = canvas.app?.view;
    if (!this._view) return;
    this._abort = new AbortController();
    const options = { capture: true, signal: this._abort.signal };
    this._view.addEventListener("pointermove", event => {
      if (!this._picking) return;
      const candidate = this._candidate(this._point(event));
      this._draw(candidate);
    }, options);
    this._view.addEventListener("pointerdown", event => {
      if (!this._picking || event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      this._blockClick = true;
      const candidate = this._candidate(this._point(event));
      if (!candidate) return;
      this._selection = candidate;
      this._picking = false;
      this._draw(candidate);
      ui.notifications.info("Wall section selected. Use a weapon from your character sheet to attack it. Escape cancels.");
    }, options);
    this._view.addEventListener("pointerup", event => {
      if (this._blockClick) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, options);
    this._view.addEventListener("click", event => {
      if (this._blockClick) { this._blockClick = false; event.preventDefault(); event.stopImmediatePropagation(); }
    }, options);
    this._view.ownerDocument.addEventListener("keydown", event => {
      if (event.key === "Escape") this.clear();
    }, { signal: this._abort.signal });
  }

  static _detach() {
    this._abort?.abort(); this._abort = null;
    this.clear(); this._view = null;
  }

  static _point(event) {
    const rect = this._view.getBoundingClientRect();
    return canvas.stage.toLocal(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
  }

  static _attacker() {
    const controlled = canvas.tokens?.controlled ?? [];
    return controlled.length === 1 && controlled[0].actor?.isOwner ? controlled[0] : null;
  }

  static startSelection() {
    if (this._selection || this._picking) { this.clear(); return; }
    if (!this._cover?._enabled()) { ui.notifications.warn("Enable wall cover before targeting a wall."); return; }
    if (!this._attacker()) { ui.notifications.warn("Control one character you own before targeting a wall."); return; }
    this._picking = true;
    ui.notifications.info("Click a visible wall section, then use a weapon from your character sheet.");
  }

  static clear() {
    this._blockClick = false;
    this._picking = false;
    this._selection = null;
    this._marker?.destroy(); this._marker = null;
  }

  static _candidate(point) {
    const attacker = this._attacker(), scene = canvas.scene;
    if (!attacker || !scene) return null;
    const origin = center(attacker, scene);
    const tolerance = 12 / Math.max(0.1, canvas.stage.scale.x);
    const candidates = scene.walls.contents.filter(wall => physical(wall, attacker) && (game.user.isGM || wall.door !== CONST.WALL_DOOR_TYPES.SECRET))
      .map(wall => ({ wall, point: projection(point, wall) }))
      .filter(candidate => Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y) <= tolerance)
      .sort((a, b) => Math.hypot(a.point.x - point.x, a.point.y - point.y) - Math.hypot(b.point.x - point.x, b.point.y - point.y));
    for (const candidate of candidates) {
      const hit = findFirstWallIntersection(origin, candidate.point, scene.walls.contents, { isBlocking: wall => physical(wall, attacker) });
      if (hit?.wallId !== candidate.wall.id) continue;
      const distance = Math.hypot(hit.x - origin.x, hit.y - origin.y);
      const near = { x: hit.x + (origin.x - hit.x) / Math.max(1, distance) * 2, y: hit.y + (origin.y - hit.y) / Math.max(1, distance) * 2 };
      if (!game.user.isGM && !canvas.visibility.testVisibility(near, { tolerance: 0, object: attacker })) continue;
      return { sceneId: scene.id, attackerId: attacker.id, wallId: candidate.wall.id, impact: { x: hit.x, y: hit.y }, attackerShape: shape(attacker), wallCoordinates: [...candidate.wall.c] };
    }
    return null;
  }

  static _draw(candidate) {
    this._marker?.destroy(); this._marker = null;
    if (!candidate) return;
    const wall = canvas.scene.walls.get(candidate.wallId);
    if (!wall) return;
    const cover = wall.getFlag(ID, "cover") ?? { max: 1 };
    const section = this._cover._section(wall, candidate.impact, cover, canvas.scene);
    const [x, y, x2, y2] = wall.c;
    const length = Math.hypot(x2 - x, y2 - y);
    const dx = (x2 - x) / length * section.length / 2, dy = (y2 - y) / length * section.length / 2;
    const marker = new PIXI.Graphics();
    marker.eventMode = "none";
    marker.lineStyle(4 / canvas.stage.scale.x, 0x67dedb, 0.95).moveTo(section.center.x - dx, section.center.y - dy).lineTo(section.center.x + dx, section.center.y + dy);
    const radius = 7 / canvas.stage.scale.x;
    marker.lineStyle(2 / canvas.stage.scale.x, 0xffffff, 0.9).drawCircle(candidate.impact.x, candidate.impact.y, radius);
    canvas.stage.addChild(marker); this._marker = marker;
  }

  static _range(scene, attacker, activity, point) {
    const token = attacker.document ?? attacker, size = Number(scene.grid.size) || 100;
    const start = { x: Math.max(token.x, Math.min(point.x, token.x + token.width * size)), y: Math.max(token.y, Math.min(point.y, token.y + token.height * size)) };
    const distanceFeet = Math.hypot(point.x - start.x, point.y - start.y) / getFiveFootPixels(scene) * 5;
    // Prepared activity ranges promote normal range to long range in D&D5e 6.
    // The usage contract retains the original normal/long distinction.
    const range = activity.range?.override ? activity.toObject().range : activity.item.system.range;
    const unit = range.units || "ft";
    const conversion = { ft: 1, m: 1 / 0.3048, mi: 5280, km: 1000 / 0.3048, touch: 1 }[unit];
    if (conversion === undefined) throw new Error("This weapon needs a distance or reach before it can attack a wall.");
    const melee = activity.actionType === "mwak";
    const normalValue = melee ? range.reach || range.value || 5 : range.value;
    const normal = typeof normalValue === "string"
      ? new Roll(normalValue, activity.getRollData()).evaluateSync().total : Number(normalValue);
    const long = melee ? 0 : Number(range.long || 0);
    if (!Number.isFinite(normal) || normal <= 0 || distanceFeet > Math.max(normal, long) * conversion + 1e-7) throw new Error("The wall section is outside this weapon's range or reach.");
    return { distance: distanceFeet, disadvantage: !melee && distanceFeet > normal * conversion + 1e-7 };
  }

  static async _use(activity, usage, dialog, message) {
    const selected = copy(this._selection), scene = game.scenes.get(selected.sceneId);
    const attacker = scene?.tokens.get(selected.attackerId);
    if (!attacker || activity.actor?.uuid !== attacker.actor?.uuid || !attacker.actor.isOwner) throw new Error("Use a weapon belonging to the selected attacking character.");
    const checked = this.resolveRecord({ scene, attacker, activity, record: selected });
    const range = this._range(scene, attacker, activity, checked.current.impact);
    const wall = scene.walls.get(selected.wallId);
    const record = { ...selected, targetAC: Number(wall.getFlag(ID, "cover")?.ac ?? 10) };
    const item = activity.item.clone({}, { keepId: true });
    item.updateSource({ [`system.activities.${activity.id}.attackRollPerTarget`]: "never" });
    const cloned = item.system.activities.get(activity.id);
    const next = { ...usage, midiOptions: { ...usage.midiOptions,
      proceedChecks: { ...usage.midiOptions?.proceedChecks, checkTargets: false },
      workflowOptions: { ...usage.midiOptions?.workflowOptions, targetConfirmation: "none", preSelectedTargetUuids: [],
        hardwipeDirectWall: { sceneId: scene.id, attackerId: attacker.id, itemUuid: activity.item.uuid, activityId: activity.id, longRange: range.disadvantage, record } }
    } };
    canvas.tokens.setTargets([]);
    this.clear();
    return cloned.use(next, dialog, message);
  }

  static _preTargeting({ workflow, usage }) {
    const state = usage?.midiOptions?.workflowOptions?.hardwipeDirectWall;
    if (!state) return;
    try {
      const scene = game.scenes.get(state.sceneId), attacker = scene?.tokens.get(state.attackerId);
      if (!supported(workflow.activity) || !attacker?.actor?.isOwner || workflow.actor?.uuid !== attacker.actor.uuid) throw new Error("The attacking weapon or character could not be verified.");
      this.resolveRecord({ scene, attacker, activity: workflow.activity, record: state.record });
      usage.midiOptions.proceedChecks = { ...usage.midiOptions.proceedChecks, checkTargets: false };
      workflow.hardwipeDirectWall = copy(state);
      workflow.setTargets(new Set());
      canvas.tokens.setTargets([]);
    } catch (error) { this._report(error); return false; }
  }

  static async _onAttack(workflow) {
    const direct = workflow.hardwipeDirectWall;
    const message = game.messages.get(workflow.itemCardId);
    if (!direct || !workflow.attackRoll || !message) return;
    const record = { ...copy(direct.record), attackTotal: Number(workflow.attackRoll.total) };
    const die = natural(workflow.attackRoll);
    const naturalCritical = Number(die) >= Number(workflow.attackRoll.options?.criticalSuccess ?? 20);
    const hit = die !== 1 && (naturalCritical || record.attackTotal >= record.targetAC);
    const state = { ...copy(direct), version: 1, mode: "direct", workflowId: message.uuid, records: [record], targets: [], attackRoll: workflow.attackRoll.toJSON(), hit, pending: false };
    await message.setFlag(ID, FLAG, state);
    if (!hit) ui.notifications.info("The attack missed the wall. No wall damage was proposed.");
  }

  static async _onDamage(workflow) {
    const message = game.messages.get(workflow.itemCardId);
    if (!workflow.hardwipeDirectWall || !message) return;
    const state = message.getFlag(ID, FLAG);
    if (!state?.hit || state.reviewPosted || message.author.id !== game.user.id) return;
    const rolls = workflow.damageRolls ?? [], damage = this._cover._sumDamage(rolls);
    if (!damage) return;
    await workflow.displayDamageRolls();
    await workflow.performThrottledUpdate(message, {}, true);
    const next = { ...state, damageRolls: rolls.map(roll => roll.toJSON()), damageReady: true, pending: true,
      wallStates: this._cover._snapshotWallStates(game.scenes.get(state.sceneId), state.records) };
    await message.setFlag(ID, FLAG, next);
    const scene = game.scenes.get(state.sceneId), wall = scene?.walls.get(state.records[0].wallId);
    const material = wall?.getFlag(ID, "cover");
    if (!wall) return;
    let impact = { target: "Wall", direct: true, indestructible: true };
    if (Number(material?.max) > 0) {
      const section = this._cover._section(wall, state.records[0].impact, material, scene), assessed = evaluateWallDamage(damage, material);
      impact = { target: "Wall", direct: true, material: material.material, section: Number(section.key) + 1, ...assessed, before: section.hp, after: Math.max(0, section.hp - assessed.applied), max: Number(material.max) };
    }
    const review = await ChatMessage.create({
      content: this._cover._wallCard("review", { attacker: message.alias || message.author.name, weapon: workflow.item.name, impacts: [impact] }),
      whisper: game.users.contents.filter(user => user.isGM).map(user => user.id),
      flags: { [ID]: { coverReview: { sourceMessageId: message.id } } }
    });
    await message.setFlag(ID, FLAG, { ...message.getFlag(ID, FLAG), reviewPosted: true, reviewMessageId: review.id });
  }

  static resolveRecord({ scene, attacker, activity, record }) {
    if (!scene || canvas.scene?.id !== scene.id || !attacker || !supported(activity)) throw new Error("The wall attack scene or weapon is unavailable.");
    if (record.attackerShape && stringify(shape(attacker)) !== stringify(record.attackerShape)) throw new Error("The attacker moved after selecting the wall.");
    if (![record.impact?.x, record.impact?.y].every(Number.isFinite)) throw new Error("The wall impact point is invalid.");
    const wall = scene.walls.get(record.wallId);
    if (!wall || !physical(wall, attacker) || stringify(wall.c) !== stringify(record.wallCoordinates)) throw new Error("The targeted wall changed after the attack.");
    const hit = findFirstWallIntersection(center(attacker, scene), record.impact, scene.walls.contents, { isBlocking: candidate => physical(candidate, attacker) });
    if (hit?.wallId !== wall.id || Math.hypot(hit.x - record.impact.x, hit.y - record.impact.y) > 0.01) throw new Error("Another wall blocks this attack or the impact is outside the selected wall.");
    this._range(scene, attacker, activity, hit);
    return { target: { name: "Wall" }, current: { impact: { wallId: hit.wallId, x: hit.x, y: hit.y } } };
  }

  static verifyCard(message) {
    const state = message.getFlag(ID, FLAG), author = message.author;
    if (state?.version !== 1 || state.mode !== "direct" || !state.damageReady || state.workflowId !== message.uuid || state.records?.length !== 1) throw new Error("The originating card has no completed direct wall attack.");
    const scene = game.scenes.get(state.sceneId), attacker = scene?.tokens.get(state.attackerId);
    const itemUuid = message.system?.item?.uuid ?? message.flags?.dnd5e?.item?.uuid;
    const item = itemUuid ? fromUuidSync(itemUuid) : null, activity = item?.system.activities.get(state.activityId);
    const activityUuid = message.system?.activity?.uuid ?? message.flags?.["midi-qol"]?.activityUuid;
    if (!author || !attacker?.actor || !attacker.actor.testUserPermission(author, "OWNER") || itemUuid !== state.itemUuid || item?.actor?.uuid !== attacker.actor.uuid || !supported(activity) || (activityUuid && activityUuid !== activity.uuid)) throw new Error("The originating author, character, or weapon activity could not be verified.");
    if (message.speaker.scene !== scene.id || message.speaker.token !== attacker.id || (message.system?.targets?.length ?? 0) !== 0) throw new Error("The originating wall attack has a different speaker or creature targets.");
    const fromData = value => this._cover._rollFromData(value);
    const signature = value => stringify(coverRollSignatureData(fromData(value)?.toJSON()));
    const attack = fromData(message.flags?.["midi-qol"]?.attackRoll), canonical = message.rolls ?? [];
    if (!attack?._evaluated || !Number.isFinite(attack.total) || signature(state.attackRoll) !== signature(attack) || !canonical.some(roll => signature(roll) === signature(attack))) throw new Error("The direct wall attack does not match its canonical attack roll.");
    const damages = canonical.filter(roll => roll.options?.["midi-qol"]?.rollType === "defaultDamage");
    if (!damages.length || damages.some(roll => !roll._evaluated) || stringify((state.damageRolls ?? []).map(signature)) !== stringify(damages.map(signature))) throw new Error("The direct wall attack does not match its canonical damage rolls.");
    const record = state.records[0], wall = scene.walls.get(record.wallId), ac = Number(wall?.getFlag(ID, "cover")?.ac ?? 10);
    if (!author.isGM && wall?.door === CONST.WALL_DOOR_TYPES.SECRET) throw new Error("Players cannot target a hidden secret door directly.");
    const isCritical = Number(natural(attack)) >= Number(attack.options?.criticalSuccess ?? 20);
    if (natural(attack) === 1 || (attack.total < ac && !isCritical) || record.targetAC !== ac || record.attackTotal !== attack.total) throw new Error("The originating attack did not hit this wall's current AC.");
    this.resolveRecord({ scene, attacker, activity, record });
    const damage = this._cover._sumDamage(damages);
    if (!damage) throw new Error("The originating weapon has no positive damage.");
    return { workflowId: state.workflowId, scene, attacker, activity, records: [record], damage, message, direct: true };
  }

  static _report(error) { ui.notifications.error(error.message || String(error)); console.error("Hardwipe | wall targeting", error); }
}

