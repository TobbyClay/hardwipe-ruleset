/* globals
CONFIG,
PIXI,
*/
"use strict";

import { pixelsToGridUnits } from "./geometry/util.js";

export function buildCircleShape(distancePixels) {
  const legacyBuilder = CONFIG.MeasuredTemplate?.objectClass?.getCircleShape;
  if ( legacyBuilder ) return legacyBuilder(pixelsToGridUnits(distancePixels));
  return new PIXI.Circle(0, 0, distancePixels);
}

export function buildRayShape(distancePixels, directionDegrees, widthPixels) {
  const legacyBuilder = CONFIG.MeasuredTemplate?.objectClass?.getRayShape;
  if ( legacyBuilder ) return legacyBuilder(
    pixelsToGridUnits(distancePixels),
    directionDegrees,
    pixelsToGridUnits(widthPixels)
  );

  const directionRadians = Math.toRadians(directionDegrees);
  const dx = Math.cos(directionRadians);
  const dy = Math.sin(directionRadians);
  const halfWidth = widthPixels * 0.5;
  const px = -dy * halfWidth;
  const py = dx * halfWidth;
  const x = dx * distancePixels;
  const y = dy * distancePixels;
  return new PIXI.Polygon([
    px, py,
    x + px, y + py,
    x - px, y - py,
    -px, -py
  ]);
}

export function buildConeShape(distancePixels, directionDegrees, angleDegrees, { density } = {}) {
  const legacyBuilder = CONFIG.MeasuredTemplate?.objectClass?.getConeShape;
  if ( legacyBuilder ) return legacyBuilder(
    pixelsToGridUnits(distancePixels),
    directionDegrees,
    angleDegrees
  );

  const directionRadians = Math.toRadians(directionDegrees);
  const angleRadians = Math.toRadians(angleDegrees);
  const start = directionRadians - (angleRadians * 0.5);
  const steps = density ?? Math.max(12, Math.ceil((Math.abs(angleDegrees) / 360) * Math.max(24, distancePixels / 16)));
  const points = [0, 0];
  for ( let i = 0; i <= steps; i += 1 ) {
    const theta = start + ((angleRadians * i) / steps);
    points.push(Math.cos(theta) * distancePixels, Math.sin(theta) * distancePixels);
  }
  return new PIXI.Polygon(points);
}

export function buildRectShape(distancePixels, directionDegrees) {
  const legacyBuilder = CONFIG.MeasuredTemplate?.objectClass?.getRectShape;
  if ( legacyBuilder ) return legacyBuilder(pixelsToGridUnits(distancePixels), directionDegrees);

  const side = distancePixels / Math.SQRT2;
  const radians = Math.toRadians(directionDegrees - 45);
  return rotatePolygonAroundOrigin(new PIXI.Polygon([
    0, 0,
    side, 0,
    side, side,
    0, side
  ]), radians);
}

function rotatePolygonAroundOrigin(polygon, radians) {
  if ( !radians ) return polygon;

  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotated = [];
  for ( let i = 0; i < polygon.points.length; i += 2 ) {
    const x = polygon.points[i];
    const y = polygon.points[i + 1];
    rotated.push((x * cos) - (y * sin), (x * sin) + (y * cos));
  }
  return new PIXI.Polygon(rotated);
}
