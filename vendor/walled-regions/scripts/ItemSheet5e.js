import { readDocumentFlag } from "./util.js";
/* globals
canvas,
dnd5e,
game,
Hooks,
PIXI,
renderTemplate,
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { MODULE_ID, MODULE_KEY, FLAGS, LABELS, TEMPLATES, bundledRegionsEnabled } from "./const.js";
import { Settings } from "./settings.js";
import { normalizeShapeType } from "./compatibility.js";

const unsupportedShapeWarnings = new WeakMap();

function warnUnsupportedDamageShapes(item, shapes) {
  const mode = readDocumentFlag(item, MODULE_ID, FLAGS.WALLS_BLOCK);
  if (!itemUsesWalledTemplates(item) || !["damage-normal", "damage-half"].includes(mode)) return;
  const unsupported = [...new Set(shapes.filter(shape => !Settings.KEYS.DEFAULT_SNAPPING[normalizeShapeType(shape)]))];
  if (!unsupported.length) return;
  const previous = unsupportedShapeWarnings.get(item);
  const signature = unsupported.join(", ");
  if (previous?.signature === signature && Date.now() - previous.time < 1000) return;
  unsupportedShapeWarnings.set(item, { signature, time: Date.now() });
  ui.notifications.warn(`Hardwipe: wall damage is unavailable for ${signature} areas in ${item.name}. Those shapes require manual wall damage; supported shapes are circles, cones, lines, and rectangles.`);
}

export const PATCHES = {};
PATCHES.dnd5e = {};

// ----- NOTE: Tidy 5e Sheet ----- //

Hooks.once("tidy5e-sheet.ready", api => {
  if (bundledRegionsEnabled()) renderTidy5eItemSheetHook(api);
});

/**
 * Hook tidy5e-sheet.ready to add template configuration options for spells in tidy-5e item sheets.
 * @param {Object} api tidy5e's api
 */
function renderTidy5eItemSheetHook(api) {
  const myTab = new api.models.HtmlTab({
    title: game.i18n.localize(`${MODULE_KEY}.MeasuredTemplateConfiguration.LegendTitle`),
    tabId: MODULE_KEY,
    html: '',
    enabled(data) {
      return itemHasModuleTab(data.item);
    },
    onRender(params) {
      if (!itemHasModuleTab(params.data.item)) return;
      // const app = params.app;
      // const html = [params.element];
      const data = params.data;
      const parts = { tidy5e: params.tabContentsElement };
      return renderTidy5eSpellTemplateConfig(parts, data);
    }
  });
  api.registerItemTab(myTab, { autoHeight: true });
}

async function renderTidy5eSpellTemplateConfig(parts, data) {
  const item = data.item;
  if ( !item ) return;

  await initializeItemWalledTemplateFlags(item);

  // Set variable to know if we are dealing with a template
  // const areaType = context.system.target.template.type;
  //   context.isTemplate = areaType in CONFIG.DND5E.areaTargetTypes;

  data[MODULE_KEY] = {
    flagPath: `flags.${MODULE_ID}`,
    flags: getItemSheetFlags(item),
    damageWalls: ["damage-normal", "damage-half"].includes(readDocumentFlag(item, MODULE_ID, FLAGS.WALLS_BLOCK)),
    blockoptions: LABELS.SPELL_TEMPLATE.WALLS_BLOCK,
    walloptions: LABELS.SPELL_TEMPLATE.WALL_RESTRICTION,
    attachtokenoptions: LABELS.SPELL_TEMPLATE.ATTACH_TOKEN,
    hideoptions: LABELS.TEMPLATE_HIDE
  };

  const template = TEMPLATES.DND5E;
  const myHTML = await foundry.applications.handlebars.renderTemplate(template, data);

  // Create a new tab entry for the module.
  const div = document.createElement("DIV");
  div.innerHTML = myHTML;
  parts.tidy5e.appendChild(div);
}


// Patches for dnd5e ItemSheet5e

// ----- NOTE: Hooks ----- //

// Hook ready to update the PARTS of the dnd5e item sheet.
// Have to wait until dnd5e system sets up.
Hooks.once("init", function() {
  if (!bundledRegionsEnabled()) return;
  if ( game.system.id !== "dnd5e" ) return;

  const ItemSheet5e = dnd5e.applications.item.ItemSheet5e
  ItemSheet5e.PARTS[MODULE_KEY] = { template: TEMPLATES.DND5E, scrollable: [''] };
  if (ItemSheet5e.TABS.some(tab => tab.tab === MODULE_KEY)) return;
  ItemSheet5e.TABS.push({
    label: `${MODULE_KEY}.MeasuredTemplateConfiguration.LegendTitle`,
    tab: MODULE_KEY,
    condition: itemHasModuleTab
  });
});

/**
 * Hook dnd5e.preCreateActivityTemplate
 * Add pertinent WT information based on the item or activity to construct the template.
 *
 * ---
 * A hook event that fires before a template is created for an Activity.
 * @function dnd5e.preCreateActivityTemplate
 * @memberof hookEvents
 * @param {Activity} activity    Activity for which the template is being placed.
 * @param {object} templateData  Data used to create the new template.
 * @returns {boolean}            Explicitly return `false` to prevent the template from being placed.
 */
function preCreateActivityTemplate(activity, templateData) {
  // For now, use the item flags and global defaults.
  // TODO: Determine how to incorporate activity data.
  const item = templateData.item ?? activity.item;
  if ( !item ) return;
  // Store flags in the template data object.
  templateData.flags ??= {};
  const flags = templateData.flags[MODULE_ID] ??= {};
  flags[FLAGS.ENABLED] = itemUsesWalledTemplates(item);
  if ( !flags[FLAGS.ENABLED] ) return;
  const shape = normalizeShapeType(templateData.t);
  if ( !Settings.KEYS.DEFAULT_SNAPPING[shape] ) {
    warnUnsupportedDamageShapes(item, [shape]);
    return;
  }

  // Wall settings.
  let wallsBlock = readDocumentFlag(item, MODULE_ID, FLAGS.WALLS_BLOCK);
  let wallRestriction = readDocumentFlag(item, MODULE_ID, FLAGS.WALL_RESTRICTION);
  if ( !wallsBlock
    || wallsBlock === LABELS.GLOBAL_DEFAULT ) wallsBlock = Settings.get(Settings.KEYS.DEFAULT_WALLS_BLOCK[shape]);
  if ( !wallRestriction || wallRestriction === LABELS.GLOBAL_DEFAULT ) {
    wallRestriction = Settings.get(Settings.KEYS.DEFAULT_WALL_RESTRICTION[shape]);
  }
  flags[FLAGS.WALLS_BLOCK] = wallsBlock;
  flags[FLAGS.WALL_RESTRICTION] = wallRestriction;

  // Autotargeting.
  flags[FLAGS.NO_AUTOTARGET] = readDocumentFlag(item, MODULE_ID, FLAGS.NO_AUTOTARGET) ?? false;

  // Hide settings.
  flags[FLAGS.HIDE.BORDER] = readDocumentFlag(item, MODULE_ID, FLAGS.HIDE.BORDER) ?? LABELS.GLOBAL_DEFAULT;
  flags[FLAGS.HIDE.HIGHLIGHTING] = readDocumentFlag(item, MODULE_ID, FLAGS.HIDE.HIGHLIGHTING) ?? LABELS.GLOBAL_DEFAULT;
  flags[FLAGS.HIDE.SHOW_ON_HOVER] = readDocumentFlag(item, MODULE_ID, FLAGS.HIDE.SHOW_ON_HOVER) ?? LABELS.GLOBAL_DEFAULT;

  // Snapping.
  flags[FLAGS.SNAPPING.CENTER] = readDocumentFlag(item, MODULE_ID, FLAGS.SNAPPING.CENTER) ?? Settings.get(Settings.KEYS.DEFAULT_SNAPPING[shape].CENTER);
  flags[FLAGS.SNAPPING.CORNER] = readDocumentFlag(item, MODULE_ID, FLAGS.SNAPPING.CORNER) ?? Settings.get(Settings.KEYS.DEFAULT_SNAPPING[shape].CORNER);
  flags[FLAGS.SNAPPING.SIDE_MIDPOINT] = readDocumentFlag(item, MODULE_ID, FLAGS.SNAPPING.SIDE_MIDPOINT) ?? Settings.get(Settings.KEYS.DEFAULT_SNAPPING[shape].SIDE_MIDPOINT);

}

/**
 * Hook dnd5.createActivityTemplate
 * Add pertinent WT information to the template based on the item or activity
 * ---
 * A hook event that fires after a template are created for an Activity.
 * @function dnd5e.createActivityTemplate
 * @memberof hookEvents
 * @param {Activity} activity            Activity for which the template is being placed.
 * @param {AbilityTemplate[]} templates  The templates being placed.
 */
function createActivityTemplate(activity, templates) {
  // For now, use the item flags and global defaults.
  // TODO: Determine how to incorporate activity data.
  const item = activity.item;
  if ( !item ) return;
  if ( !itemUsesWalledTemplates(item) ) return;
  if ( !readDocumentFlag(item, MODULE_ID, FLAGS.ADD_TOKEN_SIZE) ) return;

  // Expand to account for token size.
  const templateOrigin = PIXI.Point.tmp;
  for ( const template of templates ) {
    const templateD = template.document;

    // Does the template originate on a token? (Use the first token found.)
    templateOrigin.copyFrom(templateD);
    const token = canvas.tokens.placeables.find(t => templateOrigin.almostEqual(t.center));
    if ( token ) {
      // Add 1/2 token size to the template distance.
      const { width, height } = token.document;
      const size = Math.min(width, height) * canvas.dimensions.distance;
      templateD.updateSource({ distance: templateD.distance + size });
    }

  }
  templateOrigin.release();
}

/**
 * Hook dnd5e.postUseActivity
 * Attach template to caster or target if that setting was enabled.
 * Must wait until after template preview is done, for at least two reasons:
 * (1) No template id during preview, which breaks attaching.
 * (2) Could cause tokens to move around during preview, which is not good.
 * ---
 * A hook event that fires when an activity is activated.
 * @function dnd5e.postUseActivity
 * @memberof hookEvents
 * @param {Activity} activity                     Activity being activated.
 * @param {ActivityUseConfiguration} usageConfig  Configuration data for the activation.
 * @param {ActivityUsageResults} results          Final details on the activation.
 * @returns {boolean}  Explicitly return `false` to prevent any subsequent actions from being triggered.
 */
function postUseActivity(activity, usageConfig, results) {
  // For now, use the item flags and global defaults.
  // TODO: Determine how to incorporate activity data.
  const item = activity.item;
  if ( !item ) return;
  if ( !itemUsesWalledTemplates(item) ) return;
}

function createMeasuredTemplate(activity, regions) {
  for ( const regionData of regions ) {
    warnUnsupportedDamageShapes(activity.item, (regionData.shapes ?? []).filter(shape => !shape.hole).map(shape => shape.type));
    const shape = regionData.shapes?.find(s => !s.hole);
    if ( !shape || !Settings.KEYS.DEFAULT_SNAPPING[normalizeShapeType(shape.type)] ) continue;
    regionData.flags ??= {};
    preCreateActivityTemplate(activity, {
      item: activity.item,
      t: shape.type,
      flags: regionData.flags
    });
  }
}

PATCHES.dnd5e.HOOKS = {
  "dnd5e.createMeasuredTemplate": createMeasuredTemplate,
  "dnd5e.preCreateActivityTemplate": preCreateActivityTemplate,
  "dnd5e.createActivityTemplate": createActivityTemplate,
  "dnd5e.postUseActivity": postUseActivity,
};

// ----- NOTE: Wraps ----- //

/**
 * Add in module-specific data to the dnd5e spell tab.
 * @param {string} partId                         The part being rendered
 * @param {ApplicationRenderContext} context      Shared context provided by _prepareContext
 * @param {HandlebarsRenderOptions} options       Options which configure application rendering behavior
 * @returns {Promise<ApplicationRenderContext>}   Context data for a specific part
 */
export async function _preparePartContext(wrapper, partId, context, options) {
  context = await wrapper(partId, context, options);
  if ( partId !== MODULE_KEY ) return context;
  const item = this.item;
  if ( !item ) return context;

  await initializeItemWalledTemplateFlags(item);

  // Set variable to know if we are dealing with a template
  // const areaType = context.system.target.template.type;
//   context.isTemplate = areaType in CONFIG.DND5E.areaTargetTypes;

  context[MODULE_KEY] = {
    flagPath: `flags.${MODULE_ID}`,
    flags: getItemSheetFlags(item),
    damageWalls: ["damage-normal", "damage-half"].includes(readDocumentFlag(item, MODULE_ID, FLAGS.WALLS_BLOCK)),
    blockoptions: LABELS.SPELL_TEMPLATE.WALLS_BLOCK,
    walloptions: LABELS.SPELL_TEMPLATE.WALL_RESTRICTION,
    attachtokenoptions: LABELS.SPELL_TEMPLATE.ATTACH_TOKEN,
    hideoptions: LABELS.TEMPLATE_HIDE
  };
  return context;
}

PATCHES.dnd5e.WRAPS = {
  _preparePartContext,
};

// ----- NOTE: Helper functions ----- //

/**
 * Should this item include a Walled Regions tab in its sheet?
 * @param {Item5e}
 * @returns {boolean} True for spells, feats.
 */
function itemHasModuleTab(item) {
  return item?.type === "spell" || item?.type === "feat"
    || [...(item?.system?.activities?.values?.() ?? Object.values(item?.system?.activities ?? {}))]
      .some(activity => activity.target?.template?.type);
}

async function initializeItemWalledTemplateFlags(_item) {
  // Defaults are presentation data. Viewing a sheet must not persist flags or
  // trigger multiple document updates; the native form writes explicit choices.
}

function itemUsesWalledTemplates(item) {
  const enabled = readDocumentFlag(item, MODULE_ID, FLAGS.ENABLED);
  return typeof enabled === "undefined" ? true : enabled;
}

function getItemSheetFlags(item) {
  return {
    [FLAGS.WALLS_BLOCK]: LABELS.GLOBAL_DEFAULT,
    [FLAGS.WALL_RESTRICTION]: LABELS.GLOBAL_DEFAULT,
    [FLAGS.SNAPPING.CENTER]: true,
    [FLAGS.SNAPPING.CORNER]: true,
    [FLAGS.SNAPPING.SIDE_MIDPOINT]: true,
    ...(item.flags?.[MODULE_ID] ?? {}),
    [FLAGS.ENABLED]: itemUsesWalledTemplates(item)
  };
}

function resolveActivityAttachmentToken(item) {
  const attachToken = readDocumentFlag(item, MODULE_ID, FLAGS.ATTACHED_TOKEN.SPELL_TEMPLATE);
  if ( !attachToken || attachToken === "na" ) return null;

  switch ( attachToken ) {
    case "caster": return item.parent?.token ?? item.parent?.getActiveTokens?.()[0] ?? null;
    case "target": return [...game.user.targets.values()].at(-1) ?? null;
    default: return null;
  }
}

async function attachActivityRegionsToToken(results, token) {
  const tokenId = token.document?.id ?? token.id;
  if ( !tokenId ) return;

  const updates = [];
  for ( const templateGroup of results?.templates ?? [] ) {
    const regions = Array.isArray(templateGroup) ? templateGroup : [templateGroup];
    for ( const template of regions ) {
      const regionD = template?.document ?? template?.object?.document ?? template;
      if ( !regionD?.update ) continue;
      updates.push(regionD.update({
        attachment: { token: tokenId },
        [`flags.${MODULE_ID}.${FLAGS.REGION.PENDING_ATTACHMENT_TOKEN}`]: null
      }));
    }
  }

  if ( updates.length ) await Promise.allSettled(updates);
}
