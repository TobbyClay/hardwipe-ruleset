/**
 * Memory forms: each participant plays a full temporary copy of an NPC, then gets their character back.
 *
 * The original character and the NPC template are never written. A GM-only recovery journal records the
 * original assignments, token appearance and (through `reality`) the Hardwipe world state before anything
 * changes, so a refresh, a failed write or a disconnect can always be undone from it.
 */
import { MODULE_ID } from "./bd-state.js";

export const FORM_FLAG = "braindanceForm";
export const TOKEN_FLAG = "braindanceToken";
export const RECOVERY_SETTING = "braindanceRecovery";
export const RECOVERY_FLAG = "braindanceRecovery";

// Position, rotation, elevation, visibility and combat membership belong to the ongoing game. Only identity,
// appearance and actor overrides are swapped.
export const TOKEN_FORM_FIELDS = Object.freeze([
  "actorId", "actorLink", "name", "texture", "width", "height", "alpha", "lockRotation",
  "sight", "detectionModes", "light", "ring", "bar1", "bar2", "displayBars", "displayName",
  "disposition", "flags", "delta", "appendNumber", "prependAdjective", "occludable", "turnMarker"
]);
const copy = data => structuredClone(data);
export function tokenFormData(data) {
  return Object.fromEntries(TOKEN_FORM_FIELDS.filter(key => Object.hasOwn(data, key)).map(key => [key, copy(data[key])]));
}

export function remapActorReferences(value, sourceUuid, targetUuid) {
  if (typeof value === "string") return value === sourceUuid ? targetUuid : value.startsWith(`${sourceUuid}.`) ? targetUuid + value.slice(sourceUuid.length) : value;
  if (Array.isArray(value)) return value.map(entry => remapActorReferences(entry, sourceUuid, targetUuid));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, remapActorReferences(entry, sourceUuid, targetUuid)]));
  return value;
}

/** The players a character belongs to: whoever has it assigned, otherwise its non-GM owners. */
export function controllingUsers(actor, users) {
  const players = users.filter(user => !user.isGM);
  const assigned = players.filter(user => user.character?.id === actor.id);
  return assigned.length ? assigned : players.filter(user => actor.testUserPermission(user, "OWNER"));
}

export const memoryFormOf = actor => actor?.getFlag?.(MODULE_ID, FORM_FLAG) ?? null;

export class MemoryForms {
  /**
   * @param {object} deps
   * @param {object} deps.game                Foundry's game (actors, users, scenes, settings, system)
   * @param {Function} deps.resolve           uuid -> document
   * @param {Function} deps.createActor       (data, options) -> Actor
   * @param {Function} deps.createJournal     data -> JournalEntry
   * @param {Function} deps.randomId          () -> 16-character id
   * @param {object} [deps.reality]           { snapshot(): record, rollback(record): Promise }
   * @param {Function} [deps.t]               (key, data) -> localized error text
   */
  constructor({ game, resolve, createActor, createJournal, randomId, reality = null, t = key => key }) {
    Object.assign(this, { game, resolve, createActor, createJournal, randomId, reality, t });
  }

  get reference() { return this.game.settings.get(MODULE_ID, RECOVERY_SETTING) || ""; }
  hasRecovery() { return Boolean(this.reference); }
  allTokens() { return Array.from(this.game.scenes).flatMap(scene => Array.from(scene.tokens)); }
  fail(key, data) { return new Error(this.t(key, data)); }

  async enter(pairings, sessionId) {
    if (this.game.system.id !== "dnd5e") throw this.fail("SystemUnsupported");
    if (this.hasRecovery()) throw this.fail("RecoveryPending");
    const plans = [];
    const assignedUsers = new Set();
    const characters = new Set();
    // Validate every pairing before creating or changing any document.
    for (const pair of pairings) {
      const original = await this.resolve(pair.characterUuid);
      const npc = await this.resolve(pair.npcUuid);
      if (!original || original.documentName !== "Actor" || original.type !== "character" || original.isToken) throw this.fail("ChooseCharacter");
      if (!npc || npc.documentName !== "Actor" || npc.type !== "npc" || npc.isToken) throw this.fail("ChooseNpc");
      if (original.isPolymorphed || npc.isPolymorphed || memoryFormOf(original) || memoryFormOf(npc)) throw this.fail("NestedTransformation");
      if (characters.has(original.uuid)) throw this.fail("DuplicateCharacter");
      characters.add(original.uuid);
      const users = controllingUsers(original, Array.from(this.game.users));
      if (!users.length) throw this.fail("NoPlayer", { name: original.name });
      for (const user of users) {
        if (assignedUsers.has(user.id)) throw this.fail("PlayerTwice", { name: user.name });
        assignedUsers.add(user.id);
      }
      const formId = this.randomId();
      plans.push({
        originalUuid: original.uuid, npcUuid: npc.uuid, formId, formUuid: `Actor.${formId}`,
        users: users.map(user => ({ id: user.id, characterId: user.character?.id ?? null })),
        tokens: this.allTokens().filter(token => token.actorId === original.id).map(token => ({ uuid: token.uuid, data: tokenFormData(token.toObject()) }))
      });
    }
    if (!plans.length) throw this.fail("IncompletePairing");

    // The recovery record lives in a GM-only journal rather than a world setting or actor flag, so it stays out of
    // players' interface (Foundry still sends hidden journals to every client).
    const ledger = { sessionId, plans, reality: this.reality ? await this.reality.snapshot() : null };
    const journal = await this.createJournal({ name: this.t("RecoveryJournal"), ownership: { default: 0 }, pages: [], flags: { [MODULE_ID]: { [RECOVERY_FLAG]: ledger } } });
    try { await this.game.settings.set(MODULE_ID, RECOVERY_SETTING, journal.uuid); }
    catch (error) { await journal.delete(); throw error; }

    try {
      for (const plan of plans) {
        const original = await this.resolve(plan.originalUuid);
        const npc = await this.resolve(plan.npcUuid);
        const data = remapActorReferences(npc.toObject(), npc.uuid, plan.formUuid);
        delete data._stats;
        data._id = plan.formId;
        data.folder = original.folder?.id ?? null;
        data.ownership = { ...original.toObject().ownership };
        for (const user of plan.users) data.ownership[user.id] = 3;
        data.flags ??= {};
        data.flags[MODULE_ID] = { ...data.flags[MODULE_ID], [FORM_FLAG]: { sessionId, originalUuid: plan.originalUuid, npcUuid: plan.npcUuid, originalName: original.name } };
        data.prototypeToken.actorLink = true;
        const form = await this.createActor(data, { keepId: true, keepEmbeddedIds: true, renderSheet: false });
        if (form.id !== plan.formId) throw this.fail("FormIdLost");
        const tokenData = tokenFormData((await form.getTokenDocument()).toObject());
        tokenData.actorId = form.id;
        tokenData.actorLink = true;
        // Linked forms ignore the existing synthetic-actor overrides. Keep the complete delta intact: an empty
        // replacement is invalid in Foundry 14.
        delete tokenData.delta;
        tokenData.flags = { ...tokenData.flags, [MODULE_ID]: { ...tokenData.flags?.[MODULE_ID], [TOKEN_FLAG]: { sessionId, originalUuid: plan.originalUuid } } };
        for (const saved of plan.tokens) {
          const token = await this.resolve(saved.uuid);
          if (!token) continue;
          await token.update(copy(tokenData), { diff: false, recursive: false });
          // Foundry can reject an update without throwing to its caller.
          if (token.actorId !== form.id || !token.actorLink) throw this.fail("TokenTransform", { name: token.name });
        }
        for (const saved of plan.users) await this.game.users.get(saved.id)?.update({ character: form.id });
      }
      return { participantIds: [...assignedUsers], actorUuids: plans.map(plan => plan.formUuid) };
    } catch (error) {
      try { await this.restore({ rollback: false }); }
      catch (restoreError) { throw new Error(`${error.message} ${this.t("RestorePending", { error: restoreError.message })}`); }
      throw error;
    }
  }

  /**
   * Give everyone their characters back and remove the forms. With `rollback`, the Hardwipe world state recorded
   * at Enter memory is restored as well. Safe to retry: every step checks what is already done.
   */
  async restore({ rollback = false } = {}) {
    if (!this.reference) return;
    const journal = await this.resolve(this.reference);
    const ledger = journal?.getFlag(MODULE_ID, RECOVERY_FLAG);
    if (!ledger?.plans) throw this.fail("RecoveryMissing");
    const errors = [];
    for (const plan of ledger.plans) {
      try {
        const original = await this.resolve(plan.originalUuid);
        if (!original) throw this.fail("OriginalMissing");
        const form = await this.resolve(plan.formUuid);
        if (form && memoryFormOf(form)?.sessionId !== ledger.sessionId) throw this.fail("FormChanged");
        const snapshots = new Map(plan.tokens.map(token => [token.uuid, token.data]));
        // Includes tokens created during the memory, on every world scene.
        for (const token of this.allTokens().filter(token => token.actorId === plan.formId)) {
          const restored = snapshots.get(token.uuid) ?? tokenFormData((await original.getTokenDocument()).toObject());
          await token.update(copy(restored), { diff: false, recursive: false });
          if (token.actorId !== restored.actorId || token.actorLink !== restored.actorLink) throw this.fail("TokenRestore", { name: token.name });
        }
        for (const saved of plan.users) {
          const user = this.game.users.get(saved.id);
          if (user?.character?.id === plan.formId) {
            if (saved.characterId && !this.game.actors.get(saved.characterId)) throw this.fail("AssignedMissing");
            await user.update({ character: saved.characterId });
          }
        }
        if (this.allTokens().some(token => token.actorId === plan.formId) || Array.from(this.game.users).some(user => user.character?.id === plan.formId))
          throw this.fail("FormInUse");
        if (form) await form.delete();
      } catch (error) { errors.push(error.message); }
    }
    if (errors.length) throw new Error([...new Set(errors)].join(" "));
    // Characters are back. A failed world rollback keeps the record, so Restore can retry it (or keep the changes).
    if (rollback && ledger.reality && this.reality) await this.reality.rollback(ledger.reality);
    await this.game.settings.set(MODULE_ID, RECOVERY_SETTING, "");
    // Restoration has succeeded. An orphaned private journal is harmless if its deletion fails; never reapply
    // any transformation to compensate for this.
    await journal.delete().catch(error => console.warn(`${MODULE_ID} | Could not remove completed braindance recovery journal`, error));
  }
}
