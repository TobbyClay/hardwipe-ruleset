import { MODULE_ID, canControlActor, escapeHTML, responsibleFor } from "./hardwipe-state.js";

/**
 * Crew Maneuvers: one character sets a maneuver up, and it stays on them as an effect until it's fired.
 * - A crew maneuver is a feat whose Feature Type is "Crew Maneuver"; its subtype is one of the maneuver types the GM
 *   defines in the settings (Game Settings → Hardwipe Ruleset → Crew maneuver types). Nothing is added to the sheet:
 *   D&D5e draws both dropdowns from CONFIG.DND5E.featureTypes.
 * - A type is a name and three rules: what Fire does (one weapon attack on the reaction, the feature's own payoff
 *   activity, or the card alone), who fires it (the character who set it up, or anyone else in the crew), and how long
 *   it lasts (until the owner's next turn, the end of the round, or until used).
 * - The feature's first activity sets it up. With an activity payoff, its other activities are what Fire uses, and they
 *   leave the Turn tab's bands. What the maneuver does is the feature's own description: the rest of the crew reads
 *   "Mags has set up Entry Stack:" and that description.
 * - Firing deletes the effect first; a second click or a second client finds nothing left to delete and stops. A
 *   crewmate can't delete an effect on someone else's character, so the active GM's client does it for them.
 * - The active GM (or the first owner online) removes a maneuver when its time is up, and one set up in a combat when
 *   that combat is deleted (unless it lasts until used).
 */
export const CREW_FLAG = "crew";
export const CREW_FEATURE_TYPE = "crewManeuver";
export const CREW_TYPES_SETTING = "crewTypes";
export const CREW_CARD_SETTING = "crewCardStyle";
export const CARD_STYLES = ["cam", "feed"];
export const PAYOFFS = ["attack", "activity", "card"];
export const FIRERS = ["owner", "crew"];
export const DURATIONS = ["turn", "round", "used"];
const MAX_TYPES = 24;
const order = (round, turn) => (Number(round) || 0) * 1000 + (Number(turn) || 0);

/** The types a world starts with; their names are localization keys until the GM saves the list. */
export const DEFAULT_CREW_TYPES = [
  { id: "strike", name: "HARDWIPE.Crew.Default.strike", payoff: "attack", fires: "owner", lasts: "turn" },
  { id: "support", name: "HARDWIPE.Crew.Default.support", payoff: "activity", fires: "owner", lasts: "turn" },
  { id: "signal", name: "HARDWIPE.Crew.Default.signal", payoff: "card", fires: "crew", lasts: "round" }
];

/* Pure rules (unit-tested) ---------------------------------------------------------------------- */

const pick = (value, allowed) => (allowed.includes(value) ? value : allowed[0]);
// Accents come off before the slug ("Señal" → "senal"), so they don't split a word in two.
const slug = text => String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/**
 * A clean list of maneuver types: unnamed rows dropped, rules limited to the known values, ids made safe and unique
 * (from the name when missing), at most 24.
 */
export function normalizeCrewTypes(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const ids = new Set();
  for (const raw of list) {
    const name = String(raw?.name ?? "").trim().slice(0, 60);
    if (!name) continue;
    const base = slug(raw?.id) || slug(name) || "type";
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    out.push({ id, name, payoff: pick(raw?.payoff, PAYOFFS), fires: pick(raw?.fires, FIRERS), lasts: pick(raw?.lasts, DURATIONS) });
    if (out.length >= MAX_TYPES) break;
  }
  return out;
}

/**
 * The rule a maneuver type gives. An activity payoff is always fired by its owner (the activity is on their feature).
 * A type that no longer exists (or none chosen) still works, as a card fired by its owner, and says so.
 */
export function ruleFor(typeId, types) {
  const type = (types ?? []).find(entry => entry.id === typeId);
  if (!type) return { id: typeId ?? "", name: "", payoff: "card", fires: "owner", lasts: "turn", known: false };
  return { ...type, fires: type.payoff === "activity" ? "owner" : type.fires, known: true };
}

/** The rule of a feature, or null when it isn't a crew maneuver. */
export function crewRule(item, types) {
  if (item?.type !== "feat" || item.system?.type?.value !== CREW_FEATURE_TYPE) return null;
  return ruleFor(item.system.type.subtype, types);
}

/** The id of the activity that sets a maneuver up: its first, by sort order. */
export function setupActivityId(activities) {
  const list = [...(activities ?? [])].sort((a, b) => (Number(a?.sort) || 0) - (Number(b?.sort) || 0));
  return list[0]?.id ?? null;
}

/** The crew data a primed effect carries, or null for any other effect. */
export function crewData(effect) {
  const data = effect?.flags?.[MODULE_ID]?.[CREW_FLAG];
  return data && typeof data.item === "string" && data.item ? data : null;
}

/** A crew effect that can still be fired: not disabled and not marked expired by Foundry. */
export function isPrimed(effect) {
  return !!crewData(effect) && !effect.disabled && effect.duration?.expired !== true;
}

/**
 * Whether a primed maneuver is over at a turn change `now` ({combat, round, turn, ownersTurn}).
 * - "turn": at the start of the owner's next turn after the setup (a GM stepping back doesn't drop it); set up before
 *   the fight, or in another one, at the owner's first turn in this one.
 * - "round": once the round it was set up in is over; set up before the fight, once the first round is.
 * - "used": never.
 */
export function expiresAt(lasts, stamp, now) {
  if (!now?.combat || lasts === "used") return false;
  const fresh = !stamp?.combat || stamp.combat !== now.combat;
  if (lasts === "round") return fresh ? (Number(now.round) || 0) >= 2 : (Number(now.round) || 0) > (Number(stamp.round) || 0);
  if (!now.ownersTurn) return false;
  return fresh || order(now.round, now.turn) > order(stamp.round, stamp.turn);
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
  /** Activities being used as a payoff from this client, so using them doesn't set the maneuver up again. */
  static _payoffUses = new Set();
  static _socket = null;

  static get api() {
    return {
      types: () => CrewManager.types(),
      rule: item => CrewManager.rule(item),
      primed: actor => CrewManager.primed(actor),
      trigger: (actor, effectId) => CrewManager.trigger(actor, effectId),
      cancel: (actor, effectId) => CrewManager.cancel(actor, effectId),
      configure: () => new (crewTypesConfig())().render({ force: true })
    };
  }

  static register() {
    if (this._registered) return;
    this._registered = true;
    game.settings.register(MODULE_ID, CREW_TYPES_SETTING, {
      scope: "world", config: false, type: Object, default: {}, onChange: () => this._typesChanged()
    });
    game.settings.register(MODULE_ID, CREW_CARD_SETTING, {
      name: "HARDWIPE.Crew.CardStyle.Name", hint: "HARDWIPE.Crew.CardStyle.Hint", scope: "world", config: true, type: String,
      choices: Object.fromEntries(CARD_STYLES.map(style => [style, `HARDWIPE.Crew.CardStyle.${style}`])), default: "cam",
      onChange: () => rerenderCrewCards()
    });
    game.settings.registerMenu(MODULE_ID, "crewTypesMenu", {
      name: "HARDWIPE.Crew.Types.Menu", label: "HARDWIPE.Crew.Types.MenuLabel", hint: "HARDWIPE.Crew.Types.MenuHint",
      icon: "fas fa-people-group", type: crewTypesConfig(), restricted: true
    });
    // World settings and translations are ready by setup, before any sheet draws the Feature Type dropdowns.
    Hooks.once("setup", () => this.applyFeatureType());
    // dnd5e calls this on the client that used the activity: that client owns the actor and writes the effect.
    Hooks.on("dnd5e.postUseActivity", activity => { void this._onUse(activity).catch(reportError); });
    Hooks.on("combatTurnChange", combat => { void this._onTurnChange(combat).catch(reportError); });
    Hooks.on("deleteCombat", combat => { void this._onDeleteCombat(combat).catch(reportError); });
    Hooks.on("renderChatMessageHTML", (message, html) => this._renderCard(message, html));
    this._registerSocket();
    Hooks.once("socketlib.ready", () => this._registerSocket());
  }

  static _registerSocket() {
    if (this._socket || !globalThis.socketlib) return;
    this._socket = socketlib.registerModule(MODULE_ID);
    this._socket?.register("crewFire", function(setterUuid, effectId, firerUuid) {
      return CrewManager._gmFire(setterUuid, effectId, firerUuid, this.socketdata?.userId);
    });
  }

  /** The GM's maneuver types, or the defaults until the GM saves a list. */
  static types() {
    let stored = null;
    try { stored = game.settings.get(MODULE_ID, CREW_TYPES_SETTING)?.list; } catch { stored = null; }
    const list = Array.isArray(stored) ? stored : DEFAULT_CREW_TYPES.map(type => ({ ...type, name: game.i18n.localize(type.name) }));
    return normalizeCrewTypes(list);
  }

  static rule(item) { return crewRule(item, this.types()); }

  /** Crew Maneuver as a D&D5e Feature Type, with the GM's types as its subtypes. */
  static applyFeatureType() {
    const featureTypes = CONFIG.DND5E?.featureTypes;
    if (!featureTypes) return;
    featureTypes[CREW_FEATURE_TYPE] = {
      label: game.i18n.localize("HARDWIPE.Crew.FeatureType"),
      subtypes: Object.fromEntries(this.types().map(type => [type.id, type.name]))
    };
  }

  static _typesChanged() {
    this.applyFeatureType();
    for (const app of foundry.applications.instances.values()) {
      if (!app.rendered) continue;
      if (app.document?.documentName === "Item" && app.document.type === "feat") app.render();
      else if (typeof app._hardwipeRefreshTurn === "function") app._hardwipeRefreshTurn();
    }
  }

  /** The primed crew effects on an actor. */
  static primed(actor) {
    return [...(actor?.effects ?? [])].filter(isPrimed);
  }

  /** Whether an activity is a maneuver's payoff: used through Fire, not from the Turn tab's bands. */
  static isPayoffActivity(item, activity) {
    const rule = this.rule(item);
    return rule?.payoff === "activity" && activity?.id !== setupActivityId(item.system?.activities);
  }

  /** Setup: using a crew maneuver's first activity primes it on its user. */
  static async _onUse(activity) {
    const item = activity?.item;
    const actor = activity?.actor;
    const rule = this.rule(item);
    if (!rule || !actor || item.parent !== actor || !canControlActor(actor)) return;
    if (this._payoffUses.has(activity.uuid) || activity.id !== setupActivityId(item.system.activities)) return;
    const data = {
      name: item.name, img: item.img, origin: item.uuid,
      description: item.system?.description?.value ?? "",
      // Show on the token whether or not the effect has a duration: the table needs to see who is set up.
      showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2,
      // The effect keeps the type and a copy of the description, for when the feature is gone by the time it fires.
      flags: { [MODULE_ID]: { [CREW_FLAG]: { item: item.id, type: rule.id, stamp: combatStamp(actor) } } }
    };
    const old = actor.effects.filter(effect => crewData(effect)?.item === item.id).map(effect => effect.id);
    if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
    await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  }

  /** Rule, name, type name and description of a primed effect: from the feature when it's still there, else the copy. */
  static settingsOf(actor, effect) {
    const data = crewData(effect);
    const item = actor?.items?.get(data?.item);
    const rule = (item && this.rule(item)) ?? ruleFor(data?.type, this.types());
    return {
      ...rule, item: item ?? null, maneuver: item?.name ?? effect?.name ?? "",
      description: plainDescription(item ? item.system?.description?.value : effect?.description)
    };
  }

  /**
   * The owner fires a primed maneuver: remove its effect and post the CREW card. Returns its settings, or null when it is
   * no longer primed (expired, stood down, or fired from another client a moment earlier).
   */
  static async trigger(actor, effectId) {
    if (!canControlActor(actor)) return null;
    // A second click on this client while the first is still deleting: the first one fires, this one does nothing.
    if (this._firing.has(effectId)) return null;
    const effect = actor.effects.get(effectId);
    if (!isPrimed(effect)) return notPrimed();
    const settings = this.settingsOf(actor, effect);
    // Another client may have deleted it since this one last heard: then nothing comes back (and Foundry reports the
    // missing effect itself).
    let deleted = [];
    this._firing.add(effectId);
    try { deleted = await actor.deleteEmbeddedDocuments("ActiveEffect", [effectId]); } catch { deleted = []; }
    finally { this._firing.delete(effectId); }
    if (!deleted?.length) return notPrimed();
    await this.postCard({ setter: actor, firer: actor, settings });
    return settings;
  }

  /** A crewmate fires a maneuver set up by someone else: the active GM's client removes it, then the card is posted. */
  static async fireAsCrew(setter, effectId, firer) {
    if (!setter || !firer || !canControlActor(firer) || this._firing.has(effectId)) return null;
    const effect = setter.effects.get(effectId);
    if (!isPrimed(effect)) return notPrimed();
    const settings = this.settingsOf(setter, effect);
    if (settings.fires !== "crew") return null;
    if (!game.users.activeGM || !this._socket) {
      ui.notifications.warn(game.i18n.localize("HARDWIPE.Crew.NeedsGM"));
      return null;
    }
    let fired = false;
    this._firing.add(effectId);
    try { fired = await this._socket.executeAsGM("crewFire", setter.uuid, effectId, firer.uuid); } catch { fired = false; }
    finally { this._firing.delete(effectId); }
    if (!fired) return notPrimed();
    await this.postCard({ setter, firer, settings });
    return settings;
  }

  /** GM side of fireAsCrew: the sender must own the firer, and the maneuver must still be primed and crew-fired. */
  static async _gmFire(setterUuid, effectId, firerUuid, userId) {
    const user = game.users.get(userId);
    const setter = foundry.utils.fromUuidSync(setterUuid);
    const firer = foundry.utils.fromUuidSync(firerUuid);
    if (!user || setter?.documentName !== "Actor" || firer?.documentName !== "Actor" || setter === firer) return false;
    if (!firer.testUserPermission(user, "OWNER")) return false;
    const effect = setter.effects.get(effectId);
    if (!isPrimed(effect) || this.settingsOf(setter, effect).fires !== "crew") return false;
    let deleted = [];
    try { deleted = await setter.deleteEmbeddedDocuments("ActiveEffect", [effectId]); } catch { deleted = []; }
    return !!deleted?.length;
  }

  /** Stand down: remove the effect without a payoff. */
  static async cancel(actor, effectId) {
    if (!canControlActor(actor) || !crewData(actor.effects.get(effectId))) return false;
    await actor.deleteEmbeddedDocuments("ActiveEffect", [effectId]);
    return true;
  }

  static async _onTurnChange(combat) {
    if (!combat) return;
    const current = combat.combatant?.actor;
    const seen = new Set();
    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor || seen.has(actor.uuid) || !responsibleFor(actor)) continue;
      seen.add(actor.uuid);
      const now = { combat: combat.id, round: combat.round, turn: combat.turn, ownersTurn: current?.uuid === actor.uuid };
      const ids = this.primed(actor).filter(effect => expiresAt(this.settingsOf(actor, effect).lasts, crewData(effect).stamp, now)).map(effect => effect.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    }
  }

  static async _onDeleteCombat(combat) {
    for (const combatant of combat?.combatants ?? []) {
      const actor = combatant.actor;
      if (!actor || !responsibleFor(actor)) continue;
      const ids = actor.effects.filter(effect => crewData(effect)?.stamp?.combat === combat.id
        && this.settingsOf(actor, effect).lasts !== "used").map(effect => effect.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    }
  }

  /* CREW card ------------------------------------------------------------------------------------- */

  /**
   * Post the CREW card. The message keeps what the card shows (names, portraits, the maneuver, its type, the round and
   * turn) so each render draws it in the world's current card style; its content is that drawing, for a world without
   * Hardwipe.
   */
  static async postCard({ setter, firer, settings }) {
    const combat = combatStamp(firer) ? game.combats.get(combatStamp(firer).combat) : null;
    const member = actor => ({ uuid: actor.uuid, name: actor.name, img: actor.img ?? "" });
    const data = {
      setter: member(setter), firer: firer && firer.uuid !== setter.uuid ? member(firer) : null,
      maneuver: settings.maneuver, type: settings.id, typeName: settings.known ? settings.name : "", payoff: settings.payoff,
      user: game.user.name, round: combat?.round ?? null, turn: combat ? combat.turn + 1 : null
    };
    return ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: firer }),
      content: crewCardMarkup(cardStyle(), cardText(data)),
      flags: { [MODULE_ID]: { type: "hardwipe-crew", kind: "crew", crew: data } }
    });
  }

  /** A CREW card is drawn in the current style from its data, and plays its entrance only when it has just been posted. */
  static _renderCard(message, html) {
    const data = message.flags?.[MODULE_ID]?.crew;
    if (message.flags?.[MODULE_ID]?.kind !== "crew" || !data?.setter?.name) return;
    const element = html instanceof HTMLElement ? html : html?.[0];
    const content = element?.querySelector(".message-content");
    if (!content) return;
    element.classList.add("hardwipe-crew-message");
    content.innerHTML = crewCardMarkup(cardStyle(), cardText(data));
    if (Date.now() - (Number(message.timestamp) || 0) < 6000) content.querySelector(".hardwipe-crewcard")?.classList.add("is-fresh");
  }

  /* Turn tab ---------------------------------------------------------------------------------------- */

  /**
   * The Turn tab's crewlink panel: this character's primed maneuvers with their payoff buttons, and what the rest of the
   * crew has primed ("Mags has set up Entry Stack:" and its description), with Fire buttons when the crew may fire it.
   * @param {Actor} actor
   * @param {{canControl: boolean, inCombat: boolean, reactionSpent: boolean}} state
   */
  static context(actor, { canControl, inCombat, reactionSpent }) {
    const t = key => game.i18n.localize(`HARDWIPE.Crew.${key}`);
    const lasts = rule => t(`Lasts.${rule.lasts}${inCombat || rule.lasts === "used" ? "" : "Before"}`);
    const typeName = rule => rule.known ? rule.name : t("NoType");
    const weaponButtons = setter => drawnWeapons(actor).map(weapon => ({
      kind: "weapon", setter, itemId: weapon.itemId, activityId: weapon.activityId, icon: "fa-crosshairs",
      label: `${t("Fire")} · ${weapon.name}`, tooltip: weapon.meta
    }));

    const own = this.primed(actor).map(effect => {
      const rule = this.settingsOf(actor, effect);
      let buttons = [];
      let cost = "";
      let tone = "";
      if (rule.fires === "crew") cost = t("CrewFires");
      else if (rule.payoff === "attack") {
        buttons = weaponButtons("");
        cost = t(reactionSpent ? "CostSpent" : "CostAttack");
        tone = reactionSpent ? "is-warn" : "";
        if (!buttons.length) cost = `${cost} · ${t("NoWeapon")}`;
      } else if (rule.payoff === "activity") {
        const setup = setupActivityId(rule.item?.system.activities);
        buttons = [...(rule.item?.system.activities ?? [])].filter(activity => activity.id !== setup).map(activity => ({
          kind: "activity", setter: "", itemId: rule.item.id, activityId: activity.id, icon: "fa-bolt",
          label: `${t("Fire")} · ${activity.name}`, tooltip: activity.labels?.activation ?? ""
        }));
        cost = t(buttons.length ? "CostActivity" : "NoPayoff");
      } else {
        buttons = [{ kind: "card", setter: "", itemId: "", activityId: "", icon: "fa-tower-broadcast", label: t("Trigger"), tooltip: "" }];
        cost = t("CostCard");
      }
      if (!rule.known) tone = "is-warn";
      return {
        effectId: effect.id, img: effect.img, own: true, tag: `${t("Armed")} · ${typeName(rule)}`, title: escapeHTML(rule.maneuver),
        text: [cost, lasts(rule)].filter(Boolean).join(" · "), tone, buttons: canControl ? buttons : [],
        canCancel: canControl, cancelLabel: t("Cancel")
      };
    });

    const allies = [];
    for (const mate of crewmates(actor)) {
      for (const effect of this.primed(mate)) {
        const rule = this.settingsOf(mate, effect);
        let buttons = [];
        if (canControl && rule.fires === "crew") {
          buttons = rule.payoff === "attack" ? weaponButtons(mate.uuid)
            : [{ kind: "card", setter: mate.uuid, itemId: "", activityId: "", icon: "fa-tower-broadcast", label: t("Trigger"), tooltip: "" }];
        }
        // "Mags has set up Entry Stack:" and the feature's description; only the names are inserted, escaped.
        allies.push({
          effectId: effect.id, img: effect.img, own: false, tag: `${mate.name} · ${typeName(rule)}`, tone: "",
          title: game.i18n.format(rule.description ? "HARDWIPE.Crew.SetUp" : "HARDWIPE.Crew.SetUpBare",
            { name: `<b>${escapeHTML(mate.name)}</b>`, maneuver: `<b>${escapeHTML(rule.maneuver)}</b>` }),
          text: rule.description, clamp: true, buttons
        });
      }
    }
    const rows = [...own, ...allies];
    return {
      show: rows.length > 0, rows, label: t("Label"),
      handle: actor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unit",
      count: game.i18n.format(rows.length === 1 ? "HARDWIPE.Crew.ChannelOne" : "HARDWIPE.Crew.Channels", { count: rows.length })
    };
  }
}

/* Settings: the GM's maneuver types ------------------------------------------------------------- */

let crewTypesConfigClass = null;

/** The settings window's class, built on first use: ApplicationV2 exists only inside Foundry, not in the unit tests. */
function crewTypesConfig() {
  return crewTypesConfigClass ??= class CrewTypesConfig extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "hardwipe-crew-types",
    tag: "form",
    classes: ["hardwipe-crew-types"],
    window: { title: "HARDWIPE.Crew.Types.Title", icon: "fas fa-people-group", resizable: true },
    position: { width: 820, height: "auto" },
    form: { handler: CrewTypesConfig.#save, closeOnSubmit: true },
    actions: { addType: CrewTypesConfig.#addType, removeType: CrewTypesConfig.#removeType, restore: CrewTypesConfig.#restore }
  };

  static #row(type, index) {
    const t = key => escapeHTML(game.i18n.localize(`HARDWIPE.Crew.${key}`));
    const select = (field, values, value) => `<select name="types.${index}.${field}" aria-label="${t(`Types.Col.${field}`)}">${values.map(entry =>
      `<option value="${entry}" ${entry === value ? "selected" : ""}>${t(`Types.Opt.${field}.${entry}`)}</option>`).join("")}</select>`;
    return `<tr class="hardwipe-crew-type" data-index="${index}">
      <td><input type="hidden" name="types.${index}.id" value="${escapeHTML(type.id ?? "")}">
        <input type="text" name="types.${index}.name" value="${escapeHTML(type.name ?? "")}" placeholder="${t("Types.NamePlaceholder")}" aria-label="${t("Types.Col.name")}" required></td>
      <td>${select("payoff", PAYOFFS, type.payoff)}</td>
      <td>${select("fires", FIRERS, type.fires)}</td>
      <td>${select("lasts", DURATIONS, type.lasts)}</td>
      <td><button type="button" class="icon fas fa-trash" data-action="removeType" data-tooltip="${t("Types.Remove")}" aria-label="${t("Types.Remove")}"></button></td>
    </tr>`;
  }

  async _renderHTML() {
    const t = key => escapeHTML(game.i18n.localize(`HARDWIPE.Crew.Types.${key}`));
    const rows = CrewManager.types().map((type, index) => CrewTypesConfig.#row(type, index)).join("");
    return `<div class="hardwipe-crew-types-body"><p class="hint">${t("Hint")}</p>
      <table class="hardwipe-crew-types-table">
        <thead><tr><th>${t("Col.name")}</th><th>${t("Col.payoff")}</th><th>${t("Col.fires")}</th><th>${t("Col.lasts")}</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="hint">${t("Rules")}</p></div>
      <footer class="form-footer">
        <button type="button" data-action="addType"><i class="fas fa-plus" inert></i><span>${t("Add")}</span></button>
        <button type="button" data-action="restore"><i class="fas fa-rotate-left" inert></i><span>${t("Restore")}</span></button>
        <button type="submit"><i class="fas fa-floppy-disk" inert></i><span>${t("Save")}</span></button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  static #addType() {
    const body = this.element.querySelector("tbody");
    const index = Math.max(-1, ...[...body.querySelectorAll("tr")].map(row => Number(row.dataset.index) || 0)) + 1;
    body.insertAdjacentHTML("beforeend", CrewTypesConfig.#row({ id: "", name: "", payoff: "card", fires: "owner", lasts: "turn" }, index));
    body.querySelector(`tr[data-index="${index}"] input[type="text"]`)?.focus();
  }

  static #removeType(event, target) {
    target.closest("tr")?.remove();
  }

  static async #restore() {
    await game.settings.set(MODULE_ID, CREW_TYPES_SETTING, {});
    this.render();
  }

  static async #save(event, form, formData) {
    const rows = foundry.utils.expandObject(formData.object).types ?? {};
    const list = Object.entries(rows).sort(([a], [b]) => Number(a) - Number(b)).map(([, row]) => row);
    await game.settings.set(MODULE_ID, CREW_TYPES_SETTING, { list: normalizeCrewTypes(list) });
  }
  };
}

/* Helpers ------------------------------------------------------------------------------------------- */

function notPrimed() {
  ui.notifications.warn(game.i18n.localize("HARDWIPE.Crew.NotPrimed"));
  return null;
}

/** The world's CREW card style. */
function cardStyle() {
  let style = "cam";
  try { style = game.settings.get(MODULE_ID, CREW_CARD_SETTING); } catch { style = "cam"; }
  return CARD_STYLES.includes(style) ? style : "cam";
}

/** Redraw the CREW cards in the log, after the style changes. */
function rerenderCrewCards() {
  for (const element of document.querySelectorAll("#chat .chat-message[data-message-id], .chat-popout .chat-message[data-message-id]")) {
    const message = game.messages.get(element.dataset.messageId);
    if (message?.flags?.[MODULE_ID]?.kind === "crew") ui.chat?.updateMessage?.(message);
  }
}

/** The words on a CREW card, from its stored data, in this client's language. */
function cardText(data) {
  const t = (key, values) => (values ? game.i18n.format(`HARDWIPE.Crew.${key}`, values) : game.i18n.localize(`HARDWIPE.Crew.${key}`));
  const setter = data.setter;
  const firer = data.firer ?? null;
  return {
    setter, firer, maneuver: data.maneuver, type: data.typeName || t("NoType"),
    line: firer ? t("FiredBy", { firer: firer.name, name: setter.name, maneuver: data.maneuver })
      : t("Fired", { name: setter.name, maneuver: data.maneuver }),
    user: t("TriggeredBy", { user: data.user }), link: t("CardLink"), executed: t("Stamp"),
    combo: t("Combo", { count: firer ? 2 : 1 }),
    clock: data.round ? t("Clock", { round: data.round, turn: data.turn }) : ""
  };
}

/**
 * The CREW card in a style, from its words (plain text, escaped here).
 * - Combo cam: the crew's helmet-cam feeds (one, or two staggered side by side when a crewmate fired someone else's
 *   maneuver), REC, the CREW COMBO counter and the name in big split-neon italic.
 * - Glitch feed: a compact kill-feed line, who >> the move, with hazard tape and an EXECUTED stamp.
 */
export function crewCardMarkup(style, data) {
  const e = text => escapeHTML(String(text ?? ""));
  const crew = data.firer ? [data.setter, data.firer] : [data.setter];
  if (style === "feed") {
    return `<div class="hardwipe-crewcard is-feed">
      <div class="hwcc-tape"><span class="hwcc-link">${e(data.link)}</span><span class="hwcc-type">${e(data.type)}</span></div>
      <div class="hwcc-row">
        <span class="hwcc-frames">${crew.map(member => `<img src="${e(member.img)}" alt="">`).join("")}</span>
        <span class="hwcc-who">${crew.map(member => e(member.name)).join("<br>+ ")}</span>
        <span class="hwcc-arrow" aria-hidden="true">&gt;&gt;</span>
        <span class="hwcc-move">${e(data.maneuver)}</span>
      </div>
      <div class="hwcc-foot"><span>${e(data.user)}</span><span class="hwcc-stamp">${e(data.executed)}</span></div>
    </div>`;
  }
  const feeds = crew.map((member, index) => `<figure class="hwcc-feed"><img src="${e(member.img)}" alt="">
      <span class="hwcc-cam">cam 0${index + 1} · ${e(member.name)}</span></figure>`).join("");
  return `<div class="hardwipe-crewcard is-cam${data.firer ? " is-duo" : ""}">
    <div class="hwcc-hud"><span class="hwcc-rec">rec</span><span>${e(data.link)}</span><span>${e(data.clock)}</span></div>
    <div class="hwcc-feeds">${feeds}
      <span class="hwcc-scan" aria-hidden="true"></span>
      <span class="hwcc-badge"><span>${e(data.combo)}</span></span>
      <div class="hwcc-caption"><div class="hwcc-type">${e(data.type)}</div><div class="hwcc-title">${e(data.maneuver)}</div></div>
    </div>
    <p class="hwcc-line">${e(data.line)}</p>
    <div class="hwcc-foot">${e(data.user)}</div>
  </div>`;
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
