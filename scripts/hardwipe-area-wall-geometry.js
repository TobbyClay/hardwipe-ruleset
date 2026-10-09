import { segmentIntersection } from "./hardwipe-cover-geometry.js";
import { evaluateWallDamage } from "./hardwipe-wall-types.js";

const ID = "hardwipe-ruleset";
const EPSILON = 1e-7;
const point = (x, y) => ({ x, y });
const lerp = (a, b, t) => point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => point(a.x - b.x, a.y - b.y);
const values = value => value instanceof Set ? [...value] : Array.isArray(value) ? value : [];

/** An explicit disabled Region never causes structural damage, even with a saved mode. */
export function areaWallDamageMultiplier(flags = {}) {
  if (flags.enabled === false) return 0;
  return flags.wallsBlock === "damage-normal" ? 1 : flags.wallsBlock === "damage-half" ? 0.5 : 0;
}

/** Halving applies to the original roll, before threshold and armor; walls make no save. */
export function assessAreaWallDamage(damage, multiplier, material) {
  if (!Number.isFinite(damage) || damage < 0 || ![0.5, 1].includes(multiplier)) throw new Error("Invalid area wall damage.");
  const structuralRoll = Math.floor(damage * multiplier);
  return { original: damage, multiplier, ...evaluateWallDamage(structuralRoll, material) };
}

/** Physical parents block blast propagation even when their optical damage helpers have gaps. */
export function isPhysicalAreaWall(wall, region = {}, levelRanges = {}) {
  const c = wall?.c;
  if (!Array.isArray(c) || c.length !== 4 || !c.every(Number.isFinite) || Math.hypot(c[2] - c[0], c[3] - c[1]) <= EPSILON) return false;
  const flags = wall.flags?.[ID] ?? {};
  if (flags.wallWear || flags.cover?.ballistic === false) return false;
  if (wall.isOpen || (Number(wall.door) > 0 && Number(wall.ds) === 1)) return false;
  const wallLevels = values(wall.levels), regionLevels = values(region.levels);
  if (wallLevels.length && regionLevels.length && !wallLevels.some(id => regionLevels.includes(id))) return false;
  if (wallLevels.length) {
    const bottom = region.elevation?.bottom ?? -Infinity, top = region.elevation?.top ?? Infinity;
    const ranges = wallLevels.map(id => levelRanges[id]).filter(Boolean);
    if (ranges.length && ranges.every(range => (range.top ?? Infinity) <= bottom || (range.bottom ?? -Infinity) > top
      || (!region.elevation?.topInclusive && top > bottom && (range.bottom ?? -Infinity) === top))) return false;
  }
  return flags.cover?.ballistic === true || flags.cover?.material === "glass" || Number(wall.move) > 0
    || Number(flags.cover?.wear?.restrictions?.sight ?? wall.sight) > 0;
}

function vertices(polygon) {
  const coordinates = polygon?.points;
  if (!Array.isArray(coordinates) || coordinates.length < 6 || coordinates.length % 2 || !coordinates.every(Number.isFinite)) throw new Error("Invalid area polygon.");
  return Array.from({ length: coordinates.length / 2 }, (_, index) => point(coordinates[index * 2], coordinates[index * 2 + 1]));
}

function contains(p, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if (segmentIntersection(p, p, a, b)) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function inArea(p, polygons) {
  return polygons.some(poly => !poly.hole && contains(p, poly.vertices))
    && !polygons.some(poly => poly.hole && contains(p, poly.vertices));
}

function box(points) {
  return { left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) };
}

function boxesTouch(a, b) {
  return a.left <= b.right + EPSILON && a.right >= b.left - EPSILON && a.top <= b.bottom + EPSILON && a.bottom >= b.top - EPSILON;
}

/** Original anchored five-foot intervals, retained by all remainders of an earlier breach. */
export function areaWallSections(wall, sectionPixels, { bounds, maximum = 10000 } = {}) {
  const c = wall.c, cover = wall.flags?.[ID]?.cover ?? {};
  const length = Math.hypot(c[2] - c[0], c[3] - c[1]);
  const origin = cover.sectionOrigin ?? point(c[0], c[1]);
  const direction = cover.sectionDirection ?? point((c[2] - c[0]) / length, (c[3] - c[1]) / length);
  const size = Number(cover.sectionPixels) > 0 ? Number(cover.sectionPixels) : sectionPixels;
  if (!Number.isFinite(size) || size <= 0 || ![origin.x, origin.y, direction.x, direction.y, length].every(Number.isFinite)
    || Math.abs(Math.hypot(direction.x, direction.y) - 1) > 1e-5 || length <= EPSILON) throw new Error("Invalid wall section geometry.");
  const project = p => (p.x - origin.x) * direction.x + (p.y - origin.y) * direction.y;
  const start = Math.min(project(point(c[0], c[1])), project(point(c[2], c[3])));
  const end = Math.max(project(point(c[0], c[1])), project(point(c[2], c[3])));
  let first = Math.max(0, Math.floor((start + EPSILON) / size));
  let last = Math.max(first, Math.ceil((end - EPSILON) / size) - 1);
  if (bounds) {
    const projections = [point(bounds.left, bounds.top), point(bounds.left, bounds.bottom), point(bounds.right, bounds.top), point(bounds.right, bounds.bottom)].map(project);
    first = Math.max(first, Math.floor(Math.min(...projections) / size));
    last = Math.min(last, Math.floor(Math.max(...projections) / size));
  }
  if (last - first + 1 > maximum) throw new Error("The area intersects too many wall sections. Reduce the area or split the cast.");
  const sections = [];
  for (let key = first; key <= last; key++) {
    const low = Math.max(start, key * size), high = Math.min(end, (key + 1) * size);
    if (high - low <= EPSILON) continue;
    const at = distance => point(origin.x + direction.x * distance, origin.y + direction.y * distance);
    sections.push({ key: String(key), a: at(low), b: at(high), center: at((low + high) / 2), length: high - low,
      metadata: { sectionOrigin: { ...origin }, sectionDirection: { ...direction }, sectionPixels: size } });
  }
  return sections;
}

function rayCut(origin, endpoint, a, b) {
  const ray = sub(endpoint, origin), along = sub(b, a), offset = sub(a, origin), denominator = cross(ray, along);
  if (Math.abs(denominator) <= EPSILON) return null;
  const distance = cross(offset, along) / denominator, t = cross(offset, ray) / denominator;
  return distance >= 0 && t > EPSILON && t < 1 - EPSILON ? t : null;
}

/** Find positive-length area contact visible from the original blast origin. Endpoint-only touches miss. */
function visibleContact(section, polygons, origin, blockers, wallId, budget) {
  const cuts = [0, 1];
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.vertices.length; i++) {
      budget.step();
      const hit = segmentIntersection(section.a, section.b, polygon.vertices[i], polygon.vertices[(i + 1) % polygon.vertices.length]);
      if (hit) cuts.push(hit.t);
    }
  }
  // Exposure changes at rays through blocker endpoints. Partitioning there also
  // catches a thin visible slice of a section rather than sampling only its center.
  for (const blocker of blockers) {
    if (blocker.id === wallId) continue;
    budget.step(3);
    const crossing = segmentIntersection(section.a, section.b, point(blocker.c[0], blocker.c[1]), point(blocker.c[2], blocker.c[3]));
    if (crossing) cuts.push(crossing.t);
    for (const endpoint of [point(blocker.c[0], blocker.c[1]), point(blocker.c[2], blocker.c[3])]) {
      const t = rayCut(origin, endpoint, section.a, section.b);
      if (t !== null) cuts.push(t);
    }
  }
  cuts.sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) {
    if ((cuts[i] - cuts[i - 1]) * section.length <= EPSILON) continue;
    const contact = lerp(section.a, section.b, (cuts[i - 1] + cuts[i]) / 2);
    budget.step(polygons.reduce((total, polygon) => total + polygon.vertices.length, 0));
    if (!inArea(contact, polygons)) continue;
    let occluded = false;
    for (const blocker of blockers) {
      if (blocker.id === wallId) continue;
      budget.step();
      const hit = segmentIntersection(origin, contact, point(blocker.c[0], blocker.c[1]), point(blocker.c[2], blocker.c[3]));
      if (hit && hit.t > EPSILON && hit.t < 1 - EPSILON) { occluded = true; break; }
    }
    if (!occluded) return contact;
  }
  return null;
}

/** One result per section per cast. Overlapping regions use the largest configured multiplier once. */
export function exposedAreaWallSections({ regions, walls, sectionPixels, levelRanges = {}, maximum = 2000, maximumWork = 2000000 }) {
  const exposed = new Map();
  const budget = { remaining: maximumWork, step(count = 1) {
    this.remaining -= count;
    if (this.remaining < 0) throw new Error("The area wall calculation is too complex. Reduce the area or split the cast.");
  } };
  // Native D&D5e may put several separately placed spell areas into one Region.
  // Each positive source shape needs its own origin and blocker visibility.
  const areas = regions.flatMap(region => {
    if (Array.isArray(region.sourceAreas) && region.sourceAreas.length) return region.sourceAreas.map(area => ({ ...region, origin: area.origin, sourcePolygons: area.sourcePolygons }));
    if ((region.sourceShapes ?? []).filter(shape => !shape.hole).length > 1) throw new Error("This multi-area Region has no per-area origins. No wall damage was applied.");
    return [region];
  });
  if (areas.length > 128 || walls.length > 10000) throw new Error("The area wall calculation contains too many areas or walls.");
  for (const region of areas) {
    if (![0.5, 1].includes(region.damageMultiplier)) continue;
    if (![region.origin?.x, region.origin?.y].every(Number.isFinite)) throw new Error("The damaging area has no valid origin.");
    const sources = region.sourcePolygons ?? region.polygons ?? [];
    if (sources.length > 512 || sources.reduce((total, polygon) => total + (polygon.points?.length ?? 0), 0) > 20000) throw new Error("The damaging area has too many polygon vertices.");
    const polygons = sources.map(poly => ({ hole: Boolean(poly.hole), vertices: vertices(poly) }));
    if (!polygons.some(poly => !poly.hole)) throw new Error("The damaging area has no supported source shape.");
    const bounds = box(polygons.filter(poly => !poly.hole).flatMap(poly => poly.vertices));
    const propagationBounds = box([point(bounds.left, bounds.top), point(bounds.right, bounds.bottom), region.origin]);
    const blockers = walls.filter(wall => isPhysicalAreaWall(wall, region, levelRanges)
      && boxesTouch(box([point(wall.c[0], wall.c[1]), point(wall.c[2], wall.c[3])]), propagationBounds));
    for (const wall of blockers) {
      if (!boxesTouch(box([point(wall.c[0], wall.c[1]), point(wall.c[2], wall.c[3])]), bounds)) continue;
      for (const section of areaWallSections(wall, sectionPixels, { bounds })) {
        if (!boxesTouch(box([section.a, section.b]), bounds)) continue;
        const key = `${wall.id}:${section.key}`, existing = exposed.get(key);
        if (existing?.multiplier >= region.damageMultiplier) continue;
        const impact = visibleContact(section, polygons, region.origin, blockers, wall.id, budget);
        if (!impact) continue;
        exposed.set(key, { wallId: wall.id, section: section.key, impact, center: section.center, length: section.length,
          multiplier: region.damageMultiplier, metadata: section.metadata });
        if (exposed.size > maximum) throw new Error("The area affects too many wall sections. Reduce the area or split the cast.");
      }
    }
  }
  return [...exposed.values()].sort((a, b) => a.wallId.localeCompare(b.wallId) || Number(a.section) - Number(b.section));
}

/** Subtract every breached interval from one original wall in one plan, preserving its endpoint direction. */
export function areaWallRemainders(coordinates, breaches) {
  const a = point(coordinates[0], coordinates[1]), b = point(coordinates[2], coordinates[3]);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!Number.isFinite(length) || length <= EPSILON) throw new Error("Cannot breach an invalid wall.");
  const project = p => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length;
  const gaps = breaches.map(section => {
    const center = project(section.center);
    return [Math.max(0, center - section.length / 2), Math.min(length, center + section.length / 2)];
  }).filter(([start, end]) => end - start > EPSILON).sort((x, y) => x[0] - y[0]);
  const intervals = [];
  let cursor = 0;
  for (const [start, end] of gaps) {
    if (start > cursor + EPSILON) intervals.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < length - EPSILON) intervals.push([cursor, length]);
  return intervals.map(([start, end]) => {
    const first = lerp(a, b, start / length), last = lerp(a, b, end / length);
    return [first.x, first.y, last.x, last.y];
  });
}
