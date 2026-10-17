import { MODULE_ID, canControlActor, escapeHTML, postSystemCard, responsibleFor } from "./hardwipe-state.js";

/**
 * Crew Maneuvers: one character sets a maneuver up, and it stays on them as an effect until a player triggers it.
 * - Any feat becomes a crew maneuver from the "Crew maneuver" fieldset on its Details tab
 *   (flags.hardwipe-ruleset.crew): on or off, and the payoff (a weapon attack, or the card alone). What it does is the
 *   feature's own description: the rest of the crew reads "Mags has set up Entry Stack:" and that description. Nothing
 *   about a maneuver is in the code.
 * - Using one of its activities (the setup) puts a primed effect on the character, replacing an older one from the same
 *   feature. Hardwipe creates the effect itself, so Ready Set Midi's auto-apply settings don't decide whether it lands.
 * - Nothing listens for doors or attacks: the table says when it happens. The character's player presses it on their
 *   Turn tab (for an attack payoff, one button per drawn weapon); everyone else in the fight, or on the scene before
 *   one, sees the reminder. The description is read from the feature when it's still there, so edits show at once.
 * - Triggering deletes the effect first; a second click or a second client finds nothing left to delete and stops.
 *   Then the CREW card is posted, and an attack payoff rolls through the Turn tab as a reaction.
 * - In a started combat a primed effect lasts until the start of its owner's next turn. One set up before the fight
 *   lasts until its owner's first turn in it. The active GM (or the first owner online) removes it then, and when the
 *   combat it was set up in is deleted.
 */
export const CREW_FLAG = "crew";
export const PAYOFFS = ["attack", "card"];
const order = (round, turn) => (Number(round) || 0) * 1000 + (Number(turn) || 0);

/* Pure rules (unit-tested) ---------------------------------------------------------------------- */

/** The crew settings of a feature, or null when it isn't a crew maneuver. */
export function crewSettings(item) {
  const flag = item?.flags?.[MODULE_ID]?.[CREW_FLAG];
  if (item?.type !== "feat" || flag?.enabled !== true) return null;
  return { payoff: PAYOFFS.includes(flag.payoff) ? flag.payoff : "attack" };
}

/** The crew data a primed effect carries, or null for any other effect. */
export function crewData(effect) {
  const data = effect?.flags?.[MODULE_ID]?.[CREW_FLAG];
  return data && typeof data.item === "string" && data.item ? data : null;
}

/** A crew effect that can still be triggered: not disabled and not marked expired by Foundry. */
export function isPrimed(effect) {
  return !!crewData(effect) && !effect.disabled && effect.duration?.expired !== true;
}

/**
 * Whether a primed effect comes off when its owner's turn starts at `start` ({combat, round, turn}).
 * Set up in this combat: only on a later turn than the setup's (a GM stepping back doesn't drop it). Set up before
 * the fight, or in another combat: on the owner's first turn here.
 */
export function expiresAtTurnStart(stamp, start) {
  if (!start?.combat) return false;
  if (!stamp?.combat || stamp.combat !== start.combat) return true;
  return order(start.round, start.turn) > order(stamp.round, stamp.turn);
}

/**
 * A feature description as one line of plain text for the Turn tab: GM-only secret blocks removed (the whole crew reads
 * it), tags dropped (paragraphs and breaks become spaces), common entities decoded, content links reduced to their
 * label (@UUID[...]{Label} reads "Label"), inline rolls to their formula, whitespace collapsed. The result is escaped
 * when rendered.
 */
export function plainDescription(html) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
  return String(html ?? "")
    .replace(/<section\b[^>]*\bclass\s*=\s*["'][^"']*\bsecret\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi, " ")
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name) => entities[name])
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/@\w+\[([^\]]*)\]/g, "$1")
    .replace(/\[\[\/?\w*\s*([^\]]*)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/* Live state ------------------------------------------------------------------------------------- */

export class CrewManager {
  static _registered = false;
  /** Effects this client is deleting to fire them. */
  static _firing = new Set();

  static get api() {
    return {
      settings: item => crewSettings(item),
      primed: actor => CrewManager.primed(actor),
      trigger: (actor, effectId) => CrewManager.trigger(actor, effectId),
      cancel: (actor, effectId) => CrewManager.cancel(actor, effectId)
    };
  }

  static register() {
    if (this._registered) return;
    this._registered = true;
    // dnd5e calls this on the client that used the activity: that client owns the actor and writes the effect.
    Hooks.on("dnd5e.postUseActivity", activity => { void this._onUse(activity).catch(reportError); });
    Hooks.on("combatTurnChange", combat => { void this._onTurnChange(combat).catch(reportError); });
    Hooks.on("deleteCombat", combat => { void this._onDeleteCombat(combat).catch(reportError); });
    Hooks.on("renderItemSheet5e", (app, html) => this._renderFields(app, html));
  }

  /** The primed crew effects on an actor. */
  static primed(actor) {
    return [...(actor?.effects ?? [])].filter(isPrimed);
  }

  /** Setup: using a crew maneuver's activity primes it on its user. */
  static async _onUse(activity) {
    const item = activity?.item;
    const actor = activity?.actor;
    const settings = crewSettings(item);
    if (!settings || !actor || item.parent !== actor || !canControlActor(actor)) return;
    const data = {
      name: item.name, img: item.img, origin: item.uuid,
      description: item.system?.description?.value ?? "",
      // Show on the token whether or not the effect has a duration: the table needs to see who is set up.
      showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2,
      // The effect keeps a copy of the description, for when the feature is gone by the time it fires.
      flags: { [MODULE_ID]: { [CREW_FLAG]: { item: item.id, ...settings, stamp: combatStamp(actor) } } }
    };
    const old = actor.effects.filter(effect => crewData(effect)?.item === item.id).map(effect => effect.id);
    if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
    await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  }

  /** Payoff, name and description of a primed effect: from the feature when it's still there, else the effect's copy. */
  static settingsOf(actor, effect) {
    const data = crewData(effect);
    const item = actor?.items?.get(data?.item);
    return {
      ...data, ...(crewSettings(item) ?? {}), maneuver: item?.name ?? effect?.name ?? "",
      description: plainDescription(item ? item.system?.description?.value : effect?.description)
    };
  }

  /**
   * Fire a primed maneuver: remove its effect and post the CREW card. Returns its crew data, or null when it is no
   * longer primed (expired, cancelled, or triggered from another client a moment earlier).
   */
  static async trigger(actor, effectId) {
    if (!canControlActor(actor)) return null;
    // A second click on this client while the first is still deleting: the first one fires, this one does nothing.
    if (this._firing.has(effectId)) return null;
    const effect = actor.effects.get(effectId);
    if (!isPrimed(effect)) {
      ui.notifications.warn(game.i18n.localize("HARDWIPE.Crew.NotPrimed"));
      return null;
    }
    const settings = this.settingsOf(actor, effect);
    // Another client may have deleted it since this one last heard: then nothing comes back (and Foundry reports the
    // missing effect itself).
    let deleted = [];
    this._firing.add(effectId);
    try { deleted = await actor.deleteEmbeddedDocuments("ActiveEffect", [effectId]); } catch { deleted = []; }
    finally { this._firing.delete(effectId); }
    if (!deleted?.length) {
      ui.notifications.warn(game.i18n.localize("HARDWIPE.Crew.NotPrimed"));
      return null;
    }
    await postSystemCard({
      actor, kind: "crew", flagType: "hardwipe-crew",
      kicker: game.i18n.localize("HARDWIPE.Crew.Kicker"),
      title: settings.maneuver,
      subtitle: game.i18n.format("HARDWIPE.Crew.Fired", { name: actor.name, maneuver: settings.maneuver }),
      meta: game.i18n.format("HARDWIPE.Crew.FiredMeta", { name: actor.name, user: game.user.name })
    });
    return settings;
  }

  /** Stand down: remove the effect without a payoff. */
  static async cancel(actor, effectId) {
    if (!canControlActor(actor) || !crewData(actor.effects.get(effectId))) return false;
    await actor.deleteEmbeddedDocuments("ActiveEffect", [effectId]);
    return true;
  }

  static async _onTurnChange(combat) {
    const actor = combat?.combatant?.actor;
    if (!actor || !responsibleFor(actor)) return;
    const start = { combat: combat.id, round: combat.round, turn: combat.turn };
    const ids = actor.effects.filter(effect => crewData(effect) && expiresAtTurnStart(crewData(effect).stamp, start)).map(effect => effect.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }

  static async _onDeleteCombat(combat) {
    for (const combatant of combat?.combatants ?? []) {
      const actor = combatant.actor;
      if (!actor || !responsibleFor(actor)) continue;
      const ids = actor.effects.filter(effect => crewData(effect)?.stamp?.combat === combat.id).map(effect => effect.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    }
  }

  /**
   * The "Crew maneuver" fieldset at the top of a feat's Details tab. Its inputs are named after the flag, so the
   * sheet's own form saves them.
   */
  static _renderFields(app, html) {
    const item = app.document;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (item?.type !== "feat" || !root) return;
    const tab = root.querySelector('.tab[data-tab="details"]');
    if (!tab || tab.querySelector(".hardwipe-crew-fields")) return;
    const t = key => escapeHTML(game.i18n.localize(`HARDWIPE.Crew.Sheet.${key}`));
    const flag = item.flags?.[MODULE_ID]?.[CREW_FLAG] ?? {};
    const on = flag.enabled === true;
    const disabled = app.isEditable ? "" : "disabled";
    const name = key => `flags.${MODULE_ID}.${CREW_FLAG}.${key}`;
    const payoff = PAYOFFS.includes(flag.payoff) ? flag.payoff : "attack";
    const options = PAYOFFS.map(value => `<option value="${value}" ${value === payoff ? "selected" : ""}>${t(`Payoff${value === "card" ? "Card" : "Attack"}`)}</option>`).join("");
    tab.insertAdjacentHTML("afterbegin", `<fieldset class="hardwipe-crew-fields">
      <legend>${t("Legend")}</legend>
      <div class="form-group">
        <label>${t("Enabled")}</label>
        <div class="form-fields"><input type="checkbox" name="${name("enabled")}" ${on ? "checked" : ""} ${disabled}></div>
        <p class="hint">${t("EnabledHint")}</p>
      </div>
      ${on ? `<div class="form-group">
        <label>${t("Payoff")}</label>
        <div class="form-fields"><select name="${name("payoff")}" ${disabled}>${options}</select></div>
      </div>` : ""}
    </fieldset>`);
  }

  /**
   * The Turn tab's Crew group: this character's primed maneuvers with their payoff buttons, and reminders of what
   * the rest of the crew has primed.
   * @param {Actor} actor
   * @param {{canControl: boolean, inCombat: boolean, reactionSpent: boolean}} state
   */
  static context(actor, { canControl, inCombat, reactionSpent }) {
    const t = key => game.i18n.localize(`HARDWIPE.Crew.${key}`);
    const own = this.primed(actor).map(effect => {
      const attack = this.settingsOf(actor, effect).payoff !== "card";
      return {
        effectId: effect.id, name: effect.name, img: effect.img, attack,
        weapons: attack ? drawnWeapons(actor) : [],
        hint: t(inCombat ? "LastsCombat" : "LastsBefore"),
        cost: attack ? t(reactionSpent ? "CostSpent" : "CostAttack") : "",
        costTone: reactionSpent ? "is-warn" : "",
        canTrigger: canControl, canCancel: canControl,
        noWeapon: t("NoWeapon"), fire: t("Fire"), cancel: t("Cancel"), triggerLabel: t("Trigger"), primed: t("Primed")
      };
    });
    const allies = [];
    for (const mate of crewmates(actor)) {
      for (const effect of this.primed(mate)) {
        const settings = this.settingsOf(mate, effect);
        // "Mags has set up Entry Stack:" and the feature's description.
        allies.push({
          img: effect.img, description: settings.description,
          // Rendered as HTML: only the names are inserted, escaped and in bold.
          setUp: game.i18n.format(settings.description ? "HARDWIPE.Crew.SetUp" : "HARDWIPE.Crew.SetUpBare",
            { name: `<b>${escapeHTML(mate.name)}</b>`, maneuver: `<b>${escapeHTML(settings.maneuver)}</b>` })
        });
      }
    }
    return { own, allies, show: own.length > 0 || allies.length > 0, label: t("Label") };
  }
}

/** The started combat this actor is in (the viewed one first), as the stamp a primed effect carries; else null. */
function combatStamp(actor) {
  const has = combat => combat?.started && combat.combatants.some(combatant => combatant.actor?.uuid === actor.uuid);
  const combat = has(game.combat) ? game.combat : game.combats?.find(has);
  return combat ? { combat: combat.id, round: combat.round, turn: combat.turn } : null;
}

/** The other characters in this actor's started combat, or with a token on the scene being viewed. */
function crewmates(actor) {
  const stamp = combatStamp(actor);
  const combat = stamp ? game.combats.get(stamp.combat) : null;
  const actors = combat ? combat.combatants.map(combatant => combatant.actor) : (canvas?.scene?.tokens ?? []).map(token => token.actor);
  const seen = new Set([actor.uuid]);
  const out = [];
  for (const mate of actors) {
    if (!mate || mate.type !== "character" || seen.has(mate.uuid)) continue;
    seen.add(mate.uuid);
    out.push(mate);
  }
  return out;
}

/** Equipped weapons with an attack that costs an action: what an attack payoff can fire. */
function drawnWeapons(actor) {
  const out = [];
  for (const item of actor.items) {
    if (item.type !== "weapon" || !item.system.equipped) continue;
    const activity = [...(item.system.activities ?? [])].find(entry => entry.type === "attack" && entry.activation?.type === "action" && !entry.isHidden);
    if (!activity) continue;
    const labels = activity.labels ?? {};
    const damage = (Array.isArray(labels.damages) ? labels.damages : []).map(part => part?.label ?? part?.formula ?? part).filter(Boolean).join(" + ");
    out.push({ itemId: item.id, activityId: activity.id, name: item.name, img: item.img, meta: [labels.toHit, damage].filter(Boolean).join(" · ") });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function reportError(error) {
  console.error(`${MODULE_ID} | Crew maneuvers`, error);
  ui.notifications?.error(error.message ?? String(error));
}
