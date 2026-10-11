import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { D20_KINDS, awards, summarize } from "./hardwipe-roll-data.js";
import {
  actorName, allSessions, canView, deleteSession, describeRecord, endSession, importChatLog, renameSession, sessionName, setNote, tr, userName
} from "./hardwipe-roll-tracker.js";

/**
 * The Roll Tracker window (Game Settings > Hardwipe Ruleset > Roll Tracker). One session or the whole
 * campaign, seen as: an overview with a leaderboard and awards; one player (or character) in detail;
 * two side by side; the dice themselves; the natural 1s and 20s with the GM's notes; and, for the GM,
 * the sessions. It redraws as rolls come in, unless someone is typing in it.
 */
const TABS = [
  ["overview", "fa-gauge-high"], ["players", "fa-user"], ["compare", "fa-scale-balanced"],
  ["dice", "fa-dice"], ["moments", "fa-star"], ["sessions", "fa-calendar-days"]
];
const AWARD_ICONS = {
  golden: "fa-crown", cursed: "fa-skull-crossbones", crits: "fa-star", fumbles: "fa-heart-crack", heavy: "fa-hammer",
  biggest: "fa-burst", sharpshooter: "fa-crosshairs", spells: "fa-wand-sparkles", will: "fa-shield-heart", medic: "fa-kit-medical",
  quick: "fa-bolt", hot: "fa-fire"
};
const KIND_GROUPS = [["atk", ["atk"]], ["dmg", ["dmg"]], ["heal", ["heal"]], ["save", ["save", "conc", "death"]], ["check", ["check", "skill", "tool"]], ["init", ["init"]], ["other", ["d20", "hd", "roll"]]];
const DICE = [4, 6, 8, 10, 12, 20, 100];
const FALLBACK_COLORS = ["#46e6dc", "#ffc24d", "#b48cff", "#ff8a5c", "#8fcfb0", "#ff6fa8", "#7fb2ff"];

const e = escapeHTML;
const num = value => Number(value ?? 0).toLocaleString(game.i18n.lang);
const avg = value => Number.isFinite(value) ? value.toFixed(1) : "—";
const pct = value => Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
const signed = value => Number.isFinite(value) ? `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}` : "—";

function when(t, style = "medium") {
  if (!t) return "";
  try { return new Date(t).toLocaleString(game.i18n.lang, style === "date" ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" }); }
  catch { return new Date(t).toISOString(); }
}

function clock(t) {
  try { return new Date(t).toLocaleTimeString(game.i18n.lang, { timeStyle: "short" }); } catch { return ""; }
}

function duration(from, to) {
  const minutes = Math.max(0, Math.round(((to ?? 0) - (from ?? 0)) / 60000));
  return minutes >= 60 ? tr("DurationHM", { h: Math.floor(minutes / 60), m: minutes % 60 }) : tr("DurationM", { m: minutes });
}

/** Luck in words from the z-score of the d20 average. */
function luckWord(stats) {
  if (stats.d20.n < 10) return tr("Luck.Few");
  const z = stats.d20.luck;
  return tr(z >= 2 ? "Luck.Blessed" : z >= 1 ? "Luck.Lucky" : z > -1 ? "Luck.Even" : z > -2 ? "Luck.Unlucky" : "Luck.Cursed");
}

export class RollTrackerApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["hardwipe-tracker"],
    window: { title: "HARDWIPE.Tracker.Title", icon: "fas fa-dice-d20", resizable: true },
    position: { width: 1040, height: 780 },
    actions: {
      view: RollTrackerApp.#onView,
      entity: RollTrackerApp.#onEntity,
      filter: RollTrackerApp.#onFilter,
      scopeTo: RollTrackerApp.#onScopeTo,
      endSession: RollTrackerApp.#onEndSession,
      importLog: RollTrackerApp.#onImport,
      exportData: RollTrackerApp.#onExport,
      deleteSession: RollTrackerApp.#onDelete,
      recap: RollTrackerApp.#onRecap
    }
  };

  #tab = "overview";
  #scope = null;
  #entity = null;
  #compare = [null, null];
  #filter = "all";
  #stale = false;

  constructor(options = {}) {
    super(options);
    if (TABS.some(([id]) => id === options.tab)) this.#tab = options.tab;
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

  /* Data ------------------------------------------------------------------------------------------- */

  #view() {
    const sessions = allSessions();
    const isGM = game.user.isGM;
    let chosen;
    if (this.#scope === "all") chosen = sessions;
    else {
      const session = sessions.find(entry => entry.id === this.#scope) ?? sessions[0];
      chosen = session ? [session] : [];
    }
    // Players don't see rolls made in private by someone else.
    const visible = record => isGM || !record.p || record.u === game.user.id || record.b === game.user.id;
    const records = chosen.flatMap(session => Object.values(session.records ?? {})).filter(visible);
    const notes = Object.assign({}, ...chosen.map(session => session.notes ?? {}));
    const isGMUser = id => game.users.get(id)?.isGM ?? sessions.some(session => session.users?.[id]?.g);
    const colorOf = (id, index) => {
      const user = game.users.get(id);
      const stored = sessions.find(session => session.users?.[id]?.c)?.users[id].c;
      return user?.color?.css ?? stored ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
    };
    const byUser = new Map(), byActor = new Map();
    for (const record of records) {
      if (record.u) (byUser.get(record.u) ?? byUser.set(record.u, []).get(record.u)).push(record);
      if (record.a) (byActor.get(record.a) ?? byActor.set(record.a, []).get(record.a)).push(record);
    }
    const users = [...byUser.keys()].map(id => ({ id, gm: isGMUser(id), name: userName(id, sessions) }))
      .sort((a, b) => a.gm - b.gm || a.name.localeCompare(b.name))
      .map((user, index) => {
        const own = byUser.get(user.id);
        const actors = [...new Set(own.map(record => record.a).filter(Boolean))]
          .sort((a, b) => own.filter(r => r.a === b).length - own.filter(r => r.a === a).length);
        return { ...user, key: `u:${user.id}`, color: colorOf(user.id, index), records: own, actors };
      });
    const cache = new Map();
    const stats = key => {
      if (cache.has(key)) return cache.get(key);
      let list = [];
      if (key === "all") list = records;
      else if (key === "party") list = records.filter(record => !isGMUser(record.u));
      else if (key.startsWith("u:")) list = byUser.get(key.slice(2)) ?? [];
      else if (key.startsWith("a:")) list = byActor.get(key.slice(2)) ?? [];
      const result = summarize(list);
      cache.set(key, result);
      return result;
    };
    const players = users.filter(user => !user.gm);
    const entities = [
      ...(players.length > 1 ? [{ key: "party", name: tr("Party"), color: "var(--hw-phos)", party: true }] : []),
      ...users
    ];
    const label = key => {
      if (key === "party") return tr("Party");
      if (key?.startsWith("u:")) return userName(key.slice(2), sessions);
      if (key?.startsWith("a:")) return actorName(key.slice(2), sessions);
      return "";
    };
    const colorFor = key => {
      if (key?.startsWith("u:")) return users.find(user => user.key === key)?.color ?? "var(--hw-phos)";
      if (key?.startsWith("a:")) return users.find(user => user.actors.includes(key.slice(2)))?.color ?? "var(--hw-phos)";
      return "var(--hw-phos)";
    };
    return { sessions, chosen, records, notes, users, entities, stats, label, colorFor, isGM };
  }

  /* Render ----------------------------------------------------------------------------------------- */

  async _renderHTML() {
    if (!canView()) return `<div class="hwrt"><div class="hwrt-empty is-locked"><i class="fas fa-lock" inert></i><p>${e(tr("Locked"))}</p></div></div>`;
    const view = this.#view();
    if (this.#tab === "sessions" && !view.isGM) this.#tab = "overview";
    const tabs = TABS.filter(([id]) => id !== "sessions" || view.isGM).map(([id, icon]) => `<button type="button" class="hwrt-tab${id === this.#tab ? " is-active" : ""}" data-action="view" data-view="${id}" aria-pressed="${id === this.#tab}">
      <i class="fas ${icon}" inert></i><span>${e(tr(`Tab.${id}`))}</span></button>`).join("");
    let body;
    if (!view.sessions.length && this.#tab !== "sessions") body = this.#empty(tr("NoSessions"), view.isGM ? tr("NoSessionsGM") : "");
    else body = {
      overview: () => this.#overview(view), players: () => this.#players(view), compare: () => this.#comparison(view),
      dice: () => this.#dice(view), moments: () => this.#moments(view), sessions: () => this.#sessionsTab(view)
    }[this.#tab]();
    return `<div class="hwrt" data-tab="${this.#tab}">${this.#head(view)}<nav class="hwrt-tabs">${tabs}</nav><div class="hwrt-body">${body}</div></div>`;
  }

  _replaceHTML(result, content) {
    const before = content.querySelector(".hwrt");
    const scroll = before?.dataset.tab === this.#tab ? content.querySelector(".hwrt-body")?.scrollTop ?? 0 : 0;
    content.innerHTML = result;
    const body = content.querySelector(".hwrt-body");
    if (body) body.scrollTop = scroll;
    content.querySelector("select[name=scope]")?.addEventListener("change", event => { this.#scope = event.target.value || null; this.render(); });
    for (const select of content.querySelectorAll("select[name^=compare]")) {
      select.addEventListener("change", event => { this.#compare[Number(event.target.dataset.side)] = event.target.value; this.render(); });
    }
    for (const input of content.querySelectorAll("input[data-note]")) {
      input.addEventListener("change", async () => {
        const row = input.closest(".hwrt-moment");
        row?.classList.add("is-saving");
        try { await setNote(input.dataset.note, input.value); row?.classList.add("is-saved"); }
        catch (error) { console.error(error); ui.notifications.error(tr("NoteFailed")); }
        finally { row?.classList.remove("is-saving"); }
      });
      input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); input.blur(); } });
    }
    for (const input of content.querySelectorAll("input[data-rename]")) {
      input.addEventListener("change", () => renameSession(input.dataset.rename, input.value));
      input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); input.blur(); } });
    }
  }

  #empty(title, hint = "") {
    return `<div class="hwrt-empty"><i class="fas fa-dice-d20" inert></i><p>${e(title)}</p>${hint ? `<small>${e(hint)}</small>` : ""}</div>`;
  }

  #head(view) {
    const current = view.sessions.find(entry => entry.id === this.#scope) ?? view.sessions[0];
    const all = this.#scope === "all";
    const options = view.sessions.map(session => `<option value="${e(session.id)}"${!all && session.id === current?.id ? " selected" : ""}>${e(sessionName(session))} · ${e(when(session.start, "date"))}${session.live ? ` · ${e(tr("Live"))}` : ""}</option>`).join("");
    let sub = "";
    if (all && view.sessions.length) sub = tr("CampaignSpan", { n: view.sessions.length, from: when(view.sessions.at(-1).start, "date"), to: when(view.sessions[0].last, "date") });
    else if (current) sub = `${when(current.start)} · ${duration(current.start, current.last)}`;
    const live = !all && current?.live;
    return `<header class="hwrt-head">
      <div class="hwrt-brand"><span class="hwrt-logo"><i class="fas fa-dice-d20" inert></i></span>
        <div><b>${e(tr("Title"))}</b><span>${live ? `<i class="hwrt-live" aria-hidden="true"></i>${e(tr("Recording"))} · ` : ""}${e(all ? tr("Campaign") : sessionName(current))}${sub ? ` · ${e(sub)}` : ""}</span></div></div>
      ${view.sessions.length ? `<label class="hwrt-scope"><span>${e(tr("Show"))}</span><select name="scope">${options}<option value="all"${all ? " selected" : ""}>${e(tr("Campaign"))}</option></select></label>` : ""}
    </header>`;
  }

  /* Overview --------------------------------------------------------------------------------------- */

  #overview(view) {
    if (!view.records.length) return this.#empty(tr("NoRolls"));
    const s = view.stats("all");
    const kpi = (label, value, sub, tone = "") => `<div class="hwrt-kpi${tone ? ` is-${tone}` : ""}"><span>${e(label)}</span><b>${value}</b><small>${sub}</small></div>`;
    const kpis = [
      kpi(tr("K.Rolls"), num(s.rolls), e(tr("K.Dice", { n: num(s.diceTotal) }))),
      kpi(tr("K.Avg"), avg(s.d20.avg), e(tr("K.Luck", { n: signed(s.d20.avg - 10.5) }))),
      kpi(tr("K.Nat20"), num(s.d20.nat20), e(tr("K.OfD20", { pct: pct(s.d20.n ? s.d20.nat20 / s.d20.n : null) })), "crit"),
      kpi(tr("K.Nat1"), num(s.d20.nat1), e(tr("K.OfD20", { pct: pct(s.d20.n ? s.d20.nat1 / s.d20.n : null) })), "fumble"),
      kpi(tr("K.Attacks"), num(s.atk.n), e(tr("K.HitRate", { pct: pct(s.atk.rate), crits: s.atk.crit }))),
      kpi(tr("K.Damage"), num(s.dmg.total), e(tr("K.Biggest", { n: num(s.dmg.max) }))),
      kpi(tr("K.Spells"), num(s.cast.n), e(tr("K.Slots", { n: num(s.cast.leveled) }))),
      kpi(tr("K.Saves"), num(s.save.n), e(tr("K.Made", { pct: pct(s.save.rate) })))
    ].join("");

    const rows = view.users.map(user => {
      const st = view.stats(user.key);
      const marker = Number.isFinite(st.d20.avg) ? Math.min(100, Math.max(0, (st.d20.avg - 5.5) * 10)) : null;
      const chars = user.actors.slice(0, 3).map(id => actorName(id, view.sessions)).join(", ");
      return `<tr data-action="entity" data-entity="${e(user.key)}" style="--who: ${e(user.color)}" tabindex="0">
        <th scope="row"><span class="hwrt-rowhead"><span class="hwrt-dot"></span><span class="hwrt-who"><b>${e(user.name)}${user.gm ? ` <em>${e(tr("GM"))}</em>` : ""}</b><small>${e(chars)}</small></span></span></th>
        <td>${num(st.rolls)}</td>
        <td><span class="hwrt-luckcell"><span class="hwrt-luckbar" title="${e(luckWord(st))}">${marker === null ? "" : `<i style="left: ${marker}%"></i>`}</span><b>${avg(st.d20.avg)}</b></span></td>
        <td class="is-crit">${num(st.d20.nat20)}</td><td class="is-fumble">${num(st.d20.nat1)}</td>
        <td>${pct(st.atk.rate)}</td><td>${num(st.dmg.total)}</td><td>${num(st.cast.n)}</td><td>${pct(st.save.rate)}</td>
      </tr>`;
    }).join("");
    const head = ["Player", "Rolls", "Avg", "Nat20", "Nat1", "Hit", "Damage", "Spells", "Saves"].map(key => `<th scope="col">${e(tr(`Col.${key}`))}</th>`).join("");

    const list = view.users.filter(user => !user.party).map(user => ({ id: user.key, stats: view.stats(user.key) }));
    const awardCards = awards(list).map(award => this.#award(award, view)).join("");
    const moments = this.#momentList(view, view.records.filter(record => (record.n === 20 || record.n === 1) && D20_KINDS.has(record.c) && view.notes[record.k]).slice(-4).reverse(), { compact: true });
    return `<div class="hwrt-kpis">${kpis}</div>
      <section class="hwrt-panel"><h3>${e(tr("Leaderboard"))}</h3><div class="hwrt-tablewrap"><table class="hwrt-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></section>
      ${awardCards ? `<section class="hwrt-panel"><h3>${e(tr("Awards"))}${view.isGM ? `<button type="button" class="hwrt-mini" data-action="recap"><i class="fas fa-bullhorn" inert></i>${e(tr("PostRecap"))}</button>` : ""}</h3><div class="hwrt-awards">${awardCards}</div></section>` : ""}
      ${moments ? `<section class="hwrt-panel"><h3>${e(tr("LatestMoments"))}</h3>${moments}</section>` : ""}`;
  }

  #awardValue(award) {
    const v = award.value;
    switch (award.id) {
      case "golden": case "cursed": case "quick": return avg(v);
      case "sharpshooter": case "will": return pct(v);
      case "hot": return tr("InARow", { n: v });
      default: return num(v);
    }
  }

  #award(award, view) {
    const names = award.entities.map(key => view.label(key)).join(" & ");
    const color = view.colorFor(award.entities[0]);
    return `<article class="hwrt-award is-${e(award.id)}" style="--who: ${e(color)}">
      <i class="fas ${AWARD_ICONS[award.id] ?? "fa-medal"}" inert></i>
      <div><span>${e(tr(`Award.${award.id}`))}</span><b>${e(names)}</b><small>${e(this.#awardValue(award))}${award.detail ? ` · ${e(award.detail)}` : ""} — ${e(tr(`Award.${award.id}Hint`))}</small></div>
    </article>`;
  }

  /* One player or character ------------------------------------------------------------------------- */

  #players(view) {
    if (!view.records.length) return this.#empty(tr("NoRolls"));
    const keys = new Set([...view.entities.map(entity => entity.key), ...view.users.flatMap(user => user.actors.map(id => `a:${id}`))]);
    if (!keys.has(this.#entity)) this.#entity = view.users.find(user => !user.gm)?.key ?? view.users[0]?.key;
    const rail = view.entities.map(entity => {
      const st = view.stats(entity.key);
      const head = `<button type="button" class="hwrt-ent${entity.key === this.#entity ? " is-active" : ""}${entity.party ? " is-party" : ""}" data-action="entity" data-entity="${e(entity.key)}" style="--who: ${e(entity.color)}">
        <span class="hwrt-dot"></span><span><b>${e(entity.name)}${entity.gm ? ` <em>${e(tr("GM"))}</em>` : ""}</b><small>${e(tr("NRolls", { n: num(st.rolls) }))}</small></span></button>`;
      const subs = (entity.actors ?? []).map(id => `<button type="button" class="hwrt-ent is-actor${`a:${id}` === this.#entity ? " is-active" : ""}" data-action="entity" data-entity="a:${e(id)}" style="--who: ${e(entity.color)}">
        <span>${e(actorName(id, view.sessions))}</span></button>`).join("");
      return head + subs;
    }).join("");
    return `<div class="hwrt-split"><aside class="hwrt-rail">${rail}</aside><div class="hwrt-detail">${this.#profile(view, this.#entity)}</div></div>`;
  }

  #profile(view, key) {
    const s = view.stats(key);
    const color = view.colorFor(key);
    const sub = key.startsWith("u:") ? (view.users.find(user => user.key === key)?.actors ?? []).map(id => actorName(id, view.sessions)).join(", ")
      : key.startsWith("a:") ? tr("Character") : tr("PartyHint");
    const tile = (label, value, small = "", tone = "") => `<div class="hwrt-kpi${tone ? ` is-${tone}` : ""}"><span>${e(label)}</span><b>${value}</b><small>${small}</small></div>`;
    const tiles = [
      tile(tr("K.Rolls"), num(s.rolls), e(tr("K.Dice", { n: num(s.diceTotal) }))),
      tile(tr("K.Avg"), avg(s.d20.avg), e(tr("K.D20s", { n: num(s.d20.n) }))),
      tile(tr("K.LuckIndex"), e(luckWord(s)), e(s.d20.n ? tr("K.Luck", { n: signed(s.d20.avg - 10.5) }) : "")),
      tile(tr("K.Nat20"), num(s.d20.nat20), "", "crit"),
      tile(tr("K.Nat1"), num(s.d20.nat1), "", "fumble"),
      tile(tr("K.Streak"), num(s.d20.hot), e(tr("K.Cold", { n: s.d20.cold })))
    ].join("");

    const groups = KIND_GROUPS.map(([id, kinds]) => ({ label: tr(`Kind.${id}`), value: view.records.length ? this.#countKinds(view, key, kinds) : 0 }));
    const atk = s.atk;
    const unknown = Math.max(0, atk.n - atk.hit - atk.miss);
    const stack = atk.n ? `<div class="hwrt-stack" role="img" aria-label="${e(tr("AttackSplit", { hit: atk.hit, miss: atk.miss }))}">
        <i class="is-hit" style="flex: ${atk.hit}"></i><i class="is-miss" style="flex: ${atk.miss}"></i><i class="is-unknown" style="flex: ${unknown}"></i></div>
      <div class="hwrt-legend"><span class="is-hit">${e(tr("Hits", { n: atk.hit }))}</span><span class="is-miss">${e(tr("Misses", { n: atk.miss }))}</span>${unknown ? `<span class="is-unknown">${e(tr("NoTarget", { n: unknown }))}</span>` : ""}<span class="is-crit">${e(tr("Crits", { n: atk.crit }))}</span></div>` : "";
    const damageTypes = Object.entries(s.dmg.byType).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([type, value]) => ({ label: this.#damageLabel(type), value, color: `var(--hw-c-dmg-${type}, var(--hw-warn))` }));
    const levels = s.cast.byLevel.map((value, level) => ({ label: level ? tr("LevelN", { n: level }) : tr("Cantrip"), value })).filter(entry => entry.value);
    const topSpells = Object.entries(s.cast.bySpell).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, value]) => ({ label: name, value }));
    const abilities = Object.entries(CONFIG.DND5E?.abilities ?? {}).map(([id, config]) => {
      const entry = s.save.byAbility[id];
      return `<div class="hwrt-ab${entry ? "" : " is-none"}" style="--fill: ${entry ? Math.round(entry.made / entry.n * 100) : 0}%"><b>${e(String(config.abbreviation ?? id).toUpperCase())}</b><span>${entry ? `${entry.made}/${entry.n}` : "—"}</span></div>`;
    }).join("");
    const skills = Object.entries(s.check.bySkill).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, value]) => {
      const [kind, skill] = id.split(":");
      const label = kind === "skill" ? game.i18n.localize(CONFIG.DND5E?.skills?.[skill]?.label ?? skill) : describeRecord({ c: "tool", s: skill }).title;
      return { label, value };
    });

    return `<header class="hwrt-profile" style="--who: ${e(color)}"><span class="hwrt-dot"></span><div><h2>${e(view.label(key))}</h2><small>${e(sub)}</small></div></header>
      <div class="hwrt-kpis is-six">${tiles}</div>
      <div class="hwrt-grid">
        <section class="hwrt-panel"><h3>${e(tr("Faces"))}<small>${e(tr("FacesHint"))}</small></h3>${s.d20.n ? histogram(s.d20.hist, color) : this.#none()}</section>
        <section class="hwrt-panel"><h3>${e(tr("RollTypes"))}</h3>${bars(groups)}</section>
        <section class="hwrt-panel"><h3>${e(tr("Combat"))}</h3>
          ${stack || this.#none(tr("NoAttacks"))}
          <dl class="hwrt-facts">
            <div><dt>${e(tr("DamageDealt"))}</dt><dd>${num(s.dmg.total)}</dd></div>
            <div><dt>${e(tr("BiggestHit"))}</dt><dd>${num(s.dmg.max)}${s.dmg.maxItem ? ` <small>${e(s.dmg.maxItem)}</small>` : ""}</dd></div>
            <div><dt>${e(tr("PerDamageRoll"))}</dt><dd>${avg(s.dmg.n ? s.dmg.total / s.dmg.n : null)}</dd></div>
            <div><dt>${e(tr("HealingDone"))}</dt><dd>${num(s.heal.total)}</dd></div>
          </dl>
          ${damageTypes.length ? bars(damageTypes) : ""}
        </section>
        <section class="hwrt-panel"><h3>${e(tr("Magic"))}</h3>
          <dl class="hwrt-facts"><div><dt>${e(tr("SpellsCast"))}</dt><dd>${num(s.cast.n)}</dd></div><div><dt>${e(tr("SlotsSpent"))}</dt><dd>${num(s.cast.leveled)}</dd></div><div><dt>${e(tr("ItemsUsed"))}</dt><dd>${num(s.use.n - s.cast.n)}</dd></div></dl>
          ${levels.length ? bars(levels, { color: "var(--hw-c-ability-int, #b48cff)" }) : this.#none(tr("NoSpells"))}
          ${topSpells.length ? `<h4>${e(tr("TopSpells"))}</h4>${bars(topSpells, { color: "var(--hw-cyan)" })}` : ""}
        </section>
        <section class="hwrt-panel"><h3>${e(tr("SavesChecks"))}</h3>
          <dl class="hwrt-facts">
            <div><dt>${e(tr("SavesMade"))}</dt><dd>${s.save.made}/${s.save.known} <small>${pct(s.save.rate)}</small></dd></div>
            <div><dt>${e(tr("ChecksPassed"))}</dt><dd>${s.check.made}/${s.check.known} <small>${pct(s.check.rate)}</small></dd></div>
            <div><dt>${e(tr("Initiative"))}</dt><dd>${avg(s.init.avg)}${Number.isFinite(s.init.best) ? ` <small>${e(tr("Best", { n: s.init.best }))}</small>` : ""}</dd></div>
            <div><dt>${e(tr("DeathSaves"))}</dt><dd>${s.death.made}/${s.death.n}</dd></div>
            <div><dt>${e(tr("Concentration"))}</dt><dd>${s.conc.made}/${s.conc.known}</dd></div>
          </dl>
          <div class="hwrt-abs">${abilities}</div>
          ${skills.length ? `<h4>${e(tr("TopSkills"))}</h4>${bars(skills, { color: "var(--hw-warn)" })}` : ""}
        </section>
        <section class="hwrt-panel"><h3>${e(tr("Hardwipe"))}</h3>
          <dl class="hwrt-facts">
            <div><dt>${e(tr("Downed"))}</dt><dd>${num(s.evt.downed)}</dd></div>
            <div><dt>${e(tr("Flatlined"))}</dt><dd>${num(s.evt.flatlined)}</dd></div>
            <div><dt>${e(tr("EdgeSpent"))}</dt><dd>${num(s.evt.edge)}</dd></div>
            <div><dt>${e(tr("AdvDis"))}</dt><dd>${num(s.d20.adv)} / ${num(s.d20.dis)}</dd></div>
          </dl>
        </section>
        <section class="hwrt-panel is-wide"><h3>${e(tr("Timeline"))}<small>${e(tr("TimelineHint"))}</small></h3>${s.d20.n ? timeline(s.d20.timeline, color) : this.#none()}</section>
      </div>`;
  }

  #countKinds(view, key, kinds) {
    const want = new Set(kinds);
    const matches = record => {
      if (!want.has(record.c)) return false;
      if (key === "all") return true;
      if (key === "party") return !(game.users.get(record.u)?.isGM);
      if (key.startsWith("u:")) return record.u === key.slice(2);
      return record.a === key.slice(2);
    };
    return view.records.filter(matches).length;
  }

  #damageLabel(type) {
    const config = CONFIG.DND5E?.damageTypes?.[type] ?? CONFIG.DND5E?.healingTypes?.[type];
    return config?.label ? game.i18n.localize(config.label) : type === "none" ? tr("Untyped") : type;
  }

  #none(text = tr("Nothing")) { return `<p class="hwrt-none">${e(text)}</p>`; }

  /* Compare ---------------------------------------------------------------------------------------- */

  #comparison(view) {
    if (!view.records.length) return this.#empty(tr("NoRolls"));
    const options = [...view.entities.map(entity => ({ key: entity.key, name: entity.name + (entity.gm ? ` (${tr("GM")})` : "") }))];
    const actors = view.users.flatMap(user => user.actors.map(id => ({ key: `a:${id}`, name: actorName(id, view.sessions) })));
    const valid = new Set([...options, ...actors].map(option => option.key));
    let [a, b] = this.#compare;
    if (!valid.has(a)) a = view.users.find(user => !user.gm)?.key ?? options[0]?.key;
    if (!valid.has(b) || b === a) b = view.users.find(user => user.gm && user.key !== a)?.key ?? options.find(option => option.key !== a && option.key !== "party")?.key ?? a;
    this.#compare = [a, b];
    const select = (side, value) => `<select name="compare${side}" data-side="${side}" aria-label="${e(tr(side ? "CompareB" : "CompareA"))}">
      <optgroup label="${e(tr("Players"))}">${options.map(option => `<option value="${e(option.key)}"${option.key === value ? " selected" : ""}>${e(option.name)}</option>`).join("")}</optgroup>
      ${actors.length ? `<optgroup label="${e(tr("Characters"))}">${actors.map(option => `<option value="${e(option.key)}"${option.key === value ? " selected" : ""}>${e(option.name)}</option>`).join("")}</optgroup>` : ""}
    </select>`;
    const A = view.stats(a), B = view.stats(b);
    const ca = view.colorFor(a), cb = view.colorFor(b) === ca ? "var(--hw-warn)" : view.colorFor(b);
    const metrics = [
      ["Rolls", s => s.rolls, num], ["Avg", s => s.d20.avg, avg], ["Nat20", s => s.d20.nat20, num], ["Nat1", s => s.d20.nat1, num, true],
      ["Attacks", s => s.atk.n, num], ["HitRate", s => s.atk.rate, pct], ["Crits", s => s.atk.crit, num], ["Damage", s => s.dmg.total, num],
      ["Biggest", s => s.dmg.max, num], ["Healing", s => s.heal.total, num], ["Spells", s => s.cast.n, num], ["SaveRate", s => s.save.rate, pct],
      ["CheckRate", s => s.check.rate, pct], ["Init", s => s.init.avg, avg], ["Streak", s => s.d20.hot, num], ["Downed", s => s.evt.downed, num, true]
    ];
    const rows = metrics.map(([id, get, format, lower]) => {
      const va = get(A), vb = get(B);
      const fa = Number.isFinite(va) ? va : 0, fb = Number.isFinite(vb) ? vb : 0;
      const total = fa + fb;
      const share = total ? fa / total * 100 : 50;
      const win = !Number.isFinite(va) || !Number.isFinite(vb) || va === vb ? "" : (va > vb) !== !!lower ? "a" : "b";
      return `<div class="hwrt-vs-row${win ? ` wins-${win}` : ""}"><b class="is-a">${format(va)}</b>
        <div class="hwrt-tug" style="--share: ${share}%"><span>${e(tr(`M.${id}`))}</span></div><b class="is-b">${format(vb)}</b></div>`;
    }).join("");
    return `<div class="hwrt-vs" style="--a: ${e(ca)}; --b: ${e(cb)}">
      <div class="hwrt-vs-head"><div class="is-a">${select(0, a)}</div><span class="hwrt-vs-badge">${e(tr("Versus"))}</span><div class="is-b">${select(1, b)}</div></div>
      <div class="hwrt-vs-rows">${rows}</div>
      <section class="hwrt-panel"><h3>${e(tr("FacesBoth"))}<small>${e(tr("FacesBothHint"))}</small></h3>${A.d20.n || B.d20.n ? pairHistogram(A.d20.hist, B.d20.hist) : this.#none()}</section>
    </div>`;
  }

  /* Dice ------------------------------------------------------------------------------------------- */

  #dice(view) {
    if (!view.records.length) return this.#empty(tr("NoRolls"));
    const cards = view.users.map(user => {
      const s = view.stats(user.key);
      const p = s.d20.fair;
      const verdict = s.d20.rawN < 60 ? ["few", tr("Fair.Few", { n: 60 - s.d20.rawN })] : p < 0.01 ? ["odd", tr("Fair.Suspicious")] : p < 0.05 ? ["warn", tr("Fair.Odd")] : ["ok", tr("Fair.Fine")];
      return `<article class="hwrt-diecard" style="--who: ${e(user.color)}"><header><span class="hwrt-dot"></span><b>${e(user.name)}</b><small>${e(tr("NFaces", { n: num(s.d20.rawN) }))}</small></header>
        ${s.d20.rawN ? histogram(s.d20.raw, user.color, { compact: true }) : this.#none()}
        <footer class="is-${verdict[0]}"><span>${e(verdict[1])}</span>${s.d20.rawN >= 60 && Number.isFinite(p) ? `<small>p = ${p < 0.001 ? "<0.001" : p.toFixed(3)}</small>` : ""}</footer></article>`;
    }).join("");
    const bag = view.users.map(user => {
      const s = view.stats(user.key);
      const other = Object.entries(s.dice).filter(([faces]) => !DICE.includes(Number(faces))).reduce((sum, [, count]) => sum + count, 0);
      return `<tr style="--who: ${e(user.color)}"><th scope="row"><span class="hwrt-rowhead"><span class="hwrt-dot"></span>${e(user.name)}</span></th>${DICE.map(faces => `<td>${s.dice[faces] ? num(s.dice[faces]) : "·"}</td>`).join("")}<td>${other ? num(other) : "·"}</td><td><b>${num(s.diceTotal)}</b></td></tr>`;
    }).join("");
    return `<p class="hwrt-hint">${e(tr("DiceHint"))}</p><div class="hwrt-dice">${cards}</div>
      <section class="hwrt-panel"><h3>${e(tr("DiceBag"))}</h3><div class="hwrt-tablewrap"><table class="hwrt-table is-bag"><thead><tr><th scope="col">${e(tr("Col.Player"))}</th>${DICE.map(faces => `<th scope="col">d${faces}</th>`).join("")}<th scope="col">${e(tr("Other"))}</th><th scope="col">${e(tr("Total"))}</th></tr></thead><tbody>${bag}</tbody></table></div></section>`;
  }

  /* Moments ---------------------------------------------------------------------------------------- */

  #moments(view) {
    const all = view.records.filter(record => (record.n === 20 || record.n === 1) && D20_KINDS.has(record.c));
    const shown = all.filter(record => this.#filter === "all" || (this.#filter === "20" && record.n === 20) || (this.#filter === "1" && record.n === 1)
      || (this.#filter === "open" && !view.notes[record.k])).reverse();
    const chip = (id, label, count) => `<button type="button" class="hwrt-chip${this.#filter === id ? " is-active" : ""}" data-action="filter" data-filter="${id}" aria-pressed="${this.#filter === id}">${e(label)} <b>${count}</b></button>`;
    const chips = [chip("all", tr("All"), all.length), chip("20", tr("Nat20"), all.filter(r => r.n === 20).length), chip("1", tr("Nat1"), all.filter(r => r.n === 1).length),
      ...(view.isGM ? [chip("open", tr("NeedsNote"), all.filter(r => !view.notes[r.k]).length)] : [])].join("");
    return `<div class="hwrt-chips">${chips}</div>${shown.length ? this.#momentList(view, shown) : this.#empty(tr("NoMoments"))}`;
  }

  #momentList(view, records, { compact = false } = {}) {
    if (!records.length) return "";
    const items = records.map(record => {
      const { title, result } = describeRecord(record);
      const note = view.notes[record.k] ?? "";
      const user = view.users.find(entry => entry.id === record.u);
      const actor = record.a ? actorName(record.a, view.sessions) : "";
      const who = actor && actor !== user?.name ? `${actor} · ${user?.name ?? ""}` : actor || user?.name || "";
      const noteHTML = view.isGM && !compact
        ? `<input type="text" data-note="${e(record.k)}" value="${e(note)}" maxlength="280" placeholder="${e(tr(record.n === 20 ? "AskNat20" : "AskNat1"))}" aria-label="${e(tr("NoteLabel"))}">`
        : note ? `<q>${e(note)}</q>` : `<span class="hwrt-nonote">${e(tr("NoNote"))}</span>`;
      return `<article class="hwrt-moment is-nat${record.n}" style="--who: ${e(user?.color ?? "var(--hw-phos)")}">
        <span class="hwrt-badge">${record.n}</span>
        <div><div class="hwrt-moment-top"><b>${e(who)}</b><time datetime="${new Date(record.t).toISOString()}">${e(this.#scope === "all" ? when(record.t) : clock(record.t))}</time></div>
        <div class="hwrt-moment-what">${e(title)}${result ? ` · <span>${e(result)}</span>` : ""}</div>
        <div class="hwrt-moment-note">${noteHTML}</div></div></article>`;
    }).join("");
    return `<div class="hwrt-moments${compact ? " is-compact" : ""}">${items}</div>`;
  }

  /* Sessions (GM) ---------------------------------------------------------------------------------- */

  #sessionsTab(view) {
    const live = view.sessions.find(session => session.live);
    const rows = view.sessions.map(session => {
      const records = Object.values(session.records ?? {});
      const players = new Set(records.map(record => record.u).filter(id => !(game.users.get(id)?.isGM ?? session.users?.[id]?.g)));
      const d20 = records.filter(record => D20_KINDS.has(record.c));
      return `<tr${session.live ? ` class="is-live"` : ""}>
        <th scope="row"><span class="hwrt-rowhead"><input type="text" data-rename="${e(session.id)}" value="${e(session.name ?? "")}" placeholder="${e(sessionName({ no: session.no }))}" maxlength="80" aria-label="${e(tr("SessionName"))}">${session.live ? `<em><i class="hwrt-live" aria-hidden="true"></i>${e(tr("Live"))}</em>` : ""}</span></th>
        <td>${e(when(session.start))}</td><td>${e(duration(session.start, session.last))}</td>
        <td>${num(records.filter(record => record.c !== "use" && record.c !== "evt").length)}</td><td>${players.size}</td>
        <td><span class="is-crit">${d20.filter(record => record.n === 20).length}</span> / <span class="is-fumble">${d20.filter(record => record.n === 1).length}</span></td>
        <td><span class="hwrt-actions"><button type="button" class="hwrt-icon" data-action="scopeTo" data-session="${e(session.id)}" data-tooltip="${e(tr("View"))}" aria-label="${e(tr("View"))}"><i class="fas fa-eye" inert></i></button>
          <button type="button" class="hwrt-icon is-danger" data-action="deleteSession" data-session="${e(session.id)}" data-tooltip="${e(tr("Delete"))}" aria-label="${e(tr("Delete"))}"><i class="fas fa-trash" inert></i></button></span></td>
      </tr>`;
    }).join("");
    return `<div class="hwrt-toolbar">
        <button type="button" data-action="endSession"${live ? "" : " disabled"}><i class="fas fa-flag-checkered" inert></i>${e(tr("EndSession"))}</button>
        <button type="button" data-action="importLog"><i class="fas fa-file-import" inert></i>${e(tr("ImportLog"))}</button>
        <button type="button" data-action="exportData"${view.sessions.length ? "" : " disabled"}><i class="fas fa-file-export" inert></i>${e(tr("Export"))}</button>
      </div>
      <p class="hwrt-hint">${e(tr("SessionsHint", { hours: game.settings.get(MODULE_ID, "rollTrackerGap") }))}</p>
      ${rows ? `<div class="hwrt-tablewrap"><table class="hwrt-table is-sessions"><thead><tr>${["Session", "Started", "Length", "Rolls", "Players", "Nats", ""].map(key => `<th scope="col">${key ? e(tr(`Col.${key}`)) : ""}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>` : this.#empty(tr("NoSessions"), tr("NoSessionsGM"))}`;
  }

  /* Actions ---------------------------------------------------------------------------------------- */

  static #onView(event, target) { this.#tab = target.dataset.view; this.render(); }

  static #onEntity(event, target) {
    this.#entity = target.dataset.entity;
    this.#tab = "players";
    this.render();
  }

  static #onFilter(event, target) { this.#filter = target.dataset.filter; this.render(); }

  static #onScopeTo(event, target) { this.#scope = target.dataset.session; this.#tab = "overview"; this.render(); }

  static async #onEndSession() {
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: tr("EndSession") }, content: `<p>${e(tr("EndSessionAsk"))}</p>` });
    if (ok) await endSession();
  }

  static async #onImport() {
    const count = await importChatLog();
    ui.notifications.info(count ? tr("Imported", { n: count }) : tr("ImportedNone"));
  }

  static #onExport() {
    const data = { module: MODULE_ID, exported: new Date().toISOString(), sessions: allSessions().map(({ live, ...session }) => session) };
    foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", `roll-tracker-${game.world.id}.json`);
  }

  static async #onDelete(event, target) {
    const session = allSessions().find(entry => entry.id === target.dataset.session);
    if (!session) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: tr("Delete") }, content: `<p>${e(tr("DeleteAsk", { name: sessionName(session) }))}</p>`
    });
    if (!ok) return;
    if (this.#scope === session.id) this.#scope = null;
    await deleteSession(session.id);
  }

  static async #onRecap() {
    const view = this.#view();
    const all = this.#scope === "all";
    const session = view.chosen[0];
    const list = view.users.map(user => ({ id: user.key, stats: view.stats(user.key) }));
    const s = view.stats("all");
    const items = awards(list).map(award => `<li style="--who: ${e(view.colorFor(award.entities[0]))}"><i class="fas ${AWARD_ICONS[award.id] ?? "fa-medal"}" inert></i><span>${e(tr(`Award.${award.id}`))}</span><b>${e(award.entities.map(key => view.label(key)).join(" & "))}</b><em>${e(this.#awardValue(award))}</em></li>`).join("");
    const moments = view.records.filter(record => (record.n === 20 || record.n === 1) && D20_KINDS.has(record.c) && view.notes[record.k]).slice(-5).map(record => {
      const { title } = describeRecord(record);
      const actor = record.a ? actorName(record.a, view.sessions) : userName(record.u, view.sessions);
      return `<li class="is-nat${record.n}"><span>${record.n}</span><div><b>${e(actor)}</b> · ${e(title)}<q>${e(view.notes[record.k])}</q></div></li>`;
    }).join("");
    const content = `<div class="hwrt-recap">
      <header><i class="fas fa-dice-d20" inert></i><div><span>${e(tr("RecapKicker"))}</span><b>${e(all ? tr("Campaign") : sessionName(session))}</b></div></header>
      <div class="hwrt-recap-stats"><span><b>${num(s.rolls)}</b>${e(tr("K.Rolls"))}</span><span><b>${avg(s.d20.avg)}</b>${e(tr("K.Avg"))}</span><span class="is-crit"><b>${num(s.d20.nat20)}</b>${e(tr("K.Nat20"))}</span><span class="is-fumble"><b>${num(s.d20.nat1)}</b>${e(tr("K.Nat1"))}</span></div>
      ${items ? `<ul class="hwrt-recap-awards">${items}</ul>` : ""}
      ${moments ? `<div class="hwrt-recap-sect">${e(tr("LatestMoments"))}</div><ul class="hwrt-recap-moments">${moments}</ul>` : ""}
    </div>`;
    await ChatMessage.implementation.create({ content, speaker: { alias: tr("Title") }, flags: { [MODULE_ID]: { type: "rollRecap" } } });
  }
}

/* Charts --------------------------------------------------------------------------------------------- */

/** Bars for d20 faces 1-20 with the fair-die line. */
function histogram(counts, color, { compact = false } = {}) {
  const values = counts.slice(1, 21);
  const total = values.reduce((sum, value) => sum + value, 0);
  const expected = total / 20;
  const top = Math.max(1, expected * 1.8, ...values);
  const W = 400, H = compact ? 70 : 120, w = W / 20;
  const bars = values.map((value, index) => {
    const face = index + 1;
    const h = value / top * H;
    const tone = face === 20 ? "is-crit" : face === 1 ? "is-fumble" : "";
    return `<rect class="${tone}" x="${(index * w + 2).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(w - 4).toFixed(1)}" height="${Math.max(h, value ? 1.5 : 0).toFixed(1)}"><title>${face}: ${value}</title></rect>`;
  }).join("");
  const labels = compact ? "" : [1, 5, 10, 15, 20].map(face => `<text x="${((face - 0.5) * w).toFixed(1)}" y="${H + 13}">${face}</text>`).join("");
  const y = (H - expected / top * H).toFixed(1);
  return `<svg class="hwrt-hist" viewBox="0 0 ${W} ${H + (compact ? 2 : 16)}" style="--bar: ${escapeHTML(color)}" role="img" aria-label="${escapeHTML(tr("FacesAria", { list: values.join(", ") }))}">
    ${bars}<line class="hwrt-expected" x1="0" x2="${W}" y1="${y}" y2="${y}"></line>${labels}</svg>`;
}

/** Two players' d20 faces as shares of their rolls, side by side. */
function pairHistogram(a, b) {
  const share = counts => { const total = counts.slice(1).reduce((sum, value) => sum + value, 0) || 1; return counts.slice(1, 21).map(value => value / total); };
  const A = share(a), B = share(b);
  const top = Math.max(0.1, ...A, ...B);
  const W = 800, H = 130, w = W / 20;
  const rect = (value, x, cls) => `<rect class="${cls}" x="${x.toFixed(1)}" y="${(H - value / top * H).toFixed(1)}" width="${(w / 2 - 1.5).toFixed(1)}" height="${(value / top * H).toFixed(1)}"></rect>`;
  const bars = A.map((value, index) => rect(value, index * w + 1, "is-a") + rect(B[index], index * w + w / 2 + 0.5, "is-b")).join("");
  const y = (H - 0.05 / top * H).toFixed(1);
  const labels = [1, 5, 10, 15, 20].map(face => `<text x="${((face - 0.5) * w).toFixed(1)}" y="${H + 13}">${face}</text>`).join("");
  return `<svg class="hwrt-hist is-pair" viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="${escapeHTML(tr("FacesBoth"))}">${bars}<line class="hwrt-expected" x1="0" x2="${W}" y1="${y}" y2="${y}"></line>${labels}</svg>`;
}

/** Every kept d20 in order, with a running average over the last five. */
function timeline(points, color) {
  const W = 600, H = 90, pad = 6;
  const n = points.length;
  const x = index => n === 1 ? W / 2 : pad + index / (n - 1) * (W - pad * 2);
  const y = value => pad + (20 - value) / 19 * (H - pad * 2);
  const running = points.map((point, index) => {
    const window = points.slice(Math.max(0, index - 4), index + 1);
    return window.reduce((sum, entry) => sum + entry[1], 0) / window.length;
  });
  const line = running.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const dots = points.map(([t, value], index) => `<circle class="${value === 20 ? "is-crit" : value === 1 ? "is-fumble" : ""}" cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="${value === 20 || value === 1 ? 3.6 : 2}"><title>${escapeHTML(clock(t))} · ${value}</title></circle>`).join("");
  const mid = y(10.5).toFixed(1);
  return `<svg class="hwrt-timeline" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="--bar: ${escapeHTML(color)}" role="img" aria-label="${escapeHTML(tr("TimelineAria", { n }))}">
    <line class="hwrt-expected" x1="0" x2="${W}" y1="${mid}" y2="${mid}"></line><polyline points="${line}"></polyline>${dots}</svg>`;
}

/** Labelled horizontal bars. */
function bars(items, { color = "var(--hw-phos)" } = {}) {
  const top = Math.max(1, ...items.map(item => item.value));
  return `<ul class="hwrt-bars">${items.map(item => `<li style="--fill: ${(item.value / top * 100).toFixed(1)}%; --bar: ${escapeHTML(item.color ?? color)}"><span>${escapeHTML(item.label)}</span><i></i><b>${num(item.value)}</b></li>`).join("")}</ul>`;
}
