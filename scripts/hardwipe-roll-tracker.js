import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { D20_KINDS, extractRecords } from "./hardwipe-roll-data.js";

/**
 * Roll Tracker: the active GM's client reads every chat message's rolls into compact records, filed into
 * play sessions by time. The GM runs the sessions: when they load the world after a break, a dialog asks
 * whether tonight is a new session and what it is called; each session's name, number and times stay
 * editable, and changing a time re-files the rolls. Rolls outside every session wait as "unfiled" until a
 * session covers them.
 *
 * Storage, both world settings written by a GM:
 * - `rollTrackerCurrent`: the session in play (if any) and the unfiled rolls; written a second after rolls arrive.
 * - `rollTrackerArchive`: finished sessions; written only when sessions change.
 *
 * Natural 1s and 20s pop a small note prompt on that GM's screen; the note stays with the roll. The GM can
 * open the tracker on every connected client (Show players) and post a Screamsheet recap to chat.
 */
export const CURRENT = "rollTrackerCurrent";
export const ARCHIVE = "rollTrackerArchive";
const ENABLED = "rollTrackerEnabled";
const PROMPT = "rollTrackerPrompt";
const PLAYERS = "rollTrackerPlayers";
const ASK = "rollTrackerAskSession";
const FLUSH_MS = 1000;
// A natural 1 or 20 asks for a note only while it is fresh, never when old messages are read in.
const PROMPT_FRESH_MS = 120000;
// The GM is asked about the session at login when nothing was rolled in the last hour.
const IDLE_MS = 3600000;
// Imported rolls with no session form new sessions, split at breaks this long.
const IMPORT_GAP_MS = 4 * 3600000;
export const NOTE_LIMIT = 280;

export const tr = (key, data) => data ? game.i18n.format(`HARDWIPE.Tracker.${key}`, data) : game.i18n.localize(`HARDWIPE.Tracker.${key}`);
const apps = {};
let socket = null;

export function registerRollTracker({ App, SessionDialog, RecapDialog }) {
  Object.assign(apps, { App, SessionDialog, RecapDialog });
  game.settings.registerMenu(MODULE_ID, "rollTrackerMenu", {
    name: "HARDWIPE.Tracker.Menu", label: "HARDWIPE.Tracker.MenuLabel", hint: "HARDWIPE.Tracker.MenuHint",
    icon: "fas fa-dice-d20", type: App, restricted: false
  });
  game.settings.register(MODULE_ID, ENABLED, {
    name: "HARDWIPE.Tracker.Enabled", hint: "HARDWIPE.Tracker.EnabledHint", scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, ASK, {
    name: "HARDWIPE.Tracker.Ask", hint: "HARDWIPE.Tracker.AskHint", scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, PROMPT, {
    name: "HARDWIPE.Tracker.Prompt", hint: "HARDWIPE.Tracker.PromptHint", scope: "world", config: true, type: String, default: "all",
    choices: { all: "HARDWIPE.Tracker.PromptAll", players: "HARDWIPE.Tracker.PromptPlayers", off: "HARDWIPE.Tracker.PromptOff" }
  });
  game.settings.register(MODULE_ID, PLAYERS, {
    name: "HARDWIPE.Tracker.PlayersView", hint: "HARDWIPE.Tracker.PlayersViewHint", scope: "world", config: true, type: Boolean, default: true,
    onChange: refreshApps
  });
  game.settings.register(MODULE_ID, CURRENT, { scope: "world", config: false, type: Object, default: {}, onChange: refreshApps });
  game.settings.register(MODULE_ID, ARCHIVE, { scope: "world", config: false, type: Object, default: { sessions: [] }, onChange: refreshApps });

  Hooks.on("createChatMessage", message => Recorder.observe(message));
  Hooks.on("updateChatMessage", message => Recorder.observe(message));
  Hooks.once("socketlib.ready", registerSocket);
  Hooks.once("ready", () => {
    registerSocket();
    Recorder.catchUp();
    setTimeout(() => askAboutSession(), 1500);
  });
  game.hardwipe ??= {};
  game.hardwipe.rollTracker = {
    open: options => openTracker(options),
    sessions: () => allSessions(),
    unfiled: () => readCurrent().unfiled,
    startSession: data => startSession(data),
    endSession: () => endSession(),
    updateSession: (id, data) => updateSession(id, data),
    importChatLog: () => importChatLog(),
    showPlayers: options => showPlayers(options)
  };
}

function registerSocket() {
  if (socket || !globalThis.socketlib) return;
  socket = socketlib.registerModule(MODULE_ID);
  socket?.register("rollTrackerShow", function(payload) {
    const sender = game.users.get(this.socketdata?.userId);
    if (!sender?.isGM) return;
    openTracker({ tab: payload?.tab, scope: payload?.scope, forced: sender.name });
  });
}

/** Open the tracker, or bring an open one forward on the asked tab. */
export function openTracker(options = {}) {
  if (!apps.App) return null;
  const open = [...foundry.applications.instances.values()].find(app => app instanceof apps.App);
  if (open) {
    open.focusOn(options);
    open.render({ force: true });
    open.bringToFront?.();
    return open;
  }
  const app = new apps.App(options);
  app.render({ force: true });
  return app;
}

/** GM: open the tracker on every other connected client. */
export async function showPlayers(options = {}) {
  if (!game.user.isGM) return false;
  registerSocket();
  if (!socket) { ui.notifications.error(tr("ShowFailed")); return false; }
  await socket.executeForOthers("rollTrackerShow", { tab: options.tab ?? "overview", scope: options.scope ?? null });
  const count = game.users.filter(user => user.active && !user.isSelf).length;
  ui.notifications.info(tr("Shown", { n: count }));
  return true;
}

export function canView() {
  return game.user.isGM || !!game.settings.get(MODULE_ID, PLAYERS);
}

let refreshTimer = null;
function refreshApps() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    for (const app of foundry.applications.instances.values()) if (apps.App && app instanceof apps.App && app.rendered) app.refresh();
  }, 300);
}

/* Storage ------------------------------------------------------------------------------------------ */

const emptyBucket = () => ({ records: {}, notes: {}, users: {}, actors: {} });

export function readCurrent() {
  const value = game.settings.get(MODULE_ID, CURRENT) ?? {};
  return { session: value.session?.id ? value.session : null, unfiled: { ...emptyBucket(), ...(value.unfiled ?? {}) } };
}

export function readArchive() {
  const value = game.settings.get(MODULE_ID, ARCHIVE);
  // A finished session always has an end; one without (from an earlier build) ends at its last roll.
  return Array.isArray(value?.sessions)
    ? value.sessions.filter(session => session?.id).map(session => session.end === null || session.end === undefined ? { ...session, end: session.last ?? session.start } : session)
    : [];
}

/** Every session, newest first; the one in play carries `live: true`. */
export function allSessions() {
  const { session } = readCurrent();
  return [...(session ? [{ ...session, live: true }] : []), ...readArchive()].sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
}

export const sessionName = session => session?.name || tr("SessionN", { n: session?.no ?? "?" });
export const nextNumber = () => Math.max(0, ...allSessions().map(session => session.no ?? 0)) + 1;

let writes = Promise.resolve();
/** Run `task(state)` on fresh copies and save what changed, one write at a time. The archive is copied only when read. */
function mutate(task) {
  const run = writes.then(async () => {
    if (!game.user.isGM) throw new Error("Only a GM can change the Roll Tracker.");
    let archive = null;
    const before = JSON.stringify(readCurrent());
    const state = {
      current: foundry.utils.deepClone(readCurrent()),
      get archive() { return archive ??= foundry.utils.deepClone(readArchive()); },
      set archive(value) { archive = value; }
    };
    const result = await task(state);
    if (JSON.stringify(state.current) !== before) await game.settings.set(MODULE_ID, CURRENT, state.current);
    if (archive) await game.settings.set(MODULE_ID, ARCHIVE, { sessions: archive });
    return result;
  });
  writes = run.catch(error => console.error(`${MODULE_ID} | Roll Tracker`, error));
  return run;
}

/** The session a time falls in: the latest-starting one that covers it. */
function sessionAt(sessions, t) {
  let best = null;
  for (const session of sessions) {
    if (t < session.start || (session.end !== null && session.end !== undefined && t > session.end)) continue;
    if (!best || session.start > best.start) best = session;
  }
  return best;
}

function holderOf(state, key) {
  if (state.current.session?.records?.[key]) return state.current.session;
  if (state.current.unfiled.records[key]) return state.current.unfiled;
  if (!readArchive().some(session => session.records?.[key])) return null;
  return state.archive.find(session => session.records?.[key]) ?? null;
}

function file(bucket, record, names) {
  bucket.records ??= {};
  bucket.records[record.k] = record;
  if (bucket.id) bucket.last = Math.max(bucket.last ?? bucket.start ?? record.t, record.t);
  for (const id of [record.u, record.b]) if (id && names.users?.[id]) (bucket.users ??= {})[id] = names.users[id];
  if (record.a && names.actors?.[record.a]) (bucket.actors ??= {})[record.a] = names.actors[record.a];
}

function place(state, records, names) {
  for (const record of [...records].sort((a, b) => a.t - b.t)) {
    const holder = holderOf(state, record.k);
    if (holder) { file(holder, record, names); continue; }
    const current = state.current.session;
    let target = null;
    if (current && record.t >= current.start) target = current;
    else {
      const hit = sessionAt(readArchive(), record.t);
      if (hit) target = state.archive.find(session => session.id === hit.id);
    }
    file(target ?? state.current.unfiled, record, names);
  }
}

/** Re-file every record by time, after a session's times or the session list changed. */
function refile(state) {
  const sessions = [...(state.current.session ? [state.current.session] : []), ...state.archive];
  const buckets = [...sessions, state.current.unfiled];
  const records = [], notes = {}, names = { users: {}, actors: {} };
  for (const bucket of buckets) {
    records.push(...Object.values(bucket.records ?? {}));
    Object.assign(notes, bucket.notes ?? {});
    Object.assign(names.users, bucket.users ?? {});
    Object.assign(names.actors, bucket.actors ?? {});
    Object.assign(bucket, emptyBucket());
  }
  for (const session of sessions) session.last = session.start;
  for (const record of records.sort((a, b) => a.t - b.t)) {
    const target = sessionAt(sessions, record.t) ?? state.current.unfiled;
    file(target, record, names);
    if (notes[record.k]) target.notes[record.k] = notes[record.k];
  }
}

function newSession({ name = "", no, start }) {
  return { id: foundry.utils.randomID(), no, name: String(name ?? "").trim().slice(0, 80), start, end: null, last: start, ...emptyBucket() };
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

  /** Record key -> stored JSON, built on first use. */
  static index() {
    if (this.known) return this.known;
    this.known = new Map();
    for (const bucket of [...allSessions(), readCurrent().unfiled]) {
      for (const [key, record] of Object.entries(bucket.records ?? {})) this.known.set(key, JSON.stringify(record));
    }
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
    return mutate(state => place(state, records, names));
  }

  /** Rolls posted while this GM was away: everything after the newest record. */
  static catchUp() {
    if (!this.active()) return;
    let newest = 0;
    for (const bucket of [...allSessions(), readCurrent().unfiled]) {
      for (const record of Object.values(bucket.records ?? {})) newest = Math.max(newest, record.t);
    }
    if (!newest) return;
    for (const message of game.messages.contents) if ((message.timestamp ?? 0) >= newest - 60000) this.observe(message, { prompt: false });
  }
}

/* Sessions (GM) -------------------------------------------------------------------------------------- */

/** The last moment anything happened in the session in play, or null without one. */
export function lastActivity() {
  const { session } = readCurrent();
  return session ? Math.max(session.start ?? 0, session.last ?? 0) : null;
}

/** At login: ask the GM about tonight's session unless one is clearly in play. */
function askAboutSession() {
  if (!Recorder.active() || !game.settings.get(MODULE_ID, ASK) || !apps.SessionDialog) return;
  const last = lastActivity();
  if (last !== null && Date.now() - last < IDLE_MS) return;
  new apps.SessionDialog({ login: true }).render({ force: true });
}

export function openSessionDialog(options = {}) {
  if (!apps.SessionDialog || !game.user.isGM) return null;
  const dialog = new apps.SessionDialog(options);
  dialog.render({ force: true });
  return dialog;
}

export function openRecapDialog(options = {}) {
  if (!apps.RecapDialog || !game.user.isGM) return null;
  const dialog = new apps.RecapDialog(options);
  dialog.render({ force: true });
  return dialog;
}

/** Start a session; the one in play ends at its last roll (or where the new one starts). */
export async function startSession({ name = "", no = nextNumber(), start = Date.now() } = {}) {
  await Recorder.flush();
  const result = await mutate(state => {
    const previous = state.current.session;
    if (previous) {
      previous.end = Math.max(previous.start, Math.min(previous.last ?? previous.start, start - 1));
      state.archive.push(previous);
    }
    state.current.session = newSession({ name, no, start });
    refile(state);
    return state.current.session.id;
  });
  Recorder.reset();
  return result;
}

/** Carry on with a session: the one in play, or a finished one reopened. */
export async function continueSession(id) {
  await Recorder.flush();
  await mutate(state => {
    if (state.current.session?.id === id) return;
    const index = state.archive.findIndex(session => session.id === id);
    if (index < 0) return;
    const [session] = state.archive.splice(index, 1);
    if (state.current.session) {
      const previous = state.current.session;
      previous.end = Math.max(previous.start, previous.last ?? previous.start);
      state.archive.push(previous);
    }
    session.end = null;
    state.current.session = session;
    refile(state);
  });
  Recorder.reset();
}

export async function endSession() {
  await Recorder.flush();
  return mutate(state => {
    const session = state.current.session;
    if (!session) return false;
    session.end = Math.max(session.start, Date.now());
    state.archive.push(session);
    state.current.session = null;
    return true;
  });
}

/** Change a session's name, number or times; changed times re-file the rolls. */
export async function updateSession(id, data = {}) {
  await Recorder.flush();
  await mutate(state => {
    const session = state.current.session?.id === id ? state.current.session : state.archive.find(entry => entry.id === id);
    if (!session) return;
    if ("name" in data) session.name = String(data.name ?? "").trim().slice(0, 80);
    if (Number.isFinite(data.no) && data.no > 0) session.no = Math.round(data.no);
    let moved = false;
    if (Number.isFinite(data.start) && data.start !== session.start) { moved = true; session.start = data.start; }
    if (session !== state.current.session && Number.isFinite(data.end) && data.end !== session.end) { moved = true; session.end = Math.max(session.start, data.end); }
    if (moved) refile(state);
  });
  Recorder.reset();
}

export async function deleteSession(id) {
  await Recorder.flush();
  await mutate(state => {
    if (state.current.session?.id === id) state.current.session = null;
    else state.archive = state.archive.filter(entry => entry.id !== id);
  });
  Recorder.reset();
}

/** How many rolls a session holds now, and would hold with other times: for the editor's preview. */
export function previewRefile(id, start, end) {
  const now = allSessions();
  const sessions = now.map(session => session.id === id ? { ...session, start, end: session.live ? null : end } : session);
  let count = 0;
  for (const bucket of [...now, readCurrent().unfiled]) {
    for (const record of Object.values(bucket.records ?? {})) if (sessionAt(sessions, record.t)?.id === id) count++;
  }
  return { count, before: Object.keys(now.find(session => session.id === id)?.records ?? {}).length };
}

export async function setNote(key, text) {
  await Recorder.flush();
  const note = String(text ?? "").trim().slice(0, NOTE_LIMIT);
  return mutate(state => {
    const bucket = holderOf(state, key);
    if (!bucket) return false;
    bucket.notes ??= {};
    if (note) bucket.notes[key] = note;
    else delete bucket.notes[key];
    return true;
  });
}

/**
 * Read the whole chat log in. Rolls already recorded are skipped; the rest are filed by time into the
 * sessions that cover them. Rolls outside every session form new sessions, split at four-hour breaks;
 * every session is then numbered in date order.
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
  await mutate(state => {
    const sessions = [...(state.current.session ? [state.current.session] : []), ...state.archive];
    let made = null;
    for (const record of fresh.sort((a, b) => a.t - b.t)) {
      let target = sessionAt(sessions, record.t);
      if (!target) {
        if (!made || record.t - made.end > IMPORT_GAP_MS) {
          made = newSession({ name: tr("ImportedName", { date: new Date(record.t).toLocaleDateString(game.i18n.lang, { dateStyle: "medium" }) }), no: 0, start: record.t });
          made.end = record.t;
          state.archive.push(made);
          sessions.push(made);
        }
        made.end = Math.max(made.end, record.t);
        target = made;
      }
      file(target, record, names);
    }
    [...sessions].sort((a, b) => a.start - b.start).forEach((session, index) => { session.no = index + 1; });
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

export function toolName(key) {
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

export function userName(id, buckets = []) {
  const user = game.users.get(id);
  if (user) return user.name;
  for (const bucket of buckets) if (bucket.users?.[id]?.n) return bucket.users[id].n;
  return tr("Unknown");
}

export function actorName(id, buckets = []) {
  const actor = game.actors.get(id);
  if (actor) return actor.name;
  for (const bucket of buckets) if (bucket.actors?.[id]) return bucket.actors[id];
  return tr("Unknown");
}

/** A character's role: the class they have the most levels in. */
export function roleOf(actorId) {
  const actor = actorId ? game.actors.get(actorId) : null;
  const classes = Object.values(actor?.classes ?? {});
  if (!classes.length) return "";
  classes.sort((a, b) => (b.system?.levels ?? 0) - (a.system?.levels ?? 0));
  return classes[0].name ?? "";
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
      const fresh = Date.now() - added < 1000 ? " is-arriving" : "";
      return `<form class="hwrt-prompt is-nat${nat}${fresh}" data-key="${escapeHTML(record.k)}" autocomplete="off">
        <header>
          <span class="hwrt-prompt-badge">${escapeHTML(tr(nat === 20 ? "Nat20" : "Nat1"))}</span>
          <span class="hwrt-prompt-who">${escapeHTML(actor || user)}${actor && actor !== user ? ` <small>${escapeHTML(user)}</small>` : ""}</span>
          <button type="button" class="hwrt-prompt-x" data-prompt-action="skip" data-tooltip="${escapeHTML(tr("Skip"))}" aria-label="${escapeHTML(tr("Skip"))}"><i class="fas fa-xmark" inert></i></button>
        </header>
        <div class="hwrt-prompt-what">${escapeHTML(title)}${result ? ` · <span>${escapeHTML(result)}</span>` : ""}</div>
        <div class="hwrt-prompt-row">
          <input type="text" name="note" maxlength="${NOTE_LIMIT}" placeholder="${escapeHTML(tr(nat === 20 ? "AskNat20" : "AskNat1"))}" aria-label="${escapeHTML(tr("NoteLabel"))}">
          <button type="submit" data-tooltip="${escapeHTML(tr("SaveNote"))}" aria-label="${escapeHTML(tr("SaveNote"))}"><i class="fas fa-check" inert></i></button>
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
