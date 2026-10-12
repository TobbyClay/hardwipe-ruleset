import { MODULE_ID } from "./hardwipe-state.js";

/**
 * An attack card fills in over several updates: Ready Set Midi rolls the attack, checks hits, Hardwipe
 * posts the GM review, then the damage is rolled. Shown live, the card flashes Midi's own hit or miss and
 * redraws half a dozen times. Instead, the attacker's client marks an auto-rolled attack card as
 * assembling when it is created, and clears the mark once the card has settled (awaiting the GM with its
 * damage, finished, or waiting for a click). Until then every client keeps the card, and its GM review,
 * out of the log; it then appears once, complete. A short grace period means a stalled or aborted
 * workflow can never hide a card for good.
 */
const FLAG = "assembling";
const GRACE_MS = 6000;
const STALE_MS = 30000; // A card still marked after this (its attacker's client went away mid-roll) always shows.
const firstSeen = new Map(); // Message id -> when this client first rendered it.
const hidden = new Set();    // Messages this client has kept out of the log, to scroll into view when they appear.

/** Whether the card is still being assembled on its attacker's client (and within the grace period here). */
export function isAssembling(message) {
  if (!message?.getFlag?.(MODULE_ID, FLAG)) return false;
  const now = Date.now();
  if (now - (message.timestamp ?? 0) > STALE_MS) return false;
  if (!firstSeen.has(message.id)) firstSeen.set(message.id, now);
  return now - firstSeen.get(message.id) < GRACE_MS;
}

/** The attacker's client: the card is complete, show it. Safe to call more than once. */
export async function settleCard(message) {
  const card = message?.id ? game.messages.get(message.id) : null;
  if (!card?.getFlag(MODULE_ID, FLAG) || !card.isOwner) return;
  try { await card.unsetFlag(MODULE_ID, FLAG); }
  catch (error) { console.warn(`${MODULE_ID} | Could not show the assembled card`, error); }
}

/** Midi rolls this attack as soon as its card exists: the card would otherwise fill in on screen. */
function rollsAtOnce(activity) {
  if (!activity?.attack && activity?.type !== "attack") return false;
  let config = null;
  try { config = globalThis.MidiQOL?.configSettings?.(); } catch { config = null; }
  if (!config) return false;
  return !!(game.user.isGM ? config.gmAutoAttack : config.autoRollAttack);
}

/** A GM review (attack or wall) follows its source card: hidden while the source is assembling. */
function sourceOf(message) {
  const flags = message.flags?.[MODULE_ID] ?? {};
  const id = flags.attackReviewGM?.cardId ?? flags.coverReview?.sourceMessageId;
  return id ? game.messages.get(id) : null;
}

function scrollIntoView(message) {
  setTimeout(() => {
    if (!ui.chat?.rendered) return;
    if (ui.chat.isAtBottom || message.isAuthor) ui.chat.scrollBottom?.({ waitImages: true });
    if (ui.chat.popout?.rendered && (ui.chat.popout.isAtBottom || message.isAuthor)) ui.chat.popout.scrollBottom?.({ waitImages: true });
  }, 30);
}

function mark(message, html) {
  const element = html?.querySelector ? html : html?.[0];
  if (!element) return;
  const source = sourceOf(message);
  const assembling = isAssembling(message) || (!!source && isAssembling(source));
  element.classList.toggle("hardwipe-assembling", assembling);
  if (assembling) {
    if (hidden.has(message.id)) return;
    hidden.add(message.id);
    // Past the grace period the card shows whatever state it reached.
    setTimeout(() => {
      const current = game.messages.get(message.id);
      if (current && hidden.has(message.id)) ui.chat?.updateMessage?.(current);
    }, GRACE_MS + 100);
    return;
  }
  if (hidden.delete(message.id)) scrollIntoView(message);
}

export function registerAssembly() {
  Hooks.on("dnd5e.preCreateUsageMessage", (activity, config) => {
    if (config?.data && rollsAtOnce(activity)) foundry.utils.setProperty(config.data, `flags.${MODULE_ID}.${FLAG}`, true);
  });
  // First, so later render hooks can tell a card is still out of the log.
  Hooks.on("renderChatMessageHTML", (message, html) => mark(message, html));
  Hooks.on("updateChatMessage", (message, changes) => {
    const flags = changes.flags?.[MODULE_ID];
    if (!flags || !(`-=${FLAG}` in flags || FLAG in flags)) return;
    // The reviews that waited on this card appear with it.
    const own = message.flags?.[MODULE_ID] ?? {};
    for (const id of [own.attackReview?.reviewMessageId, own.coverAttack?.reviewMessageId]) {
      const review = id && game.messages.get(id);
      if (review && hidden.has(review.id)) ui.chat?.updateMessage?.(review);
    }
  });
  Hooks.on("deleteChatMessage", message => { firstSeen.delete(message.id); hidden.delete(message.id); });
}
