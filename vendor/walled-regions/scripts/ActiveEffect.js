import { readDocumentFlag } from "./util.js";
/* globals
canvas,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { FLAGS, MODULE_ID } from "./const.js";
import { coreUsesRegions, findMeasurementById, supportsTemplateAttachment } from "./compatibility.js";

export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * If a template attachment effect is deleted, remove from the corresponding template.
 * @param {ActiveEffect} activeEffect
 * @param {object} opts
 * @param {string} id
 */
function deleteActiveEffectHook(activeEffect, _opts, _id) {
  if ( coreUsesRegions() ) return;
  const id = readDocumentFlag(activeEffect, MODULE_ID, FLAGS.ATTACHED_TEMPLATE_ID);
  if ( !id ) return;
  const measurement = findMeasurementById(id);
  if ( supportsTemplateAttachment(measurement) ) measurement.detachToken();
}

PATCHES.BASIC.HOOKS = { deleteActiveEffect: deleteActiveEffectHook };
