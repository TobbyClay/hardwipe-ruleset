import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { closedOf, queueAction, queueCount, queueHTML } from "./hardwipe-comms.js";

/**
 * Roll requests: the GM asks one or more characters or NPCs for a skill check, an ability check or a saving throw,
 * or sets two of them against each other in a contest; the card shows who still has to roll, and each result as it
 * lands.
 * - A request is dnd5e's own "request" chat message, so dnd5e links every roll back to it (flags.dnd5e.requestResult,
 *   recorded on the request by the active GM). Hardwipe adds flags.hardwipe-ruleset.request: the kind (each, group,
 *   contest), a reason, the typed DC, whether players see it, and what each side of a contest rolls.
 * - Every request card, Hardwipe's or a party sheet's, is drawn as a HUD card, and the answering roll's own card folds
 *   to a line under it.
 * - Nothing waits on a request: it is an option for the table. Players still roll from their sheets as usual, and a
 *   Grapple or Shove from the Turn tab becomes a contest card only when the player has a target.
 */
const FLAG = "request";
const HANDLER = "hardwipe";
export const ROLL_TYPES = ["skill", "check", "save"];
/** Quick picks in the GM's composer: what usually comes up mid-fight. */
const QUICK_PICKS = ["skill:ath", "skill:acr", "skill:prc", "skill:ste", "skill:ins", "save:con", "save:dex", "save:wis"];
const ABILITY_COLORS = { str: "#ff7b6b", dex: "#8fe07a", con: "#ffb45c", int: "#6fb6ff", wis: "#7fe6d6", cha: "#d69bff" };
const t = (key, data) => data ? game.i18n.format(`HARDWIPE.Request.${key}`, data) : game.i18n.localize(`HARDWIPE.Request.${key}`);

/* Pure rules (unit-tested) ---------------------------------------------------------------------- */

/** "skill:ath" → { type: "skill", skill: "ath" }; "save:dex" → { type: "save", ability: "dex" }. */
export function parseRoll(value) {
  const [type, key] = String(value ?? "").split(":");
  if (!ROLL_TYPES.includes(type) || !key) return null;
  return type === "skill" ? { type, skill: key } : { type, ability: key };
}

/** The total against the DC: positive clears it, negative falls short; null without a DC or a total. */
export function margin(total, dc) {
  return Number.isFinite(total) && Number.isFinite(dc) ? total - dc : null;
}

/** dnd5e's group check: the group succeeds when at least half of it succeeds. Null until everyone has rolled. */
export function groupVerdict(results) {
  if (!results.length || results.some(result => result === null || result === undefined)) return null;
  const pass = results.filter(Boolean).length;
  return { pass, total: results.length, success: pass * 2 >= results.length };
}

/** A contest: the higher total wins; a tie leaves things as they were, so the defender holds. */
export function contestOutcome(challenger, defender) {
  if (!Number.isFinite(challenger) || !Number.isFinite(defender)) return null;
  return challenger > defender ? "challenger" : "defender";
}

/** What a dnd5e roll message rolled, as a request roll: a skill, an ability check or a save. Null for anything else. */
export function rollSpecOf(message) {
  const system = message?.system ?? {};
  if (message?.type === "check") {
    if (system.skill) return { type: "skill", skill: system.skill };
    return system.tool || !system.ability ? null : { type: "check", ability: system.ability };
  }
  // A plain save is type "ability"; death and concentration saves carry a type of their own.
  if (message?.type === "save" && system.ability && (!system.type || system.type === "ability")) return { type: "save", ability: system.ability };
  return null;
}

/** The same skill, the same ability check, or the same save. */
export function sameRoll(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  return a.type === "skill" ? a.skill === b.skill : a.ability === b.ability;
}

/** "+5", "−1"; empty without a number. */
export function formatBonus(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : "−"}${Math.abs(value)}` : "";
}

/* Labels ------------------------------------------------------------------------------------------ */

const localize = config => game.i18n.localize(config?.label ?? "");

/** "Athletics", "Strength check", "Dexterity save". */
export function rollName(spec) {
  if (!spec) return "";
  if (spec.type === "skill") return localize(CONFIG.DND5E.skills?.[spec.skill]) || spec.skill;
  const ability = localize(CONFIG.DND5E.abilities?.[spec.ability]) || spec.ability;
  return t(spec.type === "save" ? "SaveName" : "CheckName", { ability });
}

/** What this actor adds to a roll: a skill's total, an ability check's or a save's value. Null if unknown. */
export function rollBonus(actor, spec) {
  const system = actor?.system;
  if (!system || !spec) return null;
  const value = spec.type === "skill" ? system.skills?.[spec.skill]?.total
    : spec.type === "save" ? system.abilities?.[spec.ability]?.save?.value
    : system.abilities?.[spec.ability]?.check?.value;
  return Number.isFinite(value) ? value : null;
}

/** "Athletics +5": a contest button, so the player can see which roll suits them. */
function optionLabel(actor, spec) {
  return [rollName(spec), formatBonus(rollBonus(actor, spec))].filter(Boolean).join(" ");
}

/** The bonus as its own tag on a narrow contest button, so it can drop to a second line instead of being cut off. */
function bonusTag(actor, spec) {
  const bonus = formatBonus(rollBonus(actor, spec));
  return bonus ? `<b class="hardwipe-contest-bonus">${escapeHTML(bonus)}</b>` : "";
}

/** The card's title: "Athletics check", "Strength check", "Dexterity saving throw". */
export function rollTitle(spec) {
  if (!spec) return "";
  if (spec.type === "skill") return t("SkillTitle", { skill: rollName(spec) });
  const ability = localize(CONFIG.DND5E.abilities?.[spec.ability]) || spec.ability;
  return t(spec.type === "save" ? "SaveTitle" : "CheckTitle", { ability });
}

export function abilityOf(spec) {
  return spec?.type === "skill" ? CONFIG.DND5E.skills?.[spec.skill]?.ability : spec?.ability;
}

/** "STR", "CON": an ability's short label. */
export function abilityAbbr(ability) {
  return String(CONFIG.DND5E.abilities?.[ability]?.abbreviation ?? ability ?? "").toUpperCase();
}

/* Reading a request --------------------------------------------------------------------------------- */

/** The requests drawn here: Hardwipe's, and dnd5e's skill and save requests (a rest request keeps its own card). */
export function rendersRequest(message) {
  return message?.type === "request" && (!!requestData(message) || !!nativeSpec(message));
}

export function requestData(message) {
  return message?.type === "request" ? message.flags?.[MODULE_ID]?.[FLAG] ?? null : null;
}

/** A dnd5e party request becomes the same shape: everyone rolls the same thing. */
function nativeSpec(message) {
  const data = message.system?.data ?? {};
  if (message.system?.handler === "skill" && data.skill) return { type: "skill", skill: data.skill };
  if (message.system?.handler === "save" && data.ability) return { type: "save", ability: data.ability };
  return null;
}

/** What one participant rolls (null when they have a choice: a contest defender's options). */
function specFor(message, data, uuid) {
  if (data?.kind === "contest") return uuid === data.contest?.challenger ? data.contest.challengerRoll : null;
  return data?.roll ?? nativeSpec(message);
}

/** Everyone on a request, with their answer (null until they roll). */
export function participantsOf(message) {
  return (message.system?.targets ?? []).map(entry => {
    const actor = foundry.utils.fromUuidSync(entry.actor, { strict: false });
    const result = entry.result ?? null;
    const total = result?.isContentVisible ? Number(result.rolls?.[0]?.total) : NaN;
    return { uuid: entry.actor, actor, result, total: Number.isFinite(total) ? total : null, rolled: !!result };
  }).filter(entry => entry.actor);
}

/** Whether this viewer sees the DC and pass or fail: the GM always; players when the request shows it. */
export function seesDC(message, data = requestData(message)) {
  if (game.user.isGM) return true;
  return data ? data.showDC === true : message.shouldDisplayChallenge !== false;
}

/** The request an answering roll belongs to, if it is still in the log. */
export function requestOf(roll) {
  const id = roll?.flags?.dnd5e?.requestResult?.requestId;
  const request = id ? game.messages.get(id) : null;
  return request?.type === "request" ? request : null;
}

/** For the check card: the roll answers a request whose DC this viewer isn't shown. */
export function hidesChallenge(roll) {
  const request = requestOf(roll);
  return !!request && !seesDC(request);
}

/**
 * What one actor still owes on a request, for the Turn tab's netlink strip: the kind, what to roll, the DC as this
 * viewer may see it and, for a contest defender, the options. Null once that actor has rolled or the GM closed it.
 */
export function pendingFor(message, actor) {
  if (message?.type !== "request" || !actor || closedOf(message)) return null;
  const entry = participantsOf(message).find(item => item.uuid === actor.uuid);
  if (!entry || entry.rolled) return null;
  const data = requestData(message);
  if (data?.kind === "contest") {
    const contest = data.contest, action = contest.action ?? "contest";
    const challenger = contest.challenger === actor.uuid;
    const other = foundry.utils.fromUuidSync(challenger ? contest.defender : contest.challenger, { strict: false });
    return {
      kind: "contest", badge: t("Strip.VersusBadge"), tag: t(challenger ? "Strip.Attack" : "Strip.Defend"),
      name: t(`Strip.${challenger ? "Attacking" : "Defending"}.${action}`, { name: other?.name ?? "" }), detail: data.reason ?? "",
      options: challenger ? [{ index: -1, label: optionLabel(actor, contest.challengerRoll) }] : contest.defenderRolls.map((spec, index) => ({ index, label: optionLabel(actor, spec) })),
      at: message.timestamp
    };
  }
  const spec = specFor(message, data, actor.uuid);
  if (!spec && !CONFIG.DND5E.requests?.[message.system?.handler]) return null;
  const dc = data ? Number(data.dc) : Number(message.system?.data?.target ?? message.system?.data?.dc);
  const hasDC = Number.isFinite(dc) && dc > 0;
  const shown = hasDC && seesDC(message, data);
  const author = message.author;
  return {
    kind: "rollcall", badge: abilityAbbr(abilityOf(spec)) || "D20",
    tag: author && !author.isGM ? t("Strip.RollCallFrom", { name: author.name }) : t("Strip.RollCall"),
    name: spec ? rollTitle(spec) : String(message.flavor ?? ""), detail: data?.reason ?? "",
    dc: shown ? dc : null, dcHidden: hasDC && !shown, options: [{ index: -1, label: t("Roll") }], at: message.timestamp
  };
}

/* Rolling ---------------------------------------------------------------------------------------------- */

/**
 * Roll one participant's part of a request, linked to it, so dnd5e records the result on the request. `option` picks
 * a contest defender's roll. A party sheet's request goes to dnd5e's own handler.
 */
export async function rollFor(request, actor, option = -1, event = null) {
  if (closedOf(request)) {
    ui.notifications.info(t("ClosedNotice"));
    return null;
  }
  const data = requestData(request);
  const entry = request?.system?.targets?.find(item => item.actor === actor?.uuid);
  if (!data || !entry) {
    const handler = CONFIG.DND5E.requests?.[request?.system?.handler];
    if (!handler || handler === requestHandler) return null;
    const result = await handler(actor, request, request.system.data, { event });
    if ((result instanceof ChatMessage) && !result.getFlag("dnd5e", "requestResult")) {
      await result.setFlag("dnd5e", "requestResult", { actorUuid: actor.uuid, requestId: request.id });
    }
    return result;
  }
  if (!actor.isOwner || entry.result) return null;
  const spec = data.kind === "contest" && actor.uuid === data.contest.defender ? data.contest.defenderRolls?.[Math.max(0, option)] : specFor(request, data, actor.uuid);
  if (!spec) return null;
  const message = { data: { flags: { dnd5e: { requestResult: { actorUuid: actor.uuid, requestId: request.id } }, [MODULE_ID]: { requestRoll: spec } } } };
  const target = data.kind !== "contest" && Number(data.dc) > 0 ? Number(data.dc) : undefined;
  let rolls;
  if (spec.type === "skill") rolls = await actor.rollSkill({ skill: spec.skill, target, event }, {}, message);
  else if (spec.type === "save") rolls = await actor.rollSavingThrow({ ability: spec.ability, target, event }, {}, message);
  else rolls = await actor.rollAbilityCheck({ ability: spec.ability, target, event }, {}, message);
  return rolls?.[0]?.parent ?? null;
}

/** dnd5e's request handler for Hardwipe requests (its own Roll buttons and the Turn tab both end here). */
function requestHandler(actor, request, config, { event } = {}) {
  return rollFor(request, actor, -1, event);
}

/**
 * Post a request. `participants` are actors; `roll` is what everyone rolls (each, group) or the challenger's roll
 * (contest, where `participants` are the challenger and the defender and `defenderRolls` their options).
 */
export async function createRequest({ participants: actors, roll, kind = "each", dc = null, showDC = false, reason = "", defenderRolls = [], action = null }) {
  const list = actors.filter(Boolean);
  if (!list.length || !roll) return null;
  const contest = kind === "contest";
  if (contest && list.length !== 2) throw new Error(t("ContestNeedsTwo"));
  const flag = { kind, reason: String(reason ?? "").trim(), dc: !contest && Number(dc) > 0 ? Math.round(Number(dc)) : null, showDC: !!showDC };
  if (contest) {
    flag.contest = { action, challenger: list[0].uuid, defender: list[1].uuid, challengerRoll: roll, defenderRolls: defenderRolls.length ? defenderRolls : [roll] };
  } else flag.roll = roll;
  const title = contest ? t(`Action.${action ?? "contest"}`) : rollTitle(roll);
  return ChatMessage.implementation.create({
    type: "request", flavor: title, speaker: game.user.isGM ? { alias: game.user.name } : ChatMessage.implementation.getSpeaker({ actor: list[0] }),
    system: { handler: HANDLER, data: {}, targets: list.map(actor => ({ actor: actor.uuid })), button: { icon: "fa-solid fa-dice-d20", label: title } },
    flags: { [MODULE_ID]: { [FLAG]: flag } }
  });
}

/* The card --------------------------------------------------------------------------------------------- */

const avatar = actor => {
  const src = actor.token?.texture?.src ?? actor.prototypeToken?.texture?.src ?? actor.img;
  return src ? `<img src="${escapeHTML(src)}" alt="">` : "";
};

/** Who may click this participant's Roll: the owner; for the GM, only participants no active player owns. */
export function rollsHere(actor) {
  if (!actor?.isOwner) return false;
  if (!game.user.isGM) return true;
  return !game.users.some(user => user.active && !user.isGM && actor.testUserPermission(user, "OWNER"));
}

/** Draw a request (Hardwipe's or a party sheet's) as a HUD card in place of dnd5e's. */
export function renderRequestCard(message, element) {
  const content = element.querySelector(".message-content");
  if (!content || !message.isContentVisible) return;
  const data = requestData(message);
  const kind = data?.kind ?? "each";
  const card = kind === "contest" ? contestHTML(message, data) : rollCallHTML(message, data, kind);
  content.innerHTML = card;
  element.classList.add("hardwipe-request-message");
}

function kicker(icon, label, tag) {
  return `<div class="hardwipe-chat-kicker"><i class="fas ${icon}" inert></i><span>${escapeHTML(label)}</span>${tag ? `<span class="hardwipe-msg-tag">${escapeHTML(tag)}</span>` : ""}</div>`;
}

function rollCallHTML(message, data, kind) {
  const spec = data?.roll ?? nativeSpec(message);
  const dc = data ? data.dc : Number(message.system?.data?.target ?? message.system?.data?.dc);
  const showDC = seesDC(message, data) && Number.isFinite(dc) && dc > 0;
  const ability = abilityOf(spec);
  const color = ABILITY_COLORS[ability] ?? "var(--hw-warn)";
  const abbr = String(CONFIG.DND5E.abilities?.[ability]?.abbreviation ?? ability ?? "").toUpperCase();
  const people = participantsOf(message);
  const title = spec ? rollTitle(spec) : String(message.flavor ?? "");
  const tag = [kind === "group" ? t("Group") : "", showDC ? t("DC", { dc }) : ""].filter(Boolean).join(" · ");
  const closed = !!closedOf(message);
  const mine = closed ? [] : people.filter(person => !person.rolled && rollsHere(person.actor));
  const button = mine.length ? `<button type="button" class="hardwipe-save-button is-cta" data-hw-request="roll" data-uuids="${escapeHTML(mine.map(person => person.uuid).join(","))}">
      <span class="hardwipe-save-ability">${escapeHTML(abbr || "D20")}</span>
      <span class="hardwipe-save-label"><b>${escapeHTML(mine.length > 1 ? t("RollAll", { count: mine.length }) : t("RollThis", { roll: spec ? rollName(spec) : title }))}</b>
        <small>${escapeHTML(mine.map(person => person.actor.name).join(" · "))}</small></span>
      ${showDC ? `<span class="hardwipe-save-dc">${escapeHTML(t("DC", { dc }))}</span>` : ""}
    </button>` : "";
  const verdicts = people.map(person => person.rolled ? (Number.isFinite(dc) && person.total !== null ? person.total >= dc : true) : null);
  const rows = people.map((person, index) => {
    const pass = verdicts[index];
    const state = !person.rolled ? (closed ? "skipped" : "pending") : !showDC || person.total === null ? "rolled" : pass ? "saved" : "failed";
    const diff = margin(person.total, dc);
    const label = state === "pending" ? t("Waiting") : state === "skipped" ? t("Skipped") : state === "rolled" ? t("Rolled")
      : `${t(pass ? "Pass" : "Fail")} ${diff >= 0 ? "+" : "−"}${Math.abs(diff)}`;
    return `<div class="hardwipe-save-row is-${state}">
        <span class="hardwipe-save-who">${avatar(person.actor)}<span>${escapeHTML(person.actor.name)}</span></span>
        <em>${person.total !== null ? escapeHTML(person.total) : "—"}</em><b>${escapeHTML(label)}</b></div>`;
  }).join("");
  const group = kind === "group" && showDC ? groupVerdict(verdicts) : null;
  const groupLine = group ? `<div class="hardwipe-request-verdict ${group.success ? "is-pass" : "is-fail"}">
      <span>${escapeHTML(t("GroupCount", { pass: group.pass, total: group.total }))}</span><b>${escapeHTML(t(group.success ? "GroupPass" : "GroupFail"))}</b></div>` : "";
  return `<div class="hardwipe-chat-card hardwipe-msg-card hardwipe-request-card" data-hw-kind="request" style="--hw-save: ${color}">
    ${kicker("fa-bullhorn", t("Label"), tag)}
    <div class="hardwipe-chat-title">${escapeHTML(title)}</div>
    ${data?.reason ? `<div class="hardwipe-request-reason">${escapeHTML(data.reason)}</div>` : ""}
    <div class="hardwipe-save-block is-request">
      <div class="hardwipe-save-title"><span>${escapeHTML(t(spec?.type === "save" ? "KindSave" : "KindCheck"))}</span><b>${escapeHTML([abbr, showDC ? t("DC", { dc }) : ""].filter(Boolean).join(" · "))}</b></div>
      ${button}
      <div class="hardwipe-save-rows">${rows}</div>
      ${groupLine}
      ${closed ? `<div class="hardwipe-request-closed">${escapeHTML(t("ClosedStamp", { answered: people.filter(person => person.rolled).length, total: people.length }))}</div>` : ""}
    </div>
  </div>`;
}

function contestHTML(message, data) {
  const contest = data.contest;
  const people = participantsOf(message);
  const challenger = people.find(person => person.uuid === contest.challenger);
  const defender = people.find(person => person.uuid === contest.defender);
  if (!challenger || !defender) return "";
  const outcome = contestOutcome(challenger.total, defender.total);
  const closed = !outcome && !!closedOf(message);
  const action = contest.action ?? "contest";
  const side = (person, role, specs) => {
    const won = outcome === role;
    const rolled = person.rolled;
    const used = person.result?.flags?.[MODULE_ID]?.requestRoll;
    let body;
    if (rolled) body = `<b class="hardwipe-contest-total">${person.total !== null ? escapeHTML(person.total) : "—"}</b><small>${escapeHTML(used ? rollName(used) : specs.map(rollName).join(" / "))}</small>`;
    else if (closed) body = `<span class="hardwipe-contest-wait">${escapeHTML(t("Skipped"))}</span>`;
    else if (rollsHere(person.actor)) {
      body = specs.map((spec, index) => `<button type="button" class="hardwipe-contest-roll" data-hw-request="roll" data-uuids="${escapeHTML(person.uuid)}" data-option="${role === "defender" ? index : -1}">
        <span><i class="fas fa-dice-d20" inert></i> ${escapeHTML(rollName(spec))}</span>${bonusTag(person.actor, spec)}</button>`).join("");
    } else body = `<span class="hardwipe-contest-wait">${escapeHTML(specs.map(rollName).join(` ${t("Or")} `))}</span><small>${escapeHTML(t("Waiting"))}</small>`;
    return `<div class="hardwipe-contest-side ${won ? "is-winner" : outcome ? "is-loser" : ""}">
      <div class="hardwipe-save-who">${avatar(person.actor)}<span>${escapeHTML(person.actor.name)}</span></div>${body}</div>`;
  };
  const chip = (value, label, extra = "") => `<span class="hardwipe-wall-chip ${extra}"><b>${escapeHTML(value)}</b>${escapeHTML(label)}</span>`;
  const math = outcome ? `<div class="hardwipe-wall-math">${chip(challenger.total, "", "is-roll-total")}<span class="hardwipe-wall-op">${escapeHTML(t("Versus"))}</span>${chip(defender.total, "")}<span class="hardwipe-wall-op">=</span>${chip(`${challenger.total >= defender.total ? "+" : "−"}${Math.abs(challenger.total - defender.total)}`, t("Margin"), "is-total is-margin")}</div>` : "";
  const winner = outcome === "challenger" ? challenger : defender;
  const effect = outcome === "challenger" && action === "grapple" ? "grappled" : outcome === "challenger" && action === "shove" ? "prone" : null;
  const applied = !!data.applied || (effect && defender.actor.statuses?.has(effect));
  const apply = effect && game.user.isGM && !applied
    ? `<button type="button" class="hardwipe-hud-btn is-primary" data-hw-request="apply" data-status="${effect}"><i class="fas ${effect === "grappled" ? "fa-hand-fist" : "fa-person-falling"}" inert></i> ${escapeHTML(t(effect === "grappled" ? "ApplyGrappled" : "ApplyProne"))}</button>` : "";
  const verdict = outcome ? `<div class="hardwipe-request-verdict ${outcome === "challenger" ? "is-pass" : "is-fail"}">
      <span>${escapeHTML(t(outcome === "challenger" ? `Wins.${action}` : `Holds.${action}`, { name: winner.actor.name, target: defender.actor.name }))}</span>
      ${applied && effect ? `<b>${escapeHTML(t(effect === "grappled" ? "Grappled" : "Prone"))}</b>` : apply}</div>` : "";
  return `<div class="hardwipe-chat-card hardwipe-msg-card hardwipe-request-card is-contest" data-hw-kind="request" style="--hw-save: var(--hw-warn)">
    ${kicker(action === "grapple" ? "fa-hand-fist" : action === "shove" ? "fa-hand-back-fist" : "fa-scale-balanced", t("Contest"), action === "contest" ? "" : t(`Action.${action}`))}
    <div class="hardwipe-chat-title">${escapeHTML(t(`Title.${action}`, { name: challenger.actor.name, target: defender.actor.name }))}</div>
    ${data.reason ? `<div class="hardwipe-request-reason">${escapeHTML(data.reason)}</div>` : ""}
    <div class="hardwipe-contest">
      ${side(challenger, "challenger", [contest.challengerRoll])}
      <span class="hardwipe-contest-vs">${escapeHTML(t("Versus"))}</span>
      ${side(defender, "defender", contest.defenderRolls)}
    </div>
    ${math}
    ${verdict}
    ${closed ? `<div class="hardwipe-request-closed">${escapeHTML(t("ClosedContest"))}</div>` : ""}
  </div>`;
}

/* A roll from the sheet answers an open roll call -------------------------------------------------------- */

/** The newest open request still waiting on this actor for this roll, and which of its rolls it is. */
function openRequestFor(actor, spec) {
  for (const request of game.messages.contents.slice(-60).reverse()) {
    if (request.type !== "request" || closedOf(request)) continue;
    const entry = request.system?.targets?.find(target => target.actor === actor.uuid);
    if (!entry || entry.result) continue;
    const data = requestData(request);
    const contest = data?.kind === "contest" ? data.contest : null;
    const options = !contest ? [data?.roll ?? nativeSpec(request)]
      : actor.uuid === contest.challenger ? [contest.challengerRoll] : actor.uuid === contest.defender ? contest.defenderRolls ?? [] : [];
    const match = options.find(option => sameRoll(option, spec));
    if (match) return { request, spec: match };
  }
  return null;
}

/**
 * A check or save rolled from the sheet (not from a card) while a roll call for that roll waits on the same actor
 * counts as the answer. The roller's client links it; dnd5e's GM then records it on the request as usual.
 */
async function linkSheetRoll(id) {
  const message = game.messages.get(id);
  if (!message || message.flags?.dnd5e?.requestResult || message.flags?.dnd5e?.originatingMessage) return;
  const spec = rollSpecOf(message);
  const actor = spec ? ChatMessage.implementation.getSpeakerActor(message.speaker) : null;
  if (!actor) return;
  const found = openRequestFor(actor, spec);
  if (!found) return;
  await message.update({ flags: { dnd5e: { requestResult: { actorUuid: actor.uuid, requestId: found.request.id } }, [MODULE_ID]: { requestRoll: found.spec } } });
}

/* An answering roll folds under its request -------------------------------------------------------------- */

function foldAnswer(message, element) {
  const request = requestOf(message);
  if (!request) return;
  const content = element.querySelector(".message-content");
  if (!content || content.querySelector(":scope > .hardwipe-request-linked")) return;
  element.classList.add("hardwipe-request-folded");
  content.insertAdjacentHTML("afterbegin", `<button type="button" class="hardwipe-request-linked" data-hw-request="unfold">
    <i class="fas fa-bullhorn" inert></i><span>${escapeHTML(t("Linked"))}</span><i class="fas fa-chevron-down" inert></i></button>`);
}

/*
 * dnd5e records an answer by rewriting the request's whole target list from the GM's copy without waiting, so two
 * answers landing together (Roll for 2, two players at once) can drop one. Once answers settle, the GM re-links any
 * answer the list is missing.
 */
const relinks = new Map();
function relinkAnswers(requestId) {
  clearTimeout(relinks.get(requestId));
  relinks.set(requestId, setTimeout(async () => {
    relinks.delete(requestId);
    const request = game.messages.get(requestId);
    if (request?.type !== "request" || game.users.activeGM !== game.user) return;
    const targets = request.system.toObject().targets ?? [];
    let changed = false;
    for (const answer of game.messages) {
      const flag = answer.flags?.dnd5e?.requestResult;
      if (flag?.requestId !== requestId) continue;
      const target = targets.find(entry => entry.actor === flag.actorUuid);
      if (target && !target.result) { target.result = answer.id; changed = true; }
    }
    if (changed) await request.update({ "system.targets": targets });
  }, 500));
}

function onAnswer(message, changes) {
  const flag = changes ? foundry.utils.getProperty(changes, "flags.dnd5e.requestResult") : message.flags?.dnd5e?.requestResult;
  if (flag?.requestId && game.users.activeGM === game.user) relinkAnswers(flag.requestId);
}

async function onClick(event) {
  const target = event.target.closest?.("[data-hw-request]");
  if (!target) return;
  const element = target.closest(".chat-message[data-message-id]");
  const message = element && game.messages.get(element.dataset.messageId);
  if (!message) return;
  event.preventDefault();
  event.stopPropagation();
  const action = target.dataset.hwRequest;
  if (action === "unfold") return element.classList.toggle("hardwipe-request-folded");
  if (action === "apply") {
    if (!game.user.isGM) return;
    const defender = foundry.utils.fromUuidSync(requestData(message)?.contest?.defender, { strict: false });
    if (!defender) return;
    target.disabled = true;
    await defender.toggleStatusEffect(target.dataset.status, { active: true });
    await message.setFlag(MODULE_ID, `${FLAG}.applied`, true);
    return;
  }
  if (action === "roll") {
    target.disabled = true;
    try {
      for (const uuid of String(target.dataset.uuids ?? "").split(",").filter(Boolean)) {
        const actor = foundry.utils.fromUuidSync(uuid, { strict: false });
        if (actor) await rollFor(message, actor, Number(target.dataset.option ?? -1), event);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Roll request`, error);
      ui.notifications.error(error.message ?? String(error));
    } finally {
      if (target.isConnected) target.disabled = false;
    }
  }
}

/* The GM's composer --------------------------------------------------------------------------------------- */

/** Players see the DC by default when dnd5e shows challenges to everyone. */
function defaultShowDC() {
  try { return game.settings.get("dnd5e", "challengeVisibility") === "all"; } catch { return false; }
}

function rollOptions(selected) {
  const option = (value, text) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHTML(text)}</option>`;
  const skills = Object.entries(CONFIG.DND5E.skills).map(([key, config]) => [`skill:${key}`, localize(config)]).sort((a, b) => a[1].localeCompare(b[1]));
  const abilities = Object.entries(CONFIG.DND5E.abilities).map(([key, config]) => [key, localize(config)]);
  return `<optgroup label="${escapeHTML(t("Skills"))}">${skills.map(([value, text]) => option(value, text)).join("")}</optgroup>
    <optgroup label="${escapeHTML(t("Checks"))}">${abilities.map(([key, text]) => option(`check:${key}`, t("CheckName", { ability: text }))).join("")}</optgroup>
    <optgroup label="${escapeHTML(t("Saves"))}">${abilities.map(([key, text]) => option(`save:${key}`, t("SaveName", { ability: text }))).join("")}</optgroup>`;
}

const COMPOSER_ID = "hardwipe-roll-request";
let Composer = null;

/** The GM's composer. Its class is built on first use: it extends Foundry's ApplicationV2, which unit tests don't load. */
export const RollRequestComposer = {
  /** Open it for these actors (the GM only), or for the GM's selected tokens; a second open adds to the open one. */
  open(actors = null, { tab = null } = {}) {
    if (!game.user.isGM) return null;
    const list = actors ?? (canvas.tokens?.controlled ?? []).map(token => token.actor);
    const open = foundry.applications.instances.get(COMPOSER_ID);
    if (open) {
      open.addActors(list);
      if (tab) open.tab = tab;
      open.bringToFront?.();
      return open.render();
    }
    Composer ??= composerClass();
    return new Composer({ actors: list, tab }).render({ force: true });
  },

  /** Redraw the open window's queue tab after the log or the combat changed. */
  refreshQueue() {
    const open = foundry.applications.instances.get(COMPOSER_ID);
    if (open?.rendered && open.tab === "queue") open.render();
  }
};

function composerClass() {
  return class RollRequestComposerApp extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: COMPOSER_ID, tag: "form", classes: ["hardwipe-composer"],
      window: { title: "HARDWIPE.Request.Composer.Title", icon: "fa-solid fa-bullhorn", resizable: true },
      position: { width: 480, height: "auto" },
      form: { handler: RollRequestComposerApp.#onSubmit, closeOnSubmit: true },
      actions: {
        pick: RollRequestComposerApp.#onPick, remove: RollRequestComposerApp.#onRemove, addSelected: RollRequestComposerApp.#onAddSelected,
        tab: RollRequestComposerApp.#onTab, queue: RollRequestComposerApp.#onQueue
      }
    };

    constructor({ actors = [], tab = null } = {}, options = {}) {
      super(options);
      this.tab = tab ?? "new";
      this.people = [];
      this.#add(actors);
      this.draft = { roll: "skill:ath", kind: "each", dc: "", showDC: defaultShowDC(), reason: "", opponentA: "skill:ath", opponentB: "skill:acr" };
    }

    /** Add participants, keeping what the GM has typed so far. */
    addActors(actors) {
      this.#sync();
      this.#add(actors);
    }

    #add(actors) {
      for (const actor of actors ?? []) if (actor && !this.people.some(entry => entry.uuid === actor.uuid)) this.people.push(actor);
    }

    #sync() {
      const form = this.element;
      // Only the New roll call tab holds the form's fields.
      if (!form?.elements?.roll) return;
      const value = name => form.elements[name]?.value ?? "";
      Object.assign(this.draft, {
        roll: value("roll") || this.draft.roll, dc: value("dc"), reason: value("reason"), showDC: !!form.elements.showDC?.checked,
        kind: form.querySelector('input[name="kind"]:checked')?.value ?? this.draft.kind, opponentA: value("opponentA"), opponentB: value("opponentB")
      });
    }

    async _renderHTML() {
      const tabs = `<nav class="hardwipe-composer-tabs">${["new", "queue"].map(id => `<button type="button" data-action="tab" data-tab="${id}" aria-pressed="${this.tab === id}">
        ${escapeHTML(id === "new" ? t("Composer.TabNew") : t("Composer.TabQueue", { count: queueCount() }))}</button>`).join("")}</nav>`;
      if (this.tab === "queue") return `${tabs}<div class="hardwipe-composer-body is-queue">${queueHTML()}</div>`;
      const s = this.draft;
      const who = this.people.map(actor => `<span class="hardwipe-composer-who" data-uuid="${escapeHTML(actor.uuid)}">${avatar(actor)}<span>${escapeHTML(actor.name)}</span>
          <button type="button" class="unbutton" data-action="remove" aria-label="${escapeHTML(t("Composer.Remove", { name: actor.name }))}"><i class="fas fa-xmark" inert></i></button></span>`).join("");
      const picks = QUICK_PICKS.map(value => `<button type="button" class="hardwipe-btn" data-action="pick" data-roll="${value}" aria-pressed="${value === s.roll}">${escapeHTML(rollName(parseRoll(value)))}</button>`).join("");
      const kinds = ["each", "group", "contest"].map(kind => `<label class="hardwipe-composer-kind"><input type="radio" name="kind" value="${kind}" ${s.kind === kind ? "checked" : ""}><span>${escapeHTML(t(`Composer.Kind.${kind}`))}</span></label>`).join("");
      return `${tabs}<div class="hardwipe-composer-body">
        <section><span class="hardwipe-label">${escapeHTML(t("Composer.Who"))}</span>
          <div class="hardwipe-composer-people">${who || `<span class="hardwipe-composer-empty">${escapeHTML(t("Composer.NoOne"))}</span>`}
            <button type="button" class="hardwipe-btn" data-action="addSelected"><i class="fas fa-crosshairs" inert></i> ${escapeHTML(t("Composer.AddSelected"))}</button></div></section>
        <section><span class="hardwipe-label">${escapeHTML(t("Composer.Roll"))}</span>
          <div class="hardwipe-composer-picks">${picks}</div>
          <select name="roll">${rollOptions(s.roll)}</select></section>
        <section class="hardwipe-composer-row">
          <label class="hardwipe-composer-dc"><span class="hardwipe-label">${escapeHTML(t("Composer.DC"))}</span><input type="number" name="dc" min="1" step="1" placeholder="—" value="${escapeHTML(s.dc)}"></label>
          <label class="hardwipe-composer-check"><input type="checkbox" name="showDC" ${s.showDC ? "checked" : ""}><span>${escapeHTML(t("Composer.ShowDC"))}</span></label></section>
        <section><span class="hardwipe-label">${escapeHTML(t("Composer.Kind.Label"))}</span><div class="hardwipe-composer-kinds">${kinds}</div>
          <p class="hint">${escapeHTML(t(`Composer.KindHint.${s.kind}`))}</p>
          <div class="hardwipe-composer-contest"><span>${escapeHTML(t("Composer.OpponentRolls"))}</span>
            <select name="opponentA">${rollOptions(s.opponentA)}</select><span>${escapeHTML(t("Or"))}</span>
            <select name="opponentB"><option value="">—</option>${rollOptions(s.opponentB)}</select></div></section>
        <section><span class="hardwipe-label">${escapeHTML(t("Composer.Reason"))}</span><input type="text" name="reason" placeholder="${escapeHTML(t("Composer.ReasonPlaceholder"))}" value="${escapeHTML(s.reason)}"></section>
        <footer class="form-footer"><button type="submit" class="hardwipe-btn is-primary"><i class="fas fa-bullhorn" inert></i> ${escapeHTML(t("Composer.Send"))}</button></footer>
      </div>`;
    }

    _replaceHTML(result, content) { content.innerHTML = result; }

    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      // The kind hint follows the radio; the select and the quick picks stay in step.
      this.element.addEventListener("change", event => {
        if (event.target.name === "kind") {
          this.#sync();
          const hint = this.element.querySelector(".hint");
          if (hint) hint.textContent = t(`Composer.KindHint.${this.draft.kind}`);
          this.element.classList.toggle("is-contest", this.draft.kind === "contest");
        }
        if (event.target.name === "roll") for (const button of this.element.querySelectorAll('[data-action="pick"]')) button.setAttribute("aria-pressed", String(button.dataset.roll === event.target.value));
      });
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      this.element.classList.toggle("is-contest", this.draft.kind === "contest");
      this.element.classList.toggle("is-queue", this.tab === "queue");
    }

    static #onTab(event, target) {
      if (this.tab === "new") this.#sync();
      this.tab = target.dataset.tab;
      this.render();
    }

    static async #onQueue(event, target) {
      target.disabled = true;
      try {
        await queueAction(target.dataset.queue, target.dataset.id, event);
      } finally {
        if (this.rendered) this.render();
      }
    }

    static #onPick(event, target) {
      this.element.elements.roll.value = target.dataset.roll;
      for (const button of this.element.querySelectorAll('[data-action="pick"]')) button.setAttribute("aria-pressed", String(button === target));
    }

    static #onRemove(event, target) {
      const uuid = target.closest("[data-uuid]")?.dataset.uuid;
      this.#sync();
      this.people = this.people.filter(actor => actor.uuid !== uuid);
      this.render();
    }

    static #onAddSelected() {
      this.#sync();
      this.#add((canvas.tokens?.controlled ?? []).map(token => token.actor));
      this.render();
    }

    static async #onSubmit(event, form, formData) {
      this.#sync();
      const s = this.draft;
      if (!this.people.length) throw new Error(t("Composer.NoOneError"));
      const roll = parseRoll(s.roll);
      if (s.kind === "contest") {
        return createRequest({ participants: this.people, roll, kind: "contest", reason: s.reason, action: "contest",
          defenderRolls: [parseRoll(s.opponentA), parseRoll(s.opponentB)].filter(Boolean) });
      }
      return createRequest({ participants: this.people, roll, kind: s.kind, dc: s.dc, showDC: s.showDC, reason: s.reason });
    }
  };
}

/* Wiring ------------------------------------------------------------------------------------------------- */

export function registerRequests() {
  game.keybindings.register(MODULE_ID, "requestRoll", {
    name: "HARDWIPE.Request.Key", hint: "HARDWIPE.Request.KeyHint", editable: [{ key: "KeyR", modifiers: ["Alt"] }],
    restricted: true, onDown: () => { RollRequestComposer.open(); return true; }
  });
  Hooks.on("getSceneControlButtons", controls => {
    const group = controls.tokens ?? controls.token;
    if (!group) return;
    group.tools ??= {};
    if (group.tools.hardwipeRequest) return;
    group.tools.hardwipeRequest = {
      name: "hardwipeRequest", title: "HARDWIPE.Request.Tool", icon: "fa-solid fa-bullhorn", button: true, visible: !!game.user?.isGM,
      order: Object.values(group.tools).reduce((max, tool) => Math.max(max, Number(tool.order) || 0), 0) + 1,
      onChange: () => RollRequestComposer.open()
    };
  });
  Hooks.once("setup", () => {
    CONFIG.DND5E.requests[HANDLER] = requestHandler;
    Hooks.on("dnd5e.renderChatMessage", (message, html) => {
      const element = html?.querySelector ? html : html?.[0];
      if (!element) return;
      if (rendersRequest(message)) renderRequestCard(message, element);
      else if (message.flags?.dnd5e?.requestResult) foldAnswer(message, element);
    });
  });
  Hooks.on("createChatMessage", message => onAnswer(message));
  // A moment's wait: dnd5e flags a roll made from its own request button just after creating it.
  Hooks.on("createChatMessage", (message, options, userId) => {
    if (userId !== game.user.id || !["check", "save"].includes(message.type)) return;
    setTimeout(() => linkSheetRoll(message.id).catch(error => console.error(`${MODULE_ID} | Sheet roll link`, error)), 300);
  });
  Hooks.on("updateChatMessage", (message, changes) => onAnswer(message, changes));
  document.addEventListener("click", onClick, true);
}
