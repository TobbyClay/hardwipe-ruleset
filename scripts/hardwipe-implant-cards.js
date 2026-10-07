import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { BODY_REGION_PATHS, BODY_REGION_PINGS, CYBERWARE_SLOTS, CyberwareManager, MIRRORED_BODY_REGIONS } from "./hardwipe-cyberware.js";
import { actionStrip, arrivalWindow, bindBrief, briefHTML, decorateRollCard, placeActions, rarityClasses, saveBlock, saveState } from "./hardwipe-attack-cards.js";

/**
 * Implant cards: an activated cyberware item posts a diagnostic panel. It shows the file name and
 * body region, the default paper doll with that region lit, the activation, charges, the effects it
 * applies and the description. Attack implants carry the verdict and target rows, save implants the
 * save block; the item's own buttons sit in the footer and the roll card stays below.
 */
const DOLL = `modules/${MODULE_ID}/assets/cyberware-body.png`;
const LINE_REGIONS = new Set(["nervous", "dermal"]);
const FOOTER_SKIP = new Set(["rollAttack", "rollSave"]);

export function isImplantCard(message) {
  return message.type === "usage" && CyberwareManager.isCyberware(message.getAssociatedItem?.());
}

/**
 * @param {ChatMessage} message
 * @param {HTMLElement} element
 * @param {object} [attack]  For attack implants: { pending, tone, verdict, targets } (verdict and targets as HTML).
 */
export function renderImplantCard(message, element, attack = null) {
  const content = element.querySelector(".message-content");
  const item = message.getAssociatedItem?.();
  if (!content || !item) return false;
  const activity = message.getAssociatedActivity?.();
  const slot = CYBERWARE_SLOTS.find(entry => entry.type === item.system?.type?.value);
  const t = key => game.i18n.localize(`HARDWIPE.Implant.${key}`);
  element.classList.add("hardwipe-attack-message", "hardwipe-implant-message");
  content.querySelector(":scope > .hardwipe-implant")?.remove();

  const saves = saveState(message, element);
  const rarity = rarityClasses(item);
  const uses = cardUses(message, item, activity);
  const regionLabel = slot ? game.i18n.localize(`HARDWIPE.Cyberware.Slot.${slot.id}`) : "";

  const panel = document.createElement("div");
  // Cyberware can only be used while installed, enabled and repaired, so a card always shows it online.
  // (Its current state is not shown: damage taken later must not change older cards.)
  panel.className = "hardwipe-implant";
  if (arrivalWindow(message, "implant-scan", 1300)) panel.classList.add("is-arriving");
  panel.innerHTML = `
    <div class="hardwipe-implant-bar">
      <span class="hardwipe-implant-led"></span>
      <span class="hardwipe-implant-file">${escapeHTML(fileName(item.name))}</span>
      ${regionLabel ? `<span class="hardwipe-implant-region">${escapeHTML(regionLabel)}</span>` : ""}
      <span class="hardwipe-implant-status">${escapeHTML(t("Online"))}</span>
    </div>
    <div class="hardwipe-implant-body">
      ${slot ? dollHTML(slot.id) : ""}
      <div class="hardwipe-implant-main">
        <span class="hardwipe-implant-kind">${escapeHTML(`${t("Cyberware")} · ${kindLabel(activity)}`)}</span>
        <div class="hardwipe-implant-name">${rarity ? `<span class="hardwipe-gem ${rarity}"></span>` : ""}<b class="hardwipe-item-title ${rarity}">${escapeHTML(item.name)}</b></div>
        ${metaHTML(activity)}
        ${uses ? usesHTML(uses) : ""}
      </div>
    </div>
    ${effectsHTML(activity)}
    ${attack ? `${attack.verdict}${attack.targets}` : ""}
    <div class="hardwipe-implant-saves"></div>
    ${briefHTML(item)}
    <div class="hardwipe-implant-foot"><span class="hardwipe-program-spacer"></span><span class="hardwipe-program-note">${escapeHTML(footNote(uses, t))}</span></div>`;

  if (saves) panel.querySelector(".hardwipe-implant-saves").append(saveBlock(message, saves, { variant: "card" }));
  else panel.querySelector(".hardwipe-implant-saves").remove();

  // The item's own buttons (damage, effects, refund, template) go to the action strip under the roll card.
  const actions = actionStrip(content, "is-implant", action => FOOTER_SKIP.has(action));
  content.prepend(panel);
  element.classList.add("hardwipe-implant-ready");
  bindBrief(message, element, item);
  decorateRollCard(message, element, { pending: !!attack?.pending || !!saves?.pending.length, saveResults: saves, tone: attack?.tone ?? null, locked: !!attack?.locked });
  placeActions(content, panel, actions);
  return true;
}

function fileName(name) {
  const slug = String(name ?? "implant").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${slug || "implant"}.sys`;
}

/** The default paper doll with the implant's region lit; small regions get a ping ring. */
function dollHTML(region) {
  const path = BODY_REGION_PATHS[region];
  if (!path) return "";
  const shape = `class="hardwipe-implant-region-shape${LINE_REGIONS.has(region) ? " is-lines" : ""}" d="${path}"`;
  const mirror = MIRRORED_BODY_REGIONS.has(region) ? `<path ${shape} transform="translate(1024 0) scale(-1 1)"/>` : "";
  // The chat doll is small: rings are drawn larger than on the sheet so they read at that size.
  const pings = (BODY_REGION_PINGS[region] ?? []).map(([cx, cy, r]) => `<circle class="hardwipe-implant-ping" cx="${cx}" cy="${cy}" r="${Math.round(r * 1.8)}"/>`).join("");
  return `<figure class="hardwipe-implant-doll" aria-hidden="true"><svg viewBox="110 25 804 1486" preserveAspectRatio="xMidYMid meet">
    <image href="${DOLL}" x="0" y="0" width="1024" height="1536"/><path ${shape}/>${mirror}${pings}</svg></figure>`;
}

function kindLabel(activity) {
  const t = key => game.i18n.localize(`HARDWIPE.Implant.${key}`);
  if (activity?.type === "attack") {
    const melee = activity.attack?.type?.value === "melee" || ["mwak", "msak"].includes(activity.actionType);
    return t(melee ? "KindMelee" : "KindRanged");
  }
  if (activity?.type === "save") return t("KindSave");
  if (activity?.type === "heal") return t("KindHeal");
  if (activity?.type === "damage") return t("KindDamage");
  if (activity?.activation?.type === "reaction") return t("KindReaction");
  return t("KindActivated");
}

function metaHTML(activity) {
  const labels = activity?.labels ?? {};
  const chips = [labels.activation, labels.target || labels.range, labels.duration && labels.duration !== game.i18n.localize("DND5E.TimeInst") ? labels.duration : ""]
    .filter(value => value && String(value).trim());
  return chips.length ? `<div class="hardwipe-implant-meta">${chips.map(chip => `<span>${escapeHTML(chip)}</span>`).join("")}</div>` : "";
}

/** The activity's own uses, else the item's charges. */
/** The uses shown on a card: as they were when it was posted (flag `uses`), else the item's current uses. */
export function cardUses(message, item, activity) {
  const stored = message.flags?.[MODULE_ID]?.uses;
  if (Number.isFinite(stored?.value) && Number.isFinite(stored?.max) && stored.max > 0) return stored;
  return usesOf(item, activity);
}

export function usesOf(item, activity) {
  for (const uses of [activity?.uses, item.system?.uses]) {
    const max = Number(uses?.max);
    if (!Number.isFinite(max) || max <= 0) continue;
    const value = Number(uses.value ?? Math.max(0, max - Number(uses.spent ?? 0)));
    if (Number.isFinite(value)) return { value: Math.max(0, Math.min(value, max)), max };
  }
  return null;
}

function usesHTML({ value, max }) {
  const label = escapeHTML(game.i18n.localize("HARDWIPE.Implant.Charges"));
  if (max > 8) return `<div class="hardwipe-implant-uses"><span>${label}</span><b>${value}/${max}</b></div>`;
  return `<div class="hardwipe-implant-uses"><span>${label}</span>${Array.from({ length: max }, (_, index) => `<i class="${index < value ? "is-on" : ""}"></i>`).join("")}</div>`;
}

function footNote(uses, t) {
  return uses ? game.i18n.format("HARDWIPE.Implant.ChargesLeft", { value: uses.value, max: uses.max }) : t("AlwaysOn");
}

/** One strip per effect the activity applies: its name and duration. */
export function effectsHTML(activity) {
  // applicableEffects lists references ({ _id, uuid }); the effects themselves hang off activity.effects.
  const applicable = Array.isArray(activity?.applicableEffects) ? new Set(activity.applicableEffects.map(entry => entry?._id)) : null;
  const effects = (activity?.effects ?? []).filter(entry => !applicable || applicable.has(entry._id)).map(entry => entry.effect).filter(effect => effect?.name);
  return effects.map(effect => {
    const duration = effectDuration(effect) || activity?.labels?.duration || "";
    return `<div class="hardwipe-implant-effect"><img src="${escapeHTML(effect.img ?? "")}" alt=""><b>${escapeHTML(effect.name)}</b>${duration ? `<small>${escapeHTML(duration)}</small>` : ""}</div>`;
  }).join("");
}

function effectDuration(effect) {
  const label = effect.duration?.label;
  if (label && typeof label === "string" && label !== game.i18n.localize("None")) return label;
  const seconds = Number(effect.duration?.seconds);
  if (Number.isFinite(seconds) && seconds > 0) {
    if (seconds % 3600 === 0) return game.i18n.format("HARDWIPE.Implant.Hours", { value: seconds / 3600 });
    if (seconds % 60 === 0) return game.i18n.format("HARDWIPE.Implant.Minutes", { value: seconds / 60 });
    return game.i18n.format("HARDWIPE.Implant.Seconds", { value: seconds });
  }
  const rounds = Number(effect.duration?.rounds);
  if (Number.isFinite(rounds) && rounds > 0) return game.i18n.format("HARDWIPE.Implant.Rounds", { value: rounds });
  return "";
}
