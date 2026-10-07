import { MODULE_ID, canControlActor, resolveActor } from "./hardwipe-state.js";

const FLAG = "cyberware";
const SERVICE_FLAG = "cyberwareServices";
const FLAG_PATH = `flags.${MODULE_ID}.${FLAG}`;
const REST_TYPES = new Set(["short", "long"]);

export const CYBERWARE_SLOTS = Object.freeze([
  ["brain", "Brain", false],
  ["spine", "Spine", false],
  ["torso", "Torso", false],
  ["arms", "Arms", false],
  ["hands", "Hands", true],
  ["legs", "Legs", true],
  ["eyes", "Eyes", true],
  ["nervous", "Nervous System", false],
  ["audio", "Audio", false],
  ["dermal", "Dermal", false]
].map(([id, label, selfSwap]) => Object.freeze({
  id, label, selfSwap, type: `hardwipe-${id}`
})));

const SLOT_BY_TYPE = new Map(CYBERWARE_SLOTS.map(slot => [slot.type, slot]));

/** Body regions on the default paper doll (1024 × 1536), shared by the Cyberware tab and implant cards. */
export const BODY_REGION_PATHS = {
  brain: "M470 72Q512 45 554 72L558 121Q512 97 466 121Z",
  eyes: "M469 142Q512 129 555 142L551 159Q512 145 473 159Z",
  audio: "M448 131L458 139V174L449 166Z",
  nervous: "M512 226V675M512 320L369 353L270 512L199 682M512 320L655 353L754 512L825 682M512 650L413 804L393 1292M512 650L611 804L631 1292",
  spine: "M507 228H517V638H507Z",
  torso: "M380 324Q512 294 644 324L618 475L589 592Q512 613 435 592L406 475Z",
  dermal: "M348 318L376 430L401 536L400 678M676 318L648 430L623 536L624 678M383 725L376 842L391 975M641 725L648 842L633 975",
  arms: "M348 315Q318 359 304 405L268 491L222 567L194 674L230 686L269 595L307 528L337 438L373 363Z",
  hands: "M179 677L220 690L226 735L207 779L194 758L170 792L174 749L151 778L156 736L133 719L156 704Z",
  legs: "M405 705L472 714L468 845L431 968H367L365 837ZM369 982H429L438 1065L405 1298L378 1324L367 1285L359 1070Z"
};
export const MIRRORED_BODY_REGIONS = new Set(["audio", "arms", "hands", "legs"]);
/** Where a slot card's callout line meets the doll, per region ([x, y]; mirrored regions are mirrored for right-hand cards). */
export const BODY_REGION_ANCHORS = Object.freeze({
  brain: [512, 96], eyes: [512, 142], audio: [453, 152], nervous: [512, 322], spine: [512, 540],
  torso: [452, 420], dermal: [362, 430], arms: [287, 450], hands: [180, 735], legs: [430, 900]
});
/** Regions too small to see at sheet or chat size get a ping ring: [cx, cy, r] per ring. */
export const BODY_REGION_PINGS = Object.freeze({
  brain: [[512, 96, 72]],
  eyes: [[512, 134, 50]],
  audio: [[453, 152, 38], [571, 152, 38]]
});

/** State belongs to the inventory Item. Pending changes do not change current operation. */
export function deriveCyberwareState(flags = {}) {
  const installed = flags.installed === true;
  const disabled = flags.disabled === true;
  const damaged = flags.damaged === true;
  const pending = ["install", "remove"].includes(flags.pending) ? flags.pending : null;
  return {
    installed, disabled, damaged, pending,
    enabled: installed && !disabled && !damaged,
    state: !installed ? "carried" : damaged ? "damaged" : disabled ? "disabled" : "installed"
  };
}

function text(key, fallback) {
  const fullKey = `HARDWIPE.Cyberware.${key}`;
  const translated = game.i18n.localize(fullKey);
  return translated === fullKey ? fallback : translated;
}

function notify(key, fallback, level = "warn") {
  ui.notifications[level](text(key, fallback));
}

function changedValue(update, path) {
  if (Object.hasOwn(update ?? {}, path)) return update[path];
  return foundry.utils.getProperty(update ?? {}, path);
}

function setChanged(update, path, value) {
  delete update[path];
  foundry.utils.setProperty(update, path, value);
}

export class CyberwareManager {
  static _initialized = false;
  static _wrappersRegistered = false;

  static get api() {
    return {
      slots: CYBERWARE_SLOTS,
      getContext: actor => this.getContext(actor),
      isCyberware: item => this.isCyberware(item),
      getState: item => this.getState(item),
      isOperational: item => this.isOperational(item),
      queueInstall: item => this.queueInstall(item),
      queueRemove: item => this.queueRemove(item),
      cancelQueued: item => this.cancelQueued(item),
      setEnabled: (item, enabled) => this.setEnabled(item, enabled),
      reset: item => this.reset(item),
      repair: item => this.repair(item),
      setServices: (actor, services) => this.setServices(actor, services)
    };
  }

  static registerCategories() {
    const config = CONFIG.DND5E;
    if (!config?.miscEquipmentTypes || !config?.equipmentTypes) return;
    for (const slot of CYBERWARE_SLOTS) {
      const label = text(`Category.${slot.id}`, `Cyberware: ${slot.label}`);
      config.miscEquipmentTypes[slot.type] = label;
      config.equipmentTypes[slot.type] = label;
    }
  }

  static initialize() {
    if (this._initialized) return;
    this._initialized = true;
    this.registerCategories();
    this._registerWrappers();
    Hooks.on("preCreateItem", (item, data) => this._onPreCreateItem(item, data));
    Hooks.on("preUpdateItem", (item, changed, options) => this._onPreUpdateItem(item, changed, options));
    Hooks.on("dnd5e.preUseActivity", activity => this._onPreUseActivity(activity));
    Hooks.on("dnd5e.preRestCompleted", (actor, result, config) => this._onPreRestCompleted(actor, result, config));
    Hooks.on("updateItem", item => {
      if (this.isCyberware(item)) item.actor?.reset();
    });
    // Wrappers are installed at ready; recompute local derived data without any document writes.
    const actors = new Set(game.actors?.contents ?? []);
    for (const token of canvas.tokens?.placeables ?? []) if (token.actor) actors.add(token.actor);
    for (const actor of actors) {
      if (actor.items?.some(item => this.isCyberware(item))) actor.reset();
    }
  }

  static _registerWrappers() {
    if (this._wrappersRegistered) return;
    if (!globalThis.libWrapper?.register) {
      notify("Warnings.Dependency", "Cyberware effect gating requires the libWrapper module.", "error");
      return;
    }
    globalThis.libWrapper.register(MODULE_ID, "CONFIG.Item.documentClass.prototype.areEffectsSuppressed", function(wrapped) {
      const suppressed = wrapped();
      return suppressed || (CyberwareManager.isCyberware(this) && !CyberwareManager.isOperational(this));
    }, "WRAPPER");
    globalThis.libWrapper.register(MODULE_ID, "CONFIG.ActiveEffect.documentClass.prototype.isSuppressed", function(wrapped) {
      const suppressed = wrapped();
      const item = this.parent?.documentName === "Item" ? this.parent : null;
      return suppressed || (CyberwareManager.isCyberware(item) && !CyberwareManager.isOperational(item));
    }, "WRAPPER");
    globalThis.libWrapper.register(MODULE_ID, "CONFIG.Item.dataModels.equipment.prototype.prepareBaseData", function(wrapped, ...args) {
      const result = wrapped(...args);
      if (CyberwareManager.isCyberware(this.parent)) {
        this.equipped = CyberwareManager.getState(this.parent).installed;
        this.attunement = "";
        this.attuned = false;
      }
      return result;
    }, "WRAPPER");
    globalThis.libWrapper.register(MODULE_ID, "CONFIG.Item.dataModels.equipment.prototype.prepareFinalEquippableData", function(wrapped, ...args) {
      // Imported attunement or an effect must not add a cyberware package to the magic-item count.
      if (CyberwareManager.isCyberware(this.parent)) {
        this.attunement = "";
        this.attuned = false;
      }
      return wrapped(...args);
    }, "WRAPPER");
    this._wrappersRegistered = true;
  }

  static isCyberware(item) {
    return item?.type === "equipment" && SLOT_BY_TYPE.has(item.system?.type?.value);
  }

  static getState(item) {
    return deriveCyberwareState(item?.getFlag?.(MODULE_ID, FLAG) ?? {});
  }

  static isOperational(item) {
    return this.isCyberware(item) && this.getState(item).enabled;
  }

  static getServices(actor) {
    const flags = resolveActor(actor)?.getFlag(MODULE_ID, SERVICE_FLAG) ?? {};
    return { ripperDoc: flags.ripperDoc === true, tools: flags.tools === true };
  }

  static getContext(actor) {
    const target = resolveActor(actor);
    const canControl = !!target && canControlActor(target);
    const service = this.getServices(target);
    const canService = canControl && (game.user.isGM || service.ripperDoc || service.tools);
    const items = (target?.items?.contents ?? []).filter(item => this.isCyberware(item)).map(item => {
      const state = this.getState(item);
      const max = Number(item.system?.uses?.max);
      const value = Number(item.system?.uses?.value ?? Math.max(0, max - Number(item.system?.uses?.spent ?? 0)));
      return {
        id: item.id, name: item.name, img: item.img,
        ...state, queued: state.pending, canControl,
        canInstall: canControl && !state.installed && state.pending !== "install",
        canRemove: canControl && state.installed && state.pending !== "remove",
        canReset: canService && state.disabled,
        canRepair: canService && state.damaged,
        usesLabel: Number.isFinite(max) && max > 0 && Number.isFinite(value) ? `${value}/${max}` : "",
        usesPips: Number.isFinite(max) && max > 0 && max <= 8 && Number.isFinite(value)
          ? Array.from({ length: max }, (_, index) => ({ on: index < value })) : null
      };
    });
    const slots = CYBERWARE_SLOTS.map(slot => {
      const views = items.filter(view => target.items.get(view.id).system.type.value === slot.type);
      return {
        ...slot, label: text(`Slot.${slot.id}`, slot.label), items: views,
        installedItem: views.find(view => view.installed) ?? null,
        occupied: views.some(view => view.installed)
      };
    });
    return { slots, items, canControl, isGM: !!game.user.isGM, service, pendingCount: items.filter(item => item.queued).length };
  }

  static _ownedItem(item) {
    if (!this.isCyberware(item) || !item.actor || !canControlActor(item.actor)) {
      notify("Warnings.Owner", "Select a cyberware item on an actor you control.");
      return false;
    }
    return true;
  }

  static _itemUpdates(item, patch) {
    const update = { _id: item.id, [`${FLAG_PATH}.version`]: 1 };
    for (const [key, value] of Object.entries(patch)) update[`${FLAG_PATH}.${key}`] = value;
    return update;
  }

  static _slotItems(item) {
    return item.actor.items.filter(other => this.isCyberware(other) && other.system.type.value === item.system.type.value);
  }

  static async queueInstall(item) {
    if (!this._ownedItem(item)) return false;
    if (this.getState(item).installed) return this.cancelQueued(item);
    const updates = this._slotItems(item).flatMap(other => {
      const state = this.getState(other);
      const pending = other.id === item.id ? "install" : state.installed ? "remove" : null;
      return state.pending === pending ? [] : [this._itemUpdates(other, { pending })];
    });
    if (updates.length) await item.actor.updateEmbeddedDocuments("Item", updates);
    return true;
  }

  static async queueRemove(item) {
    if (!this._ownedItem(item)) return false;
    if (!this.getState(item).installed) return this.cancelQueued(item);
    await item.update(this._itemUpdates(item, { pending: "remove" }));
    return true;
  }

  static async cancelQueued(item) {
    if (!this._ownedItem(item)) return false;
    // A replacement is one slot plan: cancelling either side preserves the current package.
    const updates = this._slotItems(item).filter(other => this.getState(other).pending)
      .map(other => this._itemUpdates(other, { pending: null }));
    if (updates.length) await item.actor.updateEmbeddedDocuments("Item", updates);
    return true;
  }

  static async setEnabled(item, enabled) {
    if (!this._ownedItem(item)) return false;
    if (typeof enabled !== "boolean") return false;
    const state = this.getState(item);
    if (!state.installed) {
      notify("Warnings.NotInstalled", "Queue installation in the Cyberware tab before enabling this implant.");
      return false;
    }
    if (enabled && state.damaged) {
      notify("Warnings.Damaged", "Repair this damaged implant before enabling it.");
      return false;
    }
    await item.update(this._itemUpdates(item, { disabled: !enabled }));
    return true;
  }

  static _canService(actor) {
    const service = this.getServices(actor);
    if (game.user.isGM || service.tools || service.ripperDoc) return true;
    notify("Warnings.Service", "Resetting or repairing cyberware requires service tools or a ripper doc.");
    return false;
  }

  static async reset(item) {
    if (!this._ownedItem(item) || !this._canService(item.actor)) return false;
    await item.update(this._itemUpdates(item, { disabled: false }));
    return true;
  }

  static async repair(item) {
    if (!this._ownedItem(item) || !this._canService(item.actor)) return false;
    await item.update(this._itemUpdates(item, { damaged: false }));
    return true;
  }

  static async setServices(actor, { ripperDoc, tools } = {}) {
    const target = resolveActor(actor);
    if (!target || !game.user.isGM) {
      notify("Warnings.GMService", "Only the GM can set cyberware service availability.");
      return false;
    }
    const update = {};
    if (typeof ripperDoc === "boolean") update[`flags.${MODULE_ID}.${SERVICE_FLAG}.ripperDoc`] = ripperDoc;
    if (typeof tools === "boolean") update[`flags.${MODULE_ID}.${SERVICE_FLAG}.tools`] = tools;
    if (Object.keys(update).length) await target.update(update);
    return true;
  }

  static _onPreCreateItem(item) {
    if (!this.isCyberware(item)) return;
    // New/imported inventory copies begin carried; importing an installed package does not install it.
    const current = item.getFlag(MODULE_ID, FLAG) ?? {};
    item.updateSource({
      "system.equipped": false,
      "system.attunement": "",
      "system.attuned": false,
      [FLAG_PATH]: { ...current, version: 1, installed: false, disabled: current.disabled === true, damaged: current.damaged === true, pending: null }
    });
  }

  static _onPreUpdateItem(item, changed, options = {}) {
    const type = changedValue(changed, "system.type.value") ?? item.system?.type?.value;
    const nextCyberware = item.type === "equipment" && SLOT_BY_TYPE.has(type);
    const wasCyberware = this.isCyberware(item);
    if (!wasCyberware && !nextCyberware) return true;
    const state = this.getState(item);
    if (wasCyberware && type !== item.system.type.value && (state.installed || state.pending)) {
      notify("Warnings.TypeInstalled", "Remove this implant and clear its queued swap before changing its equipment category.");
      return false;
    }
    if (!wasCyberware && nextCyberware) {
      // Changing an ordinary item's inventory category makes it carried cyberware, not installed cyberware.
      setChanged(changed, "system.equipped", false);
      setChanged(changed, `${FLAG_PATH}.version`, 1);
      setChanged(changed, `${FLAG_PATH}.installed`, false);
      setChanged(changed, `${FLAG_PATH}.pending`, null);
      setChanged(changed, "system.attunement", "");
      setChanged(changed, "system.attuned", false);
      return true;
    }
    if (!nextCyberware) return true;
    setChanged(changed, "system.attunement", "");
    setChanged(changed, "system.attuned", false);
    const equipped = changedValue(changed, "system.equipped");
    const installed = changedValue(changed, `${FLAG_PATH}.installed`);
    if (equipped === undefined && installed === undefined) return true;
    const nextInstalled = installed ?? state.installed;
    const matchesPending = (state.pending === "install" && nextInstalled === true)
      || (state.pending === "remove" && nextInstalled === false);
    const restCommit = options.isRest === true && matchesPending && installed !== undefined;
    if (!restCommit && (nextInstalled !== state.installed || (equipped !== undefined && equipped !== state.installed))) {
      notify("Warnings.QueueRequired", "Queue installation or removal in the Cyberware tab, then complete a qualifying rest.");
      return false;
    }
    if (equipped !== undefined && equipped !== nextInstalled) return false;
    return true;
  }

  static _onPreUseActivity(activity) {
    const item = activity?.item;
    if (!this.isCyberware(item) || this.isOperational(item)) return true;
    notify("Warnings.Unavailable", "This cyberware must be installed, enabled, and repaired before it can be used.");
    return false;
  }

  /**
   * What completing a rest would do with each queued implant, for the rest dialog's preview: install or
   * remove it, or leave it queued ("service": no ripper doc for that slot; "conflict": two packages would end
   * up installed). The same checks as _onPreRestCompleted.
   */
  static restOutcome(actor) {
    const service = this.getServices(actor);
    const outcome = [];
    for (const slot of CYBERWARE_SLOTS) {
      const items = actor.items.filter(item => this.isCyberware(item) && item.system.type.value === slot.type);
      const pending = items.filter(item => this.getState(item).pending);
      if (!pending.length) continue;
      const finalInstalled = item => {
        const state = this.getState(item);
        return state.pending === "install" ? true : state.pending === "remove" ? false : state.installed;
      };
      const blocked = !slot.selfSwap && !service.ripperDoc ? "service" : items.filter(finalInstalled).length > 1 ? "conflict" : null;
      for (const item of pending) outcome.push({ item, pending: this.getState(item).pending, blocked });
    }
    return outcome;
  }

  static _onPreRestCompleted(actor, result, config) {
    if (!REST_TYPES.has(config?.type) || !canControlActor(actor)) return true;
    const service = this.getServices(actor);
    const existingUpdates = result.updateItems ??= [];
    const deletedIds = new Set(result.deleteItems ?? []);
    let skippedService = false;
    let skippedConflict = false;
    for (const slot of CYBERWARE_SLOTS) {
      const items = actor.items.filter(item => this.isCyberware(item) && item.system.type.value === slot.type && !deletedIds.has(item.id));
      if (!items.some(item => this.getState(item).pending)) continue;
      if (!slot.selfSwap && !service.ripperDoc) {
        skippedService = true;
        continue;
      }
      // Validate the final slot as a whole, including item updates already requested by the rest.
      const finalInstalled = item => {
        const state = this.getState(item);
        const priorUpdate = existingUpdates.find(update => update._id === item.id);
        const priorInstalled = changedValue(priorUpdate, `${FLAG_PATH}.installed`);
        return state.pending === "install" ? true : state.pending === "remove" ? false : (priorInstalled ?? state.installed);
      };
      if (items.filter(finalInstalled).length > 1) {
        skippedConflict = true;
        continue;
      }
      for (const item of items) {
        const state = this.getState(item);
        if (!state.pending) continue;
        const installed = state.pending === "install";
        const patch = this._itemUpdates(item, { installed, pending: null });
        patch["system.equipped"] = installed;
        const index = existingUpdates.findIndex(update => update._id === item.id);
        if (index >= 0) {
          existingUpdates[index] = foundry.utils.mergeObject(
            foundry.utils.expandObject(existingUpdates[index]), foundry.utils.expandObject(patch), { inplace: false }
          );
        } else existingUpdates.push(patch);
      }
    }
    if (skippedService) notify("Warnings.RestService", "Your rest completes normally. Cyberware swaps requiring a ripper doc remain queued.");
    if (skippedConflict) notify("Warnings.RestConflict", "Your rest completes normally. A conflicting cyberware slot remains queued; select one package for that slot.");
    return true;
  }
}
