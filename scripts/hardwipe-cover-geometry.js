// Pure geometry and outcome rules. Coordinates and lengths are canvas pixels.
const PIXEL_EPSILON = 1e-8;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const cross = (a, b) => a.x * b.y - a.y * b.x;
const dot = (a, b) => a.x * b.x + a.y * b.y;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const isPoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);
const interpolate = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function pixelTolerance(...points) {
  const scale = Math.max(1, ...points.flatMap(point => [Math.abs(point.x), Math.abs(point.y)]));
  return Math.max(PIXEL_EPSILON, Number.EPSILON * scale * 32);
}

function pointParameter(point, start, end, tolerance) {
  const direction = subtract(end, start);
  const lengthSquared = dot(direction, direction);
  if (lengthSquared <= tolerance * tolerance) {
    return Math.hypot(point.x - start.x, point.y - start.y) <= tolerance ? 0 : null;
  }
  const length = Math.sqrt(lengthSquared);
  const offset = subtract(point, start);
  if (Math.abs(cross(offset, direction)) > tolerance * length) return null;
  const parameter = dot(offset, direction) / lengthSquared;
  if (parameter < -tolerance / length || parameter > 1 + tolerance / length) return null;
  return clamp(parameter, 0, 1);
}

/**
 * Intersect finite segments, including endpoints and point segments. For a
 * collinear overlap, return its first contact along a -> b. Invalid points miss.
 */
export function segmentIntersection(a, b, c, d) {
  if (![a, b, c, d].every(isPoint)) return null;
  const tolerance = pixelTolerance(a, b, c, d);
  const r = subtract(b, a);
  const s = subtract(d, c);
  const rLength = Math.hypot(r.x, r.y);
  const sLength = Math.hypot(s.x, s.y);

  if (rLength <= tolerance) {
    const u = pointParameter(a, c, d, tolerance);
    return u === null ? null : { x: a.x, y: a.y, t: 0, u };
  }
  if (sLength <= tolerance) {
    const t = pointParameter(c, a, b, tolerance);
    return t === null ? null : { ...interpolate(a, b, t), t, u: 0 };
  }

  const offset = subtract(c, a);
  const denominator = cross(r, s);
  const tTolerance = tolerance / rLength;
  const uTolerance = tolerance / sLength;
  if (Math.abs(denominator) <= tolerance * (rLength + sLength)) {
    if (Math.abs(cross(offset, r)) > tolerance * rLength) return null;
    const rLengthSquared = dot(r, r);
    const first = dot(offset, r) / rLengthSquared;
    const last = dot(subtract(d, a), r) / rLengthSquared;
    const start = Math.max(0, Math.min(first, last));
    const end = Math.min(1, Math.max(first, last));
    if (start > end + tTolerance) return null;
    const t = clamp(start, 0, 1);
    const point = interpolate(a, b, t);
    const u = clamp(dot(subtract(point, c), s) / dot(s, s), 0, 1);
    return { ...point, t, u };
  }

  const rawT = cross(offset, s) / denominator;
  const rawU = cross(offset, r) / denominator;
  if (rawT < -tTolerance || rawT > 1 + tTolerance || rawU < -uTolerance || rawU > 1 + uTolerance) return null;
  const t = clamp(rawT, 0, 1);
  const u = clamp(rawU, 0, 1);
  return { ...interpolate(a, b, t), t, u };
}

function coordinatesOf(wall) {
  return wall?.c ?? wall?.document?.c ?? wall?._source?.c;
}

function wallEndpoints(wall) {
  const coordinates = coordinatesOf(wall);
  if (!Array.isArray(coordinates) || coordinates.length < 4 || !coordinates.slice(0, 4).every(Number.isFinite)) return null;
  return [{ x: coordinates[0], y: coordinates[1] }, { x: coordinates[2], y: coordinates[3] }];
}

/**
 * Return the nearest wall contact along the shot; isBlocking(wall) may filter
 * doors, elevation, and direction outside this 2D helper. Equal-distance walls
 * use their IDs for a stable tie-break, then preserve iterable order.
 */
export function findFirstWallIntersection(origin, target, walls, { isBlocking } = {}) {
  if (!isPoint(origin) || !isPoint(target) || !walls) return null;
  let first = null;
  const tolerance = pixelTolerance(origin, target) / Math.max(1, Math.hypot(target.x - origin.x, target.y - origin.y));
  const entries = walls instanceof Map ? walls.values() : walls;
  for (const wall of entries) {
    if (isBlocking && !isBlocking(wall)) continue;
    const endpoints = wallEndpoints(wall);
    if (!endpoints) continue;
    const intersection = segmentIntersection(origin, target, ...endpoints);
    if (!intersection) continue;
    const wallId = wall.id ?? wall._id ?? wall.document?.id ?? wall.document?._id ?? null;
    if (first && intersection.t > first.t + tolerance) continue;
    if (first && Math.abs(intersection.t - first.t) <= tolerance && String(wallId ?? "") >= String(first.wallId ?? "")) continue;
    first = { wall, wallId, ...intersection };
  }
  return first;
}

function cloneData(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  const copy = Array.isArray(value) ? new Array(value.length) : {};
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    if (Object.prototype.propertyIsEnumerable.call(value, key)) {
      Object.defineProperty(copy, key, {
        value: cloneData(value[key], seen), enumerable: true, writable: true, configurable: true
      });
    }
  }
  return copy;
}

/**
 * Plan a gap centered on the projected impact, shifted inside the wall ends to
 * retain its full requested length. Returns deep-cloned creation data; the
 * caller owns deletion/creation. Zero-length walls and nonpositive gaps reject.
 */
export function planWallBreach(wall, impact, gapPixels) {
  if (!isPoint(impact)) throw new TypeError("Wall breach impact must have finite x and y coordinates.");
  if (!Number.isFinite(gapPixels) || gapPixels <= 0) throw new RangeError("Wall breach gap must be a positive finite pixel length.");
  const data = typeof wall?.toObject === "function" ? wall.toObject() : wall;
  const original = cloneData(data);
  const endpoints = wallEndpoints(original);
  if (!endpoints) throw new TypeError("Wall breach requires four finite wall coordinates.");
  const [start, end] = endpoints;
  const direction = subtract(end, start);
  const length = Math.hypot(direction.x, direction.y);
  const tolerance = pixelTolerance(start, end);
  if (length <= tolerance) throw new RangeError("Cannot breach a zero-length wall.");

  const projectedT = clamp(dot(subtract(impact, start), direction) / (length * length), 0, 1);
  const point = interpolate(start, end, projectedT);
  const removedWhole = gapPixels >= length - tolerance;
  const gapLength = removedWhole ? length : gapPixels;
  const startDistance = removedWhole ? 0 : clamp(projectedT * length - gapLength / 2, 0, length - gapLength);
  const endDistance = startDistance + gapLength;
  const gapStart = interpolate(start, end, startDistance / length);
  const gapEnd = interpolate(start, end, endDistance / length);
  const remainders = [];
  const appendRemainder = (a, b) => {
    const remainder = cloneData(original);
    delete remainder._id;
    delete remainder.id;
    remainder.c = [a.x, a.y, b.x, b.y];
    remainders.push(remainder);
  };
  if (startDistance > tolerance) appendRemainder(start, gapStart);
  if (length - endDistance > tolerance) appendRemainder(gapEnd, end);

  return {
    original,
    point,
    gap: { start: gapStart, end: gapEnd, length: gapLength },
    remainders,
    removedWhole
  };
}

/** Five feet in scene pixels. Unknown/empty units assume feet; metric units convert explicitly. */
export function getFiveFootPixels(scene) {
  const grid = scene?.grid ?? {};
  const dimensions = scene?.dimensions ?? {};
  const positive = value => Number.isFinite(value) && value > 0;
  const size = positive(grid.size) ? grid.size : positive(dimensions.size) ? dimensions.size : 100;
  const distance = positive(grid.distance) ? grid.distance : positive(dimensions.distance) ? dimensions.distance : 5;
  const units = String(grid.units || dimensions.units || "ft").trim().toLowerCase().replace(/\.$/, "");
  const conversions = {
    ft: 5, foot: 5, feet: 5,
    m: 1.524, meter: 1.524, meters: 1.524, metre: 1.524, metres: 1.524,
    cm: 152.4, centimeter: 152.4, centimeters: 152.4, centimetre: 152.4, centimetres: 152.4,
    mm: 1524, millimeter: 1524, millimeters: 1524, millimetre: 1524, millimetres: 1524,
    km: 0.001524, kilometer: 0.001524, kilometers: 0.001524, kilometre: 0.001524, kilometres: 0.001524,
    in: 60, inch: 60, inches: 60,
    yd: 5 / 3, yard: 5 / 3, yards: 5 / 3
  };
  const fiveFeetInUnits = Object.prototype.hasOwnProperty.call(conversions, units) ? conversions[units] : 5;
  return size * fiveFeetInUnits / distance;
}

/**
 * targetAC excludes physical cover. Partial cover uses final AC; total cover
 * cannot hit the character and uses bare AC for obstacle hits. Melee ignores
 * physical cover. threshold is the inclusive near-miss boundary, even for hits.
 */
export function classifyCoverOutcome({
  attackTotal, targetAC, coverBonus = 0, totalCover = false, hasObstacle = false,
  melee = false, nearMiss = 5, isNaturalOne = false
}) {
  if (!Number.isFinite(targetAC)) throw new TypeError("Cover classification requires a finite target AC without physical cover.");
  const bonus = Number.isFinite(coverBonus) ? Math.max(0, coverBonus) : 0;
  const margin = Number.isFinite(nearMiss) ? Math.max(0, nearMiss) : 5;
  const referenceAC = melee || totalCover ? targetAC : targetAC + bonus;
  const threshold = referenceAC - margin;
  let outcome = "miss";
  if (!isNaturalOne && Number.isFinite(attackTotal)) {
    if (melee) outcome = attackTotal >= targetAC ? "hit" : "miss";
    else if (totalCover) outcome = attackTotal >= threshold ? "cover" : "miss";
    else if (attackTotal >= referenceAC) outcome = "hit";
    else if (hasObstacle && attackTotal >= threshold) outcome = "cover";
  }
  return { outcome, referenceAC, threshold };
}
