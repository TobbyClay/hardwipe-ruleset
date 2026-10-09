/* globals
foundry,
game,
Hooks,
*/

"use strict";

export const MODULE_ID = "walled-regions";
export const MODULE_KEY = "walledregions";
export const HOST_ID = "hardwipe-ruleset";
export const ASSET_ROOT = `modules/${HOST_ID}/vendor/walled-regions`;

/** Preserve stored Walled Regions flags while registering with the installed host. */
export function bundledRegionsEnabled() {
  return ![MODULE_ID, "walled-templates", "walledtemplates"].some(id => game.modules.get(id)?.active);
}

export function normalizeWallMode(mode) {
  return mode === "damage-normal" || mode === "damage-half" ? "walled" : mode;
}

export function wallDamageMultiplier(mode) {
  return mode === "damage-normal" ? 1 : mode === "damage-half" ? 0.5 : 0;
}

export const FLAGS = {
  /** @type {boolean} */
  ENABLED: "enabled",

  /** @type {LABELS.WALLS_BLOCK: "unwalled"|"walled"|"recurse"} */
  WALLS_BLOCK: "wallsBlock",

  /** @type {CONST.WALL_RESTRICTION_TYPES} */
  WALL_RESTRICTION: "wallRestriction",

  /** @type {object} */
  RECURSE_DATA: "recurseData",

  /** @type {string}*/
  ATTACHED_TEMPLATE_ID: "attachedTemplateId",

  ATTACHED_TOKEN: {

    /** @type {string} */
    ID: "attachedTokenId",

    /** @type { x: {number}, y: {number}, elevation: {number} } */
    // Difference between template and attached token.
    DELTAS: "attachedTokenDelta",

    /** @type {Token} */
    // Used to access item flag in `addDnd5eItemConfigurationToTemplate`.
    SPELL_TEMPLATE: "attachToken",

    /** @type {boolean} */
    ROTATE: "rotateWithAttachedToken"
  },

  REGION: {
    /** @type {"source"|"effective"} */
    ROLE: "regionRole",

    ROLES: {
      SOURCE: "source",
      EFFECTIVE: "effective"
    },

    /** @type {string|null} */
    SOURCE_ID: "sourceRegionId",

    /** @type {string|null} */
    EFFECTIVE_ID: "effectiveRegionId",

    /** @type {object[]|null} */
    EFFECTIVE_SHAPES: "effectiveShapes",

    /** @type {object[]|null} */
    SOURCE_SHAPES: "sourceShapes",

    /** @type {string|null} */
    SOURCE_SHAPE: "sourceShapeType",

    /** @type {string|null} */
    PENDING_ATTACHMENT_TOKEN: "pendingAttachmentTokenId"
  },

  HIDE: {
    /** @type {HIDE.TYPES} */
    BORDER: "hideBorder",

    /** @type {HIDE.TYPES} */
    HIGHLIGHTING: "hideHighlighting",

    TYPES: {
      GLOBAL_DEFAULT: "globalDefault",
      ALWAYS_HIDE: "alwaysHide",
      ALWAYS_SHOW: "alwaysShow"
    },

    TOKEN_HOVER: "tokenHover", // Whether user is currently hovering over a token within this template.

    /** @type {HIDE.TYPES} */
    SHOW_ON_HOVER: "showOnHover" // Template-specific show/hide hover setting.
  },

  SNAPPING: {
    /** @type {boolean} */
    CENTER: "snapCenter",

    /** @type {boolean} */
    CORNER: "snapCorner",

    /** @type {boolean} */
    SIDE_MIDPOINT: "snapSideMidpoint"
  },

  /** @type {boolean} */
  ADD_TOKEN_SIZE: "addTokenSize",

  /** @type {boolean} */
  NO_AUTOTARGET: "noAutotarget",

  /** @type {string} */
  VERSION: "version"
};

export const LABELS = {
  WALLS_BLOCK: {
    unwalled: "walledregions.MeasuredTemplateConfiguration.unwalled",
    walled: "walledregions.MeasuredTemplateConfiguration.walled",
    recurse: "walledregions.MeasuredTemplateConfiguration.recurse",
    "damage-normal": "walledregions.MeasuredTemplateConfiguration.damage-normal",
    "damage-half": "walledregions.MeasuredTemplateConfiguration.damage-half"
  },

  WALL_RESTRICTION: {
    light: "WALL.FIELDS.light.label",
    move: "WALL.FIELDS.move.label",
    sight: "WALL.FIELDS.sight.label",
    sound: "WALL.FIELDS.sound.label",
  },

  TEMPLATE_HIDE: {
    globalDefault: "walledregions.MeasuredTemplateConfiguration.globalDefault",
    alwaysHide: "walledregions.MeasuredTemplateConfiguration.alwaysHide",
    alwaysShow: "walledregions.MeasuredTemplateConfiguration.alwaysShow",
  },

  SPELL_TEMPLATE: {},

  GLOBAL_DEFAULT: "globalDefault",
};

LABELS.SPELL_TEMPLATE.WALLS_BLOCK = foundry.utils.duplicate(LABELS.WALLS_BLOCK);
LABELS.SPELL_TEMPLATE.WALL_RESTRICTION = foundry.utils.duplicate(LABELS.WALL_RESTRICTION);
LABELS.SPELL_TEMPLATE.WALLS_BLOCK.globalDefault = "walledregions.MeasuredTemplateConfiguration.globalDefault";
LABELS.SPELL_TEMPLATE.WALL_RESTRICTION.globalDefault = "walledregions.MeasuredTemplateConfiguration.globalDefault";
LABELS.SPELL_TEMPLATE.ATTACH_TOKEN = {
  na: "walledregions.dnd5e-spell-config.attach-token.na",
  caster: "walledregions.dnd5e-spell-config.attach-token.caster",
  target: "walledregions.dnd5e-spell-config.attach-token.target"
};

export const NOTIFICATIONS = {
  NOTIFY: {
    ATTACH_TOKEN_NOT_SELECTED: "walledregions.notifications.attach-last-selected-token",
    ATTACH_TOKEN_NOT_TARGETED: "walledregions.notifications.attach-last-targeted-token"
  }
};

export const TEMPLATES = {
  DND5E: `${ASSET_ROOT}/templates/dnd5e-spell-template-config-module.html`,
  DND5E_PARTIAL: `${ASSET_ROOT}/templates/dnd5e-spell-template-config-partial.html`,
  CONFIG_MT_MODULE: `${ASSET_ROOT}/templates/measured-template-config-module.html`,
  CONFIG_BASIC: `${ASSET_ROOT}/templates/foundry-template-config.html`,
  CONFIG_MT_MAIN: `${ASSET_ROOT}/templates/measured-template-config-main.html`,
  CONFIG_PARTIAL: `${ASSET_ROOT}/templates/measured-template-config-partial.html`,

};

export const ACTIVE_EFFECT_ICON = `${ASSET_ROOT}/assets/ruler-combined-solid-gray.svg`;

export const SHAPE_KEYS = ["circle", "cone", "ray", "rect"];

export const MODULES = {
  DRAG_RULER: { ACTIVE: false, ID: "drag-ruler" },
  TOKEN_MAGIC: { ACTIVE: false, ID: "tokenmagic" },
  LEVELS: { ACTIVE: false, ID: "levels" },
  WALL_HEIGHT: { ACTIVE: false, ID: "wall-height"}
};

export const ICONS = {
  MEASURED_TEMPLATE: "fa-solid fa-ruler-combined",
  MODULE: "fa-solid fa-object-group",
};

// Hook init b/c game.modules is not initialized at start.
Hooks.once("init", function () {
  MODULES.DRAG_RULER.ACTIVE = game.modules.get(MODULES.DRAG_RULER.ID)?.active;
  MODULES.TOKEN_MAGIC.ACTIVE = game.modules.get(MODULES.TOKEN_MAGIC.ID)?.active;
  MODULES.LEVELS.ACTIVE = game.modules.get(MODULES.LEVELS.ID)?.active;
  MODULES.WALL_HEIGHT.ACTIVE = game.modules.get(MODULES.WALL_HEIGHT.ID)?.active;
});
