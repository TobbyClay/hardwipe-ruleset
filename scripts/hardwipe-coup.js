import { MODULE_ID, isMook } from "./hardwipe-state.js";
import { heatBand } from "./heat-bands.js";

/**
 * Coup de Grace: hit a mook that is surprised in combat and it dies. Melee, ranged and spell attacks all count;
 * anything with Legendary Resistance is immune, and once the mission's Heat reaches Critical enemies are alert and
 * instant kills are off. With the GM's attack review on, the review row gets its own Coup de grâce button when it
 * can apply, and choosing it drops the target (Hit stays an ordinary hit); with the review off, the attacker's client
 * asks the GM once Ready Set Midi's workflow ends.
 * The kill is recorded on the attack card, which stamps the target Coup de grâce.
 */
const FLAG = "coupDeGrace";
const SURPRISED = "surprised";
let socket = null;

/** Why a hit would not be a Coup de Grace, or "" when it is. Pure: tested without Foundry. */
export function coupDeGraceBlocker({ mook, surprised, hp, band }) {
  if (!mook) return "notMook";
  if (!surprised) return "notSurprised";
  if (!(hp > 0)) return "down";
  if (band === "critical" || band === "lockdown") return "heat";
  return "";
}

/** The rule applied to a token on the canvas: its actor, its Surprised status and its scene's Heat. */
export function coupDeGraceFor(token) {
  const document = token?.document ?? token;
  const actor = document?.actor;
  const heat = document?.parent?.getFlag?.(MODULE_ID, "heat");
  return coupDeGraceBlocker({
    mook: isMook(actor),
    surprised: !!actor?.statuses?.has(SURPRISED),
    hp: Number(actor?.system?.attributes?.hp?.value) || 0,
    band: heatBand(heat?.current, heat?.max)
  });
}

export function registerCoupDeGrace() {
  registerSocket();
  Hooks.once("socketlib.ready", registerSocket);
  // Unreviewed attacks: the attacker's client asks the GM once the workflow has its hits.
  Hooks.on("midi-qol.RollComplete", workflow => void onUnreviewedAttack(workflow));
}

function registerSocket() {
  if (socket || !globalThis.socketlib) return;
  socket = socketlib.registerModule(MODULE_ID);
  socket?.register("coupDeGrace", function (cardId, uuids) { return gmCoupDeGrace(cardId, uuids, this?.socketdata?.userId); });
}

function reviewOn() {
  return game.settings.get(MODULE_ID, "attackReview") !== false;
}

async function onUnreviewedAttack(workflow) {
  if (reviewOn() || !workflow?.activity?.attack || !workflow.chatCard || workflow.aborted) return;
  const hits = [...(workflow.hitTargets ?? []), ...(workflow.hitTargetsEC ?? [])];
  const uuids = [...new Set(hits.filter(token => !coupDeGraceFor(token)).map(token => token.document.uuid))];
  if (!uuids.length) return;
  if (game.user.isGM) await gmCoupDeGrace(workflow.chatCard.id, uuids, game.user.id);
  else await socket?.executeAsGM("coupDeGrace", workflow.chatCard.id, uuids);
}

/**
 * GM side, for an unreviewed attack: the card must be an attack by the asking user (or a GM) that Ready Set Midi
 * recorded as hitting these targets.
 */
async function gmCoupDeGrace(cardId, uuids, userId) {
  const card = game.messages.get(cardId);
  const user = game.users.get(userId);
  if (!game.user.isGM || !card || !user || !Array.isArray(uuids)) return [];
  if (!user.isGM && card.author?.id !== user.id) return [];
  if (!card.getAssociatedActivity?.()?.attack) return [];
  const midi = card.flags?.["midi-qol"] ?? {};
  const hit = new Set([...(midi.hitTargetUuids ?? []), ...(midi.hitECTargetUuids ?? [])]);
  return applyCoupDeGrace(card, uuids.filter(uuid => hit.has(uuid)));
}

/**
 * On the GM's client: drop each hit target that still qualifies to 0 HP and record it on the attack card. Called
 * with hits the GM confirmed in the review, or hits checked by gmCoupDeGrace.
 * @param {ChatMessage} card
 * @param {string[]} uuids  Token UUIDs the attack hit.
 * @returns {Promise<string[]>} The UUIDs that died.
 */
export async function applyCoupDeGrace(card, uuids) {
  if (!game.user.isGM || !card) return [];
  const killed = [];
  for (const uuid of uuids) {
    if (typeof uuid !== "string") continue;
    const token = foundry.utils.fromUuidSync(uuid);
    if (!token?.actor || coupDeGraceFor(token)) continue;
    await token.actor.update({ "system.attributes.hp.value": 0 });
    killed.push(uuid);
  }
  if (killed.length) {
    const list = card.getFlag(MODULE_ID, FLAG) ?? [];
    await card.setFlag(MODULE_ID, FLAG, [...new Set([...list, ...killed])]);
  }
  return killed;
}

/** Targets this card killed with a Coup de Grace. */
export function coupTargets(message) {
  const list = message?.flags?.[MODULE_ID]?.[FLAG];
  return new Set(Array.isArray(list) ? list : []);
}
