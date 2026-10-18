import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { D20_KINDS, awards, summarize } from "./hardwipe-roll-data.js";
import {
  NOTE_LIMIT, actorName, allSessions, canView, continueSession, deleteSession, describeRecord, endSession, importChatLog, lastActivity,
  nextNumber, openRecapDialog, openSessionDialog, previewRefile, readCurrent, roleOf, sessionName, setNote, showPlayers, startSession,
  tr, updateSession, userName
} from "./hardwipe-roll-tracker.js";

/**
 * High Rollers, the Roll Tracker window (Game Settings > Hardwipe Ruleset > Roll Tracker), drawn in the
 * game-menu language: counters for the session's rolls and spells, a red tab row, cyan data, tooltip panels
 * with orange values, Cyberpunk RED rulebook tabs. One session, the unfiled rolls or the whole campaign:
 * Overview (ranking, firefight, awards, per-session charts), Players (the character screen), Compare (item
 * comparison), Dice, Moments, and for the GM, Sessions. Also here: the GM's session dialog and the
 * Screamsheet recap.
 */
const TABS = ["overview", "players", "compare", "dice", "moments", "sessions"];
const AWARD_ICONS = {
  golden: "fa-crown", cursed: "fa-skull-crossbones", crits: "fa-star", fumbles: "fa-heart-crack", heavy: "fa-hammer", biggest: "fa-burst",
  sharpshooter: "fa-crosshairs", spells: "fa-wand-sparkles", will: "fa-shield-heart", smooth: "fa-comments", medic: "fa-kit-medical",
  quick: "fa-bolt", hot: "fa-fire", cold: "fa-snowflake", busy: "fa-dice", downed: "fa-bed-pulse"
};
// Awards worth leading with, in order; the rest follow.
const AWARD_ORDER = ["golden", "crits", "heavy", "spells", "sharpshooter", "fumbles", "biggest", "will", "medic", "hot", "quick", "smooth", "cursed", "cold", "busy", "downed"];
const KIND_GROUPS = [["atk", ["atk"]], ["dmg", ["dmg", "heal"]], ["save", ["save", "conc", "death"]], ["check", ["check", "skill", "tool"]], ["init", ["init"]], ["other", ["d20", "hd", "roll"]]];
const DICE = [4, 6, 8, 10, 12, 20, 100];
const SERIES = 6;

const e = escapeHTML;
const num = value => Number(value ?? 0).toLocaleString(game.i18n.lang);
const avg = value => Number.isFinite(value) ? value.toFixed(1) : "—";
const pct = value => Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
const isRoll = record => record.c !== "use" && record.c !== "evt";
const isSpell = record => record.c === "use" && record.y === "spell";
const nat = record => D20_KINDS.has(record.c) && (record.n === 20 || record.n === 1);
/** A counted phrase: the key's singular form ("…1") for one, the plural otherwise. */
const plural = (key, n, data = {}) => tr(Number(n) === 1 && game.i18n.has(`HARDWIPE.Tracker.${key}1`) ? `${key}1` : key, { n: num(n), ...data });

function dateText(t) { try { return new Date(t).toLocaleDateString(game.i18n.lang, { dateStyle: "medium" }); } catch { return ""; } }
function timeText(t) { try { return new Date(t).toLocaleTimeString(game.i18n.lang, { timeStyle: "short" }); } catch { return ""; } }
function span(session) {
  if (!session?.start) return "";
  const end = session.live ? tr("Now") : timeText(session.end ?? session.last ?? session.start);
  return `${timeText(session.start)} → ${end}`;
}
function length(from, to) {
  const minutes = Math.max(0, Math.round(((to ?? 0) - (from ?? 0)) / 60000));
  return minutes >= 60 ? tr("DurationHM", { h: Math.floor(minutes / 60), m: minutes % 60 }) : tr("DurationM", { m: minutes });
}
const pad2 = n => String(n).padStart(2, "0");
const dateInput = t => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const timeInput = t => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const fromInputs = (date, time) => { const t = new Date(`${date}T${time || "00:00"}`).getTime(); return Number.isFinite(t) ? t : null; };

/* The data one view shows -------------------------------------------------------------------------------- */

/**
 * Records, entities and statistics for a scope: null (the session in play, else the newest), "all",
 * "unfiled", or a session id. Players don't see rolls someone else made in private.
 */
export function buildView(scope = null) {
  const sessions = allSessions();
  const unfiled = readCurrent().unfiled;
  const hasUnfiled = Object.keys(unfiled.records ?? {}).length > 0;
  const isGM = game.user.isGM;
  let buckets, session = null;
  if (scope === "all") buckets = [...sessions, unfiled];
  else if (scope === "unfiled") buckets = [unfiled];
  else {
    session = sessions.find(entry => entry.id === scope) ?? sessions.find(entry => entry.live) ?? sessions[0] ?? null;
    buckets = session ? [session] : hasUnfiled ? [unfiled] : [];
    if (!session && hasUnfiled) scope = "unfiled";
  }
  const visible = record => isGM || !record.p || record.u === game.user.id || record.b === game.user.id;
  const records = buckets.flatMap(bucket => Object.values(bucket.records ?? {})).filter(visible).sort((a, b) => a.t - b.t);
  const notes = Object.assign({}, ...buckets.map(bucket => bucket.notes ?? {}));
  const named = [...sessions, unfiled];
  const isGMUser = id => game.users.get(id)?.isGM ?? named.some(bucket => bucket.users?.[id]?.g);
  const byUser = new Map(), byActor = new Map();
  for (const record of records) {
    if (record.u) (byUser.get(record.u) ?? byUser.set(record.u, []).get(record.u)).push(record);
    if (record.a) (byActor.get(record.a) ?? byActor.set(record.a, []).get(record.a)).push(record);
  }
  const cache = new Map();
  const listFor = key => key === "all" ? records : key === "party" ? records.filter(record => !isGMUser(record.u))
    : key?.startsWith("u:") ? byUser.get(key.slice(2)) ?? [] : key?.startsWith("a:") ? byActor.get(key.slice(2)) ?? [] : [];
  const stats = key => cache.get(key) ?? cache.set(key, summarize(listFor(key))).get(key);
  const users = [...byUser.keys()].map(id => {
    const own = byUser.get(id);
    const counts = new Map();
    for (const record of own) if (record.a) counts.set(record.a, (counts.get(record.a) ?? 0) + 1);
    const actors = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
    return { id, key: `u:${id}`, gm: isGMUser(id), name: userName(id, named), actors, role: actors[0] ? roleOf(actors[0]) : "" };
  });
  for (const user of users) user.avg = stats(user.key).d20.avg;
  users.sort((a, b) => a.gm - b.gm || (b.avg ?? -1) - (a.avg ?? -1) || a.name.localeCompare(b.name));
  const label = key => key === "party" ? tr("Party") : key?.startsWith("u:") ? userName(key.slice(2), named)
    : key?.startsWith("a:") ? actorName(key.slice(2), named) : "";
  // Rolls and spells for the last sessions up to the one shown, oldest first.
  const ordered = [...sessions].sort((a, b) => a.start - b.start);
  const upto = session ? ordered.findIndex(entry => entry.id === session.id) : ordered.length - 1;
  const series = ordered.slice(Math.max(0, upto - SERIES + 1), upto + 1).map(entry => {
    const list = Object.values(entry.records ?? {}).filter(visible);
    return { id: entry.id, no: entry.no, rolls: list.filter(isRoll).length, spells: list.filter(isSpell).length, current: entry.id === session?.id };
  });
  return { scope, sessions, session, unfiled, hasUnfiled, records, notes, users, stats, label, isGM, named, series, listFor };
}

/** Awards for a view, leading ones first. */
function awardList(view) {
  const list = awards(view.users.map(user => ({ id: user.key, stats: view.stats(user.key) })));
  return list.sort((a, b) => AWARD_ORDER.indexOf(a.id) - AWARD_ORDER.indexOf(b.id));
}

function awardValue(award, value = award.value) {
  switch (award.id) {
    case "golden": case "cursed": return tr("V.Avg", { n: avg(value) });
    case "quick": return tr("V.Init", { n: avg(value) });
    case "sharpshooter": case "will": case "smooth": return pct(value);
    case "hot": case "cold": return tr("V.Row", { n: value });
    case "crits": return plural("V.N20", value);
    case "fumbles": return plural("V.N1", value);
    case "spells": return plural("V.Spells", value);
    case "heavy": case "biggest": return tr("V.Dmg", { n: num(value) });
    case "medic": return tr("V.Heal", { n: num(value) });
    case "busy": return plural("V.Rolls", value);
    case "downed": return plural("V.Downed", value);
    default: return num(value);
  }
}

/* The window ------------------------------------------------------------------------------------------ */

export class RollTrackerApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["hardwipe-tracker"],
    window: { title: "HARDWIPE.Tracker.Title", icon: "fas fa-dice-d20", resizable: true },
    position: { width: 1060, height: 800 },
    actions: {
      view: RollTrackerApp.#onView, scopeTo: RollTrackerApp.#onScopeTo, entity: RollTrackerApp.#onEntity, step: RollTrackerApp.#onStep,
      filter: RollTrackerApp.#onFilter, recap: RollTrackerApp.#onRecap, show: RollTrackerApp.#onShow, endSession: RollTrackerApp.#onEndSession,
      newSession: RollTrackerApp.#onNewSession, importLog: RollTrackerApp.#onImport, exportData: RollTrackerApp.#onExport,
      deleteSession: RollTrackerApp.#onDelete, editSession: RollTrackerApp.#onEdit, cancelEdit: RollTrackerApp.#onCancelEdit,
      saveSession: RollTrackerApp.#onSaveSession, continueSession: RollTrackerApp.#onContinue, dismissForced: RollTrackerApp.#onDismissForced
    }
  };

  #tab = "overview";
  #scope = null;
  #entity = null;
  #compare = [null, null];
  #filter = "all";
  #editing = null;
  #forced = null;
  #banner = false;
  #stale = false;

  constructor(options = {}) {
    super(options);
    this.focusOn(options);
  }

  /** Switch to a tab or scope from outside (Show players, the note prompts). */
  focusOn({ tab, scope, forced } = {}) {
    if (TABS.includes(tab)) this.#tab = tab;
    if (scope !== undefined && scope !== null) this.#scope = scope;
    if (forced) { this.#forced = forced; this.#banner = true; }
  }

  /** Redraw for new data, or once the field being typed in loses focus. */
  refresh() {
    const active = document.activeElement;
    if (this.element?.contains(active) && active.matches("input, select, textarea")) {
      if (!this.#stale) {
        this.#stale = true;
        active.addEventListener("blur", () => { this.#stale = false; if (this.rendered) this.render(); }, { once: true });
      }
      return;
    }
    this.render();
  }

  async _renderHTML() {
    const forced = !!this.#forced;
    if (!canView() && !forced) return `<div class="hwhr"><div class="hwhr-empty"><i class="fas fa-lock" inert></i><p>${e(tr("Locked"))}</p></div></div>`;
    const view = buildView(this.#scope);
    if (this.#tab === "sessions" && !view.isGM) this.#tab = "overview";
    let body;
    const empty = !view.sessions.length && !view.hasUnfiled;
    if (empty && this.#tab !== "sessions") body = this.#empty(tr("NoSessions"), view.isGM ? tr("NoSessionsGM") : "");
    else body = {
      overview: () => this.#overview(view), players: () => this.#players(view), compare: () => this.#comparison(view),
      dice: () => this.#dice(view), moments: () => this.#moments(view), sessions: () => this.#sessionsTab(view)
    }[this.#tab]();
    return `<div class="hwhr" data-tab="${this.#tab}"><span class="hwhr-ruler is-l"></span><span class="hwhr-ruler is-r"></span>
      ${this.#top(view)}${this.#sub(view)}
      ${forced && this.#banner ? `<div class="hwhr-forced"><i class="fas fa-satellite-dish" inert></i><span>${e(tr("Forced", { name: this.#forced }))}</span><button type="button" data-action="dismissForced">${e(tr("Dismiss"))}</button></div>` : ""}
      <div class="hwhr-body">${body}</div>${this.#foot(view)}</div>`;
  }

  _replaceHTML(result, content) {
    const before = content.querySelector(".hwhr");
    const scroll = before?.dataset.tab === this.#tab ? content.querySelector(".hwhr-body")?.scrollTop ?? 0 : 0;
    content.innerHTML = result;
    const body = content.querySelector(".hwhr-body");
    if (body) body.scrollTop = scroll;
    content.querySelector("select[name=scope]")?.addEventListener("change", event => { this.#scope = event.target.value || null; this.#editing = null; this.render(); });
    content.querySelector("select[name=entity]")?.addEventListener("change", event => { this.#entity = event.target.value; this.render(); });
    for (const select of content.querySelectorAll("select[name^=compare]")) {
      select.addEventListener("change", event => { this.#compare[Number(event.target.dataset.side)] = event.target.value; this.render(); });
    }
    for (const input of content.querySelectorAll("input[data-note]")) {
      input.addEventListener("change", async () => {
        const row = input.closest(".hwhr-mom");
        try { await setNote(input.dataset.note, input.value); row?.classList.add("is-saved"); }
        catch (error) { console.error(error); ui.notifications.error(tr("NoteFailed")); }
      });
      input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); input.blur(); } });
    }
    const form = content.querySelector(".hwhr-edit");
    if (form) {
      const update = () => {
        const date = form.querySelector("[name=date]").value;
        const start = fromInputs(date, form.querySelector("[name=start]").value);
        let end = form.querySelector("[name=end]") ? fromInputs(date, form.querySelector("[name=end]").value) : null;
        if (end !== null && start !== null && end < start) end += 86400000;
        const note = form.querySelector(".hwhr-edit-note");
        if (!note || start === null) return;
        const { count, before } = previewRefile(form.dataset.session, start, end);
        note.innerHTML = count === before ? e(tr("EditSame", { n: count }))
          : count > before ? tr("EditMore", { n: `<b>${count - before}</b>`, total: count }) : tr("EditFewer", { n: `<b>${before - count}</b>`, total: count });
      };
      form.addEventListener("input", update);
      update();
    }
  }

  #empty(title, hint = "") {
    return `<div class="hwhr-empty"><i class="fas fa-dice-d20" inert></i><p>${e(title)}</p>${hint ? `<small>${e(hint)}</small>` : ""}</div>`;
  }

  /* Header: counters and tabs ---------------------------------------------------------------------- */

  #top(view) {
    const s = view.stats("all");
    const series = view.series;
    const index = series.findIndex(entry => entry.current);
    const previous = index > 0 ? series[index - 1] : null;
    const delta = (now, then) => {
      if (!previous || view.scope === "all" || view.scope === "unfiled") return "";
      const d = now - then;
      return tr("VsSession", { d: `${d >= 0 ? "+" : "−"}${Math.abs(d)}`, no: previous.no });
    };
    const share = (value, key) => Math.round(value / Math.max(1, value, ...series.map(entry => entry[key])) * 100);
    const tabs = TABS.filter(id => id !== "sessions" || view.isGM).map(id => `<button type="button" class="hwhr-tab${id === this.#tab ? " is-active" : ""}" data-action="view" data-view="${id}" aria-pressed="${id === this.#tab}">${e(tr(`Tab.${id}`))}</button>`).join("");
    return `<header class="hwhr-top">
      <div class="hwhr-cred"><span><b>${num(s.rolls)}</b><em>${e(tr("Rolls"))}</em></span><i style="--v: ${share(s.rolls, "rolls")}%"></i><small>${e(delta(s.rolls, previous?.rolls ?? 0) || tr("DiceThrown", { n: num(s.diceTotal) }))}</small></div>
      <div class="hwhr-cred is-spells"><span><b>${num(s.cast.n)}</b><em>${e(tr("SpellsCast"))}</em></span><i style="--v: ${share(s.cast.n, "spells")}%"></i><small>${e(delta(s.cast.n, previous?.spells ?? 0) || tr("WithSlot", { n: s.cast.leveled }))}</small></div>
      <div class="hwhr-cred is-plain"><span><b>${avg(s.d20.avg)}</b><em>${e(tr("D20Avg"))}</em></span><small>${e(tr("NatLine", { t: s.d20.nat20, o: s.d20.nat1 }))}</small></div>
      <nav class="hwhr-tabs" aria-label="${e(tr("Title"))}">${tabs}</nav>
    </header>`;
  }

  #sub(view) {
    const session = view.session;
    let text;
    if (view.scope === "all") text = `<b>${e(tr("Campaign"))}</b> · ${e(tr("CampaignSpan", { n: view.sessions.length }))}`;
    else if (view.scope === "unfiled") text = `<b>${e(tr("Unfiled"))}</b> · ${e(tr("UnfiledHint"))}`;
    else if (session) text = `<b>${e(sessionName(session))}</b>${session.name ? ` · ${e(tr("SessionN", { n: session.no }))}` : ""} · ${e(dateText(session.start))} · ${e(span(session))}${session.live ? ` · <span class="hwhr-live">● ${e(tr("Recording"))}</span>` : ""}`;
    else text = e(tr("NoSessions"));
    const options = [
      ...view.sessions.map(entry => `<option value="${e(entry.id)}"${view.scope !== "all" && view.scope !== "unfiled" && entry.id === session?.id ? " selected" : ""}>${e(tr("SessionN", { n: entry.no }))}${entry.name ? ` · ${e(entry.name)}` : ""}${entry.live ? ` · ${e(tr("Live"))}` : ""}</option>`),
      ...(view.hasUnfiled ? [`<option value="unfiled"${view.scope === "unfiled" ? " selected" : ""}>${e(tr("Unfiled"))}</option>`] : []),
      `<option value="all"${view.scope === "all" ? " selected" : ""}>${e(tr("Campaign"))}</option>`
    ].join("");
    const noSession = view.isGM && !view.sessions.some(entry => entry.live);
    return `<div class="hwhr-sub"><span><span class="hwhr-brand">${e(tr("Brand"))}</span> · ${text}</span>
      ${noSession ? `<button type="button" class="hwhr-btn is-cy is-small" data-action="newSession"><i class="fas fa-plug" inert></i>${e(tr("StartSession"))}</button>` : ""}
      <select name="scope" aria-label="${e(tr("Show"))}">${options}</select></div>`;
  }

  #foot(view) {
    const gm = view.isGM;
    let left = "";
    if (gm && this.#tab === "sessions") left = `
      <button type="button" class="hwhr-btn is-cy" data-action="newSession"><i class="fas fa-plug" inert></i>${e(tr("NewSession"))}</button>
      <button type="button" class="hwhr-btn" data-action="endSession"${view.sessions.some(entry => entry.live) ? "" : " disabled"}><i class="fas fa-flag-checkered" inert></i>${e(tr("EndSession"))}</button>
      <button type="button" class="hwhr-btn" data-action="importLog"><i class="fas fa-file-import" inert></i>${e(tr("ImportLog"))}</button>
      <button type="button" class="hwhr-btn" data-action="exportData"><i class="fas fa-file-export" inert></i>${e(tr("Export"))}</button>`;
    else if (gm) left = `
      <button type="button" class="hwhr-btn" data-action="recap"${view.records.length ? "" : " disabled"}><i class="fas fa-newspaper" inert></i>${e(tr("PostRecap"))}</button>
      <button type="button" class="hwhr-btn is-yel" data-action="show"><i class="fas fa-satellite-dish" inert></i>${e(tr("ShowPlayers"))}</button>`;
    const nats = view.records.filter(nat);
    const open = nats.filter(record => !view.notes[record.k]).length;
    const status = this.#tab !== "sessions" && nats.length ? `<span class="hwhr-status">${e(tr("NatStatus", { n: nats.length, open }))}</span>` : "";
    return `<footer class="hwhr-foot">${left}${status}<span class="hwhr-hint"><kbd>ESC</kbd>${e(tr("Close"))}</span></footer>`;
  }

  /* Overview ---------------------------------------------------------------------------------------- */

  #overview(view) {
    if (!view.records.length) return this.#empty(tr("NoRolls"), view.isGM && !view.sessions.some(entry => entry.live) ? tr("NoLiveHint") : "");
    let rank = 0;
    const rows = view.users.map(user => {
      const st = view.stats(user.key);
      const label = user.gm ? tr("GM") : pad2(++rank);
      return `<tr class="${rank === 1 && !user.gm ? "is-first " : ""}${user.gm ? "is-gm" : ""}" data-action="entity" data-entity="${e(user.key)}" tabindex="0">
        <td class="hwhr-rank"><span>${e(label)}</span></td>
        <td class="hwhr-who"><b>${e(user.name)}${user.role ? `<span class="hwhr-role">${e(user.role)}</span>` : ""}</b><small>${e(user.actors.slice(0, 3).map(id => actorName(id, view.named)).join(", ") || "—")}</small></td>
        <td>${num(st.rolls)}</td><td class="is-spell">${num(st.cast.n)}</td><td>${avg(st.d20.avg)}</td><td class="is-n20">${num(st.d20.nat20)}</td><td class="is-n1">${num(st.d20.nat1)}</td>
        <td>${this.#last10(st)}</td></tr>`;
    }).join("");
    const cols = ["Rank", "Player", "Rolls", "Spells", "Avg", "N20", "N1", "Last10"].map(key => `<th scope="col">${e(tr(`Col.${key}`))}</th>`).join("");
    const s = view.stats("all");
    const firefight = `<div class="hwhr-fnf">
      <div><span>${e(tr("F.Attacks"))}</span><b>${num(s.atk.n)}<small>${e(tr("F.Hit", { pct: pct(s.atk.rate) }))}</small></b></div>
      <div><span>${e(tr("F.Crits"))}</span><b>${num(s.atk.crit)}</b></div>
      <div><span>${e(tr("F.Damage"))}</span><b>${num(s.dmg.total)}<small>${e(tr("F.Best", { n: num(s.dmg.max) }))}</small></b></div>
      <div><span>${e(tr("F.Healing"))}</span><b>${num(s.heal.total)}</b></div>
      <div><span>${e(tr("F.Downed"))}</span><b>${num(s.evt.downed)}<small>${e(tr("F.Flatlined", { n: s.evt.flatlined }))}</small></b></div>${s.memory
        ? `<div class="is-memory"><span>${e(tr("F.Memory"))}</span><b>${num(s.memory)}<small>${e(tr("F.MemoryHint"))}</small></b></div>` : ""}</div>`;
    const cards = awardList(view).slice(0, 9).map(award => this.#award(view, award)).join("");
    const moments = view.records.filter(record => nat(record) && view.notes[record.k]).slice(-3).reverse();
    return `<div class="hwhr-split">
      <section>
        <h3 class="hwhr-rb"><span>${e(tr("Ranking"))}</span><small>${e(tr("RankingHint"))}</small></h3>
        <div class="hwhr-tablewrap"><table class="hwhr-table"><thead><tr>${cols}</tr></thead><tbody>${rows}</tbody></table></div>
        <h3 class="hwhr-rb"><span>${e(tr("Firefight"))}</span><small>${e(tr(view.scope === "all" ? "FirefightHintAll" : view.scope === "unfiled" ? "FirefightHintUnfiled" : "FirefightHint"))}</small></h3>${firefight}
        ${cards ? `<h3 class="hwhr-rb"><span>${e(tr("Awards"))}</span><small>${e(tr("AwardsHint"))}</small></h3><div class="hwhr-awards">${cards}</div>` : ""}
        ${moments.length ? `<h3 class="hwhr-rb"><span>${e(tr("LatestMoments"))}</span></h3>${this.#momentList(view, moments, { compact: true })}` : ""}
      </section>
      <aside class="hwhr-side">${this.#seriesTip(view, "rolls")}${this.#seriesTip(view, "spells")}${this.#topSpells(view)}</aside>
    </div>`;
  }

  #last10(stats) {
    const last = stats.d20.timeline.slice(-10);
    if (!last.length) return `<span class="hwhr-none">—</span>`;
    return `<span class="hwhr-last" role="img" aria-label="${e(tr("Last10Aria", { list: last.map(point => point[1]).join(", ") }))}">${last.map(([, n]) => `<i class="${n === 20 ? "is-n20" : n === 1 ? "is-n1" : n >= 11 ? "is-hi" : "is-lo"}"></i>`).join("")}</span>`;
  }

  #award(view, award) {
    const names = award.entities.map(key => view.label(key)).join(" & ");
    const runner = award.runner ? tr("RunnerUp", { name: award.runner.entities.map(key => view.label(key)).join(" & "), value: awardValue(award, award.runner.value) }) : tr("NoRunner");
    return `<article class="hwhr-award is-${e(award.id)}">
      <i class="fas ${AWARD_ICONS[award.id] ?? "fa-medal"}" inert></i>
      <div><span class="t">${e(tr(`Award.${award.id}`))}</span><b>${e(names)}</b><em>${e(awardValue(award))}${award.detail ? ` · ${e(award.detail)}` : ""}</em>
        <small>${e(tr(`Award.${award.id}Hint`))}</small><small class="r">${e(runner)}</small></div></article>`;
  }

  #seriesTip(view, kind) {
    if (!view.series.length) return "";
    const top = Math.max(1, ...view.series.map(entry => entry[kind]));
    const bars = view.series.map(entry => `<div class="${entry.current ? "is-now" : ""}"><span>${num(entry[kind])}</span><i style="height: ${Math.round(entry[kind] / top * 70)}%"></i><small>${entry.current ? e(tr("Now")) : `S${entry.no}`}</small></div>`).join("");
    return `<div class="hwhr-tip is-${kind}"><h4>${e(tr(kind === "rolls" ? "RollsPerSession" : "SpellsPerSession"))}</h4><div class="hwhr-bars">${bars}</div></div>`;
  }

  #topSpells(view) {
    const top = Object.entries(view.stats("all").cast.bySpell).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (!top.length) return "";
    return `<div class="hwhr-tip"><h4>${e(tr("MostCast"))}</h4><div class="hwhr-lines">${top.map(([name, n]) => `<div><span>${e(name)}</span><b class="is-spell">${num(n)}</b></div>`).join("")}</div></div>`;
  }

  /* Players: the character screen --------------------------------------------------------------------- */

  #players(view) {
    if (!view.records.length) return this.#empty(tr("NoRolls"));
    const keys = [...view.users.map(user => user.key), ...view.users.flatMap(user => user.actors.map(id => `a:${id}`))];
    if (!keys.includes(this.#entity)) this.#entity = view.users.find(user => !user.gm)?.key ?? view.users[0]?.key;
    const key = this.#entity;
    const user = key.startsWith("u:") ? view.users.find(entry => entry.key === key) : view.users.find(entry => entry.actors.includes(key.slice(2)));
    const at = view.users.indexOf(user);
    const prev = view.users.length > 2 ? view.users[(at - 1 + view.users.length) % view.users.length] : null;
    const next = view.users.length > 1 ? view.users[(at + 1) % view.users.length] : null;
    const role = key.startsWith("a:") ? roleOf(key.slice(2)) : user?.role ?? "";
    const sub = key.startsWith("u:") ? (user?.actors ?? []).map(id => actorName(id, view.named)).join(", ") : tr("PlayedBy", { name: user?.name ?? "" });
    const options = view.users.map(entry => `<option value="${e(entry.key)}"${entry.key === key ? " selected" : ""}>${e(entry.name)}</option>${entry.actors.map(id => `<option value="a:${e(id)}"${`a:${id}` === key ? " selected" : ""}>    ${e(actorName(id, view.named))}</option>`).join("")}`).join("");
    const s = view.stats(key);
    const list = view.listFor(key);
    const best = list.filter(record => D20_KINDS.has(record.c)).reduce((top, record) => (record.v ?? -Infinity) > (top?.v ?? -Infinity) ? record : top, null);
    const hex = (x, y, label, value, small, cls = "") => `<div class="hwhr-hex${cls}" style="left: ${x}px; top: ${y}px"><div><span>${e(label)}</span><b>${value}</b><small>${e(small)}</small></div></div>`;
    const hexes = [
      hex(140, 0, tr("H.Accuracy"), pct(s.atk.rate), tr("H.AccuracySub", { hit: s.atk.hit, n: s.atk.hit + s.atk.miss })),
      hex(0, 84, tr("H.Damage"), num(s.dmg.total), tr("H.DamageSub", { n: num(s.dmg.max) })),
      hex(280, 84, tr("H.Magic"), `<span class="is-spell">${num(s.cast.n)}</span>`, tr("H.MagicSub", { n: s.cast.leveled })),
      hex(130, 172, tr("H.Avg"), avg(s.d20.avg), tr("H.AvgSub"), " is-core"),
      hex(0, 262, tr("H.Saves"), s.save.known ? `${s.save.made}/${s.save.known}` : num(s.save.n), s.save.known ? pct(s.save.rate) : tr("H.NoDC")),
      hex(280, 262, tr("H.Checks"), s.check.known ? `${s.check.made}/${s.check.known}` : num(s.check.n), s.check.known ? pct(s.check.rate) : tr("H.NoDC")),
      hex(140, 346, tr("H.Streak"), `${s.d20.hot}`, tr("H.StreakSub", { n: s.d20.cold }))
    ].join("");
    const insight = this.#insight(s);
    const spells = Object.entries(s.cast.bySpell).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const mine = record => key.startsWith("u:") ? record.u === key.slice(2) : record.a === key.slice(2);
    const per = [...view.sessions].sort((a, b) => a.start - b.start).slice(-4).map(session => {
      const own = Object.values(session.records ?? {}).filter(mine);
      return { no: session.no, current: session.id === view.session?.id, rolls: own.filter(isRoll).length, spells: own.filter(isSpell).length };
    });
    const kinds = KIND_GROUPS.map(([id, group]) => ({ id, n: list.filter(record => group.includes(record.c)).length }));
    return `<div class="hwhr-pick">
        ${prev ? `<button type="button" class="hwhr-key" data-action="step" data-entity="${e(prev.key)}" aria-label="${e(prev.name)}"><i class="fas fa-chevron-left" inert></i></button><span class="hwhr-dim">${e(prev.name)}</span>` : ""}
        <span class="hwhr-pname"><b>${e(view.label(key))}</b>${role ? `<span class="hwhr-role">${e(role)}</span>` : ""}<small>${e(sub)}</small></span>
        ${next ? `<span class="hwhr-dim">${e(next.name)}</span><button type="button" class="hwhr-key" data-action="step" data-entity="${e(next.key)}" aria-label="${e(next.name)}"><i class="fas fa-chevron-right" inert></i></button>` : ""}
        <select name="entity" aria-label="${e(tr("PickPlayer"))}">${options}</select></div>
      <div class="hwhr-split">
        <section class="hwhr-attr">
          <div class="hwhr-pts">
            <div><b class="is-roll">${num(s.rolls)}</b><span>${e(tr("Rolls"))}</span></div>
            <div><b class="is-spell">${num(s.cast.n)}</b><span>${e(tr("SpellsCast"))}</span></div>
            <div><b class="is-n20">${num(s.d20.nat20)}</b><span>${e(tr("Nat20s"))}</span></div>
            <div><b class="is-n1">${num(s.d20.nat1)}</b><span>${e(tr("Nat1s"))}</span></div>
            ${best ? `<div><b>${num(best.v)}</b><span>${e(tr("BestRoll"))}<small>${e(describeRecord(best).title)}</small></span></div>` : ""}
          </div>
          <div class="hwhr-hexes">${hexes}</div>
        </section>
        <aside class="hwhr-side">
          <div class="hwhr-tip"><h4>${e(tr("Faces"))}</h4>${s.d20.n ? this.#faces(s.d20.hist) : `<p class="hwhr-none">${e(tr("Nothing"))}</p>`}${insight ? `<p>${insight}</p>` : ""}</div>
          <div class="hwhr-tip"><h4>${e(tr("SpellsCastTitle"))}</h4>${spells.length ? `<div class="hwhr-lines">${spells.map(([name, n]) => `<div><span>${e(name)}</span><b class="is-spell">${n}</b></div>`).join("")}</div>` : `<p class="hwhr-none">${e(tr("NoSpells"))}</p>`}</div>
          <div class="hwhr-tip"><h4>${e(tr("PerSession"))}</h4><div class="hwhr-lines">${per.map(entry => `<div class="${entry.current ? "is-now" : ""}"><span>${e(tr("SessionN", { n: entry.no }))}</span><b><span class="is-roll">${entry.rolls}</span> · <span class="is-spell">${entry.spells}</span></b></div>`).join("")}</div><p class="hwhr-small">${e(tr("PerSessionKey"))}</p></div>
          <div class="hwhr-tip"><h4>${e(tr("RollTypes"))}</h4><div class="hwhr-lines">${kinds.map(kind => `<div><span>${e(tr(`Kind.${kind.id}`))}</span><b>${kind.n}</b></div>`).join("")}</div></div>
        </aside>
      </div>`;
  }

  /** One line on how the faces lean, or nothing when there is too little to say. */
  #insight(s) {
    if (s.d20.n < 15) return "";
    const fair = s.d20.n / 20;
    const ones = s.d20.hist[1] / fair, twenties = s.d20.hist[20] / fair;
    if (ones >= 2 && s.d20.hist[1] >= 3) return tr("InsightOnes", { x: `<b>${ones.toFixed(1)}×</b>` });
    if (twenties >= 2 && s.d20.hist[20] >= 3) return tr("InsightTwenties", { x: `<b>${twenties.toFixed(1)}×</b>` });
    return e(tr("InsightFair"));
  }

  #faces(hist) {
    const values = hist.slice(1, 21);
    const top = Math.max(1, ...values);
    return `<div class="hwhr-faces">${values.map((value, index) => `<i class="${index === 0 ? "is-n1" : index === 19 ? "is-n20" : ""}" style="height: ${Math.round(value / top * 100)}%" title="${index + 1}: ${value}"></i>`).join("")}</div><div class="hwhr-axis"><span>1</span><span>10</span><span>20</span></div>`;
  }

  /* Compare: the item comparison ---------------------------------------------------------------------- */

  #comparison(view) {
    if (!view.records.length) return this.#empty(tr("NoRolls"));
    const players = view.users.map(user => ({ key: user.key, name: user.name }));
    const actors = view.users.flatMap(user => user.actors.map(id => ({ key: `a:${id}`, name: actorName(id, view.named) })));
    const groups = [...(view.users.filter(user => !user.gm).length > 1 ? [{ key: "party", name: tr("Party") }] : []), ...players];
    const valid = new Set([...groups, ...actors].map(option => option.key));
    let [a, b] = this.#compare;
    if (!valid.has(a)) a = view.users.find(user => !user.gm)?.key ?? groups[0]?.key;
    if (!valid.has(b) || b === a) b = view.users.find(user => user.gm && user.key !== a)?.key ?? [...groups, ...actors].find(option => option.key !== a)?.key ?? a;
    this.#compare = [a, b];
    const A = view.stats(a), B = view.stats(b);
    const rows = [
      ["Rolls", s => s.rolls, num], ["SpellsCast", s => s.cast.n, num], ["D20Avg", s => s.d20.avg, avg],
      ["Nat20s", s => s.d20.nat20, num], ["Nat1s", s => s.d20.nat1, num, true], ["HitRate", s => s.atk.rate, pct, false, true],
      ["Damage", s => s.dmg.total, num], ["BiggestHit", s => s.dmg.max, num], ["SavesMade", s => s.save.rate, pct, false, true], ["Initiative", s => s.init.avg, avg]
    ];
    let winsA = 0, winsB = 0;
    const lines = rows.map(([id, get, format, lower, percent]) => {
      const va = get(A), vb = get(B);
      let delta = `<em class="is-even">=</em>`;
      if (Number.isFinite(va) && Number.isFinite(vb) && va !== vb) {
        const better = (va > vb) !== !!lower;
        if (better) winsA++; else winsB++;
        const diff = Math.abs(va - vb);
        const text = percent ? `${Math.round(diff * 100)}%` : Number.isInteger(diff) ? num(diff) : diff.toFixed(1);
        delta = `<em class="${better ? "is-up" : "is-down"}">${va > vb ? "▲" : "▼"} ${text}</em>`;
      } else if (!Number.isFinite(va) || !Number.isFinite(vb)) delta = `<em class="is-even"></em>`;
      return { id, a: format(va), b: format(vb), delta };
    });
    const select = (side, value) => `<select name="compare${side}" data-side="${side}" aria-label="${e(tr(side ? "CompareB" : "CompareA"))}">
      <optgroup label="${e(tr("Players"))}">${groups.map(option => `<option value="${e(option.key)}"${option.key === value ? " selected" : ""}>${e(option.name)}</option>`).join("")}</optgroup>
      ${actors.length ? `<optgroup label="${e(tr("Characters"))}">${actors.map(option => `<option value="${e(option.key)}"${option.key === value ? " selected" : ""}>${e(option.name)}</option>`).join("")}</optgroup>` : ""}</select>`;
    const card = (side, key, rowsHTML) => `<div class="hwhr-card${side ? " is-b" : ""}"><div class="hwhr-card-head"><small>${e(tr(side ? "Compared" : "Equipped"))}</small>${select(side, key)}<span>${e(this.#entitySub(view, key))}</span></div>${rowsHTML}</div>`;
    const verdict = winsA === winsB ? tr("Draw", { a: winsA }) : tr("Wins", { name: view.label(winsA > winsB ? a : b), w: Math.max(winsA, winsB), l: Math.min(winsA, winsB) });
    return `<div class="hwhr-cmp">
      ${card(0, a, lines.map(line => `<div class="hwhr-stat"><span>${e(tr(`M.${line.id}`))}</span><b>${line.a}</b>${line.delta}</div>`).join(""))}
      ${card(1, b, lines.map(line => `<div class="hwhr-stat"><span>${e(tr(`M.${line.id}`))}</span><b>${line.b}</b><em></em></div>`).join(""))}
      <div class="hwhr-verdict"><b>${e(verdict)}</b><span>${e(tr("VerdictHint"))}</span></div></div>`;
  }

  #entitySub(view, key) {
    if (key === "party") return tr("PartyHint");
    if (key.startsWith("a:")) return [roleOf(key.slice(2)), tr("PlayedBy", { name: view.users.find(user => user.actors.includes(key.slice(2)))?.name ?? "" })].filter(Boolean).join(" · ");
    const user = view.users.find(entry => entry.key === key);
    return [user?.role, (user?.actors ?? []).slice(0, 2).map(id => actorName(id, view.named)).join(", ")].filter(Boolean).join(" · ");
  }

  /* Dice -------------------------------------------------------------------------------------------- */

  #dice(view) {
    if (!view.records.length) return this.#empty(tr("NoRolls"));
    const cards = view.users.map(user => {
      const s = view.stats(user.key);
      const p = s.d20.fair;
      const verdict = s.d20.rawN < 60 ? ["few", tr("Fair.Few", { n: 60 - s.d20.rawN })] : p < 0.01 ? ["odd", tr("Fair.Suspicious")] : p < 0.05 ? ["warn", tr("Fair.Odd")] : ["ok", tr("Fair.Fine")];
      return `<div class="hwhr-tip hwhr-die"><h4>${e(user.name)}<small>${e(tr("NFaces", { n: num(s.d20.rawN) }))}</small></h4>${s.d20.rawN ? this.#faces(s.d20.raw) : `<p class="hwhr-none">${e(tr("Nothing"))}</p>`}
        <p class="is-${verdict[0]}">${e(verdict[1])}${s.d20.rawN >= 60 && Number.isFinite(p) ? ` <small>p = ${p < 0.001 ? "&lt;0.001" : p.toFixed(3)}</small>` : ""}</p></div>`;
    }).join("");
    const bag = view.users.map(user => {
      const s = view.stats(user.key);
      const other = Object.entries(s.dice).filter(([faces]) => !DICE.includes(Number(faces))).reduce((sum, [, count]) => sum + count, 0);
      return `<tr><td class="hwhr-who"><b>${e(user.name)}</b></td>${DICE.map(faces => `<td>${s.dice[faces] ? num(s.dice[faces]) : "·"}</td>`).join("")}<td>${other ? num(other) : "·"}</td><td class="is-total">${num(s.diceTotal)}</td></tr>`;
    }).join("");
    return `<p class="hwhr-hint-line">${e(tr("DiceHint"))}</p><div class="hwhr-dice">${cards}</div>
      <h3 class="hwhr-rb"><span>${e(tr("DiceBag"))}</span></h3>
      <div class="hwhr-tablewrap"><table class="hwhr-table is-bag"><thead><tr><th scope="col">${e(tr("Col.Player"))}</th>${DICE.map(faces => `<th scope="col">d${faces}</th>`).join("")}<th scope="col">${e(tr("Other"))}</th><th scope="col">${e(tr("Total"))}</th></tr></thead><tbody>${bag}</tbody></table></div>`;
  }

  /* Moments ----------------------------------------------------------------------------------------- */

  #moments(view) {
    const all = view.records.filter(nat);
    const shown = all.filter(record => this.#filter === "all" || (this.#filter === "20" && record.n === 20) || (this.#filter === "1" && record.n === 1)
      || (this.#filter === "open" && !view.notes[record.k])).reverse();
    const chip = (id, label, count) => `<button type="button" class="hwhr-chip${this.#filter === id ? " is-active" : ""}" data-action="filter" data-filter="${id}" aria-pressed="${this.#filter === id}">${e(label)} <b>${count}</b></button>`;
    const chips = [chip("all", tr("All"), all.length), chip("20", tr("Nat20"), all.filter(r => r.n === 20).length), chip("1", tr("Nat1"), all.filter(r => r.n === 1).length),
      ...(view.isGM ? [chip("open", tr("NeedsNote"), all.filter(r => !view.notes[r.k]).length)] : [])].join("");
    return `<div class="hwhr-chips">${chips}</div>${shown.length ? this.#momentList(view, shown) : this.#empty(tr("NoMoments"))}`;
  }

  #momentList(view, records, { compact = false } = {}) {
    return `<div class="hwhr-moments${compact ? " is-compact" : ""}">${records.map(record => {
      const { title, result } = describeRecord(record);
      const note = view.notes[record.k] ?? "";
      const user = userName(record.u, view.named);
      const actor = record.a ? actorName(record.a, view.named) : "";
      const noteHTML = view.isGM && !compact
        ? `<input type="text" data-note="${e(record.k)}" value="${e(note)}" maxlength="${NOTE_LIMIT}" placeholder="${e(tr(record.n === 20 ? "AskNat20" : "AskNat1"))}" aria-label="${e(tr("NoteLabel"))}">`
        : note ? `<q>${e(note)}</q>` : `<span class="hwhr-none">${e(tr("NoNote"))}</span>`;
      return `<article class="hwhr-mom is-n${record.n}"><span class="hwhr-natbox">${record.n}</span>
        <div><div class="hwhr-mom-top"><b>${e(actor || user)}</b>${actor && actor !== user ? `<small>${e(user)}</small>` : ""}<small>${e(title)}${result ? `, ${e(result)}` : ""}</small><time>${e(view.scope === "all" ? `${dateText(record.t)} ${timeText(record.t)}` : timeText(record.t))}</time></div>
        ${noteHTML}</div></article>`;
    }).join("")}</div>`;
  }

  /* Sessions (GM) ------------------------------------------------------------------------------------ */

  #sessionsTab(view) {
    const head = ["No", "Session", "Date", "Time", "Rolls", "Spells", "Nats", ""].map(key => `<th scope="col">${key ? e(tr(`Col.${key}`)) : ""}</th>`).join("");
    const rows = view.sessions.map(session => {
      const records = Object.values(session.records ?? {});
      const d20 = records.filter(record => D20_KINDS.has(record.c));
      const editing = this.#editing === session.id;
      const row = `<tr class="${session.live ? "is-live " : ""}${editing ? "is-editing" : ""}">
        <td class="hwhr-rank"><span>${pad2(session.no ?? 0)}</span></td>
        <td class="hwhr-who"><b>${e(sessionName(session))}${session.live ? `<span class="hwhr-livetag">${e(tr("Live"))}</span>` : ""}</b><small>${e(length(session.start, session.live ? Date.now() : session.end ?? session.last))}</small></td>
        <td class="is-text">${e(dateText(session.start))}</td><td class="is-text">${e(span(session))}</td>
        <td>${num(records.filter(isRoll).length)}</td><td class="is-spell">${num(records.filter(isSpell).length)}</td>
        <td class="is-text"><span class="is-n20">${d20.filter(record => record.n === 20).length}</span> / <span class="is-n1">${d20.filter(record => record.n === 1).length}</span></td>
        <td class="hwhr-actions">
          <button type="button" class="hwhr-icon${editing ? " is-on" : ""}" data-action="editSession" data-session="${e(session.id)}" data-tooltip="${e(tr("Edit"))}" aria-label="${e(tr("Edit"))}"><i class="fas fa-pen" inert></i></button>
          <button type="button" class="hwhr-icon" data-action="scopeTo" data-session="${e(session.id)}" data-tooltip="${e(tr("View"))}" aria-label="${e(tr("View"))}"><i class="fas fa-eye" inert></i></button>
          ${session.live ? "" : `<button type="button" class="hwhr-icon" data-action="continueSession" data-session="${e(session.id)}" data-tooltip="${e(tr("Reopen"))}" aria-label="${e(tr("Reopen"))}"><i class="fas fa-play" inert></i></button>`}
          <button type="button" class="hwhr-icon is-danger" data-action="deleteSession" data-session="${e(session.id)}" data-tooltip="${e(tr("Delete"))}" aria-label="${e(tr("Delete"))}"><i class="fas fa-xmark" inert></i></button></td></tr>`;
      if (!editing) return row;
      const end = session.end ?? session.last ?? session.start;
      return row + `<tr class="is-form"><td></td><td colspan="7"><div class="hwhr-edit" data-session="${e(session.id)}">
        <label class="is-name"><span>${e(tr("F.Name"))}</span><input type="text" name="name" value="${e(session.name ?? "")}" placeholder="${e(tr("SessionN", { n: session.no }))}" maxlength="80"></label>
        <label><span>${e(tr("F.Number"))}</span><input type="number" name="no" value="${session.no ?? 1}" min="1" step="1"></label>
        <label><span>${e(tr("F.Date"))}</span><input type="date" name="date" value="${dateInput(session.start)}"></label>
        <label><span>${e(tr("F.Starts"))}</span><input type="time" name="start" value="${timeInput(session.start)}"></label>
        <label><span>${e(tr("F.Ends"))}</span>${session.live ? `<input type="text" value="${e(tr("Now"))}" disabled>` : `<input type="time" name="end" value="${timeInput(end)}">`}</label>
        <button type="button" class="hwhr-btn is-cy" data-action="saveSession" data-session="${e(session.id)}"><i class="fas fa-check" inert></i>${e(tr("Save"))}</button>
        <button type="button" class="hwhr-btn" data-action="cancelEdit">${e(tr("Cancel"))}</button>
        <p class="hwhr-edit-note"></p></div></td></tr>`;
    }).join("");
    const unf = Object.values(view.unfiled.records ?? {});
    const first = unf.length ? Math.min(...unf.map(record => record.t)) : 0;
    const lastT = unf.length ? Math.max(...unf.map(record => record.t)) : 0;
    const unfiledRow = unf.length ? `<tr class="is-unfiled"><td class="hwhr-rank"><span>—</span></td><td class="hwhr-who"><b>${e(tr("Unfiled"))}</b><small>${e(tr("UnfiledRow"))}</small></td>
      <td class="is-text">${e(dateText(first))}</td><td class="is-text">${e(timeText(first))} → ${e(timeText(lastT))}</td>
      <td>${num(unf.filter(isRoll).length)}</td><td class="is-spell">${num(unf.filter(isSpell).length)}</td><td></td>
      <td class="hwhr-actions"><button type="button" class="hwhr-icon" data-action="scopeTo" data-session="unfiled" data-tooltip="${e(tr("View"))}" aria-label="${e(tr("View"))}"><i class="fas fa-eye" inert></i></button></td></tr>` : "";
    return `<h3 class="hwhr-rb"><span>${e(tr("SessionLog"))}</span><small>${e(tr("SessionLogHint"))}</small></h3>
      ${rows || unfiledRow ? `<div class="hwhr-tablewrap"><table class="hwhr-table is-sessions"><thead><tr>${head}</tr></thead><tbody>${rows}${unfiledRow}</tbody></table></div>` : this.#empty(tr("NoSessions"), tr("NoSessionsGM"))}`;
  }

  /* Actions ----------------------------------------------------------------------------------------- */

  static #onView(event, target) { this.#tab = target.dataset.view; this.render(); }
  static #onEntity(event, target) { this.#entity = target.dataset.entity; this.#tab = "players"; this.render(); }
  static #onStep(event, target) { this.#entity = target.dataset.entity; this.render(); }
  static #onFilter(event, target) { this.#filter = target.dataset.filter; this.render(); }
  static #onScopeTo(event, target) { this.#scope = target.dataset.session; this.#tab = "overview"; this.render(); }
  static #onDismissForced() { this.#banner = false; this.render(); }
  static #onRecap() { openRecapDialog({ scope: this.#scope }); }
  static #onShow() { showPlayers({ tab: this.#tab === "sessions" ? "overview" : this.#tab, scope: this.#scope }); }
  static #onNewSession() { openSessionDialog({ login: false }); }
  static #onEdit(event, target) { this.#editing = this.#editing === target.dataset.session ? null : target.dataset.session; this.render(); }
  static #onCancelEdit() { this.#editing = null; this.render(); }
  static async #onContinue(event, target) { await continueSession(target.dataset.session); }

  static async #onSaveSession(event, target) {
    const form = this.element.querySelector(`.hwhr-edit[data-session="${CSS.escape(target.dataset.session)}"]`);
    if (!form) return;
    const value = name => form.querySelector(`[name=${name}]`)?.value ?? "";
    const start = fromInputs(value("date"), value("start"));
    let end = form.querySelector("[name=end]") ? fromInputs(value("date"), value("end")) : null;
    if (end !== null && start !== null && end < start) end += 86400000;
    if (start === null) { ui.notifications.warn(tr("BadTime")); return; }
    this.#editing = null;
    await updateSession(target.dataset.session, { name: value("name"), no: Number(value("no")), start, ...(end !== null ? { end } : {}) });
  }

  static async #onEndSession() {
    const ok = await foundry.applications.api.DialogV2.confirm({ classes: ["hardwipe-dialog", "is-danger"], window: { title: tr("EndSession") }, content: `<p>${e(tr("EndSessionAsk"))}</p>` });
    if (ok) await endSession();
  }

  static async #onImport() {
    const count = await importChatLog();
    ui.notifications.info(count ? tr("Imported", { n: count }) : tr("ImportedNone"));
  }

  static #onExport() {
    const data = { module: MODULE_ID, exported: new Date().toISOString(), sessions: allSessions().map(({ live, ...session }) => session), unfiled: readCurrent().unfiled };
    foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", `roll-tracker-${game.world.id}.json`);
  }

  static async #onDelete(event, target) {
    const session = allSessions().find(entry => entry.id === target.dataset.session);
    if (!session) return;
    const ok = await foundry.applications.api.DialogV2.confirm({ classes: ["hardwipe-dialog", "is-danger"], window: { title: tr("Delete") }, content: `<p>${e(tr("DeleteAsk", { name: sessionName(session) }))}</p>` });
    if (!ok) return;
    if (this.#scope === session.id) this.#scope = null;
    await deleteSession(session.id);
  }
}

/* The GM's session dialog ("Jack in") ------------------------------------------------------------------ */

export class SessionDialog extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["hardwipe-tracker", "hwhr-dialog"],
    window: { title: "HARDWIPE.Tracker.JackIn", icon: "fas fa-plug" },
    position: { width: 580 },
    form: { handler: SessionDialog.#submit, closeOnSubmit: true },
    actions: { later: SessionDialog.#later }
  };

  #bound = false;

  async _renderHTML() {
    const sessions = allSessions();
    const latest = sessions[0] ?? null;
    const no = nextNumber();
    const now = Date.now();
    let intro;
    if (!latest) intro = e(tr("JackInFirst"));
    else {
      const records = Object.values(latest.records ?? {});
      const ago = Math.max(0, Math.floor((now - (latest.live ? lastActivity() : latest.end ?? latest.last ?? latest.start)) / 86400000));
      intro = tr(latest.live ? "JackInLive" : "JackInEnded", {
        name: `<b>${e(sessionName(latest))}</b>`, ago: e(ago === 0 ? tr("Today") : tr("DaysAgo", { n: ago })),
        rolls: plural("V.Rolls", records.filter(isRoll).length), spells: plural("V.Spells", records.filter(isSpell).length)
      });
    }
    return `<div class="hwhr hwhr-jack">
      <p class="hwhr-jack-intro">${intro}</p>
      <label class="hwhr-opt"><input type="radio" name="choice" value="new" checked><span class="hwhr-radio"></span><span><b>${e(tr("JackNew"))}</b><small>${e(tr("JackNewHint", { n: no }))}</small></span></label>
      <div class="hwhr-jack-fields">
        <label class="is-wide"><span>${e(tr("F.Name"))}</span><input type="text" name="name" placeholder="${e(tr("SessionN", { n: no }))}" maxlength="80" autofocus></label>
        <label><span>${e(tr("F.Date"))}</span><input type="date" name="date" value="${dateInput(now)}"></label>
        <label><span>${e(tr("F.Starts"))}</span><input type="time" name="start" value="${timeInput(now)}"></label>
        <label><span>${e(tr("F.Number"))}</span><input type="number" name="no" value="${no}" min="1" step="1"></label>
      </div>
      ${latest ? `<label class="hwhr-opt"><input type="radio" name="choice" value="continue"><span class="hwhr-radio"></span><span><b>${e(tr("JackContinue", { name: sessionName(latest) }))}</b><small>${e(tr("JackContinueHint", { n: latest.no }))}</small></span></label>` : ""}
      <input type="hidden" name="latest" value="${e(latest?.id ?? "")}">
      <footer class="hwhr-jack-foot"><button type="button" class="hwhr-btn" data-action="later">${e(tr("Later"))}</button>
        <button type="submit" class="hwhr-btn is-cy"><i class="fas fa-check" inert></i>${e(tr("JackGo"))}</button></footer></div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    // One listener for the dialog's life; it reads the current render's fields each time.
    const sync = () => {
      const choice = content.querySelector("input[name=choice]:checked")?.value;
      const fields = content.querySelector(".hwhr-jack-fields");
      fields?.classList.toggle("is-off", choice !== "new");
      for (const input of fields?.querySelectorAll("input") ?? []) input.disabled = choice !== "new";
      for (const option of content.querySelectorAll(".hwhr-opt")) option.classList.toggle("is-on", option.querySelector("input").checked);
    };
    if (!this.#bound) { this.element.addEventListener("change", sync); this.#bound = true; }
    sync();
  }

  static async #submit(event, form, formData) {
    const data = formData.object;
    if (data.choice === "continue" && data.latest) return continueSession(data.latest);
    const start = fromInputs(data.date, data.start) ?? Date.now();
    await startSession({ name: data.name ?? "", no: Number(data.no) || nextNumber(), start });
  }

  static #later() { this.close(); }
}

/* The Screamsheet recap ---------------------------------------------------------------------------------- */

function hashOf(text) { let h = 0; for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }

/** Headline and dek the recap starts with, written from the session's awards. */
export function recapCopy(view) {
  const list = awardList(view);
  const by = id => list.find(award => award.id === id);
  const who = award => award ? award.entities.map(key => view.label(key)).join(" & ") : "";
  const s = view.stats("all");
  const where = view.session ? sessionName(view.session) : tr("Campaign");
  const lead = by("golden") ?? by("crits") ?? by("heavy");
  const fumbles = by("fumbles");
  const pickFrom = keys => keys[hashOf(`${view.session?.id ?? view.scope}`) % keys.length];
  let headline;
  if (fumbles && fumbles.value >= 5) headline = tr(pickFrom(["Head.Fumble1", "Head.Fumble2"]), { name: who(fumbles), where });
  else if (lead) headline = tr(pickFrom(["Head.Hot1", "Head.Hot2", "Head.Hot3"]), { name: who(lead), where });
  else headline = tr("Head.Plain", { where });
  const dek = tr("Dek", { rolls: plural("V.Rolls", s.rolls), spells: plural("V.Spells", s.cast.n), t: plural("V.N20", s.d20.nat20), o: plural("V.N1", s.d20.nat1) });
  return { headline, dek };
}

/** The Screamsheet itself: newsprint HTML for the chat card and the dialog's preview. */
export function screamsheet(view, { headline, dek } = {}) {
  const s = view.stats("all");
  const list = awardList(view);
  const by = id => list.find(award => award.id === id);
  const who = award => award ? award.entities.map(key => view.label(key)).join(" & ") : "";
  const session = view.session;
  const moments = view.records.filter(record => nat(record) && view.notes[record.k]);
  const lead = moments.filter(record => record.n === 20).at(-1) ?? moments.at(-1) ?? null;
  const others = moments.filter(record => record !== lead).slice(-2).reverse();
  const speaker = record => record.a ? actorName(record.a, view.named) : userName(record.u, view.named);
  const story = [];
  const golden = by("golden");
  if (golden) story.push(tr("Story.Golden", { name: who(golden), avg: avg(golden.value), t: plural("V.N20", view.stats(golden.entities[0]).d20.nat20) }));
  const fumbles = by("fumbles");
  if (fumbles && fumbles.value >= 2) story.push(tr("Story.Fumbles", { name: who(fumbles), n: plural("V.N1", fumbles.value) }));
  if (s.atk.n) story.push(tr("Story.Combat", { n: num(s.atk.n), pct: pct(s.atk.rate), dmg: num(s.dmg.total) }));
  const biggest = by("biggest");
  if (biggest) story.push(tr("Story.Biggest", { name: who(biggest), n: num(biggest.value), item: biggest.detail || tr("Story.Something") }));
  const spells = by("spells");
  if (spells) story.push(tr("Story.Spells", { n: plural("V.Spells", s.cast.n), name: who(spells), m: spells.value }));
  if (!story.length) story.push(tr("Story.Quiet", { n: num(s.rolls) }));
  const ads = [];
  if (fumbles) ads.push(tr("Ad.Lost", { name: who(fumbles) }));
  if (golden) ads.push(tr("Ad.Wanted", { name: who(golden) }));
  if (by("medic")) ads.push(tr("Ad.Medic", { name: who(by("medic")) }));
  if (by("quick")) ads.push(tr("Ad.Quick", { name: who(by("quick")) }));
  const ad = ads.length ? ads[hashOf(session?.id ?? view.scope ?? "") % ads.length] : tr("Ad.Default");
  const awardItems = list.slice(0, 4).map(award => `<li><b><i class="fas ${AWARD_ICONS[award.id] ?? "fa-medal"}" inert></i>${e(tr(`Award.${award.id}`))}</b><span>${e(who(award))}</span><em>${e(awardValue(award))}</em>${award.runner ? `<small>${e(tr("RunnerUpShort", { name: award.runner.entities.map(key => view.label(key)).join(" & ") }))}</small>` : ""}</li>`).join("");
  const numbers = [["Rolls", num(s.rolls)], ["SpellsCast", num(s.cast.n)], ["D20Avg", avg(s.d20.avg)], ["Nat20s", s.d20.nat20], ["Nat1s", s.d20.nat1], ["Damage", num(s.dmg.total)]];
  return `<div class="hwss">
    <div class="hwss-top"><span>${e(session ? dateText(session.start) : tr("Campaign"))}</span><span>${e(tr("Issue", { n: session?.no ?? "—" }))}</span><span>${e(tr("Price"))}</span></div>
    <div class="hwss-mast">${e(tr("MastA"))}<b>${e(tr("MastB"))}</b></div>
    <div class="hwss-tag">${e(tr("Tagline"))}</div>
    <h2 class="hwss-head">${e(headline)}</h2>
    ${dek ? `<p class="hwss-dek">${e(dek)}</p>` : ""}
    ${lead ? `<figure class="hwss-photo hwss-n${lead.n}"><span>${lead.n}</span><figcaption><q>${e(view.notes[lead.k])}</q><cite>${e(speaker(lead))} · ${e(describeRecord(lead).title)}</cite></figcaption></figure>` : ""}
    <dl class="hwss-nums">${numbers.map(([key, value]) => `<div><dd>${value}</dd><dt>${e(tr(`M.${key}`))}</dt></div>`).join("")}</dl>
    <h4 class="hwss-sect">${e(tr("S.Dice"))}</h4><p class="hwss-story">${story.map(line => e(line)).join(" ")}</p>
    ${others.length ? `<h4 class="hwss-sect">${e(tr("S.Heard"))}</h4><ul class="hwss-quotes">${others.map(record => `<li class="hwss-n${record.n}"><q>${e(view.notes[record.k])}</q><cite>${e(speaker(record))}, ${e(tr(record.n === 20 ? "Nat20" : "Nat1"))}</cite></li>`).join("")}</ul>` : ""}
    ${awardItems ? `<h4 class="hwss-sect">${e(tr("S.Awards"))}</h4><ul class="hwss-awards">${awardItems}</ul>` : ""}
    <div class="hwss-ad"><b>${e(tr("S.Classifieds"))}</b> ${e(ad)}</div>
  </div>`;
}

export class RecapDialog extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["hardwipe-tracker", "hwhr-dialog", "hwhr-recap-dialog"],
    window: { title: "HARDWIPE.Tracker.RecapTitle", icon: "fas fa-newspaper", resizable: true },
    position: { width: 780, height: 740 },
    form: { handler: RecapDialog.#submit, closeOnSubmit: true }
  };

  #copy = null;
  #view = null;
  #bound = false;

  async _renderHTML() {
    const view = this.#view = buildView(this.options.scope ?? null);
    this.#copy ??= recapCopy(view);
    return `<div class="hwhr hwhr-recap">
      <div class="hwhr-recap-form">
        <h3 class="hwhr-rb"><span>${e(tr("RecapEdit"))}</span></h3>
        <label><span>${e(tr("F.Headline"))}</span><input type="text" name="headline" value="${e(this.#copy.headline)}" maxlength="90"></label>
        <label><span>${e(tr("F.Dek"))}</span><textarea name="dek" rows="3" maxlength="200">${e(this.#copy.dek)}</textarea></label>
        <p class="hwhr-hint-line">${e(tr("RecapHint"))}</p>
        <footer class="hwhr-jack-foot"><button type="submit" class="hwhr-btn is-cy"><i class="fas fa-newspaper" inert></i>${e(tr("PostRecap"))}</button></footer>
      </div>
      <div class="hwhr-recap-preview">${screamsheet(view, this.#copy)}</div></div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    if (this.#bound) return;
    this.#bound = true;
    this.element.addEventListener("input", event => {
      if (!event.target.matches("[name=headline], [name=dek]")) return;
      this.#copy = { headline: this.element.querySelector("[name=headline]").value, dek: this.element.querySelector("[name=dek]").value };
      const preview = this.element.querySelector(".hwhr-recap-preview");
      if (preview) preview.innerHTML = screamsheet(this.#view ??= buildView(this.options.scope ?? null), this.#copy);
    });
  }

  static async #submit(event, form, formData) {
    const view = buildView(this.options.scope ?? null);
    const copy = { headline: String(formData.object.headline ?? "").trim() || recapCopy(view).headline, dek: String(formData.object.dek ?? "").trim() };
    await ChatMessage.implementation.create({
      content: screamsheet(view, copy), speaker: { alias: tr("ScreamsheetAlias") },
      flags: { [MODULE_ID]: { type: "rollRecap", session: view.session?.id ?? view.scope ?? null } }
    });
  }
}
