import { getFiveFootPixels } from "./hardwipe-cover-geometry.js";
import { coverRollSignatureData } from "./hardwipe-cover-rolls.js";
import { WallAppearance } from "./hardwipe-wall-appearance.js";
import { areaWallDamageMultiplier, areaWallRemainders, assessAreaWallDamage, exposedAreaWallSections } from "./hardwipe-area-wall-geometry.js";

const ID = "hardwipe-ruleset";
const STATE = "coverAttack";
const HISTORY = "coverHistory";
const LEDGER = "coverDamageLedger";
const clone = value => foundry.utils.deepClone(value);
const stable = value => {
  if (value instanceof Set) return stable([...value].sort());
  if (Array.isArray(value)) return `[${value.map(entry => stable(entry) ?? "null").join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const escape = value => foundry.utils.escapeHTML(String(value ?? ""));
const levelsOf = document => [...(document.levels ?? [])].sort();

function digest(value) {
  // A consistency receipt, not an authentication primitive: verification also
  // compares all canonical roll, area and wall data. This works on Foundry LAN
  // HTTP clients, where the browser deliberately withholds crypto.subtle.
  const text = stable(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Area damage proposals use the existing GM-only cover review and atomic wall mutation pipeline. */
export class AreaWallManager {
  static _initialized = false;
  static _cover;
  static _proposals = new Set();

  static initialize({ cover }) {
    if (this._initialized) return;
    this._initialized = true;
    this._cover = cover;
    Hooks.on("midi-qol.DamageRollComplete", workflow => this.onDamage(workflow).catch(error => cover._report(error)));
  }

  static _regionUuids(midi) {
    return [...new Set([...(Array.isArray(midi.templateUuids) ? midi.templateUuids : []), midi.templateUuid].filter(value => typeof value === "string" && value))].sort();
  }

  static _rolls(message) {
    return (message.rolls ?? []).filter(roll => roll.options?.["midi-qol"]?.rollType === "defaultDamage");
  }

  static _rollData(rolls) {
    return rolls.map(roll => coverRollSignatureData(roll.toJSON()));
  }

  static _source(message) {
    const midi = message.flags?.["midi-qol"] ?? {};
    const itemUuid = message.system?.item?.uuid ?? message.flags?.dnd5e?.item?.uuid;
    const item = itemUuid ? fromUuidSync(itemUuid) : null;
    const activityUuid = message.system?.activity?.uuid ?? midi.activityUuid;
    const activity = activityUuid ? fromUuidSync(activityUuid) : null;
    const scene = game.scenes.get(message.speaker?.scene);
    const attacker = scene?.tokens.get(message.speaker?.token);
    if (!scene || !attacker?.actor || !item?.actor || !activity || activity.item?.uuid !== item.uuid
      || item.actor.uuid !== attacker.actor.uuid || !message.author || !attacker.actor.testUserPermission(message.author, "OWNER")) {
      throw new Error("The originating area author, scene token, item, or activity could not be verified.");
    }
    const regionUuids = this._regionUuids(midi);
    if (!regionUuids.length || regionUuids.length > 32) throw new Error("The originating area has no valid placed Region.");
    const regions = regionUuids.map(uuid => {
      const region = fromUuidSync(uuid);
      if (!region || region.documentName !== "Region" || region.parent?.id !== scene.id
        || !region.testUserPermission(message.author, "OWNER")) throw new Error("An originating area Region is unavailable or belongs to another scene or author.");
      const dnd = region.flags?.dnd5e ?? {};
      const origin = dnd.origin;
      const regionMidi = region.flags?.["midi-qol"] ?? {};
      // Native D&D5e 6 Region placement records the casting Token as origin,
      // with item and activity UUIDs in separate flags. Older template paths
      // use an item/activity origin; any accompanying identity flags must
      // still match the originating chat card.
      const nativeOrigin = origin === attacker.uuid && dnd.item === item.uuid && dnd.activity === activity.uuid;
      const legacyOrigin = [item.uuid, activity.uuid].includes(origin)
        && (!dnd.item || dnd.item === item.uuid) && (!dnd.activity || dnd.activity === activity.uuid);
      if ((!nativeOrigin && !legacyOrigin) || (regionMidi.itemUuid && regionMidi.itemUuid !== item.uuid)
        || (regionMidi.actorUuid && regionMidi.actorUuid !== attacker.actor.uuid)) throw new Error("An area Region does not originate from this item and actor.");
      return region;
    });
    return { scene, attacker, item, activity, regions, regionUuids };
  }

  static _geometry(source) {
    const compute = game.hardwipe?.regions?.computeRegionGeometry;
    if (typeof compute !== "function") throw new Error("The Hardwipe Wall Effects geometry service is unavailable. No wall damage was applied.");
    if (canvas.scene?.id !== source.scene.id) throw new Error("Open the originating scene before reviewing this area wall impact.");
    const regions = source.regions.map(region => ({ ...compute(region), levels: levelsOf(region),
      damageMultiplier: areaWallDamageMultiplier(region.flags?.["walled-regions"]) }));
    const walls = source.scene.walls.contents.map(wall => ({ ...wall.toObject(), id: wall.id }));
    const levelRanges = Object.fromEntries((source.scene.levels?.contents ?? []).map(level => [level.id, { bottom: level.bottom, top: level.top }]));
    const records = exposedAreaWallSections({ regions, walls, levelRanges, sectionPixels: getFiveFootPixels(source.scene) });
    return { regions, records };
  }

  static _snapshot(source, regions) {
    // The source area and ALL physical walls are captured before any breach. A
    // later opening or blocker edit invalidates the whole proposal rather than
    // expanding the blast or applying only the still-convenient pieces.
    return {
      grid: { size: source.scene.grid?.size, distance: source.scene.grid?.distance, units: source.scene.grid?.units },
      levels: (source.scene.levels?.contents ?? []).map(level => ({ id: level.id, bottom: level.bottom, top: level.top })).sort((a, b) => a.id.localeCompare(b.id)),
      regions: source.regions.map((region, index) => ({ uuid: region.uuid, shapes: clone(region.toObject().shapes),
        elevation: clone(region.toObject().elevation), levels: levelsOf(region), attachment: clone(region.toObject().attachment),
        wallEffects: clone(region.flags?.["walled-regions"] ?? {}), origin: region.flags?.dnd5e?.origin,
        sourceShapes: clone(regions[index].sourceShapes), sourceAreas: clone(regions[index].sourceAreas),
        originPoint: clone(regions[index].origin), damageMultiplier: regions[index].damageMultiplier })),
      walls: source.scene.walls.contents.filter(wall => !wall.getFlag(ID, "wallWear")).map(wall => ({ id: wall.id,
        ...Object.fromEntries(["c", "dir", "door", "ds", "levels", "threshold", "sight", "light", "move", "sound"].map(key => [key, clone(key === "levels" ? levelsOf(wall) : wall[key])])),
        cover: clone(wall.getFlag(ID, "cover") ?? null) })).sort((a, b) => a.id.localeCompare(b.id))
    };
  }

  static async onDamage(workflow) {
    if (!this._cover?._enabled() || !workflow?.itemCardId || workflow.hardwipeDirectWall) return;
    const message = game.messages.get(workflow.itemCardId);
    if (!message || message.author?.id !== game.user.id || this._proposals.has(message.id)) return;
    const regionUuids = this._regionUuids(workflow);
    if (!regionUuids.length) return;
    const affecting = regionUuids.some(uuid => areaWallDamageMultiplier(fromUuidSync(uuid)?.flags?.["walled-regions"]));
    if (!affecting) return;
    // A resolved cast is immutable. A damage reroll invalidates its old proposal
    // during verification; it cannot silently create a second structural hit.
    if (message.getFlag(ID, STATE)?.mode === "area") return;
    this._proposals.add(message.id);
    try {
      await workflow.displayDamageRolls();
      await workflow.performThrottledUpdate(message, {}, true);
      const canonical = game.messages.get(message.id);
      const source = this._source(canonical);
      const rolls = this._rolls(canonical);
      if (!rolls.length || rolls.some(roll => !roll._evaluated || !Number.isFinite(roll.total))) throw new Error("The area card has no completed damage rolls.");
      if (stable(this._rollData(rolls)) !== stable(this._rollData(workflow.damageRolls ?? []))) throw new Error("The area damage has not reached its originating chat card.");
      const damage = this._cover._sumDamage(rolls);
      if (damage <= 0) return;
      const { regions, records } = this._geometry(source);
      if (!records.length) return;
      const snapshot = this._snapshot(source, regions), damageRolls = this._rollData(rolls);
      const state = { version: 2, mode: "area", workflowId: canonical.uuid, sceneId: source.scene.id, attackerId: source.attacker.id,
        itemUuid: source.item.uuid, activityId: source.activity.id, activityUuid: source.activity.uuid, regionUuids: source.regionUuids,
        records, damageRolls, snapshot, hash: await digest({ damageRolls, snapshot, records }),
        damageReady: true, pending: true, reviewPosted: false };
      await canonical.setFlag(ID, STATE, state);
      const impacts = this._impacts({ ...source, records, damage });
      const review = await ChatMessage.create({
        content: this._card("review", { attacker: canonical.alias || canonical.author.name, weapon: source.item.name, impacts, damage }),
        whisper: game.users.contents.filter(user => user.isGM).map(user => user.id),
        flags: { [ID]: { coverReview: { sourceMessageId: canonical.id } } }
      });
      await canonical.setFlag(ID, STATE, { ...canonical.getFlag(ID, STATE), reviewPosted: true, reviewMessageId: review.id });
      if (!game.users.activeGM) ui.notifications.warn("Wall damage is waiting for GM review. No wall HP or geometry has changed.");
    } finally { this._proposals.delete(message.id); }
  }

  static async verifyCard(message) {
    const state = message.getFlag(ID, STATE);
    if (state?.version !== 2 || state.mode !== "area" || !state.pending || !state.damageReady || state.workflowId !== message.uuid
      || !Array.isArray(state.records) || !Array.isArray(state.regionUuids)) throw new Error("The originating card has no pending area wall proposal.");
    const source = this._source(message);
    if (state.sceneId !== source.scene.id || state.attackerId !== source.attacker.id || state.itemUuid !== source.item.uuid
      || state.activityId !== source.activity.id || state.activityUuid !== source.activity.uuid || stable(state.regionUuids) !== stable(source.regionUuids)) {
      throw new Error("The area wall request no longer matches its originating item, activity, speaker, or Regions.");
    }
    const rolls = this._rolls(message);
    if (!rolls.length || rolls.some(roll => !roll._evaluated || !Number.isFinite(roll.total))) throw new Error("The originating area has no completed damage rolls.");
    const damageRolls = this._rollData(rolls);
    if (stable(damageRolls) !== stable(state.damageRolls)) throw new Error("Area damage changed after this proposal. Ignore the old card and cast again.");
    const { regions, records } = this._geometry(source);
    const snapshot = this._snapshot(source, regions);
    if (stable(snapshot) !== stable(state.snapshot) || stable(records) !== stable(state.records)
      || await digest({ damageRolls, snapshot, records }) !== state.hash) {
      throw new Error("Area geometry, wall durability, or Wall Effects settings changed after this proposal. Ignore the old card and cast again.");
    }
    const ledger = source.scene.getFlag(ID, LEDGER) ?? [];
    if (ledger.some(entry => entry.key === `${state.workflowId}:area`)) throw new Error("This area's wall damage was already applied.");
    const damage = this._cover._sumDamage(rolls);
    if (damage <= 0) throw new Error("The originating area has no positive damage.");
    return { ...source, workflowId: state.workflowId, records, damage, message, area: true };
  }

  static _impacts({ scene, records, damage }) {
    return records.map(record => {
      const wall = scene.walls.get(record.wallId), material = wall?.getFlag(ID, "cover");
      if (!material || material.ballistic === false || !Number.isFinite(Number(material.max)) || Number(material.max) <= 0) {
        return { direct: true, target: wall?.id, indestructible: true, multiplier: record.multiplier };
      }
      const section = this._cover._section(wall, record.impact, material, scene);
      if (section.key !== record.section) throw new Error("The area selected an inconsistent wall section.");
      const assessed = assessAreaWallDamage(damage, record.multiplier, material);
      return { direct: true, target: wall.id, material: material.material, section: Number(section.key) + 1, ...assessed,
        before: section.hp, after: Math.max(0, section.hp - assessed.applied), max: Number(material.max) };
    });
  }

  static _card(kind, { attacker, weapon, impacts, damage }) {
    // Group presentation only. Per-section records, approval validation,
    // damage, receipts, and breach planning remain independent underneath.
    const grouped = new Map();
    for (const impact of impacts) {
      const { section, ...shared } = impact;
      // target is the original wall ID, so different walls and any different
      // HP, threshold, armor, multiplier, or damage calculation stay separate.
      const key = stable(shared);
      const entry = grouped.get(key) ?? { ...shared, area: true, sections: [], sectionCount: 0 };
      if (Number.isInteger(section) && section > 0) entry.sections.push(section);
      entry.sectionCount++;
      grouped.set(key, entry);
    }
    const presentation = [...grouped.values()].map(impact => ({ ...impact, sections: impact.sections.sort((a, b) => a - b) }));
    const content = this._cover._wallCard(kind, { attacker, weapon, impacts: presentation });
    const multipliers = [...new Set(impacts.map(impact => impact.multiplier))];
    const label = multipliers.length === 1 ? (multipliers[0] === 0.5 ? "Half wall damage" : "Normal wall damage") : "Configured wall damage per area";
    const explanation = `<div class="hardwipe-chat-meta">${escape(label)} · Original roll ${escape(damage)} · Round down, then threshold and armor. Walls make no save.</div>`;
    return content.replace(/(<div class="hardwipe-wall-impact)/, `${explanation}$1`);
  }

  static async applyRecords(context) {
    this._cover._requireGM();
    if (game.user.id !== game.users.activeGM?.id) throw new Error("The active GM must resolve area wall damage.");
    const { scene, records, workflowId, damage, message, attacker, item } = context;
    const receiptKey = `${workflowId}:area`, ledger = clone(scene.getFlag(ID, LEDGER) ?? []);
    if (ledger.some(entry => entry.key === receiptKey)) return false;
    const impacts = this._impacts(context);
    const groups = new Map();
    records.forEach((record, index) => {
      const group = groups.get(record.wallId) ?? [];
      group.push({ record, impact: impacts[index] });
      groups.set(record.wallId, group);
    });
    const appearance = { before: { walls: [], tiles: [] }, after: { walls: [], tiles: [] } };
    let breached = false;
    for (const [wallId, group] of groups) {
      const wall = scene.walls.get(wallId), material = wall?.getFlag(ID, "cover");
      if (!wall) throw new Error("An affected wall is unavailable. No area wall damage was applied.");
      for (const { record, impact } of group) ledger.push({ key: `${receiptKey}:${wallId}:${record.section}`, at: Date.now(), wallId,
        section: record.section, damage: impact.applied ?? 0, multiplier: record.multiplier });
      if (!group.some(entry => (entry.impact.applied ?? 0) > 0)) continue;
      const original = wall.toObject(), cover = clone(material), breaches = [];
      cover.sections = clone(cover.sections ?? {});
      for (const { record, impact } of group) {
        if (!(impact.applied > 0)) continue;
        Object.assign(cover, clone(record.metadata));
        cover.sections[record.section] = { ...clone(cover.sections[record.section] ?? {}), hp: impact.after, max: Number(cover.max),
          impact: clone(cover.sections[record.section]?.impact ?? record.impact) };
        if (impact.after <= 0) { breaches.push(record); delete cover.sections[record.section]; }
      }
      let plan;
      if (!breaches.length) plan = WallAppearance.plan(scene, original, cover);
      else {
        breached = true;
        const owned = WallAppearance.owned(scene, wall.id);
        WallAppearance.assertOwnedUnchanged(owned, material);
        const base = WallAppearance.base(original, material), after = { walls: [], tiles: [] };
        delete cover.wear;
        for (const coordinates of areaWallRemainders(base.c, breaches)) {
          const remainder = clone(base);
          remainder._id = foundry.utils.randomID();
          remainder.c = coordinates.map(Math.round);
          if (remainder.c[0] === remainder.c[2] && remainder.c[1] === remainder.c[3]) continue;
          remainder.flags ??= {};
          remainder.flags[ID] ??= {};
          remainder.flags[ID].cover = clone(cover);
          const child = WallAppearance.plan(scene, new CONFIG.Wall.documentClass(remainder, { parent: scene }).toObject(), cover);
          after.walls.push(...child.after.walls);
          after.tiles.push(...child.after.tiles);
        }
        plan = { before: { walls: [original, ...owned.walls], tiles: owned.tiles }, after };
      }
      for (const phase of ["before", "after"]) for (const name of ["walls", "tiles"]) appearance[phase][name].push(...plan[phase][name]);
    }
    ledger.push({ key: receiptKey, at: Date.now(), sourceMessageId: message.id, damage, sections: records.length });
    const sceneUpdate = { _id: scene.id, [`flags.${ID}.${LEDGER}`]: ledger };
    if (appearance.before.walls.length) sceneUpdate[`flags.${ID}.${HISTORY}`] = [...clone(scene.getFlag(ID, HISTORY) ?? []), {
      version: 2, id: foundry.utils.randomID(), at: Date.now(), userId: game.user.id, workflowId, ledgerKey: receiptKey, ...clone(appearance)
    }].slice(-20);
    // Every section was assessed against the original scene. One native batch
    // commits all remainders, damage visuals, section HP, history and receipt.
    const operations = WallAppearance.operations(scene, appearance);
    operations.push({ action: "update", documentName: "Scene", updates: [sceneUpdate] });
    await this._cover._batch(operations);
    try {
      await this._cover._announce(this._card(breached ? "breach" : impacts.some(impact => impact.applied > 0) ? "hit" : "held", {
        attacker: attacker.name, weapon: item.name, impacts, damage
      }), scene, message);
    } catch (error) {
      // The native batch already committed. An announcement error must not
      // leave a successfully applied card looking available for another hit.
      console.error(`${ID} | Area wall result announcement failed`, error);
      ui.notifications.warn("Wall damage was applied, but its result card could not be posted.");
    }
    return true;
  }
}
