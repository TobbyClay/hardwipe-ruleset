/* globals
canvas,
CONFIG,
*/
"use strict";

const INTERNAL_SHAPE_TYPES = Object.freeze({
  circle: "circle",
  cone: "cone",
  line: "ray",
  ray: "ray",
  rect: "rect",
  rectangle: "rect"
});

export function coreUsesRegions() {
  return game.release.generation >= 14;
}

export function measurementLayer() {
  return coreUsesRegions() ? canvas.regions : canvas.templates;
}

export function measurementPlaceables() {
  return measurementLayer()?.placeables ?? [];
}

export function measurementPreviewChildren() {
  return measurementLayer()?.preview?.children ?? [];
}

export function measurementDocumentCollection() {
  return measurementLayer()?.documentCollection ?? null;
}

export function measurementEmbeddedName() {
  return coreUsesRegions() ? "Region" : "MeasuredTemplate";
}

export function measurementObjectClass() {
  return coreUsesRegions() ? CONFIG.Region?.objectClass : CONFIG.MeasuredTemplate?.objectClass;
}

export function measurementLayerName() {
  return measurementLayer()?.constructor?.layerOptions?.name;
}

export function measurementControlSet(controls) {
  return controls.regions ?? controls.templates;
}

export function findMeasurementById(id) {
  return measurementPlaceables().find(placeable => placeable.id === id);
}

export function supportsTemplateHover(placeable) {
  return typeof placeable?.boundsOverlap === "function";
}

export function supportsTemplateAttachment(placeable) {
  return typeof placeable?.detachToken === "function";
}

export function supportsTemplateAutotarget(placeable) {
  return typeof placeable?.autotargetTokens === "function";
}

export function normalizeShapeType(shapeType) {
  return INTERNAL_SHAPE_TYPES[shapeType] ?? shapeType;
}
