import { MODULE_ID } from "./hardwipe-state.js";
import { CYBERWARE_SLOTS } from "./hardwipe-cyberware.js";

/**
 * World data upgrades. Hardwipe's flags carry version fields and every reader tolerates old shapes; this runner
 * brings the stored data itself up to date, once, so later code can rely on it. It runs on the active GM's client
 * at ready, for every step newer than the world's recorded version (`migrationVersion`, a hidden world setting),
 * then records the module version. Steps are idempotent: a world already in shape changes nothing, and a step
 * that fails stops the run and is retried at the next load. `game.hardwipe.migrate({ force: true })` runs every
 * step again by hand. Compendium packs are never touched.
 *
 * The planners are plain data in, update data out, so the unit tests cover them without Foundry.
 */
export const SETTING = "migrationVersion";
const DEFAULT_SHIELD_HP = 10;

/* Planners (unit-tested) ---------------------------------------------------------------------------- */

/** Compare dotted version strings numerically: -1, 0 or 1. Missing parts read as 0, non-numbers as 0. */
export function compareVersions(a, b) {
  const parse = value => String(value ?? "").split(".").map(part => Number.parseInt(part, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let index = 0; index < Math.max(x.length, y.length); index++) {
    const delta = (x[index] ?? 0) - (y[index] ?? 0);
    if (delta) return Math.sign(delta);
  }
  return 0;
}

/** The steps newer than the world's recorded version, oldest version first, in list order within a version. */
export function pendingMigrations(list, installed) {
  return (list ?? []).map((step, index) => ({ step, index }))
    .filter(({ step }) => compareVersions(step.version, installed) > 0)
    .sort((a, b) => compareVersions(a.step.version, b.step.version) || a.index - b.index)
    .map(({ step }) => step);
}

/** A shield with Hardwipe HP but no stored maximum: write the maximum every shield had before, so it is explicit. */
export function planShieldMax(item, fallback = DEFAULT_SHIELD_HP) {
  if (item?.type !== "equipment" || item.system?.type?.value !== "shield") return null;
  const shield = item.flags?.[MODULE_ID]?.shield;
  if (!shield || typeof shield !== "object") return null;
  const max = Math.trunc(Number(shield.max));
  if (Number.isFinite(max) && max >= 1) return null;
  return { _id: item._id, [`flags.${MODULE_ID}.shield.max`]: fallback };
}

/**
 * A cyberware item without its state flag (made while Hardwipe was off): give it the carried state its sheet
 * already assumes, and clear the equip and attunement fields the way a new cyberware item gets them.
 */
export function planCyberwareFlags(item, slotTypes) {
  if (item?.type !== "equipment" || !slotTypes?.has?.(item.system?.type?.value)) return null;
  const flags = item.flags?.[MODULE_ID]?.cyberware;
  if (flags && typeof flags === "object" && "installed" in flags) return null;
  return {
    _id: item._id, "system.equipped": false, "system.attunement": "", "system.attuned": false,
    [`flags.${MODULE_ID}.cyberware`]: {
      ...(flags && typeof flags === "object" ? flags : {}),
      version: 1, installed: false, disabled: flags?.disabled === true, damaged: flags?.damaged === true, pending: null
    }
  };
}

/** Roll Tracker sessions filed before sessions had an end: end them at their last roll. Null when nothing changes. */
export function planSessionEnds(sessions) {
  if (!Array.isArray(sessions)) return null;
  let changed = 0;
  const next = sessions.map(session => {
    if (!session?.id || (session.end !== null && session.end !== undefined)) return session;
    changed++;
    return { ...session, end: session.last ?? session.start ?? 0 };
  });
  return changed ? { sessions: next, changed } : null;
}

/* Steps ---------------------------------------------------------------------------------------------- */

export const MIGRATIONS = Object.freeze([
  { version: "0.7.49", key: "shield-max", run: () => updateItems(item => planShieldMax(item)) },
  { version: "0.7.49", key: "cyberware-flags", run: () => updateItems(item => planCyberwareFlags(item, new Set(CYBERWARE_SLOTS.map(slot => slot.type)))) },
  { version: "0.7.49", key: "roll-tracker-ends", run: () => migrateRollTrackerEnds() }
]);

/** World actors and the synthetic actors of unlinked tokens on every scene. */
function* allActors() {
  for (const actor of game.actors ?? []) yield actor;
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) if (!token.actorLink && token.actor) yield token.actor;
  }
}

/** Apply an item planner to world items and every actor's items; the number of items changed. */
async function updateItems(plan) {
  let changed = 0;
  for (const item of game.items ?? []) {
    const update = plan(item.toObject());
    if (!update) continue;
    const { _id, ...data } = update;
    await item.update(data, { hardwipeMigration: true });
    changed++;
  }
  for (const actor of allActors()) {
    const updates = [];
    for (const item of actor.items ?? []) {
      const update = plan(item.toObject());
      if (update) updates.push(update);
    }
    if (!updates.length) continue;
    await actor.updateEmbeddedDocuments("Item", updates, { hardwipeMigration: true });
    changed += updates.length;
  }
  return changed;
}

async function migrateRollTrackerEnds() {
  const value = game.settings.get(MODULE_ID, "rollTrackerArchive");
  const plan = planSessionEnds(value?.sessions);
  if (!plan) return 0;
  await game.settings.set(MODULE_ID, "rollTrackerArchive", { ...value, sessions: plan.sessions });
  return plan.changed;
}

/* Runner ---------------------------------------------------------------------------------------------- */

export function registerMigrations() {
  if (game.settings.settings.has(`${MODULE_ID}.${SETTING}`)) return;
  game.settings.register(MODULE_ID, SETTING, { scope: "world", config: false, type: String, default: "" });
}

/**
 * Run the steps the world still needs. The active GM only; other clients return null. The recorded version
 * advances only once every step of that version has succeeded, so a failed step is retried next time.
 * @returns {Promise<{version: string, steps: string[], changed: number, failed: string|null}|null>}
 */
export async function runMigrations({ force = false } = {}) {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return null;
  const current = String(game.modules.get(MODULE_ID)?.version ?? "0.0.0");
  const installed = force ? "" : String(game.settings.get(MODULE_ID, SETTING) ?? "");
  const steps = pendingMigrations(MIGRATIONS, installed);
  const result = { version: installed, steps: [], changed: 0, failed: null };
  const record = async version => {
    if (compareVersions(version, result.version) <= 0) return;
    await game.settings.set(MODULE_ID, SETTING, version);
    result.version = version;
  };
  for (const [index, step] of steps.entries()) {
    try {
      const changed = Number(await step.run()) || 0;
      result.changed += changed;
      result.steps.push(step.key);
      console.log(`${MODULE_ID} | Migration ${step.version} ${step.key}: ${changed} changed`);
    } catch (error) {
      result.failed = step.key;
      console.error(`${MODULE_ID} | Migration ${step.version} ${step.key} failed`, error);
      ui.notifications.error(game.i18n.format("HARDWIPE.Migrations.Failed", { version: step.version, step: step.key, error: error.message ?? String(error) }), { permanent: true });
      return result;
    }
    // The last step of a version: that version is done.
    if (steps[index + 1]?.version !== step.version) await record(step.version);
  }
  await record(compareVersions(current, result.version) > 0 ? current : result.version);
  if (steps.length) ui.notifications.info(game.i18n.format("HARDWIPE.Migrations.Done", { version: result.version, changed: result.changed }));
  return result;
}
