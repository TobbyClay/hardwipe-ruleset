import { readDocumentFlag } from "./util.js";
/* globals
foundry,
game,
PIXI,
*/
"use strict";

import { FLAGS, MODULE_ID, normalizeWallMode, wallDamageMultiplier } from "./const.js";
import { Settings } from "./settings.js";
import { normalizeShapeType } from "./compatibility.js";
import { pixelsToGridUnits } from "./geometry/util.js";
import { WalledTemplateShape } from "./template_shapes/WalledTemplateShape.js";

export const PATCHES = {};
PATCHES.BASIC = {};

const SYNC_OPTION = `${MODULE_ID}.syncRegionEffectiveData`;
const PENDING_REGION_SYNCS = new Map();
const WT_MEASUREMENT_OVERLAY = Symbol(`${MODULE_ID}.measurementOverlay`);

function preCreateRegionHook(regionD, _data, _options, _userId) {
  if ( !isManagedWalledRegionDocument(regionD, { includeStored: false }) ) return;
  const updates = {};
  const shape = primaryShapeTypeForDocument(regionD);
  if ( !supportsWalledTemplateShape(shape) ) return;

  if ( typeof readDocumentFlag(regionD, MODULE_ID, FLAGS.REGION.ROLE) === "undefined" ) {
    updates[`flags.${MODULE_ID}.${FLAGS.REGION.ROLE}`] = FLAGS.REGION.ROLES.SOURCE;
  }

  const pendingAttachmentTokenId = readDocumentFlag(regionD, MODULE_ID, FLAGS.REGION.PENDING_ATTACHMENT_TOKEN);
  if ( pendingAttachmentTokenId && !regionD.attachment?.token ) {
    updates["attachment.token"] = pendingAttachmentTokenId;
  }

  if ( !foundry.utils.isEmpty(updates) ) regionD.updateSource(updates);
}

function createRegionHook(regionD, _options, _userId) {
  if ( !game.user.isActiveGM ) return;
  if ( !isManagedWalledRegionDocument(regionD) ) return;
  scheduleRegionEffectiveData(regionD);
}

function updateRegionHook(regionD, change, options, _userId) {
  if ( !game.user.isActiveGM ) return;
  if ( options?.[SYNC_OPTION] ) return;
  if ( !isManagedWalledRegionDocument(regionD) ) return;

  const changed = new Set(Object.keys(foundry.utils.flattenObject(change)));
  const trackedFlags = [
    `flags.${MODULE_ID}.${FLAGS.WALLS_BLOCK}`,
    `flags.${MODULE_ID}.${FLAGS.WALL_RESTRICTION}`,
    `flags.${MODULE_ID}.${FLAGS.REGION.ROLE}`,
    `shapes`,
    `elevation`,
    `visibility`,
    `color`,
    `name`
  ];
  if ( !trackedFlags.some(key => changed.has(key) || [...changed].some(changedKey => changedKey.startsWith(`${key}.`))) ) return;

  scheduleRegionEffectiveData(regionD);
}

function deleteRegionHook(regionD, options, _userId) { // eslint-disable-line no-unused-vars
  if ( !game.user.isActiveGM ) return;
  cancelScheduledRegionSync(regionD);
  const sourceId = readDocumentFlag(regionD, MODULE_ID, FLAGS.REGION.SOURCE_ID);
  if ( !sourceId ) return;

  const source = regionD.parent?.regions?.get(sourceId);
  if ( !source ) return;
  source.update({
    [`flags.${MODULE_ID}.${FLAGS.REGION.EFFECTIVE_ID}`]: null
  }, { [SYNC_OPTION]: true });
}

PATCHES.BASIC.HOOKS = {
  preCreateRegion: preCreateRegionHook,
  createRegion: createRegionHook,
  updateRegion: updateRegionHook,
  deleteRegion: deleteRegionHook
};

function primaryShapeType() {
  return primaryShapeTypeForDocument(this.document);
}

function isWalledRegionSource() {
  return readDocumentFlag(this.document, MODULE_ID, FLAGS.REGION.ROLE) !== FLAGS.REGION.ROLES.EFFECTIVE;
}

function effectiveRegionShapes() {
  return readDocumentFlag(this.document, MODULE_ID, FLAGS.REGION.EFFECTIVE_SHAPES) ?? [];
}

function usesWalledRegionBehavior() {
  return isManagedWalledRegionDocument(this.document);
}

async function syncEffectiveRegionData() {
  return syncRegionEffectiveData(this.document);
}

function buildEffectiveRegionData() {
  return buildEffectiveRegionDataForDocument(this.document);
}

async function draw(wrapped, ...args) {
  const out = await wrapped(...args);
  ensureWTMeasurementOverlay(this);
  refreshWTMeasurementOverlay(this);
  return out;
}

function _refreshMeasurements(wrapped, ...args) {
  const out = wrapped(...args);
  refreshWTMeasurementOverlay(this);
  return out;
}

function _refreshGeometry(wrapped, ...args) {
  const out = wrapped(...args);
  refreshWTMeasurementOverlay(this);
  return out;
}

function _refreshState(wrapped, ...args) {
  const out = wrapped(...args);
  refreshWTMeasurementOverlay(this);
  return out;
}

function _updateDragPreviews(wrapped, event) {
  const out = wrapped(event);
  const { origin, shape, offset } = event.interactionData;
  const dx = shape.origin.x - (origin.x - offset.x);
  const dy = shape.origin.y - (origin.y - offset.y);
  for ( const clone of event.interactionData.clones ?? [] ) {
    applyRegionPreviewTranslation(clone.document, dx, dy, clone._original?.document);
    refreshPreviewEffectiveRegionData(clone.document);
  }
  return out;
}

function _prepareDragLeftDropUpdates(wrapped, event) {
  const updates = wrapped(event);
  const clones = event.interactionData.clones ?? [];
  for ( const update of updates ) {
    const clone = clones.find(candidate => candidate._original?.id === update._id);
    if ( !clone ) continue;
    const flagUpdate = getRegionFlagUpdateData(clone.document);
    if ( flagUpdate ) foundry.utils.mergeObject(update, flagUpdate);
  }
  return updates;
}

PATCHES.BASIC.GETTERS = {
  primaryShapeType,
  isWalledRegionSource,
  effectiveRegionShapes,
  usesWalledRegionBehavior
};

PATCHES.BASIC.METHODS = {
  syncEffectiveRegionData,
  buildEffectiveRegionData
};

PATCHES.BASIC.WRAPS = {
  draw,
  _refreshGeometry,
  _refreshMeasurements,
  _refreshState,
  _updateDragPreviews,
  _prepareDragLeftDropUpdates
};

function primaryShapeTypeForDocument(regionD) {
  const primaryShape = getPrimarySourceShapeData(regionD);
  return normalizeShapeType(primaryShape?.type);
}

export function isManagedWalledRegionDocument(regionD, { includeStored = true } = {}) {
  if ( !regionD ) return false;
  if ( readDocumentFlag(regionD, MODULE_ID, FLAGS.ENABLED) === false ) return false;
  if ( readDocumentFlag(regionD, MODULE_ID, FLAGS.REGION.ROLE) === FLAGS.REGION.ROLES.EFFECTIVE ) return false;
  const wallsBlock = readDocumentFlag(regionD, MODULE_ID, FLAGS.WALLS_BLOCK);
  const wallRestriction = readDocumentFlag(regionD, MODULE_ID, FLAGS.WALL_RESTRICTION);
  const sourceShape = readDocumentFlag(regionD, MODULE_ID, FLAGS.REGION.SOURCE_SHAPE);
  if ( typeof wallsBlock !== "undefined" ) return true;
  if ( typeof wallRestriction !== "undefined" ) return true;
  if ( typeof sourceShape !== "undefined" ) return true;
  if ( !includeStored ) return false;
  return Array.isArray(readDocumentFlag(regionD, MODULE_ID, FLAGS.REGION.SOURCE_SHAPES))
    || Array.isArray(readDocumentFlag(regionD, MODULE_ID, FLAGS.REGION.EFFECTIVE_SHAPES));
}

function scheduleRegionEffectiveData(regionD) {
  if ( !regionD?.id ) return;
  cancelScheduledRegionSync(regionD);
  const timeoutId = setTimeout(() => {
    PENDING_REGION_SYNCS.delete(regionD.id);
    // A wall change can schedule this immediately before its Region is removed.
    // Only the parent's current embedded document may be synchronized.
    const refreshed = regionD.parent?.regions?.get(regionD.id);
    if (!refreshed) return;
    void syncRegionEffectiveData(refreshed);
  }, 0);
  PENDING_REGION_SYNCS.set(regionD.id, timeoutId);
}

function cancelScheduledRegionSync(regionD) {
  const timeoutId = PENDING_REGION_SYNCS.get(regionD?.id);
  if ( !timeoutId ) return;
  clearTimeout(timeoutId);
  PENDING_REGION_SYNCS.delete(regionD.id);
}

function buildEffectiveRegionDataForDocument(regionD) {
  const sourceShapes = getSourceShapeData(regionD);
  return buildEffectiveRegionDataFromSourceShapes(regionD, sourceShapes);
}

/**
 * Read-only, immutable scene-coordinate snapshot for Hardwipe's impact review.
 * Recompute before damage is proposed; never reevaluate after applying a breach.
 */
export function computeRegionGeometry(regionD) {
  if (!regionD) return null;
  const sourceShapes = getSourceShapeData(regionD);
  const effective = WalledTemplateShape.shapeCodeRegister.size
    ? buildEffectiveRegionDataFromSourceShapes(regionD, sourceShapes)
    : regionD.object?.buildEffectiveRegionData?.();
  const shapes = effective ? getEffectiveRegionShapesForData(regionD, effective) : serializeRegionShapes(regionD.shapes);
  const primary = sourceShapes.find(shape => !shape.hole);
  const shapeModel = primary ? instantiateRegionShapeData(primary, regionD) : null;
  const origin = shapeModel ? getShapeOrigin(shapeModel, primary, shapeModel.polygons ?? []) : pointFromXY(primary);
  const wallMode = readDocumentFlag(regionD, MODULE_ID, FLAGS.WALLS_BLOCK) ?? "walled";
  const snapshot = {
    sourceShape: normalizeShapeType(primary?.type),
    sourceShapes: foundry.utils.deepClone(sourceShapes),
    shapes: foundry.utils.deepClone(shapes),
    sourcePolygons: shapesToPlainPolygons(sourceShapes, regionD),
    sourceAreas: sourceShapes.filter(shape => !shape.hole).map(shape => {
      const sourceShape = normalizeShapeType(shape.type);
      const model = instantiateRegionShapeData(shape, regionD);
      const shapeOrigin = ["circle", "cone", "ray", "rect"].includes(sourceShape)
        ? (model ? getShapeOrigin(model, shape, model.polygons ?? []) : pointFromXY(shape)) : null;
      const areaShapes = [shape, ...sourceShapes.filter(candidate => candidate.hole)];
      return {
        sourceShape,
        origin: shapeOrigin ? { x: shapeOrigin.x, y: shapeOrigin.y } : null,
        sourceShapes: foundry.utils.deepClone(areaShapes),
        sourcePolygons: shapesToPlainPolygons(areaShapes, regionD)
      };
    }),
    polygons: shapesToPlainPolygons(shapes, regionD),
    wallMode,
    normalizedWallMode: normalizeWallMode(wallMode),
    damageMultiplier: wallDamageMultiplier(wallMode),
    origin: origin ? { x: origin.x, y: origin.y } : null,
    elevation: { bottom: regionD.elevation?.bottom ?? null, top: regionD.elevation?.top ?? null,
      topInclusive: Boolean(regionD.elevation?.topInclusive) },
    level: [...(regionD.levels ?? [])][0] ?? null,
    levels: [...(regionD.levels ?? [])],
    originUuid: readDocumentFlag(regionD, "dnd5e", "origin") ?? null,
    flags: {
      dnd5e: foundry.utils.deepClone(regionD.flags?.dnd5e ?? {}),
      "midi-qol": foundry.utils.deepClone(regionD.flags?.["midi-qol"] ?? {})
    }
  };
  return freezeGeometrySnapshot(snapshot);
}

function shapesToPlainPolygons(shapes, regionD) {
  return shapes.flatMap(shapeData => {
    if (Array.isArray(shapeData.points)) return [{ points: [...shapeData.points], hole: Boolean(shapeData.hole) }];
    const model = instantiateRegionShapeData(shapeData, regionD);
    return [...(model?.polygons ?? [])].map(polygon => ({ points: [...polygon.points], hole: Boolean(shapeData.hole) }));
  });
}

function freezeGeometrySnapshot(value) {
  if (!value || typeof value !== "object") return value;
  for (const child of Object.values(value)) freezeGeometrySnapshot(child);
  return Object.freeze(value);
}

function buildEffectiveRegionDataFromSourceShapes(regionD, sourceShapes) {
  const shape = primaryShapeTypeForDocument(regionD);
  const role = readDocumentFlag(regionD, MODULE_ID, FLAGS.REGION.ROLE) ?? FLAGS.REGION.ROLES.SOURCE;
  if ( role === FLAGS.REGION.ROLES.EFFECTIVE ) return null;
  if ( !supportsWalledTemplateShape(shape) ) return null;

  const wallsBlock = readDocumentFlag(regionD, MODULE_ID, FLAGS.WALLS_BLOCK)
    ?? Settings.get(Settings.KEYS.DEFAULT_WALLS_BLOCK[shape]);
  if ( wallsBlock === Settings.KEYS.DEFAULT_WALLS_BLOCK.CHOICES.UNWALLED ) return {
    sourceShape: shape,
    sourceShapes,
    shapes: []
  };

  const shapes = sourceShapes.flatMap(shapeData => {
    const type = normalizeShapeType(shapeData.type);
    // Keep holes and unsupported shapes intact in multi-shape regions.
    if ( shapeData.hole || !supportsWalledTemplateShape(type) ) return [shapeData];
    const model = instantiateRegionShapeData(shapeData, regionD);
    return polygonsToRegionShapeData(buildEffectivePolygonsForRegion(regionD, model, type));
  });
  return { sourceShape: shape, sourceShapes, shapes };
}

async function syncRegionEffectiveData(regionD) {
  if (!regionD?.id || regionD.parent?.regions?.get(regionD.id) !== regionD) return;
  const effectiveData = buildEffectiveRegionDataForDocument(regionD);
  if ( !effectiveData ) return;

  const nextShapes = getEffectiveRegionShapesForData(regionD, effectiveData);

  const update = {
    shapes: nextShapes,
    [`flags.${MODULE_ID}.${FLAGS.REGION.SOURCE_SHAPE}`]: effectiveData.sourceShape,
    [`flags.${MODULE_ID}.${FLAGS.REGION.SOURCE_SHAPES}`]: effectiveData.sourceShapes,
    [`flags.${MODULE_ID}.${FLAGS.REGION.EFFECTIVE_SHAPES}`]: effectiveData.shapes
  };

  if (regionD.parent?.regions?.get(regionD.id) !== regionD) return;
  // Persist the source metadata and resulting shapes together. A second awaited
  // update could otherwise run after deletion or expose mismatched metadata.
  return regionD.update(update, { [SYNC_OPTION]: true, diff: false });
}

export function refreshPreviewEffectiveRegionData(regionD) {
  if ( !isManagedWalledRegionDocument(regionD) ) return false;
  const effectiveData = buildEffectiveRegionDataForDocument(regionD);
  if ( !effectiveData ) return false;
  regionD.updateSource(foundry.utils.expandObject({
    shapes: getEffectiveRegionShapesForData(regionD, effectiveData),
    ...getRegionFlagUpdateData(regionD, effectiveData)
  }));
  regionD.object?.renderFlags?.set({ refreshShapes: true, refreshGeometry: true, refreshMeasurements: true });
  regionD.updateShapeConstraints?.();
  return true;
}

export function refreshPreviewEffectiveRegionDataFromSourceHandle(regionD, handleName, destination, { snap = false } = {}) {
  if ( !isManagedWalledRegionDocument(regionD) ) return false;

  const storedSourceShapes = readDocumentFlag(regionD, MODULE_ID, FLAGS.REGION.SOURCE_SHAPES);
  if ( !Array.isArray(storedSourceShapes) || !storedSourceShapes.length ) return false;

  const sourceShapes = foundry.utils.deepClone(storedSourceShapes);
  const primaryIndex = sourceShapes.findIndex(shape => !shape?.hole);
  if ( primaryIndex < 0 ) return false;

  const primaryShapeData = sourceShapes[primaryIndex];
  const shapeType = normalizeShapeType(primaryShapeData?.type);
  const sourceHandleName = mapSourceHandleName(shapeType, handleName);
  if ( !sourceHandleName ) return false;

  const primaryShape = instantiateRegionShapeData(primaryShapeData, regionD);
  if ( !primaryShape?.moveControlHandle ) return false;

  primaryShape.moveControlHandle(sourceHandleName, destination, { snap });
  sourceShapes[primaryIndex] = primaryShape.toObject?.(true) ?? primaryShape.toObject?.() ?? foundry.utils.deepClone(primaryShape);

  const effectiveData = buildEffectiveRegionDataFromSourceShapes(regionD, sourceShapes);
  if ( !effectiveData ) return false;

  regionD.updateSource(foundry.utils.expandObject({
    shapes: getEffectiveRegionShapesForData(regionD, effectiveData),
    ...getRegionFlagUpdateData(regionD, effectiveData)
  }));
  regionD.object?.renderFlags?.set({ refreshShapes: true, refreshGeometry: true, refreshMeasurements: true });
  regionD.updateShapeConstraints?.();
  return true;
}

function applyRegionPreviewTranslation(regionD, dx, dy, originalRegionD = regionD) {
  if ( !isManagedWalledRegionDocument(regionD) ) return false;
  if ( !Number.isFinite(dx) || !Number.isFinite(dy) ) return false;
  if ( almostEqual(dx, 0) && almostEqual(dy, 0) ) return false;

  const originalSourceShapes = readDocumentFlag(originalRegionD, MODULE_ID, FLAGS.REGION.SOURCE_SHAPES);
  const originalEffectiveShapes = readDocumentFlag(originalRegionD, MODULE_ID, FLAGS.REGION.EFFECTIVE_SHAPES);
  const transform = { scale: 1, angle: 0, cos: 1, sin: 0, tx: dx, ty: dy };
  const update = {};

  if ( Array.isArray(originalSourceShapes) && originalSourceShapes.length ) {
    update[`flags.${MODULE_ID}.${FLAGS.REGION.SOURCE_SHAPES}`] = originalSourceShapes.map(shape => transformShapeData(shape, transform));
  }

  if ( Array.isArray(originalEffectiveShapes) && originalEffectiveShapes.length ) {
    update[`flags.${MODULE_ID}.${FLAGS.REGION.EFFECTIVE_SHAPES}`] = originalEffectiveShapes.map(shape => transformShapeData(shape, transform));
  }

  if ( foundry.utils.isEmpty(update) ) return false;
  regionD.updateSource(foundry.utils.expandObject(update));
  return true;
}

export function getRegionFlagUpdateData(regionD, effectiveData) {
  if ( !isManagedWalledRegionDocument(regionD) ) return null;
  effectiveData ??= buildEffectiveRegionDataForDocument(regionD);
  if ( !effectiveData ) return null;
  return {
    [`flags.${MODULE_ID}.${FLAGS.REGION.ROLE}`]: readDocumentFlag(regionD, MODULE_ID, FLAGS.REGION.ROLE) ?? FLAGS.REGION.ROLES.SOURCE,
    [`flags.${MODULE_ID}.${FLAGS.REGION.SOURCE_SHAPE}`]: effectiveData.sourceShape,
    [`flags.${MODULE_ID}.${FLAGS.REGION.SOURCE_SHAPES}`]: effectiveData.sourceShapes,
    [`flags.${MODULE_ID}.${FLAGS.REGION.EFFECTIVE_SHAPES}`]: effectiveData.shapes
  };
}

function getEffectiveRegionShapesForData(regionD, effectiveData) {
  const wallsBlock = readDocumentFlag(regionD, MODULE_ID, FLAGS.WALLS_BLOCK)
    ?? Settings.get(Settings.KEYS.DEFAULT_WALLS_BLOCK[effectiveData.sourceShape]);
  return wallsBlock === Settings.KEYS.DEFAULT_WALLS_BLOCK.CHOICES.UNWALLED
    ? effectiveData.sourceShapes
    : (effectiveData.shapes.length ? effectiveData.shapes : effectiveData.sourceShapes);
}

function mapSourceHandleName(shapeType, handleName) {
  switch ( handleName ) {
    case "translate": return "translate";
    case "rotate": return "rotate";
    case "scale":
      if ( shapeType === "ray" ) return "scaleX";
      return "scale";
    default: return null;
  }
}

function polygonsToRegionShapeData(polygons) {
  return polygons.map(polygon => polygonToRegionShapeData(polygon)).filter(Boolean);
}

function polygonToRegionShapeData(polygon) {
  const points = [...polygon.points];
  if ( points.length < 6 ) return null;

  const lastIndex = points.length - 2;
  if ( almostEqual(points[0], points[lastIndex]) && almostEqual(points[1], points[lastIndex + 1]) ) {
    points.splice(lastIndex, 2);
  }

  return {
    type: "polygon",
    hole: false,
    points
  };
}

function almostEqual(a, b, epsilon = 1e-06) {
  return Math.abs(a - b) <= epsilon;
}

function getPrimaryRegionShape(regionD) {
  return regionD.shapes?.find(shape => !shape.hole);
}

function getPrimarySourceShapeData(regionD) {
  return getSourceShapeData(regionD).find(shape => !shape.hole);
}

function getSourceShapeData(regionD) {
  const current = serializeRegionShapes(regionD.shapes);
  const currentPrimaryShape = current.find(shape => !shape?.hole);
  const currentPrimaryType = normalizeShapeType(currentPrimaryShape?.type);
  if ( supportsWalledTemplateShape(currentPrimaryType) ) return current;

  const stored = readDocumentFlag(regionD, MODULE_ID, FLAGS.REGION.SOURCE_SHAPES);
  if ( Array.isArray(stored) && stored.length ) {
    const transformed = transformStoredSourceShapes(regionD, current, stored);
    if ( transformed ) return transformed;
    return foundry.utils.deepClone(stored);
  }
  return current;
}

function transformStoredSourceShapes(regionD, currentShapes, storedSourceShapes) {
  const storedEffectiveShapes = readDocumentFlag(regionD, MODULE_ID, FLAGS.REGION.EFFECTIVE_SHAPES);
  if ( !Array.isArray(storedEffectiveShapes) || !storedEffectiveShapes.length ) return null;

  const transform = inferShapeTransform(currentShapes, storedEffectiveShapes);
  if ( !transform ) return null;
  if ( isIdentityTransform(transform) ) return foundry.utils.deepClone(storedSourceShapes);
  return storedSourceShapes.map(shape => transformShapeData(shape, transform));
}

function inferShapeTransform(currentShapes, referenceShapes) {
  if ( currentShapes.length !== referenceShapes.length ) return null;

  const currentPolygons = currentShapes.filter(shape => shape?.type === "polygon" && !shape?.hole);
  const referencePolygons = referenceShapes.filter(shape => shape?.type === "polygon" && !shape?.hole);
  if ( !currentPolygons.length || currentPolygons.length !== referencePolygons.length ) return null;

  const basis = firstShapeSegment(referencePolygons[0], currentPolygons[0]);
  if ( !basis ) return null;

  const { referenceA, referenceB, currentA, currentB } = basis;
  const referenceDX = referenceB.x - referenceA.x;
  const referenceDY = referenceB.y - referenceA.y;
  const currentDX = currentB.x - currentA.x;
  const currentDY = currentB.y - currentA.y;

  const referenceLength = Math.hypot(referenceDX, referenceDY);
  const currentLength = Math.hypot(currentDX, currentDY);
  if ( !referenceLength || !currentLength ) return null;

  const scale = currentLength / referenceLength;
  const angle = Math.atan2(currentDY, currentDX) - Math.atan2(referenceDY, referenceDX);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tx = currentA.x - ((referenceA.x * scale * cos) - (referenceA.y * scale * sin));
  const ty = currentA.y - ((referenceA.x * scale * sin) + (referenceA.y * scale * cos));

  for ( let i = 0; i < currentShapes.length; i += 1 ) {
    const currentShape = currentShapes[i];
    const referenceShape = referenceShapes[i];
    if ( currentShape?.type !== referenceShape?.type ) return null;
    if ( Boolean(currentShape?.hole) !== Boolean(referenceShape?.hole) ) return null;

    if ( currentShape?.type !== "polygon" ) return null;

    const currentPoints = currentShape.points ?? [];
    const referencePoints = referenceShape.points ?? [];
    if ( currentPoints.length !== referencePoints.length ) return null;

    for ( let j = 0; j < currentPoints.length; j += 2 ) {
      const transformed = transformPoint(referencePoints[j], referencePoints[j + 1], { scale, cos, sin, tx, ty });
      if ( !almostEqual(currentPoints[j], transformed.x, 1e-03) ) return null;
      if ( !almostEqual(currentPoints[j + 1], transformed.y, 1e-03) ) return null;
    }
  }

  return { scale, angle, cos, sin, tx, ty };
}

function firstShapeSegment(referenceShape, currentShape) {
  const referencePoints = referenceShape?.points ?? [];
  const currentPoints = currentShape?.points ?? [];
  if ( referencePoints.length !== currentPoints.length ) return null;
  if ( referencePoints.length < 4 ) return null;

  const referenceA = { x: referencePoints[0], y: referencePoints[1] };
  const currentA = { x: currentPoints[0], y: currentPoints[1] };
  for ( let i = 2; i < referencePoints.length; i += 2 ) {
    const referenceB = { x: referencePoints[i], y: referencePoints[i + 1] };
    const currentB = { x: currentPoints[i], y: currentPoints[i + 1] };
    if ( almostEqual(referenceA.x, referenceB.x) && almostEqual(referenceA.y, referenceB.y) ) continue;
    if ( almostEqual(currentA.x, currentB.x) && almostEqual(currentA.y, currentB.y) ) continue;
    return { referenceA, referenceB, currentA, currentB };
  }
  return null;
}

function isIdentityTransform(transform) {
  return almostEqual(transform.scale, 1) && almostEqual(transform.angle, 0) && almostEqual(transform.tx, 0) && almostEqual(transform.ty, 0);
}

function transformShapeData(shape, transform) {
  const translated = foundry.utils.deepClone(shape);

  if ( Number.isFinite(translated.x) && Number.isFinite(translated.y) ) {
    const point = transformPoint(translated.x, translated.y, transform);
    translated.x = point.x;
    translated.y = point.y;
  }

  if ( translated.origin && Number.isFinite(translated.origin.x) && Number.isFinite(translated.origin.y) ) {
    const origin = transformPoint(translated.origin.x, translated.origin.y, transform);
    translated.origin.x = origin.x;
    translated.origin.y = origin.y;
  }

  if ( Number.isFinite(translated.rotation) ) translated.rotation = normalizeDegrees(translated.rotation + Math.toDegrees(transform.angle));

  if ( Number.isFinite(translated.radius) ) translated.radius *= transform.scale;
  if ( Number.isFinite(translated.radiusX) ) translated.radiusX *= transform.scale;
  if ( Number.isFinite(translated.radiusY) ) translated.radiusY *= transform.scale;
  if ( Number.isFinite(translated.length) ) translated.length *= transform.scale;
  if ( Number.isFinite(translated.width) ) translated.width *= transform.scale;
  if ( Number.isFinite(translated.height) ) translated.height *= transform.scale;
  if ( Number.isFinite(translated.innerWidth) ) translated.innerWidth *= transform.scale;
  if ( Number.isFinite(translated.outerWidth) ) translated.outerWidth *= transform.scale;

  if ( Array.isArray(translated.points) ) {
    for ( let i = 0; i < translated.points.length; i += 2 ) {
      const point = transformPoint(translated.points[i], translated.points[i + 1], transform);
      translated.points[i] = point.x;
      translated.points[i + 1] = point.y;
    }
  }

  return translated;
}

function transformPoint(x, y, transform) {
  return {
    x: ((x * transform.scale * transform.cos) - (y * transform.scale * transform.sin)) + transform.tx,
    y: ((x * transform.scale * transform.sin) + (y * transform.scale * transform.cos)) + transform.ty
  };
}

function firstShapePoint(shape) {
  if ( !Array.isArray(shape?.points) || shape.points.length < 2 ) return null;
  return { x: shape.points[0], y: shape.points[1] };
}

function serializeRegionShapes(shapes = []) {
  return shapes.map(shape => shape?.toObject?.(true) ?? shape?.toObject?.() ?? foundry.utils.deepClone(shape));
}

function instantiateRegionShapeData(shapeData, regionD) {
  if ( !shapeData?.type ) return null;
  const ShapeClass = REGION_SHAPE_DATA_MODELS[shapeData.type];
  if ( !ShapeClass ) return null;
  try {
    return ShapeClass.fromSource
      ? ShapeClass.fromSource(foundry.utils.deepClone(shapeData), { parent: regionD })
      : new ShapeClass(foundry.utils.deepClone(shapeData), { parent: regionD });
  } catch(error) {
    console.error(`${MODULE_ID}|Failed to instantiate source Region shape ${shapeData.type}.`, error);
    return null;
  }
}

function buildEffectivePolygonsForRegion(regionD, primaryShape, shapeType) {
  if ( !primaryShape ) return [...(regionD.polygons ?? [])];

  const walledClass = WalledTemplateShape.shapeCodeRegister.get(shapeType);
  if ( !walledClass ) return [...(regionD.polygons ?? [])];

  const adaptedTemplate = createRegionTemplateAdapter(regionD, primaryShape, shapeType);
  if ( !adaptedTemplate ) return [...(regionD.polygons ?? [])];

  try {
    const walledTemplate = new walledClass(adaptedTemplate);
    const computedShape = walledTemplate.computeShape();
    return extractEffectivePolygons(computedShape, regionD);
  } catch(error) {
    console.error(`${MODULE_ID}|Failed to compute effective Region geometry for ${regionD.uuid}.`, error);
    return [...(regionD.polygons ?? [])];
  }
}

function createRegionTemplateAdapter(regionD, primaryShape, shapeType) {
  const source = getRegionShapeSource(primaryShape);
  const polygons = getRegionShapePolygons(primaryShape, regionD);
  const origin = getShapeOrigin(primaryShape, source, polygons);
  if ( !origin ) return null;

  const templateData = extractTemplateData(shapeType, primaryShape, polygons, origin);
  if ( !templateData ) return null;

  const elevation = getRegionElevation(regionD);
  return {
    x: origin.x,
    y: origin.y,
    elevationZ: elevation,
    elevationE: elevation,
    item: null,
    document: {
      level: regionD.parent?.levels?.get(regionD.levels?.values?.().next().value) ?? canvas.level,
      t: shapeType,
      angle: templateData.angle ?? 0,
      direction: templateData.direction ?? 0,
      distance: templateData.distance ?? 0,
      width: templateData.width ?? 0,
      shapes: regionD.shapes,
      flags: regionD.flags,
      physicalRegion: regionD
    }
  };
}

function extractEffectivePolygons(computedShape, regionD) {
  if ( computedShape?._shape instanceof PIXI.Polygon ) return [computedShape._shape];
  return [...(regionD.polygons ?? [])];
}

function getRegionShapeSource(shape) {
  return shape?.toObject?.(true) ?? shape?.toObject?.() ?? shape ?? {};
}

function getRegionShapePolygons(shape, regionD) {
  return shape?.polygons?.length ? [...shape.polygons] : [...(regionD.polygons ?? [])];
}

function getShapeOrigin(shape, source, polygons) {
  const explicitOrigin = shape?.origin ?? pointFromXY(source);
  if ( explicitOrigin ) return PIXI.Point.fromObject(explicitOrigin);

  const measuredSegment = getPrimaryMeasuredSegment(shape);
  if ( measuredSegment?.ray?.A ) return PIXI.Point.fromObject(measuredSegment.ray.A);

  const point = firstPolygonPoint(polygons);
  return point ? PIXI.Point.fromObject(point) : null;
}

function pointFromXY(source) {
  if ( Number.isFinite(source?.x) && Number.isFinite(source?.y) ) return { x: source.x, y: source.y };
  if ( Number.isFinite(source?.origin?.x) && Number.isFinite(source?.origin?.y) ) return source.origin;
  return null;
}

function extractTemplateData(shapeType, shape, polygons, origin) {
  switch ( shapeType ) {
    case "circle": return extractCircleTemplateData(shape, polygons, origin);
    case "cone": return extractConeTemplateData(shape, polygons, origin);
    case "ray": return extractRayTemplateData(shape, polygons, origin);
    case "rect": return extractRectTemplateData(shape, polygons, origin);
    default: return null;
  }
}

function extractCircleTemplateData(shape, polygons, origin) {
  const segment = getPrimaryMeasuredSegment(shape);
  const distance = getMeasuredSegmentDistance(segment) ?? pixelsToGridUnits(maxDistanceFrom(origin, polygonPoints(polygons)));
  if ( !Number.isFinite(distance) || distance <= 0 ) return null;
  return { distance, direction: 0, angle: 360, width: 0 };
}

function extractConeTemplateData(shape, polygons, origin) {
  const segment = getPrimaryMeasuredSegment(shape, { preferAngle: true });
  const points = polygonPoints(polygons);
  const distance = getMeasuredSegmentDistance(segment) ?? pixelsToGridUnits(maxDistanceFrom(origin, points));
  const direction = getMeasuredSegmentDirection(segment) ?? inferConeDirectionDegrees(origin, points);
  const angle = Number.isFinite(segment?.angle) ? segment.angle : inferConeAngleDegrees(origin, points);
  if ( !Number.isFinite(distance) || distance <= 0 || !Number.isFinite(direction) || !Number.isFinite(angle) || angle <= 0 ) return null;
  return { distance, direction, angle, width: 0 };
}

function extractRayTemplateData(shape, polygons, origin) {
  const segment = getPrimaryMeasuredSegment(shape);
  const points = polygonPoints(polygons);
  const direction = getMeasuredSegmentDirection(segment) ?? inferDirectionDegrees(origin, farthestPointFrom(origin, points));
  const distance = getMeasuredSegmentDistance(segment)
    ?? pixelsToGridUnits(maxProjectionAlongDirection(origin, points, direction));
  const width = pixelsToGridUnits(inferLineWidthPixels(origin, points, direction));
  if ( !Number.isFinite(distance) || distance <= 0 || !Number.isFinite(direction) || !Number.isFinite(width) || width <= 0 ) return null;
  return { distance, direction, angle: 0, width };
}

function extractRectTemplateData(_shape, polygons, origin) {
  const farthest = farthestPointFrom(origin, polygonPoints(polygons));
  if ( !farthest ) return null;

  const direction = inferDirectionDegrees(origin, farthest);
  const distance = pixelsToGridUnits(PIXI.Point.distanceBetween(origin, farthest));
  if ( !Number.isFinite(distance) || distance <= 0 || !Number.isFinite(direction) ) return null;
  return { distance, direction, angle: 0, width: 0 };
}

function getPrimaryMeasuredSegment(shape, { preferAngle = false } = {}) {
  const segments = [...(shape?.measuredSegments ?? [])].filter(Boolean);
  if ( !segments.length ) return null;

  const candidates = preferAngle
    ? segments.filter(segment => Number.isFinite(segment.angle))
    : segments;
  const measuredSegments = candidates.length ? candidates : segments;
  return measuredSegments.reduce((best, segment) => {
    const bestDistance = getMeasuredSegmentDistance(best) ?? 0;
    const segmentDistance = getMeasuredSegmentDistance(segment) ?? 0;
    return segmentDistance > bestDistance ? segment : best;
  }, measuredSegments[0]);
}

function getMeasuredSegmentDistance(segment) {
  if ( Number.isFinite(segment?.distance) ) return segment.distance;
  if ( segment?.ray?.A && segment?.ray?.B ) return pixelsToGridUnits(PIXI.Point.distanceBetween(segment.ray.A, segment.ray.B));
  return null;
}

function getMeasuredSegmentDirection(segment) {
  if ( !segment ) return null;
  if ( Number.isFinite(segment?.direction) ) return normalizeDegrees(segment.direction);
  if ( Number.isFinite(segment?.rotation) ) return normalizeDegrees(segment.rotation);
  if ( Number.isFinite(segment?.ray?.angle) ) return normalizeDegrees(Math.toDegrees(segment.ray.angle));
  if ( segment?.ray?.A && segment?.ray?.B ) return inferDirectionDegrees(segment.ray.A, segment.ray.B);
  return null;
}

function getRegionElevation(regionD) {
  if ( Number.isFinite(readDocumentFlag(regionD, MODULE_ID, "elevation")) ) return readDocumentFlag(regionD, MODULE_ID, "elevation");
  const elevation = regionD?.elevation;
  if ( Number.isFinite(elevation?.bottom) ) return elevation.bottom;
  if ( Number.isFinite(elevation?.top) ) return elevation.top;
  if ( Number.isFinite(elevation) ) return elevation;
  return 0;
}

function polygonPoints(polygons) {
  const points = [];
  for ( const polygon of polygons ) {
    if ( !polygon?.points?.length ) continue;
    const polygonPoints = [...polygon.points];
    const lastIndex = polygonPoints.length - 2;
    if ( polygonPoints.length >= 4
      && almostEqual(polygonPoints[0], polygonPoints[lastIndex])
      && almostEqual(polygonPoints[1], polygonPoints[lastIndex + 1]) ) {
      polygonPoints.splice(lastIndex, 2);
    }

    for ( let i = 0; i < polygonPoints.length; i += 2 ) {
      points.push(new PIXI.Point(polygonPoints[i], polygonPoints[i + 1]));
    }
  }
  return points;
}

function firstPolygonPoint(polygons) {
  for ( const polygon of polygons ) {
    if ( polygon?.points?.length >= 2 ) return { x: polygon.points[0], y: polygon.points[1] };
  }
  return null;
}

function maxDistanceFrom(origin, points) {
  return points.reduce((max, point) => Math.max(max, PIXI.Point.distanceBetween(origin, point)), 0);
}

function farthestPointFrom(origin, points) {
  let farthest = null;
  let maxDistance = -1;
  for ( const point of points ) {
    const distance = PIXI.Point.distanceSquaredBetween(origin, point);
    if ( distance <= maxDistance ) continue;
    farthest = point;
    maxDistance = distance;
  }
  return farthest;
}

function inferDirectionDegrees(origin, point) {
  if ( !origin || !point ) return null;
  return normalizeDegrees(Math.toDegrees(Math.atan2(point.y - origin.y, point.x - origin.x)));
}

function inferLineWidthPixels(origin, points, directionDegrees) {
  if ( !points.length ) return 0;
  const radians = Math.toRadians(directionDegrees);
  const perpX = -Math.sin(radians);
  const perpY = Math.cos(radians);

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for ( const point of points ) {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    const projection = (dx * perpX) + (dy * perpY);
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }
  return Math.max(0, max - min);
}

function maxProjectionAlongDirection(origin, points, directionDegrees) {
  const radians = Math.toRadians(directionDegrees);
  const dirX = Math.cos(radians);
  const dirY = Math.sin(radians);
  let max = 0;
  for ( const point of points ) {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    max = Math.max(max, (dx * dirX) + (dy * dirY));
  }
  return max;
}

function inferConeDirectionDegrees(origin, points) {
  const interval = smallestContainingAngleInterval(points, origin);
  return interval ? normalizeDegrees(interval.start + (interval.span * 0.5)) : null;
}

function inferConeAngleDegrees(origin, points) {
  return smallestContainingAngleInterval(points, origin)?.span ?? null;
}

function smallestContainingAngleInterval(points, origin) {
  if ( !points.length ) return null;

  const distances = points
    .map(point => ({ point, distance: PIXI.Point.distanceBetween(origin, point) }))
    .filter(entry => entry.distance > 1);
  if ( !distances.length ) return null;

  const maxDistance = distances.reduce((max, entry) => Math.max(max, entry.distance), 0);
  const farPoints = distances.filter(entry => entry.distance >= (maxDistance * 0.5)).map(entry => entry.point);
  const angles = farPoints.map(point => normalizeDegrees(Math.toDegrees(Math.atan2(point.y - origin.y, point.x - origin.x))));
  if ( !angles.length ) return null;
  if ( angles.length === 1 ) return { start: angles[0], span: 0 };

  const sorted = angles.sort((a, b) => a - b);
  let largestGap = -1;
  let gapIndex = 0;
  for ( let i = 0; i < sorted.length; i += 1 ) {
    const current = sorted[i];
    const next = sorted[(i + 1) % sorted.length] + (i === (sorted.length - 1) ? 360 : 0);
    const gap = next - current;
    if ( gap <= largestGap ) continue;
    largestGap = gap;
    gapIndex = i;
  }

  const start = sorted[(gapIndex + 1) % sorted.length];
  const end = sorted[gapIndex] + (gapIndex < (sorted.length - 1) ? 0 : 360);
  return {
    start,
    span: Math.max(0, end - start)
  };
}

function normalizeDegrees(value) {
  if ( !Number.isFinite(value) ) return value;
  value %= 360;
  if ( value < 0 ) value += 360;
  return value;
}

function supportsWalledTemplateShape(shapeType) {
  return Boolean(shapeType
    && Settings.KEYS.DEFAULT_WALLS_BLOCK[shapeType]
    && WalledTemplateShape.shapeCodeRegister.has(shapeType));
}

function buildRegionMeasurementPath(regionD) {
  const sourceShapes = getSourceShapeData(regionD);
  const primaryShapeData = sourceShapes.find(shape => !shape?.hole);
  if ( !primaryShapeData ) return null;

  const shapeType = normalizeShapeType(primaryShapeData.type);
  switch ( shapeType ) {
    case "ray": return buildRayMeasurementPath(regionD, primaryShapeData);
    case "cone": return buildConeMeasurementPath(regionD, primaryShapeData);
    default: return null;
  }
}

function buildRayMeasurementPath(regionD, primaryShapeData) {
  const origin = pointFromXY(primaryShapeData);
  if ( !origin ) return null;

  const distance = Number(primaryShapeData.distance);
  const direction = Number(primaryShapeData.rotation ?? primaryShapeData.direction ?? 0);
  if ( !Number.isFinite(distance) || distance <= 0 || !Number.isFinite(direction) ) return null;

  const start = PIXI.Point.fromObject(origin);
  const wallsBlock = readDocumentFlag(regionD, MODULE_ID, FLAGS.WALLS_BLOCK)
    ?? Settings.get(Settings.KEYS.DEFAULT_WALLS_BLOCK.ray);
  const reflectedSegments = wallsBlock === Settings.KEYS.DEFAULT_WALLS_BLOCK.CHOICES.RECURSE
    ? buildReflectedSegments(regionD, primaryShapeData, {
      start,
      distance,
      direction,
      width: Number(primaryShapeData.width ?? 0)
    }) : [];

  const effectivePoints = polygonPoints(regionD.polygons ?? []);
  const effectiveDistancePixels = maxProjectionAlongDirection(start, effectivePoints, direction);
  const effectiveDistance = effectiveDistancePixels > 0 ? pixelsToGridUnits(effectiveDistancePixels) : distance;
  const end = PIXI.Point.fromAngle(start, Math.toRadians(direction), effectiveDistancePixels || (distance * canvas.dimensions.distancePixels));
  const firstSegment = { A: start, B: end, distance: effectiveDistance, direction };

  const segments = reflectedSegments.length ? reflectedSegments : [firstSegment];
  return {
    segments,
    labelDistance: distance,
    labelPoint: midpointOfSegmentPath(segments)
  };
}

function buildConeMeasurementPath(regionD, primaryShapeData) {
  return buildRayMeasurementPath(regionD, primaryShapeData);
}

function buildReflectedSegments(regionD, primaryShapeData, { start, distance, direction, width }) {
  const primaryShape = instantiateRegionShapeData(primaryShapeData, regionD);
  const shapeType = normalizeShapeType(primaryShapeData.type);
  const adaptedTemplate = createRegionTemplateAdapter(regionD, primaryShape, shapeType);
  if ( !adaptedTemplate ) return [];

  const walledClass = WalledTemplateShape.shapeCodeRegister.get(shapeType);
  if ( !walledClass ) return [];

  const walledTemplate = new walledClass(adaptedTemplate, {
    origin: { x: start.x, y: start.y, z: getRegionElevation(regionD) },
    direction: Math.toRadians(direction),
    distance: distance * canvas.dimensions.distancePixels,
    width: width * canvas.dimensions.distancePixels
  });

  const sweep = walledTemplate.computeSweep();
  const subtemplates = walledTemplate._generateSubtemplates?.(sweep) ?? [];
  if ( !subtemplates.length ) return [];

  const segments = [];
  let currentStart = start;
  let remainingDistance = distance;
  let currentDirection = direction;

  for ( const subtemplate of subtemplates ) {
    const edge = subtemplate.options?.reflectedEdge;
    const reflectionPoint = edge?._reflectionPoint;
    if ( !reflectionPoint ) continue;

    const reflectionPixiPoint = PIXI.Point.fromObject(reflectionPoint);
    const segmentDistancePixels = PIXI.Point.distanceBetween(currentStart, reflectionPixiPoint);
    const segmentDistance = pixelsToGridUnits(segmentDistancePixels);
    segments.push({ A: currentStart, B: reflectionPixiPoint, distance: segmentDistance, direction: currentDirection });

    currentStart = reflectionPixiPoint;
    remainingDistance = subtemplate.distance / canvas.dimensions.distancePixels;
    currentDirection = Math.toDegrees(subtemplate.direction);
    const reflectedEnd = PIXI.Point.fromAngle(currentStart, subtemplate.direction, subtemplate.distance);
    segments.push({ A: currentStart, B: reflectedEnd, distance: remainingDistance, direction: currentDirection });
    break;
  }

  return segments;
}

function drawRegionMeasurementPath(region, measurementPath) {
  const overlay = ensureWTMeasurementOverlay(region);
  const graphics = overlay.graphics;
  const labels = overlay.labels;
  if ( !graphics || !labels ) return;
  const bounds = region.bounds ?? region.document?.bounds ?? { x: 0, y: 0 };
  const offsetX = bounds.x ?? 0;
  const offsetY = bounds.y ?? 0;

  graphics.clear();
  labels.removeChildren().forEach(label => label.destroy?.());

  const dashStyle = region._measurementDashLineStyle ?? { width: 2, color: 0x000000, alpha: 0.6 };
  graphics.lineStyle(dashStyle);
  drawDashedPolyline(graphics, measurementPath.segments, offsetX, offsetY);

  const labelText = region.formatMeasuredDistance?.(measurementPath.labelDistance) ?? formatDistanceLabel(measurementPath.labelDistance);
  const labelStyle = region.getMeasurementTextStyle?.() ?? foundry.utils.mergeObject(CONFIG.canvasTextStyle, {
    fontSize: 28,
    fill: 0xFFFFFF,
    stroke: 0x000000,
    strokeThickness: 4
  });
  const label = labels.addChild(new PIXI.Text(String(labelText), labelStyle));
  label.anchor?.set?.(0.5, 0.5);
  label.position.set(measurementPath.labelPoint.x - offsetX, measurementPath.labelPoint.y - offsetY);
  overlay.visible = true;
}

function drawDashedPolyline(graphics, segments, offsetX = 0, offsetY = 0) {
  const dash = 8;
  const gap = 6;
  for ( const segment of segments ) {
    const dx = segment.B.x - segment.A.x;
    const dy = segment.B.y - segment.A.y;
    const length = Math.hypot(dx, dy);
    if ( !length ) continue;
    const ux = dx / length;
    const uy = dy / length;
    let traveled = 0;
    while ( traveled < length ) {
      const dashStart = traveled;
      const dashEnd = Math.min(length, traveled + dash);
      graphics.moveTo((segment.A.x + (ux * dashStart)) - offsetX, (segment.A.y + (uy * dashStart)) - offsetY);
      graphics.lineTo((segment.A.x + (ux * dashEnd)) - offsetX, (segment.A.y + (uy * dashEnd)) - offsetY);
      traveled += dash + gap;
    }
  }
}

function midpointOfSegmentPath(segments) {
  const total = segments.reduce((sum, segment) => sum + PIXI.Point.distanceBetween(segment.A, segment.B), 0);
  let remaining = total / 2;
  for ( const segment of segments ) {
    const segLength = PIXI.Point.distanceBetween(segment.A, segment.B);
    if ( remaining > segLength ) {
      remaining -= segLength;
      continue;
    }

    const ratio = segLength ? (remaining / segLength) : 0;
    return new PIXI.Point(
      segment.A.x + ((segment.B.x - segment.A.x) * ratio),
      segment.A.y + ((segment.B.y - segment.A.y) * ratio)
    );
  }
  const last = segments.at(-1);
  return last ? new PIXI.Point((last.A.x + last.B.x) * 0.5, (last.A.y + last.B.y) * 0.5) : new PIXI.Point(0, 0);
}

function formatDistanceLabel(distance) {
  const units = canvas.scene?.grid?.units ?? canvas.scene?.dimensions?.units ?? "";
  return `${Math.round(distance * 10) / 10} ${units}`.trim();
}

function ensureWTMeasurementOverlay(region) {
  region[WT_MEASUREMENT_OVERLAY] ??= createWTMeasurementOverlay();
  if ( !region[WT_MEASUREMENT_OVERLAY].parent ) region.addChild(region[WT_MEASUREMENT_OVERLAY]);
  return region[WT_MEASUREMENT_OVERLAY];
}

function createWTMeasurementOverlay() {
  const container = new PIXI.Container();
  container.eventMode = "none";
  container.sortableChildren = false;
  const graphics = container.addChild(new PIXI.Graphics());
  const labels = container.addChild(new PIXI.Container());
  container.graphics = graphics;
  container.labels = labels;
  return container;
}

function refreshWTMeasurementOverlay(region) {
  const overlay = region[WT_MEASUREMENT_OVERLAY];
  if ( !overlay ) return;

  overlay.visible = false;
  overlay.graphics.clear();
  overlay.labels.removeChildren().forEach(label => label.destroy?.());

  if ( !shouldDrawWTMeasurementOverlay(region) ) return;
  const measurementPath = buildRegionMeasurementPath(region.document);
  if ( !measurementPath ) return;
  drawRegionMeasurementPath(region, measurementPath);
}

function shouldDrawWTMeasurementOverlay(region) {
  if ( !isManagedWalledRegionDocument(region.document) ) return false;
  const currentPrimaryShape = getPrimaryRegionShape(region.document);
  const currentPrimaryType = normalizeShapeType(currentPrimaryShape?.type);
  if ( supportsWalledTemplateShape(currentPrimaryType) ) return false;
  return region.controlled || region.isPreview || region.hover;
}

const REGION_SHAPE_DATA_MODELS = Object.freeze({
  circle: foundry.data.CircleShapeData,
  cone: foundry.data.ConeShapeData,
  line: foundry.data.LineShapeData,
  polygon: foundry.data.PolygonShapeData,
  rectangle: foundry.data.RectangleShapeData
});
