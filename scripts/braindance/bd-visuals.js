/**
 * Braindance screen and sheet decoration.
 *
 * The overlay is decoration only: inert, aria-hidden and never in the way of a click. The one interactive
 * piece is the participant's deck (editing layer and Scan), a separate element. Sheets get a frame-only
 * treatment that never moves or covers their controls.
 */
import {
  PRESETS, CUES, LAYERS, normalizeState, normalizePreferences, isParticipant, currentCue, currentReplay,
  elapsedLabel, durationLabel, sheetMatches, timelinePositions
} from "./bd-state.js";

export class BraindanceVisuals {
  /**
   * @param {object} deps
   * @param {Function} deps.getUser, deps.getUsers, deps.getPreferences
   * @param {Function} deps.t              (key, data) -> HARDWIPE.Braindance.<key> text
   * @param {Function} [deps.onLayer]      layer key -> void (participant picked a layer)
   * @param {Function} [deps.onScan]       () -> void (participant pressed Scan)
   * @param {Function} [deps.scanning]     () -> boolean (scan mode is armed)
   */
  constructor({ getUser, getUsers, getPreferences, t, onLayer = () => {}, onScan = () => {}, scanning = () => false, now = Date.now, document: doc = document }) {
    Object.assign(this, { getUser, getUsers, getPreferences, t, onLayer, onScan, scanning, now, document: doc });
    this.state = normalizeState();
    this.sheets = new Map();
    this.root = null;
    this.deck = null;
    this.interval = null;
    this.transitionTimer = null;
    this.replayId = null;
    this.timelineStamp = "";
    this.motionQuery = doc.defaultView.matchMedia("(prefers-reduced-motion: reduce)");
    this.motionListener = () => this.apply(this.state);
    this.motionQuery.addEventListener("change", this.motionListener);
    this.resizeListener = () => this.anchor();
    doc.defaultView.addEventListener("resize", this.resizeListener);
  }

  /** Keep the HUD, timeline and deck at the top right of the canvas, clear of the sidebar and the Heat HUD. */
  anchor() {
    const view = this.document.defaultView;
    const sidebar = this.document.getElementById("sidebar")?.getBoundingClientRect();
    const right = Math.max(16, (sidebar?.width ? view.innerWidth - sidebar.left : 0) + 16);
    for (const element of [this.root, this.deck]) element?.style.setProperty("--bd-right", `${Math.round(right)}px`);
  }

  apply(raw) {
    const previousId = this.visible ? this.state.id : null;
    this.state = normalizeState(raw);
    this.preferences = normalizePreferences(this.getPreferences());
    this.amount = this.state.intensity / 100 * this.preferences.intensity / 100;
    this.participant = isParticipant(this.state, this.getUser(), this.preferences);
    this.visible = this.participant && this.preferences.enabled && this.amount > 0;
    this.still = this.preferences.reduceMotion || this.motionQuery.matches;
    if (this.visible) {
      const entering = previousId !== this.state.id;
      this.mount();
      this.root.classList.toggle("bd-still", this.still);
      this.root.dataset.preset = this.state.preset;
      this.root.style.setProperty("--bd-amount", this.amount);
      this.nodes.name.textContent = this.state.label;
      this.timelineStamp = "";
      if (entering) this.transition(this.t("Overlay.Linked"));
    } else this.unmount();
    this.renderDeck();
    if ((this.visible || this.deck) && !this.interval) this.interval = setInterval(() => this.tick(), 250);
    if (!this.visible && !this.deck) { clearInterval(this.interval); this.interval = null; }
    for (const [key, entry] of this.sheets) {
      if (!entry.element.isConnected) { this.clearSheet(entry.element); this.sheets.delete(key); }
      else this.styleSheet(entry);
    }
    this.tick();
  }

  mount() {
    if (this.root?.isConnected) return;
    const root = this.document.createElement("div");
    root.id = "hardwipe-braindance-overlay";
    root.className = "bd-overlay";
    root.setAttribute("aria-hidden", "true");
    root.inert = true;
    root.innerHTML = `<div class="bd-wash"></div><div class="bd-scanlines"></div><div class="bd-layer-tint"></div>
      <div class="bd-edge"></div><div class="bd-tear"></div><div class="bd-rewind"></div>
      <div class="bd-hud"><span class="bd-live-dot"></span><span class="bd-hud-tag">BD // ${this.escape(this.t("Overlay.Tag"))}</span>
        <span class="bd-divider">/</span><strong class="bd-memory-name"></strong>
        <time class="bd-time">00:00:00</time><span class="bd-layer-name"></span><span class="bd-signal"></span></div>
      <div class="bd-timeline"><div class="bd-timeline-track"></div><div class="bd-timeline-head"></div></div>
      <div class="bd-cue-label"></div><div class="bd-replay-label"></div><div class="bd-transition"></div>
      <div class="bd-corner bd-corner-left"></div><div class="bd-corner bd-corner-right"></div>`;
    this.document.body.append(root);
    this.root = root;
    // Looked up once: tick() writes to these four times a second.
    const node = selector => root.querySelector(selector);
    this.nodes = { name: node(".bd-memory-name"), time: node(".bd-time"), layer: node(".bd-layer-name"), signal: node(".bd-signal"),
      cue: node(".bd-cue-label"), replay: node(".bd-replay-label"), transition: node(".bd-transition"),
      track: node(".bd-timeline-track"), head: node(".bd-timeline-head") };
    this.anchor();
  }

  /** The participant's deck: three editing layers and Scan. Shown even with visuals switched off locally. */
  renderDeck() {
    if (!this.participant) { this.deck?.remove(); this.deck = null; return; }
    if (!this.deck?.isConnected) {
      const deck = this.document.createElement("nav");
      deck.id = "hardwipe-braindance-deck";
      deck.className = "bd-deck";
      deck.setAttribute("aria-label", this.t("Deck.Label"));
      deck.innerHTML = `${Object.entries(LAYERS).map(([key, layer]) => `<button type="button" data-bd-layer="${key}" style="--bd-layer:${layer.color}"
          aria-pressed="false" data-tooltip="${this.escape(this.t(`Layer.${key}Hint`))}"><span aria-hidden="true">${layer.symbol}</span>${this.escape(this.t(`Layer.${key}`))}</button>`).join("")}
        <button type="button" class="bd-deck-scan" data-bd-scan aria-pressed="false" data-tooltip="${this.escape(this.t("Deck.ScanHint"))}">
          <i class="fa-solid fa-crosshairs" aria-hidden="true"></i>${this.escape(this.t("Deck.Scan"))}</button>`;
      deck.addEventListener("click", event => {
        const button = event.target.closest("button");
        if (!button) return;
        if (button.dataset.bdLayer) this.onLayer(button.dataset.bdLayer);
        else if (button.hasAttribute("data-bd-scan")) this.onScan();
      });
      this.document.body.append(deck);
      this.deck = deck;
      this.anchor();
    }
    for (const button of this.deck.querySelectorAll("[data-bd-layer]")) button.setAttribute("aria-pressed", String(button.dataset.bdLayer === this.preferences.layer));
    this.deck.querySelector("[data-bd-scan]").setAttribute("aria-pressed", String(Boolean(this.scanning())));
  }

  transition(label) {
    if (!this.root) return;
    clearTimeout(this.transitionTimer);
    const node = this.nodes.transition;
    node.textContent = label;
    node.classList.add("bd-transition-visible");
    this.transitionTimer = setTimeout(() => node.classList.remove("bd-transition-visible"), 1900);
  }

  tick() {
    if (this.deck) this.deck.querySelector("[data-bd-scan]")?.setAttribute("aria-pressed", String(Boolean(this.scanning())));
    if (!this.visible || !this.root) return;
    const now = this.now();
    const cue = currentCue(this.state, now);
    const replay = currentReplay(this.state, now);
    // A replay shows the memory as it was at the marked moment: that mood and that echo.
    const preset = PRESETS[replay?.marker.preset ?? this.state.preset];
    const cueKind = replay ? replay.marker.cue : cue?.kind;
    const color = (cueKind ? CUES[cueKind].color : null) ?? preset.color;
    const layer = this.preferences.layer;
    this.root.dataset.cue = cueKind ?? "";
    this.root.dataset.layer = layer;
    this.root.dataset.replay = replay ? "1" : "";
    this.root.style.setProperty("--bd-color", color);
    this.root.style.setProperty("--bd-layer", LAYERS[layer].color);
    this.nodes.time.textContent = replay ? durationLabel(replay.marker.at) : elapsedLabel(this.state.startedAt, now);
    this.nodes.layer.textContent = `${LAYERS[layer].symbol} ${this.t(`Layer.${layer}`)}`;
    this.nodes.signal.textContent = `SIG ${cue ? Math.max(38, preset.signal - 22) : preset.signal}%`;
    this.nodes.cue.textContent = cue && !replay
      ? `${this.t(`Cue.${cue.kind}Status`)} / ${Math.ceil((cue.endsAt - now) / 1000)}s${cue.mechanics ? ` · ${this.t("Overlay.Mechanics")}` : ""}` : "";
    this.nodes.replay.textContent = replay ? `${this.t("Overlay.Replay")} // ${durationLabel(replay.marker.at)}${replay.marker.label ? ` // ${replay.marker.label}` : ""}` : "";
    if (replay && replay.id !== this.replayId) this.transition(this.t("Overlay.Rewind"));
    this.replayId = replay?.id ?? null;
    this.renderTimeline(now, replay);
    for (const [key, entry] of this.sheets) {
      if (!entry.element.isConnected) { this.clearSheet(entry.element); this.sheets.delete(key); continue; }
      if (!entry.element.classList.contains("bd-sheet")) continue;
      entry.element.style.setProperty("--bd-color", color);
      entry.element.dataset.bdCue = cueKind ?? "";
      const badge = entry.element.querySelector(":scope > .bd-sheet-layer .bd-sheet-status");
      if (badge) badge.textContent = `BD // ${cueKind ? this.t(`Cue.${cueKind}Status`) : this.t("Overlay.SheetActive")}`;
    }
  }

  /** Marker ticks along the elapsed memory; rebuilt once a second at most. */
  renderTimeline(now, replay) {
    const { track, head } = this.nodes;
    const positions = timelinePositions(this.state, now);
    const stamp = `${Math.floor(now / 1000)}|${this.state.markers.length}|${replay?.markerId ?? ""}`;
    if (stamp === this.timelineStamp) return;
    this.timelineStamp = stamp;
    // The sidebar can collapse or finish rendering after the overlay mounts; follow it once a second.
    this.anchor();
    track.replaceChildren(...positions.map(entry => {
      const tick = this.document.createElement("span");
      tick.className = `bd-tick bd-tick-${entry.kind}${replay?.markerId === entry.id ? " is-replaying" : ""}`;
      tick.style.left = `${(entry.position * 100).toFixed(2)}%`;
      return tick;
    }));
    const span = Math.max(1, now - this.state.startedAt, ...this.state.markers.map(marker => marker.at));
    head.style.left = `${((replay ? replay.marker.at / span : 1) * 100).toFixed(2)}%`;
  }

  trackSheet(key, actor, element) {
    if (!element?.classList || !actor) return;
    const old = this.sheets.get(key);
    if (old && old.element !== element) this.clearSheet(old.element);
    const entry = { actor, element };
    this.sheets.set(key, entry);
    this.styleSheet(entry);
    this.tick();
  }

  untrackSheet(key) {
    const entry = this.sheets.get(key);
    if (entry) this.clearSheet(entry.element);
    this.sheets.delete(key);
  }

  styleSheet({ actor, element }) {
    const show = this.visible && this.state.sheetGlitch && this.preferences.sheetGlitch && sheetMatches(actor, this.state, this.getUsers());
    if (!show) return this.clearSheet(element);
    element.classList.add("bd-sheet");
    element.classList.toggle("bd-still", this.still);
    element.style.setProperty("--bd-amount", this.amount);
    element.style.setProperty("--bd-color", PRESETS[this.state.preset].color);
    if (!element.querySelector(":scope > .bd-sheet-layer")) {
      const layer = this.document.createElement("div");
      layer.className = "bd-sheet-layer";
      layer.setAttribute("aria-hidden", "true");
      layer.inert = true;
      layer.innerHTML = `<div class="bd-sheet-scanlines"></div><div class="bd-sheet-tear"></div><span class="bd-sheet-status">BD // ${this.escape(this.t("Overlay.SheetActive"))}</span>`;
      element.append(layer);
    }
  }

  clearSheet(element) {
    element.classList.remove("bd-sheet", "bd-still");
    delete element.dataset.bdCue;
    element.style.removeProperty("--bd-amount");
    element.style.removeProperty("--bd-color");
    element.querySelector(":scope > .bd-sheet-layer")?.remove();
  }

  unmount() {
    clearTimeout(this.transitionTimer);
    this.transitionTimer = null;
    this.replayId = null;
    this.root?.remove();
    this.root = null;
    this.nodes = null;
  }

  destroy() {
    this.unmount();
    clearInterval(this.interval);
    this.interval = null;
    this.deck?.remove();
    this.deck = null;
    for (const { element } of this.sheets.values()) this.clearSheet(element);
    this.sheets.clear();
    this.motionQuery.removeEventListener("change", this.motionListener);
    this.document.defaultView.removeEventListener("resize", this.resizeListener);
  }

  escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }
}
