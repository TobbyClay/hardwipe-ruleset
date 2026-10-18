import { escapeHTML } from "./hardwipe-state.js";
import { advControlHTML, arrivalWindow, d20Drawer } from "./hardwipe-attack-cards.js";

/**
 * Initiative cards: a compact row (the total with its natural d20, your place in the order as an ordinal, who you act
 * after and before, the advantage switch), and on the newest initiative card of a combat the whole order as a strip of
 * portraits. Places come from the live combat whenever a card is drawn, and every initiative card in the log redraws
 * when a combatant's initiative changes or another initiative card arrives, so a burst of rolls settles on its own:
 * nothing is written back to the messages. Combatants hidden from players stay out of what players see.
 */
const ARRIVAL_MS = 600;
const SCAN = 60; // How far back the log is searched for a combat's newest initiative card.

/* Pure helpers (unit-tested) ----------------------------------------------------------------- */

/**
 * Where one combatant stands. `turns` is the combat's own order (Foundry sorts by initiative and breaks ties);
 * entries without an initiative are still rolling.
 * @param {Array<{id: string, name: string, initiative: number|null}>} turns
 * @param {string} selfId
 * @returns {{slot: number, count: number, before: object|null, after: object|null, waiting: number}|null}
 */
export function initiativePlace(turns, selfId) {
  const rolled = turns.filter(entry => Number.isFinite(entry.initiative));
  const index = rolled.findIndex(entry => entry.id === selfId);
  if (index < 0) return null;
  return {
    slot: index + 1, count: turns.length,
    before: rolled[index - 1] ?? null, after: rolled[index + 1] ?? null,
    waiting: turns.length - rolled.length
  };
}

/** The ordinal suffix key for a place: Intl's English ordinal categories ("one" → st, "two" → nd, "few" → rd, "other" → th). */
export function ordinalKey(n, locale = "en") {
  try { return new Intl.PluralRules(locale, { type: "ordinal" }).select(n); } catch { return "other"; }
}

/**
 * The newest initiative card of a combat among the visible messages, newest last.
 * @param {Array<{id: string, combatId: string|null}>} messages
 */
export function newestFor(messages, combatId) {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].combatId === combatId) return messages[i].id;
  return null;
}

/* Combat lookup --------------------------------------------------------------------------------- */

const isInitiative = message => !!message?.flags?.core?.initiativeRoll;

/** The combat and combatant an initiative card belongs to: its speaker's token, else its actor. */
function combatantOf(message) {
  const { token, actor } = message.speaker ?? {};
  const match = combatant => (token && combatant.tokenId === token) || (!token && actor && combatant.actorId === actor);
  const combats = [game.combat, ...(game.combats ?? [])].filter(Boolean);
  for (const combat of combats) {
    const combatant = combat.combatants.find(match);
    if (combatant) return { combat, combatant };
  }
  return null;
}

/** The newest visible initiative card of this combat. */
function newestInitiative(combat) {
  const recent = (game.messages?.contents ?? []).slice(-SCAN).filter(message => isInitiative(message) && message.visible);
  return newestFor(recent.map(message => ({ id: message.id, combatId: combatantOf(message)?.combat.id ?? null })), combat.id);
}

/** Whether this card's roll was replaced by a later initiative card for the same combatant. */
function superseded(message, combatant) {
  const recent = (game.messages?.contents ?? []).slice(-SCAN);
  const after = recent.slice(recent.findIndex(entry => entry.id === message.id) + 1);
  return after.some(entry => isInitiative(entry) && combatantOf(entry)?.combatant.id === combatant.id);
}

/* Rendering --------------------------------------------------------------------------------------- */

const t = (key, data) => data ? game.i18n.format(`HARDWIPE.Init.${key}`, data) : game.i18n.localize(`HARDWIPE.Init.${key}`);

/**
 * Build the card around dnd5e's roll button (it stays the same element, so Ready Set Midi's advantage switch and
 * the dice drawer keep working), then fill in the live parts.
 */
export function renderInitiative(message, element, content, { button, breakdown, row, roll }) {
  const panel = document.createElement("div");
  panel.className = "hardwipe-check is-initiative hardwipe-init";
  panel.style.setProperty("--hw-check", "var(--hw-cyan)");
  panel.innerHTML = `
    <div class="hardwipe-init-row">
      <div class="hardwipe-check-roll hardwipe-init-roll"></div>
      <span class="hardwipe-init-ord" aria-live="polite"></span>
      <div class="hardwipe-init-flow"><small>${escapeHTML(t("Label"))}</small><span></span><span></span></div>
      ${advControlHTML(message, roll, button.dataset.rsmRollKey || "", {})}
    </div>
    <ol class="hardwipe-init-queue"></ol>`;
  const slot = panel.querySelector(".hardwipe-init-roll");
  slot.append(button);
  if (breakdown) slot.append(breakdown);
  row?.classList.add("hardwipe-check-source");
  content.prepend(panel);
  // The dice open under the whole row rather than inside the narrow total.
  const drawer = d20Drawer(message, button, roll, t("Label"), "check");
  if (drawer) panel.append(drawer);
  fillInitiative(panel, message);
  // Ready Set Midi's + (Bless, Guidance or a number after the roll) moves in beside the switch. It is the same
  // element, so its own click handler still runs it; it is added after this render, hence the second try.
  const moveBonus = () => {
    const bonus = element.querySelector(".message-header .rsr-addon-bonus-btn");
    const switcher = panel.querySelector(".hardwipe-init-row > .hardwipe-adv");
    if (bonus && switcher) switcher.before(bonus);
  };
  moveBonus();
  setTimeout(moveBonus, 0);
  const left = arrivalWindow(message, "initiative", ARRIVAL_MS);
  if (left && !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    panel.classList.add("is-arriving");
    setTimeout(() => panel.classList.remove("is-arriving"), left);
  }
  return true;
}

/** Draw the live parts: the ordinal, after / before, and the queue strip if this is the combat's newest card. */
function fillInitiative(panel, message) {
  const ord = panel.querySelector(".hardwipe-init-ord");
  const [first, second] = panel.querySelectorAll(".hardwipe-init-flow > span");
  const queue = panel.querySelector(".hardwipe-init-queue");
  const found = combatantOf(message);
  const previous = ord.dataset.slot;
  panel.classList.remove("is-newest", "is-superseded");
  if (!found) {
    ord.textContent = "";
    delete ord.dataset.slot;
    first.textContent = t("NoCombat");
    second.textContent = "";
    queue.replaceChildren();
    return;
  }
  const { combat, combatant } = found;
  const gm = game.user.isGM;
  const visible = combat.turns.filter(entry => gm || !entry.hidden || entry.id === combatant.id);
  const turns = visible.map(entry => ({ id: entry.id, name: entry.name, img: entry.img, initiative: entry.initiative, foe: entry.token?.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE }));
  const place = !gm && combatant.hidden ? null : initiativePlace(turns, combatant.id);
  if (!place || superseded(message, combatant)) {
    panel.classList.add("is-superseded");
    ord.textContent = "—";
    delete ord.dataset.slot;
    first.textContent = place ? t("Rerolled") : "";
    second.textContent = "";
    queue.replaceChildren();
    return;
  }
  ord.innerHTML = `${place.slot}<sup>${escapeHTML(t(`Ord.${ordinalKey(place.slot, game.i18n.lang)}`))}</sup>`;
  ord.dataset.slot = String(place.slot);
  if (previous && previous !== ord.dataset.slot && !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    ord.classList.remove("is-moved");
    void ord.offsetWidth;
    ord.classList.add("is-moved");
  }
  const name = entry => `<b>${escapeHTML(entry.name)}</b>`;
  first.innerHTML = place.before ? t("After", { name: name(place.before) }) : `<b>${escapeHTML(t("First"))}</b>`;
  second.innerHTML = place.after ? t("Before", { name: name(place.after) })
    : place.waiting ? escapeHTML(t("Waiting", { n: place.waiting })) : `<b>${escapeHTML(t("Last"))}</b>`;
  const newest = newestInitiative(combat) === message.id;
  panel.classList.toggle("is-newest", newest);
  queue.innerHTML = newest ? turns.map(entry => {
    const rolled = Number.isFinite(entry.initiative);
    const classes = [entry.id === combatant.id ? "is-self" : "", entry.foe ? "is-foe" : "", rolled ? "" : "is-pending"].filter(Boolean).join(" ");
    return `<li class="${classes}" data-tooltip="${escapeHTML(entry.name)}"><img src="${escapeHTML(entry.img ?? "")}" alt="${escapeHTML(entry.name)}">
      <span>${rolled ? escapeHTML(String(entry.initiative)) : '<i class="hardwipe-init-cursor">_</i>'}</span></li>`;
  }).join("") : "";
}

/* Live refresh ------------------------------------------------------------------------------------- */

let queued = false;

/** Redraw every initiative card on screen once per frame, however many changes arrived in it. */
function refreshAll() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    for (const panel of document.querySelectorAll(".hardwipe-init")) {
      const id = panel.closest("[data-message-id]")?.dataset.messageId;
      const message = id && game.messages.get(id);
      if (message) fillInitiative(panel, message);
    }
  });
}

export function registerInitiativeCards() {
  for (const hook of ["createCombatant", "updateCombatant", "deleteCombatant", "updateCombat", "deleteCombat"]) Hooks.on(hook, refreshAll);
  // A new initiative card takes the strip from the previous newest one; it is drawn just after this hook.
  Hooks.on("createChatMessage", message => { if (isInitiative(message)) setTimeout(refreshAll, 0); });
  Hooks.on("deleteChatMessage", message => { if (isInitiative(message)) refreshAll(); });
}
