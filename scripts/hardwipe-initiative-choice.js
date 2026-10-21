import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";

/**
 * Variant initiative: a skill check can be your initiative. Blending into a crowd when it breaks out, you roll
 * Deception; chasing your target, Athletics. When a player character rolls initiative (from the sheet or the combat
 * tracker), a window asks what they're using and offers ordinary initiative first, then every skill with its bonus.
 * A skill rolls through D&D5e's own initiative roll with the skill's total in place of the initiative modifier, so
 * advantage, Ready Set Midi and the initiative card all work as usual. The GM's Roll All and Roll NPCs stay ordinary
 * initiative.
 *
 * The window takes turns between two voices, each with its own lines:
 *   radio  a pirate call-in show: the host hypes the caller live on air, the dial tunes to the pick
 *   ncpd   a bored NCPD dispatcher watching the fight on a camera feed, with a Post-it on the monitor
 */
const OPTION = "hardwipeSkill";
const THEME_SETTING = "initPickTheme";
export const THEMES = ["radio", "ncpd"];
const BANKS = { radio: 12, ncpd: 12, note: 6 }; // HARDWIPE.InitPick.Radio.Line1…, Cop.Line1…, Cop.Note1…

/* Pure helpers (unit-tested) ----------------------------------------------------------------- */

/** A signed modifier: +3, −1, +0. */
export function signed(value) {
  const n = Number(value) || 0;
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}

/**
 * The dropdown's choices: ordinary initiative first, then every skill by name.
 * @param {{ init: number, initAbility: string, skills: Array<{key: string, label: string, ability: string, total: number, proficient: boolean}> }} data
 * @returns {Array<{value: string, label: string, mod: number, proficient?: boolean}>}
 */
export function initiativeChoices({ init, initAbility, skills }) {
  const sorted = [...skills].sort((a, b) => a.label.localeCompare(b.label));
  return [
    { value: "init", label: initAbility, mod: Number(init) || 0 },
    ...sorted.map(skill => ({ value: skill.key, label: `${skill.label} (${skill.ability})`, mod: Number(skill.total) || 0, proficient: !!skill.proficient }))
  ];
}

/**
 * An initiative roll's parts with the skill in place of the initiative's own modifier: D&D5e's @mod, @prof,
 * @ruleBonus and @alert go (the skill's total covers them), everything else (condition reductions, the tiebreaker)
 * stays after it.
 */
export function skillParts(parts) {
  const replaced = new Set(["@mod", "@prof", "@ruleBonus", "@alert"]);
  return ["@hardwipeSkill", ...(parts ?? []).filter(part => !replaced.has(part))];
}

/** Which line of a bank to show, from a random number in [0, 1). */
export function lineIndex(random, count) {
  return Math.min(count, Math.max(1, Math.floor(random * count) + 1));
}

/** The voice after the last one used: the two take turns. */
export function nextTheme(last) {
  const index = THEMES.indexOf(last);
  return THEMES[(index + 1) % THEMES.length];
}

/** Where the radio dial's needle sits for the n-th of count choices, in percent across the band. */
export function dialPercent(index, count) {
  return count > 1 ? 4 + Math.max(0, Math.min(index, count - 1)) / (count - 1) * 92 : 4;
}

/* Foundry side ----------------------------------------------------------------------------------- */

const t = (key, data) => data ? game.i18n.format(`HARDWIPE.InitPick.${key}`, data) : game.i18n.localize(`HARDWIPE.InitPick.${key}`);

export function registerInitiativeChoice() {
  game.settings.register(MODULE_ID, THEME_SETTING, { scope: "client", config: false, type: String, default: "" });
  if (!globalThis.libWrapper) return;
  libWrapper.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.rollInitiativeDialog", async function (wrapped, rollOptions = {}, dialog = {}) {
    if (!asks(this, rollOptions)) return wrapped(rollOptions, dialog);
    const choice = await pickInitiative(this);
    if (!choice) return;
    // The window was the confirmation: D&D5e's roll dialog is skipped (advantage stays on the initiative card's switch).
    const quiet = { ...dialog, configure: false };
    if (choice === "init") return wrapped(rollOptions, quiet);
    return wrapped({ ...rollOptions, [OPTION]: choice, flavor: t("Flavor", { skill: skillLabel(choice) }) }, quiet);
  }, "MIXED");
  // The chosen skill's total replaces the initiative modifier, proficiency and bonuses; condition penalties and the
  // Dexterity tiebreaker stay.
  Hooks.on("dnd5e.preConfigureInitiative", (actor, config) => {
    const key = config?.options?.[OPTION];
    const skill = key ? actor.system?.skills?.[key] : null;
    if (!skill) return;
    config.data.hardwipeSkill = Number(skill.total) || 0;
    config.parts = skillParts(config.parts);
    config.options.ability = skill.ability;
  });
}

/** Ask a player character, unless initiative uses a fixed score or the skill is already chosen. */
function asks(actor, rollOptions) {
  if (actor?.type !== "character" || rollOptions?.[OPTION]) return false;
  return game.settings.get("dnd5e", "initiativeScore") !== "all";
}

/** A skill's name, from D&D5e's config. */
export function skillLabel(key) {
  const entry = CONFIG.DND5E.skills?.[key];
  return entry ? game.i18n.localize(entry.label ?? key) : key;
}

/** The skill an initiative roll used, if it wasn't ordinary initiative. */
export function initiativeSkill(roll) {
  const key = roll?.options?.[OPTION];
  return key && CONFIG.DND5E.skills?.[key] ? key : null;
}

function choicesFor(actor) {
  const abbr = key => game.i18n.localize(CONFIG.DND5E.abilities?.[key]?.abbreviation ?? key).toUpperCase();
  const init = actor.system?.attributes?.init;
  const initAbility = init?.ability || CONFIG.DND5E.defaultAbilities.initiative;
  const skills = Object.entries(actor.system?.skills ?? {}).filter(([key]) => CONFIG.DND5E.skills?.[key]).map(([key, skill]) => ({
    key, label: skillLabel(key), ability: abbr(skill.ability), total: skill.total, proficient: Number(skill.value ?? skill.proficient) >= 1
  }));
  const choices = initiativeChoices({ init: init?.total ?? init?.mod, initAbility: abbr(initAbility), skills });
  choices[0].label = t("Normal", { ability: choices[0].label });
  return choices;
}

/** This client's next voice; the choice is remembered so the two take turns. */
function takeTurn() {
  let last = "";
  try { last = game.settings.get(MODULE_ID, THEME_SETTING); } catch { last = ""; }
  const theme = nextTheme(last);
  void game.settings.set(MODULE_ID, THEME_SETTING, theme).catch(() => {});
  return theme;
}

/** What the voices can mention: the scene, the round, the hostiles in the fight. */
function fightContext(actor) {
  const combat = game.combat;
  const hostiles = combat?.combatants.filter(combatant => !combatant.hasPlayerOwner && !combatant.isDefeated).length ?? 0;
  return {
    name: actor.name, img: actor.img ?? "", scene: canvas?.scene?.name ?? game.scenes?.current?.name ?? "",
    round: combat?.round || 1, hostiles
  };
}

const line = (bank, count, data) => t(`${bank}${lineIndex(Math.random(), count)}`, data);

function selectHTML(choices) {
  const option = choice => `<option value="${escapeHTML(choice.value)}">${escapeHTML(`${choice.label}  ${signed(choice.mod)}${choice.proficient ? "  ◆" : ""}`)}</option>`;
  return `<select name="choice">${option(choices[0])}<optgroup label="${escapeHTML(t("Skills"))}">${choices.slice(1).map(option).join("")}</optgroup></select>`;
}

/** The pirate call-in show: ON AIR, the host's line, the caller on a live ring, the dial, the signal LCD. */
function radioHTML(context, choices) {
  const listeners = (4000 + Math.floor(Math.random() * 26000)).toLocaleString(game.i18n.lang);
  const wave = Array.from({ length: 44 }, (_, i) => `<i style="height:${5 + Math.round(Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23)) * 15)}px;animation-delay:${((i % 7) * -0.13).toFixed(2)}s"></i>`).join("");
  const ticker = escapeHTML(t("Radio.Ticker", { scene: context.scene, round: context.round }));
  return `<div class="hwr">
    <div class="hwr-booth">
      <div class="hwr-host">
        <div class="hwr-top"><span class="hwr-onair">${escapeHTML(t("Radio.OnAir"))}</span><span class="hwr-listen"><i class="fa-solid fa-headphones" inert></i><b>${escapeHTML(listeners)}</b>▲</span></div>
        <small>${escapeHTML(t("Radio.Host"))}</small>
        <p class="hwr-shout">${escapeHTML(line("Radio.Line", BANKS.radio, { name: context.name }))}</p>
        <div class="hwr-wave" aria-hidden="true">${wave}</div>
      </div>
      <div class="hwr-caller"><div class="hwr-ring"><img src="${escapeHTML(context.img)}" alt=""></div><span>${escapeHTML(t("Radio.Caller"))}<b>${escapeHTML(context.name)}</b></span></div>
    </div>
    <div class="hwr-ticker" aria-hidden="true"><span>${ticker}</span><span>${ticker}</span></div>
    <div class="hwr-deck">
      <div class="hwr-dial" aria-hidden="true"><i class="hwr-scale"></i><div class="hwr-nums"><span>88</span><span>92</span><span>96</span><span>100</span><span>104</span><span>108</span></div><i class="hwr-needle" style="left:${dialPercent(0, choices.length)}%"></i></div>
      <div class="hwr-tune">
        <label><span class="hwr-lbl">${escapeHTML(t("Radio.Pick"))}</span><div class="hwr-pick">${selectHTML(choices)}</div></label>
        <div><span class="hwr-lbl">${escapeHTML(t("Radio.Signal"))}</span><div class="hwr-lcd hardwipe-initpick-mod">${escapeHTML(signed(choices[0].mod))}</div></div>
      </div>
      <div class="hwr-meta"><span>${escapeHTML(t("Radio.OnTheAir"))} <b>1d20 <span class="hardwipe-initpick-mod">${escapeHTML(signed(choices[0].mod))}</span></b></span><span class="hardwipe-initpick-what">${escapeHTML(t("AsInitiative"))}</span></div>
    </div>
  </div>`;
}

/** The precinct workstation: light bar, the camera feed, the subject's file, a Post-it on the monitor. */
function ncpdHTML(context, choices) {
  const now = new Date();
  const clock = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, "0")).join(":");
  const cam = 10 + Math.floor(Math.random() * 40);
  return `<div class="hwn">
    <div class="hwn-bar" aria-hidden="true"><i></i><i></i></div>
    <div class="hwn-screen">
      <div class="hwn-ticker"><span><b>■</b> ${escapeHTML(t("Cop.Ticker", { round: context.round }))}</span><span>${escapeHTML(t("Cop.Hostiles", { n: context.hostiles }))}</span></div>
      <div class="hwn-file">
        <div class="hwn-cam"><img src="${escapeHTML(context.img)}" alt=""><span class="hwn-rec"><i></i>${escapeHTML(t("Cop.Cam", { n: cam }))}</span><span class="hwn-clock">${clock}</span></div>
        <dl>
          <dt>${escapeHTML(t("Cop.Subject"))}</dt><dd>${escapeHTML(context.name)}</dd>
          <dt>${escapeHTML(t("Cop.Status"))}</dt><dd class="is-hot">${escapeHTML(t("Cop.Engaged"))}</dd>
          <dt>${escapeHTML(t("Cop.Sector"))}</dt><dd>${escapeHTML(context.scene)}</dd>
          <dt>${escapeHTML(t("Cop.Watcher"))}</dt><dd>${escapeHTML(t("Cop.WatcherName"))}</dd>
        </dl>
        <div class="hwn-postit">${escapeHTML(line("Cop.Line", BANKS.ncpd, { name: context.name }))}<small>${escapeHTML(line("Cop.Note", BANKS.note))}</small></div>
      </div>
      <div class="hwn-field">
        <label><span class="hwn-lbl">${escapeHTML(t("Cop.Pick"))}</span><div class="hwn-pick">${selectHTML(choices)}</div></label>
        <div><span class="hwn-lbl">${escapeHTML(t("Cop.Mod"))}</span><div class="hwn-mod hardwipe-initpick-mod">${escapeHTML(signed(choices[0].mod))}</div></div>
      </div>
      <div class="hwn-calc">&gt; ${escapeHTML(t("Cop.Roll"))} <b>1d20 <span class="hardwipe-initpick-mod">${escapeHTML(signed(choices[0].mod))}</span></b> · <span class="hardwipe-initpick-what">${escapeHTML(t("AsInitiative"))}</span></div>
    </div>
  </div>`;
}

/**
 * The window, in this turn's voice. Resolves to "init", a skill key, or null.
 * @param {Actor} actor
 * @param {string} [theme]  "radio" or "ncpd"; by default the two take turns.
 */
export async function pickInitiative(actor, theme = takeTurn()) {
  const choices = choicesFor(actor);
  const context = fightContext(actor);
  const radio = theme === "radio";
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: t(radio ? "Radio.Title" : "Cop.Title"), icon: radio ? "fa-solid fa-tower-broadcast" : "fa-solid fa-shield-halved", resizable: true },
    classes: ["hardwipe-dialog", "is-initiative", "hardwipe-initpick", `is-${theme}`],
    position: { width: 420 },
    content: radio ? radioHTML(context, choices) : ncpdHTML(context, choices),
    buttons: [
      { action: "roll", label: t(radio ? "Radio.Go" : "Cop.Go"), default: true, callback: (event, button) => button.form.elements.choice.value },
      { action: "cancel", label: t(radio ? "Radio.Cancel" : "Cop.Cancel") }
    ],
    render: (event, dialog) => {
      const select = dialog.element.querySelector("select[name=choice]");
      const needle = dialog.element.querySelector(".hwr-needle");
      select?.addEventListener("change", () => {
        const index = choices.findIndex(choice => choice.value === select.value);
        const choice = choices[index];
        dialog.element.querySelectorAll(".hardwipe-initpick-mod").forEach(node => { node.textContent = signed(choice?.mod); });
        dialog.element.querySelectorAll(".hardwipe-initpick-what").forEach(node => {
          node.textContent = choice?.value === "init" ? t("AsInitiative") : t("SkillAsInitiative", { skill: skillLabel(choice.value) });
        });
        if (needle) needle.style.left = `${dialPercent(index, choices.length)}%`;
      });
      select?.focus();
    },
    rejectClose: false
  });
  return answer && answer !== "cancel" ? answer : null;
}
