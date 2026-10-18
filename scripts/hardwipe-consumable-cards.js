import { escapeHTML } from "./hardwipe-state.js";
import { arrivalWindow } from "./hardwipe-attack-cards.js";
import { durationRing, effectRows } from "./hardwipe-effects.js";

/**
 * Consumables: one card instead of three blocks. Under the item bar (doses as vials) and its name, a scope shows
 * what the consumable did, drawn by what kind it is:
 *   heal       a vitals trace; the readout is the healing roll
 *   damage     a blast radius with the targets pinned in it; the readout is the damage roll
 *   condition  a save that applies an effect: the blast, the condition named in the readout
 *   buff       an effect with no roll: a countdown ring as long as the effect lasts, the effect named in the readout
 *   utility    nothing to roll or apply: the deployed area, dim
 * The roll stays the roll: Hardwipe's own total button (it opens the dice drawer), apply row and save block are moved
 * in, not redrawn, so their handlers, Ready Set Midi's retro buttons and the GM review keep working. The drawing never
 * takes the pointer. Targets and what happened to them are always written out as rows under the scope.
 */
const ARRIVAL_MS = 1600;

/** What kind of payload an activity carries. Pure: tested without Foundry. */
export function consumableKind({ type, damageParts = 0, effects = 0 }) {
  if (type === "heal") return "heal";
  if (damageParts > 0) return "damage";
  if (effects > 0) return type === "save" ? "condition" : "buff";
  return "utility";
}

/** Where up to six target pins sit around the blast's centre (x, y in px within the scope). */
const PIN_SPOTS = [[40, 26], [80, 54], [28, 58], [86, 22], [58, 64], [16, 32]];

/** The vials: the doses left in the stack, and the one just used. */
function vialsHTML(item, t) {
  const uses = item.system?.uses;
  const quantity = Math.max(0, Number(item.system?.quantity) || 0);
  const max = Number(uses?.max) || 0;
  // A stack of single-use items counts items; a multi-charge item counts the charges left in the whole stack.
  const left = max > 1 ? Math.max(0, (quantity - 1) * max + (Number(uses.value) || 0)) : quantity;
  const shown = Math.min(6, left + 1);
  const vials = Array.from({ length: shown }, (_, i) => `<i class="${i < left ? "" : "is-spent"}"></i>`).join("");
  return `<span class="hardwipe-cons-vials" data-tooltip="${escapeHTML(t("Left", { n: left }))}">${vials}<em>${escapeHTML(t("Left", { n: left }))}</em></span>`;
}

function artHTML(kind, ring) {
  if (kind === "heal") return `<svg viewBox="0 0 270 76" preserveAspectRatio="none"><polyline class="hardwipe-cons-trace" points="0,54 40,54 52,54 60,36 68,68 78,14 88,62 96,54 150,54 162,54 170,42 178,64 186,54 270,54"/></svg>`;
  if (kind === "buff") {
    const c = 2 * Math.PI * 26;
    return `<svg class="hardwipe-cons-dial" viewBox="0 0 60 60" width="60" height="60"><circle class="bg" cx="30" cy="30" r="26"/>
      <circle class="ring${ring.indefinite ? " is-indefinite" : ""}" cx="30" cy="30" r="26" style="stroke-dasharray:${(ring.length * c).toFixed(1)} ${c.toFixed(1)}"/>
      <circle class="ticks" cx="30" cy="30" r="20"/></svg>`;
  }
  if (kind === "utility") return `<svg viewBox="0 0 120 76" width="120" height="76"><circle class="hardwipe-cons-ring" cx="52" cy="38" r="30"/><circle class="hardwipe-cons-cloud" cx="42" cy="34" r="12"/><circle class="hardwipe-cons-cloud" cx="60" cy="44" r="14"/></svg>`;
  return `<svg viewBox="0 0 120 76" width="120" height="76"><circle class="hardwipe-cons-ring" cx="52" cy="38" r="34"/><circle class="hardwipe-cons-blast" cx="52" cy="38" r="17"/><circle class="hardwipe-cons-core" cx="52" cy="38" r="3.5"/></svg>`;
}

/**
 * Rebuild a consumable's gear panel as the AB1 card. Runs on every render, after the roll card is decorated.
 * @param {ChatMessage} message
 * @param {HTMLElement} element   The message element.
 * @param {HTMLElement} panel     The gear panel (.hardwipe-gear).
 */
export function renderConsumable(message, element, panel, item, activity) {
  const content = element.querySelector(".message-content");
  if (!content || !panel || !activity) return;
  const t = (key, data) => data ? game.i18n.format(`HARDWIPE.Cons.${key}`, data) : game.i18n.localize(`HARDWIPE.Cons.${key}`);
  const effects = (activity.effects ?? []).map(entry => entry.effect ?? item.effects?.get(entry._id)).filter(Boolean);
  const kind = consumableKind({ type: activity.type, damageParts: activity.damage?.parts?.length ?? 0, effects: effects.length });
  const results = content.querySelector(":scope > .midi-results");
  element.classList.add("hardwipe-cons-message");
  panel.classList.add("hardwipe-cons", `is-${kind}`);

  // Bar: doses instead of a quantity.
  panel.querySelector(".hardwipe-gear-side")?.replaceWith(Object.assign(document.createElement("span"), { innerHTML: vialsHTML(item, t) }).firstElementChild);
  // Head: the cost and reach in one line under the name; the chips, uses and effect strip it replaces go.
  const main = panel.querySelector(".hardwipe-gear-main");
  const line = [activity.labels?.activation ?? activity.activation?.type, activity.labels?.target ?? ""].filter(Boolean).join(" · ");
  main?.querySelector(".hardwipe-gear-activity")?.replaceWith(Object.assign(document.createElement("small"), { className: "hardwipe-cons-line", textContent: line }));

  // The scope: the drawing (never interactive) and the readout.
  const effect = effects[0] ?? null;
  const seconds = effect?.duration?.seconds;
  const ring = durationRing(seconds);
  const scope = document.createElement("div");
  scope.className = "hardwipe-cons-scope";
  scope.innerHTML = `<div class="hardwipe-cons-art" aria-hidden="true">${artHTML(kind, ring)}</div>${kind === "buff" && effect?.img ? `<img class="hardwipe-cons-dial-icon" src="${escapeHTML(effect.img)}" alt="">` : ""}
    <div class="hardwipe-cons-readout"></div>`;
  const readout = scope.querySelector(".hardwipe-cons-readout");
  const below = document.createElement("div");
  below.className = "hardwipe-cons-below";
  const acts = document.createElement("div");
  acts.className = "hardwipe-cons-acts";
  const rows = document.createElement("div");
  rows.className = "hardwipe-cons-rows";

  const saveBlock = panel.querySelector(".hardwipe-gear-saves .hardwipe-save-block") ?? results?.querySelector(".hardwipe-save-block");
  const save = activity.save?.ability ? `${[...activity.save.ability].map(a => a.toUpperCase()).join("/")} ${activity.save.dc?.value ?? ""}`.trim() : "";
  const summary = results?.querySelector(".hardwipe-damage-summary");
  const sub = (text, cls = "") => text ? `<small class="${cls}">${escapeHTML(text)}</small>` : "";

  if (kind === "heal" || kind === "damage") {
    if (summary) {
      readout.append(summary);
      const formula = results.querySelector(".roll-breakdown .formula, .dice-formula")?.textContent.trim() ?? "";
      const types = [...summary.querySelectorAll(".hardwipe-damage-split [data-tooltip]")].map(i => i.dataset.tooltip.replace(/^\d+\s*/, "")).join(" + ");
      const half = kind === "damage" && save ? ` · ${save}${activity.damage?.onSave === "half" ? ` ${t("Half")}` : ""}` : "";
      readout.insertAdjacentHTML("beforeend", sub(`${kind === "heal" ? t("HP") : types}${half}`) + sub(formula, "is-formula"));
      const drawer = results.querySelector(".hardwipe-roll-drawer.is-damage");
      if (drawer) below.append(drawer);
      const applyRow = results.querySelector(".hardwipe-apply-row");
      if (applyRow) acts.append(applyRow);
      // Ready Set Midi's + for this roll (a bonus after the roll) leads the strip; it is added after this render.
      const moveBonus = () => {
        const bonus = results.querySelector(".midi-qol-damage-roll .rsr-addon-bonus-btn");
        if (bonus) acts.prepend(bonus);
      };
      moveBonus();
      setTimeout(moveBonus, 0);
      const log = results.querySelector(".hardwipe-apply-log");
      if (log) acts.after(log);
    } else readout.innerHTML = `<span class="hardwipe-cons-word is-pending">${escapeHTML(t(save ? "Saves" : "Rolling"))}</span>${sub(save)}`;
  } else if (kind === "condition" || kind === "buff") {
    const status = [...(effect?.statuses ?? [])][0];
    const statusName = id => game.i18n.localize(CONFIG.statusEffects.find(s => s.id === id)?.name ?? id);
    const word = kind === "condition" && status ? statusName(status) : effect?.name ?? item.name;
    const time = effect?.duration?.label && Number.isFinite(seconds) ? effect.duration.label : t("Indefinite");
    const holders = appliedHolders(item, effect);
    const who = kind === "buff" ? (holders.map(h => h.actor.name).join(", ") || (activity.target?.affects?.type === "self" ? item.actor?.name : "")) : "";
    readout.innerHTML = `<span class="hardwipe-cons-word">${escapeHTML(word)}</span>${sub([kind === "condition" ? save : "", time, who].filter(Boolean).join(" · "))}`;
    if (kind === "buff") {
      const holder = holders[0]?.actor ?? (activity.target?.affects?.type === "self" ? item.actor : null);
      const list = effect ? effectRows({ changes: effect.system?.changes ?? effect.changes, statuses: effect.statuses, description: effect.description },
        { read: holder ? path => foundry.utils.getProperty(holder, path) : null, applied: !!holders.length, statusName }) : [];
      rows.innerHTML = list.map(row => `<div class="hardwipe-cons-row"><span>${escapeHTML(row.label)}</span>
        <em>${Number.isFinite(row.before) ? `${escapeHTML(row.before)}${escapeHTML(row.unit ?? "")} → ${escapeHTML(row.after)}${escapeHTML(row.unit ?? "")}` : ""}</em>
        <b class="${row.change === "ON" ? "is-on" : ""}">${escapeHTML(row.change)}</b></div>`).join("");
      acts.append(...buffButtons(message, item, effect, holders, activity, t));
    }
  } else {
    const placed = !!activity.target?.template?.type;
    const reach = [activity.labels?.target, activity.labels?.duration && activity.duration?.units !== "inst" ? activity.labels.duration : ""].filter(Boolean).join(" · ");
    readout.innerHTML = `<span class="hardwipe-cons-word">${escapeHTML(t(placed ? "Deployed" : "Used"))}</span>${sub(reach)}`;
  }

  // Targets of a save: pinned in the blast (status only; hover for the name) and written out as rows below.
  if (saveBlock && (kind === "damage" || kind === "condition")) {
    const targets = [...saveBlock.querySelectorAll(".hardwipe-save-row")];
    const art = scope.querySelector(".hardwipe-cons-art");
    targets.slice(0, PIN_SPOTS.length).forEach((target, i) => {
      const img = target.querySelector(".hardwipe-save-who img")?.getAttribute("src") ?? "";
      const name = target.querySelector(".hardwipe-save-who span")?.textContent ?? "";
      const state = target.classList.contains("is-failed") ? "failed" : target.classList.contains("is-saved") ? "saved" : "pending";
      const [x, y] = PIN_SPOTS[i];
      art.insertAdjacentHTML("beforeend", `<span class="hardwipe-cons-pin is-${state}" style="left:${x}px;top:${y}px" data-tooltip="${escapeHTML(`${name}: ${t(`Pin.${state}`)}`)}"><img src="${escapeHTML(img)}" alt=""></span>`);
      // Damage each target takes, from the total and what a save does.
      const total = Number(summary?.querySelector(".hardwipe-damage-box strong")?.textContent);
      if (kind === "damage" && Number.isFinite(total) && state !== "pending" && !target.querySelector(".hardwipe-cons-out")) {
        const onSave = activity.damage?.onSave ?? "none";
        const taken = state === "failed" ? total : onSave === "half" ? Math.floor(total / 2) : onSave === "full" ? total : 0;
        // Beside the verdict, in the row's own last cell, so the row keeps its three columns.
        target.querySelector(":scope > b")?.insertAdjacentHTML("beforeend", ` <span class="hardwipe-cons-out">${taken}</span>`);
      }
    });
    rows.append(saveBlock);
  }

  // Details (the description) folds behind a toggle; the item's own buttons (Refund, Place template…) sit beside it.
  const desc = panel.querySelector(".hardwipe-desc");
  const foot = document.createElement("div");
  foot.className = "hardwipe-cons-foot";
  if (desc) {
    const open = panel.dataset.consDetails === "open";
    desc.hidden = !open;
    foot.insertAdjacentHTML("beforeend", `<button type="button" class="hardwipe-cons-details" aria-expanded="${open}">${escapeHTML(t("Details"))}</button>`);
    foot.querySelector(".hardwipe-cons-details").addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const now = desc.hidden;
      desc.hidden = !now;
      panel.dataset.consDetails = now ? "open" : "";
      event.currentTarget.setAttribute("aria-expanded", String(now));
    });
  }
  const strip = content.querySelector(":scope > .hardwipe-gear-actions");
  if (strip) foot.append(strip);

  // Order: head, scope, (dice drawer), apply strip, rows, (details), foot.
  if (!acts.childElementCount) acts.classList.add("is-empty");
  const parts = [scope, below.childElementCount ? below : null, acts, rows.childElementCount ? rows : null, desc, foot].filter(Boolean);
  panel.querySelector(".hardwipe-gear-body")?.after(...parts);
  // What's left of the roll card (Midi's labels and hidden buttons) folds away; its pieces now live in the panel.
  results?.classList.add("hardwipe-cons-folded");

  const left = arrivalWindow(message, "consumable", ARRIVAL_MS);
  if (left && !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    panel.classList.add("is-arriving");
    setTimeout(() => panel.classList.remove("is-arriving"), left);
  }
}

/** Actors near at hand (the scene's tokens and the item's owner) carrying a copy of this effect. */
function appliedHolders(item, effect) {
  if (!effect) return [];
  const actors = new Set([item.actor, ...(canvas?.tokens?.placeables ?? []).map(token => token.actor)].filter(Boolean));
  const holders = [];
  for (const actor of actors) {
    const copy = actor.effects?.find(entry => entry.origin === effect.uuid && !entry.disabled);
    if (copy) holders.push({ actor, copy });
  }
  return holders;
}

/** Remove the effect from actors the user owns, or apply it to the user's own targets (or themself, for a self buff). */
function buffButtons(message, item, effect, holders, activity, t) {
  if (!effect) return [];
  const make = (label, cls, handler, disabled = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hardwipe-cons-btn ${cls}`;
    button.textContent = label;
    button.disabled = disabled;
    // The card reads who holds the effect when drawn: redraw it once the effect is on or off.
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      void handler().then(() => ui.chat?.updateMessage?.(message)).catch(error => console.error("Hardwipe |", error));
    });
    return button;
  };
  const owned = holders.filter(h => h.actor.isOwner);
  if (owned.length) return [make(t("Remove"), "", () => Promise.all(owned.map(h => h.copy.delete())))];
  const self = activity.target?.affects?.type === "self";
  const targets = self ? [item.actor].filter(Boolean) : [...game.user.targets].map(token => token.actor).filter(Boolean);
  const mine = targets.filter(actor => actor.isOwner);
  const apply = () => Promise.all(mine.map(actor => {
    const data = effect.toObject();
    delete data._id;
    return actor.createEmbeddedDocuments("ActiveEffect", [{ ...data, origin: effect.uuid, transfer: false }]);
  }));
  return [make(mine.length === 1 ? t("ApplyTo", { name: mine[0].name }) : t("Apply"), "is-main", apply, !mine.length)];
}
