import { MODULE_ID, EdgeManager, StrikesManager, DownedManager, canControlActor, isCharacter, plainActivityLabel } from "./hardwipe-state.js";
import { ShieldManager } from "./hardwipe-shields.js";
import { BODY_REGION_ANCHORS, BODY_REGION_PATHS, BODY_REGION_PINGS, CyberwareManager, MIRRORED_BODY_REGIONS } from "./hardwipe-cyberware.js";

const TEMPLATE = `modules/${MODULE_ID}/templates/cyberware-tab.hbs`;
const BODY_ART = `modules/${MODULE_ID}/assets/cyberware-body.png`;
const LEFT_SLOTS = ["brain", "spine", "torso", "nervous", "dermal"];
const RIGHT_SLOTS = ["eyes", "audio", "arms", "hands", "legs"];

/** Created at init, after D&D5e has exposed its applications. */
export let HardwipeCharacterSheet;

export class HardwipeSheet {
  static _initialized = false;
  static _actorListeners = new WeakSet();

  static initialize() {
    if (this._initialized) return;
    this._initialized = true;
    const NativeSheet = dnd5e.applications.actor.CharacterActorSheet;
    HardwipeCharacterSheet = class HardwipeCharacterSheet extends NativeSheet {
      static DEFAULT_OPTIONS = {
        classes: ["hardwipe-character-sheet"],
        actions: {
          hardwipeRule: onRuleAction, hardwipeCyberware: onCyberwareAction,
          hardwipeSelectRegion: onSelectRegion, hardwipeService: onServiceAction
        }
      };
      static PARTS = {
        ...NativeSheet.PARTS,
        cyberware: {
          container: { classes: ["tab-body"], id: "tabs" }, template: TEMPLATE,
          scrollable: ["", ".hardwipe-cyberware-items"]
        }
      };
      static TABS = [
        ...NativeSheet.TABS.slice(0, 2),
        { tab: "cyberware", label: "HARDWIPE.Cyberware.Title", icon: "fas fa-microchip" },
        ...NativeSheet.TABS.slice(2)
      ];
      _hardwipeSlot = "brain";
      _hardwipeServicesOpen = false;

      async _onRender(context, options) {
        await super._onRender(context, options);
        HardwipeSheet._observeCallouts(this);
      }

      _attachFrameListeners() {
        super._attachFrameListeners();
        // Delegate to the persistent frame so partial tab renders never duplicate listeners.
        new dnd5e.applications.ContextMenu5e(this.element, ".hardwipe-body-map-drawing", [
          {
            label: "HARDWIPE.Cyberware.PaperDollChoose", icon: "fas fa-image",
            visible: () => canControlActor(this.actor) && !this.actor.limited,
            onClick: () => this._choosePaperDoll().catch(reportError)
          },
          {
            label: "HARDWIPE.Cyberware.PaperDollDefault", icon: "fas fa-rotate-left",
            visible: () => canControlActor(this.actor) && !this.actor.limited
              && this.actor.getFlag(MODULE_ID, "paperDoll") != null,
            onClick: () => this._setPaperDoll(null).catch(reportError)
          }
        ], { jQuery: false, fixed: true });
        this.element.addEventListener("keydown", event => {
          const target = event.target.closest?.(".hardwipe-body-map-drawing");
          if (!target || !canControlActor(this.actor) || this.actor.limited
            || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
          event.preventDefault();
          event.stopPropagation();
          const rect = target.getBoundingClientRect();
          target.dispatchEvent(new PointerEvent("contextmenu", {
            bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2,
            clientY: rect.top + Math.min(80, rect.height / 2)
          }));
        });
        // SVG image errors do not bubble. Capture them before switching to the built-in art.
        this.element.addEventListener("error", event => {
          const image = event.target;
          if (!image.matches?.("image.hardwipe-paper-doll") || image.getAttribute("href") === BODY_ART) return;
          image.setAttribute("href", BODY_ART);
          image.dataset.fallback = "true";
          image.closest("svg").setAttribute("viewBox", "110 25 804 1486");
          image.closest(".hardwipe-body-map").classList.remove("has-custom-paper-doll");
        }, true);
      }

      async _choosePaperDoll() {
        if (!canControlActor(this.actor) || this.actor.limited) return;
        if (!game.user.can("FILES_BROWSE")) {
          const current = paperDollPath(this.actor.getFlag(MODULE_ID, "paperDoll")) ?? BODY_ART;
          const path = await foundry.applications.api.DialogV2.prompt({
            window: { title: game.i18n.localize("HARDWIPE.Cyberware.PaperDollChoose") },
            content: `<div class="form-group stacked"><label>${label("HARDWIPE.Cyberware.PaperDollPath")}</label>
              <input type="text" name="paperDoll" value="${escapeSheetHTML(current)}" aria-label="${label("HARDWIPE.Cyberware.PaperDollPath")}" required>
              <p class="hint">${label("HARDWIPE.Cyberware.PaperDollPathHint")}</p></div>`,
            rejectClose: false,
            ok: { label: "HARDWIPE.Cyberware.PaperDollSave", callback: (event, button) => button.form.elements.paperDoll.value }
          });
          if (typeof path === "string") await this._setPaperDoll(path);
          return;
        }
        const picker = new foundry.applications.apps.FilePicker.implementation({
          type: "image", current: paperDollPath(this.actor.getFlag(MODULE_ID, "paperDoll")) ?? BODY_ART,
          redirectToRoot: [BODY_ART], document: this.actor,
          callback: path => this._setPaperDoll(path).catch(reportError)
        });
        await picker.browse();
      }

      async _setPaperDoll(path) {
        // Re-check ownership when the picker returns; permissions can change while it is open.
        if (!canControlActor(this.actor) || this.actor.limited) return;
        if (path === null || path === BODY_ART) return this.actor.unsetFlag(MODULE_ID, "paperDoll");
        const value = paperDollPath(path);
        if (!value) throw new Error(game.i18n.localize("HARDWIPE.Cyberware.PaperDollInvalid"));
        return this.actor.setFlag(MODULE_ID, "paperDoll", value);
      }

      _toggleDeathTray(open) {
        // The native action passes no force value; explicitly compute it before forwarding.
        const tray = this.form.querySelector(".death-tray");
        super._toggleDeathTray(open ?? !tray.classList.contains("open"));
        const tab = tray.querySelector(".hardwipe-strikes-tab");
        if (tab) {
          tab.setAttribute("aria-label", game.i18n.localize("HARDWIPE.Strikes.Title"));
          tab.setAttribute("aria-expanded", String(this._deathTrayOpen));
        }
      }

      async _preparePartContext(partId, context, options) {
        context = await super._preparePartContext(partId, context, options);
        if (partId === "cyberware") {
          context.cyberware = HardwipeSheet._cyberwareContext(this.actor, this._hardwipeSlot);
          context.cyberware.servicesOpen = this._hardwipeServicesOpen;
          await HardwipeSheet._cyberwareDescriptions(this.actor, context.cyberware.selected, this._hardwipeOpenDescriptions);
        }
        return context;
      }

      async _prepareItemPhysical(item, ctx) {
        await super._prepareItemPhysical(item, ctx);
        if (!CyberwareManager.isCyberware(item)) return;
        const state = CyberwareManager.getState(item);
        const status = cyberwareStatus(state);
        ctx.subtitle = [ctx.subtitle, escapeSheetHTML(status), state.pending
          ? escapeSheetHTML(textLabel("Queued", "Queued for rest")) : null].filter(Boolean).join(" • ");
        // Installation is committed by a qualifying rest, never the inventory equip toggle.
        ctx.equip.disabled = true;
        ctx.equip.title = "HARDWIPE.Cyberware.EquipHint";
      }

      // Modify detached parts before native DOM/scroll synchronization, with fresh values each render.
      async _renderHTML(context, options) {
        const parts = await super._renderHTML(context, options);
        if (!this.actor.limited) {
          if (parts.sidebar) {
            HardwipeSheet._renderEdge(this.actor, parts.sidebar, true);
            HardwipeSheet._renderStrikes(this.actor, parts.sidebar, true);
          }
          if (parts.inventory) {
            HardwipeSheet._renderShields(this.actor, parts.inventory);
            HardwipeSheet._renderCyberwareInventory(this.actor, parts.inventory);
          }
        }
        return parts;
      }
    };
    foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, HardwipeCharacterSheet, {
      types: ["character"], makeDefault: true, label: "HARDWIPE.Sheet.Character"
    });

    // Refresh small rule controls on explicitly selected third-party character sheets.
    Hooks.on("renderCharacterActorSheet", (app, html) => {
      if (app instanceof HardwipeCharacterSheet) return;
      const actor = app.actor ?? app.document;
      const element = asElement(html ?? app.element);
      if (!isCharacter(actor) || actor.limited || !element) return;
      this._renderEdge(actor, element);
      this._renderStrikes(actor, element);
      this._renderShields(actor, element);
      this._renderCyberwareInventory(actor, element);
      if (!this._actorListeners.has(element)) {
        element.addEventListener("click", event => {
          const activity = event.target.closest?.(".hardwipe-inventory-actions [data-cyberware-action='use']");
          if (activity && element.contains(activity) && !activity.disabled) {
            event.preventDefault();
            event.stopPropagation();
            this._useCyberwareActivity(event, actor, activity, app).catch(reportError);
            return;
          }
          const button = event.target.closest?.("[data-hardwipe-rule]");
          if (button && element.contains(button) && !button.disabled) this._handleRule(event, actor, button).catch(reportError);
        });
        this._actorListeners.add(element);
      }
    });
    Hooks.on("renderItemSheet5e", (app, html) => {
      const item = app.item ?? app.document;
      const element = asElement(html ?? app.element);
      if (!element) return;
      element.querySelectorAll(".hardwipe-shield-item-panel, .hardwipe-cyberware-item-panel").forEach(panel => panel.remove());
      const cyberware = CyberwareManager.isCyberware(item);
      element.classList.toggle("hardwipe-cyberware-item-sheet", cyberware);
      if (this._isShield(item)) this._renderShieldItem(item, element);
      if (cyberware) this._renderCyberwareItem(item, element);
    });
  }

  static _cyberwareContext(actor, selectedId) {
    const context = CyberwareManager.getContext(actor);
    const labels = {
      title: textLabel("Title", "Cyberware"), schematic: textLabel("Schematic", "Body map"),
      frontView: textLabel("FrontView", "Front view"),
      paperDollMenu: textLabel("PaperDollMenu", "Right-click to change paper doll. Keyboard: Shift+F10."),
      installed: textLabel("Installed", "Installed"), stored: textLabel("Stored", "In inventory"),
      enabled: textLabel("Enabled", "Enabled"), disabled: textLabel("Disabled", "Disabled"),
      damaged: textLabel("Damaged", "Damaged"), queued: textLabel("Queued", "Queued for rest"),
      pending: textLabel("Pending", "Pending changes"), empty: textLabel("Empty", "No cyberware in this inventory category."),
      emptySlot: textLabel("EmptySlot", "Slot empty"), service: textLabel("Service", "Service access"),
      ripperDoc: textLabel("RipperDoc", "Ripperdoc"), tools: textLabel("Tools", "Cyberware tools"),
      install: textLabel("Install", "Queue installation"), remove: textLabel("Remove", "Queue removal"),
      cancel: textLabel("Cancel", "Cancel queued change"), enable: textLabel("Enable", "Enable"),
      installShort: textLabel("InstallShort", "Install"), removeShort: textLabel("RemoveShort", "Remove"),
      cancelShort: textLabel("CancelShort", "Cancel"), serviceShort: textLabel("ServiceShort", "Service"),
      disable: textLabel("Disable", "Disable"), reset: textLabel("Reset", "Reset"), repair: textLabel("Repair", "Repair"),
      open: textLabel("OpenItem", "Open item"), selfSwap: textLabel("SelfSwap", "Self swap at a short rest"),
      clinicSwap: textLabel("ClinicSwap", "Ripperdoc required for a rest swap"),
      restHint: textLabel("RestHint", "Queued swaps take effect when a rest completes."),
      serviceHint: textLabel("ServiceHint", "Reset and repair require tools or a ripperdoc."),
      passive: textLabel("PassiveEffects", "Passive effects"),
      actions: textLabel("Actions", "Actions"),
      available: textLabel("Available", "Available"),
      inventoryHint: textLabel("InventoryHint", "Active cyberware also appears in Inventory beside your weapons."),
      readMore: textLabel("ReadMore", "Read more"), showLess: textLabel("ShowLess", "Show less")
    };
    const slots = context.slots.map(slot => ({
      ...slot, selected: slot.id === selectedId,
      bodyPath: BODY_REGION_PATHS[slot.id] ?? "",
      mirrored: MIRRORED_BODY_REGIONS.has(slot.id),
      pings: (BODY_REGION_PINGS[slot.id] ?? []).map(([cx, cy, r]) => ({ cx, cy, r })),
      count: slot.items.length,
      damaged: slot.items.some(item => item.installed && item.damaged),
      disabled: slot.items.some(item => item.installed && item.disabled),
      items: slot.items.map(item => ({
        ...item,
        activities: cyberwareActivities(actor.items.get(item.id)).map(activity => ({
          id: activity.id, name: plainActivityLabel(activity.name), activation: activityActivation(activity),
          canUse: item.enabled && context.canControl
        })),
        passiveEffects: cyberwarePassiveEffects(actor.items.get(item.id)),
        stateLabel: item.damaged ? labels.damaged : item.disabled ? labels.disabled
          : item.installed ? labels.enabled : labels.stored,
        stateKey: item.damaged ? "damaged" : item.disabled ? "disabled" : item.installed ? "enabled" : "stored",
        queuedLabel: item.queued === "remove" ? labels.remove : labels.install
      }))
    }));
    const selected = slots.find(slot => slot.selected) ?? slots[0];
    if (selected) selected.selected = true;
    for (const slot of slots) {
      slot.previewItem = slot.items.find(item => item.installed) ?? slot.items[0] ?? null;
      slot.extraCount = Math.max(0, slot.items.length - 1);
    }
    const customBody = paperDollPath(actor.getFlag(MODULE_ID, "paperDoll"));
    return {
      ...context, slots, selected, labels, bodyArt: customBody ?? BODY_ART, customBody: !!customBody,
      bodyViewBox: customBody ? "0 0 1024 1536" : "110 25 804 1486",
      rarityColors: game.modules.get("sc-item-rarity-colors")?.active === true,
      leftSlots: LEFT_SLOTS.map(id => slots.find(slot => slot.id === id)),
      rightSlots: RIGHT_SLOTS.map(id => slots.find(slot => slot.id === id))
    };
  }

  /** Enriched descriptions for the selected region's items; long ones start clamped unless this sheet opened them. */
  static async _cyberwareDescriptions(actor, selected, open) {
    const TextEditor = foundry.applications.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    for (const view of selected?.items ?? []) {
      const item = actor.items.get(view.id);
      const source = item?.system?.description?.value ?? "";
      const plain = source.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (!plain) continue;
      view.description = await TextEditor.enrichHTML(source, { relativeTo: item, rollData: item.getRollData?.() ?? {}, secrets: item.isOwner });
      view.descriptionLong = plain.length > 160;
      view.descriptionOpen = !!open?.has(view.id);
    }
  }

  /**
   * A callout line from the selected slot card to its region on the doll. It is measured from the
   * live layout, so it redraws whenever that changes size (tab shown, sheet resized, a card grows).
   */
  static _observeCallouts(sheet) {
    sheet._hardwipeCalloutObserver?.disconnect();
    const layout = sheet.element?.querySelector(".hardwipe-cyberware-layout");
    if (!layout) return;
    const observer = new ResizeObserver(() => this._drawCallouts(layout));
    observer.observe(layout);
    sheet._hardwipeCalloutObserver = observer;
  }

  static _drawCallouts(layout) {
    layout.querySelector(":scope > .hardwipe-callouts")?.remove();
    // Custom paper dolls hide the default region overlays; their anatomy does not match the anchors either.
    if (!layout.isConnected || layout.querySelector(".has-custom-paper-doll")) return;
    const svg = layout.querySelector(".hardwipe-body-map-drawing svg");
    const matrix = svg?.getScreenCTM();
    const box = layout.getBoundingClientRect();
    if (!matrix || !box.width || !box.height) return;
    const scale = layout.offsetWidth / box.width;
    const local = (x, y) => [(x - box.left) * scale, (y - box.top) * scale];
    const lines = [];
    // Only the selected slot: one line on a fully kitted doll stays readable.
    for (const card of layout.querySelectorAll(".hardwipe-slot-card.is-selected")) {
      const id = card.dataset.slot;
      if (!BODY_REGION_ANCHORS[id]) continue;
      const rect = card.getBoundingClientRect();
      const fromLeft = rect.left + rect.width / 2 < box.left + box.width / 2;
      let [x, y] = BODY_REGION_ANCHORS[id];
      if (MIRRORED_BODY_REGIONS.has(id) && !fromLeft) x = 1024 - x;
      const point = new DOMPoint(x, y).matrixTransform(matrix);
      const [ax, ay] = local(point.x, point.y);
      const [cx, cy] = local(fromLeft ? rect.right : rect.left, rect.top + rect.height / 2);
      const ex = cx + (fromLeft ? 14 : -14);
      const tone = card.classList.contains("is-damaged") ? "is-damaged" : card.classList.contains("is-disabled") ? "is-disabled" : "";
      const round = value => Math.round(value * 10) / 10;
      lines.push(`<g class="${tone}${card.classList.contains("is-selected") ? " is-selected" : ""}">
        <polyline class="hardwipe-callout-lead" points="${round(cx)},${round(cy)} ${round(ex)},${round(cy)} ${round(ax)},${round(ay)}"/>
        <rect class="hardwipe-callout-tick" x="${round(fromLeft ? cx : cx - 3)}" y="${round(cy - 1.5)}" width="3" height="3"/>
        <circle class="hardwipe-callout-ring" cx="${round(ax)}" cy="${round(ay)}" r="6"/>
        <circle class="hardwipe-callout-dot" cx="${round(ax)}" cy="${round(ay)}" r="2.2"/></g>`);
    }
    if (!lines.length) return;
    layout.insertAdjacentHTML("beforeend", `<svg class="hardwipe-callouts" aria-hidden="true" focusable="false"
      width="${layout.offsetWidth}" height="${layout.offsetHeight}" viewBox="0 0 ${layout.offsetWidth} ${layout.offsetHeight}">${lines.join("")}</svg>`);
  }

  static _renderCyberwareInventory(actor, element) {
    element.querySelectorAll(".hardwipe-inventory-actions, .hardwipe-inventory-state").forEach(node => node.remove());
    for (const row of element.querySelectorAll(".items-list .item[data-item-id]")) {
      row.classList.remove("hardwipe-cyberware-inventory-item");
      const item = actor.items.get(row.dataset.itemId);
      if (!CyberwareManager.isCyberware(item)) continue;
      const state = CyberwareManager.getState(item);
      row.classList.add("hardwipe-cyberware-inventory-item");
      // Native activity rows remain available on expand; they use the same operational gate.
      for (const control of row.querySelectorAll('[data-action="activity-use"]')) {
        control.ariaDisabled = String(!state.enabled || !canControlActor(actor));
      }
      const equip = row.querySelector('[data-action="equip"]');
      if (equip) {
        equip.ariaDisabled = "true";
        equip.setAttribute("data-tooltip", "HARDWIPE.Cyberware.EquipHint");
      }
      const title = row.querySelector(".name.name-stacked");
      if (title && !(actor.sheet instanceof HardwipeCharacterSheet)) {
        const badge = element.ownerDocument.createElement("span");
        badge.className = "subtitle hardwipe-inventory-state";
        badge.textContent = cyberwareStatus(state);
        title.append(badge);
      }
      const activities = cyberwareActivities(item);
      if (!activities.length) continue;
      const actions = element.ownerDocument.createElement("div");
      actions.className = "hardwipe-inventory-actions";
      actions.setAttribute("role", "group");
      actions.setAttribute("aria-label", `${item.name}: ${textLabel("Actions", "Actions")}`);
      actions.innerHTML = activities.map(activity => `<button type="button"
        class="hardwipe-btn is-primary hardwipe-activity-button" data-action="hardwipeCyberware" data-cyberware-action="use" data-activity-id="${escapeSheetHTML(activity.id)}"
        aria-disabled="${!state.enabled || !canControlActor(actor)}" ${state.enabled && canControlActor(actor) ? "" : "disabled"}
        title="${escapeSheetHTML(plainActivityLabel(activity.name))} · ${escapeSheetHTML(activityActivation(activity))}">
        <i class="fas fa-play" inert></i><span>${escapeSheetHTML(plainActivityLabel(activity.name))}</span>
        <small>${escapeSheetHTML(activityActivation(activity))}</small></button>`).join("");
      row.querySelector(":scope > .item-row")?.after(actions);
    }
  }

  static async _useCyberwareActivity(event, actor, target, sheet) {
    const item = actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    const activity = cyberwareActivities(item).find(activity => activity.id === target.dataset.activityId);
    if (!canControlActor(actor) || !CyberwareManager.isOperational(item) || !activity) return;
    target.disabled = true;
    try { return await activity.use({ event }, { options: { sheet } }); }
    finally {
      if (target.isConnected) {
        target.disabled = !canControlActor(actor) || !CyberwareManager.isOperational(item);
        target.ariaDisabled = String(target.disabled);
      }
    }
  }

  /** Edge sits with the other survival resources: below Hit Dice, directly above the Strikes tray. */
  static _renderEdge(actor, element, native = false) {
    element.querySelectorAll(".hardwipe-edge-group, .hardwipe-edge-header-chip").forEach(node => node.remove());
    const stats = element.querySelector(".sidebar .card > .stats") ?? element.querySelector(".card > .stats");
    if (!stats) return;
    const edge = EdgeManager.get(actor);
    const group = element.ownerDocument.createElement("div");
    group.className = `meter-group hardwipe-edge-group ${edge ? "ready" : "empty"}`;
    group.innerHTML = `<div class="label roboto-condensed-upper"><span>${label("HARDWIPE.Edge.Title")}</span>
      ${game.user.isGM ? ruleButton("award-edge", "HARDWIPE.Edge.Award", "fa-plus", false, native) : ""}</div>
      <div class="meter meter-lg hardwipe-edge-meter" role="group" aria-label="${label("HARDWIPE.Edge.Title")}">
        <div class="label"><span class="value hardwipe-edge-value" aria-label="${label("HARDWIPE.Edge.Title")}: ${edge}">${edge}</span></div>
        ${canControlActor(actor) ? ruleButton("spend-edge", "HARDWIPE.Edge.Spend", "fa-bolt", !edge, native,
          "HARDWIPE.Edge.SpendShort") : ""}
      </div>`;
    stats.append(group);
  }

  static _renderStrikes(actor, element, native = false) {
    const tray = element.querySelector(".death-tray");
    if (!tray) return;
    const strikes = StrikesManager.get(actor);
    const downed = DownedManager.isDowned(actor);
    const dead = actor.statuses?.has("dead") || strikes >= 3;
    const canRecover = canControlActor(actor) && EdgeManager.get(actor)
      && !dead && (downed || Number(actor.system?.attributes?.hp?.value) <= 0);
    const statusLabel = dead ? localizedLabel("HARDWIPE.Strikes.Dead", "Dead")
      : label(downed ? "HARDWIPE.Downed.Title" : "HARDWIPE.Strikes.Stable");
    // Tone follows danger: clean at 0, warn at 1, alert at 2, flatline at 3.
    const tone = dead ? "is-dead" : strikes >= 2 ? "is-alert" : strikes === 1 ? "is-warn" : "is-clean";
    tray.classList.add("hardwipe-strikes-shell");
    // Retain the native tray and open state, replacing only its rules content.
    tray.innerHTML = `<div class="death-saves hardwipe-strikes-tray ${tone}" style="--strikes: ${Math.min(3, strikes)}">
      <span class="hardwipe-strikes-label">${label("HARDWIPE.Strikes.Title")}</span>
      <div class="hardwipe-strike-pips" role="group" aria-label="${label("HARDWIPE.Strikes.Title")}">
      ${[1, 2, 3].map(n => `<button type="button" class="unbutton always-interactive hardwipe-strike-pip ${strikes >= n ? "filled" : ""}"
        ${native ? 'data-action="hardwipeRule"' : ""} data-hardwipe-rule="set-strikes" data-value="${n}"
        aria-pressed="${strikes >= n}" aria-label="${escapeSheetHTML(game.i18n.format("HARDWIPE.Strikes.Pip", { n }))}"
        ${game.user.isGM ? "" : "disabled"}><i class="fas ${strikes >= n ? "fa-xmark" : "fa-circle"}" inert></i></button>`).join("")}</div>
      <div class="hardwipe-strikes-status">${statusLabel}<b>${strikes}/3</b></div>
      ${game.user.isGM ? `<div class="hardwipe-strikes-gm">${ruleButton("add-strike", "HARDWIPE.Strikes.Add", "fa-plus", false, native, null, "hud")}
        ${ruleButton("reset-strikes", "HARDWIPE.Strikes.Reset", "fa-rotate-left", false, native, null, "hud")}</div>` : ""}
      ${canRecover ? ruleButton("edge-recover", "HARDWIPE.Edge.Recover", "fa-heart-pulse", false, native,
        "HARDWIPE.Edge.RecoverShort", "hud") : ""}</div>
      <button type="button" class="death-tab card-tab horizontal unbutton always-interactive hardwipe-strikes-tab ${strikes ? "has-strikes" : ""}"
        data-action="toggleDeathTray" aria-expanded="${tray.classList.contains("open")}" aria-label="${label("HARDWIPE.Strikes.Title")}" data-tooltip="HARDWIPE.Strikes.Title">
        <i class="fas fa-heart-crack" inert></i><span class="hardwipe-strikes-count">${strikes}/3</span></button>`;
  }

  static _renderShields(actor, element) {
    element.querySelectorAll(".hardwipe-shield-inventory-hp").forEach(node => node.remove());
    for (const row of element.querySelectorAll(".items-list .item[data-item-id]")) {
      row.classList.remove("hardwipe-shield-row");
      const item = actor.items?.get(row.dataset.itemId);
      if (!this._isShield(item)) continue;
      const shield = ShieldManager.get(item);
      const name = row.querySelector(".name.name-stacked") ?? row.querySelector(".item-name .name");
      if (!shield || !name) continue;
      row.classList.add("hardwipe-shield-row");
      const bar = element.ownerDocument.createElement("div");
      bar.className = `hardwipe-shield-inventory-hp hardwipe-shield-hp ${shieldTier(shield)}`;
      bar.innerHTML = shieldMeter(shield);
      name.append(bar);
    }
  }

  static async _handleRule(event, actor, target) {
    event.preventDefault();
    event.stopPropagation();
    if (!canControlActor(actor)) return;
    const action = target.dataset.hardwipeRule;
    if (["award-edge", "add-strike", "reset-strikes", "set-strikes"].includes(action) && !game.user.isGM) return;
    switch (action) {
      case "edge-recover": await DownedManager.recover(actor, { hp: 1, spendEdge: true }); break;
      case "spend-edge": await EdgeManager.spend(actor, game.i18n.localize("HARDWIPE.Edge.GenericReason")); break;
      case "award-edge": await EdgeManager.award(actor); break;
      case "add-strike": await StrikesManager.add(actor); break;
      case "reset-strikes":
        await StrikesManager.reset(actor);
        await actor.unsetFlag(MODULE_ID, "deathAnnounced");
        break;
      case "set-strikes": {
        const value = Number(target.dataset.value);
        if (![1, 2, 3].includes(value)) return;
        await StrikesManager.set(actor, StrikesManager.get(actor) === value ? value - 1 : value);
        break;
      }
    }
  }

  static _renderShieldItem(item, element) {
    const shield = ShieldManager.get(item);
    if (!shield) return;
    const owner = game.user.isGM || item.isOwner || canControlActor(item.actor);
    const panel = element.ownerDocument.createElement("section");
    panel.className = `hardwipe-item-strip hardwipe-shield-item-panel ${shield.broken ? "is-broken" : ""}`;
    panel.innerHTML = `<span class="hardwipe-label"><i class="fas fa-shield-halved" inert></i>${label("HARDWIPE.Shield.InventoryHP")}</span>
      <div class="hardwipe-shield-inventory-hp hardwipe-shield-hp ${shieldTier(shield)}">${shieldMeter(shield, { icon: false })}</div>
      ${owner ? `<div class="hardwipe-shield-controls">
        ${itemButton("shield-damage", "HARDWIPE.Shield.DamageOne", "fa-minus")}
        ${itemButton("shield-heal", "HARDWIPE.Shield.HealOne", "fa-plus")}
        ${itemButton("shield-repair", "HARDWIPE.Shield.Repair", "fa-screwdriver-wrench")}</div>` : ""}`;
    panel.addEventListener("click", async event => {
      const button = event.target.closest?.("[data-hardwipe-item-action]");
      if (!button || !panel.contains(button) || !owner || button.disabled || panel.dataset.updating === "true") return;
      event.preventDefault();
      event.stopPropagation();
      panel.dataset.updating = "true";
      const controls = panel.querySelectorAll("[data-hardwipe-item-action]");
      controls.forEach(control => { control.disabled = true; });
      try {
        switch (button.dataset.hardwipeItemAction) {
          case "shield-damage": await ShieldManager.damage(item, 1); break;
          case "shield-heal": await ShieldManager.heal(item, 1); break;
          case "shield-repair": await ShieldManager.repair(item); break;
        }
      } catch (error) { reportError(error); }
      finally {
        if (panel.isConnected) {
          delete panel.dataset.updating;
          controls.forEach(control => { control.disabled = false; });
        }
      }
    });
    element.querySelector(".sheet-header")?.after(panel);
  }

  static _renderCyberwareItem(item, element) {
    const state = CyberwareManager.getState(item);
    const installed = escapeSheetHTML(textLabel(state.installed ? "Installed" : "Stored", state.installed ? "Installed" : "In inventory"));
    const status = state.damaged ? escapeSheetHTML(textLabel("Damaged", "Damaged"))
      : state.disabled ? escapeSheetHTML(textLabel("Disabled", "Disabled"))
        : state.installed ? escapeSheetHTML(textLabel("Enabled", "Enabled")) : "";
    const toggleLabel = escapeSheetHTML(textLabel(state.damaged ? "ClearDamaged" : "MarkDamaged",
      state.damaged ? "Clear cyberware damage (GM override)" : "Mark cyberware damaged"));
    const panel = element.ownerDocument.createElement("section");
    const stateKey = state.damaged ? "damaged" : state.disabled ? "disabled" : state.installed ? "enabled" : "stored";
    // Same strip layout as the shield editor: label, state, then controls on the right.
    panel.className = `hardwipe-item-strip hardwipe-cyberware-item-panel ${state.damaged ? "is-damaged" : ""}`;
    panel.innerHTML = `<span class="hardwipe-label"><i class="fas fa-microchip" inert></i>${escapeSheetHTML(textLabel("Title", "Cyberware"))}</span>
      <span class="hardwipe-state hardwipe-strip-state is-${stateKey}">${installed}${status ? ` · ${status}` : ""}</span>
      ${game.user.isGM ? `<button type="button" class="always-interactive hardwipe-btn is-icon is-danger"
        data-hardwipe-item-action="cyberware-damage" aria-pressed="${state.damaged}"
        data-tooltip="${toggleLabel}" aria-label="${toggleLabel}"><i class="fas fa-triangle-exclamation" inert></i></button>` : ""}`;
    panel.addEventListener("click", async event => {
      const button = event.target.closest?.('[data-hardwipe-item-action="cyberware-damage"]');
      if (!button || !panel.contains(button) || !game.user.isGM || !CyberwareManager.isCyberware(item)) return;
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      try {
        // A deliberate GM status edit. The narrow path retains installation, power, pending swaps, and unknown flags.
        await item.update({ [`flags.${MODULE_ID}.cyberware.damaged`]: !CyberwareManager.getState(item).damaged });
      } catch (error) { reportError(error); }
      finally { if (button.isConnected) button.disabled = false; }
    });
    element.querySelector(".sheet-header")?.after(panel);
  }

  static _isShield(item) {
    return item?.documentName === "Item" && item.type === "equipment" && item.system?.type?.value === "shield";
  }
}

async function onRuleAction(event, target) {
  target.disabled = true;
  try { await HardwipeSheet._handleRule(event, this.actor, target); }
  catch (error) { reportError(error); }
  finally { if (target.isConnected) target.disabled = false; }
}

function onSelectRegion(event, target) {
  event.preventDefault();
  const id = target.dataset.slot;
  if (!(id in BODY_REGION_PATHS)) return;
  this._hardwipeSlot = id;
  return this.render({ parts: ["cyberware"] });
}

async function onCyberwareAction(event, target) {
  event.preventDefault();
  const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
  if (!item || !CyberwareManager.isCyberware(item)) return;
  if (target.dataset.cyberwareAction === "open") return item.sheet.render({ force: true });
  if (target.dataset.cyberwareAction === "description") {
    // Read more / Show less: this sheet only, no re-render.
    this._hardwipeOpenDescriptions ??= new Set();
    const open = !this._hardwipeOpenDescriptions.has(item.id);
    if (open) this._hardwipeOpenDescriptions.add(item.id);
    else this._hardwipeOpenDescriptions.delete(item.id);
    target.closest(".hardwipe-cyberware-desc")?.classList.toggle("is-open", open);
    target.setAttribute("aria-expanded", String(open));
    const label = target.querySelector("span");
    if (label) label.textContent = textLabel(open ? "ShowLess" : "ReadMore", open ? "Show less" : "Read more");
    return;
  }
  if (!canControlActor(this.actor)) return;
  target.disabled = true;
  try {
    switch (target.dataset.cyberwareAction) {
      case "use": {
        await HardwipeSheet._useCyberwareActivity(event, this.actor, target, this);
        break;
      }
      case "install": await CyberwareManager.queueInstall(item); break;
      case "remove": await CyberwareManager.queueRemove(item); break;
      case "cancel": await CyberwareManager.cancelQueued(item); break;
      case "disable": await CyberwareManager.setEnabled(item, false); break;
      case "enable": await CyberwareManager.setEnabled(item, true); break;
      case "reset": await CyberwareManager.reset(item); break;
      case "repair": await CyberwareManager.repair(item); break;
    }
  } catch (error) { reportError(error); }
  finally { if (target.isConnected && target.dataset.cyberwareAction !== "use") target.disabled = false; }
}

async function onServiceAction(event, target) {
  event.preventDefault();
  if (!game.user.isGM) return;
  if (target.dataset.service === "menu") {
    this._hardwipeServicesOpen = !this._hardwipeServicesOpen;
    return this.render({ parts: ["cyberware"] });
  }
  const service = CyberwareManager.getContext(this.actor).service;
  const key = target.dataset.service;
  if (!["ripperDoc", "tools"].includes(key)) return;
  target.disabled = true;
  try { await CyberwareManager.setServices(this.actor, { ...service, [key]: !service[key] }); }
  catch (error) { reportError(error); }
  finally { if (target.isConnected) target.disabled = false; }
}

/**
 * Labelled rule actions (Spend, Recover) are primary; unlabelled GM adjustments are icon controls.
 * The "hud" variant uses the street-deck control inside the Strikes tray.
 */
function ruleButton(action, key, icon, disabled = false, native = false, visibleLabel = null, variant = "sheet") {
  const base = variant === "hud" ? "hardwipe-hud-btn" : "hardwipe-btn";
  return `<button type="button" class="always-interactive ${base} ${visibleLabel ? "is-primary" : "is-icon"} hardwipe-rule-button"
    ${native ? 'data-action="hardwipeRule"' : ""} data-hardwipe-rule="${action}"
    aria-label="${label(key)}" data-tooltip="${key}" ${disabled ? "disabled" : ""}><i class="fas ${icon}" inert></i>
    ${visibleLabel ? `<span class="hardwipe-rule-label">${label(visibleLabel)}</span>` : ""}</button>`;
}
function itemButton(action, key, icon) {
  return `<button type="button" class="always-interactive hardwipe-btn is-icon"
    data-hardwipe-item-action="${action}" aria-label="${label(key)}" data-tooltip="${key}"><i class="fas ${icon}" inert></i></button>`;
}
/** Condition tier colours the meter: sound, worn (at most 60%), critical (at most 30%), broken. */
function shieldTier(shield) {
  if (shield.broken) return "is-broken";
  const percent = Number(shield.percent) || 0;
  return percent <= 30 ? "is-critical" : percent <= 60 ? "is-worn" : "is-sound";
}
/** A number badge beside one discrete cell per HP; nothing is drawn over the cells. */
function shieldMeter(shield, { icon = true } = {}) {
  const max = Math.min(20, Math.max(1, Number(shield.max) || 10));
  const hp = Math.min(max, Math.max(0, Number(shield.hp) || 0));
  const cells = Array.from({ length: max }, (_, index) => `<i class="${index < hp ? "is-on" : ""}"></i>`).join("");
  return `<span class="hardwipe-shield-hp-badge" role="meter" aria-label="${label("HARDWIPE.Shield.HP")}" aria-valuemin="0"
    aria-valuenow="${shield.hp}" aria-valuemax="${shield.max}">${icon ? '<i class="fas fa-shield-halved" inert></i>' : ""}<b>${shield.hp}</b><span>/${shield.max}</span></span>
    <span class="hardwipe-shield-hp-cells" aria-hidden="true">${cells}</span>
    ${shield.broken ? `<span class="hardwipe-shield-hp-status">${label("HARDWIPE.Shield.BrokenStatus")}</span>` : ""}`;
}
function asElement(html) { return html?.querySelector ? html : html?.[0]; }
/** Only Foundry asset paths or web image URLs, never an executable/data URI or a malformed flag. */
function paperDollPath(value) {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path || path.length > 4096 || /[\u0000-\u001f\u007f]/.test(path)) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^https?:\/\//i.test(path)) return null;
  return path;
}
function textLabel(key, fallback) {
  const id = `HARDWIPE.Cyberware.${key}`;
  const value = game.i18n.localize(id);
  return value === id ? fallback : value;
}
function cyberwareStatus(state) {
  const key = state.damaged ? "Damaged" : state.disabled ? "Disabled" : state.installed ? "Installed" : "Stored";
  return textLabel(key, state.damaged ? "Damaged" : state.disabled ? "Disabled" : state.installed ? "Installed" : "In inventory");
}
function cyberwareActivities(item) {
  return item?.system.activities?.filter(activity => !activity.isHidden
    && activity.activation?.type && activity.activation.type !== "none") ?? [];
}
function activityActivation(activity) {
  if (activity.labels?.activation) return activity.labels.activation;
  const type = activity.activation?.type;
  const config = CONFIG.DND5E.activityActivationTypes?.[type];
  return game.i18n.localize(typeof config === "string" ? config : config?.label ?? type ?? "");
}
function cyberwarePassiveEffects(item) {
  if (!CyberwareManager.isOperational(item)) return [];
  return item.effects.filter(effect => effect.transfer && !effect.disabled && !effect.isSuppressed)
    .map(effect => effect.name);
}
function label(key) { return escapeSheetHTML(game.i18n.localize(key)); }
function localizedLabel(key, fallback) {
  const value = game.i18n.localize(key);
  return escapeSheetHTML(value === key ? fallback : value);
}
function escapeSheetHTML(value) { return foundry.utils.escapeHTML(String(value ?? "")); }
function reportError(error) {
  console.error(`${MODULE_ID} | Sheet action failed`, error);
  ui.notifications.error(error.message ?? String(error));
}
