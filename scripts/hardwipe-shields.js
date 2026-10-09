import {
  MODULE_ID,
  canControlActor,
  escapeHTML,
  resolveActor
} from "./hardwipe-state.js";
import { aggregateCriticalDamage } from "./hardwipe-attack-cards.js";

const SHIELD_FLAG = "shield";
const DEFAULT_SHIELD_HP = 10;
const RSR_MODULE_ID = "rsr5e";

export class ShieldManager {
  static _blocking = new Set();
  static _stateUpdates = new Map();
  static _chatElements = new Map();
  static _refreshTimer = null;
  static _initialized = false;
  static _socket = null;
  static _workflowRequests = new Map();
  static _workflowApplications = new Set();

  static initialize() {
    if (this._initialized) return;
    this._initialized = true;
    // Chat history is rendered before ready. Register from init so those cards remain tracked.
    Hooks.on("renderChatMessageHTML", (message, element) => {
      this.injectChatButton(message, element);
      setTimeout(() => this.injectChatButton(message, element), 0);
    });
    this._registerSocket();
    Hooks.on("socketlib.ready", () => this._registerSocket());
    Hooks.once("ready", () => this._registerSocket());
    // Midi awaits this hook after saves and resistance calculation, before applying HP/temp HP.
    Hooks.on("midi-qol.preTargetDamageApplication", (token, data) => this._beforeWorkflowDamage(token, data));
    Hooks.on("updateChatMessage", () => this._scheduleChatRefresh());
    for (const hook of ["controlToken", "targetToken", "canvasReady", "updateActor", "createItem", "updateItem",
      "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "updateUser"]) {
      Hooks.on(hook, () => this._scheduleChatRefresh());
    }
    Hooks.on("deleteChatMessage", message => {
      for (const key of this._workflowRequests.keys()) if (key.startsWith(`${message.id}:`)) this._workflowRequests.delete(key);
      for (const key of this._workflowApplications) if (key.startsWith(`${message.id}:`)) this._workflowApplications.delete(key);
      for (const [element, state] of this._chatElements) {
        if (state.message.id !== message.id) continue;
        state.observer.disconnect();
        this._chatElements.delete(element);
      }
    });
  }

  static _registerSocket() {
    if (this._socket || !globalThis.socketlib) return;
    this._socket = socketlib.registerModule(MODULE_ID);
    this._socket?.register("requestShieldBlock", function(payload) {
      return ShieldManager._requestWorkflowBlock(payload, this.socketdata?.userId);
    });
  }

  static async _beforeWorkflowDamage(token, { workflow, damageItem } = {}) {
    const card = game.messages.get(workflow?.chatCard?.id);
    const actor = token?.actor;
    const review = card?.flags?.[MODULE_ID]?.attackReview;
    if (!review || !actor || !damageItem || workflow.hardwipeAttack?.key !== review.attackKey) return;
    // A reviewed target's additional critical dice must be mitigated before its shield choice.
    await workflow.hardwipeCriticalDamage?.apply?.(token, damageItem);
    const automatic = this._workflowAppliesDamage(actor);
    // Remember the mode used by this attack, so changing Midi settings later cannot re-enable overflow.
    const routing = (card.flags?.[MODULE_ID]?.shieldDamageRouting ?? [])
      .filter(entry => entry.targetUuid !== token.document.uuid || entry.attackKey !== review.attackKey);
    routing.push({ targetUuid: token.document.uuid, actorUuid: actor.uuid, attackKey: review.attackKey, automatic });
    try { await card.setFlag(MODULE_ID, "shieldDamageRouting", routing); }
    catch (error) { console.warn(`${MODULE_ID} | Could not record shield damage routing`, error); return; }
    if (!automatic || !this._getEquippedShield(actor)) return;
    const permission = this._attackPermission(card, actor, workflow.hardwipeAttack?.key, { workflow: true, targetUuid: token.document.uuid });
    if (!permission.allowed || !this._hasReaction(actor) || !globalThis.MidiQOL?.modifyDamageBy) return;
    // Calculated details include saves, resistance, immunity and damage reductions. Ignore temp/max HP grants.
    const amount = Math.max(0, Math.floor((damageItem.damageDetail ?? []).reduce((sum, damage) => {
      return ["temphp", "vitality", "maximum", "midi-none"].includes(damage.type) ? sum : sum + (Number(damage.value) || 0);
    }, 0)));
    if (!amount) return;
    const key = this._workflowKey(card.id, permission.attackKey, token.document.uuid);
    if (this._workflowApplications.has(key)) return;
    const preferred = MidiQOL.playerFor?.(token);
    const owner = preferred?.active && actor.testUserPermission(preferred, "OWNER") ? preferred
      : game.users.find(user => user.active && !user.isGM && actor.testUserPermission(user, "OWNER"))
        ?? game.users.activeGM;
    if (!owner?.active) return; // A missing defender never invents a Shield Block.
    const payload = { cardId: card.id, attackKey: permission.attackKey, targetUuid: token.document.uuid, amount };
    let result;
    try {
      if (owner.id === game.user.id) result = await this._requestWorkflowBlock(payload, game.user.id);
      else if (this._socket) result = await this._socket.executeAsUser("requestShieldBlock", owner.id, payload);
    } catch (error) {
      console.warn(`${MODULE_ID} | Shield response unavailable; applying the approved damage normally`, error);
      return;
    }
    if (!result?.absorbed || this._workflowApplications.has(key)
      || !this._attackPermission(card, actor, permission.attackKey, { workflow: true, targetUuid: token.document.uuid }).allowed) return;
    this._workflowApplications.add(key);
    MidiQOL.modifyDamageBy({ damageItem, value: -Math.min(amount, result.absorbed), type: "none", reason: "Shield Block" });
    this._refreshDamageReceipt(actor, damageItem);
    // Bound completed-card bookkeeping without disturbing a live request.
    if (this._workflowApplications.size > 256) this._workflowApplications.delete(this._workflowApplications.values().next().value);
  }

  static _workflowKey(cardId, attackKey, targetUuid) {
    return `${cardId}:${attackKey}:${targetUuid}`;
  }

  static _refreshDamageReceipt(actor, damageItem) {
    const hp = actor.system?.attributes?.hp;
    if (!hp) return;
    // Midi's legacy mode trusts hpDamage, which originally excludes temp HP and caps overkill.
    // Recompute it from the modified details; this also keeps isDamaged hooks accurate in detail mode.
    const totals = (damageItem.damageDetail ?? []).reduce((sum, damage) => {
      const value = Number(damage.value) || 0;
      if (damage.type === "temphp") sum.temp += value;
      else if (damage.type === "maximum") sum.tempMax += value;
      else if (damage.type === "healing" || damage.active?.absorption || damage.active?.type?.absorption) sum.healing += value;
      else if (!["midi-none", "vitality"].includes(damage.type)) sum.damage += value;
      return sum;
    }, { damage: 0, healing: 0, temp: 0, tempMax: 0 });
    const amount = Math.trunc(Math.max(0, totals.damage) + totals.healing);
    const tempMax = Math.trunc(totals.tempMax);
    const oldTemp = Number(hp.temp) || 0;
    const tempDamage = amount > 0 ? Math.min(oldTemp, amount) : 0;
    const hpDamage = clamp(amount - tempDamage, -(Number(hp.damage) || 0) + tempMax, hp.value - tempMax);
    Object.assign(damageItem, {
      hpDamage, tempDamage, newHP: hp.value - hpDamage,
      newTempHP: Math.max(oldTemp - tempDamage, totals.temp),
      healingAdjustedTotalDamage: amount
    });
  }

  static _workflowAppliesDamage(actor) {
    const mode = globalThis.MidiQOL?.configSettings?.()?.autoApplyDamage;
    return ["yes", "yesCard", "yesCardMisses"].includes(mode) || (mode === "yesCardNPC" && actor?.type !== "character");
  }

  static async _requestWorkflowBlock(payload, senderId) {
    const sender = game.users.get(senderId);
    const card = game.messages.get(payload?.cardId);
    const token = foundry.utils.fromUuidSync(payload?.targetUuid ?? "", { strict: false });
    const actor = token?.actor;
    const amount = Number(payload?.amount);
    if (!sender || !card || typeof payload?.attackKey !== "string" || !payload.attackKey
      || (!sender.isGM && card.author?.id !== sender.id) || !actor || !canControlActor(actor)
      || !Number.isFinite(amount) || amount <= 0
      || !this._attackPermission(card, actor, payload.attackKey, { workflow: true, targetUuid: payload.targetUuid }).allowed) return false;
    const key = this._workflowKey(card.id, payload.attackKey, payload.targetUuid);
    if (this._workflowRequests.has(key)) return this._workflowRequests.get(key);
    const pending = this._chooseWorkflowBlock(actor, card, { ...payload, amount });
    this._workflowRequests.set(key, pending);
    try { return await pending; }
    finally {
      if (this._workflowRequests.size > 256) this._workflowRequests.delete(this._workflowRequests.keys().next().value);
    }
  }

  static async _chooseWorkflowBlock(actor, card, payload) {
    if (!this.canBlock(actor)) return false;
    const shield = this.get(actor);
    const absorb = Math.min(shield.hp, payload.amount);
    const accepted = await foundry.applications.api.DialogV2.confirm({
      window: { title: `${actor.name}: Shield Block` },
      content: `<p>${escapeHTML(actor.name)} will take <strong>${payload.amount}</strong> damage after saves and defenses.</p>
        <p>Spend your reaction and <strong>${absorb} shield HP</strong> to absorb that amount?</p>`,
      yes: { label: game.i18n.localize("HARDWIPE.Shield.Block"), icon: "fas fa-shield-halved" },
      no: { label: "Take damage", icon: "fas fa-check" },
      rejectClose: false
    });
    if (!accepted) return false;
    const result = await this.block(actor, [{ value: payload.amount, type: "none" }], {
      originatingMessage: card, origin: card, hardwipeWorkflowShield: true,
      hardwipeShieldAttackKey: payload.attackKey, hardwipeShieldTargetUuid: payload.targetUuid
    });
    // Socket responses carry only the receipt, never Actor/Item Documents.
    return result ? { absorbed: result.absorbed, remaining: result.remaining, hp: result.hp, max: result.max, broken: result.broken } : false;
  }

  static _scheduleChatRefresh() {
    if (this._refreshTimer !== null) return;
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      for (const [element, state] of this._chatElements) {
        if (!element.isConnected) {
          // History cards may render off-DOM before the chat log inserts the batch.
          if (state.connected || Date.now() - state.createdAt > 5000) {
            state.observer.disconnect();
            this._chatElements.delete(element);
          }
          continue;
        }
        state.connected = true;
        this._refreshChatButton(state.message, element);
      }
    }, 0);
  }
  static get api() {
    return {
      get: actorOrItem => ShieldManager.get(actorOrItem),
      repair: actorOrItem => ShieldManager.repair(actorOrItem),
      damage: (item, amount) => ShieldManager.damage(item, amount),
      heal: (item, amount) => ShieldManager.heal(item, amount),
      block: (actor, damages, options) => ShieldManager.block(actor, damages, options),
      canBlock: actor => ShieldManager.canBlock(actor)
    };
  }

  static get(actorOrItem) {
    const item = this._resolveShieldItem(actorOrItem);
    if (!item) return null;
    return this._buildShieldData(item);
  }

  static getDisplay(actorOrItem) {
    if (actorOrItem?.documentName === "Item") return this.get(actorOrItem);
    const actor = resolveActor(actorOrItem);
    const item = actor ? this._getDisplayShield(actor) : this._resolveShieldItem(actorOrItem);
    if (!item) return null;
    return this._buildShieldData(item);
  }

  static canBlock(actorOrItem) {
    const actor = resolveActor(actorOrItem);
    const item = this._getEquippedShield(actor);
    if (!actor || !item || !canControlActor(actor)) return false;

    const state = this._getState(item);
    if (state.broken || state.hp <= 0) return false;
    return this._hasReaction(actor);
  }

  static async repair(actorOrItem) {
    const item = this._resolveShieldItem(actorOrItem, { display: true });
    if (!item || !this._canControlShield(item)) return false;

    return this._queueStateUpdate(item, async () => {
      await this._writeState(item, { hp: DEFAULT_SHIELD_HP, broken: false });
      return true;
    });
  }

  static async damage(itemOrActor, amount) {
    const item = this._resolveShieldItem(itemOrActor, { display: true });
    if (!item || !this._canControlShield(item)) return false;

    return this._queueStateUpdate(item, async () => {
      const state = this._getState(item);
      const hp = clamp(state.hp - Math.max(0, Number(amount) || 0), 0, state.max);
      await this._writeState(item, { ...state, hp, broken: hp <= 0 });
      return true;
    });
  }

  static async heal(itemOrActor, amount = 1) {
    const item = this._resolveShieldItem(itemOrActor, { display: true });
    if (!item || !this._canControlShield(item)) return false;

    return this._queueStateUpdate(item, async () => {
      const state = this._getState(item);
      const hp = clamp(state.hp + Math.max(0, Number(amount) || 0), 0, state.max);
      await this._writeState(item, { ...state, hp, broken: hp <= 0 });
      return true;
    });
  }

  static async _queueStateUpdate(item, operation) {
    // Read HP after the preceding write settles, so rapid edits and Shield Block cannot overwrite each other.
    const previous = this._stateUpdates.get(item.uuid) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(() => this._canControlShield(item) ? operation() : false);
    this._stateUpdates.set(item.uuid, pending);
    try { return await pending; }
    finally { if (this._stateUpdates.get(item.uuid) === pending) this._stateUpdates.delete(item.uuid); }
  }

  static async block(actorOrItem, damages, options = {}) {
    const actor = resolveActor(actorOrItem);
    if (!actor || !canControlActor(actor)) return false;
    if (this._blocking.has(actor.uuid)) return false;
    this._blocking.add(actor.uuid);
    try {
      return await this._block(actor, damages, options);
    } finally {
      this._blocking.delete(actor.uuid);
    }
  }

  static async _block(actor, damages, options) {

    // A cover-only damage roll never reached a character and cannot spend its shield reaction.
    if (this._isWallOnlyDamage(options.originatingMessage ?? options.origin)) return false;
    const permission = this._attackPermission(options.originatingMessage ?? options.origin, actor, options.hardwipeShieldAttackKey,
      { workflow: !!options.hardwipeWorkflowShield, targetUuid: options.hardwipeShieldTargetUuid });
    if (!permission.allowed) return false;
    options = { ...options, hardwipeShieldAttackKey: permission.attackKey };

    const item = this._getEquippedShield(actor);
    if (!item) {
      ui.notifications.warn(game.i18n.localize("HARDWIPE.Shield.None"));
      return false;
    }

    return this._queueStateUpdate(item, () => this._blockWithShield(actor, item, damages, options));
  }

  static async _blockWithShield(actor, item, damages, options) {
    // State can change while another shield HP edit is queued. Read the canonical card again.
    if (!this._attackPermission(options.originatingMessage ?? options.origin, actor, options.hardwipeShieldAttackKey,
      { workflow: !!options.hardwipeWorkflowShield, targetUuid: options.hardwipeShieldTargetUuid }).allowed) return false;
    if (this._getEquippedShield(actor)?.uuid !== item.uuid) {
      ui.notifications.warn(game.i18n.localize("HARDWIPE.Shield.None"));
      return false;
    }

    const state = this._getState(item);
    if (state.broken || state.hp <= 0) {
      ui.notifications.warn(game.i18n.localize("HARDWIPE.Shield.Broken"));
      return false;
    }

    if (!this._hasReaction(actor)) {
      ui.notifications.warn(game.i18n.localize("HARDWIPE.Shield.ReactionSpent"));
      return false;
    }

    let incoming;
    if (options.hardwipeWorkflowShield) incoming = this._normalizeDamages(damages, options);
    else {
      const parts = this._manualDamageParts(actor, damages, options);
      if (!parts) return false;
      const calculated = actor.calculateDamage(parts, { ...options, only: "damage" });
      if (!calculated) return false;
      // Defenses apply once before the shield; only the resulting damage can consume shield HP.
      incoming = [{ value: Math.max(0, Math.trunc(calculated.amount)), type: "none" }];
    }
    const incomingTotal = incoming.reduce((total, damage) => total + Math.max(0, Number(damage.value) || 0), 0);
    if (incomingTotal <= 0) {
      ui.notifications.warn(game.i18n.localize("HARDWIPE.Shield.NoDamage"));
      return false;
    }

    const absorbed = Math.min(state.hp, incomingTotal);
    const remainingDamages = this._subtractAbsorbedDamage(incoming, absorbed);
    const remaining = remainingDamages.reduce((total, damage) => total + Math.max(0, Number(damage.value) || 0), 0);

    if (!await this._consumeReaction(actor)) {
      ui.notifications.warn(game.i18n.localize("HARDWIPE.Shield.ReactionUnavailable"));
      return false;
    }

    await this._writeState(item, {
      ...state,
      hp: state.hp - absorbed,
      broken: state.hp - absorbed <= 0
    });

    if (remaining > 0 && !options.hardwipeWorkflowShield) {
      const applyOptions = { ...options, multiplier: 1, ignore: true, invertHealing: false, only: "damage", hardwipeShieldBlock: true };
      await actor.applyDamage(remainingDamages, applyOptions);
    }

    const updated = this._getState(item);
    await this._postBlockCard({ actor, item, absorbed, remaining, state: updated });
    item.sheet?.render({ force: false });
    actor.sheet?.render({ force: false });
    return {
      actor,
      item,
      absorbed,
      remaining,
      hp: updated.hp,
      max: updated.max,
      broken: updated.broken
    };
  }

  static injectChatButton(message, element) {
    if (!element || !message.isContentVisible || !this._messageHasDamage(message, element)) return;
    if (!this._chatElements.has(element)) {
      // Native damage trays rebuild their target list independently of the chat render hook.
      const observer = new element.ownerDocument.defaultView.MutationObserver(() => this._scheduleChatRefresh());
      observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-checked"] });
      this._chatElements.set(element, { message, observer, connected: element.isConnected, createdAt: Date.now() });
      setTimeout(() => this._scheduleChatRefresh(), 5100);
    }
    this._refreshChatButton(message, element);
  }

  static _refreshChatButton(message, element) {
    if (!message.isContentVisible || this._isWallOnlyDamage(message) || !this._messageHasDamage(message, element)) {
      element.querySelectorAll(".hardwipe-shield-block-row, [data-hardwipe-shield-block]").forEach(node => node.remove());
      return;
    }

    const nativeApplication = element.querySelector("damage-application");
    if (nativeApplication) {
      // A card with the native tray has one target source and one Shield Block control.
      element.querySelectorAll(".hardwipe-shield-block-row").forEach(node => node.remove());
      this._injectNativeButton(message, element, nativeApplication);
      return;
    }

    const rsrButtons = element.querySelector(".rsr-damage-buttons-xl");
    if (rsrButtons) this._injectRSRButton(message, element, rsrButtons);
  }

  static async _onNativeBlock(message, damageApplication) {
    if (this._isWallOnlyDamage(message)) return;
    const candidates = this._getNativeCandidates(damageApplication)
      .filter(candidate => this._attackPermission(message, candidate.actor, null, { targetUuid: candidate.options?.hardwipeShieldTargetUuid }).allowed);
    const candidate = await this._chooseCandidate(candidates);
    if (!candidate) return;
    await this.block(candidate.actor, candidate.damages, {
      ...candidate.options,
      isDelta: true,
      origin: message,
      originatingMessage: message
    });
  }

  static async _onRSRBlock(message) {
    if (this._isWallOnlyDamage(message)) return;
    const damages = this._getMessageDamages(message);
    const candidates = this._getCurrentCandidates().filter(candidate => this._attackPermission(message, candidate.actor, null,
      { targetUuid: candidate.options?.hardwipeShieldTargetUuid }).allowed)
      .map(candidate => ({ ...candidate, damages }));
    const candidate = await this._chooseCandidate(candidates);
    if (!candidate) return;
    await this.block(candidate.actor, candidate.damages, {
      ...candidate.options,
      multiplier: 1,
      originatingMessage: message,
      origin: message
    });
  }

  static _injectNativeButton(message, element, damageApplication) {
    const wrapper = damageApplication.querySelector?.(".wrapper") ?? element.querySelector("damage-application .wrapper");
    if (!wrapper) return;
    const candidates = this._getNativeCandidates(damageApplication, { available: false });
    let button = wrapper.querySelector("[data-hardwipe-shield-block]");
    if (!candidates.length) { button?.remove(); return; }
    if (button) { this._updateButton(button, candidates, message); return; }

    button = this._buildButton(element.ownerDocument);
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      void this._onNativeBlock(message, damageApplication);
    });
    wrapper.appendChild(button);
    this._updateButton(button, candidates, message);
  }

  static _injectRSRButton(message, element, rsrButtons) {
    const damageResult = rsrButtons.closest(".dice-result") ?? rsrButtons.parentElement;
    if (!damageResult) return;
    const candidates = this._getCurrentCandidates({ available: false });
    const existing = damageResult.querySelector(".hardwipe-shield-block-row");
    if (!candidates.length) { existing?.remove(); return; }
    if (existing) {
      this._updateButton(existing.querySelector("[data-hardwipe-shield-block]"), candidates, message);
      return;
    }
    if (damageResult.querySelector("[data-hardwipe-shield-block]")) return;

    const row = element.ownerDocument.createElement("div");
    row.className = "hardwipe-shield-block-row";
    if (rsrButtons.style.display === "none") {
      row.classList.add("hardwipe-shield-block-row-hover");
      row.style.display = "none";
    }
    const button = this._buildButton(element.ownerDocument);
    button.classList.add("hardwipe-shield-block-rsr");
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      void this._onRSRBlock(message);
    });
    row.appendChild(button);
    rsrButtons.insertAdjacentElement("afterend", row);
    this._updateButton(button, candidates, message);
  }

  static _buildButton(ownerDocument = document) {
    const button = ownerDocument.createElement("button");
    button.type = "button";
    button.className = "hardwipe-btn is-primary hardwipe-shield-block-button";
    button.dataset.hardwipeShieldBlock = "true";
    button.title = game.i18n.localize("HARDWIPE.Shield.Block");
    button.innerHTML = `<i class="fas fa-shield-halved" inert></i><span>${escapeHTML(game.i18n.localize("HARDWIPE.Shield.Block"))}</span>`;
    return button;
  }

  static _updateButton(button, candidates, message) {
    const permitted = candidates.filter(candidate => this._attackPermission(message, candidate.actor, null,
      { targetUuid: candidate.options?.hardwipeShieldTargetUuid }).allowed);
    const available = permitted.some(candidate => this.canBlock(candidate.actor));
    button.disabled = !available;
    button.ariaDisabled = String(!available);
    if (!permitted.length) {
      button.title = this._attackPermission(message, candidates[0]?.actor, null,
        { targetUuid: candidates[0]?.options?.hardwipeShieldTargetUuid }).reason;
      return;
    }
    const broken = candidates.every(candidate => this.get(candidate.actor)?.broken);
    button.title = game.i18n.localize(available ? "HARDWIPE.Shield.Block" : broken
      ? "HARDWIPE.Shield.Broken" : "HARDWIPE.Shield.ReactionSpent");
  }

  static _getNativeCandidates(damageApplication, { available = true } = {}) {
    const damages = this._normalizeDamages(damageApplication?.damages ?? []);
    const targetList = damageApplication?.targetList;
    const mode = targetList?.targetingMode;
    // Respect the native source even while the tray's recorded-targets element is suspended.
    const uuids = mode === "selected" ? (canvas?.tokens?.controlled ?? []).map(token => token.document.uuid)
      : mode === "targeted" ? (damageApplication.chatMessage?.system?.targets ?? []).map(descriptor => {
        const { actor, token } = dnd5e.dataModels.chatMessage.fields.TargetsField.resolve(descriptor);
        return token?.document.uuid ?? actor?.uuid;
      }).filter(Boolean) : [];
    const candidates = [];
    const seen = new Set();

    for (const uuid of uuids) {
      if (seen.has(uuid) || targetList?.targetChecked?.(uuid) === false) continue;
      seen.add(uuid);
      const token = foundry.utils.fromUuidSync(uuid, { strict: false });
      const actor = token?.actor ?? token;
      if (!canControlActor(actor) || !this._getEquippedShield(actor) || (available && !this.canBlock(actor))) continue;
      candidates.push({
        actor,
        damages,
        options: { ...(damageApplication.getMergedOptions?.(uuid) ?? damageApplication.getTargetOptions?.(uuid) ?? {}), hardwipeShieldTargetUuid: uuid },
        label: actor.name
      });
    }

    return candidates;
  }

  static _getCurrentCandidates({ available = true, tokens = null } = {}) {
    const seen = new Set();
    tokens ??= [
      ...(canvas?.tokens?.controlled ?? []),
      ...(game.user?.targets ? Array.from(game.user.targets) : [])
    ];

    const candidates = [];
    for (const token of tokens) {
      const actor = token?.actor;
      if (!actor || seen.has(actor.uuid) || !canControlActor(actor) || !this._getEquippedShield(actor)
        || (available && !this.canBlock(actor))) continue;
      seen.add(actor.uuid);
      candidates.push({ actor, label: token.name ?? actor.name, options: { hardwipeShieldTargetUuid: token.document.uuid } });
    }
    return candidates;
  }

  static async _chooseCandidate(candidates) {
    const valid = candidates.filter(candidate => candidate.actor && candidate.damages?.length);
    if (!valid.length) {
      ui.notifications.warn(game.i18n.localize("HARDWIPE.Shield.NoTarget"));
      return null;
    }
    if (valid.length === 1) return valid[0];

    const result = await foundry.applications.api.DialogV2.input({
      window: { title: game.i18n.localize("HARDWIPE.Shield.PickTarget") },
      content: `
        ${valid.map((candidate, index) => `
          <label>
            <input type="radio" name="hardwipeShieldTarget" value="${index}" ${index === 0 ? "checked" : ""}>
            <span>${escapeHTML(candidate.label ?? candidate.actor.name)}</span>
          </label>
        `).join("")}
      `,
      ok: {
        icon: "fa-solid fa-shield-halved",
        label: game.i18n.localize("HARDWIPE.Shield.Block")
      },
      rejectClose: false
    });
    if (!result) return null;
    return valid[Number(result.hardwipeShieldTarget)] ?? valid[0];
  }

  static _messageHasDamage(message, element) {
    if (message.flags?.[RSR_MODULE_ID]?.isHealing) return false;
    const rollType = typeof message.type === "string" ? message.type
      : foundry.utils.getProperty(message.flags?.dnd5e, "roll.type");
    if (rollType === "healing") return false;
    if (element.querySelector("damage-application, .rsr-damage")) return true;
    if (rollType === "damage") return true;
    return !!message.flags?.[RSR_MODULE_ID]?.renderDamage;
  }

  static _isWallOnlyDamage(message) {
    if (message?.flags?.[MODULE_ID]?.coverAttack?.mode === "direct") return true;
    const impacts = message?.flags?.[MODULE_ID]?.coverAttack?.records;
    const resolved = message?.flags?.["midi-qol"]?.resolvedTargetACs;
    return Boolean(impacts?.length && Array.isArray(resolved) && resolved.length
      && !resolved.some(target => target.isHit || target.isHitEC));
  }

  /** Approval belongs to the stored attack and this exact target, never a rendered card snapshot. */
  static _attackPermission(message, actor, expectedKey, { workflow = false, targetUuid = null } = {}) {
    if (!message) return { allowed: true };
    const canonical = message.id ? game.messages.get(message.id) : message;
    const snapshot = message.flags?.[MODULE_ID]?.attackReview;
    if (!canonical) return snapshot ? { allowed: false, reason: "This attack card is no longer available." } : { allowed: true };
    const review = canonical.flags?.[MODULE_ID]?.attackReview;
    if (!review) return snapshot ? { allowed: false, reason: "This attack review is no longer current." } : { allowed: true };
    if (review.unavailable) return { allowed: false, reason: game.i18n.localize("HARDWIPE.Attack.ReviewUnavailable") };
    if (review.status !== "resolved") return { allowed: false, reason: game.i18n.localize("HARDWIPE.Attack.ApplyPending") };
    if ((snapshot?.attackKey && snapshot.attackKey !== review.attackKey) || (expectedKey && expectedKey !== review.attackKey)) {
      return { allowed: false, reason: "This attack review is no longer current." };
    }
    const hit = (review.targets ?? []).some(target => {
      if (targetUuid && target.uuid !== targetUuid) return false;
      if (!["hit", "critical"].includes(target.outcome)) return false;
      const document = foundry.utils.fromUuidSync(target.uuid, { strict: false });
      return document?.actor?.uuid === actor?.uuid || document?.uuid === actor?.uuid;
    });
    const route = canonical.flags?.[MODULE_ID]?.shieldDamageRouting?.find(entry => entry.attackKey === review.attackKey
      && (targetUuid ? entry.targetUuid === targetUuid : entry.actorUuid === actor?.uuid));
    const automatic = review.application === "gm" || (review.application === "workflow" && (route?.automatic ?? this._workflowAppliesDamage(actor)));
    if (hit && automatic && !workflow) {
      return { allowed: false, reason: "Shield Block is offered before this attack applies damage." };
    }
    return hit ? { allowed: true, attackKey: review.attackKey } : { allowed: false, reason: "This attack did not hit this character." };
  }

  static _getMessageDamages(message) {
    const rolls = getMessageRolls(message).filter(isDamageRoll);
    if (!rolls.length) return [];

    const damages = [];
    for (const roll of rolls) {
      const chunks = this._getDamageChunks(roll);
      if (chunks.length <= 1) {
        damages.push({
          value: Math.max(0, Number(roll.total) || 0),
          type: roll.options?.type,
          properties: toPropertySet(roll.options?.properties)
        });
      } else {
        damages.push(...chunks);
      }
    }
    return damages;
  }

  static _getDamageChunks(roll) {
    const OperatorTerm = foundry.dice?.terms?.OperatorTerm;
    if (!OperatorTerm || !Array.isArray(roll.terms)) return [];

    const chunks = [];
    let currentType = null;
    let total = 0;
    let sign = 1;
    let hasTerms = false;

    const pushChunk = () => {
      if (!hasTerms) return;
      chunks.push({
        value: Math.max(0, total),
        type: currentType ?? roll.options?.type,
        properties: toPropertySet(roll.options?.properties)
      });
      currentType = null;
      total = 0;
      sign = 1;
      hasTerms = false;
    };

    for (const term of roll.terms) {
      if (term instanceof OperatorTerm && ["+", "-"].includes(term.operator)) {
        pushChunk();
        sign = term.operator === "-" ? -1 : 1;
        continue;
      }

      const value = Number(term.total);
      if (!Number.isFinite(value)) continue;

      const flavor = String(term.flavor ?? "").toLowerCase().trim();
      if (!currentType && isDamageType(flavor)) currentType = flavor;

      total += value * sign;
      hasTerms = true;
    }

    pushChunk();
    return chunks.length ? chunks : [];
  }

  static _normalizeDamages(damages, options = {}) {
    const rawMultiplier = Number(options.multiplier ?? 1);
    const multiplier = Number.isFinite(rawMultiplier) ? Math.abs(rawMultiplier) : 1;
    const list = typeof damages === "number" || typeof damages === "string"
      ? [{ value: damages }]
      : Array.from(damages ?? []);

    return list.map(damage => ({
      value: Math.max(0, Math.trunc((Number(damage.value) || 0) * multiplier)),
      type: damage.type,
      properties: toPropertySet(damage.properties)
    })).filter(damage => damage.value > 0 && !isHealingType(damage.type));
  }

  static _manualDamageParts(actor, damages, options) {
    const message = options.originatingMessage ?? options.origin;
    const canonical = message?.id ? game.messages.get(message.id) : message;
    const review = canonical?.flags?.[MODULE_ID]?.attackReview;
    const matches = (review?.targets ?? []).filter(target => {
      if (options.hardwipeShieldTargetUuid) return target.uuid === options.hardwipeShieldTargetUuid;
      const document = foundry.utils.fromUuidSync(target.uuid, { strict: false });
      return document?.actor?.uuid === actor.uuid || document?.uuid === actor.uuid;
    });
    if (matches.length > 1 && matches.some(target => target.critBonusDetail?.length)) {
      ui.notifications.warn("Choose the exact target token to block this critical attack.");
      return false;
    }
    const extra = matches.length === 1 && matches[0].outcome === "critical" ? matches[0].critBonusDetail ?? [] : [];
    const raw = typeof damages === "number" || typeof damages === "string" ? [{ value: damages }] : Array.from(damages ?? []);
    return aggregateCriticalDamage([...raw, ...extra].map(damage => ({
      value: Math.max(0, Number(damage.value) || 0), type: damage.type, properties: toPropertySet(damage.properties)
    })).filter(damage => damage.value > 0 && !isHealingType(damage.type)));
  }

  static _subtractAbsorbedDamage(damages, absorbed) {
    let remainingAbsorption = absorbed;
    const out = [];

    for (const damage of damages) {
      const value = Math.max(0, Number(damage.value) || 0);
      const used = Math.min(value, remainingAbsorption);
      remainingAbsorption -= used;
      const remaining = value - used;
      if (remaining <= 0) continue;
      out.push({ ...damage, value: remaining });
    }

    return out;
  }

  static _resolveShieldItem(actorOrItem, { display = false } = {}) {
    if (!actorOrItem) return null;
    if (actorOrItem.documentName === "Item") return this._isShieldItem(actorOrItem) ? actorOrItem : null;

    const actor = resolveActor(actorOrItem);
    if (!actor) return null;
    return display ? this._getDisplayShield(actor) : this._getEquippedShield(actor);
  }

  static _getDisplayShield(actor) {
    return this._getEquippedShield(actor)
      ?? actor?.items?.find(item => this._isShieldItem(item) && item.getFlag(MODULE_ID, SHIELD_FLAG));
  }

  static _getEquippedShield(actor) {
    if (!actor) return null;
    if (this._isShieldItem(actor.shield) && actor.shield.system?.equipped) return actor.shield;
    return actor.items?.find(item => this._isShieldItem(item) && item.system?.equipped) ?? null;
  }

  static _isShieldItem(item) {
    return item?.documentName === "Item"
      && item.type === "equipment"
      && item.system?.type?.value === "shield";
  }

  static _canControlShield(item) {
    return game.user.isGM || item?.isOwner || canControlActor(item?.actor);
  }

  static _buildShieldData(item) {
    const state = this._getState(item);
    return {
      item,
      name: item.name,
      hp: state.hp,
      max: state.max,
      broken: state.broken,
      equipped: !!item.system?.equipped,
      percent: state.max ? Math.round((state.hp / state.max) * 100) : 0
    };
  }

  static _getState(item) {
    const raw = item?.getFlag(MODULE_ID, SHIELD_FLAG) ?? {};
    const max = DEFAULT_SHIELD_HP;
    const hp = clamp(Number(raw.hp ?? max) || 0, 0, max);
    return {
      hp,
      max,
      broken: Boolean(raw.broken) || hp <= 0,
      updatedAt: Number(raw.updatedAt) || null,
      updatedBy: raw.updatedBy ?? null
    };
  }

  static async _writeState(item, state) {
    const next = this._makeState({
      hp: clamp(Number(state.hp) || 0, 0, DEFAULT_SHIELD_HP),
      max: DEFAULT_SHIELD_HP,
      broken: Boolean(state.broken) || Number(state.hp) <= 0
    });
    const updates = {
      [`flags.${MODULE_ID}.${SHIELD_FLAG}`]: next
    };
    if (next.broken && item.system?.equipped) updates["system.equipped"] = false;
    await item.update(updates);
  }

  static _makeState({ hp, max = DEFAULT_SHIELD_HP, broken = false }) {
    return {
      hp: clamp(Number(hp) || 0, 0, DEFAULT_SHIELD_HP),
      max: DEFAULT_SHIELD_HP,
      broken: Boolean(broken),
      updatedAt: Date.now(),
      updatedBy: game.user.id
    };
  }

  static _hasReaction(actor) {
    return !!globalThis.MidiQOL?.hasUsedReaction && !MidiQOL.hasUsedReaction(actor);
  }

  static async _consumeReaction(actor) {
    if (!this._hasReaction(actor) || !globalThis.MidiQOL?.setReactionUsed) return false;
    const before = Number(actor.flags?.["midi-qol"]?.actions?.reactionsUsed ?? 0);
    await MidiQOL.setReactionUsed(actor, true, { force: true });
    return Number(actor.flags?.["midi-qol"]?.actions?.reactionsUsed ?? 0) > before;
  }


  static async _postBlockCard({ actor, item, absorbed, remaining, state }) {
    const subtitle = game.i18n.format("HARDWIPE.Shield.BlockSubtitle", { absorbed, remaining });
    const meta = state.broken
      ? game.i18n.format("HARDWIPE.Shield.BlockBrokenMeta", { shield: item.name })
      : game.i18n.format("HARDWIPE.Shield.BlockMeta", { shield: item.name, hp: state.hp, max: state.max });
    const safeTitle = escapeHTML(game.i18n.localize("HARDWIPE.Shield.Block"));

    return ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `
        <div class="hardwipe-chat-card hardwipe-shield-card ${state.broken ? "hardwipe-card-danger" : ""}">
          <div class="hardwipe-chat-kicker">${escapeHTML(game.i18n.localize("HARDWIPE.Shield.Reaction"))}</div>
          <div class="hardwipe-chat-title" data-text="${safeTitle}">${safeTitle}</div>
          <div class="hardwipe-chat-subtitle">${escapeHTML(subtitle)}</div>
          <div class="hardwipe-chat-meta">${escapeHTML(meta)}</div>
        </div>
      `,
      flags: {
        [MODULE_ID]: {
          type: "shield-block",
          actorId: actor.id,
          itemId: item.id,
          absorbed,
          remaining,
          hp: state.hp,
          max: state.max,
          broken: state.broken
        }
      }
    });
  }
}

function getMessageRolls(message) {
  const flagRolls = message.flags?.[RSR_MODULE_ID]?.rolls;
  const rolls = Array.isArray(flagRolls) && flagRolls.length ? flagRolls : message.rolls ?? [];
  return Array.from(rolls).map(hydrateRoll).filter(Boolean);
}

function hydrateRoll(rollData) {
  if (!rollData) return null;
  if (rollData instanceof Roll) return rollData;
  const RollClass = CONFIG.Dice?.[rollData.class] ?? Roll;
  try {
    return RollClass.fromData(rollData);
  } catch (_err) {
    return Roll.fromData(rollData);
  }
}

function isDamageRoll(roll) {
  return roll instanceof CONFIG.Dice.DamageRoll || roll.class === "DamageRoll" || roll.constructor?.name === "DamageRoll";
}

function isDamageType(type) {
  return !!type && !!CONFIG.DND5E.damageTypes?.[type];
}

function isHealingType(type) {
  return !!type && !!CONFIG.DND5E.healingTypes?.[type];
}

function toPropertySet(properties) {
  if (properties instanceof Set) return new Set(properties);
  if (Array.isArray(properties)) return new Set(properties);
  return new Set();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
