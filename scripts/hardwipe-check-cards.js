import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { abilityColor, advControlHTML, d20Drawer, settleD20 } from "./hardwipe-attack-cards.js";

/**
 * Check cards: ability checks, skill and tool checks, saving throws, death saves and initiative post
 * a compact Hardwipe panel. A bar in the ability's colour names the roll type, the skill or ability
 * is the title, the advantage switch sits beside it, and the roll itself (one box, the natural d20 on
 * its corner) opens its dice in a drawer. A DC shows success or failure when the viewer may see it.
 */
const KIND_ICONS = {
  skill: "fa-user-check", tool: "fa-screwdriver-wrench", ability: "fa-dice-d20", save: "fa-shield-halved",
  death: "fa-heart-pulse", concentration: "fa-brain", initiative: "fa-bolt"
};

export function isCheckCard(message) {
  if (!["check", "save"].includes(message.type) && !message.flags?.core?.initiativeRoll) return false;
  return (message.rolls ?? []).some(roll => roll instanceof CONFIG.Dice.D20Roll);
}

export function renderCheckCard(message, element) {
  const content = element.querySelector(".message-content");
  if (!content || content.querySelector(":scope > .hardwipe-check")) return false;
  const button = content.querySelector("button.dice-roll");
  const roll = (message.rolls ?? []).find(entry => entry instanceof CONFIG.Dice.D20Roll);
  if (!button || !roll) return false;
  const info = checkInfo(message, roll);
  const breakdown = button.nextElementSibling?.classList.contains("roll-breakdown") ? button.nextElementSibling : null;
  const row = button.parentElement?.closest(".message-content > *");
  element.classList.add("hardwipe-check-message");

  const panel = document.createElement("div");
  panel.className = `hardwipe-check is-${info.kind}`;
  panel.style.setProperty("--hw-check", info.color);
  const result = challenge(message, roll);
  if (result) panel.dataset.hwResult = result.state;
  const t = key => game.i18n.localize(`HARDWIPE.Check.${key}`);
  panel.innerHTML = `
    <div class="hardwipe-check-bar">
      <span class="hardwipe-check-kind"><i class="fas ${KIND_ICONS[info.kind] ?? "fa-dice-d20"}" inert></i>${escapeHTML(info.kindLabel)}</span>
      ${info.abbr ? `<span class="hardwipe-check-abbr">${escapeHTML(info.abbr)}</span>` : ""}
    </div>
    <div class="hardwipe-check-head">
      <div class="hardwipe-check-name"><b>${escapeHTML(info.title)}</b>${info.sub ? `<small>${escapeHTML(info.sub)}</small>` : ""}</div>
      ${advControlHTML(message, roll, button.dataset.rsmRollKey || "", {})}
    </div>
    <div class="hardwipe-check-roll"></div>
    ${result ? `<div class="hardwipe-check-result is-${result.state}">
      <span>${escapeHTML(game.i18n.format("HARDWIPE.Check.DC", { dc: result.dc }))}</span>
      <b>${escapeHTML(t(result.state === "success" ? "Success" : "Failure"))}</b>
      <i class="fas ${result.state === "success" ? "fa-check" : "fa-xmark"}" inert></i>
    </div>` : ""}`;
  if (info.kind === "concentration") concentrationHTML(message, panel, result, content);
  const slot = panel.querySelector(".hardwipe-check-roll");
  slot.append(button);
  if (breakdown) slot.append(breakdown);
  // The row the roll came from (dnd5e's die icon and the roll) is now empty.
  row?.classList.add("hardwipe-check-source");
  content.prepend(panel);
  d20Drawer(message, button, roll, info.title, "check");
  settleD20(message, button);
  return true;
}

function checkInfo(message, roll) {
  const system = message.system ?? {};
  const abilities = CONFIG.DND5E.abilities ?? {};
  const label = key => (key ? game.i18n.localize(key) : "");
  const t = key => game.i18n.localize(`HARDWIPE.Check.${key}`);
  const ability = system.ability ?? roll.options?.ability ?? null;
  const abilityLabel = label(abilities[ability]?.label) || ability || "";
  const abbr = String(abilities[ability]?.abbreviation ?? ability ?? "").toUpperCase();
  const color = abilityColor(ability);
  if (message.flags?.core?.initiativeRoll || system.type === "initiative") {
    return { kind: "initiative", kindLabel: t("KindCombat"), title: t("Initiative"), sub: "", abbr, color: "var(--hw-cyan)" };
  }
  if (message.type === "save") {
    if (system.type === "death") return { kind: "death", kindLabel: t("KindSave"), title: t("DeathSave"), sub: "", abbr: "", color: "var(--hw-alert)" };
    if (system.type === "concentration") {
      const held = (message.flags?.[MODULE_ID]?.concentration?.names ?? []).join(", ");
      return { kind: "concentration", kindLabel: t("KindConcentration"), title: abilityLabel, sub: held ? game.i18n.format("HARDWIPE.Check.Holding", { names: held }) : "", abbr, color };
    }
    return { kind: "save", kindLabel: t("KindSave"), title: abilityLabel, sub: "", abbr, color };
  }
  if (system.skill) {
    const skill = label(CONFIG.DND5E.skills?.[system.skill]?.label) || system.skill;
    return { kind: "skill", kindLabel: t("KindSkill"), title: skill, sub: abilityLabel, abbr, color };
  }
  if (system.tool) {
    let tool = "";
    try { tool = dnd5e.documents.Trait.keyLabel(system.tool, { trait: "tool" }); } catch { tool = ""; }
    tool ||= message.getAssociatedItem?.()?.name || system.tool;
    return { kind: "tool", kindLabel: t("KindTool"), title: tool, sub: abilityLabel, abbr, color };
  }
  return { kind: "ability", kindLabel: t("KindAbility"), title: abilityLabel || t("KindAbility"), sub: "", abbr, color };
}

/**
 * Concentration: the spells held when the save was rolled (recorded on the card as it is posted). A
 * success notes Concentration held; a failure stamps the card Concentration lost. While the
 * concentration effect is still on the actor (Ready Set Midi ends it itself on a failure unless set
 * not to), its owner and the GM get dnd5e's own Break Concentration button, as End concentration.
 */
function concentrationHTML(message, panel, result, content) {
  const stored = message.flags?.[MODULE_ID]?.concentration;
  const native = content.querySelector('.chat-card button[data-action="breakConcentration"]');
  native?.remove();
  if (!result) return;
  const names = (stored?.names ?? []).join(", ");
  const t = key => game.i18n.localize(`HARDWIPE.Check.${key}`);
  const row = document.createElement("div");
  if (result.state === "success") {
    row.className = "hardwipe-conc is-held";
    row.innerHTML = `<i class="fas fa-brain" inert></i><span>${escapeHTML(t("ConcentrationHeld"))}${names ? ` · ${escapeHTML(names)}` : ""}</span>`;
  } else {
    row.className = "hardwipe-conc is-lost";
    row.innerHTML = `<span class="hardwipe-stamp is-flatlined">${escapeHTML(t("ConcentrationLost"))}</span><span>${escapeHTML(names)}</span>`;
  }
  const actor = ChatMessage.implementation.getSpeakerActor(message.speaker);
  const live = (stored?.effects ?? []).some(id => actor?.effects?.get(id));
  if (native && live && actor?.isOwner) {
    native.className = "hardwipe-conc-end";
    native.innerHTML = `<i class="fas fa-power-off" inert></i>${escapeHTML(t("ConcentrationEnd"))}`;
    row.append(native);
  }
  panel.append(row);
}

/** Success or failure against the roll's DC, when it has one and this viewer may see it. */
function challenge(message, roll) {
  const dc = Number(roll.options?.target);
  if (!Number.isFinite(dc) || message.shouldDisplayChallenge === false) return null;
  const success = roll.isSuccess ?? (Number(roll.total) >= dc);
  return { dc, state: success ? "success" : "failure" };
}
