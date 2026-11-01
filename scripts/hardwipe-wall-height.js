/**
 * A wall's height comes from Foundry's Scene Levels: a wall assigned to levels stands from the lowest of their
 * bottoms to the highest of their tops, and a wall on no level is full height. Foundry already keeps each level's
 * walls to that level for sight, light, sound and movement; Hardwipe applies the same range to shots, so a line
 * crossing the wall above its top or below its bottom passes. Elevations are the ones Foundry uses: a token's eye
 * line is its elevation plus half its depth (2.5 ft for a medium token on a five-foot grid).
 * No Foundry globals: the tests run these rules directly.
 */

const FULL = Object.freeze({ bottom: -Infinity, top: Infinity });

/** A level's elevation range; a missing or null end is open (Foundry reads null as -Infinity / +Infinity). */
export function levelRange(level) {
  const elevation = level?.elevation ?? level ?? {};
  const bottom = elevation.bottom === null || elevation.bottom === undefined || elevation.bottom === "" ? -Infinity : Number(elevation.bottom);
  const top = elevation.top === null || elevation.top === undefined || elevation.top === "" ? Infinity : Number(elevation.top);
  return { bottom: Number.isNaN(bottom) ? -Infinity : bottom, top: Number.isNaN(top) ? Infinity : top };
}

/**
 * The elevation band a wall stands in: from the lowest bottom to the highest top of its levels. A wall on no level,
 * or only on levels the scene no longer has, is full height. `rangeOf(id)` returns a level's range or null.
 */
export function wallBand(levels, rangeOf = () => null) {
  const ids = levels instanceof Set ? [...levels] : Array.isArray(levels) ? levels : [];
  const ranges = ids.map(id => rangeOf(id)).filter(Boolean);
  if (!ranges.length) return { ...FULL };
  return { bottom: Math.min(...ranges.map(range => range.bottom)), top: Math.max(...ranges.map(range => range.top)) };
}

/** A wall document's band on its scene. */
export function bandOfWall(wall, scene = wall?.parent) {
  return wallBand(wall?.levels, id => {
    const level = scene?.levels?.get?.(id);
    return level ? levelRange(level) : null;
  });
}

/** Elevation of a straight line between two elevated ends at fraction t of its length (t clamped to 0..1). */
export function elevationAlong(from, to, t) {
  const a = Number(from) || 0;
  const b = Number(to) || 0;
  const fraction = Math.min(1, Math.max(0, Number(t) || 0));
  return a + (b - a) * fraction;
}

/** Whether a wall standing in `band` stops a line that crosses it at fraction t between two elevated ends. */
export function wallStopsLine(band, fromElevation, toElevation, t) {
  const elevation = elevationAlong(fromElevation, toElevation, t);
  return elevation >= (band?.bottom ?? -Infinity) && elevation <= (band?.top ?? Infinity);
}

/**
 * Whether a token's eye line differs from the one recorded with a shot. A record without an elevation (one
 * written before heights existed) never counts as moved.
 */
export function elevationChanged(recorded, current) {
  if (recorded === undefined || recorded === null) return false;
  return Number(recorded) !== Number(current);
}
