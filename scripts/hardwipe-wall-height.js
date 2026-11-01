/**
 * Per-wall top height. A wall rises from its level's floor to `height` scene units (feet on a five-foot grid).
 * A shot or a viewer's sight strictly above that top passes over the wall; at or below it, and for light, sound,
 * movement and blasts at any height, the wall stops it as before. A wall without a height is full height. Elevations are the ones Foundry uses:
 * a token's eye line is its elevation plus half its depth (2.5 ft for a medium token on a five-foot grid).
 * No Foundry globals: the tests run these rules directly.
 */
const ID = "hardwipe-ruleset";

/** The wall's top in scene units; Infinity for a full-height wall (no height, 0, or an invalid value). */
export function wallTop(cover) {
  const height = Number(cover?.height);
  return Number.isFinite(height) && height > 0 ? height : Infinity;
}

/** The cover flag that carries a wall's height: a damage helper borrows its physical parent's. */
export function heightCover(flags, parentOf = () => null) {
  if (!flags || typeof flags !== "object") return null;
  if (flags.wallWear) return parentOf(flags.wallWear.parentId)?.flags?.[ID]?.cover ?? null;
  return flags.cover ?? null;
}

/** Elevation of a straight line between two elevated ends at fraction t of its length (t clamped to 0..1). */
export function elevationAlong(from, to, t) {
  const a = Number(from) || 0;
  const b = Number(to) || 0;
  const fraction = Math.min(1, Math.max(0, Number(t) || 0));
  return a + (b - a) * fraction;
}

/** Only a point strictly above the top clears the wall; no elevation, or a full-height wall, never does. */
export function clearsWall(top, elevation) {
  const value = Number(elevation);
  return Number.isFinite(value) && value > top;
}

/** Whether a wall with the given top stops a line that crosses it at fraction t between two elevated ends. */
export function wallStopsLine(top, fromElevation, toElevation, t) {
  return !clearsWall(top, elevationAlong(fromElevation, toElevation, t));
}

/**
 * Whether a token's eye line differs from the one recorded with a shot. A record without an elevation (one
 * written before heights existed) never counts as moved.
 */
export function elevationChanged(recorded, current) {
  if (recorded === undefined || recorded === null) return false;
  return Number(recorded) !== Number(current);
}
