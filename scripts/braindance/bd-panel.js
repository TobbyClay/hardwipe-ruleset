/**
 * The Braindance console. GMs run the memory from it; everyone gets their own comfort controls.
 * Built as plain DOM so the same code renders in Foundry and in the tests.
 */
import { PRESETS, CUES, LAYERS, normalizePreferences, currentCue, durationLabel } from "./bd-state.js";
import { controllingUsers, memoryFormOf } from "./bd-forms.js";

export const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const checked = value => value ? "checked" : "";
const KIND_ICONS = { start: "fa-play", mark: "fa-bookmark", cue: "fa-wave-square", clue: "fa-magnifying-glass" };

/**
 * @param {object} deps
 * @param {object} deps.controller           createController() result
 * @param {object} deps.user, deps.users, deps.actors
 * @param {Function} deps.t                  (key, data) -> HARDWIPE.Braindance.<key>
 * @param {Function} deps.getPreferences, deps.savePreferences
 * @param {object} [deps.clues]              GM only: { list(), place(), edit(id), remove(id), reset() }
 * @param {Function} [deps.captureView]      () -> { sceneId, x, y, scale } | null
 * @param {boolean} [deps.mechanicsDefault] the world default for "Echoes affect rolls"
 * @param {Function} [deps.notify]
 */
export function createPanel({ controller, user, users, actors = [], t, getPreferences, savePreferences, clues = null, captureView = () => null, mechanicsDefault = false, notify = () => {} }) {
  const state = controller.getState();
  const preferences = normalizePreferences(getPreferences());
  const characters = actors.filter(actor => actor.type === "character" && !memoryFormOf(actor) && controllingUsers(actor, users).length);
  const npcs = actors.filter(actor => actor.type === "npc" && !memoryFormOf(actor));
  const pairingRows = pairs => pairs.map(pair => `<div class="bd-pairing-row">
    <label class="bd-field">${escapeHTML(t("Console.Character"))}<select name="characterUuid" required><option value="">${escapeHTML(t("Console.ChooseCharacter"))}</option>${characters.map(actor => `<option value="${escapeHTML(actor.uuid)}" ${actor.uuid === pair.characterUuid ? "selected" : ""}>${escapeHTML(actor.name)} (${escapeHTML(controllingUsers(actor, users).map(person => person.name).join(", "))})</option>`).join("")}</select></label>
    <label class="bd-field">${escapeHTML(t("Console.Npc"))}<select name="npcUuid" required><option value="">${escapeHTML(t("Console.ChooseNpc"))}</option>${npcs.map(actor => `<option value="${escapeHTML(actor.uuid)}" ${actor.uuid === pair.npcUuid ? "selected" : ""}>${escapeHTML(actor.name)}</option>`).join("")}</select></label>
    <button type="button" class="bd-quiet" data-bd-remove>${escapeHTML(t("Console.RemovePairing"))}</button></div>`).join("");
  const section = (number, key, body) => `<section class="bd-section"><h2><span>${number}</span> ${escapeHTML(t(`Console.${key}`))}</h2>${body}</section>`;

  const root = document.createElement("section");
  root.className = "bd-panel";
  root.innerHTML = `<header class="bd-panel-heading"><div><div class="bd-eyebrow">HARDWIPE // ${escapeHTML(t("Console.Eyebrow"))}</div>
      <h1>BRAIN<span>DANCE</span></h1><p>${escapeHTML(t("Console.Tagline"))}</p></div><span class="bd-state-pill"></span></header>
    <div class="bd-panel-status" role="status" aria-live="polite"></div>
    ${user.isGM ? `<form class="bd-session-form">
      ${section("01", "Memory", `
        <label class="bd-field">${escapeHTML(t("Console.Name"))}<input name="label" type="text" maxlength="90" value="${escapeHTML(state.label)}" autocomplete="off"></label>
        <div class="bd-preset-grid">${Object.entries(PRESETS).map(([key, preset]) => `<label class="bd-preset" style="--bd-preset-color:${preset.color}">
          <input type="radio" name="preset" value="${key}" ${checked(state.preset === key)}><span class="bd-preset-swatch"></span><strong>${escapeHTML(t(`Preset.${key}`))}</strong><small>${escapeHTML(t(`Preset.${key}Hint`))}</small></label>`).join("")}</div>
        <label class="bd-field bd-slider-label">${escapeHTML(t("Console.Intensity"))} <output data-bd-output="intensity">${state.intensity}%</output>
          <input type="range" name="intensity" min="0" max="100" step="1" value="${state.intensity}"></label>
        <label class="bd-checkbox"><input name="sheetGlitch" type="checkbox" ${checked(state.sheetGlitch)}><span>${escapeHTML(t("Console.SheetGlitch"))}<small>${escapeHTML(t("Console.SheetGlitchHint"))}</small></span></label>
        <label class="bd-checkbox"><input name="mechanics" type="checkbox" ${checked(state.active ? state.mechanics : mechanicsDefault)}><span>${escapeHTML(t("Console.Mechanics"))}<small>${escapeHTML(t("Console.MechanicsHint"))}</small></span></label>
        <fieldset class="bd-reality"><legend>${escapeHTML(t("Console.Reality"))}</legend>
          <label class="bd-checkbox"><input type="radio" name="reality" value="rollback" ${checked(state.reality === "rollback")}><span>${escapeHTML(t("Console.RealityRollback"))}<small>${escapeHTML(t("Console.RealityRollbackHint"))}</small></span></label>
          <label class="bd-checkbox"><input type="radio" name="reality" value="keep" ${checked(state.reality === "keep")}><span>${escapeHTML(t("Console.RealityKeep"))}<small>${escapeHTML(t("Console.RealityKeepHint"))}</small></span></label>
        </fieldset>`)}
      ${section("02", "Characters", `<p class="bd-help">${escapeHTML(t("Console.CharactersHint"))}</p>
        <div class="bd-pairings">${pairingRows(state.pairings.length ? state.pairings : [{}])}</div>
        <button type="button" class="bd-secondary" data-bd-add>${escapeHTML(t("Console.AddPairing"))}</button>
        <p class="bd-help bd-restoration-hint">${escapeHTML(t("Console.RestoreHint"))}</p>
        <div class="bd-session-actions"><button class="bd-primary" type="submit" data-bd-submit></button>
          <button class="bd-danger" type="button" data-bd-action="stop"></button></div>`)}
    </form>
    ${section("03", "Echoes", `<p class="bd-help">${escapeHTML(t("Console.EchoesHint"))}</p>
      <div class="bd-cue-grid">${Object.entries(CUES).map(([key, cue]) => `<button type="button" data-bd-cue="${key}" style="--bd-cue:${cue.color}"><span class="bd-cue-symbol" aria-hidden="true">${cue.symbol}</span>${escapeHTML(t(`Cue.${key}`))}<small>${escapeHTML(t(`Cue.${key}Effect`))}</small></button>`).join("")}</div>
      <div class="bd-cue-footer"><label>${escapeHTML(t("Console.Duration"))} <select name="cueDuration">${[5, 8, 15, 30, 60].map(seconds => `<option value="${seconds}" ${seconds === 8 ? "selected" : ""}>${escapeHTML(t("Console.Seconds", { seconds }))}</option>`).join("")}</select></label>
        <button type="button" data-bd-action="clear" class="bd-quiet">${escapeHTML(t("Console.ClearEcho"))}</button></div>`)}
    ${section("04", "Timeline", `<p class="bd-help">${escapeHTML(t("Console.TimelineHint"))}</p>
      <div class="bd-mark-row"><input type="text" name="markLabel" maxlength="80" placeholder="${escapeHTML(t("Console.MarkPlaceholder"))}" autocomplete="off">
        <button type="button" class="bd-secondary" data-bd-action="mark">${escapeHTML(t("Console.Mark"))}</button></div>
      <label class="bd-checkbox"><input name="markView" type="checkbox" checked>${escapeHTML(t("Console.MarkView"))}</label>
      <ol class="bd-markers"></ol>`)}
    ${section("05", "Clues", `<p class="bd-help">${escapeHTML(t("Console.CluesHint"))}</p>
      <ul class="bd-clues"></ul>
      <div class="bd-session-actions"><button type="button" class="bd-secondary" data-bd-clue="place">${escapeHTML(t("Console.PlaceClue"))}</button>
        <button type="button" class="bd-quiet" data-bd-clue="reset">${escapeHTML(t("Console.ResetClues"))}</button></div>`)}`
    : `<div class="bd-section"><p>${escapeHTML(t("Console.PlayerIntro"))}</p><p class="bd-help">${escapeHTML(t("Console.PlayerLayers"))}</p></div>`}
    <details class="bd-comfort" ${user.isGM ? "" : "open"}><summary>${escapeHTML(t("Console.Comfort"))} <span>${escapeHTML(t("Console.LocalOnly"))}</span></summary>
      <form class="bd-preferences-form">
        <label class="bd-checkbox"><input name="enabled" type="checkbox" ${checked(preferences.enabled)}>${escapeHTML(t("Console.ShowVisuals"))}</label>
        <label class="bd-field bd-slider-label">${escapeHTML(t("Console.MyStrength"))} <output data-bd-output="personalIntensity">${preferences.intensity}%</output><input name="personalIntensity" type="range" min="0" max="100" value="${preferences.intensity}"></label>
        <label class="bd-checkbox"><input name="reduceMotion" type="checkbox" ${checked(preferences.reduceMotion)}>${escapeHTML(t("Console.ReduceMotion"))}</label>
        <label class="bd-checkbox"><input name="sheetGlitch" type="checkbox" ${checked(preferences.sheetGlitch)}>${escapeHTML(t("Console.ShowSheetGlitch"))}</label>
        ${user.isGM ? `<label class="bd-checkbox"><input name="preview" type="checkbox" ${checked(preferences.preview)}>${escapeHTML(t("Console.Preview"))}</label>` : ""}
        <button class="bd-secondary" type="submit">${escapeHTML(t("Console.SavePreferences"))}</button>
      </form>
    </details><footer class="bd-panel-footer"><span class="bd-live-dot"></span> ${escapeHTML(t("Console.Footer"))}</footer>`;

  let busy = false;
  let cueTimer;
  const renderMarkers = latest => {
    const list = root.querySelector(".bd-markers");
    if (!list) return;
    list.innerHTML = latest.active && latest.markers.length ? latest.markers.map(marker => `<li class="bd-marker bd-marker-${marker.kind}">
      <i class="fa-solid ${KIND_ICONS[marker.kind]}" aria-hidden="true"></i><time>${durationLabel(marker.at)}</time>
      <span>${escapeHTML(marker.label || (marker.cue ? t(`Cue.${marker.cue}`) : t(`Console.Marker.${marker.kind}`)))}${marker.view ? ` <i class="fa-solid fa-camera" data-tooltip="${escapeHTML(t("Console.HasView"))}"></i>` : ""}</span>
      <button type="button" class="bd-quiet" data-bd-replay="${escapeHTML(marker.id)}" aria-label="${escapeHTML(t("Console.Replay"))}" data-tooltip="${escapeHTML(t("Console.Replay"))}"><i class="fa-solid fa-backward"></i></button>
      ${marker.kind === "start" ? "" : `<button type="button" class="bd-quiet" data-bd-unmark="${escapeHTML(marker.id)}" aria-label="${escapeHTML(t("Console.RemoveMarker"))}"><i class="fa-solid fa-xmark"></i></button>`}</li>`).join("")
      : `<li class="bd-empty">${escapeHTML(t(latest.active ? "Console.NoMarkers" : "Console.TimelineIdle"))}</li>`;
  };
  const renderClues = () => {
    const list = root.querySelector(".bd-clues");
    if (!list || !clues) return;
    const entries = clues.list();
    list.innerHTML = entries.length ? entries.map(clue => `<li class="bd-clue${clue.found ? " is-found" : ""}" style="--bd-layer:${LAYERS[clue.layer].color}">
      <span class="bd-clue-layer" data-tooltip="${escapeHTML(t(`Layer.${clue.layer}`))}">${LAYERS[clue.layer].symbol}</span>
      <span class="bd-clue-label">${escapeHTML(clue.label || t("Console.UnnamedClue"))}<small>${escapeHTML(clue.found ? t("Console.ClueFound", { name: clue.foundByName || "?" }) : t("Console.ClueHidden"))}</small></span>
      <button type="button" class="bd-quiet" data-bd-clue="edit" data-id="${escapeHTML(clue.id)}" aria-label="${escapeHTML(t("Console.EditClue"))}"><i class="fa-solid fa-pen"></i></button>
      <button type="button" class="bd-quiet" data-bd-clue="remove" data-id="${escapeHTML(clue.id)}" aria-label="${escapeHTML(t("Console.RemoveClue"))}"><i class="fa-solid fa-trash"></i></button></li>`).join("")
      : `<li class="bd-empty">${escapeHTML(t("Console.NoClues"))}</li>`;
  };
  const refresh = () => {
    const latest = controller.getState();
    const recovery = controller.hasRecovery();
    const cue = currentCue(latest);
    clearTimeout(cueTimer);
    if (cue) cueTimer = setTimeout(() => { if (root.isConnected) refresh(); }, Math.min(61000, Math.max(1, cue.endsAt - Date.now() + 30)));
    const status = root.querySelector(".bd-panel-status");
    status.textContent = latest.active
      ? t("Console.StatusActive", { label: latest.label, count: latest.pairings.length, status: cue ? t(`Cue.${cue.kind}Status`) : t("Console.Running") })
      : recovery ? t("Console.StatusRecovery") : t("Console.StatusIdle");
    const pill = root.querySelector(".bd-state-pill");
    pill.textContent = latest.active ? `● ${t("Console.Linked")}` : `○ ${t("Console.Standby")}`;
    pill.classList.toggle("is-live", latest.active);
    for (const button of root.querySelectorAll("[data-bd-cue], [data-bd-action], [data-bd-replay], [data-bd-unmark]")) button.disabled = busy || !latest.active;
    const stop = root.querySelector('[data-bd-action="stop"]');
    if (stop) { stop.disabled = busy || (!latest.active && !recovery); stop.textContent = t(latest.active ? "Console.Disconnect" : "Console.RestoreCharacters"); }
    for (const input of root.querySelectorAll(".bd-pairings select, [data-bd-add], [data-bd-remove]")) input.disabled = busy || latest.active || recovery;
    const submit = root.querySelector("[data-bd-submit]");
    if (submit) { submit.disabled = busy || (!latest.active && recovery); submit.textContent = t(latest.active ? "Console.Apply" : "Console.Enter"); }
    for (const button of root.querySelectorAll("[data-bd-clue]")) button.disabled = busy;
    renderMarkers(latest);
    renderClues();
  };
  const execute = async operation => {
    if (busy) return;
    busy = true;
    refresh();
    let failure;
    try { await operation(); }
    catch (error) { failure = error.message; notify(failure); }
    finally { busy = false; refresh(); if (failure) root.querySelector(".bd-panel-status").textContent = failure; }
  };
  root.addEventListener("input", event => {
    const input = event.target;
    if (input.type === "range") root.querySelector(`[data-bd-output="${input.name}"]`).textContent = `${input.value}%`;
  });
  root.querySelector(".bd-session-form")?.addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const live = controller.getState();
    const patch = {
      label: data.get("label"), preset: data.get("preset"), intensity: Number(data.get("intensity")),
      sheetGlitch: data.has("sheetGlitch"), mechanics: data.has("mechanics"), reality: data.get("reality"),
      pairings: live.active ? live.pairings : data.getAll("characterUuid").map((characterUuid, index) => ({ characterUuid, npcUuid: data.getAll("npcUuid")[index] }))
    };
    void execute(() => live.active ? controller.update(patch) : controller.start(patch));
  });
  root.querySelector(".bd-preferences-form").addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void execute(() => savePreferences({ ...normalizePreferences(getPreferences()), enabled: data.has("enabled"), intensity: Number(data.get("personalIntensity")),
      reduceMotion: data.has("reduceMotion"), sheetGlitch: data.has("sheetGlitch"), preview: user.isGM && data.has("preview") }));
  });
  root.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || !root.contains(button)) return;
    const idle = !controller.getState().active && !controller.hasRecovery();
    if (button.hasAttribute("data-bd-add") && idle) { root.querySelector(".bd-pairings").insertAdjacentHTML("beforeend", pairingRows([{}])); refresh(); }
    if (button.hasAttribute("data-bd-remove") && idle) { button.closest(".bd-pairing-row")?.remove(); refresh(); }
    if (button.dataset.bdCue) void execute(() => controller.cue(button.dataset.bdCue, Number(root.querySelector("[name=cueDuration]").value)));
    if (button.dataset.bdReplay) void execute(() => controller.replay(button.dataset.bdReplay));
    if (button.dataset.bdUnmark) void execute(() => controller.removeMarker(button.dataset.bdUnmark));
    const action = button.dataset.bdAction;
    if (action === "stop") void execute(() => controller.stop());
    if (action === "clear") void execute(() => controller.clearCue());
    if (action === "mark") {
      const input = root.querySelector("[name=markLabel]");
      const view = root.querySelector("[name=markView]")?.checked ? captureView() : null;
      void execute(async () => { await controller.mark({ label: input.value, view }); input.value = ""; });
    }
    const clue = button.dataset.bdClue;
    if (clue && clues) {
      if (clue === "place") void execute(() => clues.place());
      if (clue === "edit") void execute(() => clues.edit(button.dataset.id));
      if (clue === "remove") void execute(() => clues.remove(button.dataset.id));
      if (clue === "reset") void execute(() => clues.reset());
    }
  });
  root.bdRefresh = refresh;
  root.bdDispose = () => clearTimeout(cueTimer);
  refresh();
  return root;
}
