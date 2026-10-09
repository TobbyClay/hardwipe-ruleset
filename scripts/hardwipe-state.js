export const MODULE_ID = "hardwipe-ruleset";

export const FLAGS = {
  EDGE: "edge",
  STRIKES: "strikes",
  MOOK: "mook"
};

export const STATUSES = {
  DOWNED: "hardwipe-downed"
};

const DOWNED_EFFECT_FLAG = "downed";
const DEAD_CHAT_FLAG = "hardwipe-death";
const actorStateUpdates = new Map();

async function queueActorState(actor, operation) {
  const previous = actorStateUpdates.get(actor.uuid) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(() => canControlActor(actor) ? operation() : false);
  actorStateUpdates.set(actor.uuid, pending);
  try { return await pending; }
  finally { if (actorStateUpdates.get(actor.uuid) === pending) actorStateUpdates.delete(actor.uuid); }
}

export class EdgeManager {
  static get api() {
    return {
      get: actor => EdgeManager.get(actor),
      award: actor => EdgeManager.award(actor),
      spend: (actor, reason) => EdgeManager.spend(actor, reason)
    };
  }

  static get(actor) {
    const target = resolveActor(actor);
    return clamp(Number(target?.getFlag(MODULE_ID, FLAGS.EDGE)) || 0, 0, 1);
  }

  static async award(actor) {
    const target = resolveActor(actor);
    if (!target || !canControlActor(target)) return false;
    return queueActorState(target, async () => {
      await target.setFlag(MODULE_ID, FLAGS.EDGE, 1);
      return true;
    });
  }

  static async spend(actor, reason = "") {
    const target = resolveActor(actor);
    if (!target || !canControlActor(target)) return false;
    return queueActorState(target, async () => {
      if (this.get(target) < 1) {
        ui.notifications.warn(game.i18n.localize("HARDWIPE.Edge.None"));
        return false;
      }
      await target.setFlag(MODULE_ID, FLAGS.EDGE, 0);
      if (reason) await postSystemCard({
        actor: target,
        kind: "edge",
        kicker: game.i18n.localize("HARDWIPE.Edge.Title"),
        title: game.i18n.localize("HARDWIPE.Edge.Spent"),
        subtitle: reason
      });
      return true;
    });
  }
}

export class StrikesManager {
  static get api() {
    return {
      get: actor => StrikesManager.get(actor),
      add: actor => StrikesManager.add(actor),
      reset: actor => StrikesManager.reset(actor)
    };
  }

  static get(actor) {
    const target = resolveActor(actor);
    return clamp(Number(target?.getFlag(MODULE_ID, FLAGS.STRIKES)) || 0, 0, 3);
  }

  static async set(actor, value, { announceDeath = true } = {}) {
    const target = resolveActor(actor);
    if (!target || !canControlActor(target)) return false;

    return queueActorState(target, () => this._set(target, value, { announceDeath }));
  }

  static async _set(target, value, { announceDeath = true } = {}) {
    const strikes = clamp(Math.trunc(Number(value) || 0), 0, 3);
    await target.setFlag(MODULE_ID, FLAGS.STRIKES, strikes);
    if (strikes >= 3) await DownedManager.kill(target, { announce: announceDeath });
    return true;
  }

  static async add(actor) {
    const target = resolveActor(actor);
    if (!target || !canControlActor(target)) return false;
    return queueActorState(target, () => this._set(target, this.get(target) + 1));
  }

  static async reset(actor) {
    const target = resolveActor(actor);
    if (!target || !canControlActor(target)) return false;
    return queueActorState(target, async () => {
      await target.setFlag(MODULE_ID, FLAGS.STRIKES, 0);
      return true;
    });
  }
}

export class DownedManager {
  static get api() {
    return {
      apply: actor => DownedManager.apply(actor),
      recover: (actor, options) => DownedManager.recover(actor, options)
    };
  }

  static isDowned(actor) {
    const target = resolveActor(actor);
    return !!target?.effects?.some(effect => effect.getFlag(MODULE_ID, "type") === DOWNED_EFFECT_FLAG);
  }

  static async apply(actor) {
    const target = resolveActor(actor);
    if (!target || !canControlActor(target) || target.statuses?.has("dead") || StrikesManager.get(target) >= 3 || this.isDowned(target)) return false;

    const effect = await ActiveEffect.implementation.fromStatusEffect("unconscious");
    const data = effect.toObject();
    delete data._id;
    data.name = game.i18n.localize("HARDWIPE.Downed.Title");
    data.statuses = [STATUSES.DOWNED, "unconscious", "incapacitated"];
    data.disabled = false;
    data.flags ??= {};
    data.flags[MODULE_ID] = { ...(data.flags[MODULE_ID] ?? {}), type: DOWNED_EFFECT_FLAG };
    await target.createEmbeddedDocuments("ActiveEffect", [data]);
    return true;
  }

  static async clear(actor) {
    const target = resolveActor(actor);
    if (!target || !canControlActor(target)) return false;

    const ids = target.effects
      .filter(effect => effect.getFlag(MODULE_ID, "type") === DOWNED_EFFECT_FLAG)
      .map(effect => effect.id);
    if (!ids.length) return true;

    await target.deleteEmbeddedDocuments("ActiveEffect", ids);
    return true;
  }

  static async recover(actor, { hp = null, spendEdge = false } = {}) {
    const target = resolveActor(actor);
    if (!target || !canControlActor(target) || target.statuses?.has("dead") || StrikesManager.get(target) >= 3) return false;

    if (spendEdge) {
      const spent = await EdgeManager.spend(target, game.i18n.localize("HARDWIPE.Edge.RecoverReason"));
      if (!spent) return false;
    }

    const update = {};
    if (hp !== null && Number.isFinite(Number(hp))) {
      const max = Number(target.system?.attributes?.hp?.max) || 1;
      update["system.attributes.hp.value"] = clamp(Number(hp), 1, max);
    }

    if (!foundry.utils.isEmpty(update)) await target.update(update, { hardwipeRecovery: true });
    await this.clear(target);
    return true;
  }

  static async kill(actor, { announce = true } = {}) {
    const target = resolveActor(actor);
    if (!target || !canControlActor(target)) return false;

    await this.clear(target);
    if (!target.statuses?.has("dead")) {
      await target.toggleStatusEffect("dead", { active: true });
    }

    if (announce && !target.getFlag(MODULE_ID, "deathAnnounced")) {
      await target.setFlag(MODULE_ID, "deathAnnounced", true);
      await postSystemCard({
        actor: target,
        kicker: game.i18n.localize("HARDWIPE.Strikes.Title"),
        title: game.i18n.localize("HARDWIPE.Strikes.DeathTitle"),
        subtitle: game.i18n.localize("HARDWIPE.Strikes.DeathSubtitle"),
        flagType: DEAD_CHAT_FLAG,
        kind: "flatlined",
        variant: "hardwipe-card-danger"
      });
    }
    return true;
  }
}

export function resolveActor(actor) {
  if (!actor) return null;
  if (actor.documentName === "Actor") return actor;
  if (actor.actor?.documentName === "Actor") return actor.actor;
  if (typeof actor === "string") {
    const worldActor = game.actors.get(actor);
    if (worldActor) return worldActor;
    const document = foundry.utils.fromUuidSync(actor, { strict: false });
    return document?.actor ?? (document?.documentName === "Actor" ? document : null);
  }
  return null;
}

export function canControlActor(actor) {
  return game.user.isGM || actor?.isOwner;
}

export function isCharacter(actor) {
  return resolveActor(actor)?.type === "character";
}

export function getActorFlag(actor, flag, fallback = null) {
  return resolveActor(actor)?.getFlag(MODULE_ID, flag) ?? fallback;
}

export async function setActorFlag(actor, flag, value) {
  const target = resolveActor(actor);
  if (!target || !canControlActor(target)) return false;
  await target.setFlag(MODULE_ID, flag, value);
  return true;
}

export async function postSystemCard({ actor, kicker, title, subtitle = "", meta = "", flagType = "hardwipe-card", variant = "", kind = "" }) {
  const safeActor = resolveActor(actor);
  const safeTitle = escapeHTML(title);
  const cardClass = variant ? `hardwipe-chat-card ${variant}` : "hardwipe-chat-card";
  const content = `
    <div class="${cardClass}">
      <div class="hardwipe-chat-kicker">${escapeHTML(kicker)}</div>
      <div class="hardwipe-chat-title" data-text="${safeTitle}">${safeTitle}</div>
      ${subtitle ? `<div class="hardwipe-chat-subtitle">${escapeHTML(subtitle)}</div>` : ""}
      <div class="hardwipe-chat-meta">${escapeHTML(meta || safeActor?.name || "")}</div>
    </div>
  `;

  return ChatMessage.implementation.create({
    speaker: safeActor ? ChatMessage.implementation.getSpeaker({ actor: safeActor }) : { alias: "Hardwipe" },
    content,
    flags: {
      [MODULE_ID]: { type: flagType, actorId: safeActor?.id ?? null, ...(kind ? { kind } : {}) }
    }
  });
}

/**
 * Ready Set Midi replaces dnd5e's activity types with its own ("Midi Heal", "Midi Save", "Midi Check"),
 * and an unnamed activity takes its type's title. Players read the plain dnd5e word instead.
 */
export function plainActivityLabel(text) {
  return String(text ?? "").replace(/^Midi\s+/i, "");
}

export function escapeHTML(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
