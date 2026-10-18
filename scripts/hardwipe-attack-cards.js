import { MODULE_ID, StrikesManager, escapeHTML } from "./hardwipe-state.js";
import { isAssembling } from "./hardwipe-assembly.js";

/**
 * Presentation shared by Hardwipe's chat cards: damage-type colours on every Ready Set Midi card,
 * the roll card (click-to-open dice drawers, one combined damage total, per-type apply buttons),
 * the saving-throw block, item details (property chips, description) and the card settings.
 */

// Damage-type glow colours. A combined total blends its parts' colours by damage dealt.
export const DAMAGE_COLORS = {
  acid: "#c6e84f", cold: "#9fe3ff", fire: "#ff8a3d", force: "#d38cff", lightning: "#5fb4ff",
  necrotic: "#9a86c9", poison: "#79e05a", psychic: "#ff8ccb", radiant: "#ffe08a", thunder: "#8c9bff",
  bludgeoning: "#cfd8e0", piercing: "#cfd8e0", slashing: "#cfd8e0",
  healing: "#6fe39b", vitality: "#6fe39b", temphp: "#7fc9ff"
};
const DAMAGE_SECTIONS = [
  [".midi-qol-damage-roll", "defaultDamage"],
  [".midi-qol-other-damage-roll", "otherDamage"],
  [".midi-qol-bonus-damage-roll", "bonusDamage"]
];
const openDrawers = new Set(); // "<message id>:<attack|damage|details>" drawers open on this client.
const CARET = '<i class="fas fa-chevron-down hardwipe-drawer-caret" inert></i>';

function damageRolls(message, kind = "defaultDamage") {
  return (message.rolls ?? []).filter(roll => roll instanceof CONFIG.Dice.DamageRoll
    && (roll.options?.["midi-qol"]?.rollType ?? "defaultDamage") === kind);
}

function attackRoll(message) {
  return (message.rolls ?? []).find(roll => roll.options?.["midi-qol"]?.rollType === "attack")
    ?? (message.rolls ?? []).find(roll => roll instanceof CONFIG.Dice.D20Roll);
}

function damageLabel(type) {
  const config = CONFIG.DND5E.damageTypes?.[type] ?? CONFIG.DND5E.healingTypes?.[type];
  return config?.label ? game.i18n.localize(config.label) : type ?? "";
}

/** Weighted blend of damage-type colours: [{ type, value }] -> "#rrggbb" or null. */
export function blendDamageColor(parts) {
  let r = 0, g = 0, b = 0, weight = 0;
  for (const { type, value } of parts) {
    const hex = DAMAGE_COLORS[type];
    if (!hex || !(value > 0)) continue;
    const n = Number.parseInt(hex.slice(1), 16);
    r += (n >> 16) * value; g += ((n >> 8) & 255) * value; b += (n & 255) * value; weight += value;
  }
  if (!weight) return null;
  return `#${[r, g, b].map(c => Math.round(c / weight).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * SC Item Rarity Colors publishes each rarity's colours as variables on its own classes; giving an
 * element those classes lets SC colour it with the user's palette and toggles. Blank rarity is Common.
 */
export function rarityClasses(item) {
  if (!item || !game.modules.get("sc-item-rarity-colors")?.active) return "";
  const raw = item.system?.rarity?.value ?? item.system?.rarity ?? "";
  const key = String(raw || "common").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `scirc-managed-item-row scirc-inv-title-color-enabled scirc-inv-border-managed scirc-rarity-${key}`;
}

/** Give every Ready Set Midi damage roll, and its dice breakdown, its damage type's colour. */
export function markDamageTypes(message, element) {
  for (const [selector, kind] of DAMAGE_SECTIONS) {
    const rolls = damageRolls(message, kind);
    element.querySelectorAll(`${selector} button.dice-roll`).forEach((button, index) => tagDamage(button, rolls[index]));
  }
  // Plain damage cards: Ready Set Midi stamps the message roll index.
  for (const button of element.querySelectorAll(".dice-roll.rsr-damage[data-rsm-message-roll-index]:not([data-hardwipe-damage])")) {
    tagDamage(button, message.rolls?.[Number(button.dataset.rsmMessageRollIndex)]);
  }
}

function tagDamage(button, roll) {
  const type = roll?.options?.type;
  const color = DAMAGE_COLORS[type];
  if (!color) return;
  button.dataset.hardwipeDamage = type;
  button.style.setProperty("--hw-dmg", color);
  const breakdown = button.nextElementSibling;
  if (breakdown?.classList.contains("roll-breakdown")) breakdown.style.setProperty("--hw-dmg", color);
}

/**
 * The rolls sit on their own card and each opens its own dice drawer when clicked. `pending` keeps
 * the quick damage buttons locked while the attack or its saves are unresolved; `saves` adds the
 * saving-throw block under the damage.
 */
export function decorateRollCard(message, element, { pending = false, saves = null, saveResults = null, tone = null, locked = false } = {}) {
  const content = element.querySelector(".message-content");
  if (!content) return;
  element.classList.toggle("hardwipe-accent-gold", accentIsGold());
  const results = content.querySelector(".midi-results");
  results?.classList.add("hardwipe-roll-card");
  // The card's rail and attack box take the attack's verdict colour.
  if (results && tone) results.dataset.hwTone = tone;
  attackDrawer(message, results, { locked });
  combineDamage(message, results, { pending, savePending: !!saves?.pending.length, critical: tone === "critical", fumble: tone === "fumble", saves: saves ?? saveResults });
  results?.querySelector(":scope > .hardwipe-save-block")?.remove();
  if (results && saves) insertAfterDamage(results, saveBlock(message, saves, { variant: "card" }));
  // A utility activity rolls nothing: no empty roll card.
  results?.classList.toggle("is-empty", !results.querySelector("button.dice-roll, .hardwipe-damage-summary, .hardwipe-save-block"));
  settleRolls(message, results, tone);
}

/* One-shot arrival: a natural 1 glitches the attack box once. Numbers never animate: a card shows its
 * final values from the first frame. Each effect has a fixed end time, so Ready Set Midi re-rendering a
 * fresh card mid-effect continues it rather than restarting it, and cards loaded later (a reload,
 * scrolling back) never animate. The window opens when the card first appears, not while it is still
 * being assembled out of the log. Skipped with reduced motion. */
const FRESH_MS = 20000;
const settling = new Map(); // "<message id>:<part>" -> end time on this client.

/** Time left (ms) in a one-shot arrival effect for this card part on this client; 0 once over or for old cards. */
export function arrivalWindow(message, part, duration) {
  return settleWindow(message, part, duration);
}

function settleWindow(message, part, duration) {
  const key = `${message.id}:${part}`;
  const now = Date.now();
  if (!settling.has(key) && isAssembling(message)) return 0;
  if (!settling.has(key)) {
    if (now - (message.timestamp ?? 0) > FRESH_MS) return 0;
    if (settling.size > 200) for (const [entry, end] of settling) if (end < now) settling.delete(entry);
    settling.set(key, now + duration);
  }
  return Math.max(0, settling.get(key) - now);
}

function settleRolls(message, results, tone) {
  if (!results || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const attack = results.querySelector(":scope > .midi-qol-attack-roll > button.dice-roll");
  if (!attack || tone !== "fumble") return;
  const glitch = settleWindow(message, "glitch", 1250);
  if (glitch) {
    attack.classList.add("hardwipe-glitch");
    attack.style.setProperty("--hw-glitch-delay", `${Math.max(0, glitch - 700)}ms`);
    setTimeout(() => attack.classList.remove("hardwipe-glitch"), glitch);
  }
}

/** 1 for advantage, -1 for disadvantage, 0 otherwise. */
function advantageMode(roll) {
  if (roll?.hasAdvantage) return 1;
  if (roll?.hasDisadvantage) return -1;
  const d20 = roll?.dice?.find(die => die.faces === 20);
  if (d20?.number > 1) {
    if (d20.modifiers?.some(modifier => /^kh/i.test(modifier))) return 1;
    if (d20.modifiers?.some(modifier => /^kl/i.test(modifier))) return -1;
  }
  return Math.sign(Number(roll?.options?.advantageMode) || 0);
}

/** Put a block under the last damage roll on the card (a weapon's poison damage comes after its base damage). */
export function insertAfterDamage(results, block) {
  const sections = [...results.querySelectorAll(`:scope > :is(${DAMAGE_SECTIONS.map(([selector]) => selector).join(", ")})`)]
    .filter(section => section.querySelector("button.dice-roll, .hardwipe-damage-summary"));
  const anchor = sections.at(-1);
  if (anchor) anchor.after(block);
  else results.append(block);
}

function rollDrawer(message, kind, html, key = kind) {
  const drawer = document.createElement("div");
  drawer.className = `hardwipe-roll-drawer is-${kind}`;
  drawer.classList.toggle("is-open", openDrawers.has(`${message.id}:${key}`));
  drawer.innerHTML = html;
  return drawer;
}

function bindDrawer(message, drawer, kind, trigger, options) {
  const sync = () => {
    const open = drawer.classList.contains("is-open");
    trigger.classList.toggle("hardwipe-drawer-open", open);
    trigger.setAttribute("aria-expanded", String(open));
  };
  sync();
  trigger.addEventListener("click", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const open = drawer.classList.toggle("is-open");
    if (open) openDrawers.add(`${message.id}:${kind}`);
    else openDrawers.delete(`${message.id}:${kind}`);
    sync();
  }, options);
}

/** Clicking the attack roll opens its math below it, in place of the dice popover. */
function attackDrawer(message, results, { locked = false } = {}) {
  const section = results?.querySelector(".midi-qol-attack-roll");
  const button = section?.querySelector(":scope > button.dice-roll");
  const roll = attackRoll(message);
  if (!button || !roll) return;
  d20Drawer(message, button, roll, game.i18n.localize("HARDWIPE.Attack.DrawerAttack"), "attack");
  // The advantage switch sits on the roll's header line, right above the box.
  const title = section.querySelector(":scope > .rsr-title, :scope > .midi-roll-label");
  title?.querySelector(":scope > :is(.hardwipe-roll-chip, .hardwipe-adv)")?.remove();
  if (!title) return;
  // Ready Set Midi retitles the roll "Advantage"/"Disadvantage"; the switch says that, so the header reads Attack.
  const text = [...title.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (text) text.textContent = game.i18n.localize("HARDWIPE.Attack.DrawerAttack");
  const bonus = title.querySelector(":scope > .rsr-addon-bonus-btn");
  // A bonus added after the GM's ruling would change a total the ruling no longer matches.
  if (locked) bonus?.remove();
  const control = advControlHTML(message, roll, button.dataset.rsmRollKey || "attack:0", { locked });
  if (bonus?.isConnected) bonus.insertAdjacentHTML("beforebegin", control);
  else title.insertAdjacentHTML("beforeend", control);
}

/**
 * A d20 roll's drawer: clicking the roll opens its dice and formula below it, in place of the dice
 * popover. Bound in the capture phase so the native popover never opens; Ready Set Midi's own
 * controls are handled earlier, at the document.
 */
export function d20Drawer(message, button, roll, label, key) {
  const breakdown = button.nextElementSibling?.classList.contains("roll-breakdown") ? button.nextElementSibling : null;
  (breakdown ?? button).parentElement?.querySelector(":scope > .hardwipe-roll-drawer")?.remove();
  const drawer = rollDrawer(message, key, `<div class="hardwipe-drawer-rolls">
      ${rollRowHTML(label, [roll], null)}
    </div>
    <div class="hardwipe-roll-formula">${escapeHTML(roll.formula)}</div>`);
  (breakdown ?? button).after(drawer);
  if (!button.querySelector(":scope > .hardwipe-drawer-caret")) button.insertAdjacentHTML("beforeend", CARET);
  bindDrawer(message, drawer, key, button, { capture: true });
  return drawer;
}

/** Whether Ready Set Midi's retroactive advantage buttons are on (its "overlay buttons" setting). */
function retroEnabled() {
  if (!game.modules.get("ready-set-midi")?.active) return false;
  try { return game.settings.get("ready-set-midi", "enableOverlayButtons") !== false; } catch { return true; }
}

/**
 * The advantage switch for a d20 roll: Disadvantage and Advantage, the current mode lit. A click
 * goes to Ready Set Midi's retroactive advantage (it rolls the extra d20 and redraws the card); the
 * buttons carry its markup, so its own document-level handler runs them. Read-only for viewers who
 * cannot change the roll, and locked once a GM has ruled on a reviewed attack.
 */
export function advControlHTML(message, roll, key, { locked = false } = {}) {
  const mode = advantageMode(roll);
  const live = !locked && retroEnabled() && (game.user.isGM || message.isAuthor);
  const t = name => game.i18n.localize(`HARDWIPE.Cards.${name}`);
  const button = (state, on, icon, label, tip, flip) => {
    const tooltip = on ? t(state === "kh" ? "AdvActive" : "DisActive") : locked ? t("AdvLocked") : live ? tip : t("AdvReadOnly");
    const action = live && !on ? ` data-action="rsr-retro" data-state="${state}"` : " disabled";
    const parts = [`<i class="fas ${icon}" inert></i>`, `<span>${escapeHTML(label)}</span>`];
    return `<button type="button" class="hardwipe-adv-btn is-${state === "kh" ? "adv" : "dis"}${on ? " is-on" : ""}"${action}
      aria-pressed="${on}" data-tooltip="${escapeHTML(tooltip)}" aria-label="${escapeHTML(tooltip)}">${(flip ? parts.reverse() : parts).join("")}</button>`;
  };
  const classes = ["hardwipe-adv", live ? "rsr-overlay-multiroll" : "is-static", locked ? "is-locked" : ""].filter(Boolean).join(" ");
  return `<span class="${classes}" data-rsm-roll-key="${escapeHTML(key)}">
    ${locked ? '<i class="fas fa-lock hardwipe-adv-lock" inert></i>' : ""}
    ${button("kl", mode < 0, "fa-chevrons-down", t("Dis"), t("DisApply"), false)}
    ${button("kh", mode > 0, "fa-chevrons-up", t("Adv"), t("AdvApply"), true)}
  </span>`;
}

/** One damage total in the blend of its types; clicking it opens the dice grouped by type. */
/** Each damage section gets one total and its own drawer. "Other" damage is a weapon's save damage. */
function combineDamage(message, results, { pending, savePending = false, critical = false, fumble = false, saves = null }) {
  for (const [selector, kind] of DAMAGE_SECTIONS) {
    const section = results?.querySelector(`:scope > ${selector}`);
    const key = kind === "defaultDamage" ? "damage" : `damage-${kind}`;
    // Damage that depends on a saving throw waits for the saves as well; a critical marks the attack's own damage.
    if (section) combineSection(message, section, damageRolls(message, kind), key, pending || (kind === "otherDamage" && savePending),
      critical && kind === "defaultDamage", { fumble, saves, kind });
  }
}

function combineSection(message, section, rolls, key, pending, critical = false, { fumble = false, saves = null, kind = "defaultDamage" } = {}) {
  section.querySelectorAll(":scope > :is(.hardwipe-damage-summary, .hardwipe-roll-drawer, .hardwipe-damage-void)").forEach(node => node.remove());
  section.classList.remove("is-stale");
  if (!section.querySelector("button.dice-roll")) return;
  // Ready Set Midi can drop a damage roll (a retroactive roll that lands a natural 1) and leave its old
  // markup on the card: say there is no damage instead of showing stale numbers and buttons.
  if (!rolls.length) {
    section.classList.add("is-stale");
    const label = section.querySelector(":scope > .rsr-title, :scope > .midi-roll-label");
    const text = game.i18n.localize(fumble ? "HARDWIPE.Cards.NoDamageFumble" : "HARDWIPE.Cards.NoDamage");
    (label ?? section.firstChild)?.insertAdjacentHTML?.(label ? "afterend" : "beforebegin",
      `<div class="hardwipe-damage-void"><i class="fas fa-ban" inert></i><span>${escapeHTML(text)}</span></div>`);
    return;
  }
  const groups = damageGroups(rolls);
  const total = groups.reduce((sum, group) => sum + Math.max(0, group.total), 0);
  const color = blendDamageColor(groups.map(group => ({ type: group.type, value: group.total })));
  critical ||= isCriticalDamage(rolls);
  const critSwitch = kind === "defaultDamage" && isAttackCard(message);
  const legend = groups.map(group => {
    const swatch = DAMAGE_COLORS[group.type] ? ` style="--hw-dmg: ${DAMAGE_COLORS[group.type]}"` : "";
    return `<span class="hardwipe-damage-type" data-type="${escapeHTML(group.type)}"${swatch}><i inert></i>${escapeHTML(group.total)} ${escapeHTML(damageLabel(group.type))}</span>`;
  }).join("");
  // The split bar: one segment per damage type, sized by damage dealt.
  const split = groups.filter(group => group.total > 0).map(group => `<i data-type="${escapeHTML(group.type)}"
      style="--hw-dmg: ${DAMAGE_COLORS[group.type] ?? "#cfd8e0"}; flex-grow: ${group.total}"
      data-tooltip="${escapeHTML(`${group.total} ${damageLabel(group.type)}`)}"></i>`).join("");
  const crit = critSwitch ? critSwitchHTML(message, critical)
    : critical ? `<span class="hardwipe-roll-chip is-crit">${escapeHTML(game.i18n.localize("HARDWIPE.Attack.ChipCritical"))}</span>` : "";
  section.classList.add("hardwipe-damage-combined");
  const summary = document.createElement("div");
  summary.className = `hardwipe-damage-summary${critical ? " is-crit" : ""}`;
  summary.dataset.key = key;
  summary.innerHTML = `<button type="button" class="hardwipe-damage-total"${color ? ` style="--hw-dmg: ${color}"` : ""}>
      <span class="hardwipe-damage-box"><strong>${escapeHTML(total)}</strong></span>${CARET}
    </button>
    ${split ? `<div class="hardwipe-damage-split">${split}</div>` : ""}
    ${groups.length > 1 || rolls.length > 1 ? `<div class="hardwipe-damage-types">${legend}</div>` : ""}`;
  section.classList.toggle("is-healing", groups.every(group => HEALING.has(group.type)));
  const canApply = game.user.isGM || message.isAuthor;
  const rows = groups.map(group => rollRowHTML(damageLabel(group.type), group.rolls, DAMAGE_COLORS[group.type], canApply ? applyButtonsHTML(group, pending) : "", group.type));
  const source = { kinds: [kind] };
  const drawer = rollDrawer(message, "damage", `<div class="hardwipe-drawer-rolls">${rows.join("")}</div>`, key);
  const label = section.querySelector(":scope > .rsr-title, :scope > .midi-roll-label");
  label?.querySelectorAll(":scope > :is(.hardwipe-roll-chip, .hardwipe-crit-switch)").forEach(node => node.remove());
  const labelBonus = label?.querySelector(":scope > .rsr-addon-bonus-btn");
  if (crit && labelBonus) labelBonus.insertAdjacentHTML("beforebegin", crit);
  else if (crit) label?.insertAdjacentHTML("beforeend", crit);
  label?.querySelector(":scope > .hardwipe-crit-switch button[data-hw-crit]")?.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.disabled = true;
    void rollCritDamage(message);
  });
  if (label) label.after(summary);
  else section.prepend(summary);
  summary.after(drawer);
  bindDrawer(message, drawer, key, summary.querySelector("button"));
  if (canApply) {
    const healing = section.classList.contains("is-healing");
    const landing = landingTargets(message, kind, saves);
    const row = applyRow(message, key, groups, pending, healing, landing.length || !healing ? landing : speakerTarget(message), source);
    drawer.after(row);
    const log = applyLog(message, key);
    if (log) row.after(log);
  }
  // The bar opens the drawer like the total; hovering a type lights it in the bar, the legend and the drawer.
  summary.querySelector(".hardwipe-damage-split")?.addEventListener("click", event => {
    event.preventDefault();
    summary.querySelector(".hardwipe-damage-total").click();
  });
  for (const node of [...summary.querySelectorAll("[data-type]"), ...drawer.querySelectorAll(".hardwipe-drawer-roll[data-type]")]) {
    const light = on => section.querySelectorAll(`[data-type="${CSS.escape(node.dataset.type)}"]`).forEach(match => match.classList.toggle("is-lit", on));
    node.addEventListener("mouseenter", () => light(true));
    node.addEventListener("mouseleave", () => light(false));
  }
  drawer.querySelectorAll(".hardwipe-apply button").forEach(button => button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    const holder = button.closest(".hardwipe-apply");
    const label = `${button.textContent.trim()} ${damageLabel(holder.dataset.type)}`;
    const parts = JSON.parse(holder.dataset.parts);
    const heal = HEALING.has(holder.dataset.type);
    void applyParts(parts,
      Number(button.dataset.multiplier), { message, key, label, source: heal ? null : { ...source, type: holder.dataset.type } });
  }));
}

/** Damage rolls grouped by type, in roll order. */
function damageGroups(rolls) {
  const groups = new Map();
  for (const roll of rolls) {
    const type = roll.options?.type ?? "none";
    const group = groups.get(type) ?? { type, rolls: [], total: 0, properties: new Set() };
    group.rolls.push(roll);
    group.total += Number(roll.total) || 0;
    for (const property of roll.options?.properties ?? []) group.properties.add(property);
    groups.set(type, group);
  }
  return [...groups.values()];
}

const HEALING = new Set(["healing", "temphp"]);

function damageGroupParts(group) {
  return group.rolls.map(roll => ({ value: Number(roll.total) || 0, type: group.type,
    properties: [...(roll.options?.properties ?? [])] }));
}

/** Quick buttons for one damage type: half, full and double (healing: one button), through dnd5e's own damage application. */
function applyButtonsHTML(group, pending) {
  const type = damageLabel(group.type);
  const heal = HEALING.has(group.type);
  const choices = heal ? [[1, escapeHTML(game.i18n.localize(group.type === "temphp" ? "HARDWIPE.Cards.ApplyTemp" : "HARDWIPE.Cards.ApplyHeal")), "ApplyHealing"]]
    : [[0.5, "½", "ApplyHalf"], [1, "×1", "ApplyFull"], [2, "×2", "ApplyDouble"]];
  const buttons = choices.map(([multiplier, text, key]) => {
    const tip = pending ? game.i18n.localize("HARDWIPE.Attack.ApplyPending") : game.i18n.format(`HARDWIPE.Attack.${key}`, { type });
    return `<button type="button" data-multiplier="${multiplier}" data-tooltip="${escapeHTML(tip)}"${pending ? " disabled" : ""}>${text}</button>`;
  }).join("");
  return `<span class="hardwipe-apply${heal ? " is-heal" : ""}" data-type="${escapeHTML(group.type)}" data-value="${escapeHTML(group.total)}"
    data-parts="${escapeHTML(JSON.stringify(damageGroupParts(group)))}"
    data-properties="${escapeHTML([...group.properties].join(","))}">${buttons}</span>`;
}

/** Same targets as Ready Set Midi's damage buttons: its "Apply damage to" setting picks selected and/or targeted tokens. */
function damageTargets() {
  const selected = new Set(canvas?.tokens?.controlled ?? []);
  const targeted = new Set(game.user?.targets ?? []);
  let mode = 0;
  try { mode = Number(game.settings.get("ready-set-midi", "applyDamageTo")) || 0; } catch { mode = 0; }
  if (mode === 1) return targeted;
  if (mode === 2) return new Set([...selected, ...targeted]);
  if (mode === 3) return selected.size ? selected : targeted;
  if (mode === 4) return targeted.size ? targeted : selected;
  return selected;
}

/**
 * dnd5e's damage application for several typed parts at once. By default the tokens come from Ready
 * Set Midi's "Apply damage to" setting; `targets` ([{ token, multiplier }]) names them instead. Each
 * token's hit points before and after are logged on the card, so the application can be undone.
 */
async function applyParts(parts, multiplier, { message = null, key = "", label = "", targets = null, source = null } = {}) {
  const canonical = message?.id ? game.messages.get(message.id) : message;
  const review = canonical?.flags?.[MODULE_ID]?.attackReview;
  if (message && (!canonical || !canonical.isContentVisible || review?.unavailable || (review && review.status !== "resolved")))
    return ui.notifications.warn(game.i18n.localize("HARDWIPE.Attack.ApplyPending"));
  const list = targets ?? [...damageTargets()].map(token => ({ token: token.document ?? token, multiplier }));
  if (!list.length) return ui.notifications.warn(game.i18n.localize("HARDWIPE.Attack.ApplyNoTargets"));
  const owned = list.filter(entry => entry.token?.actor?.isOwner);
  if (!owned.length) return ui.notifications.warn(game.i18n.localize("HARDWIPE.Attack.ApplyNoOwned"));
  if (owned.length < list.length) ui.notifications.info(game.i18n.format("HARDWIPE.Cards.ApplySkipped", { count: list.length - owned.length }));
  // dnd5e rewrites the damage descriptions it is given, so each token gets fresh ones.
  const damage = token => {
    const types = new Set(parts.filter(part => !HEALING.has(part.type)).map(part => part.type));
    const target = review?.targets?.find(entry => entry.uuid === token.uuid && entry.outcome === "critical");
    const extra = key === "damage" ? (target?.critBonusDetail ?? []).filter(part => types.has(part.type) && !HEALING.has(part.type)) : [];
    return aggregateCriticalDamage([...parts, ...extra].filter(part => Number.isFinite(part.value))
      .map(part => ({ value: part.value, type: part.type, properties: new Set(part.properties ?? []) })));
  };
  const records = [];
  for (const { token, multiplier: factor } of owned) {
    const actor = token.actor;
    const hp = () => [Number(actor.system.attributes?.hp?.value) || 0, Number(actor.system.attributes?.hp?.temp) || 0];
    const [value, temp] = hp();
    await actor.applyDamage(damage(token), { multiplier: factor });
    const [after, afterTemp] = hp();
    records.push({ uuid: token.uuid, name: token.name ?? actor.name, dv: after - value, dt: afterTemp - temp, m: factor });
  }
  const tracked = source && parts.every(part => !HEALING.has(part.type));
  if (message) await logApplication(message, key, label, records, tracked ? { ...source, parts: plainParts(parts) } : {});
}

/** Match native respectProperties grouping before per-description resistance rounding. */
export function aggregateCriticalDamage(parts) {
  const result = [], groups = new Map();
  for (const part of parts) {
    const properties = new Set(part.properties ?? []);
    // Healing and temporary HP retain their own native descriptions.
    if (HEALING.has(part.type)) { result.push({ ...part, properties }); continue; }
    const key = JSON.stringify([part.type, ...[...properties].sort()]);
    const previous = groups.get(key);
    if (previous) previous.value += Number(part.value) || 0;
    else {
      const value = { ...part, value: Number(part.value) || 0, properties };
      groups.set(key, value);
      result.push(value);
    }
  }
  return result;
}

/** Who a section's damage lands on: hit targets for an attack, save results for save damage, otherwise every target. */
function landingTargets(message, kind, saves) {
  const flags = message.flags ?? {};
  const midi = flags["midi-qol"] ?? {};
  const review = flags[MODULE_ID]?.attackReview;
  const name = uuid => foundry.utils.fromUuidSync(uuid)?.name ?? "";
  const fromSaves = state => state.targets.filter(target => target.status === "failed" || (target.status === "saved" && state.half))
    .map(target => ({ uuid: target.uuid, name: target.name || name(target.uuid), multiplier: target.status === "failed" ? 1 : 0.5 }));
  if (kind === "otherDamage" && saves) return fromSaves(saves);
  if (midi.d20AttackRoll !== undefined || Array.isArray(review?.targets)) {
    if (review?.status === "pending") return [];
    const hit = new Set([...(midi.hitTargetUuids ?? []), ...(midi.hitECTargetUuids ?? [])]);
    for (const target of review?.targets ?? []) {
      if (["hit", "critical"].includes(target.outcome)) hit.add(target.uuid);
      else if (target.outcome) hit.delete(target.uuid);
    }
    return [...hit].map(uuid => ({ uuid, name: name(uuid), multiplier: 1 }));
  }
  if (saves) return fromSaves(saves);
  return (midi.targets ?? []).filter(target => target?.uuid).map(target => ({ uuid: target.uuid, name: target.name || name(target.uuid), multiplier: 1 }));
}

/** The token that used the item, for healing with no targets of its own (a self-heal). */
function speakerTarget(message) {
  const { scene, token } = message.speaker ?? {};
  const document = scene && token ? foundry.utils.fromUuidSync(`Scene.${scene}.Token.${token}`) : null;
  return document ? [{ uuid: document.uuid, name: document.name, multiplier: 1 }] : [];
}

/**
 * The row under a section's total. A damage total gets ×1, ½ and ×2, applying every damage type of
 * the section (resistances count per type); a healing total gets Heal and Temp HP. Both end with
 * Targets, which applies the total to the card's own targets (hits, or failed and half-damage saves).
 * Mistakes are undone from the applied log. Locked while the attack or its saves are unresolved.
 */
function applyRow(message, key, groups, pending, healing, landing, source = null) {
  const t = name => game.i18n.localize(`HARDWIPE.Cards.${name}`);
  const total = groups.reduce((sum, group) => sum + Math.max(0, group.total), 0);
  const parts = groups.flatMap(damageGroupParts);
  const who = landing.map(target => `${target.name}${target.multiplier !== 1 ? ` (½)` : ""}`).join(", ");
  const choices = healing
    ? [["heal", "fa-heart", t("ApplyHeal"), t("RowHeal")], ["temp", "fa-hourglass-half", t("ApplyTemp"), t("RowTemp")]]
    : [["full", "fa-burst", "×1", t("RowFull")], ["half", "fa-burst", "½", t("RowHalf")], ["double", "fa-burst", "×2", t("RowDouble")]];
  choices.push(["targets", "fa-crosshairs", `${landing.length}`, landing.length ? game.i18n.format("HARDWIPE.Cards.RowTargets", { names: who }) : t("RowTargetsNone"), !landing.length]);
  const row = document.createElement("div");
  row.className = `hardwipe-apply-row${healing ? " is-healing" : ""}`;
  row.innerHTML = choices.map(([mode, icon, label, tip, off]) => {
    const tooltip = pending ? game.i18n.localize("HARDWIPE.Attack.ApplyPending") : tip;
    return `<button type="button" class="is-${mode}" data-mode="${mode}" data-tooltip="${escapeHTML(tooltip)}" aria-label="${escapeHTML(tooltip)}"${pending || off ? " disabled" : ""}>
      <i class="fas ${icon}" inert></i><span>${escapeHTML(label)}</span></button>`;
  }).join("");
  row.addEventListener("click", event => {
    const button = event.target.closest("button[data-mode]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const mode = button.dataset.mode;
    const options = { message, key, label: button.dataset.mode === "targets" ? t("LogTargets") : button.textContent.trim() || t(mode === "heal" ? "ApplyHeal" : "ApplyTemp") };
    if (mode === "heal") void applyParts([{ value: total, type: "healing" }], 1, options);
    else if (mode === "temp") void applyParts([{ value: total, type: "temphp" }], 1, options);
    else if (mode === "targets") {
      const targets = landing.map(target => ({ token: foundry.utils.fromUuidSync(target.uuid), multiplier: target.multiplier })).filter(entry => entry.token);
      void applyParts(parts, 1, { ...options, targets, source });
    }
    else void applyParts(parts, { full: 1, double: 2, half: 0.5 }[mode], { ...options, source });
  });
  return row;
}

/* Applied log: each use of the damage row or the drawer's buttons is recorded on the card (flag `applied`),
 * shown to GMs and to whoever applied it, with Undo restoring the hit points it changed. */
async function logApplication(message, key, label, targets, extra = {}) {
  if (!targets.length || !message.canUserModify?.(game.user, "update")) return;
  const list = [...(message.getFlag(MODULE_ID, "applied") ?? [])];
  list.push({ id: foundry.utils.randomID(), key, label, by: game.user.id, at: Date.now(), targets, undone: false, ...extra });
  await message.setFlag(MODULE_ID, "applied", list.slice(-30));
}

function hpChange({ dv, dt }) {
  const parts = [];
  if (dv) parts.push(`${dv > 0 ? "+" : "−"}${Math.abs(dv)} HP`);
  if (dt) parts.push(`${dt > 0 ? "+" : "−"}${Math.abs(dt)} ${game.i18n.localize("HARDWIPE.Cards.LogTemp")}`);
  return parts.join(" ") || game.i18n.localize("HARDWIPE.Cards.LogNoChange");
}

function applyLog(message, key) {
  const entries = (message.getFlag(MODULE_ID, "applied") ?? []).filter(entry => entry?.key === key && (game.user.isGM || entry.by === game.user.id));
  if (!entries.length) return null;
  const log = document.createElement("div");
  log.className = "hardwipe-apply-log";
  log.innerHTML = entries.map(entry => {
    const who = game.users.get(entry.by)?.name ?? "";
    const targets = entry.targets.map(target => `<span class="${target.dv < 0 || target.dt < 0 ? "is-loss" : "is-gain"}">${escapeHTML(target.name)} ${escapeHTML(hpChange(target))}</span>`).join("");
    // Undo only where this user can restore every target it changed.
    const restorable = entry.targets.every(target => foundry.utils.fromUuidSync(target.uuid)?.actor?.isOwner);
    const undo = !entry.undone && restorable && (game.user.isGM || entry.by === game.user.id)
      ? `<button type="button" data-undo="${escapeHTML(entry.id)}" data-tooltip="${escapeHTML(game.i18n.localize("HARDWIPE.Cards.UndoTip"))}"><i class="fas fa-rotate-left" inert></i>${escapeHTML(game.i18n.localize("HARDWIPE.Cards.Undo"))}</button>` : "";
    const adjusted = entry.adjusted && !entry.undone ? ` <em class="hardwipe-apply-adjusted" data-tooltip="${escapeHTML(game.i18n.localize("HARDWIPE.Cards.AdjustedTip"))}">${escapeHTML(game.i18n.localize("HARDWIPE.Cards.Adjusted"))}</em>` : "";
    return `<div class="hardwipe-apply-entry${entry.undone ? " is-undone" : ""}"><b>${escapeHTML(entry.label)}${adjusted}</b><span class="hardwipe-apply-who">${targets}</span>
      <small>${escapeHTML(entry.undone ? game.i18n.localize("HARDWIPE.Cards.Undone") : who)}</small>${undo}</div>`;
  }).join("");
  log.addEventListener("click", event => {
    const button = event.target.closest("button[data-undo]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    void undoApplication(message, button.dataset.undo);
  });
  return log;
}

/* ---------------------------------------------------------------------------------------------
 * Critical damage and changed rolls.
 * ------------------------------------------------------------------------------------------- */

/** Damage rolled as a critical (natural, a GM's Critical, or the CRIT switch). */
function isCriticalDamage(rolls) {
  return rolls.some(roll => roll.options?.isCritical || roll.options?.[MODULE_ID]?.critical);
}

function isAttackCard(message) {
  return message.flags?.["midi-qol"]?.d20AttackRoll !== undefined || Array.isArray(message.flags?.[MODULE_ID]?.attackReview?.targets);
}

/**
 * CRIT on the damage line, beside its bonus button: lit once the damage is critical. The roller may
 * switch it on until the GM has ruled; the GM may always. Switching it on rolls the damage dice again
 * and adds them, as a critical does.
 */
function critSwitchHTML(message, critical) {
  const review = message.flags?.[MODULE_ID]?.attackReview;
  const open = !Array.isArray(review?.targets) || review.status === "pending";
  const live = !critical && !review?.unavailable && (game.user.isGM || (message.isAuthor && open));
  const t = name => game.i18n.localize(`HARDWIPE.Cards.${name}`);
  const tip = critical ? t("CritActive") : live ? t("CritApply") : message.isAuthor && !open ? t("AdvLocked") : t("AdvReadOnly");
  return `<span class="hardwipe-adv hardwipe-crit-switch${live ? "" : " is-static"}">
    <button type="button" class="hardwipe-adv-btn is-crit${critical ? " is-on" : ""}"${live ? ' data-hw-crit="1"' : " disabled"}
      aria-pressed="${critical}" data-tooltip="${escapeHTML(tip)}" aria-label="${escapeHTML(tip)}"><i class="fas fa-burst" inert></i><span>${escapeHTML(t("Crit"))}</span></button>
  </span>`;
}

/** Roll the damage dice again (no modifiers): a critical's extra dice. */
export async function rollCriticalDice(damageRolls) {
  const results = [];
  for (const roll of damageRolls) {
    const dice = (roll.dice ?? []).filter(die => die.number > 0 && die.faces > 0);
    if (!dice.length) continue;
    const formula = dice.map(die => `${die.number}d${die.faces}`).join(" + ");
    const type = roll.options?.type ?? "none";
    const extra = await new CONFIG.Dice.DamageRoll(formula, {}, {
      type, properties: roll.options?.properties ?? [], [MODULE_ID]: { critical: true }, "midi-qol": { rollType: "defaultDamage" }
    }).evaluate();
    results.push({ type, value: extra.total, roll: extra });
  }
  if (!results.length) return null;
  return {
    total: results.reduce((sum, part) => sum + part.value, 0),
    detail: results.map(({ type, value, roll }) => ({ type, value, properties: new Set(roll.options.properties ?? []) })),
    rolls: results.map(part => part.roll)
  };
}

const critBusy = new Set();

/**
 * The CRIT switch. With the attack's workflow live on this client the extra dice join its damage, so the
 * GM's decision applies them; otherwise they are added to the card, and damage already applied is
 * adjusted by the GM's client (below).
 */
export async function rollCritDamage(message) {
  const card = game.messages.get(message?.id);
  if (!card || critBusy.has(card.id) || !(game.user.isGM || card.isAuthor)) return;
  critBusy.add(card.id);
  try {
    const rolls = damageRolls(card, "defaultDamage");
    if (!rolls.length || isCriticalDamage(rolls)) return;
    const bonus = await rollCriticalDice(rolls);
    if (!bonus) return;
    let workflow = null;
    try { workflow = globalThis.MidiQOL?.Workflow?.getWorkflow?.(card.uuid) ?? null; } catch { workflow = null; }
    if (workflow && !workflow.aborted && workflow.chatCard?.id === card.id && typeof workflow.addDamageRolls === "function") {
      // The GM's later Critical must not add a second set of dice.
      workflow.hardwipeCritDamage = true;
      await workflow.addDamageRolls(bonus.rolls);
      await workflow.displayDamageRolls();
    } else {
      await card.update({ rolls: [...card.rolls, ...bonus.rolls].map(roll => roll.toJSON()) });
    }
  } catch (error) {
    console.error(`${MODULE_ID} | Critical damage could not be rolled`, error);
    ui.notifications.error(game.i18n.localize("HARDWIPE.Cards.CritFailed"));
  } finally {
    critBusy.delete(card.id);
  }
}

/** Plain, serialisable damage parts, as an application stores them. */
function plainParts(parts) {
  return parts.map(part => ({ value: Number(part.value) || 0, type: part.type, properties: [...(part.properties ?? [])] }));
}

/** The parts an application covers, as the card's rolls stand now. */
function currentParts(message, entry) {
  return entry.kinds.flatMap(kind => damageGroups(damageRolls(message, kind)))
    .filter(group => !entry.type || group.type === entry.type)
    .flatMap(group => plainParts(damageGroupParts(group)));
}

const partsKey = parts => JSON.stringify(parts.map(part => [part.type, Number(part.value) || 0]).sort());

/** Hit points (and temp HP) a logged application actually took from a target; negative for healing. */
const lost = target => -(Number(target.dv) || 0) - (Number(target.dt) || 0);

/** HP an actor loses to these parts at this multiplier: dnd5e's resistances, immunities and threshold included. */
function landed(actor, parts, multiplier) {
  const damages = aggregateCriticalDamage(parts.map(part => ({ value: part.value, type: part.type, properties: new Set(part.properties ?? []) })));
  const result = actor.calculateDamage(damages, { multiplier });
  return result ? Number(result.amount) || 0 : 0;
}

/**
 * The attacker's client, when Ready Set Midi has applied an attack's damage itself: the application joins
 * the card's applied log (Auto), with Undo, like a damage-row application.
 */
export async function recordWorkflowDamage(workflow) {
  const card = game.messages.get(workflow?.chatCard?.id ?? workflow?.itemCardId);
  if (!card || !card.canUserModify?.(game.user, "update") || !workflow.damageList?.length) return;
  const marker = `${workflow.attackRollCount ?? 0}:${workflow.damageRollCount ?? 0}`;
  if (workflow.hardwipeDamageLogged === marker) return;
  workflow.hardwipeDamageLogged = marker;
  let mode = null;
  try { mode = globalThis.MidiQOL?.configSettings?.()?.autoApplyDamage; } catch { mode = null; }
  // An attack's damage lands only on the targets it still hits once the GM has ruled; Midi calculates it for all of them.
  const attack = !!workflow.attackRoll;
  const hit = new Set([...(workflow.hitTargets ?? []), ...(workflow.hitTargetsEC ?? [])].map(target => (target?.document ?? target)?.uuid));
  // A target that saved took the save's share (half, or none): record that, so a later change scales the same way.
  const saved = new Set([...(workflow.saves ?? [])].map(target => (target?.document ?? target)?.uuid));
  const onSave = workflow.activity?.damage?.onSave === "half" ? 0.5 : 0;
  const targets = [];
  for (const item of workflow.damageList) {
    const token = item.targetUuid ? foundry.utils.fromUuidSync(item.targetUuid) : null;
    const actor = token?.actor ?? (item.actorUuid ? foundry.utils.fromUuidSync(item.actorUuid) : null);
    const applies = ["yes", "yesCard", "yesCardMisses"].includes(mode) || (mode === "yesCardNPC" && actor?.type !== "character");
    if (!applies || !token || (attack && !hit.has(token.uuid))) continue;
    const dv = (Number(item.newHP) - Number(item.oldHP)) || 0;
    const dt = (Number(item.newTempHP) - Number(item.oldTempHP)) || 0;
    if (dv || dt) targets.push({ uuid: token.uuid, name: token.name ?? actor?.name ?? "", dv, dt, m: saved.has(token.uuid) ? onSave : 1 });
  }
  if (!targets.length) return;
  // Save damage depends on each save; the attack's own and bonus damage land whole on a hit.
  const source = { kinds: ["defaultDamage", "bonusDamage"], auto: true };
  await logApplication(card, "damage", game.i18n.localize("HARDWIPE.Cards.LogAuto"), targets, { ...source, parts: currentParts(card, source) });
}

const syncing = new Map(); // Message id -> the adjustment running for it on this client.

/**
 * The active GM's client: when a card's damage rolls change (a reroll, a bonus, CRIT) after damage was
 * applied, each recorded application is adjusted by the difference, per target, through dnd5e's damage
 * calculation; the log entry keeps the full change, so Undo still restores the original hit points.
 */
async function syncAppliedDamage(message) {
  const list = foundry.utils.deepClone(message.getFlag(MODULE_ID, "applied") ?? []);
  let changed = false;
  const notes = [];
  for (const entry of list) {
    if (entry.undone || !Array.isArray(entry.parts) || !Array.isArray(entry.kinds)) continue;
    const parts = currentParts(message, entry);
    if (!parts.length || partsKey(parts) === partsKey(entry.parts)) continue;
    for (const target of entry.targets) {
      const actor = foundry.utils.fromUuidSync(target.uuid)?.actor;
      if (!actor?.isOwner) continue;
      const multiplier = Number(target.m ?? 1) || 1;
      // Against what the target actually lost (a drop to 0 HP loses less than the roll was worth), so a smaller
      // roll doesn't hand back hit points that were never lost.
      const delta = landed(actor, parts, multiplier) - lost(target);
      if (!delta) continue;
      const hp = () => [Number(actor.system.attributes?.hp?.value) || 0, Number(actor.system.attributes?.hp?.temp) || 0];
      const [value, temp] = hp();
      await actor.applyDamage(delta);
      const [after, afterTemp] = hp();
      target.dv += after - value;
      target.dt += afterTemp - temp;
      notes.push(`${target.name} ${delta > 0 ? "−" : "+"}${Math.abs(delta)}`);
    }
    entry.parts = parts;
    entry.adjusted = (entry.adjusted ?? 0) + 1;
    changed = true;
  }
  if (!changed) return;
  await message.setFlag(MODULE_ID, "applied", list);
  if (notes.length) ui.notifications.info(game.i18n.format("HARDWIPE.Cards.AdjustedNote", { changes: notes.join(", ") }));
}

/**
 * A ruled attack whose roll changed afterwards (an Edge reroll): the GM rules a target again. Now a miss takes back
 * what was applied to it (the log keeps the entry, its change zeroed); now a hit applies the card's damage to it.
 */
export async function reruleTarget(message, uuid, outcome) {
  const card = game.messages.get(message?.id) ?? message;
  const state = foundry.utils.deepClone(card?.getFlag(MODULE_ID, "attackReview") ?? null);
  const target = state?.targets?.find(entry => entry.uuid === uuid);
  if (!target || state.status !== "resolved") return false;
  const hits = value => ["hit", "critical"].includes(value);
  const before = target.outcome;
  target.outcome = outcome;
  await card.setFlag(MODULE_ID, "attackReview", state);
  if (hits(before) && !hits(outcome)) await takeBackDamage(card, uuid);
  else if (!hits(before) && hits(outcome)) {
    const source = { kinds: ["defaultDamage", "bonusDamage"] };
    const parts = source.kinds.flatMap(kind => damageGroups(damageRolls(card, kind))).flatMap(damageGroupParts);
    const token = foundry.utils.fromUuidSync(uuid);
    if (token && parts.length) {
      await applyParts(parts, 1, { message: card, key: "damage", label: game.i18n.localize("HARDWIPE.EdgePlay.reroll.LogRuled"), targets: [{ token, multiplier: 1 }], source });
    }
  }
  return true;
}

/** Give back what every logged application took from one target, keeping the entries (their change zeroed). */
async function takeBackDamage(message, uuid) {
  const list = foundry.utils.deepClone(message.getFlag(MODULE_ID, "applied") ?? []);
  let changed = false;
  for (const entry of list) {
    if (entry.undone) continue;
    for (const target of entry.targets) {
      if (target.uuid !== uuid || (!target.dv && !target.dt)) continue;
      const actor = foundry.utils.fromUuidSync(target.uuid)?.actor;
      if (!actor?.isOwner) continue;
      const hp = actor.system.attributes?.hp ?? {};
      const max = Number(hp.effectiveMax ?? hp.max) || Infinity;
      await actor.update({
        "system.attributes.hp.value": Math.clamp((Number(hp.value) || 0) - target.dv, 0, max),
        "system.attributes.hp.temp": Math.max(0, (Number(hp.temp) || 0) - target.dt)
      });
      Object.assign(target, { dv: 0, dt: 0, takenBack: true });
      changed = true;
    }
  }
  if (changed) await message.setFlag(MODULE_ID, "applied", list);
}

/**
 * A target's save changed after damage was applied (an Edge reroll): each targeted application recorded for it is
 * redone at the new multiplier (failed 1, saved ½ or 0), the difference applied and logged, so Undo still restores.
 */
export async function resyncSaveTarget(message, uuid, multiplier) {
  const list = foundry.utils.deepClone(message?.getFlag(MODULE_ID, "applied") ?? []);
  const targeted = game.i18n.localize("HARDWIPE.Cards.LogTargets");
  let changed = false;
  for (const entry of list) {
    if (entry.undone || !Array.isArray(entry.parts) || (entry.label !== targeted && !entry.auto)) continue;
    for (const target of entry.targets) {
      if (target.uuid !== uuid) continue;
      if (Number(target.m ?? 1) === multiplier) continue;
      const actor = foundry.utils.fromUuidSync(target.uuid)?.actor;
      if (!actor?.isOwner) continue;
      const delta = landed(actor, entry.parts, multiplier) - lost(target);
      const hp = () => [Number(actor.system.attributes?.hp?.value) || 0, Number(actor.system.attributes?.hp?.temp) || 0];
      const [value, temp] = hp();
      if (delta) await actor.applyDamage(delta);
      const [after, afterTemp] = hp();
      target.dv += after - value;
      target.dt += afterTemp - temp;
      target.m = multiplier;
      changed = true;
    }
  }
  if (changed) await message.setFlag(MODULE_ID, "applied", list);
}

export function registerDamageSync() {
  Hooks.on("updateChatMessage", (message, changes) => {
    if (!("rolls" in changes) || !game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
    if (!message.getFlag(MODULE_ID, "applied")?.some(entry => !entry.undone && Array.isArray(entry.parts))) return;
    // One adjustment at a time per card: rapid rerolls settle in order.
    const previous = syncing.get(message.id) ?? Promise.resolve();
    const next = previous.then(() => syncAppliedDamage(game.messages.get(message.id) ?? message))
      .catch(error => console.error(`${MODULE_ID} | Applied damage could not follow the changed roll`, error));
    syncing.set(message.id, next);
    void next.finally(() => { if (syncing.get(message.id) === next) syncing.delete(message.id); });
  });
}

/** Undo one logged application: give back (or take back) the hit points it changed on each token. */
async function undoApplication(message, id) {
  const list = foundry.utils.deepClone(message.getFlag(MODULE_ID, "applied") ?? []);
  const entry = list.find(candidate => candidate.id === id);
  if (!entry || entry.undone) return;
  for (const target of entry.targets) {
    const actor = foundry.utils.fromUuidSync(target.uuid)?.actor;
    if (!actor?.isOwner) continue;
    const hp = actor.system.attributes?.hp ?? {};
    const max = Number(hp.effectiveMax ?? hp.max) || Infinity;
    await actor.update({
      "system.attributes.hp.value": Math.clamp((Number(hp.value) || 0) - target.dv, 0, max),
      "system.attributes.hp.temp": Math.max(0, (Number(hp.temp) || 0) - target.dt)
    });
  }
  entry.undone = true;
  entry.undoneBy = game.user.id;
  await message.setFlag(MODULE_ID, "applied", list);
}

/* ---------------------------------------------------------------------------------------------
 * Action strip: an item's own buttons (and dnd5e's target picker), moved (not copied) under the
 * roll card, so their handlers keep working.
 * ------------------------------------------------------------------------------------------- */

/** Ready Set Midi relabels rerolled buttons with keys this dnd5e version lacks ("[2] DND5E.Healing"). */
export function readableLabel(label, heal) {
  return String(label ?? "").replace(/\b[A-Z][A-Z0-9-]*(?:\.[A-Za-z0-9-]+)+\b/g, key => {
    if (game.i18n.has(key)) return game.i18n.localize(key);
    return game.i18n.localize(heal ? "HARDWIPE.Spell.ActionHealing" : "HARDWIPE.Spell.ActionDamage");
  });
}

/** Build the strip from the native card's buttons; `skip(action)` leaves a button behind. */
export function actionStrip(content, accent, skip = () => false) {
  const strip = document.createElement("div");
  strip.className = `hardwipe-gear-actions ${accent}`;
  const picker = content.querySelector(".chat-card recorded-targets");
  if (picker) {
    picker.classList.add("hardwipe-gear-targets");
    strip.append(picker);
  }
  const row = document.createElement("div");
  row.className = "hardwipe-gear-buttons";
  for (const button of content.querySelectorAll(".chat-card .card-buttons button[data-action], .chat-card section.icon-row button[data-action]")) {
    if (skip(button.dataset.action)) continue;
    const raw = button.getAttribute("aria-label") || (button.dataset.tooltip ? game.i18n.localize(button.dataset.tooltip) : button.textContent.trim());
    const heal = /heal/i.test(button.dataset.action) || /heal/i.test(raw);
    const label = readableLabel(raw, heal);
    button.classList.add("hardwipe-program-action");
    button.classList.toggle("is-heal", heal);
    if (label && !button.querySelector(".hardwipe-program-action-label")) button.insertAdjacentHTML("beforeend", `<span class="hardwipe-program-action-label">${escapeHTML(label)}</span>`);
    row.append(button);
  }
  if (row.childElementCount) strip.append(row);
  return strip;
}

/** Under the roll card; when nothing was rolled (the card is hidden), under the panel. */
export function placeActions(content, panel, strip) {
  if (!strip.childElementCount) return;
  const results = content.querySelector(":scope > .midi-results");
  (results && !results.classList.contains("is-empty") ? results : panel).after(strip);
}

function termsHTML(roll) {
  return (roll.terms ?? []).map(term => {
    if (term instanceof foundry.dice.terms.DiceTerm) {
      return (term.results ?? []).map(result => {
        const dropped = result.active === false || result.discarded;
        const edge = term.faces === 20 && !dropped ? (result.result >= 20 ? " is-max" : result.result === 1 ? " is-min" : "") : "";
        return `<span class="hardwipe-die d${escapeHTML(term.faces)}${dropped ? " is-dropped" : ""}${edge}">${escapeHTML(result.result)}</span>`;
      }).join("");
    }
    if (term instanceof foundry.dice.terms.OperatorTerm) return `<span class="hardwipe-roll-op">${escapeHTML(term.operator)}</span>`;
    return `<span class="hardwipe-roll-num">${escapeHTML(term.formula ?? term.total ?? "")}</span>`;
  }).join("");
}

/** One drawer row: label, every die of its rolls (extra critical dice tagged), total and optional controls. */
function rollRowHTML(label, rolls, color, controls = "", type = "") {
  const crit = `<small class="hardwipe-drawer-crit">${escapeHTML(game.i18n.localize("HARDWIPE.Attack.CritTag"))}</small>`;
  const dice = rolls.map(roll => termsHTML(roll) + (roll.options?.["hardwipe-ruleset"]?.critical ? crit : ""))
    .join('<span class="hardwipe-roll-op">+</span>');
  const total = rolls.reduce((sum, roll) => sum + (Number(roll.total) || 0), 0);
  return `<div class="hardwipe-drawer-roll${color ? " is-damage" : ""}"${type ? ` data-type="${escapeHTML(type)}"` : ""}${color ? ` style="--hw-dmg: ${color}"` : ""}>
    <span class="hardwipe-drawer-roll-label">${escapeHTML(label)}</span>
    <span class="hardwipe-drawer-dice">${dice}</span>
    <b>${escapeHTML(total)}</b>${controls}
  </div>`;
}

/* ---------------------------------------------------------------------------------------------
 * Settings
 * ------------------------------------------------------------------------------------------- */

/** Redraw the usage cards currently in the chat log (the log keeps rendered messages across a plain render). */
export function rerenderCards(filter = () => true) {
  for (const message of game.messages ?? []) {
    if (message.type !== "usage" || !filter(message)) continue;
    if (document.querySelector(`#chat .chat-log [data-message-id="${message.id}"], .chat-popout [data-message-id="${message.id}"]`)) ui.chat?.updateMessage?.(message);
  }
}

export function registerCardSettings() {
  const rerender = foundry.utils.debounce(() => rerenderCards(), 100);
  const register = (key, data) => {
    if (!game.settings.settings.has(`${MODULE_ID}.${key}`)) game.settings.register(MODULE_ID, key, { scope: "world", config: true, onChange: rerender, ...data });
  };
  register("spellCardColorMode", {
    name: "HARDWIPE.Cards.SpellColorMode", hint: "HARDWIPE.Cards.SpellColorModeHint", type: String, default: "single",
    choices: {
      single: "HARDWIPE.Cards.SpellColorSingle", school: "HARDWIPE.Cards.SpellColorSchool",
      player: "HARDWIPE.Cards.SpellColorPlayer", spell: "HARDWIPE.Cards.SpellColorSpell"
    }
  });
  register("spellCardColor", {
    name: "HARDWIPE.Cards.SpellColor", hint: "HARDWIPE.Cards.SpellColorHint",
    type: new foundry.data.fields.ColorField({ nullable: false, initial: "#b48cff" }), default: "#b48cff"
  });
  register("saveButtonColors", {
    name: "HARDWIPE.Cards.SaveColors", hint: "HARDWIPE.Cards.SaveColorsHint", type: String, default: "ability",
    choices: { ability: "HARDWIPE.Cards.SaveColorsAbility", amber: "HARDWIPE.Cards.SaveColorsAmber" }
  });
  // Per viewer: text size and folding of settled cards.
  const client = (key, data) => {
    if (!game.settings.settings.has(`${MODULE_ID}.${key}`)) game.settings.register(MODULE_ID, key, { scope: "client", config: true, ...data });
  };
  client("cardTextSize", {
    name: "HARDWIPE.Cards.TextSize", hint: "HARDWIPE.Cards.TextSizeHint", type: String, default: "normal",
    choices: { normal: "HARDWIPE.Cards.TextNormal", large: "HARDWIPE.Cards.TextLarge", xlarge: "HARDWIPE.Cards.TextXLarge" },
    onChange: value => applyTextSize(value)
  });
  client("cardFoldAfter", {
    name: "HARDWIPE.Cards.FoldAfter", hint: "HARDWIPE.Cards.FoldAfterHint", type: String, default: "5",
    choices: { 0: "HARDWIPE.Cards.FoldNever", 2: "HARDWIPE.Cards.Fold2", 5: "HARDWIPE.Cards.Fold5", 10: "HARDWIPE.Cards.Fold10" }
  });
  register("cardAccent", {
    name: "HARDWIPE.Cards.Accent", hint: "HARDWIPE.Cards.AccentHint", type: String, default: "phosphor",
    choices: { phosphor: "HARDWIPE.Cards.AccentPhosphor", gold: "HARDWIPE.Cards.AccentGold" }
  });
}

function setting(key, fallback) {
  try { return game.settings.get(MODULE_ID, key) ?? fallback; } catch { return fallback; }
}

/** The viewer's card text size, as a class on the page. */
export function applyTextSize(value = setting("cardTextSize", "normal")) {
  document.body?.classList.toggle("hardwipe-text-large", value === "large");
  document.body?.classList.toggle("hardwipe-text-xlarge", value === "xlarge");
}

export function foldAfterMinutes() {
  return Number(setting("cardFoldAfter", "5")) || 0;
}

export function accentIsGold() {
  return setting("cardAccent", "phosphor") === "gold";
}

/* ---------------------------------------------------------------------------------------------
 * Spell colours
 * ------------------------------------------------------------------------------------------- */

const SCHOOL_COLORS = {
  abj: "#6fb6ff", con: "#ffd36b", div: "#e8e8ff", enc: "#ff8ccb",
  evo: "#ff6b4a", ill: "#b48cff", nec: "#79e05a", trs: "#ffb45c"
};

/** A school's colour: SC Item Rarity Colors' own school colour when that school's colour is enabled there. */
export function schoolColor(school) {
  if (game.modules.get("sc-item-rarity-colors")?.active) {
    try {
      const profile = game.settings.get("sc-item-rarity-colors", "spell-school-styles")?.profiles?.[`school_${school}`];
      if (profile?.["enable-item-color"] && /^#[0-9a-f]{6}$/i.test(profile["item-color"] ?? "")) return profile["item-color"];
    } catch { /* SC without school styles */ }
  }
  return SCHOOL_COLORS[school] ?? null;
}

/** The spell card's colour, by the world setting: one colour, by school, by the caster's player, or set per spell. */
export function spellColor(message, item) {
  const base = cssColor(setting("spellCardColor", null)) ?? "#b48cff";
  const mode = setting("spellCardColorMode", "single");
  if (mode === "school") return schoolColor(item?.system?.school) ?? base;
  if (mode === "player") return cssColor(message.author?.color) ?? base;
  if (mode === "spell") return cssColor(item?.getFlag?.(MODULE_ID, "cardColor")) ?? base;
  return base;
}

/** A stored colour (a Color, its number, or a hex string) as CSS; null when unset or invalid. */
function cssColor(value) {
  if (value === null || value === undefined || value === "") return null;
  try {
    const color = foundry.utils.Color.from(value);
    return color.valid ? color.css : null;
  } catch { return null; }
}

/* ---------------------------------------------------------------------------------------------
 * Item details: property chips and description
 * ------------------------------------------------------------------------------------------- */

const PROPERTY_ICONS = {
  amm: "fa-box", fin: "fa-feather-pointed", hvy: "fa-weight-hanging", lgt: "fa-feather", lod: "fa-hourglass-half",
  rch: "fa-arrows-left-right", spc: "fa-star", thr: "fa-share", two: "fa-hands", ver: "fa-hand-fist",
  mgc: "fa-wand-sparkles", sil: "fa-gem", ada: "fa-shield-halved", foc: "fa-circle-dot"
};

/** Range, weapon properties and mastery as icon chips. */
export function propertyChipsHTML(item, activity) {
  const chips = [];
  const range = activity?.labels?.range || item?.labels?.range;
  if (range) chips.push(["fa-ruler-horizontal", range]);
  for (const property of item?.labels?.properties ?? []) chips.push([PROPERTY_ICONS[property.abbr] ?? "fa-tag", property.label]);
  const mastery = item?.system?.mastery;
  const masteryLabel = mastery && (CONFIG.DND5E.weaponMasteries?.[mastery]?.label ?? mastery);
  if (masteryLabel) chips.push(["fa-star", game.i18n.localize(masteryLabel)]);
  if (!chips.length) return "";
  return `<div class="hardwipe-props">${chips.map(([icon, label]) => `<span class="hardwipe-prop"><i class="fas ${icon}" inert></i>${escapeHTML(label)}</span>`).join("")}</div>`;
}

/** Whether this viewer sees an item's full description (players do not see an unowned NPC's notes). */
export function descriptionVisible(item) {
  const actor = item?.actor;
  return !!item && (game.user.isGM || !actor || actor.hasPlayerOwner || actor.testUserPermission(game.user, "OBSERVER"));
}

export function descriptionSource(item) {
  if (!item) return "";
  const chat = item.system?.description?.chat;
  if (descriptionVisible(item)) return item.system?.description?.value || chat || "";
  return chat || "";
}

export function plainText(html) {
  const div = document.createElement("div");
  div.innerHTML = html ?? "";
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}

const enriched = new Map();
/** Enriched description, cached per item version. */
export async function enrichDescription(item) {
  const source = descriptionSource(item);
  if (!source) return "";
  const key = `${item.uuid}:${item._stats?.modifiedTime ?? 0}:${source.length}`;
  if (!enriched.has(key)) {
    if (enriched.size >= 100) enriched.delete(enriched.keys().next().value);
    const TextEditor = foundry.applications.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    enriched.set(key, TextEditor.enrichHTML(source, { relativeTo: item, rollData: item.getRollData?.() ?? {}, secrets: item.isOwner }));
  }
  return enriched.get(key);
}

/** Fill an element with the enriched description once it is ready (the card may have re-rendered by then). */
export function fillDescription(target, item) {
  if (!target) return;
  // The card may not be in the chat log yet; a stale copy from an earlier render is simply discarded.
  void enrichDescription(item).then(html => { target.innerHTML = html; });
}

/** The weapon's description: a labelled panel, three lines until the viewer opens it. */
export function briefHTML(item) {
  const text = plainText(descriptionSource(item));
  if (!text) return "";
  const long = text.length > 140;
  const t = key => escapeHTML(game.i18n.localize(`HARDWIPE.Cards.${key}`));
  return `<div class="hardwipe-desc${long ? " is-clamped" : ""}">
    <div class="hardwipe-desc-head"><i class="fas fa-file-lines" inert></i><span>${t("Description")}</span></div>
    <div class="hardwipe-desc-body">${escapeHTML(text)}</div>
    ${long ? `<button type="button" class="hardwipe-desc-more" aria-expanded="false"><span>${t("ReadMore")}</span><i class="fas fa-chevron-down" inert></i></button>` : ""}
  </div>`;
}

export function bindBrief(message, element, item) {
  const panel = element.querySelector(".hardwipe-desc");
  if (!panel) return;
  // Plain text shows at once; the enriched description (bold, links, rolls) replaces it when ready.
  fillDescription(panel.querySelector(".hardwipe-desc-body"), item);
  const button = panel.querySelector(".hardwipe-desc-more");
  if (!button) return;
  const key = `${message.id}:brief`;
  const set = open => {
    panel.classList.toggle("is-open", open);
    button.setAttribute("aria-expanded", String(open));
    button.querySelector("span").textContent = game.i18n.localize(open ? "HARDWIPE.Cards.ShowLess" : "HARDWIPE.Cards.ReadMore");
    if (open) openDrawers.add(key);
    else openDrawers.delete(key);
  };
  set(openDrawers.has(key));
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    set(!panel.classList.contains("is-open"));
  });
}

/* ---------------------------------------------------------------------------------------------
 * Saving throws
 * ------------------------------------------------------------------------------------------- */

export const ABILITY_COLORS = { str: "#ff7b6b", dex: "#8fe07a", con: "#ffb45c", int: "#6fb6ff", wis: "#7fe6d6", cha: "#d69bff" };

/** The activity that asks for a save: the one used, or the item's save activity (a weapon's poison, for example). */
export function saveActivityFor(message) {
  const activity = message.getAssociatedActivity?.();
  if (activity?.save) return activity;
  return message.getAssociatedItem?.()?.system?.activities?.find?.(entry => entry.save) ?? null;
}

function firstAbility(activity) {
  const ability = activity?.save?.ability;
  if (ability instanceof Set) return ability.first?.() ?? [...ability][0];
  return Array.isArray(ability) ? ability[0] : ability;
}

/**
 * Who must save, against what, and what each target has rolled so far. Targets come from the card
 * (recorded by the caster's client, or Ready Set Midi's own save list); live results come from the
 * save rolls linked to this card; Ready Set Midi's final saved / failed lists win once it posts them.
 */
export function saveState(message, element) {
  if (!message.isContentVisible) return null;
  const stored = message.flags?.[MODULE_ID]?.saves;
  const activity = saveActivityFor(message);
  const ability = stored?.ability ?? firstAbility(activity);
  const dc = Number(stored?.dc ?? activity?.save?.dc?.value);
  if (!ability || !Number.isFinite(dc)) return null;
  let targets = (stored?.targets ?? []).map(target => ({ ...target }));
  if (!targets.length) targets = targetsFromSaveDisplay(element);
  if (!targets.length) return null;
  const midi = message.flags?.["midi-qol"] ?? {};
  const savedFinal = new Set(midi.saveUuids ?? []);
  const failedFinal = new Set(midi.failedSaveUuids ?? []);
  const rolls = new Map();
  // Oldest first, so a later save for the same token replaces an earlier one.
  for (const entry of messagesAfter(message).reverse()) {
    if (entry.type !== "save" || entry.flags?.dnd5e?.originatingMessage !== message.id || !entry.speaker?.token) continue;
    const { scene, token } = entry.speaker;
    const key = scene ? `Scene.${scene}.Token.${token}` : token;
    rolls.set(key, entry);
  }
  for (const target of targets) {
    const save = rolls.get(target.uuid) ?? rolls.get(target.uuid.split(".").pop());
    const total = save?.isContentVisible ? Number(save.rolls?.[0]?.total) : NaN;
    delete target.total;
    if (Number.isFinite(total)) target.total = total;
    if (savedFinal.has(target.uuid)) target.status = "saved";
    else if (failedFinal.has(target.uuid)) target.status = "failed";
    else if (Number.isFinite(total)) target.status = total >= dc ? "saved" : "failed";
    else target.status = "pending";
  }
  const pending = targets.filter(target => target.status === "pending");
  return { ability, dc, targets, pending, done: targets.length - pending.length, half: activity?.damage?.onSave === "half" };
}

/**
 * The messages posted after a card, newest first. A card's saves and checks always follow it, so the scan stops
 * at the card instead of reading the whole log on every render.
 */
export function messagesAfter(message) {
  const list = game.messages.contents, out = [];
  for (let index = list.length - 1; index >= 0 && list[index].id !== message.id; index--) out.push(list[index]);
  return out;
}

function targetsFromSaveDisplay(element) {
  return [...(element?.querySelectorAll(".midi-qol-saves-display li[data-id]") ?? [])].map(row => {
    const uuid = row.querySelector("[data-uuid]")?.dataset.uuid;
    const name = (game.user.isGM ? row.querySelector(".midi-qol-gmTokenName") : null) ?? row.querySelector(".midi-qol-playerTokenName")
      ?? row.querySelector(".midi-qol-target-name");
    return uuid ? { uuid, name: name?.textContent.replace(/\s+/g, " ").trim() ?? "", img: row.querySelector("img")?.getAttribute("src") ?? "" } : null;
  }).filter(Boolean);
}

/** An ability's card colour (or amber for every ability, by the save colour setting). */
export function abilityColor(ability) {
  return saveColor(ability);
}

function saveColor(ability) {
  return setting("saveButtonColors", "ability") === "amber" ? "var(--hw-warn)" : ABILITY_COLORS[ability] ?? "var(--hw-warn)";
}

/**
 * The saving-throw block: the viewer's call to action (an ability-coloured button that rolls the save
 * for their own pending targets, or every pending target for the GM) and each target's result.
 */
export function saveBlock(message, state, { variant = "card" } = {}) {
  const t = key => game.i18n.localize(`HARDWIPE.Cards.${key}`);
  const config = CONFIG.DND5E.abilities[state.ability] ?? {};
  const abbr = String(config.abbreviation ?? state.ability).toUpperCase();
  const abilityLabel = game.i18n.localize(config.label ?? state.ability);
  const mine = state.pending.filter(target => foundry.utils.fromUuidSync(target.uuid)?.actor?.isOwner);
  const block = document.createElement("div");
  block.className = `hardwipe-save-block is-${variant}`;
  block.style.setProperty("--hw-save", saveColor(state.ability));
  const title = variant === "card"
    ? `<div class="hardwipe-save-title"><span>${escapeHTML(t("SaveTitle"))}</span><b>${escapeHTML(abbr)} · ${escapeHTML(game.i18n.format("HARDWIPE.Cards.SaveDC", { dc: state.dc }))}</b></div>` : "";
  const progress = variant === "window" && state.pending.length
    ? `<div class="hardwipe-progress" style="--p:${Math.round(100 * state.done / state.targets.length)}%"><i></i></div>
       <div class="hardwipe-progress-label"><span>${escapeHTML(t("SavesWaiting"))}</span><span>${state.done} / ${state.targets.length}</span></div>` : "";
  const button = mine.length ? `<button type="button" class="hardwipe-save-button is-cta" data-ability="${escapeHTML(state.ability)}">
      <span class="hardwipe-save-ability">${escapeHTML(abbr)}</span>
      <span class="hardwipe-save-label"><b>${escapeHTML(game.user.isGM && mine.length > 1 ? game.i18n.format("HARDWIPE.Cards.SaveRollAll", { count: mine.length }) : t("SaveRoll"))}</b>
        <small>${escapeHTML([abilityLabel, ...mine.map(target => target.name)].join(" · "))}</small></span>
      <span class="hardwipe-save-dc">${escapeHTML(game.i18n.format("HARDWIPE.Cards.SaveDC", { dc: state.dc }))}</span>
    </button>` : "";
  const label = status => t(status === "saved" ? "SaveSaved" : status === "failed" ? "SaveFailed" : "SaveWaiting");
  const fallen = fallenTargets(message);
  const rows = state.targets.map(target => `<div class="hardwipe-save-row is-${target.status}">
      <span class="hardwipe-save-who">${target.img ? `<img src="${escapeHTML(target.img)}" alt="">` : ""}<span>${escapeHTML(target.name)}</span>${stampHTML(fallen.get(target.uuid), true)}</span>
      <em>${Number.isFinite(target.total) ? escapeHTML(target.total) : "—"}</em><b>${escapeHTML(label(target.status))}</b></div>`).join("");
  const header = variant === "window" ? `<div class="hardwipe-save-head"><span>${escapeHTML(t("SaveTarget"))}</span><span>${escapeHTML(abbr)} · ${escapeHTML(game.i18n.format("HARDWIPE.Cards.SaveDC", { dc: state.dc }))}</span><span>${escapeHTML(t("SaveStatus"))}</span></div>` : "";
  block.innerHTML = `${title}${progress}${button}<div class="hardwipe-save-rows">${header}${rows}</div>`;
  block.querySelector(".hardwipe-save-button")?.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.disabled = true;
    void rollSaves(message, state, mine, event);
  });
  return block;
}

/** This actor's targets that still owe the card's save (for the Turn tab's "Waiting on you"). */
export function pendingSaveTargets(message, actor) {
  const state = saveState(message, null);
  if (!state || !actor) return null;
  const targets = state.pending.filter(target => {
    const owner = foundry.utils.fromUuidSync(target.uuid)?.actor;
    return !!owner && (owner === actor || owner.uuid === actor.uuid);
  });
  return targets.length ? { state, targets } : null;
}

/** Roll this actor's pending saves for a card, as its own Roll save button would. */
export async function rollPendingSaves(message, actor, event) {
  const found = pendingSaveTargets(message, actor);
  if (found) await rollSaves(message, found.state, found.targets, event);
}

/** Roll each save as the target token itself, linked to this card, so Ready Set Midi resolves its waiting save. */
async function rollSaves(message, state, targets, event) {
  for (const target of targets) {
    const token = foundry.utils.fromUuidSync(target.uuid);
    const actor = token?.actor;
    if (!actor?.isOwner) continue;
    try {
      await actor.rollSavingThrow({ ability: state.ability, target: state.dc, event }, { configure: !game.user.isGM && targets.length === 1 }, {
        data: { speaker: ChatMessage.implementation.getSpeaker({ token }), flags: { dnd5e: { originatingMessage: message.id } } }
      });
    } catch (error) {
      console.error(`${MODULE_ID} | Saving throw failed`, error);
    }
  }
  ui.chat?.updateMessage?.(message);
}

/* ---------------------------------------------------------------------------------------------
 * Fallen stamps: when a target drops to 0 HP, the most recent card that targeted it is stamped
 * Downed (a player character) or Flatlined (an NPC, or a character who is dead or on three Strikes).
 * The stamp is stored on that card, so later events never change an old card.
 * ------------------------------------------------------------------------------------------- */

const STAMP_WINDOW_MS = 10 * 60 * 1000;
const stamping = new Set();

/** Card flag `fallen` ([{ uuid, state }]) as a map of token UUID to "downed" | "flatlined". */
export function fallenTargets(message) {
  const list = message?.flags?.[MODULE_ID]?.fallen;
  return new Map((Array.isArray(list) ? list : []).filter(entry => entry?.uuid).map(entry => [entry.uuid, entry.state]));
}

export function stampHTML(state, compact = false) {
  if (state !== "downed" && state !== "flatlined") return "";
  const label = game.i18n.localize(state === "downed" ? "HARDWIPE.Attack.StampDowned" : "HARDWIPE.Attack.StampFlatlined");
  if (compact) return `<i class="hardwipe-stamp-icon is-${state} fas ${state === "downed" ? "fa-heart-crack" : "fa-skull"}" data-tooltip="${escapeHTML(label)}" aria-label="${escapeHTML(label)}"></i>`;
  return `<span class="hardwipe-stamp is-${state}">${escapeHTML(label)}</span>`;
}

function cardTargetUuids(message) {
  const flags = message.flags ?? {};
  const uuids = new Set();
  for (const target of flags["midi-qol"]?.targets ?? []) if (target?.uuid) uuids.add(target.uuid);
  for (const target of flags[MODULE_ID]?.attackReview?.targets ?? []) if (target?.uuid) uuids.add(target.uuid);
  for (const target of flags[MODULE_ID]?.saves?.targets ?? []) if (target?.uuid) uuids.add(target.uuid);
  return uuids;
}

function fallenState(actor) {
  if (actor.statuses?.has("dead") || StrikesManager.get(actor) >= 3 || !actor.hasPlayerOwner) return "flatlined";
  return "downed";
}

async function stampFallen(actor) {
  if (!actor || !game.users.activeGM?.isSelf) return;
  const tokens = new Set([actor.token?.uuid, ...(actor.getActiveTokens?.(false, true) ?? []).map(token => token.uuid)].filter(Boolean));
  const key = [...tokens].join("|");
  if (!tokens.size || stamping.has(key)) return;
  stamping.add(key);
  try {
    const cutoff = Date.now() - STAMP_WINDOW_MS;
    for (const message of game.messages.contents.slice(-50).reverse()) {
      if ((message.timestamp ?? 0) < cutoff) break;
      if (message.type !== "usage") continue;
      const targets = cardTargetUuids(message);
      const uuid = [...tokens].find(entry => targets.has(entry));
      if (!uuid) continue;
      const state = fallenState(actor);
      const list = (message.getFlag(MODULE_ID, "fallen") ?? []).filter(entry => entry?.uuid !== uuid);
      if (fallenTargets(message).get(uuid) !== state) await message.setFlag(MODULE_ID, "fallen", [...list, { uuid, state }]);
      return;
    }
  } finally {
    setTimeout(() => stamping.delete(key), 1000);
  }
}

/** The active GM stamps cards when a targeted token drops to 0 HP (linked actors and unlinked tokens). */
export function registerFallenStamps() {
  const dropped = value => value !== undefined && Number(value) <= 0;
  Hooks.on("updateActor", (actor, changes) => {
    if (dropped(foundry.utils.getProperty(changes, "system.attributes.hp.value"))) void stampFallen(actor);
  });
  Hooks.on("updateToken", (token, changes) => {
    if (dropped(foundry.utils.getProperty(changes, "delta.system.attributes.hp.value"))) void stampFallen(token.actor);
  });
}

/** On the caster's client: record who must save, so every client can list them before Ready Set Midi posts results. */
export async function recordSaveTargets(workflow) {
  const card = workflow?.chatCard;
  const activity = workflow?.saveActivity ?? (workflow?.activity?.save ? workflow.activity : workflow?.otherActivity?.save ? workflow.otherActivity : null);
  if (!card || !activity?.save || card.flags?.[MODULE_ID]?.saves?.targets?.length || !card.isOwner) return;
  const targets = [...(workflow.targets ?? [])].filter(token => token?.document).map(token => ({
    uuid: token.document.uuid,
    name: globalThis.MidiQOL?.getTokenPlayerName?.(token) || token.name,
    img: token.document.texture?.src ?? token.actor?.img ?? ""
  }));
  if (!targets.length) return;
  await card.setFlag(MODULE_ID, "saves", { ability: firstAbility(activity), dc: Number(activity.save.dc?.value), targets });
}
