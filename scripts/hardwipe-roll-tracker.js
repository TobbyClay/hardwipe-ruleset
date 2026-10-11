import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { D20_KINDS, extractRecords } from "./hardwipe-roll-data.js";

/**
 * Roll Tracker: the active GM's client reads every chat message's rolls into compact records, grouped
 * into play sessions. A new session starts on the first roll after a break (world setting, in hours), or
 * when the GM ends one. The session in play is one world setting (`rollTrackerLive`), written a second
 * after the rolls arrive; finished sessions move to a second (`rollTrackerArchive`), written only when
 * sessions change. Natural 1s and 20s pop a small note prompt on that GM's screen; the note is kept with
 * the roll and shown under Moments.
 */
export const LIVE = "rollTrackerLive";
export const ARCHIVE = "rollTrackerArchive";
const ENABLED = "rollTrackerEnabled";
const PROMPT = "rollTrackerPrompt";
const PLAYERS = "rollTrackerPlayers";
const GAP = "rollTrackerGap";
const FLUSH_MS = 1000;
// A natural 1 or 20 asks for a note only while it is fresh, never when old messages are read in.
const PROMPT_FRESH_MS = 120000;
const NOTE_LIMIT = 280;

export const tr = (key, data) => data ? game.i18n.format(`HARDWIPE.Tracker.${key}`, data) : game.i18n.localize(`HARDWIPE.Tracker.${key}`);
let TrackerApp = null;

export function registerRollTracker(App) {
  TrackerApp = App;
  game.settings.registerMenu(MODULE_ID, "rollTrackerMenu", {
    name: "HARDWIPE.Tracker.Menu", label: "HARDWIPE.Tracker.MenuLabel", hint: "HARDWIPE.Tracker.MenuHint",
    icon: "fas fa-dice-d20", type: App, restricted: false
  });
  game.settings.register(MODULE_ID, ENABLED, {
    name: "HARDWIPE.Tracker.Enabled", hint: "HARDWIPE.Tracker.EnabledHint", scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, PROMPT, {
    name: "HARDWIPE.Tracker.Prompt", hint: "HARDWIPE.Tracker.PromptHint", scope: "world", config: true, type: String, default: "all",
    choices: { all: "HARDWIPE.Tracker.PromptAll", players: "HARDWIPE.Tracker.PromptPlayers", off: "HARDWIPE.Tracker.PromptOff" }
  });
  game.settings.register(MODULE_ID, PLAYERS, {
    name: "HARDWIPE.Tracker.PlayersView", hint: "HARDWIPE.Tracker.PlayersViewHint", scope: "world", config: true, type: Boolean, default: true,
    onChange: refreshApps
  });
  game.settings.register(MODULE_ID, GAP, {
    name: "HARDWIPE.Tracker.Gap", hint: "HARDWIPE.Tracker.GapHint", scope: "world", config: true, type: Number, default: 4,
    range: { min: 1, max: 24, step: 1 }
  });
  game.settings.register(MODULE_ID, LIVE, { scope: "world", config: false, type: Object, default: {}, onChange: refreshApps });
  game.settings.register(MODULE_ID, ARCHIVE, { scope: "world", config: false, type: Object, default: { sessions: [] }, onChange: refreshApps });

  Hooks.on("createChatMessage", message => Recorder.observe(message));
  Hooks.on("updateChatMessage", message => Recorder.observe(message));
  Hooks.once("ready", () => Recorder.catchUp());
  game.hardwipe ??= {};
  game.hardwipe.rollTracker = {
    open: options => openTracker(options),
    sessions: () => allSessions(),
    endSession: () => endSession(),
    importChatLog: () => importChatLog()
  };
}

export function openTracker(options = {}) {
  if (!TrackerApp) return null;
  const app = new TrackerApp(options);
  app.render({ force: true });
  return app;
}

export function canView() {
  return game.user.isGM || !!game.settings.get(MODULE_ID, PLAYERS);
}

let refreshTimer = null;
function refreshApps() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    for (const app of foundry.applications.instances.values()) if (TrackerApp && app instanceof TrackerApp && app.rendered) app.refresh();
  }, 300);
}

/* Storage ------------------------------------------------------------------------------------------ */

export function readLive() {
  const value = game.settings.get(MODULE_ID, LIVE);
  return value?.id ? value : null;
}

export function readArchive() {
  const value = game.settings.get(MODULE_ID, ARCHIVE);
  return Array.isArray(value?.sessions) ? value.sessions.filter(session => session?.id) : [];
}

/** Every session, newest first; the one in play carries `live: true`. */
export function allSessions() {
  const live = readLive();
  return [...(live ? [{ ...live, live: true }] : []), ...readArchive()].sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
}

export const sessionName = session => session?.name || tr("SessionN", { n: session?.no ?? "?" });

let writes = Promise.resolve();
/**
 * Run `task(state)` on fresh copies of the stored sessions and save what it changed. Writes run one at a
 * time. The archive is copied only when the task reads it.
 */
function mutate(task) {
  const run = writes.then(async () => {
    if (!game.user.isGM) throw new Error("Only a GM can change the Roll Tracker.");
    let archive = null;
    const liveBefore = JSON.stringify(readLive());
    const state = {
      live: foundry.utils.deepClone(readLive()),
      get archive() { return archive ??= foundry.utils.deepClone(readArchive()); },
      set archive(value) { archive = value; }
    };
    const result = await task(state);
    if (JSON.stringify(state.live) !== liveBefore) await game.settings.set(MODULE_ID, LIVE, state.live ?? {});
    if (archive) await game.settings.set(MODULE_ID, ARCHIVE, { sessions: archive });
    return result;
  });
  writes = run.catch(error => console.error(`${MODULE_ID} | Roll Tracker`, error));
  return run;
}

function newSession(t, state) {
  const numbers = [state.live?.no ?? 0, ...readArchive().map(session => session.no ?? 0), ...(state.archive ?? []).map(session => session.no ?? 0)];
  return { id: foundry.utils.randomID(), no: Math.max(0, ...numbers) + 1, name: "", start: t, last: t, records: {}, notes: {}, users: {}, actors: {} };
}

/** The session already holding a record key, without copying the archive unless it is there. */
function holderOf(state, key) {
  if (state.live?.records?.[key]) return state.live;
  if (!readArchive().some(session => session.records?.[key])) return null;
  return state.archive.find(session => session.records?.[key]) ?? null;
}

function file(session, record, names) {
  session.records[record.k] = record;
  session.start = Math.min(session.start ?? record.t, record.t);
  session.last = Math.max(session.last ?? record.t, record.t);
  for (const id of [record.u, record.b]) if (id && names.users[id]) (session.users ??= {})[id] = names.users[id];
  if (record.a && names.actors[record.a]) (session.actors ??= {})[record.a] = names.actors[record.a];
}

function placeLive(state, records, names) {
  const gap = (Number(game.settings.get(MODULE_ID, GAP)) || 4) * 3600000;
  for (const record of records.sort((a, b) => a.t - b.t)) {
    const holder = holderOf(state, record.k);
    if (holder) { file(holder, record, names); continue; }
    if (state.live && record.t - state.live.last > gap) {
      state.archive.push(state.live);
      state.live = null;
    }
    state.live ??= newSession(record.t, state);
    file(state.live, record, names);
  }
}

/* Recording ---------------------------------------------------------------------------------------- */

/** The player a roll counts for: a player-owned actor's player (their own character first), else whoever rolled. */
function userFor(actorId, authorId) {
  const actor = actorId ? game.actors.get(actorId) : null;
  if (!actor?.hasPlayerOwner) return authorId;
  const owners = game.users.filter(user => !user.isGM && actor.testUserPermission(user, "OWNER"));
  return (owners.find(user => user.character?.id === actor.id) ?? owners.find(user => user.id === authorId) ?? owners[0])?.id ?? authorId;
}

function plainMessage(message) {
  const source = message._source ?? {};
  const D20Roll = CONFIG.Dice.D20Roll, DamageRoll = CONFIG.Dice.DamageRoll;
  return {
    id: message.id, type: message.type, timestamp: message.timestamp ?? source.timestamp,
    author: message.author?.id ?? source.author ?? null, speaker: source.speaker ?? {},
    whisper: [...(message.whisper ?? source.whisper ?? [])], blind: !!(message.blind ?? source.blind),
    system: source.system ?? {}, flags: message.flags ?? source.flags ?? {},
    rolls: (message.rolls ?? []).map(roll => ({
      kind: D20Roll && roll instanceof D20Roll ? "d20" : DamageRoll && roll instanceof DamageRoll ? "damage" : "",
      options: roll.options ?? {}, total: roll.total,
      dice: (roll.dice ?? []).map(term => ({
        faces: term.faces, results: (term.results ?? []).map(result => ({ v: result.result, a: result.active !== false && !result.discarded }))
      }))
    }))
  };
}

function namesFor(records, message) {
  const users = {}, actors = {};
  for (const record of records) {
    for (const id of [record.u, record.b]) {
      const user = id && game.users.get(id);
      if (user) users[id] = { n: user.name, g: user.isGM ? 1 : 0, c: user.color?.css ?? String(user.color ?? "") };
    }
    if (record.a) actors[record.a] = game.actors.get(record.a)?.name ?? message.speaker?.alias ?? "";
  }
  return { users, actors };
}

export function recordsOf(message) {
  try { return extractRecords(plainMessage(message), { userFor }); }
  catch (error) {
    console.warn(`${MODULE_ID} | Roll Tracker could not read message ${message?.id}`, error);
    return [];
  }
}

class Recorder {
  static known = null;
  static pending = new Map();
  static names = { users: {}, actors: {} };
  static timer = null;

  static active() {
    return game.user.isGM && game.users.activeGM?.isSelf && !!game.settings.get(MODULE_ID, ENABLED);
  }

  /** Record key -> stored JSON, built from the sessions on first use. */
  static index() {
    if (this.known) return this.known;
    this.known = new Map();
    for (const session of allSessions()) for (const [key, record] of Object.entries(session.records ?? {})) this.known.set(key, JSON.stringify(record));
    return this.known;
  }

  static reset() { this.known = null; }

  static observe(message, { prompt = true } = {}) {
    if (!this.active()) return;
    const records = recordsOf(message);
    if (!records.length) return;
    const known = this.index();
    const names = namesFor(records, message);
    for (const record of records) {
      const json = JSON.stringify(record);
      const before = known.get(record.k);
      if (before === json) continue;
      known.set(record.k, json);
      this.pending.set(record.k, record);
      Object.assign(this.names.users, names.users);
      Object.assign(this.names.actors, names.actors);
      const was = before ? JSON.parse(before).n : null;
      if (prompt && D20_KINDS.has(record.c) && (record.n === 1 || record.n === 20) && was !== record.n) Prompts.offer(record);
      else Prompts.update(record);
    }
    if (this.pending.size && !this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  static flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.size) return writes;
    const records = [...this.pending.values()];
    const names = this.names;
    this.pending = new Map();
    this.names = { users: {}, actors: {} };
    return mutate(state => placeLive(state, records, names));
  }

  /** Rolls posted while this GM was away: everything after the newest record. */
  static catchUp() {
    if (!this.active()) return;
    let newest = 0;
    for (const session of allSessions()) newest = Math.max(newest, session.last ?? 0);
    if (!newest) return;
    for (const message of game.messages.contents) if ((message.timestamp ?? 0) >= newest - 60000) this.observe(message, { prompt: false });
  }
}

/* Session management (GM) --------------------------------------------------------------------------- */

export async function endSession() {
  await Recorder.flush();
  return mutate(state => {
    if (!state.live) return false;
    state.archive.push(state.live);
    state.live = null;
    return true;
  });
}

export async function renameSession(id, name) {
  await Recorder.flush();
  return mutate(state => {
    const session = state.live?.id === id ? state.live : state.archive.find(entry => entry.id === id);
    if (session) session.name = String(name ?? "").trim().slice(0, 80);
  });
}

export async function deleteSession(id) {
  await Recorder.flush();
  await mutate(state => {
    if (state.live?.id === id) state.live = null;
    else state.archive = state.archive.filter(entry => entry.id !== id);
  });
  Recorder.reset();
}

export async function setNote(key, text) {
  await Recorder.flush();
  const note = String(text ?? "").trim().slice(0, NOTE_LIMIT);
  return mutate(state => {
    const session = holderOf(state, key);
    if (!session) return false;
    session.notes ??= {};
    if (note) session.notes[key] = note;
    else delete session.notes[key];
    return true;
  });
}

/**
 * Read the whole chat log into the tracker. Rolls already recorded are skipped; the rest join the session
 * whose time they fall in (within the break length), or form new sessions. Sessions without a custom name
 * are then renumbered in date order.
 */
export async function importChatLog() {
  await Recorder.flush();
  Recorder.reset();
  const known = Recorder.index();
  const fresh = [], names = { users: {}, actors: {} };
  for (const message of game.messages.contents) {
    const records = recordsOf(message).filter(record => !known.has(record.k));
    if (!records.length) continue;
    fresh.push(...records);
    const found = namesFor(records, message);
    Object.assign(names.users, found.users);
    Object.assign(names.actors, found.actors);
  }
  if (!fresh.length) return 0;
  const gap = (Number(game.settings.get(MODULE_ID, GAP)) || 4) * 3600000;
  await mutate(state => {
    const sessions = [...(state.live ? [state.live] : []), ...state.archive];
    for (const record of fresh.sort((a, b) => a.t - b.t)) {
      let session = sessions.find(entry => record.t >= entry.start - gap && record.t <= entry.last + gap);
      if (!session) {
        session = newSession(record.t, state);
        state.archive.push(session);
        sessions.push(session);
      }
      file(session, record, names);
    }
    const ordered = [...sessions].sort((a, b) => a.start - b.start);
    ordered.forEach((session, index) => { session.no = index + 1; });
  });
  Recorder.reset();
  return fresh.length;
}

/* Record wording ------------------------------------------------------------------------------------ */

function abilityName(key, short = false) {
  const config = CONFIG.DND5E?.abilities?.[key];
  if (!config) return String(key ?? "").toUpperCase();
  return short ? String(config.abbreviation ?? key).toUpperCase() : game.i18n.localize(config.label ?? key);
}

function toolName(key) {
  let label = "";
  try { label = dnd5e.documents.Trait.keyLabel(key, { trait: "tool" }); } catch { label = ""; }
  return label || String(key ?? "");
}

/** "Fire Bolt attack" and "15 vs AC 13 · Hit" for a record. */
export function describeRecord(record) {
  let title;
  switch (record.c) {
    case "atk": title = record.i ? tr("Desc.AttackWith", { item: record.i }) : tr("Desc.Attack"); break;
    case "save": title = tr("Desc.Save", { ability: abilityName(record.s, true) }); break;
    case "death": title = tr("Desc.Death"); break;
    case "conc": title = tr("Desc.Concentration"); break;
    case "check": title = tr("Desc.Check", { name: abilityName(record.s) }); break;
    case "skill": title = tr("Desc.Check", { name: game.i18n.localize(CONFIG.DND5E?.skills?.[record.s]?.label ?? record.s ?? "") }); break;
    case "tool": title = tr("Desc.Check", { name: toolName(record.s) }); break;
    case "init": title = tr("Desc.Initiative"); break;
    case "dmg": title = record.i ? tr("Desc.DamageWith", { item: record.i }) : tr("Desc.Damage"); break;
    case "heal": title = record.i ? tr("Desc.HealingWith", { item: record.i }) : tr("Desc.Healing"); break;
    default: title = tr("Desc.Roll");
  }
  const target = Number.isFinite(record.x) ? tr(record.c === "atk" ? "Desc.VsAC" : "Desc.VsDC", { total: record.v, target: record.x }) : String(record.v ?? "");
  const saveLike = record.c === "save" || record.c === "death" || record.c === "conc";
  const outcome = record.o === 1 ? tr(record.c === "atk" ? "Desc.Hit" : saveLike ? "Desc.Saved" : "Desc.Success")
    : record.o === 0 ? tr(record.c === "atk" ? "Desc.Miss" : saveLike ? "Desc.Failed" : "Desc.Failure") : "";
  return { title, result: [target, outcome].filter(Boolean).join(" · ") };
}

export function userName(id, sessions = []) {
  const user = game.users.get(id);
  if (user) return user.name;
  for (const session of sessions) if (session.users?.[id]?.n) return session.users[id].n;
  return tr("Unknown");
}

export function actorName(id, sessions = []) {
  const actor = game.actors.get(id);
  if (actor) return actor.name;
  for (const session of sessions) if (session.actors?.[id]) return session.actors[id];
  return tr("Unknown");
}

/* Natural 1 and 20 prompts (GM) ---------------------------------------------------------------------- */

class Prompts {
  static queue = [];
  static VISIBLE = 3;

  static offer(record) {
    const mode = game.settings.get(MODULE_ID, PROMPT);
    if (mode === "off" || Date.now() - record.t > PROMPT_FRESH_MS) return;
    if (mode === "players" && (game.users.get(record.u)?.isGM ?? true)) return;
    this.queue = this.queue.filter(entry => entry.record.k !== record.k);
    this.queue.push({ record, added: Date.now() });
    this.render();
  }

  /** A queued roll changed after it was offered (a hit resolved, a bonus added): show it as it is now. */
  static update(record) {
    const entry = this.queue.find(item => item.record.k === record.k);
    if (!entry) return;
    if (record.n !== 1 && record.n !== 20) return this.remove(record.k);
    entry.record = record;
    this.render();
  }

  static remove(key) {
    this.queue = this.queue.filter(entry => entry.record.k !== key);
    this.render();
  }

  static container() {
    let element = document.getElementById("hwrt-prompts");
    if (!element) {
      element = document.createElement("section");
      element.id = "hwrt-prompts";
      element.className = "hwrt-prompts";
      element.setAttribute("aria-label", tr("PromptRegion"));
      document.body.append(element);
      element.addEventListener("submit", event => {
        event.preventDefault();
        const form = event.target.closest("form[data-key]");
        if (form) this.save(form);
      });
      element.addEventListener("click", event => {
        const button = event.target.closest("[data-prompt-action]");
        if (!button) return;
        const form = button.closest("form[data-key]");
        if (button.dataset.promptAction === "skip" && form) this.remove(form.dataset.key);
        if (button.dataset.promptAction === "skipAll") { this.queue = []; this.render(); }
        if (button.dataset.promptAction === "open") openTracker({ tab: "moments" });
      });
      element.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        const form = event.target.closest("form[data-key]");
        if (!form) return;
        event.stopPropagation();
        this.remove(form.dataset.key);
      });
      window.addEventListener("resize", () => this.place());
    }
    return element;
  }

  /** Sit just left of the sidebar, above the hotbar. */
  static place() {
    const element = document.getElementById("hwrt-prompts");
    if (!element) return;
    const left = document.getElementById("sidebar")?.getBoundingClientRect().left;
    element.style.right = `${Number.isFinite(left) && left > 0 ? Math.max(12, window.innerWidth - left + 12) : 12}px`;
    const hotbar = document.getElementById("hotbar")?.getBoundingClientRect();
    element.style.bottom = `${hotbar?.height ? Math.max(14, window.innerHeight - hotbar.top + 10) : 14}px`;
  }

  static async save(form) {
    const key = form.dataset.key;
    const input = form.querySelector("input[name=note]");
    form.classList.add("is-saving");
    try {
      await setNote(key, input?.value ?? "");
      this.remove(key);
    } catch (error) {
      form.classList.remove("is-saving");
      ui.notifications.error(tr("NoteFailed"));
      console.error(error);
    }
  }

  static render() {
    const element = this.container();
    // Keep what the GM is typing when the stack redraws.
    const drafts = Object.fromEntries([...element.querySelectorAll("form[data-key]")].map(form => [form.dataset.key, form.querySelector("input[name=note]")?.value ?? ""]));
    const focused = document.activeElement?.closest?.("#hwrt-prompts form[data-key]")?.dataset.key;
    const shown = this.queue.slice(0, this.VISIBLE);
    const more = this.queue.length - shown.length;
    element.innerHTML = shown.map(({ record, added }) => {
      const nat = record.n === 20 ? 20 : 1;
      const { title, result } = describeRecord(record);
      const actor = record.a ? actorName(record.a) : "";
      const user = userName(record.u);
      const who = actor && actor !== user ? `${actor} · ${user}` : actor || user;
      const fresh = Date.now() - added < 1000 ? " is-arriving" : "";
      return `<form class="hwrt-prompt is-nat${nat}${fresh}" data-key="${escapeHTML(record.k)}" autocomplete="off">
        <header>
          <span class="hwrt-prompt-badge">${escapeHTML(tr(nat === 20 ? "Nat20" : "Nat1"))}</span>
          <span class="hwrt-prompt-who">${escapeHTML(who)}</span>
          <button type="button" class="hwrt-prompt-x" data-prompt-action="skip" data-tooltip="${escapeHTML(tr("Skip"))}" aria-label="${escapeHTML(tr("Skip"))}"><i class="fas fa-xmark" inert></i></button>
        </header>
        <div class="hwrt-prompt-what"><b>${escapeHTML(title)}</b>${result ? ` <span>${escapeHTML(result)}</span>` : ""}</div>
        <div class="hwrt-prompt-row">
          <input type="text" name="note" maxlength="${NOTE_LIMIT}" placeholder="${escapeHTML(tr(nat === 20 ? "AskNat20" : "AskNat1"))}" aria-label="${escapeHTML(tr("NoteLabel"))}">
          <button type="submit" data-tooltip="${escapeHTML(tr("SaveNote"))}" aria-label="${escapeHTML(tr("SaveNote"))}"><i class="fas fa-feather-pointed" inert></i></button>
        </div>
      </form>`;
    }).join("") + (more > 0 ? `<div class="hwrt-prompt-more"><span>${escapeHTML(tr("MorePrompts", { n: more }))}</span>
      <button type="button" data-prompt-action="open">${escapeHTML(tr("OpenMoments"))}</button>
      <button type="button" data-prompt-action="skipAll">${escapeHTML(tr("SkipAll"))}</button></div>` : "");
    for (const form of element.querySelectorAll("form[data-key]")) {
      const input = form.querySelector("input[name=note]");
      if (input && drafts[form.dataset.key]) input.value = drafts[form.dataset.key];
      if (input && focused === form.dataset.key) input.focus();
    }
    element.hidden = !this.queue.length;
    this.place();
  }
}
