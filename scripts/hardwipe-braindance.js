/**
 * Braindance: play through a memory inside an NPC's body, as part of Hardwipe.
 *
 * The GM pairs each player character with an NPC and enters the memory: every participant plays a full
 * temporary copy of that NPC under a synchronized overlay. On top of the original Braindance Suite this adds
 * editing layers with hidden clues, a timeline with replays, sensory echoes that can affect rolls, BD stamps on
 * chat cards, Roll Tracker credit for the real character, and a rollback of Hardwipe's walls and Mission Heat
 * when the memory ends ("memory isn't reality").
 *
 * Storage: the session is one world setting; the recovery record and the clue words live in GM-only journals.
 */
import { MODULE_ID, LAYERS, normalizeState, normalizePreferences, createController, currentCue, currentReplay, isParticipant } from "./braindance/bd-state.js";
import { MemoryForms, memoryFormOf, RECOVERY_SETTING } from "./braindance/bd-forms.js";
import { sceneSnapshot, rollbackPlan } from "./braindance/bd-reality.js";
import { ECHO_FLAG, echoEffectData, overloadTarget, scanBlocked } from "./braindance/bd-echoes.js";
import { CLUE_FLAG, CLUE_TEXT_FLAG, CLUE_JOURNAL_SETTING, normalizeClues, normalizeClueText, scanClues, revealClue, resetClues, visibleClues } from "./braindance/bd-clues.js";
import { BraindanceVisuals } from "./braindance/bd-visuals.js";
import { ClueCanvas } from "./braindance/bd-canvas.js";
import { createPanel, escapeHTML } from "./braindance/bd-panel.js";
import { CoverManager } from "./hardwipe-cover.js";

const SESSION = "braindanceSession";
const PREFERENCES = "braindancePreferences";
const MECHANICS_DEFAULT = "braindanceEchoMechanics";
const MESSAGE_FLAG = "braindance";
const STANDALONE = "braindance-suite";
const TOOL = "hardwipe-braindance";

export const bdText = (key, data) => data ? game.i18n.format(`HARDWIPE.Braindance.${key}`, data) : game.i18n.localize(`HARDWIPE.Braindance.${key}`);
const errorText = (key, data) => bdText(`Error.${key}`, data);
const replace = value => foundry.data.operators.ForcedReplacement.create(value);
const remove = () => globalThis._del ?? new foundry.data.operators.ForcedDeletion();

let disabled = false;
let controller = null;
let visuals = null;
let clueCanvas = null;
let panel = null;
let socket = null;
let previousCharacterId = null;
let previousControlVisibility = null;
let lastReplayId = null;
let echoTimer = null;
let scanArmed = false;

const state = () => normalizeState(game.settings.get(MODULE_ID, SESSION));
const preferences = () => normalizePreferences(game.settings.get(MODULE_ID, PREFERENCES));
const users = () => Array.from(game.users ?? []);
const activeGM = () => game.user.isGM && game.users.activeGM?.id === game.user.id;
const participant = () => isParticipant(state(), game.user, preferences());

/* Registration ------------------------------------------------------------------------------------- */

export function registerBraindance() {
  game.settings.register(MODULE_ID, SESSION, { scope: "world", config: false, type: Object, default: normalizeState(), onChange: refresh });
  game.settings.register(MODULE_ID, PREFERENCES, { scope: "client", config: false, type: Object, default: normalizePreferences(), onChange: refresh });
  game.settings.register(MODULE_ID, RECOVERY_SETTING, { scope: "world", config: false, type: String, default: "", onChange: refreshPanel });
  game.settings.register(MODULE_ID, CLUE_JOURNAL_SETTING, { scope: "world", config: false, type: String, default: "" });
  game.settings.register(MODULE_ID, MECHANICS_DEFAULT, {
    name: "HARDWIPE.Braindance.Setting.Mechanics", hint: "HARDWIPE.Braindance.Setting.MechanicsHint",
    scope: "world", config: true, type: Boolean, default: false
  });
  // The standalone module drives the same characters and controls. Stay out of its way until it is disabled.
  disabled = Boolean(game.modules.get(STANDALONE)?.active);
  if (disabled) return;
  game.settings.registerMenu(MODULE_ID, "braindanceMenu", {
    name: "HARDWIPE.Braindance.Menu", label: "HARDWIPE.Braindance.MenuLabel", hint: "HARDWIPE.Braindance.MenuHint",
    icon: "fa-solid fa-brain", type: BraindanceConsole, restricted: false
  });
  game.keybindings.register(MODULE_ID, "braindanceConsole", {
    name: "HARDWIPE.Braindance.Key.Console", editable: [{ key: "KeyB", modifiers: ["Alt"] }],
    onDown: () => { openConsole(); return true; }, restricted: false
  });
  game.keybindings.register(MODULE_ID, "braindanceVisuals", {
    name: "HARDWIPE.Braindance.Key.Visuals", editable: [{ key: "KeyB", modifiers: ["Alt", "Shift"] }],
    onDown: () => { void savePreferences({ ...preferences(), enabled: !preferences().enabled }); return true; }, restricted: false
  });
  game.keybindings.register(MODULE_ID, "braindanceLayer", {
    name: "HARDWIPE.Braindance.Key.Layer", editable: [{ key: "KeyL", modifiers: ["Alt"] }],
    onDown: () => { if (!participant()) return false; const keys = Object.keys(LAYERS); void setLayer(keys[(keys.indexOf(preferences().layer) + 1) % keys.length]); return true; },
    restricted: false
  });
  game.keybindings.register(MODULE_ID, "braindanceScan", {
    name: "HARDWIPE.Braindance.Key.Scan", editable: [{ key: "KeyS", modifiers: ["Alt"] }],
    onDown: () => { if (!participant()) return false; void scan(); return true; }, restricted: false
  });

  Hooks.on("getSceneControlButtons", controls => {
    const group = controls.tokens ?? controls.token;
    if (!group) return;
    group.tools ??= {};
    if (group.tools[TOOL]) return;
    group.tools[TOOL] = {
      name: TOOL, title: "HARDWIPE.Braindance.Tool", icon: "fa-solid fa-brain", button: true,
      visible: Boolean(game.user?.isGM || state().active),
      order: Object.values(group.tools).reduce((max, tool) => Math.max(max, Number(tool.order) || 0), 0) + 1,
      onChange: () => openConsole()
    };
  });
  // One render hook per application generation: ActorSheetV2 renders also fire renderApplicationV2.
  Hooks.on("renderApplicationV2", trackSheet);
  Hooks.on("renderApplication", trackSheet);
  Hooks.on("closeApplicationV2", app => visuals?.untrackSheet(app.id));
  Hooks.on("closeApplication", app => visuals?.untrackSheet(app.appId));
  Hooks.on("updateUser", followCharacterSheet);
  Hooks.on("deleteUser", refresh);
  Hooks.on("canvasReady", refresh);
  Hooks.on("updateScene", (scene, changes) => {
    if (scene.id === canvas.scene?.id && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) clueCanvas?.draw();
  });
  Hooks.on("preCreateChatMessage", stampMessage);
  Hooks.on("renderChatMessageHTML", renderStamp);
  Hooks.once("socketlib.ready", registerSocket);
  window.addEventListener("beforeunload", () => visuals?.destroy());
}

export function initializeBraindance() {
  if (disabled) {
    if (game.user.isGM) ui.notifications.warn(bdText("StandaloneActive"), { permanent: true });
    return;
  }
  registerSocket();
  const forms = new MemoryForms({
    game, resolve: uuid => fromUuid(uuid), t: errorText,
    createActor: (data, options) => Actor.implementation.create(data, options),
    createJournal: data => JournalEntry.implementation.create(data),
    randomId: () => foundry.utils.randomID(),
    reality: { snapshot: snapshotReality, rollback: rollbackReality }
  });
  controller = createController({
    read: () => game.settings.get(MODULE_ID, SESSION), write: value => game.settings.set(MODULE_ID, SESSION, value),
    getUser: () => game.user, forms, t: errorText, echoes: { apply: applyEchoes, clear: clearEchoes }
  });
  visuals = new BraindanceVisuals({
    getUser: () => game.user, getUsers: users, getPreferences: preferences, t: bdText,
    onLayer: layer => void setLayer(layer), onScan: () => void scan(), scanning: () => scanArmed
  });
  clueCanvas = new ClueCanvas({ entries: canvasEntries, still: () => preferences().reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches });
  game.hardwipe ??= {};
  game.hardwipe.braindance = Object.freeze({
    ...controller, open: openConsole, scan, setLayer,
    clues: Object.freeze({ list: () => clueList(), place: placeClue, edit: editClue, remove: removeClue, reset: resetSceneClues })
  });
  previousCharacterId = game.user.character?.id;
  if (memoryFormOf(game.user.character)) renderSheet(game.user.character);
  refresh();
  for (const app of foundry.applications.instances?.values() ?? []) trackSheet(app, app.element);
  for (const app of Object.values(ui.windows ?? {})) trackSheet(app, app.element);
  clueCanvas.draw();
  if (activeGM()) void reconcileEchoes();
}

/* Shared refresh ----------------------------------------------------------------------------------- */

function refresh() {
  if (disabled || !controller) return;
  const session = state();
  visuals?.apply(session);
  refreshPanel();
  const visible = Boolean(game.user?.isGM || session.active);
  if (visible !== previousControlVisibility) {
    previousControlVisibility = visible;
    // Rebuild cached tools when the GM starts or stops a memory on any client.
    if (ui.controls?.rendered) ui.controls.render({ reset: true });
  }
  if (!session.active && scanArmed) clueCanvas?.cancelPick();
  followReplay(session);
  if (activeGM()) scheduleEchoExpiry(session);
  clueCanvas?.draw();
}

function refreshPanel() { panel?.element?.querySelector(".bd-panel")?.bdRefresh?.(); }

async function savePreferences(value) {
  try { await game.settings.set(MODULE_ID, PREFERENCES, normalizePreferences(value)); }
  catch (error) { ui.notifications.error(error.message); }
}

async function setLayer(layer) {
  if (!Object.hasOwn(LAYERS, layer)) return;
  await savePreferences({ ...preferences(), layer });
}

/* Console ------------------------------------------------------------------------------------------ */

class BraindanceConsole extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "hardwipe-braindance-console",
    classes: ["hardwipe-braindance-app"],
    window: { title: "HARDWIPE.Braindance.Title", icon: "fa-solid fa-brain", resizable: true },
    position: { width: 500, height: 780 }
  };

  async _renderHTML() {
    return createPanel({
      controller, user: game.user, users: users(), t: bdText,
      actors: Array.from(game.actors ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      getPreferences: preferences, savePreferences: value => game.settings.set(MODULE_ID, PREFERENCES, normalizePreferences(value)),
      clues: game.user.isGM ? { list: clueList, place: placeClue, edit: editClue, remove: removeClue, reset: resetSceneClues } : null,
      captureView, mechanicsDefault: game.settings.get(MODULE_ID, MECHANICS_DEFAULT),
      notify: message => ui.notifications.error(message)
    });
  }

  _replaceHTML(result, content) {
    content.querySelector(".bd-panel")?.bdDispose?.();
    content.replaceChildren(result);
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    clueCanvas?.draw();
  }

  async _preClose(options) {
    this.element?.querySelector(".bd-panel")?.bdDispose?.();
    return super._preClose(options);
  }

  _onClose(options) {
    super._onClose?.(options);
    // Redraw once the window reports closed, so GM-only clue markers leave the canvas.
    setTimeout(() => clueCanvas?.draw(), 0);
  }
}

function openConsole() {
  if (disabled) return null;
  panel ??= new BraindanceConsole();
  panel.render({ force: true });
  return panel;
}

const consoleOpen = () => Boolean(panel?.rendered);

function captureView() {
  if (!canvas?.ready || !canvas.scene) return null;
  const { x, y } = canvas.stage.pivot;
  return { sceneId: canvas.scene.id, x, y, scale: canvas.stage.scale.x };
}

/* Sheets ------------------------------------------------------------------------------------------- */

function trackSheet(app, html) {
  const actor = app.document ?? app.actor ?? app.object;
  if (actor?.documentName !== "Actor") return;
  const element = app.element instanceof HTMLElement ? app.element : app.element?.[0] ?? html?.[0] ?? html;
  if (element instanceof HTMLElement) visuals?.trackSheet(app.id ?? app.appId, actor, element);
}

function renderSheet(actor) {
  const sheet = actor?.sheet;
  if (sheet) sheet.render(sheet instanceof foundry.applications.api.ApplicationV2 ? { force: true } : true);
}

async function followCharacterSheet(user, changes = {}) {
  refresh();
  if (user?.id !== game.user.id || !Object.hasOwn(changes, "character")) return;
  const oldActor = game.actors.get(previousCharacterId);
  const newActor = game.user.character;
  previousCharacterId = newActor?.id;
  if (!memoryFormOf(oldActor) && !memoryFormOf(newActor)) return;
  try {
    await oldActor?.sheet?.close();
    renderSheet(newActor);
  } catch (error) { console.warn(`${MODULE_ID} | Could not open the assigned character sheet`, error); }
}

/* Memory isn't reality ----------------------------------------------------------------------------- */

function snapshotReality() {
  return { at: Date.now(), scenes: game.scenes.map(scene => sceneSnapshot({
    id: scene.id, walls: scene.walls.map(wall => wall.toObject()), tiles: scene.tiles.map(tile => tile.toObject()), flags: scene.toObject().flags
  })) };
}

/** Put every recorded scene's Hardwipe walls, damage Tiles, Heat and wall history back, one atomic batch per scene. */
async function rollbackReality(record) {
  const changed = [];
  for (const recorded of record?.scenes ?? []) {
    const scene = game.scenes.get(recorded.sceneId);
    if (!scene) continue;
    const plan = rollbackPlan(recorded, {
      walls: scene.walls.map(wall => wall.toObject()), tiles: scene.tiles.map(tile => tile.toObject()), flags: scene.toObject().flags
    });
    if (!plan.changed) continue;
    const operations = plan.operations.map(({ replaceFlags, ...operation }) => ({
      ...operation, parent: scene, hardwipeWallWear: true,
      ...(operation.updates ? { updates: operation.updates.map(data => replaceFlags ? { ...data, flags: replace(data.flags) } : data) } : {})
    }));
    const flags = Object.fromEntries(Object.entries(plan.flags).map(([key, value]) => [key, value === null ? remove() : replace(value)]));
    if (Object.keys(flags).length) operations.push({ action: "update", documentName: "Scene", updates: [{ _id: scene.id, flags: { [MODULE_ID]: flags } }] });
    // Through the wall queue, so a wall impact in flight finishes before the scene is put back.
    await CoverManager._enqueue(() => foundry.documents.modifyBatch(operations));
    changed.push(scene.name);
  }
  if (changed.length) ui.notifications.info(bdText("RealityRestored", { scenes: changed.join(", ") }));
}

/* Mechanical echoes -------------------------------------------------------------------------------- */

async function formActors(session) {
  const actors = [];
  for (const uuid of session.actorUuids) {
    const actor = await fromUuid(uuid);
    if (memoryFormOf(actor)?.sessionId === session.id) actors.push(actor);
  }
  return actors;
}

async function applyEchoes(session, cue) {
  const cyberware = game.hardwipe?.cyberware;
  for (const actor of await formActors(session)) {
    let implantId = null;
    if (cue.kind === "overload" && cyberware) {
      const implants = actor.items.filter(item => cyberware.isCyberware(item)).map(item => ({
        id: item.id, enabled: cyberware.getState(item).enabled, active: (item.system.activities?.size ?? 0) > 0
      }));
      const target = overloadTarget(implants);
      if (target) {
        await cyberware.setEnabled(actor.items.get(target.id), false);
        implantId = target.id;
      }
    }
    const implant = implantId ? actor.items.get(implantId)?.name : null;
    await actor.createEmbeddedDocuments("ActiveEffect", [echoEffectData(cue, {
      name: bdText("Echo.Name", { cue: bdText(`Cue.${cue.kind}`) }),
      description: implant ? bdText("Echo.OverloadImplant", { implant }) : bdText(`Cue.${cue.kind}Effect`), implantId
    })]);
  }
}

/** Remove every echo effect from the current forms (except those of `keepCueId`), bringing Overload's implants back online. */
async function clearEchoes({ keepCueId = null } = {}) {
  const session = state();
  const cyberware = game.hardwipe?.cyberware;
  for (const actor of await formActors(session)) {
    const effects = actor.effects.filter(effect => effect.getFlag(MODULE_ID, ECHO_FLAG) && effect.getFlag(MODULE_ID, ECHO_FLAG).cueId !== keepCueId);
    for (const effect of effects) {
      const implant = actor.items.get(effect.getFlag(MODULE_ID, ECHO_FLAG).implantId ?? "");
      if (implant && cyberware) await cyberware.setEnabled(implant, true);
    }
    if (effects.length) await actor.deleteEmbeddedDocuments("ActiveEffect", effects.map(effect => effect.id));
  }
}

function scheduleEchoExpiry(session) {
  clearTimeout(echoTimer);
  const cue = currentCue(session);
  if (!cue?.mechanics) return;
  echoTimer = setTimeout(() => void clearEchoes().catch(error => console.warn(`${MODULE_ID} | Braindance echo expiry`, error)),
    Math.max(0, cue.endsAt - Date.now()) + 50);
}

async function reconcileEchoes() {
  const cue = currentCue(state());
  try { await clearEchoes({ keepCueId: cue?.mechanics ? cue.id : null }); }
  catch (error) { console.warn(`${MODULE_ID} | Braindance echo reconciliation`, error); }
}

/* Chat: BD stamps and Roll Tracker credit ---------------------------------------------------------- */

function stampMessage(message, data) {
  const session = state();
  if (!session.active) return;
  const actor = ChatMessage.implementation.getSpeakerActor(data.speaker ?? message.speaker ?? {});
  const form = memoryFormOf(actor);
  if (!form || form.sessionId !== session.id) return;
  const originalId = String(form.originalUuid ?? "").split(".").at(-1) || null;
  message.updateSource({ [`flags.${MODULE_ID}.${MESSAGE_FLAG}`]: {
    sessionId: session.id, label: session.label, preset: session.preset, formName: actor.name, originalId,
    originalName: form.originalName ?? game.actors.get(originalId)?.name ?? ""
  } });
}

function renderStamp(message, html) {
  const stamp = message.getFlag(MODULE_ID, MESSAGE_FLAG);
  if (!stamp || !(html instanceof HTMLElement) || html.querySelector(".hardwipe-bd-stamp")) return;
  const node = document.createElement("div");
  node.className = "hardwipe-bd-stamp";
  node.dataset.preset = stamp.preset ?? "clean";
  node.innerHTML = `<span class="hardwipe-bd-stamp-tag">BD</span><span class="hardwipe-bd-stamp-label">${escapeHTML(stamp.label)}</span>${stamp.originalName
    ? `<span class="hardwipe-bd-stamp-who">${escapeHTML(bdText("Stamp.As", { form: stamp.formName, original: stamp.originalName }))}</span>` : ""}`;
  node.dataset.tooltip = bdText("Stamp.Tooltip");
  const header = html.querySelector(".message-header");
  if (header) header.after(node);
  else html.prepend(node);
}

/* Replay ------------------------------------------------------------------------------------------- */

function followReplay(session) {
  const replay = currentReplay(session);
  if (!replay || replay.id === lastReplayId) { if (!replay) lastReplayId = null; return; }
  lastReplayId = replay.id;
  const view = replay.marker.view;
  if (!participant() || !view || view.sceneId !== canvas.scene?.id) return;
  const still = preferences().reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches;
  void canvas.animatePan({ x: view.x, y: view.y, scale: view.scale, duration: still ? 0 : 900 });
}

/* Clues -------------------------------------------------------------------------------------------- */

async function clueJournal({ create = false } = {}) {
  const uuid = game.settings.get(MODULE_ID, CLUE_JOURNAL_SETTING);
  const journal = uuid ? await fromUuid(uuid) : null;
  if (journal || !create) return journal;
  const created = await JournalEntry.implementation.create({ name: bdText("ClueJournal"), ownership: { default: 0 }, pages: [], flags: { [MODULE_ID]: { [CLUE_TEXT_FLAG]: {} } } });
  await game.settings.set(MODULE_ID, CLUE_JOURNAL_SETTING, created.uuid);
  return created;
}

/** GM-only: the private words for every clue, synchronously from the cached journal. */
function clueWords(sceneId) {
  const uuid = game.settings.get(MODULE_ID, CLUE_JOURNAL_SETTING);
  const journal = uuid ? fromUuidSync(uuid) : null;
  return journal?.getFlag(MODULE_ID, CLUE_TEXT_FLAG)?.[sceneId] ?? {};
}

const sceneClues = (scene = canvas.scene) => normalizeClues(scene?.getFlag(MODULE_ID, CLUE_FLAG));

function clueList(scene = canvas.scene) {
  if (!scene) return [];
  const words = game.user.isGM ? clueWords(scene.id) : {};
  return sceneClues(scene).map(clue => ({ ...clue, ...(clue.found ? {} : normalizeClueText(words[clue.id])),
    foundByName: game.users.get(clue.foundBy)?.name ?? "" }));
}

function canvasEntries() {
  const session = state();
  if (!canvas?.scene) return [];
  if (game.user.isGM && (session.active || consoleOpen()) && !participant()) return clueList().map(clue => ({ ...clue, gm: true }));
  if (!participant()) return [];
  const all = game.user.isGM ? clueList() : sceneClues();
  return visibleClues(all, { layer: preferences().layer }).map(clue => ({ ...clue, label: clue.found ? clue.label : "" }));
}

async function writeClues(scene, clues) {
  await scene.update({ [`flags.${MODULE_ID}.${CLUE_FLAG}`]: replace(normalizeClues(clues)) });
}

async function writeWords(scene, clueId, words) {
  const journal = await clueJournal({ create: true });
  const all = foundry.utils.deepClone(journal.getFlag(MODULE_ID, CLUE_TEXT_FLAG) ?? {});
  all[scene.id] ??= {};
  if (words) all[scene.id][clueId] = normalizeClueText(words);
  else delete all[scene.id][clueId];
  await journal.update({ [`flags.${MODULE_ID}.${CLUE_TEXT_FLAG}`]: replace(all) });
}

async function clueDialog(title, clue = {}) {
  const gridDistance = canvas.scene.grid.distance || 5;
  const radiusFeet = Math.round((clue.radius ?? canvas.dimensions.size) / canvas.dimensions.size * gridDistance);
  return foundry.applications.api.DialogV2.input({
    window: { title },
    content: `<div class="form-group"><label>${escapeHTML(bdText("ClueForm.Label"))}</label><input name="label" type="text" maxlength="80" value="${escapeHTML(clue.label ?? "")}" required></div>
      <div class="form-group stacked"><label>${escapeHTML(bdText("ClueForm.Text"))}</label><textarea name="text" rows="4" maxlength="2000">${escapeHTML(clue.text ?? "")}</textarea></div>
      <div class="form-group"><label>${escapeHTML(bdText("ClueForm.Layer"))}</label><select name="layer">${Object.keys(LAYERS).map(key => `<option value="${key}" ${key === (clue.layer ?? "visual") ? "selected" : ""}>${escapeHTML(bdText(`Layer.${key}`))}</option>`).join("")}</select></div>
      <div class="form-group"><label>${escapeHTML(bdText("ClueForm.Radius", { units: canvas.scene.grid.units || "ft" }))}</label><input name="radius" type="number" min="1" step="1" value="${radiusFeet}"></div>
      <p class="hint">${escapeHTML(bdText("ClueForm.Hint"))}</p>`,
    ok: { label: bdText("ClueForm.Save"), icon: "fa-solid fa-magnifying-glass" }, rejectClose: false
  });
}

const radiusPixels = feet => Math.max(10, Number(feet) / (canvas.scene.grid.distance || 5) * canvas.dimensions.size);

/** Pick a canvas point with the console minimized, so it never covers the spot. */
async function pickPoint() {
  const minimized = consoleOpen() && !panel.minimized;
  if (minimized) await panel.minimize();
  try { return await clueCanvas.pick(); }
  finally { if (minimized && panel?.rendered) await panel.maximize(); }
}

async function placeClue() {
  if (!game.user.isGM || !canvas.scene) return;
  ui.notifications.info(bdText("PickClue"));
  const point = await pickPoint();
  if (!point) return;
  const input = await clueDialog(bdText("ClueForm.New"));
  if (!input) return;
  const scene = canvas.scene;
  const id = foundry.utils.randomID();
  await writeWords(scene, id, input);
  await writeClues(scene, [...sceneClues(scene), { id, x: point.x, y: point.y, layer: input.layer, radius: radiusPixels(input.radius) }]);
}

async function editClue(id) {
  const scene = canvas.scene;
  const clue = clueList(scene).find(entry => entry.id === id);
  if (!clue) return;
  const words = normalizeClueText(clueWords(scene.id)[id]);
  const input = await clueDialog(bdText("ClueForm.Edit"), { ...clue, ...words });
  if (!input) return;
  await writeWords(scene, id, input);
  await writeClues(scene, sceneClues(scene).map(entry => entry.id !== id ? entry : {
    ...entry, layer: input.layer, radius: radiusPixels(input.radius), ...(entry.found ? normalizeClueText(input) : {})
  }));
}

async function removeClue(id) {
  const scene = canvas.scene;
  await writeClues(scene, sceneClues(scene).filter(entry => entry.id !== id));
  await writeWords(scene, id, null);
}

async function resetSceneClues() {
  const scene = canvas.scene;
  if (scene) await writeClues(scene, resetClues(sceneClues(scene)));
}

/* Scanning ----------------------------------------------------------------------------------------- */

function registerSocket() {
  if (socket || !globalThis.socketlib) return;
  socket = socketlib.registerModule(MODULE_ID);
  socket.register("braindanceScan", function (request) { return resolveScan(request, this?.socketdata?.userId); });
}

/** Arm a scan: the participant's next click on the canvas reads the spot on their current layer. */
async function scan() {
  if (!participant()) return;
  if (scanArmed) { clueCanvas.cancelPick(); return; }
  scanArmed = true;
  visuals?.tick();
  ui.notifications.info(bdText("Scan.Armed", { layer: bdText(`Layer.${preferences().layer}`) }));
  let point;
  try { point = await pickPoint(); }
  finally { scanArmed = false; visuals?.tick(); }
  if (!point || !canvas.scene) return;
  const request = { sceneId: canvas.scene.id, x: point.x, y: point.y, layer: preferences().layer };
  let result;
  try {
    result = game.user.isGM ? await resolveScan(request, game.user.id)
      : socket ? await socket.executeAsGM("braindanceScan", request) : { result: "offline" };
  } catch (error) {
    console.warn(`${MODULE_ID} | Braindance scan`, error);
    result = { result: "offline" };
  }
  clueCanvas.ping(point, request.layer, result?.result === "found");
  const messages = {
    found: () => bdText("Scan.Found", { label: result.label }),
    "wrong-layer": () => bdText("Scan.WrongLayer", { layer: bdText(`Layer.${result.layer}`) }),
    blocked: () => bdText("Scan.Blocked"),
    nothing: () => bdText("Scan.Nothing"),
    offline: () => bdText("Scan.Offline")
  };
  ui.notifications[result?.result === "found" ? "info" : "warn"]((messages[result?.result] ?? messages.offline)());
}

/** GM side of a scan: verify the scanner, reveal the clue, log it on the timeline and tell the participants. */
async function resolveScan(request, userId) {
  if (!game.user.isGM) return { result: "offline" };
  const session = state();
  const scanner = game.users.get(userId);
  if (!session.active || !scanner || !(session.participantIds.includes(scanner.id) || scanner.isGM)) return { result: "nothing" };
  if (scanBlocked(currentCue(session))) return { result: "blocked" };
  const scene = game.scenes.get(request?.sceneId);
  if (!scene || !Object.hasOwn(LAYERS, request.layer)) return { result: "nothing" };
  const point = { x: Number(request.x), y: Number(request.y) };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { result: "nothing" };
  const hit = scanClues(sceneClues(scene), point, request.layer);
  if (!hit) return { result: "nothing" };
  if (!hit.clue) return { result: "wrong-layer", layer: hit.near };
  const words = normalizeClueText(clueWords(scene.id)[hit.clue.id]);
  const label = words.label || bdText("Console.UnnamedClue");
  await writeClues(scene, revealClue(sceneClues(scene), hit.clue.id, { label, text: words.text }, scanner.id));
  await controller.logClue({ label, view: { sceneId: scene.id, x: hit.clue.x, y: hit.clue.y, scale: 1 } });
  const whisper = [...new Set([...session.participantIds, ...game.users.filter(user => user.isGM).map(user => user.id)])];
  await ChatMessage.implementation.create({
    whisper, speaker: { alias: bdText("Title") },
    content: `<div class="hardwipe-bd-card" style="--bd-layer:${LAYERS[hit.clue.layer].color}">
      <header><span class="hardwipe-bd-card-tag">BD // ${escapeHTML(bdText("Scan.CardTitle"))}</span><span>${LAYERS[hit.clue.layer].symbol} ${escapeHTML(bdText(`Layer.${hit.clue.layer}`))}</span></header>
      <h3>${escapeHTML(label)}</h3>${words.text ? `<p>${escapeHTML(words.text).replace(/\n/g, "<br>")}</p>` : ""}
      <footer>${escapeHTML(bdText("Scan.CardBy", { name: scanner.name, memory: session.label }))}</footer></div>`,
    flags: { [MODULE_ID]: { braindanceClue: { sceneId: scene.id, clueId: hit.clue.id } } }
  });
  return { result: "found", label };
}
