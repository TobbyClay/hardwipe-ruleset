/* globals
game,
renderTemplate,
*/
"use strict";

import { MODULE_ID, MODULE_KEY, LABELS, TEMPLATES } from "./const.js";
import { configureWallModeControls } from "./util.js";

export const PATCHES = {};
PATCHES.BASIC = {};

/**
 * Hook the Region config render and append a minimal Walled Regions section.
 * For now, only surface the wall-related settings that have a clear Region-side meaning.
 * Attachment, snapping, and template-display controls remain MeasuredTemplate-only until
 * the Region placeable plumbing exists.
 * @param {ApplicationV2} app
 * @param {HTMLElement} element
 */
async function renderRegionConfig(app, element, _context, _options) {
  const form = element.matches?.("form") ? element : element.querySelector("form");
  if ( !form || form.querySelector("[data-walledregions-region-config]") ) return;

  const html = await foundry.applications.handlebars.renderTemplate(TEMPLATES.CONFIG_PARTIAL, {
    document: app.document,
    walledregions: {
      flagPath: `flags.${MODULE_ID}`,
      flags: app.document.flags?.[MODULE_ID] ?? {},
      damageWalls: ["damage-normal", "damage-half"].includes(app.document.flags?.[MODULE_ID]?.wallsBlock),
      blockoptions: LABELS.WALLS_BLOCK,
      walloptions: LABELS.WALL_RESTRICTION,
      hideoptions: LABELS.TEMPLATE_HIDE,
      supportsDisplaySettings: false,
      supportsTokens: false,
      supportsSnapping: false
    }
  });

  const section = document.createElement("section");
  section.dataset.walledregionsRegionConfig = "true";
  section.className = "standard-form";
  section.innerHTML = `
    <fieldset>
      <legend>${game.i18n.localize(`${MODULE_KEY}.MeasuredTemplateConfiguration.LegendTitle`)}</legend>
      ${html}
    </fieldset>
  `;

  const footer = form.querySelector("footer");
  if ( footer ) footer.before(section);
  else form.appendChild(section);
  configureWallModeControls(section);
}

PATCHES.BASIC.HOOKS = { renderRegionConfig };
