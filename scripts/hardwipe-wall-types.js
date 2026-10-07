const MODULE_ID = "hardwipe-ruleset";
const SETTING = "wallTypes";
const DEFAULT_TYPES = Object.freeze([
  { id: "glass", name: "Glass", material: "glass", ac: 10, max: 10, hp: 10, armor: 0, damageThreshold: 0 },
  { id: "light", name: "Light partition", material: "light", ac: 10, max: 20, hp: 20, armor: 2, damageThreshold: 3 },
  { id: "concrete", name: "Concrete", material: "concrete", ac: 10, max: 40, hp: 40, armor: 5, damageThreshold: 10 },
  { id: "reinforced", name: "Reinforced wall", material: "reinforced", ac: 10, max: 80, hp: 80, armor: 10, damageThreshold: 15 }
].map(Object.freeze));

function number(value, label, { minimum = 0, fallback } = {}) {
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`${label} is required.`);
  }
  if (!((typeof value === "number") || ((typeof value === "string") && value.trim()))) {
    throw new Error(`${label} must be a finite number.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) throw new Error(`${label} must be ${minimum} or higher.`);
  return parsed;
}

function text(value, label, maximum = 80) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    throw new Error(`${label} must contain 1 to ${maximum} characters.`);
  }
  return value.trim();
}

/** A single impact: threshold checks the original roll, then armor reduces damage. */
export function evaluateWallDamage(damage, material = {}) {
  const rolled = number(damage, "Damage roll");
  const armor = number(material.armor, "Armor", { fallback: 0 });
  const damageThreshold = number(material.damageThreshold, "Damage threshold", { fallback: 0 });
  const belowThreshold = rolled < damageThreshold;
  return { rolled, armor, damageThreshold, belowThreshold, applied: belowThreshold ? 0 : Math.max(0, rolled - armor) };
}

/** World presets only. Placed walls retain their own durability snapshots. */
export class WallTypes {
  static _registered = false;
  static _configClass;
  static _instance;
  static _writes = Promise.resolve();
  static _socket;

  static initialize() {
    this._registerSocket();
    Hooks.on("socketlib.ready", () => this._registerSocket());
  }

  static _registerSocket() {
    if (this._socket || !globalThis.socketlib) return;
    this._socket = socketlib.registerModule(MODULE_ID);
    this._socket.register("saveWallType", function(payload) { return WallTypes._receive("save", payload, this.socketdata?.userId); });
    this._socket.register("deleteWallType", function(payload) { return WallTypes._receive("delete", payload, this.socketdata?.userId); });
  }

  static registerSettings() {
    if (this._registered) return;
    this._configClass = buildWallTypesConfig();
    game.settings.register(MODULE_ID, SETTING, {
      name: "Wall types", scope: "world", config: false, type: Object,
      default: { version: 1, revision: 0, types: DEFAULT_TYPES.map(type => ({ ...type })) },
      onChange: () => Hooks.callAll("hardwipe.wallTypesChanged", this.materials)
    });
    game.settings.registerMenu(MODULE_ID, SETTING, {
      name: "Wall types", label: "Manage wall types", icon: "fas fa-cubes",
      hint: "Create and edit wall durability presets. Changes apply when configuring walls; existing walls keep their values.",
      type: this._configClass, restricted: true
    });
    this._registered = true;
  }

  static validate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("A wall type must be an object.");
    const id = text(input.id, "Wall type ID", 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id)) throw new Error("Invalid wall type ID.");
    const max = number(input.max, "Maximum HP", { minimum: Number.EPSILON });
    const hp = number(input.hp, "Starting HP", { minimum: Number.EPSILON, fallback: max });
    if (hp > max) throw new Error("Starting HP cannot exceed maximum HP.");
    return {
      id, name: text(input.name, "Name"), material: text(input.material ?? "concrete", "Material"),
      ac: number(input.ac, "Armor Class", { fallback: 10 }), max, hp,
      armor: number(input.armor, "Armor", { fallback: 0 }),
      damageThreshold: number(input.damageThreshold, "Damage threshold", { fallback: 0 })
    };
  }

  static _read() {
    const value = game.settings.get(MODULE_ID, SETTING);
    if (value?.version !== 1 || !Array.isArray(value.types)) throw new Error("The saved wall type settings are invalid; no settings were changed.");
    const types = value.types.map(type => this.validate(type));
    if (new Set(types.map(type => type.id)).size !== types.length) throw new Error("The saved wall types contain duplicate IDs.");
    return { version: 1, revision: number(value.revision, "Wall type revision", { fallback: 0 }), types };
  }

  static get materials() { return Object.fromEntries(this._read().types.map(type => [type.id, { ...type }])); }
  static get(id) {
    const materials = this.materials;
    return Object.hasOwn(materials, id) ? materials[id] : undefined;
  }

  static _requireGM() {
    if (!game.user?.isGM) throw new Error("Only a GM can manage wall types.");
  }

  static manage() {
    this._requireGM();
    if (!this._registered) throw new Error("Wall type settings have not been registered.");
    if (!this._instance) this._instance = new this._configClass();
    if (this._instance.rendered) { this._instance.bringToFront(); return this._instance; }
    this._instance.render({ force: true });
    return this._instance;
  }

  static _enqueue(task) {
    const result = this._writes.then(task, task);
    this._writes = result.catch(() => {});
    return result;
  }

  static _checkExpected(current, expected) {
    if (expected === undefined) return;
    if (JSON.stringify(current ?? null) !== JSON.stringify(expected)) {
      throw new Error("This wall type changed in another window. Reopen this menu before saving so those changes are preserved.");
    }
  }

  static async save(input, { expected } = {}) {
    this._requireGM();
    const type = this.validate(input);
    return this._request("saveWallType", { type, expected });
  }

  static async delete(id, { expected } = {}) {
    this._requireGM();
    return this._request("deleteWallType", { id, expected });
  }

  static async _request(action, payload) {
    const gm = game.users.activeGM;
    if (!gm) throw new Error("Wall type changes require a connected GM.");
    if (game.user.id === gm.id) return this._receive(action === "saveWallType" ? "save" : "delete", payload, game.user.id);
    if (!this._socket) throw new Error("Wall type changes require socketlib.");
    return this._socket.executeAsUser(action, gm.id, payload);
  }

  static _receive(action, payload, senderId) {
    this._requireGM();
    if (game.user.id !== game.users.activeGM?.id || !game.users.get(senderId)?.isGM)
      throw new Error("Only a GM can manage wall types through the active GM.");
    if (action === "delete") return this._deleteLocal(payload.id, payload.expected);
    return this._saveLocal(this.validate(payload.type), payload.expected);
  }

  static _saveLocal(type, expected) {
    return this._enqueue(async () => {
      this._requireGM();
      const state = this._read();
      const index = state.types.findIndex(entry => entry.id === type.id);
      this._checkExpected(state.types[index], expected);
      if (index === -1) state.types.push(type);
      else state.types[index] = type;
      state.revision++;
      await game.settings.set(MODULE_ID, SETTING, state);
      return { ...type };
    });
  }

  static _deleteLocal(id, expected) {
    return this._enqueue(async () => {
      this._requireGM();
      const state = this._read();
      const current = state.types.find(type => type.id === id);
      this._checkExpected(current, expected);
      if (!current) return false;
      state.types = state.types.filter(type => type.id !== id);
      state.revision++;
      await game.settings.set(MODULE_ID, SETTING, state);
      return true;
    });
  }
}

function buildWallTypesConfig() {
  const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
  return class WallTypesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "hardwipe-wall-types", tag: "form", classes: ["hardwipe-wall-types"],
      window: { title: "Manage wall types", icon: "fas fa-cubes", resizable: false, contentClasses: ["standard-form"] },
      position: { width: 460, height: "auto" },
      form: { handler: WallTypesConfig.prototype._onSubmit, closeOnSubmit: false },
      actions: {
        create: WallTypesConfig.prototype._onCreate,
        duplicate: WallTypesConfig.prototype._onDuplicate,
        remove: WallTypesConfig.prototype._onRemove
      }
    };

    static PARTS = { content: { template: "modules/hardwipe-ruleset/templates/wall-types.hbs" } };
    _selectedId = null;
    _loaded = null;
    _draft = null;
    _busy = false;

    async _prepareContext() {
      WallTypes._requireGM();
      const types = Object.values(WallTypes.materials);
      const selected = this._draft ?? types.find(type => type.id === this._selectedId) ?? types[0];
      this._selectedId = selected?.id ?? null;
      this._loaded = this._draft ? null : (selected ? { ...selected } : null);
      if (this._draft) types.push(this._draft);
      return {
        rootId: this.id,
        types: types.map(type => ({ ...type, selected: type.id === this._selectedId })),
        type: selected, hasType: Boolean(selected), isNew: Boolean(this._draft), canDelete: Boolean(selected && !this._draft)
      };
    }

    _onRender(context, options) {
      super._onRender(context, options);
      this.element.querySelector("[name='selectedType']")?.addEventListener("change", event => {
        this._select(event.target.value).catch(error => ui.notifications.error(error.message));
      });
      if (this._draft) this.element.querySelector("[name='name']")?.focus();
    }

    _formInput() {
      const field = name => this.element.querySelector(`[name='${name}']`)?.value;
      return { id: this._selectedId, name: field("name"), material: field("material"), ac: field("ac"),
        max: field("max"), hp: field("hp"), armor: field("armor"), damageThreshold: field("damageThreshold") };
    }

    async _confirmLeave() {
      if (!this._selectedId || !this.element.querySelector("[name='name']")) return true;
      let current;
      try { current = WallTypes.validate(this._formInput()); } catch { current = null; }
      if (!this._draft && JSON.stringify(current) === JSON.stringify(this._loaded)) return true;
      return DialogV2.confirm({ window: { title: "Unsaved wall type" }, content: "<p>Discard the unsaved changes to this wall type?</p>", rejectClose: false });
    }

    async _select(id) {
      if (this._busy || id === this._selectedId) return;
      if (!await this._confirmLeave()) {
        this.element.querySelector("[name='selectedType']").value = this._selectedId;
        return;
      }
      this._draft = null;
      this._selectedId = id;
      await this.render({ force: true });
    }

    async _run(task) {
      if (this._busy) return;
      this._busy = true;
      try { WallTypes._requireGM(); await task(); }
      catch (error) { ui.notifications.error(error.message); }
      finally { this._busy = false; }
    }

    async _onCreate() {
      return this._run(async () => {
        if (!await this._confirmLeave()) return;
        this._draft = { ...DEFAULT_TYPES[2], id: foundry.utils.randomID(), name: "New wall type" };
        this._selectedId = this._draft.id;
        await this.render({ force: true });
      });
    }

    async _onDuplicate() {
      return this._run(async () => {
        const original = WallTypes.validate(this._formInput());
        this._draft = { ...original, id: foundry.utils.randomID(), name: `${original.name.slice(0, 75)} copy` };
        this._selectedId = this._draft.id;
        await this.render({ force: true });
      });
    }

    async _onRemove() {
      return this._run(async () => {
        if (!this._loaded) return;
        const accepted = await DialogV2.confirm({ window: { title: "Delete wall type" },
          content: "<p>Delete this preset? Walls already placed in scenes will keep their current values.</p>", rejectClose: false });
        if (!accepted) return;
        await WallTypes.delete(this._selectedId, { expected: this._loaded });
        this._selectedId = null;
        this._draft = null;
        await this.render({ force: true });
      });
    }

    async _onSubmit() {
      return this._run(async () => {
        const saved = await WallTypes.save(this._formInput(), { expected: this._loaded });
        this._draft = null;
        this._selectedId = saved.id;
        await this.render({ force: true });
        ui.notifications.info("Wall type saved. Existing walls keep their current values.");
      });
    }

    async close(options = {}) {
      if (!options.force && !await this._confirmLeave()) return this;
      const result = await super.close(options);
      if (WallTypes._instance === this) WallTypes._instance = null;
      return result;
    }
  };
}
