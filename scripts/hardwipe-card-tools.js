import { MODULE_ID } from "./hardwipe-state.js";
import { applyTextSize, foldAfterMinutes } from "./hardwipe-attack-cards.js";
import { usesOf } from "./hardwipe-implant-cards.js";

/**
 * Card tools that work across Hardwipe's chat cards:
 * - snapshots taken as a card is posted (an item's uses, the spells held during a concentration save),
 *   so later changes never rewrite an older card;
 * - the viewer's card text size;
 * - folding: settled cards older than the viewer's setting shrink to their title, verdict and totals.
 *   A click on a folded card, or the header toggle, opens it again; the choice lasts for this session.
 */
const folds = new Map(); // Message id -> folded (true) or opened (false), as this viewer chose.
const FOLD_SWEEP_MS = 30000;

export function registerCardTools() {
  Hooks.on("preCreateChatMessage", message => snapshot(message));
  // After the card renderers (registered at setup before this), so the cards are built.
  Hooks.once("setup", () => Hooks.on("dnd5e.renderChatMessage", (message, html) => foldControl(message, html)));
  Hooks.once("ready", () => {
    applyTextSize();
    setInterval(foldSweep, FOLD_SWEEP_MS);
  });
  Hooks.on("deleteActiveEffect", effect => refreshConcentration(effect));
}

/* Snapshots ----------------------------------------------------------------------------------- */

function snapshot(message) {
  const update = {};
  if (message.type === "usage") {
    const item = message.getAssociatedItem?.();
    const uses = item ? usesOf(item, message.getAssociatedActivity?.()) : null;
    if (uses) update[`flags.${MODULE_ID}.uses`] = uses;
  }
  if (message.type === "save" && message.system?.type === "concentration") {
    const actor = ChatMessage.implementation.getSpeakerActor(message.speaker);
    const effects = [...(actor?.concentration?.effects ?? [])];
    if (effects.length) update[`flags.${MODULE_ID}.concentration`] = { names: effects.map(concentrationName), effects: effects.map(effect => effect.id) };
  }
  if (Object.keys(update).length) message.updateSource(update);
}

/** The spell behind a concentration effect ("Concentrating: Bless" -> "Bless"). */
function concentrationName(effect) {
  const origin = effect.origin ? foundry.utils.fromUuidSync(effect.origin) : null;
  const item = origin?.documentName === "Item" ? origin : origin?.item;
  return item?.name ?? String(effect.name ?? "").replace(/^[^:]*:\s*/, "");
}

/** A concentration effect ending (Ready Set Midi ends it on a failed save) updates the cards that offered to end it. */
function refreshConcentration(effect) {
  if (!effect.statuses?.has?.(CONFIG.specialStatusEffects?.CONCENTRATING ?? "concentrating")) return;
  for (const message of game.messages.contents.slice(-30)) {
    if ((message.flags?.[MODULE_ID]?.concentration?.effects ?? []).includes(effect.id)) ui.chat?.updateMessage?.(message);
  }
}

/* Folding ------------------------------------------------------------------------------------- */

function settled(element) {
  return !element.classList.contains("hardwipe-review-pending")
    && !element.querySelector(".hardwipe-save-row.is-pending, .hardwipe-verdict.is-pending, .hardwipe-program-status.is-running, .hardwipe-wall-card.is-review:not(.is-resolved), .hardwipe-review-actions button:not(:disabled)");
}

function shouldFold(message, element) {
  const minutes = foldAfterMinutes();
  return minutes > 0 && Date.now() - (message.timestamp ?? 0) > minutes * 60000 && settled(element);
}

function foldControl(message, html) {
  const element = html?.querySelector ? html : html?.[0];
  // Attack, spell, implant, item and feature cards, and Hardwipe's system cards and GM reviews.
  if (!element?.classList.contains("hardwipe-attack-message") && !element?.querySelector(".message-content .hardwipe-chat-card:not(.hardwipe-msg-card)")) return;
  element.classList.add("hardwipe-foldable");
  const content = element.querySelector(".message-content");
  if (content) content.dataset.hwFoldHint = game.i18n.localize("HARDWIPE.Cards.FoldHint");
  const meta = element.querySelector(".message-header .message-metadata");
  if (meta && !meta.querySelector(".hardwipe-fold-toggle")) {
    meta.insertAdjacentHTML("afterbegin", `<a class="hardwipe-fold-toggle" role="button"><i class="fas fa-compress" inert></i></a>`);
    meta.querySelector(".hardwipe-fold-toggle").addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      setFold(element, message, !element.classList.contains("is-folded"), true);
    });
  }
  // A click anywhere on a folded card opens it (and does nothing else).
  content?.addEventListener("click", event => {
    if (!element.classList.contains("is-folded")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setFold(element, message, false, true);
  }, { capture: true });
  setFold(element, message, folds.get(message.id) ?? shouldFold(message, element), false);
}

function setFold(element, message, folded, chosen) {
  if (chosen) folds.set(message.id, folded);
  element.classList.toggle("is-folded", folded);
  const toggle = element.querySelector(".hardwipe-fold-toggle");
  if (!toggle) return;
  const label = game.i18n.localize(folded ? "HARDWIPE.Cards.Unfold" : "HARDWIPE.Cards.Fold");
  toggle.dataset.tooltip = label;
  toggle.setAttribute("aria-label", label);
  toggle.querySelector("i").className = `fas ${folded ? "fa-expand" : "fa-compress"}`;
}

/** Fold cards that have aged past the setting, unless the viewer is reading further up the log. */
function foldSweep() {
  if (!foldAfterMinutes()) return;
  for (const log of document.querySelectorAll("#chat .chat-log, .chat-popout .chat-log")) {
    const fromBottom = log.scrollHeight - log.scrollTop - log.clientHeight;
    if (fromBottom > 120) continue;
    let changed = false;
    for (const element of log.querySelectorAll(".chat-message.hardwipe-foldable:not(.is-folded)")) {
      const message = game.messages.get(element.dataset.messageId);
      if (!message || folds.has(message.id) || !shouldFold(message, element)) continue;
      setFold(element, message, true, false);
      changed = true;
    }
    // Keep the view anchored to the bottom of the log.
    if (changed) log.scrollTop = log.scrollHeight - log.clientHeight - fromBottom;
  }
}
