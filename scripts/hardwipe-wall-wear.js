import { getFiveFootPixels } from "./hardwipe-cover-geometry.js";

const EPSILON = 1e-7;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const isPoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);
const lengthOf = c => Math.hypot(c[2] - c[0], c[3] - c[1]);
const rounded = point => ({ x: Math.round(point.x), y: Math.round(point.y) });
const coordinates = (a, b) => [a.x, a.y, b.x, b.y];

/**
 * Plan optical wall segments and surface scars without changing the wall or its
 * cover flags. Coordinates/lengths are pixels; scar.rotation is in radians.
 * The original wall remains the movement/ballistic barrier. Its caller owns
 * native Document changes and handles complete destruction separately.
 * Invalid geometry returns empty arrays; disabled/invalid wear keeps the wall.
 */
export function planWallWear(wallData, cover, scene) {
  const result = { gaps: [], solid: [], scars: [] };
  const c = wallData?.c;
  if (!Array.isArray(c) || c.length !== 4 || !c.every(Number.isFinite)) return result;
  const start = { x: c[0], y: c[1] };
  const end = { x: c[2], y: c[3] };
  const length = lengthOf(c);
  if (!Number.isFinite(length) || length <= EPSILON) return result;
  const original = coordinates(rounded(start), rounded(end));
  if (!lengthOf(original)) return result;
  result.solid.push(original);
  if (!cover || cover.appearance === false) return result;

  const maximum = Number(cover.max);
  if (!Number.isFinite(maximum) || maximum <= 0) return result;
  const unit = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  const origin = isPoint(cover.sectionOrigin) ? cover.sectionOrigin : start;
  const directionLength = isPoint(cover.sectionDirection)
    ? Math.hypot(cover.sectionDirection.x, cover.sectionDirection.y) : 0;
  const direction = directionLength > EPSILON
    ? { x: cover.sectionDirection.x / directionLength, y: cover.sectionDirection.y / directionLength } : unit;
  const project = point => (point.x - origin.x) * direction.x + (point.y - origin.y) * direction.y;
  const from = project(start);
  const to = project(end);
  const distance = to - from;
  if (![from, to, distance].every(Number.isFinite) || Math.abs(distance) <= EPSILON) return result;
  const storedSize = Number(cover.sectionPixels);
  const size = Number.isFinite(storedSize) && storedSize > EPSILON ? storedSize : getFiveFootPixels(scene);
  if (!Number.isFinite(size) || size <= EPSILON) return result;
  const first = Math.max(0, Math.floor((Math.min(from, to) + EPSILON) / size));
  const last = Math.ceil((Math.max(from, to) - EPSILON) / size) - 1;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first) return result;
  const pointAt = position => ({ x: start.x + unit.x * position, y: start.y + unit.y * position });
  const onWall = anchoredDistance => (anchoredDistance - from) / distance * length;
  const sections = cover.sections && typeof cover.sections === "object" ? cover.sections : {};
  const fallback = Number(cover.hp ?? maximum);
  const initialHP = Number.isFinite(fallback) ? clamp(fallback, 0, maximum) : maximum;
  const keys = new Set();
  if (initialHP < maximum) {
    // Bound malformed scene/flag data rather than materializing unbounded walls.
    if (last - first > 10000) return result;
    for (let index = first; index <= last; index++) keys.add(String(index));
  }
  for (const key of Object.keys(sections)) {
    const index = Number(key);
    if (Number.isSafeInteger(index) && String(index) === key && index >= first && index <= last) keys.add(key);
  }

  const intervals = [];
  for (const key of [...keys].sort((a, b) => Number(a) - Number(b))) {
    const index = Number(key);
    const section = sections[key];
    const sectionMax = Number(section?.max ?? maximum);
    const max = Number.isFinite(sectionMax) && sectionMax > 0 ? sectionMax : maximum;
    const candidateHP = Number(section?.hp ?? initialHP);
    const hp = Number.isFinite(candidateHP) ? clamp(candidateHP, 0, max) : max;
    if (hp >= max) continue;
    const a = clamp(onWall(index * size), 0, length);
    const b = clamp(onWall((index + 1) * size), 0, length);
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const sectionLength = high - low;
    if (sectionLength <= EPSILON) continue;
    const impact = isPoint(section?.impact) ? section.impact : null;
    const projectedImpact = impact ? (impact.x - start.x) * unit.x + (impact.y - start.y) * unit.y : (low + high) / 2;
    const center = clamp(projectedImpact, low, high);
    const ratio = hp / max;
    const stage = ratio <= 0.25 ? 3 : ratio <= 0.5 ? 2 : 1;
    result.scars.push({ key, hp, max, stage, center: pointAt(center), length: sectionLength, rotation: Math.atan2(unit.y, unit.x) });
    if (stage === 1) continue;

    // Keep intact section ends, including corners, after integer rounding.
    // Very short walls show scars only, rather than opening endpoint leaks.
    const guard = Math.max(2, sectionLength * 0.02);
    if (sectionLength <= guard * 2) continue;
    const width = Math.min(sectionLength * (stage === 3 ? 0.2 : 0.1), sectionLength - guard * 2);
    const gapStart = clamp(center - width / 2, low + guard, high - guard - width);
    const gapEnd = gapStart + width;
    const p = rounded(pointAt(gapStart));
    const q = rounded(pointAt(gapEnd));
    if (!lengthOf(coordinates(p, q))) continue;
    intervals.push({ key, low: gapStart, high: gapEnd, start: p, end: q });
  }

  intervals.sort((a, b) => a.low - b.low);
  const merged = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && (interval.low <= previous.high + EPSILON
      || (previous.end.x === interval.start.x && previous.end.y === interval.start.y))) {
      if (interval.high > previous.high) {
        previous.high = interval.high;
        previous.end = interval.end;
      }
    } else merged.push({ ...interval });
  }
  if (!merged.length) return result;
  result.solid = [];
  let previous = rounded(start);
  for (const gap of merged) {
    const segment = coordinates(previous, gap.start);
    if (lengthOf(segment)) result.solid.push(segment);
    result.gaps.push({ key: gap.key, c: coordinates(gap.start, gap.end) });
    previous = gap.end;
  }
  const tail = coordinates(previous, rounded(end));
  if (lengthOf(tail)) result.solid.push(tail);
  return result;
}
