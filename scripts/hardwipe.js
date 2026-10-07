import { HeatManager } from "./heat.js";
import { HardwipeRules } from "./hardwipe-rules.js";
import { HardwipeSheet } from "./hardwipe-sheet.js";
import { EdgeManager, StrikesManager, DownedManager } from "./hardwipe-state.js";
import { ShieldManager } from "./hardwipe-shields.js";
import { CyberwareManager } from "./hardwipe-cyberware.js";
import { CoverManager } from "./hardwipe-cover.js";
import { AttackReviewManager } from "./hardwipe-attacks.js";
import { registerCardSettings, registerFallenStamps } from "./hardwipe-attack-cards.js";
import { registerSpellSheetColor } from "./hardwipe-spell-cards.js";
import { registerCardTools } from "./hardwipe-card-tools.js";
import { registerCardColors } from "./hardwipe-card-colors.js";
import { ShortRestManager } from "./hardwipe-rests.js";
import { registerRestReceipts } from "./hardwipe-rest-receipt.js";
import { registerConcentrationCards } from "./hardwipe-concentration.js";
import { registerMessageCards } from "./hardwipe-message-cards.js";

export const MODULE_ID = "hardwipe-ruleset";
export const MODULE_TITLE = "Hardwipe Ruleset";

Hooks.once("init", async () => {
  console.log(`${MODULE_TITLE} | Initializing`);

  game.hardwipe ??= {};
  game.hardwipe.heat = HeatManager.api;
  game.hardwipe.edge = EdgeManager.api;
  game.hardwipe.strikes = StrikesManager.api;
  game.hardwipe.downed = DownedManager.api;
  game.hardwipe.shields = ShieldManager.api;
  game.hardwipe.cyberware = CyberwareManager.api;
  game.hardwipe.cover = CoverManager.api;

  ShieldManager.initialize();

  HeatManager.registerSettings();
  HeatManager.registerControls();
  CyberwareManager.registerCategories();
  CoverManager.registerSettings();
  CoverManager.registerControls();
  AttackReviewManager.registerSettings();
  AttackReviewManager.registerHooks();
  registerCardSettings();
  registerFallenStamps();
  registerSpellSheetColor();
  registerCardTools();
  registerCardColors();
  registerRestReceipts();
  registerConcentrationCards();
  registerMessageCards();

  await foundry.applications.handlebars.loadTemplates([
    "modules/hardwipe-ruleset/templates/heat-hud.hbs",
    "modules/hardwipe-ruleset/templates/heat-config.hbs",
    "modules/hardwipe-ruleset/templates/cyberware-tab.hbs"
  ]);
});

Hooks.once("ready", () => {
  HeatManager.initialize();
  HardwipeRules.initialize();
  CyberwareManager.initialize();
  CoverManager.initialize();
  AttackReviewManager.initialize();
  HardwipeSheet.initialize();
  ShortRestManager.initialize();
  console.log(`${MODULE_TITLE} | Ready`);
});
