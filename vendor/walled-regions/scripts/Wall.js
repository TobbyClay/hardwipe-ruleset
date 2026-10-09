/* globals
canvas,
fromUuidSync,
PIXI
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { log } from "./util.js";
import { coreUsesRegions, measurementPlaceables } from "./compatibility.js";

// Hook wall modification to enable template shape changes.

export const PATCHES = {};
PATCHES.BASIC = {};

// ----- NOTE: Hooks ----- //

/**
 * createWall Hook
 * @param {WallDocument} document
 * @param {Object} options { temporary: Boolean, renderSheet: Boolean, render: Boolean }
 * @param {string} userId
 */
function createWallHook(document, options, _userId) {
  if (options.temporary || !document.object?.edge) return;

  const A = document.object.edge.a;
  const B = document.object.edge.b;
  log(`Refreshing templates on createWall ${A.x},${A.y}|${B.x},${B.y}.`);

  measurementPlaceables().forEach(t => {
    const bbox = measurementBounds(t);
    if ( !bbox ) return;
    if ( bbox.lineSegmentIntersects(A, B, { inside: true }) ) {
      log(`Wall ${document.id} intersects ${t.id}`);
      refreshMeasurement(t);
    }
  });
}

/**
 * Hook for preUpdateWall, so the existing wall can be checked for whether it
 * interacts with the template
 * @param {WallDocument} document
 * @param {Object} change { c: Array[], _id: String }  Array of four coordinates plus id
 * @param {Object} options { diff: Boolean, render: Boolean }
 * @param {string} userId
 */
function preUpdateWallHook(document, change, options, _userId) {
  const A = new PIXI.Point(document.c[0], document.c[1]);
  const B = new PIXI.Point(document.c[2], document.c[3]);

  // Issue #19: Door open/close passes a change.ds but not a change.c
  const newA = change.c ? new PIXI.Point(change.c[0], change.c[1]) : A;
  const newB = change.c ? new PIXI.Point(change.c[2], change.c[3]) : B;
  log(`Refreshing templates on preUpdateWall ${A.x},${A.y}|${B.x},${B.y} --> ${newA},${newA.y}|${newB.x},${newB.y}`);

  // We want to update the template if this wall was within the template or will be
  // within the template, but hold until updateWall is called.
  // Cannot pass the templates but can pass uuids.
  const coordinatesChanged = !(A.equals(newA) && B.equals(newB));
  const templatesToUpdate = options.templatesToUpdate = [];
  measurementPlaceables().forEach(t => {
    const bbox = measurementBounds(t);
    if ( !bbox ) return;
    if ( bbox.lineSegmentIntersects(A, B, { inside: true })
      || (coordinatesChanged
        && bbox.lineSegmentIntersects(newA, newB, { inside: true })) ) templatesToUpdate.push(t.document.uuid);
  });
  PIXI.Point.release(A, B, newA, newB);
}

/**
 * Hook for updateWall, so the existing wall can be checked for whether it
 * interacts with the template
 * @param {WallDocument} document
 * @param {Object} change { c: Array[], _id: String }  Array of four coordinates plus id
 * @param {Object} options { diff: Boolean, render: Boolean }
 * @param {string} userId
 */
function updateWallHook(document, change, options, _userId) {
  if ( !options.templatesToUpdate || !options.templatesToUpdate.length ) return;
  options.templatesToUpdate.forEach(uuid => {
    const tDoc = fromUuidSync(uuid);
    if ( !tDoc?.object ) return;
    refreshMeasurement(tDoc.object);
  });
}

/**
 * Hook for deleteWall.
 * @param {WallDocument} document
 * @param {Object} options { render: Boolean }
 * @param {string} userId
 */
function deleteWallHook(document, _options, _userId) {
  const A = PIXI.Point.tmp.set(document.c[0], document.c[1]);
  const B = PIXI.Point.tmp.set(document.c[2], document.c[3]);
  log(`Refreshing templates on deleteWall ${A.x},${A.y}|${B.x},${B.y}.`);

  measurementPlaceables().forEach(t => {
    const bbox = measurementBounds(t);
    if ( !bbox ) return;
    if ( bbox.lineSegmentIntersects(A, B, { inside: true }) ) {
      log(`Wall ${document.id} intersects ${t.id}`);
      refreshMeasurement(t);
    }
  });
  PIXI.Point.release(A, B);
}

PATCHES.BASIC.HOOKS = {
  createWall: createWallHook,
  preUpdateWall: preUpdateWallHook,
  updateWall: updateWallHook,
  deleteWall: deleteWallHook
};

function measurementBounds(placeable) {
  if ( coreUsesRegions() ) {
    if ( placeable.isWalledRegionSource === false ) return null;
    return placeable.document?.bounds ?? null;
  }

  if ( !placeable.shape?.getBounds ) return null;
  return placeable.shape.getBounds().translate(placeable.x, placeable.y);
}

function refreshMeasurement(placeable) {
  if ( coreUsesRegions() ) {
    if ( game.user.isActiveGM ) void placeable.syncEffectiveRegionData?.();
    return;
  }

  placeable.renderFlags.set({ refreshShape: true });
}
