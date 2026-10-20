import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";

/**
 * Reposition: a card whose activity puts down an area gets a button to place it again. D&D5e's own placement runs
 * (the same preview, rotation and snapping). The new shapes then move the region this use already put down, so its
 * behaviours, its concentration link and Ready Set Midi's record of it stay. When that region is gone (removed, or
 * never placed), the placement creates a new one, and the card remembers it for the next move.
 */
const FLAG = "areas";
let socket = null;

export function registerAreaReposition() {
  registerSocket();
  Hooks.once("socketlib.ready", registerSocket);
}

function registerSocket() {
  if (socket || !globalThis.socketlib) return;
  socket = socketlib.registerModule(MODULE_ID);
  socket?.register("areaReposition", function (messageId, regionUuid, move) { return gmMove(messageId, regionUuid, move, this?.socketdata?.userId); });
  socket?.register("areaRemember", function (messageId, uuids) { return gmRemember(messageId, uuids, this?.socketdata?.userId); });
}

/** The regions this card's use put down that are still on a scene. */
export function cardRegions(message) {
  const midi = message.flags?.["midi-qol"] ?? {};
  const uuids = [...(Array.isArray(midi.templateUuids) ? midi.templateUuids : []), midi.templateUuid, ...(message.flags?.[MODULE_ID]?.[FLAG] ?? [])];
  return [...new Set(uuids.filter(uuid => typeof uuid === "string" && uuid))]
    .map(uuid => fromUuidSync(uuid)).filter(region => region?.documentName === "Region");
}

/** Who may move the area: the card's author, the actor's owners and the GM, with leave to draw regions. */
function canReposition(message, activity) {
  if (!activity?.target?.template?.type || !game.canvas?.scene) return false;
  if (!game.user.isGM && !game.user.can("REGION_CREATE")) return false;
  return userMay(message, game.user);
}

/**
 * The button for the card's action strip, or null when the card puts down no area or the viewer may not move it.
 * @param {ChatMessage} message
 * @param {Activity} activity
 * @returns {HTMLButtonElement|null}
 */
export function repositionButton(message, activity) {
  if (!canReposition(message, activity)) return null;
  const placed = cardRegions(message).length > 0;
  const label = game.i18n.localize(`HARDWIPE.Area.${placed ? "Reposition" : "Place"}`);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hardwipe-program-action hardwipe-area-move";
  button.dataset.tooltip = game.i18n.localize(`HARDWIPE.Area.${placed ? "RepositionHint" : "PlaceHint"}`);
  button.innerHTML = `<i class="fa-solid ${placed ? "fa-up-down-left-right" : "fa-bullseye"}" inert></i><span class="hardwipe-program-action-label">${escapeHTML(label)}</span>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    reposition(message).catch(error => {
      console.error("Hardwipe | Reposition", error);
      ui.notifications.error(game.i18n.localize("HARDWIPE.Area.Failed"));
    }).finally(() => { button.disabled = false; });
  });
  return button;
}

/** The activity as it was used: an upcast card places the area of the level it was cast at. */
function usedActivity(message) {
  const activity = message.getAssociatedActivity?.();
  const scaling = message.system?.scaling ?? 0;
  if (!activity || !scaling) return activity;
  const item = activity.item.clone({ "flags.dnd5e.scaling": scaling }, { keepId: true });
  return item.system.activities.get(activity.id) ?? activity;
}

/**
 * Run D&D5e's placement for the card's activity. With a region to move, the placed shapes are taken and nothing is
 * created; otherwise the placement creates its region as usual.
 * @returns {Promise<{ data: object[]|null, created: RegionDocument[] }>}
 */
async function place(activity, capture) {
  let data = null;
  const hook = Hooks.on("dnd5e.createMeasuredTemplate", (used, regionData) => {
    if (!capture || used?.uuid !== activity.uuid) return;
    data = regionData;
    return false;
  });
  let created = [];
  try {
    created = (await dnd5e.canvas.TemplatePlacement.fromActivity(activity)) ?? [];
  } finally {
    Hooks.off("dnd5e.createMeasuredTemplate", hook);
  }
  return { data, created };
}

/** Place the card's area again: move the region it put down, or create one when there is none. */
export async function reposition(message) {
  const activity = usedActivity(message);
  if (!activity?.target?.template?.type) return;
  const region = cardRegions(message).find(entry => entry.parent?.id === canvas.scene?.id) ?? null;
  const { data, created } = await place(activity, !!region);
  if (region) {
    // Cancelled placement: the area stays where it was.
    if (!data?.length) return;
    const move = { shapes: data.flatMap(entry => entry.shapes ?? []), attachment: data[0].attachment ?? { token: null } };
    if (region.canUserModify(game.user, "update")) await moveRegion(region, move);
    else await socket?.executeAsGM("areaReposition", message.id, region.uuid, move);
    return;
  }
  if (!created.length) return;
  const uuids = created.map(entry => entry.uuid);
  if (message.canUserModify(game.user, "update")) await remember(message, uuids);
  else await socket?.executeAsGM("areaRemember", message.id, uuids);
}

function remember(message, uuids) {
  return message.setFlag(MODULE_ID, FLAG, [...new Set([...(message.flags?.[MODULE_ID]?.[FLAG] ?? []), ...uuids])]);
}

/** Whether a user may move this card's area: its author, or an owner of the actor that used it. */
function userMay(message, user) {
  return !!user && (user.isGM || message.author?.id === user.id || !!message.getAssociatedActivity?.()?.actor?.testUserPermission(user, "OWNER"));
}

function moveRegion(region, { shapes, attachment }) {
  return region.update({ shapes, attachment: { token: attachment?.token ?? null } });
}

/** GM side: move a region the requesting user may not edit, when it belongs to a card that user may reposition. */
async function gmMove(messageId, regionUuid, move, userId) {
  const message = game.messages.get(messageId);
  if (!message || !userMay(message, game.users.get(userId))) return false;
  const region = cardRegions(message).find(entry => entry.uuid === regionUuid);
  if (!region || !Array.isArray(move?.shapes) || !move.shapes.length) return false;
  await moveRegion(region, move);
  return true;
}

/** GM side: note the regions a user just placed for a card they may not edit, when they are that card's areas. */
async function gmRemember(messageId, uuids, userId) {
  const message = game.messages.get(messageId);
  const activity = message?.getAssociatedActivity?.();
  if (!message || !activity || !userMay(message, game.users.get(userId)) || !Array.isArray(uuids)) return false;
  const regions = uuids.map(uuid => fromUuidSync(uuid)).filter(region => region?.documentName === "Region" && region.flags?.dnd5e?.activity === activity.uuid);
  if (!regions.length) return false;
  await remember(message, regions.map(region => region.uuid));
  return true;
}
