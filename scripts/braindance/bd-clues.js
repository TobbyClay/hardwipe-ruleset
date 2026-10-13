/**
 * Braindance clues. The GM hides clues in a scene on one of three editing layers (visual, audio, thermal).
 * Participants switch layers to pick up a clue's trace and scan the spot to reveal it.
 *
 * Positions and layers are public (a scene flag), so participants can see traces on their layer. A clue's
 * label and text stay in a GM-only journal until a scan finds it; only then are they copied to the scene.
 * Like every hidden journal in Foundry, that is interface privacy: the server still sends the journal to all
 * clients, so a player with browser developer tools could read it.
 */
import { LAYERS, clamp } from "./bd-state.js";

export const CLUE_FLAG = "braindanceClues";
export const CLUE_TEXT_FLAG = "braindanceClueText";
export const CLUE_JOURNAL_SETTING = "braindanceClueJournal";
const CLUE_LIMIT = 100;

export function normalizeClue(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;
  const x = Number(raw.x), y = Number(raw.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const found = raw.found === true;
  return {
    id: raw.id.slice(0, 32), x: Math.round(x), y: Math.round(y),
    layer: Object.hasOwn(LAYERS, raw.layer) ? raw.layer : "visual",
    radius: clamp(raw.radius, 10, 2000, 100),
    found,
    foundBy: found && typeof raw.foundBy === "string" ? raw.foundBy.slice(0, 32) : "",
    foundAt: found ? clamp(raw.foundAt, 0, Number.MAX_SAFE_INTEGER, 0) : 0,
    // Only a found clue carries its words in public data.
    label: found && typeof raw.label === "string" ? raw.label.slice(0, 80) : "",
    text: found && typeof raw.text === "string" ? raw.text.slice(0, 2000) : ""
  };
}

export const normalizeClues = value => Array.isArray(value) ? value.map(normalizeClue).filter(Boolean).slice(0, CLUE_LIMIT) : [];

export function normalizeClueText(raw) {
  return {
    label: typeof raw?.label === "string" && raw.label.trim() ? raw.label.trim().slice(0, 80) : "",
    text: typeof raw?.text === "string" ? raw.text.trim().slice(0, 2000) : ""
  };
}

/**
 * The unfound clue a scan at `point` on `layer` reveals: the nearest one whose radius covers the point.
 * Returns { clue, distance } or null, and `near` when a clue on another layer was in range (the scan
 * caught a trace on the wrong layer).
 */
export function scanClues(clues, point, layer) {
  let best = null, near = null;
  for (const clue of normalizeClues(clues)) {
    if (clue.found) continue;
    const distance = Math.hypot(clue.x - point.x, clue.y - point.y);
    if (distance > clue.radius) continue;
    if (clue.layer !== layer) { near ??= clue.layer; continue; }
    if (!best || distance < best.distance) best = { clue, distance };
  }
  return best ?? (near ? { clue: null, near } : null);
}

/** Mark a clue found, copying its words into public data. Returns the new list. */
export function revealClue(clues, clueId, { label, text }, userId, now = Date.now()) {
  return normalizeClues(clues).map(clue => clue.id === clueId
    ? normalizeClue({ ...clue, found: true, foundBy: userId, foundAt: now, label, text }) : clue);
}

/** Hide every clue again (for replaying a memory with another group). */
export const resetClues = clues => normalizeClues(clues).map(clue => normalizeClue({ ...clue, found: false }));

/** What a viewer sees of a clue: GMs see everything; participants see found clues and traces on their layer. */
export function visibleClues(clues, { layer, isGM = false } = {}) {
  return normalizeClues(clues).filter(clue => isGM || clue.found || clue.layer === layer);
}
