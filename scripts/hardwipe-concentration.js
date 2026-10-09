import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { spellColor, schoolColor } from "./hardwipe-attack-cards.js";
import { browserChrome, processId as pid } from "./hardwipe-spell-cards.js";

/**
 * Concentration requests as the held spell's program window. When a concentrating character takes
 * damage, dnd5e (or Ready Set Midi's chat mode) whispers a request to roll a Concentration save. That
 * request becomes the spell's .prg window with an interrupt screen and a Roll CON save button: the
 * player or the GM rolls it themselves (Ready Set Midi's automatic roll is switched off for these
 * requests). When the save lands, the window shows Recovered or Flatlined, and the save's own card
 * collapses under it. dnd5e's "can't concentrate" prompt (unconscious or incapacitated) becomes the
 * Host offline screen with End program.
 */
const FLAG = "concentrationCheck";
const RSM_SCOPE = "midi-qol";
// Damage just taken, per actor: the request is created moments after on the same client.
const lastDamage = new Map();
const DAMAGE_WINDOW_MS = 5000;

export function registerConcentrationCards() {
  Hooks.on("dnd5e.damageActor", (actor, changes) => {
    if (Number(changes?.total) < 0) lastDamage.set(actor.uuid, { amount: -Number(changes.total), at: Date.now() });
  });
  Hooks.on("preCreateChatMessage", message => snapshot(message));
  Hooks.once("setup", () => Hooks.on("dnd5e.renderChatMessage", (message, html) => render(message, html)));
  Hooks.on("createChatMessage", message => {
    if (isConcentrationSave(message)) refresh(message.speaker?.actor);
  });
  Hooks.on("deleteActiveEffect", effect => {
    if (effect.statuses?.has?.(CONFIG.specialStatusEffects?.CONCENTRATING ?? "concentrating")) refresh(effect.parent?.id);
  });
  document.addEventListener("click", onClick, true);
}

/* Recognising the messages ------------------------------------------------------------------- */

/** dnd5e 6.0.5 posts both as "prompt" messages whose buttons say what they ask for. */
function promptButton(message, type) {
  return message.type === "prompt" ? (message.system?.buttons ?? []).find(button => button.type === type) ?? null : null;
}

/**
 * "check" for a request to roll the save, "end" for dnd5e's end-concentration prompt. Ready Set Midi's
 * chat mode posts its own request card (HTML with data-action="concentration").
 */
function requestKind(message) {
  if (promptButton(message, "concentration")) return "check";
  if (promptButton(message, "endConcentration")) return "end";
  const html = String(message.content ?? "");
  if (!html.includes("request-card")) return null;
  if (/data-action="concentration"/.test(html)) return "check";
  if (/data-action="endConcentration"/.test(html)) return "end";
  return null;
}

function isConcentrationSave(message) {
  return message.type === "save" && message.system?.type === "concentration";
}

const speakerActor = message => ChatMessage.implementation.getSpeakerActor(message.speaker);

/* Snapshot ------------------------------------------------------------------------------------ */

function originItem(effect) {
  try {
    const origin = effect.origin ? foundry.utils.fromUuidSync(effect.origin) : null;
    return origin?.documentName === "Item" ? origin : origin?.item ?? null;
  } catch { return null; }
}

/** What was held when the request was posted: the spells, their effects, the DC and the damage behind it. */
function snapshot(message) {
  const kind = requestKind(message);
  if (!kind) return;
  const actor = speakerActor(message);
  if (!actor) return;
  const effects = [...(actor.concentration?.effects ?? [])];
  const spells = effects.map(effect => {
    const item = originItem(effect);
    return {
      name: item?.name ?? String(effect.name ?? "").replace(/^[^:]*:\s*/, ""),
      uuid: item?.uuid ?? null, school: item?.system?.school ?? null,
      // Seconds the program has been running (world time since the effect started).
      uptime: Math.max(0, Math.round(game.time.worldTime - (Number(effect.duration?.startTime) || game.time.worldTime)))
    };
  });
  const button = promptButton(message, "concentration");
  const dc = Number(button?.dc ?? String(message.content).match(/data-dc="(\d+)"/)?.[1]) || null;
  // dnd5e stores "" for the default ability (Constitution).
  const ability = button?.ability || String(message.content).match(/data-ability="(\w+)"/)?.[1] || actor.system.attributes?.concentration?.ability
    || CONFIG.DND5E.defaultAbilities?.concentration || "con";
  const hit = lastDamage.get(actor.uuid);
  const damage = hit && Date.now() - hit.at < DAMAGE_WINDOW_MS ? hit.amount : null;
  const update = { [`flags.${MODULE_ID}.${FLAG}`]: { kind, dc, ability, damage, spells, effects: effects.map(e => e.id) } };
  // Players and the GM roll this save themselves: Ready Set Midi skips requests it believes rolled.
  if (kind === "check") update[`flags.${RSM_SCOPE}.concentrationRolled`] = true;
  message.updateSource(update);
}

/* Linking a request and its save ---------------------------------------------------------------- */

/** Unlinked tokens can share an Actor ID; their concentration requests belong to distinct speakers. */
function sameSpeaker(left, right) {
  const a = left?.speaker ?? {};
  const b = right?.speaker ?? {};
  if (a.token || b.token) return !!a.token && a.token === b.token && a.scene === b.scene;
  return !!a.actor && a.actor === b.actor;
}

/** The Concentration save rolled for a request: the next one for that speaker, before any newer request. */
function linkedSave(request) {
  const messages = game.messages.contents;
  for (let i = messages.indexOf(request) + 1; i < messages.length; i++) {
    const message = messages[i];
    if (!sameSpeaker(message, request)) continue;
    if (message.flags?.[MODULE_ID]?.[FLAG]) return null;
    if (isConcentrationSave(message)) return message;
  }
  return null;
}

/** A newer concentration request for the same speaker, posted before this one was answered. */
function superseded(request) {
  const messages = game.messages.contents;
  return messages.slice(messages.indexOf(request) + 1).some(message => sameSpeaker(message, request) && message.flags?.[MODULE_ID]?.[FLAG]);
}

/** The request a Concentration save answers, if it was rolled for one. */
function linkedRequest(save) {
  const messages = game.messages.contents;
  for (let i = messages.indexOf(save) - 1; i >= 0; i--) {
    const message = messages[i];
    if (!sameSpeaker(message, save)) continue;
    if (isConcentrationSave(message)) return null;
    const kind = message.flags?.[MODULE_ID]?.[FLAG]?.kind;
    if (kind) return kind === "check" ? message : null;
  }
  return null;
}

/** Redraw an actor's recent concentration requests and saves. */
function refresh(actorId) {
  if (!actorId) return;
  for (const message of game.messages.contents.slice(-40)) {
    if (message.speaker?.actor !== actorId) continue;
    if (message.flags?.[MODULE_ID]?.[FLAG] || isConcentrationSave(message)) ui.chat?.updateMessage?.(message);
  }
}

/* Rendering ----------------------------------------------------------------------------------- */

const t = (key, data) => data ? game.i18n.format(`HARDWIPE.Conc.${key}`, data) : game.i18n.localize(`HARDWIPE.Conc.${key}`);
const slug = name => String(name ?? "program").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s-]+/g, "_") || "program";
const uptime = seconds => [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, "0")).join(":");

function rollResult(save, dc) {
  if (!save?.isContentVisible) return null;
  const roll = save?.rolls?.[0];
  if (!roll) return null;
  const total = Number(roll.total);
  const natural = Number(roll.d20?.total ?? roll.dice?.[0]?.total);
  const target = Number(roll.options?.target) || dc;
  const success = roll.isSuccess ?? (Number.isFinite(target) ? total >= target : null);
  return { total, natural, bonus: Number.isFinite(natural) ? total - natural : null, target, success };
}

function render(message, html) {
  const element = html?.querySelector ? html : html?.[0];
  if (!element) return;
  if (isConcentrationSave(message)) return collapseSave(message, element);
  const data = message.flags?.[MODULE_ID]?.[FLAG];
  if (!data || !message.isContentVisible) return;
  const content = element.querySelector(".message-content");
  if (!content || content.querySelector(":scope > .hardwipe-concprg")) return;
  const actor = speakerActor(message);
  const spells = data.spells?.length ? data.spells : [{ name: t("Program") }];
  const first = spells[0];
  const item = first.uuid ? foundry.utils.fromUuidSync(first.uuid) : null;
  const color = item ? spellColor(message, item) : schoolColor(first.school) ?? "#b48cff";
  const live = (data.effects ?? []).some(id => actor?.effects?.get(id));
  const owner = !!actor?.isOwner;
  const save = data.kind === "check" ? linkedSave(message) : null;
  const result = rollResult(save, data.dc);
  // A private answer still prevents duplicate rolls, but its result belongs only to its recipients.
  const privateAnswer = !!save && !save.isContentVisible;
  // An unanswered request is stale once a newer one replaces it or the program has stopped.
  const stale = data.kind === "check" && !result && (!live || superseded(message));
  const state = data.kind === "end" ? (live ? "offline" : "ended")
    : !result ? "interrupt" : result.success ? "held" : "lost";

  const file = `${slug(first.name)}.prg`;
  const names = spells.map(spell => spell.name).join(", ");
  const status = { interrupt: ["Interrupt", "is-running is-blink"], held: ["Stable", ""], lost: ["Crashed", "is-crashed"], offline: ["NotResponding", "is-crashed is-blink"], ended: ["Closed", "is-crashed"] }[state];
  const abilityLabel = String(CONFIG.DND5E.abilities?.[data.ability]?.abbreviation ?? data.ability ?? "con").toUpperCase();
  const tags = [
    // Uptime only once world time has moved (in combat, six seconds a round).
    first.uptime > 0 ? `<span>${escapeHTML(t("Up", { time: uptime(first.uptime) }))}</span>` : "",
    first.school && CONFIG.DND5E.spellSchools?.[first.school] ? `<span>${escapeHTML(game.i18n.localize(CONFIG.DND5E.spellSchools[first.school].label))}</span>` : "",
    data.kind === "end" ? `<span class="is-alert"><i class="fas fa-bed" inert></i>${escapeHTML(t("HostDown"))}</span>`
      : data.damage ? `<span class="is-alert"><i class="fas fa-bolt" inert></i>${escapeHTML(t("Damage", { damage: data.damage }))}</span>` : ""
  ].join("");
  const rollLine = result && Number.isFinite(result.natural) ? `<div class="hardwipe-conc-roll"><span class="die">${result.natural}</span>`
    + `<span>${escapeHTML(t("RollLine", { natural: result.natural, ability: abilityLabel, bonus: result.bonus, total: result.total }))}</span>`
    + `<b>${result.success ? "≥" : "<"} ${escapeHTML(t("DC", { dc: result.target }))}</b></div>` : "";
  const spellName = `<span class="hardwipe-conc-spell">${escapeHTML(file)}</span>`;
  const screens = {
    interrupt: `<div class="hardwipe-conc-screen is-interrupt"><div class="face">!</div>
      <div class="title">${t("InterruptTitle", { program: spellName })}</div>
      <div class="text">${data.damage ? t("InterruptDamage", { damage: `<b>${data.damage}</b>` }) : t("InterruptHit")} ${t("InterruptCheck", { ability: `<b>${escapeHTML(game.i18n.localize(CONFIG.DND5E.abilities?.[data.ability]?.label ?? "DND5E.AbilityCon"))}</b>`, dc: `<b>${data.dc ?? 10}</b>` })}</div>
      ${privateAnswer ? `<div class="pct">${escapeHTML(t("FootHandled"))}</div>` : stale ? `<div class="pct">${escapeHTML(t(live ? "Superseded" : "NotRunning"))}</div>` : owner ? `<button type="button" class="hardwipe-conc-save" data-hw-conc="roll"><i class="fas fa-dice-d20" inert></i><span>${escapeHTML(t("Roll", { ability: abilityLabel }))}</span><small>${escapeHTML(t("DC", { dc: data.dc ?? 10 }))}</small></button>
        <div class="note">${escapeHTML(t("FailNote"))}</div>`
        : `<div class="pct">${escapeHTML(t("Waiting", { name: actor?.name ?? "" }))}</div>`}</div>`,
    held: `<div class="hardwipe-conc-screen is-held"><div class="face">:)</div>
      <div class="title">${t("HeldTitle", { program: spellName })}</div>
      <div class="text">${escapeHTML(t("HeldText"))}</div>${rollLine}</div>`,
    lost: `<div class="hardwipe-conc-screen is-lost"><div class="face">:(</div>
      <div class="title">${escapeHTML(t("LostTitle"))}</div>
      <div class="text">${t("LostText", { program: spellName })}</div>${rollLine}
      <div class="pct">${escapeHTML(t("CoreDump"))}</div>
      <div class="dump"><span class="qr" aria-hidden="true"></span><span class="code">${escapeHTML(t("StopCode"))} <b>CONCENTRATION_LOST</b><br>${escapeHTML([data.damage ? t("Damage", { damage: data.damage }) : "", result ? `${abilityLabel} ${result.total} < ${t("DC", { dc: result.target })}` : ""].filter(Boolean).join(" · "))}<br>${escapeHTML(t("Failed", { file }))}</span></div></div>`,
    offline: `<div class="hardwipe-conc-screen is-lost"><div class="face">zZ</div>
      <div class="title">${escapeHTML(t("OfflineTitle"))}</div>
      <div class="text">${t("OfflineText", { program: spellName })}</div>
      ${owner ? `<div class="acts"><button type="button" class="hardwipe-conc-end" data-hw-conc="end"><i class="fas fa-power-off" inert></i>${escapeHTML(t("End"))}</button></div>` : ""}</div>`,
    ended: `<div class="hardwipe-conc-screen is-lost"><div class="face">zZ</div>
      <div class="title">${escapeHTML(t("OfflineTitle"))}</div>
      <div class="text">${t("EndedText", { program: spellName })}</div></div>`
  };
  const foot = privateAnswer ? [t("FootHandled"), ""] : {
    interrupt: [t("FootConcentration"), t("FootAwaiting")], held: [t("FootHandled"), "Exit 0"], lost: [t("FootLost"), "Exit 139"],
    offline: [t("FootConcentration"), t("HostDown")], ended: [t("FootLost"), "Exit 0"]
  }[state];
  const red = ["lost", "offline", "ended"].includes(state);
  const processId = pid(data.effects?.[0] ?? message.id);
  const siteIcon = { interrupt: "fa-triangle-exclamation", held: "fa-lock", lost: "fa-circle-exclamation", offline: "fa-plug-circle-xmark", ended: "fa-circle-xmark" }[state];

  const panel = document.createElement("div");
  panel.className = `hardwipe-program hardwipe-concprg is-${state}`;
  panel.style.setProperty("--acc", color);
  panel.innerHTML = `
    ${browserChrome({ tabs: [{ label: file }], host: slug(actor?.name ?? "host"), pid: processId, icon: siteIcon, status: t(`Status.${status[0]}`), tone: status[1] })}
    <div class="hardwipe-program-body">
      <div class="hardwipe-conc-head">
        <div class="hardwipe-program-name"><b>${escapeHTML(names)}</b></div>
        <div class="hardwipe-conc-pid">${escapeHTML(t("Pid", { pid: processId }))} · ${escapeHTML(t(["lost", "ended"].includes(state) ? "Terminated" : "Concentration"))}</div>
        <div class="hardwipe-program-meta">${tags}</div>
      </div>
      ${screens[state]}
    </div>
    <div class="hardwipe-program-foot hardwipe-conc-foot"><span>${escapeHTML(foot[0])}</span><span class="sp"></span><span class="${red ? "is-red" : ""}">${escapeHTML(foot[1])}</span></div>`;
  content.replaceChildren(panel);
  element.classList.add("hardwipe-conc-message");
}

/** A save rolled from a request is shown in that request's window; its own card collapses to a line. */
function collapseSave(message, element) {
  if (!message.isContentVisible) return;
  const request = linkedRequest(message);
  if (!request?.isContentVisible) return;
  const content = element.querySelector(".message-content");
  if (!content || content.querySelector(":scope > .hardwipe-conc-linked")) return;
  const file = `${slug(request.flags[MODULE_ID][FLAG].spells?.[0]?.name)}.prg`;
  element.classList.add("hardwipe-conc-collapsed");
  content.insertAdjacentHTML("afterbegin", `<button type="button" class="hardwipe-conc-linked" data-hw-conc="toggle">
    <i class="fas fa-microchip" inert></i><span>${escapeHTML(t("Linked", { file }))}</span><i class="fas fa-chevron-down" inert></i></button>`);
}

/* Actions ------------------------------------------------------------------------------------- */

async function onClick(event) {
  const target = event.target.closest?.("[data-hw-conc]");
  if (!target) return;
  const element = target.closest(".chat-message[data-message-id]");
  const message = element && game.messages.get(element.dataset.messageId);
  if (!message) return;
  event.preventDefault();
  event.stopPropagation();
  const action = target.dataset.hwConc;
  if (action === "toggle") {
    element.classList.toggle("hardwipe-conc-collapsed");
    return;
  }
  const data = message.flags?.[MODULE_ID]?.[FLAG];
  const actor = speakerActor(message);
  if (!data || !actor?.isOwner) return;
  if (action === "roll") {
    if (linkedSave(message) || superseded(message)) return;
    target.disabled = true;
    try {
      // The player's own roll: the normal roll dialog (advantage, bonuses), and Ready Set Midi's
      // end-on-failure, as for any Concentration save.
      await actor.rollConcentration({ target: data.dc ?? 10, ability: data.ability, event });
    } finally {
      target.disabled = false;
    }
  } else if (action === "end") {
    target.disabled = true;
    await actor.endConcentration();
  }
}
