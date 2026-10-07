const MODULE_ID = "hardwipe-ruleset";
const HEAT_FLAG = "heat";
const LOCKDOWN_CHAT_FLAG = "hardwipe-lockdown";
const HEAT_STATE_CHAT_FLAG = "hardwipe-heat-state";
const HEAT_CARD_STYLES = ["broadcast", "feed", "scanner"];
const HUD_VISIBLE_SETTING = "heatHudVisible";
const HUD_POSITION_SETTING = "heatHudPosition";
const HUD_WIDTH = 260;
const HUD_MARGIN = 16;
const HUD_ANIMATION_CLASSES = [
  "hardwipe-heat-enter-clean",
  "hardwipe-heat-enter-hot",
  "hardwipe-heat-enter-critical",
  "hardwipe-heat-enter-lockdown"
];
const HEAT_STATE_RANK = {
  idle: 0,
  clean: 1,
  hot: 2,
  critical: 3,
  lockdown: 4
};
const HEAT_STATE_CLASSES = {
  idle: "is-idle",
  clean: "is-clean",
  hot: "is-hot",
  critical: "is-critical",
  lockdown: "is-lockdown"
};
const HEAT_STATE_LABELS = {
  idle: "HARDWIPE.Heat.StatusNone",
  clean: "HARDWIPE.Heat.StatusClean",
  hot: "HARDWIPE.Heat.StatusHot",
  critical: "HARDWIPE.Heat.StatusCritical",
  lockdown: "HARDWIPE.Heat.StatusLockdown"
};
const DEFAULT_HEAT = {
  current: 0,
  max: 0,
  direction: "up",
  status: "idle",
  lockdown: false,
  lockdownAnnounced: false,
  updatedAt: 0,
  updatedBy: ""
};

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class HeatManager {
  static hud = null;
  static _lastSceneHeat = new Map();
  static _lastSceneStatus = new Map();
  static _hudPosition = null;
  static _hudVisible = null;
  static _animationTimer = null;
  static _controlsHooked = false;

  static get api() {
    return {
      get: scene => HeatManager.get(scene),
      startMission: (max, scene, cardStyle) => HeatManager.startMission(max, scene, cardStyle),
      adjust: (delta, scene) => HeatManager.adjust(delta, scene),
      setCurrent: (value, scene) => HeatManager.setCurrent(value, scene),
      isLockdown: scene => HeatManager.isLockdown(scene),
      isHudEnabled: () => HeatManager.isHudEnabled(),
      setHudEnabled: enabled => HeatManager.setHudEnabled(enabled),
      toggleHud: () => HeatManager.toggleHud(),
      getHudPosition: () => HeatManager.getHudPosition(),
      setHudPosition: position => HeatManager.setHudPosition(position)
    };
  }

  static initialize() {
    game.hardwipe ??= {};
    game.hardwipe.apps ??= {};

    this.hud = new HeatHud();
    game.hardwipe.apps.heatHud = this.hud;
    this.renderHud();
    this._refreshControls();

    Hooks.on("canvasReady", () => this.renderHud());
    Hooks.on("updateScene", (scene, changed) => this._onSceneUpdate(scene, changed));
    window.addEventListener("resize", foundry.utils.debounce(() => this.hud?.reposition(), 100));
  }

  static registerSettings() {
    if (!game.settings.settings.has(`${MODULE_ID}.${HUD_VISIBLE_SETTING}`)) {
      game.settings.register(MODULE_ID, HUD_VISIBLE_SETTING, {
        name: "HARDWIPE.Heat.Toggle",
        hint: "HARDWIPE.Heat.ToggleHint",
        scope: "client",
        config: false,
        type: Boolean,
        default: true,
        onChange: value => {
          HeatManager._hudVisible = Boolean(value);
          HeatManager.renderHud();
          HeatManager._refreshControls();
        }
      });
    }

    if (!game.settings.settings.has(`${MODULE_ID}.${HUD_POSITION_SETTING}`)) {
      game.settings.register(MODULE_ID, HUD_POSITION_SETTING, {
        name: "HARDWIPE.Heat.Position",
        scope: "client",
        config: false,
        type: Object,
        default: { top: null, left: null }
      });
    }
  }

  static getScene(scene) {
    if (scene?.documentName === "Scene") return scene;
    if (typeof scene === "string") return game.scenes?.get(scene) ?? null;
    return canvas?.scene ?? game.scenes?.current ?? game.scenes?.active ?? null;
  }

  static get(scene) {
    const target = this.getScene(scene);
    return this._normalizeHeat(target?.getFlag(MODULE_ID, HEAT_FLAG));
  }

  static async startMission(max, scene, cardStyle) {
    if (!this._requireGM()) return this.get(scene);

    const target = this.getScene(scene);
    if (!target) {
      ui.notifications.warn(game.i18n.localize("HARDWIPE.Heat.NoScene"));
      return this.get(scene);
    }

    const budget = Math.max(1, Math.trunc(Number(max) || 0));
    const previousStyle = this.get(target).cardStyle;
    const heat = {
      // How Heat changes are announced in chat this mission (threat broadcast, corrupted feed, police scanner).
      cardStyle: HEAT_CARD_STYLES.includes(cardStyle) ? cardStyle : HEAT_CARD_STYLES.includes(previousStyle) ? previousStyle : HEAT_CARD_STYLES[0],
      current: 0,
      max: budget,
      direction: "up",
      status: "clean",
      lockdown: false,
      lockdownAnnounced: false,
      updatedAt: Date.now(),
      updatedBy: game.user.id
    };

    await target.setFlag(MODULE_ID, HEAT_FLAG, heat);
    return heat;
  }

  static async adjust(delta, scene) {
    const heat = this.get(scene);
    return this.setCurrent(heat.current + Number(delta || 0), scene);
  }

  static async setCurrent(value, scene) {
    if (!this._requireGM()) return this.get(scene);

    const target = this.getScene(scene);
    if (!target) {
      ui.notifications.warn(game.i18n.localize("HARDWIPE.Heat.NoScene"));
      return this.get(scene);
    }

    const previous = this.get(target);
    const current = this._clamp(Math.trunc(Number(value) || 0), 0, previous.max);
    const previousStatus = this.getStatus(previous).key;
    const heat = {
      ...previous,
      current,
      direction: "up",
      lockdown: previous.max > 0 && current >= previous.max,
      lockdownAnnounced: previous.max > 0 && current >= previous.max,
      updatedAt: Date.now(),
      updatedBy: game.user.id
    };
    heat.status = this.getStatus(heat).key;

    await target.setFlag(MODULE_ID, HEAT_FLAG, heat);

    if (previousStatus !== heat.status) {
      await this._announceStateTransition(target, previousStatus, heat.status,
        { from: previous.current, to: current, max: heat.max, style: heat.cardStyle ?? HEAT_CARD_STYLES[0] });
    }

    return heat;
  }

  static isLockdown(scene) {
    const heat = this.get(scene);
    return heat.max > 0 && heat.current >= heat.max;
  }

  static getStatus(heat) {
    const key = this.getStatusKey(heat);
    return {
      key,
      label: game.i18n.localize(HEAT_STATE_LABELS[key] ?? HEAT_STATE_LABELS.idle),
      className: HEAT_STATE_CLASSES[key] ?? "is-idle"
    };
  }

  static getStatusKey(heat) {
    if (heat.max <= 0) return "idle";
    if (heat.current >= heat.max) return "lockdown";

    const ratio = heat.current / heat.max;
    if (ratio >= 0.75) return "critical";
    if (ratio >= 0.5) return "hot";
    return "clean";
  }

  static getPercent(heat) {
    if (heat.max <= 0) return 0;
    return this._clamp(Math.round((heat.current / heat.max) * 100), 0, 100);
  }

  static renderHud() {
    if (!this.hud) return;
    if (!this.isHudEnabled()) {
      void this.hud.close({ force: true });
      return;
    }
    this.hud.render({ force: true });
  }

  static pulseHud() {
    this.animateHudStatus("lockdown");
  }

  static handleHudStatus(sceneId, statusKey) {
    const key = sceneId || "no-scene";
    const previous = this._lastSceneStatus.get(key);
    this._lastSceneStatus.set(key, statusKey);

    if (!statusKey || statusKey === "idle" || previous === undefined || previous === statusKey) return;
    this.animateHudStatus(statusKey);
  }

  static animateHudStatus(statusKey) {
    const element = this.hud?.element;
    if (!element) return;

    const className = `hardwipe-heat-enter-${statusKey}`;
    if (!HUD_ANIMATION_CLASSES.includes(className)) return;

    window.clearTimeout(this._animationTimer);
    element.classList.remove(...HUD_ANIMATION_CLASSES, "hardwipe-lockdown-pulse");

    window.requestAnimationFrame(() => {
      element.classList.add(className);
      if (statusKey === "lockdown") element.classList.add("hardwipe-lockdown-pulse");
      this._animationTimer = window.setTimeout(() => {
        element.classList.remove(className, "hardwipe-lockdown-pulse");
      }, statusKey === "lockdown" ? 2400 : 1500);
    });
  }

  static openConfig(scene) {
    if (!game.user.isGM) return;
    new HeatConfig(this.getScene(scene)).render({ force: true });
  }

  static isHudEnabled() {
    if (typeof this._hudVisible === "boolean") return this._hudVisible;
    this._hudVisible = Boolean(game.settings.get(MODULE_ID, HUD_VISIBLE_SETTING));
    return this._hudVisible;
  }

  static async setHudEnabled(enabled) {
    const next = Boolean(enabled);
    this._hudVisible = next;
    this.renderHud();
    this._refreshControls();

    if (game.settings.get(MODULE_ID, HUD_VISIBLE_SETTING) !== next) {
      await game.settings.set(MODULE_ID, HUD_VISIBLE_SETTING, next);
    }
  }

  static async toggleHud() {
    await this.setHudEnabled(!this.isHudEnabled());
  }

  static getHudPosition(size = {}) {
    const width = Number(size.width) || HUD_WIDTH;
    const height = Number(size.height) || 120;
    if (this._hudPosition) return this.clampHudPosition(this._hudPosition, { width, height });

    const stored = game.settings.get(MODULE_ID, HUD_POSITION_SETTING) ?? {};
    const fallback = this._defaultHudPosition();
    const position = {
      top: Number.isFinite(stored.top) ? stored.top : fallback.top,
      left: Number.isFinite(stored.left) ? stored.left : fallback.left
    };
    this._hudPosition = this.clampHudPosition(position, { width, height });
    return this._hudPosition;
  }

  /** Beside the scene controls and navigation columns, clear of the sidebar whether it is expanded or not. */
  static _defaultHudPosition() {
    const column = ["ui-left-column-2", "ui-left-column-1", "scene-controls"]
      .map(id => document.getElementById(id)).find(element => element?.offsetWidth);
    const right = column?.getBoundingClientRect().right;
    return { top: HUD_MARGIN, left: Number.isFinite(right) ? Math.round(right) + HUD_MARGIN : 320 };
  }

  static async setHudPosition(position, size = {}) {
    const clamped = this.clampHudPosition(position, size);
    this._hudPosition = clamped;
    await game.settings.set(MODULE_ID, HUD_POSITION_SETTING, clamped);
    return clamped;
  }

  static cacheHudPosition(position, size = {}) {
    this._hudPosition = this.clampHudPosition(position, size);
    return this._hudPosition;
  }

  static clampHudPosition(position = {}, size = {}) {
    const width = Number(size.width) || HUD_WIDTH;
    const height = Number(size.height) || 120;
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);

    return {
      left: this._clamp(Math.round(Number(position.left) || margin), margin, maxLeft),
      top: this._clamp(Math.round(Number(position.top) || margin), margin, maxTop)
    };
  }

  static _onSceneUpdate(scene, changed) {
    const heatChanged = foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${HEAT_FLAG}`);
    if (!heatChanged) return;

    const active = this.getScene();
    const heat = this.get(scene);
    this._lastSceneHeat.set(scene.id, heat);

    if (active?.id !== scene.id) return;
    this.renderHud();
  }

  static _normalizeHeat(raw = {}) {
    raw ??= {};
    const max = Math.max(0, Math.trunc(Number(raw.max) || 0));
    const rawCurrent = this._clamp(Math.trunc(Number(raw.current) || 0), 0, max);
    const isRisingHeat = raw.direction === "up";
    const current = isRisingHeat ? rawCurrent : this._clamp(max - rawCurrent, 0, max);

    const heat = {
      ...DEFAULT_HEAT,
      ...raw,
      max,
      current,
      direction: "up",
      lockdown: max > 0 && current >= max,
      lockdownAnnounced: max > 0 && current >= max,
      updatedAt: Number(raw.updatedAt) || 0,
      updatedBy: String(raw.updatedBy || "")
    };

    heat.status = this.getStatusKey(heat);
    return heat;
  }

  static _clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  static _requireGM() {
    if (game.user.isGM) return true;
    ui.notifications.warn(game.i18n.localize("HARDWIPE.Heat.GMOnly"));
    return false;
  }


  static async _announceStateTransition(scene, previousStatus, nextStatus, heat = null) {
    if (!nextStatus || nextStatus === "idle" || previousStatus === nextStatus) return null;

    const direction = (HEAT_STATE_RANK[nextStatus] ?? 0) > (HEAT_STATE_RANK[previousStatus] ?? 0) ? "Up" : "Down";
    const key = `HARDWIPE.Heat.Transition.${direction}.${nextStatus}`;
    const sceneName = this._escapeHTML(scene?.name ?? "");
    const stateTitle = this._escapeHTML(game.i18n.localize(`${key}.Title`));
    const content = `
      <div class="hardwipe-chat-card hardwipe-heat-state-card is-${nextStatus} is-${direction.toLowerCase()}">
        <div class="hardwipe-chat-kicker">${this._escapeHTML(game.i18n.localize(`${key}.Kicker`))}</div>
        <div class="hardwipe-chat-title" data-text="${stateTitle}">${stateTitle}</div>
        <div class="hardwipe-chat-subtitle">${this._escapeHTML(game.i18n.localize(`${key}.Subtitle`))}</div>
        <div class="hardwipe-chat-meta">${this._escapeHTML(game.i18n.format(`${key}.Meta`, { scene: sceneName }))}</div>
      </div>
    `;

    return ChatMessage.implementation.create({
      speaker: { alias: "Hardwipe" },
      content,
      flags: {
        [MODULE_ID]: {
          type: nextStatus === "lockdown" ? LOCKDOWN_CHAT_FLAG : HEAT_STATE_CHAT_FLAG,
          sceneId: scene?.id ?? null,
          previousStatus,
          nextStatus,
          direction: direction.toLowerCase(),
          ...(heat ? { heat } : {})
        }
      }
    });
  }

  static registerControls() {
    if (this._controlsHooked) return;
    Hooks.on("getSceneControlButtons", controls => this._onGetSceneControlButtons(controls));
    this._controlsHooked = true;
  }

  static _onGetSceneControlButtons(controls) {
    const tool = this._buildControlTool();

    const control = controls.tokens ?? controls.token ?? controls.notes ?? Object.values(controls)[0];
    if (!control) return;
    this._addTool(control, tool);
  }

  static _buildControlTool() {
    const onToggle = () => void HeatManager.toggleHud();

    return {
      name: "hardwipe-heat-toggle",
      title: "HARDWIPE.Heat.Toggle",
      icon: "fa-solid fa-temperature-half",
      order: 99,
      button: true,
      active: HeatManager.isHudEnabled(),
      visible: true,
      onChange: onToggle
    };
  }

  static _addTool(control, tool) {
    control.tools ??= {};
    tool.order = Object.values(control.tools)
      .reduce((max, existing) => Math.max(max, Number(existing.order) || 0), 0) + 1;
    control.tools[tool.name] = tool;
  }

  static _refreshControls() {
    ui.controls?.render?.({ force: true });
  }

  static _escapeHTML(value) {
    return foundry.utils.escapeHTML(String(value ?? ""));
  }
}

class HeatHud extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    tag: "div",
    id: "hardwipe-heat-hud",
    classes: ["hardwipe-heat-hud"],
    window: {
      frame: false,
      positioned: true,
      resizable: false,
      controls: []
    },
    position: {
      width: HUD_WIDTH,
      height: "auto"
    }
  };

  static PARTS = {
    content: {
      template: "modules/hardwipe-ruleset/templates/heat-hud.hbs"
    }
  };

  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    // Core reapplies its retained position after every render; always supply the HUD's own placement.
    options.position = { ...options.position, ...HeatManager.getHudPosition(this._measure()) };
  }

  /** Re-clamp the current placement, e.g. after the browser window changes size. */
  reposition() {
    if (this.rendered) this.setPosition(HeatManager.getHudPosition(this._measure()));
  }

  _measure() {
    const rect = this.element?.getBoundingClientRect();
    return rect?.width ? { width: rect.width, height: rect.height } : {};
  }

  async _prepareContext() {
    const scene = HeatManager.getScene();
    const heat = HeatManager.get(scene);
    const status = HeatManager.getStatus(heat);

    return {
      ...heat,
      canDecrease: game.user.isGM && heat.current > 0,
      canIncrease: game.user.isGM && heat.current < heat.max,
      hasMission: heat.max > 0,
      isGM: game.user.isGM,
      percent: HeatManager.getPercent(heat),
      sceneId: scene?.id ?? "",
      sceneName: scene?.name ?? game.i18n.localize("HARDWIPE.Heat.NoScene"),
      status: status.label,
      statusClass: status.className,
      statusKey: status.key
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._activateDrag();

    for (const button of this.element.querySelectorAll("[data-hardwipe-action]")) {
      button.addEventListener("click", event => this._onAction(event));
    }

    HeatManager.handleHudStatus(context.sceneId, context.statusKey);
  }

  async _onAction(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const action = button.dataset.hardwipeAction;

    if (action === "close") {
      await HeatManager.setHudEnabled(false);
    } else if (!game.user.isGM) {
      return;
    } else if (action === "adjust") {
      await HeatManager.adjust(Number(button.dataset.delta || 0));
    } else if (action === "configure") {
      HeatManager.openConfig();
    }
  }

  _activateDrag() {
    const handle = this.element.querySelector("[data-hardwipe-drag]");
    if (!handle || handle.dataset.hardwipeDragReady === "true") return;

    handle.dataset.hardwipeDragReady = "true";
    handle.addEventListener("pointerdown", event => this._onDragStart(event));
  }

  _onDragStart(event) {
    if (event.button !== 0 || event.target.closest("button, a, input, select, textarea")) return;

    event.preventDefault();
    const rect = this.element.getBoundingClientRect();
    const offset = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    const size = { width: rect.width, height: rect.height };
    let latest = { left: rect.left, top: rect.top };

    this.element.classList.add("is-dragging");

    const onMove = moveEvent => {
      latest = HeatManager.clampHudPosition({
        left: moveEvent.clientX - offset.x,
        top: moveEvent.clientY - offset.y
      }, size);
      HeatManager.cacheHudPosition(latest, size);
      this.setPosition(latest);
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      this.element.classList.remove("is-dragging");
      void HeatManager.setHudPosition(latest, size);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }
}

class HeatConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(scene, options = {}) {
    super(options);
    this.scene = scene;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    id: "hardwipe-heat-config",
    classes: ["hardwipe-heat-config"],
    window: {
      title: "HARDWIPE.Heat.ConfigTitle",
      icon: "fas fa-temperature-high",
      resizable: false,
      width: 360,
      height: "auto"
    },
    position: {
      width: 360,
      height: "auto"
    },
    form: {
      handler: HeatConfig.prototype._onSubmit,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    content: {
      template: "modules/hardwipe-ruleset/templates/heat-config.hbs"
    }
  };

  async _prepareContext() {
    const scene = this.scene ?? HeatManager.getScene();
    const heat = HeatManager.get(scene);

    return {
      cardStyle: heat.cardStyle ?? HEAT_CARD_STYLES[0],
      cardStyles: Object.fromEntries(HEAT_CARD_STYLES.map(style => [style, `HARDWIPE.Heat.Style.${style}`])),
      defaultMax: heat.max || 6,
      sceneName: scene?.name ?? game.i18n.localize("HARDWIPE.Heat.NoScene")
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector("[name='max']")?.focus();
  }

  async _onSubmit(event, form, formData) {
    if (!game.user.isGM) return;
    await HeatManager.startMission(formData.get("max"), this.scene, formData.get("cardStyle"));
  }
}
