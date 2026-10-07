import { escapeHTML, plainActivityLabel } from "./hardwipe-state.js";
import { CyberwareManager } from "./hardwipe-cyberware.js";
import { abilityColor, actionStrip, bindBrief, briefHTML, decorateRollCard, placeActions, rarityClasses, saveBlock, saveState } from "./hardwipe-attack-cards.js";
import { cardUses, effectsHTML } from "./hardwipe-implant-cards.js";

/**
 * Item and feature cards: every other item use (potions, tools, gear, class features, feats,
 * monster abilities) posts a spec panel. A bar names the kind (item type and rarity, or the feature
 * and where it comes from); the item's image, name and activity follow, then its activation chips,
 * uses, checks, effects, the save block and the description. The roll card follows, and the item's
 * own buttons sit in a strip under it. Items read in phosphor green, features in signal orange.
 */
const FEATURE_TYPES = new Set(["feat", "race", "background", "class", "subclass"]);
const KIND_ICONS = { attack: "fa-crosshairs", check: "fa-dice-d20", damage: "fa-burst", heal: "fa-heart-pulse", save: "fa-shield-halved", summon: "fa-ghost", utility: "fa-gear" };

export function isGearCard(message) {
  if (message.type !== "usage") return false;
  const item = message.getAssociatedItem?.();
  return !!item && item.type !== "spell" && !CyberwareManager.isCyberware(item);
}

export function renderGearCard(message, element) {
  const content = element.querySelector(".message-content");
  const item = message.getAssociatedItem?.();
  if (!content || !item) return false;
  const activity = message.getAssociatedActivity?.();
  const feature = FEATURE_TYPES.has(item.type);
  const t = key => game.i18n.localize(`HARDWIPE.Gear.${key}`);
  element.classList.add("hardwipe-attack-message", "hardwipe-gear-message");
  content.querySelector(":scope > .hardwipe-gear")?.remove();

  const saves = saveState(message, element);
  const rarity = feature ? "" : rarityClasses(item);
  const uses = cardUses(message, item, activity);
  const recovery = recoveryLabel(item, activity);
  const side = feature ? String(item.system?.requirements ?? "").trim() : quantityLabel(item);
  const panel = document.createElement("div");
  panel.className = `hardwipe-gear ${feature ? "is-feature" : "is-item"}`;
  panel.innerHTML = `
    <div class="hardwipe-gear-bar">
      <span class="hardwipe-gear-tag"><i class="fas ${feature ? "fa-bolt" : "fa-box-open"}" inert></i>${escapeHTML(tagLabel(item, feature))}</span>
      ${side ? `<span class="hardwipe-gear-side">${escapeHTML(side)}</span>` : ""}
    </div>
    <div class="hardwipe-gear-body">
      <span class="hardwipe-gear-icon"><img src="${escapeHTML(item.img ?? "")}" alt=""></span>
      <div class="hardwipe-gear-main">
        <div class="hardwipe-gear-name">${rarity ? `<span class="hardwipe-gem ${rarity}"></span>` : ""}<b class="hardwipe-item-title ${rarity}">${escapeHTML(item.name)}</b></div>
        ${activityHTML(activity)}
      </div>
    </div>
    ${chipsHTML(item, activity)}
    ${uses ? usesHTML(uses, recovery, t) : ""}
    ${infoRowsHTML(content)}
    ${effectsHTML(activity)}
    <div class="hardwipe-gear-saves"></div>
    ${briefHTML(item)}`;

  const slot = panel.querySelector(".hardwipe-gear-saves");
  if (saves) slot.append(saveBlock(message, saves, { variant: "card" }));
  const checks = checkResults(message);
  if (checks) slot.append(checks);
  if (!slot.childElementCount) slot.remove();

  // The action strip under the rolls. A save button gives way to the save block when the card knows who must save.
  const actions = actionStrip(content, feature ? "is-feature" : "is-item", action => action === "rollAttack" || (!!saves && action === "rollSave"));
  content.prepend(panel);
  element.classList.add("hardwipe-gear-ready");
  bindBrief(message, element, item);
  decorateRollCard(message, element, { pending: !!saves?.pending.length, saveResults: saves });
  placeActions(content, panel, actions);
  return true;
}

/**
 * The checks rolled from this card (a tool's lock-picking check, say): who rolled, the total and
 * success or failure against the DC when the viewer may see it. Ready Set Midi folds those check
 * messages into the card it came from, so the card lists them.
 */
function checkResults(message) {
  const rolls = game.messages.filter(entry => entry.type === "check" && entry.id !== message.id
    && (entry.flags?.dnd5e?.originatingMessage === message.id || entry._source?.system?.origin === message.id));
  if (!rolls.length) return null;
  const t = key => game.i18n.localize(`HARDWIPE.Check.${key}`);
  const first = rolls[0];
  const ability = first.system?.ability;
  const abbr = String(CONFIG.DND5E.abilities?.[ability]?.abbreviation ?? ability ?? "").toUpperCase();
  const dc = Number(first.rolls?.[0]?.options?.target);
  const block = document.createElement("div");
  block.className = "hardwipe-save-block is-card is-check";
  block.style.setProperty("--hw-save", abilityColor(ability));
  const rows = rolls.map(entry => {
    const roll = entry.rolls?.[0];
    const target = Number(roll?.options?.target);
    const visible = Number.isFinite(target) && entry.shouldDisplayChallenge !== false;
    const success = visible ? (roll.isSuccess ?? Number(roll.total) >= target) : null;
    const status = success === null ? "rolled" : success ? "saved" : "failed";
    const label = success === null ? "" : t(success ? "Success" : "Failure");
    return `<div class="hardwipe-save-row is-${status}"><span class="hardwipe-save-who"><span>${escapeHTML(entry.speaker?.alias ?? entry.author?.name ?? "")}</span></span>
      <em>${escapeHTML(roll?.total ?? "—")}</em><b>${escapeHTML(label)}</b></div>`;
  }).join("");
  const dcLabel = Number.isFinite(dc) && first.shouldDisplayChallenge !== false ? ` · ${game.i18n.format("HARDWIPE.Check.DC", { dc })}` : "";
  block.innerHTML = `<div class="hardwipe-save-title"><span>${escapeHTML(t("Results"))}</span><b>${escapeHTML(abbr)}${escapeHTML(dcLabel)}</b></div>
    <div class="hardwipe-save-rows">${rows}</div>`;
  return block;
}

/** "Consumable · Potion · Rare", or "Feature · Class Feature". */
function tagLabel(item, feature) {
  const typeLabel = game.i18n.localize(CONFIG.Item.typeLabels?.[item.type] ?? item.type);
  const subtype = item.system?.type?.label ?? "";
  const rarity = item.system?.rarity;
  // Common is the default rarity: left out of the bar.
  const rarityLabel = rarity && rarity !== "common" ? game.i18n.localize(CONFIG.DND5E.itemRarity?.[rarity] ?? rarity) : "";
  const parts = feature ? [game.i18n.localize("HARDWIPE.Gear.Feature"), subtype] : [typeLabel, subtype, rarityLabel];
  return [...new Set(parts.filter(Boolean).map(String))].join(" · ");
}

function quantityLabel(item) {
  const quantity = Number(item.system?.quantity);
  if (!Number.isFinite(quantity) || (quantity <= 1 && item.type !== "consumable")) return "";
  return game.i18n.format("HARDWIPE.Gear.Quantity", { value: quantity });
}

/** The activity's icon, name and kind: "Consume · Heal". */
function activityHTML(activity) {
  if (!activity) return "";
  const kind = plainActivityLabel(game.i18n.localize(activity.metadata?.title ?? ""));
  const name = plainActivityLabel(activity.name) || kind;
  const icon = activity.img ? `<dnd5e-icon src="${escapeHTML(activity.img)}"></dnd5e-icon>` : `<i class="fas ${KIND_ICONS[activity.type] ?? "fa-gear"}" inert></i>`;
  return `<div class="hardwipe-gear-activity">${icon}<b>${escapeHTML(name)}</b>${kind && kind !== name ? `<span>${escapeHTML(kind)}</span>` : ""}</div>`;
}

/** Activation, range or target, duration, concentration and the item's properties as chips. */
function chipsHTML(item, activity) {
  const labels = activity?.labels ?? {};
  const instant = game.i18n.localize("DND5E.TimeInst");
  const chips = [];
  const add = (icon, label) => {
    const text = String(label ?? "").trim();
    if (text && !chips.some(([, existing]) => existing === text)) chips.push([icon, text]);
  };
  add("fa-bolt", labels.activation);
  add("fa-ruler-horizontal", labels.range);
  add("fa-bullseye", labels.target);
  if (labels.duration !== instant) add("fa-hourglass-half", labels.duration);
  if (activity?.duration?.concentration) add("fa-brain", game.i18n.localize("DND5E.Concentration"));
  for (const property of item.labels?.properties ?? []) add("fa-tag", property.label ?? property);
  if (!chips.length) return "";
  return `<div class="hardwipe-props">${chips.map(([icon, label]) => `<span class="hardwipe-prop"><i class="fas ${icon}" inert></i>${escapeHTML(label)}</span>`).join("")}</div>`;
}

/** The recovery period of the uses shown (the activity's own uses first, as usesOf picks them). */
function recoveryLabel(item, activity) {
  const source = Number(activity?.uses?.max) > 0 ? activity.uses : item.system?.uses;
  const period = source?.recovery?.[0]?.period;
  const config = period && CONFIG.DND5E.limitedUsePeriods?.[period];
  return config ? game.i18n.localize(config.label ?? config) : "";
}

function usesHTML({ value, max }, recovery, t) {
  const pips = max > 8 ? "" : Array.from({ length: max }, (_, index) => `<i class="${index < value ? "is-on" : ""}"></i>`).join("");
  return `<div class="hardwipe-gear-uses"><span>${escapeHTML(t("Uses"))}</span>${pips}<b>${value}/${max}</b>${recovery ? `<small>${escapeHTML(recovery)}</small>` : ""}</div>`;
}

/** dnd5e's other summary rows (the check a tool asks for, a save's DC) as plain info lines. */
function infoRowsHTML(content) {
  const rows = [];
  for (const row of content.querySelectorAll(".chat-card > section.icon-row")) {
    const icon = row.querySelector(":scope > i");
    const pills = [...row.querySelectorAll(":scope > ul.pills .label")].map(node => node.textContent.trim()).filter(Boolean);
    if (!icon || !pills.length || icon.classList.contains("fa-tag")) continue;
    const classes = [...icon.classList].filter(name => name.startsWith("fa-") && name !== "fa-fw").join(" ");
    rows.push(`<div class="hardwipe-gear-info"><i class="fa-solid ${escapeHTML(classes)}" inert></i><span>${escapeHTML(pills.join(" · "))}</span></div>`);
  }
  return rows.join("");
}
