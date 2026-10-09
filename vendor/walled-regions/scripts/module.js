import { readDocumentFlag, configureWallModeControls } from "./util.js";
/* Walled Regions, adapted for Hardwipe. See vendor/NOTICE.md and LICENSE. */
import { Settings } from "./settings.js";
import {
  MODULE_ID, HOST_ID, FLAGS, TEMPLATES, bundledRegionsEnabled,
  normalizeWallMode, wallDamageMultiplier
} from "./const.js";
import { initializePatching, registerAutotargeting, PATCHER } from "./patching.js";
import { registerGeometry } from "./geometry/registration.js";
import { measurementControlSet, measurementPlaceables } from "./compatibility.js";
import { computeRegionGeometry, isManagedWalledRegionDocument } from "./Region.js";
import { ClockwiseSweepShape } from "./ClockwiseSweepShape.js";
import { LightWallSweep } from "./ClockwiseSweepLightWall.js";
import { WalledTemplateShape } from "./template_shapes/WalledTemplateShape.js";
import { WalledTemplateCircle } from "./template_shapes/WalledTemplateCircle.js";
import { WalledTemplateRectangle } from "./template_shapes/WalledTemplateRectangle.js";
import { WalledTemplateCone } from "./template_shapes/WalledTemplateCone.js";
import { WalledTemplateRay } from "./template_shapes/WalledTemplateRay.js";
import { WalledTemplateRoundedCone } from "./template_shapes/WalledTemplateRoundedCone.js";
import { WalledTemplateSquare } from "./template_shapes/WalledTemplateSquare.js";
import { WalledTemplateRotatedSquare } from "./template_shapes/WalledTemplateRotatedSquare.js";
import { WalledTemplateRoundedRectangle } from "./template_shapes/WalledTemplateRoundedRectangle.js";

let initialized = false;

Hooks.once("init", () => {
  const standalone = game.modules.get(MODULE_ID)?.active;
  game.hardwipe ??= {};
  game.hardwipe.regions = {
    bundled: bundledRegionsEnabled(),
    standalone,
    available: bundledRegionsEnabled() || standalone,
    computeRegionGeometry,
    normalizeWallMode,
    wallDamageMultiplier,
    isManagedWalledRegionDocument,
    ClockwiseSweepShape, LightWallSweep,
    WalledTemplateShape, WalledTemplateCircle, WalledTemplateRectangle,
    WalledTemplateCone, WalledTemplateRay, WalledTemplateRoundedCone,
    WalledTemplateSquare, WalledTemplateRotatedSquare, WalledTemplateRoundedRectangle,
    PATCHER, Settings
  };
  if (!bundledRegionsEnabled()) return;
  registerGeometry();
  CONFIG[MODULE_ID] ??= {
    debug: false,
    recursions: { circle: 4, rect: 4, ray: 8, cone: 4 },
    cornerSpacer: 10,
    autotargetStatusesToIgnore: new Set(["dead"]),
    ClipperPaths: CONFIG.GeometryLib.ClipperPaths
  };
  const registry = WalledTemplateShape.shapeCodeRegister;
  for (const [type, cls] of Object.entries({
    circle: WalledTemplateCircle, rect: WalledTemplateRectangle, rectangle: WalledTemplateRectangle,
    cone: WalledTemplateCone, ray: WalledTemplateRay, line: WalledTemplateRay
  })) registry.set(type, cls);
  if (game.system.id === "swade") registry.set("cone", WalledTemplateRoundedCone);
  initializePatching();
  initialized = true;
  Hooks.callAll(`${HOST_ID}.regionsReady`, game.hardwipe.regions);
});

Hooks.once("setup", () => {
  if (!initialized) return;
  Settings.registerAll();
  Settings.toggleAutotarget();
  Settings.registerKeybindings();
  void foundry.applications.handlebars.loadTemplates(Object.values(TEMPLATES));
});

Hooks.once("ready", () => {
  if (!initialized) {
    if (game.user.isGM) {
      const message = game.modules.get(MODULE_ID)?.active
        ? "Hardwipe is using the enabled Walled Regions module. Its existing wall controls include Hardwipe's normal and half wall damage choices. Disable standalone Walled Regions to use Hardwipe's bundled implementation."
        : "Hardwipe Wall Effects is paused because Walled Templates is enabled. Disable Walled Templates to use Hardwipe's bundled Walled Regions and wall damage controls.";
      ui.notifications.warn(message, { permanent: false });
    }
    return;
  }
  registerAutotargeting();
  if (game.user.isActiveGM) refreshManagedRegions();
});

Hooks.on("canvasReady", () => {
  if (!initialized || !game.user.isActiveGM) return;
  refreshManagedRegions();
});

function refreshManagedRegions() {
  for (const region of measurementPlaceables()) {
    if (region.usesWalledRegionBehavior) {
      void region.syncEffectiveRegionData?.().catch(error => console.error(`${HOST_ID} | Wall Effects region refresh failed`, error));
    }
  }
}

Hooks.on("getSceneControlButtons", controls => {
  if (!initialized) return;
  const control = measurementControlSet(controls);
  if (!control?.tools?.clear) return;
  const key = Settings.KEYS.AUTOTARGET;
  const order = control.tools.clear.order;
  Object.values(control.tools).forEach(tool => { if (tool.order >= order) tool.order += 1; });
  control.tools.hardwipeRegionAutotarget = {
    icon: "fas fa-crosshairs", name: "hardwipeRegionAutotarget", order,
    title: game.i18n.localize("walledregions.controls.autotarget.Title"), toggle: true,
    visible: Settings.get(key.MENU) === key.CHOICES.TOGGLE,
    active: Settings.get(key.ENABLED),
    onClick: async () => {
      await Settings.toggle(key.ENABLED);
      for (const region of measurementPlaceables()) region.autotargetTokens?.();
    }
  };
});

// A standalone Walled Regions installation remains the sole geometry owner.
// Add only the two host-specific form choices; existing form submission persists them.
function extendStandaloneWallControls(app, element) {
  if (!game.modules.get(MODULE_ID)?.active) return;
  const root = element?.[0] ?? element;
  if (!root?.querySelectorAll) return;
  for (const select of root.querySelectorAll(`select[name="flags.${MODULE_ID}.${FLAGS.WALLS_BLOCK}"]`)) {
    for (const value of ["damage-normal", "damage-half"]) {
      if ([...select.options].some(option => option.value === value)) continue;
      const option = select.ownerDocument.createElement("option");
      option.value = value;
      option.textContent = game.i18n.localize(`walledregions.MeasuredTemplateConfiguration.${value}`);
      select.appendChild(option);
    }
    const saved = readDocumentFlag(app.item ?? app.document, MODULE_ID, FLAGS.WALLS_BLOCK);
    if (saved) select.value = saved;
  }
}
Hooks.on("renderItemSheet5e", extendStandaloneWallControls);
Hooks.on("renderRegionConfig", extendStandaloneWallControls);
Hooks.on("renderItemSheet5e", (_app, element) => configureWallModeControls(element));
Hooks.on("renderApplicationV2", (_app, element) => configureWallModeControls(element));
