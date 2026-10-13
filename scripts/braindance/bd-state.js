/**
 * Braindance shared state. Plain data only, so the tests run it without Foundry.
 *
 * The session lives in one world setting written by a GM; Foundry persists and broadcasts it, so no
 * unauthenticated socket message can start a memory or impersonate the GM. Everything read back from
 * that setting goes through normalizeState first.
 */
export const MODULE_ID = "hardwipe-ruleset";

/** Moods. Colours are "r, g, b" for rgba(); labels come from HARDWIPE.Braindance.Preset.<key>. */
export const PRESETS = Object.freeze({
  clean: { color: "82, 231, 214", signal: 98 },
  noir: { color: "120, 164, 255", signal: 91 },
  warm: { color: "244, 190, 111", signal: 94 },
  corrupted: { color: "237, 110, 154", signal: 67 }
});

/** Sensory echoes. Labels come from HARDWIPE.Braindance.Cue.<key>. */
export const CUES = Object.freeze({
  panic: { color: "244, 111, 111", symbol: "♡" },
  disorientation: { color: "157, 153, 250", symbol: "◎" },
  interference: { color: "223, 193, 104", symbol: "≋" },
  overload: { color: "243, 137, 192", symbol: "ϟ" }
});

/** Braindance editing layers. A clue is only traced and found on its own layer. */
export const LAYERS = Object.freeze({
  visual: { color: "82, 231, 214", symbol: "◇" },
  audio: { color: "157, 153, 250", symbol: "≈" },
  thermal: { color: "255, 138, 76", symbol: "▲" }
});

export const MARKER_KINDS = Object.freeze(["start", "mark", "cue", "clue"]);
export const REALITY = Object.freeze(["rollback", "keep"]);
const MARKER_LIMIT = 60;
const REPLAY_SECONDS = { min: 3, max: 20, fallback: 6 };

export function clamp(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

const text = (value, limit, fallback = "") => typeof value === "string" ? value.trim().slice(0, limit) || fallback : fallback;
const id = value => typeof value === "string" ? value.slice(0, 100) : "";

export const uniqueStrings = value => Array.isArray(value)
  ? [...new Set(value.filter(entry => typeof entry === "string" && entry.length > 0).map(entry => entry.slice(0, 256)))].slice(0, 500)
  : [];

export function normalizePairings(value) {
  return Array.isArray(value) ? value.slice(0, 30).map(pair => ({
    characterUuid: typeof pair?.characterUuid === "string" ? pair.characterUuid.slice(0, 256) : "",
    npcUuid: typeof pair?.npcUuid === "string" ? pair.npcUuid.slice(0, 256) : ""
  })) : [];
}

export function normalizeView(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.sceneId !== "string" || !raw.sceneId) return null;
  const x = Number(raw.x), y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { sceneId: raw.sceneId.slice(0, 100), x: Math.round(x), y: Math.round(y), scale: clamp(raw.scale, 0.1, 3, 1) };
}

export function normalizeMarker(raw) {
  if (!raw || typeof raw !== "object" || !MARKER_KINDS.includes(raw.kind)) return null;
  return {
    id: id(raw.id), kind: raw.kind, at: clamp(raw.at, 0, Number.MAX_SAFE_INTEGER, 0), label: text(raw.label, 80),
    preset: Object.hasOwn(PRESETS, raw.preset) ? raw.preset : null,
    cue: Object.hasOwn(CUES, raw.cue) ? raw.cue : null,
    view: normalizeView(raw.view)
  };
}

export function normalizeState(raw = {}) {
  if (!raw || typeof raw !== "object") raw = {};
  const active = raw.active === true;
  const cue = active && raw.cue && Object.hasOwn(CUES, raw.cue.kind) ? {
    id: id(raw.cue.id), kind: raw.cue.kind, endsAt: clamp(raw.cue.endsAt, 0, Number.MAX_SAFE_INTEGER), mechanics: raw.cue.mechanics === true
  } : null;
  const markers = active && Array.isArray(raw.markers)
    ? raw.markers.map(normalizeMarker).filter(marker => marker?.id).slice(-MARKER_LIMIT) : [];
  const replay = active && raw.replay && markers.some(marker => marker.id === raw.replay.markerId) ? {
    id: id(raw.replay.id), markerId: raw.replay.markerId, endsAt: clamp(raw.replay.endsAt, 0, Number.MAX_SAFE_INTEGER)
  } : null;
  return {
    schema: 3,
    id: id(raw.id),
    active,
    label: text(raw.label, 90, "Untitled memory"),
    preset: Object.hasOwn(PRESETS, raw.preset) ? raw.preset : "clean",
    intensity: clamp(raw.intensity ?? 35, 0, 100, 35),
    sheetGlitch: raw.sheetGlitch !== false,
    mechanics: raw.mechanics === true,
    reality: REALITY.includes(raw.reality) ? raw.reality : "rollback",
    participantIds: uniqueStrings(raw.participantIds),
    actorUuids: uniqueStrings(raw.actorUuids),
    pairings: normalizePairings(raw.pairings),
    startedAt: clamp(raw.startedAt, 0, Number.MAX_SAFE_INTEGER),
    cue,
    markers,
    replay
  };
}

export function normalizePreferences(raw = {}) {
  if (!raw || typeof raw !== "object") raw = {};
  return {
    enabled: raw.enabled !== false,
    intensity: clamp(raw.intensity ?? 70, 0, 100, 70),
    reduceMotion: raw.reduceMotion === true,
    sheetGlitch: raw.sheetGlitch !== false,
    preview: raw.preview === true,
    layer: Object.hasOwn(LAYERS, raw.layer) ? raw.layer : "visual"
  };
}

export function isParticipant(state, user, preferences = {}) {
  return Boolean(state.active && user && (state.participantIds.includes(user.id) || (user.isGM && preferences.preview)));
}

export function currentCue(state, now = Date.now()) {
  return state.active && state.cue?.endsAt > now ? state.cue : null;
}

/** The replay in progress and the marker it replays, or null. */
export function currentReplay(state, now = Date.now()) {
  if (!state.active || !(state.replay?.endsAt > now)) return null;
  const marker = state.markers.find(entry => entry.id === state.replay.markerId);
  return marker ? { ...state.replay, marker } : null;
}

export function sheetMatches(actor, state, users) {
  if (!actor) return false;
  if (state.actorUuids.includes(actor.uuid)) return true;
  // A synthetic token actor may be based on an explicitly selected world actor.
  if (actor.isToken && state.actorUuids.includes(`Actor.${actor.id}`)) return true;
  return users.some(user => state.participantIds.includes(user.id) &&
    (user.character?.uuid === actor.uuid || (actor.isToken && user.character?.id === actor.id)));
}

export function elapsedLabel(startedAt, now = Date.now()) {
  return durationLabel(now - startedAt);
}

export function durationLabel(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(part => String(part).padStart(2, "0")).join(":");
}

/** Marker positions along the timeline, 0..1 of the elapsed memory. */
export function timelinePositions(state, now = Date.now()) {
  const span = Math.max(1, now - state.startedAt, ...state.markers.map(marker => marker.at));
  return state.markers.map(marker => ({ id: marker.id, kind: marker.kind, position: Math.min(1, marker.at / span) }));
}

/**
 * GM operations. `forms` swaps characters and restores them; `echoes` applies and clears the mechanical
 * side of sensory echoes. Errors carry HARDWIPE.Braindance.Error keys through `t`.
 */
export function createController({ read, write, getUser, forms, echoes = null, now = Date.now, id: makeId = () => crypto.randomUUID(), t = key => key }) {
  let queue = Promise.resolve();
  const fail = (key, data) => new Error(t(key, data));
  const enqueue = operation => {
    const next = queue.then(async () => {
      if (!getUser()?.isGM) throw fail("OnlyGM");
      return operation(normalizeState(read()));
    });
    queue = next.catch(() => {});
    return next;
  };
  const configuration = (state, patch = {}) => {
    const allowed = {};
    for (const key of ["label", "preset", "intensity", "sheetGlitch", "pairings", "mechanics", "reality"])
      if (Object.hasOwn(patch, key)) allowed[key] = patch[key];
    return normalizeState({ ...state, ...allowed });
  };
  const save = async value => { const next = normalizeState(value); await write(next); return next; };
  const marker = (state, data) => ({ id: makeId(), at: Math.max(0, now() - state.startedAt), preset: state.preset,
    cue: currentCue(state, now())?.kind ?? null, ...data });
  const withMarker = (state, data) => [...state.markers, marker(state, data)].slice(-MARKER_LIMIT);
  const clearEchoes = async () => { try { await echoes?.clear(); } catch (error) { console.warn(`${MODULE_ID} | Braindance echo cleanup`, error); } };

  return Object.freeze({
    getState: () => normalizeState(read()),
    hasRecovery: () => Boolean(forms?.hasRecovery()),
    start: patch => enqueue(async state => {
      const next = configuration(state, patch);
      if (state.active) throw fail("AlreadyActive");
      if (!next.pairings.length || next.pairings.some(pair => !pair.characterUuid || !pair.npcUuid)) throw fail("IncompletePairing");
      if (!forms) throw fail("Unavailable");
      const sessionId = makeId();
      const linked = await forms.enter(next.pairings, sessionId);
      const startedAt = now();
      try {
        return await save({ ...next, ...linked, id: sessionId, active: true, startedAt, cue: null, replay: null,
          markers: [{ id: makeId(), kind: "start", at: 0, label: next.label, preset: next.preset }] });
      } catch (error) {
        try { await forms.restore({ rollback: false }); }
        catch (restoreError) { throw new Error(`${error.message} ${t("RestorePending", { error: restoreError.message })}`); }
        throw error;
      }
    }),
    update: patch => enqueue(state => {
      const next = configuration(state, patch);
      if (state.active && JSON.stringify(next.pairings) !== JSON.stringify(state.pairings)) throw fail("PairingsLocked");
      return save(next);
    }),
    /** Restore characters. `reality` overrides the session's choice for walls and Heat. */
    stop: ({ reality } = {}) => enqueue(async state => {
      const rollback = (REALITY.includes(reality) ? reality : state.reality) === "rollback";
      await clearEchoes();
      await forms?.restore({ rollback });
      // Name, mood and pairings carry over to the next memory; "keep what happened" and echo mechanics never do.
      return save({ ...state, active: false, cue: null, replay: null, markers: [], actorUuids: [], participantIds: [], reality: "rollback", mechanics: false });
    }),
    cue: (kind, seconds = 8) => enqueue(async state => {
      if (!state.active) throw fail("NotActive");
      if (!Object.hasOwn(CUES, kind)) throw fail("UnknownCue");
      const cue = { id: makeId(), kind, endsAt: now() + clamp(seconds, 1, 60, 8) * 1000, mechanics: state.mechanics };
      await clearEchoes();
      const next = await save({ ...state, cue, markers: withMarker(state, { kind: "cue", cue: kind, label: "" }) });
      if (cue.mechanics) await echoes?.apply(next, cue);
      return next;
    }),
    clearCue: () => enqueue(async state => {
      await clearEchoes();
      return save({ ...state, cue: null });
    }),
    mark: ({ label = "", view = null } = {}) => enqueue(state => {
      if (!state.active) throw fail("NotActive");
      return save({ ...state, markers: withMarker(state, { kind: "mark", label, view }) });
    }),
    /** A clue found by a participant is logged on the timeline by the GM that verified the scan. */
    logClue: ({ label = "", view = null } = {}) => enqueue(state => {
      if (!state.active) return state;
      return save({ ...state, markers: withMarker(state, { kind: "clue", label, view }) });
    }),
    removeMarker: markerId => enqueue(state => save({ ...state, markers: state.markers.filter(entry => entry.id !== markerId) })),
    replay: (markerId, seconds = REPLAY_SECONDS.fallback) => enqueue(state => {
      if (!state.active) throw fail("NotActive");
      if (!state.markers.some(entry => entry.id === markerId)) throw fail("UnknownMarker");
      const duration = clamp(seconds, REPLAY_SECONDS.min, REPLAY_SECONDS.max, REPLAY_SECONDS.fallback);
      return save({ ...state, replay: { id: makeId(), markerId, endsAt: now() + duration * 1000 } });
    })
  });
}
