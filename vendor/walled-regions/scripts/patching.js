/* globals
canvas,
game,
ui,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { Settings as ModuleSettings } from "./settings.js";
import { Patcher } from "./Patcher.js";

import { PATCHES as PATCHES_MeasuredTemplate } from "./MeasuredTemplate.js";
import { PATCHES as PATCHES_MeasuredTemplateConfig } from "./MeasuredTemplateConfig.js";
import { PATCHES as PATCHES_RegionConfig } from "./RegionConfig.js";
import { PATCHES as PATCHES_Region } from "./Region.js";
import { PATCHES as PATCHES_RegionShapeControls } from "./RegionShapeControls.js";
import { PATCHES as PATCHES_Token } from "./Token.js";
import { PATCHES as PATCHES_Wall } from "./Wall.js";
import { PATCHES as PATCHES_ActiveEffect } from "./ActiveEffect.js";
import { PATCHES as PATCHES_GridLayer } from "./GridLayer.js";
import { PATCHES as PATCHES_ItemSheet5e } from "./ItemSheet5e.js";
import {
  coreUsesRegions,
  measurementLayer,
  measurementLayerName,
  measurementPlaceables,
  supportsTemplateAutotarget
} from "./compatibility.js";


// Settings
import { PATCHES as PATCHES_ClientSettings } from "./ModuleSettingsAbstract.js";

export const PATCHES = {
  "foundry.documents.ActiveEffect": PATCHES_ActiveEffect,
  "foundry.helpers.ClientSettings": PATCHES_ClientSettings,
  "foundry.canvas.layers.GridLayer": PATCHES_GridLayer,

  "CONFIG.MeasuredTemplate.objectClass": PATCHES_MeasuredTemplate,
  // "foundry.canvas.placeables.MeasuredTemplate": PATCHES_MeasuredTemplate,

  "foundry.applications.sheets.MeasuredTemplateConfig": PATCHES_MeasuredTemplateConfig,
  "foundry.applications.sheets.RegionConfig": PATCHES_RegionConfig,
  "foundry.canvas.placeables.Region": PATCHES_Region,
  "foundry.canvas.placeables.regions.RegionShapeControls": PATCHES_RegionShapeControls,
  "foundry.canvas.placeables.Token": PATCHES_Token,
  "foundry.canvas.placeables.Wall": PATCHES_Wall,
};


const SYSTEM_PATCHES = {
  dnd5e: {
    "dnd5e.applications.item.ItemSheet5e": PATCHES_ItemSheet5e,
  },
}


export const PATCHER = new Patcher();


export function initializePatching() {
  const patches = { ...PATCHES };
  // V14 keeps deprecated template shims; patch the actual Region workflow.
  if ( coreUsesRegions() ) {
    delete patches["CONFIG.MeasuredTemplate.objectClass"];
    delete patches["foundry.applications.sheets.MeasuredTemplateConfig"];
  } else {
    delete patches["foundry.applications.sheets.RegionConfig"];
    delete patches["foundry.canvas.placeables.Region"];
    delete patches["foundry.canvas.placeables.regions.RegionShapeControls"];
  }
  PATCHER.addPatchesFromRegistrationObject(patches);
  if ( Object.hasOwn(SYSTEM_PATCHES, game.system.id) ) PATCHER.addPatchesFromRegistrationObject(SYSTEM_PATCHES[game.system.id]);

  PATCHER.registerGroup("BASIC");
  PATCHER.registerGroup(game.system.id);
}

/**
 * Register the autotargeting patches. Must be done after settings are enabled.
 */
export function registerAutotargeting() {
  const autotarget = ModuleSettings.get(ModuleSettings.KEYS.AUTOTARGET.MENU) !== ModuleSettings.KEYS.AUTOTARGET.CHOICES.NO;

  // Disable existing targeting before completely removing autotarget patches
  if ( PATCHER.groupIsRegistered("AUTOTARGET") && !autotarget ) {
    measurementPlaceables().forEach(t => {
      if ( supportsTemplateAutotarget(t) ) t.autotargetTokens();
    });
  }

  PATCHER.deregisterGroup("AUTOTARGET");
  if ( autotarget ) { PATCHER.registerGroup("AUTOTARGET"); }

  // Redraw the toggle button.
  if ( measurementLayer()?.active && ui.controls ) ui.controls.initialize({ layer: measurementLayerName() });
}
