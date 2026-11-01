/**
 * Roll rules: the advantage, disadvantage and blocks in force on a character right now, and how Hardwipe adds its own.
 *
 * Three things put a roll mode on a character: Midi flags on its applied Active Effects
 * (`flags.midi-qol.advantage.attack.rwak` and its families, `grants` for rolls against it), D&D5e's own roll mode
 * fields (set by conditions through the system's condition table, by armor, by Remarkable Athlete, or by effects),
 * and rules Hardwipe registers in code. The panel lists only what is in force: switched-off flags, idle
 * registered rules and unattributed generic rows are left out, and one cause across several abilities or skills
 * is one row. The registry also adds named sources to Midi's tracker when an attack is evaluated, so a rule
 * written as code shows up in the roll mode scan. The model functions carry no Foundry dependency.
 */
const ID = "hardwipe-ruleset";
const PREFIX = "flags.midi-qol.";
const FAMILIES = { advantage: "ADV", disadvantage: "DIS", noAdvantage: "NOADV", noDisadvantage: "NODIS" };
const ORDER = { ADV: 0, DIS: 1, NOADV: 2, NODIS: 3 };
const ALWAYS = Object.freeze({ always: true, never: false, text: "" });
export const RULE_TYPES = new Set(Object.values(FAMILIES));

/** English wording; the sheet passes localized strings and D&D5e's ability and skill names instead. */
export const DEFAULT_LABELS = Object.freeze({
  everything: "Every d20 roll", attacks: "All attacks", attacksWith: "Attacks with {ability}",
  attackTypes: { mwak: "Melee weapon attacks", rwak: "Ranged weapon attacks", msak: "Melee spell attacks", rsak: "Ranged spell attacks" },
  abilityRolls: "Ability checks and saves", abilityWith: "{ability} checks and saves", checks: "Ability checks", checkWith: "{ability} checks",
  saves: "Saving throws", saveWith: "{ability} saves", skills: "Skill checks", skillWith: "{skill} checks",
  deathSaves: "Death saves", concentration: "Concentration saves", tools: "Tool checks", initiative: "Initiative",
  actorFlag: "Set on the character directly", sheetMode: "Sheet roll mode",
  targetHas: "the target is {status}", youHave: "you are {status}", targetIs: "the target is {what}", youAre: "you are {what}", itemIs: "the item is a {what}",
  and: " and ", or: " or ", lang: "en", abilityNames: {}, skillNames: {}
});

const fill = (text, data = {}) => String(text ?? "").replace(/\{(\w+)\}/g, (match, key) => key in data ? String(data[key]) : match);

function merge(labels = {}) {
  return { ...DEFAULT_LABELS, ...labels, attackTypes: { ...DEFAULT_LABELS.attackTypes, ...(labels.attackTypes ?? {}) },
    abilityNames: { ...(labels.abilityNames ?? {}) }, skillNames: { ...(labels.skillNames ?? {}) } };
}

function joinList(items, lang) {
  try { return new Intl.ListFormat(lang || "en", { type: "conjunction" }).format(items); }
  catch { return items.join(", "); }
}

/** Parse a Midi flag key into { grants, type, scope }, or null when it does not set a roll mode. */
export function parseRuleKey(key) {
  if (typeof key !== "string" || !key.startsWith(PREFIX)) return null;
  const parts = key.slice(PREFIX.length).split(".").filter(Boolean);
  const grants = parts[0] === "grants";
  if (grants) parts.shift();
  const type = FAMILIES[parts.shift()];
  if (!type) return null;
  return { grants, type, scope: parts.join(".") || "all" };
}

/** The rolls a scope covers, in words: "attack.rwak" reads "Ranged weapon attacks". */
export function describeScope(scope, labels = {}) {
  const L = merge(labels);
  const named = (map, id) => L[map]?.[id] ?? id;
  const [head, ...rest] = String(scope ?? "all").split(".");
  const sub = rest[0] ?? "all";
  switch (head) {
    case "all": return L.everything;
    case "attack":
      if (sub === "all") return L.attacks;
      if (L.attackTypes?.[sub]) return L.attackTypes[sub];
      return fill(L.attacksWith, { ability: named("abilityNames", sub) });
    case "ability":
      if (sub === "all") return L.abilityRolls;
      if (sub === "check") return rest[1] && rest[1] !== "all" ? fill(L.checkWith, { ability: named("abilityNames", rest[1]) }) : L.checks;
      if (sub === "save") return rest[1] && rest[1] !== "all" ? fill(L.saveWith, { ability: named("abilityNames", rest[1]) }) : L.saves;
      return fill(L.abilityWith, { ability: named("abilityNames", sub) });
    case "check": return sub === "all" ? L.checks : fill(L.checkWith, { ability: named("abilityNames", sub) });
    case "save": return sub === "all" ? L.saves : fill(L.saveWith, { ability: named("abilityNames", sub) });
    case "skill": return sub === "all" ? L.skills : fill(L.skillWith, { skill: named("skillNames", sub) });
    case "tool": return L.tools;
    case "deathSave": return L.deathSaves;
    case "concentration": return L.concentration;
    case "initiative": case "init": return L.initiative;
    default: return String(scope);
  }
}

/** When a flag fires: 1 or true is always, 0 or false never, anything else a condition Midi evaluates. */
export function describeWhen(value, labels = {}) {
  const text = String(value ?? "").trim();
  const lower = text.toLowerCase();
  if (!text || lower === "1" || lower === "true") return ALWAYS;
  if (lower === "0" || lower === "false") return { always: false, never: true, text: "" };
  return { always: false, never: false, text: glossCondition(text, labels), expression: text };
}

const GLOSSES = [
  [/^target\.statuses\.has\(["']([\w-]+)["']\)$/, (m, L) => fill(L.targetHas, { status: m[1] })],
  [/^(?:actor\.|rollData\.)?statuses\.has\(["']([\w-]+)["']\)$/, (m, L) => fill(L.youHave, { status: m[1] })],
  [/^target\.raceOrType\s*===?\s*["']([\w-]+)["']$/, (m, L) => fill(L.targetIs, { what: m[1] })],
  [/^raceOrType\s*===?\s*["']([\w-]+)["']$/, (m, L) => fill(L.youAre, { what: m[1] })],
  [/^item\.type\s*===?\s*["']([\w-]+)["']$/, (m, L) => fill(L.itemIs, { what: m[1] })]
];

/** A few common Midi condition shapes in words; anything else is shown as written. */
export function glossCondition(expression, labels = {}) {
  const L = merge(labels);
  const clause = text => {
    const trimmed = text.trim().replace(/^\((.*)\)$/, "$1").trim();
    for (const [pattern, make] of GLOSSES) {
      const match = trimmed.match(pattern);
      if (match) return make(match, L);
    }
    return trimmed;
  };
  return String(expression).split(/\|\|/).map(part => part.split(/&&/).map(clause).join(L.and)).join(L.or);
}

/**
 * The Midi roll-mode rules in force from a character's effects. `effects` are plain:
 * [{ name, source, disabled, changes: [{ key, value }] }]. Switched-off effects and flags set to 0 or false are
 * left out. A row: { type, grants, scope, name, source, when }.
 */
export function catalogue(effects = []) {
  const rows = [];
  for (const effect of effects) {
    if (effect?.disabled) continue;
    for (const change of effect?.changes ?? []) {
      const rule = parseRuleKey(change?.key);
      const when = rule && describeWhen(change.value);
      if (!rule || when.never) continue;
      rows.push({ ...rule, name: String(effect.name ?? ""), source: String(effect.source ?? ""), when: { ...when } });
    }
  }
  return rows;
}

/** Midi flags written straight onto the actor (not through an effect). `flags` is `flags["midi-qol"]`. */
export function flagRows(flags, labels = {}) {
  const L = merge(labels);
  const rows = [];
  const walk = (node, path) => {
    if (node === null || node === undefined) return;
    if (typeof node === "object" && !Array.isArray(node)) {
      for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
      return;
    }
    const rule = parseRuleKey(path);
    const when = rule && describeWhen(node);
    if (!rule || when.never) return;
    rows.push({ ...rule, name: L.actorFlag, source: "", when: { ...when } });
  };
  walk(flags ?? {}, "flags.midi-qol");
  return rows;
}

/**
 * Which entries of D&D5e's condition table are in force, each with the conditions behind it, mirroring the
 * system's `hasConditionEffect`. `table` is CONFIG.DND5E.conditionEffects (sets of "status" or "status-level");
 * `snapshot` is { statuses, immunities, levels: system.conditions, leveled: statuses that have levels }.
 * `nameOf(status, level)` names a condition; a leveled one is named at the character's own level.
 */
export function conditionsInForce(table = {}, snapshot = {}, nameOf = (status, level) => level ? `${status} ${level}` : status) {
  const statuses = new Set(snapshot.statuses ?? []);
  const immune = new Set(snapshot.immunities ?? []);
  const leveled = new Set(snapshot.leveled ?? []);
  const levels = snapshot.levels ?? {};
  const holds = prop => {
    const [status, level] = String(prop).split("-");
    if (immune.has(status)) return false;
    if (status === "dodging") {
      if (statuses.has("incapacitated")) return false;
      if ([...(table.noMovement ?? [])].some(other => !String(other).startsWith("dodging") && holds(other))) return false;
    }
    if (!leveled.has(status) || !level) return statuses.has(status);
    return Number(level) <= (Number(levels[status]) || 0);
  };
  const out = {};
  for (const [key, props] of Object.entries(table)) {
    const names = [...(props ?? [])].filter(holds).map(prop => {
      const status = String(prop).split("-")[0];
      return nameOf(status, leveled.has(status) ? Number(levels[status]) || null : null);
    });
    if (names.length) out[key] = [...new Set(names)];
  }
  return out;
}

/**
 * Name what set each of D&D5e's own roll mode fields that is not straight. `system` is the actor's prepared
 * system data; `context`:
 *   conditions   the result of conditionsInForce
 *   effects      { "system.abilities.dex.save.roll.mode": [{ name, value, mode }] } from applied effects; `mode`
 *                marks a feature mode, whose rules the panel lists under the mode instead
 *   physical     the physical ability ids
 *   stealthArmor the equipped armor's name when it imposes stealth disadvantage
 *   athlete      { name, skills, initiative } when Remarkable Athlete applies
 *   fallback     the name for a mode nothing explains
 * Returns rows { type, grants, scope, name, source, when }; one per field per cause.
 */
export function explainRollModes(system, context = {}) {
  const c = key => context.conditions?.[key] ?? [];
  const physical = new Set(context.physical ?? []);
  const rows = [];
  const push = (scope, path, mode, causes) => {
    const value = Math.sign(Number(mode) || 0);
    if (!value) return;
    const effects = (context.effects?.[path] ?? []).filter(effect => Math.sign(Number(effect.value) || 0) === value);
    const names = [...effects.filter(effect => !effect.mode).map(effect => effect.name), ...causes(value)];
    // A mode set only by a feature mode is listed under that mode.
    if (!names.length && effects.some(effect => effect.mode)) return;
    for (const name of names.length ? [...new Set(names)] : [context.fallback ?? DEFAULT_LABELS.sheetMode]) {
      rows.push({ type: value > 0 ? "ADV" : "DIS", grants: false, scope, name, source: "", when: ALWAYS });
    }
  };
  for (const [id, ability] of Object.entries(system?.abilities ?? {})) {
    push(`ability.check.${id}`, `system.abilities.${id}.check.roll.mode`, ability?.check?.roll?.mode,
      value => value < 0 ? [...c("abilityCheckDisadvantage"), ...(physical.has(id) ? c("physicalCheckDisadvantage") : [])] : []);
    push(`ability.save.${id}`, `system.abilities.${id}.save.roll.mode`, ability?.save?.roll?.mode,
      value => value > 0 ? (id === "dex" ? c("dexteritySaveAdvantage") : [])
        : [...c("abilitySaveDisadvantage"), ...(physical.has(id) ? c("physicalSaveDisadvantage") : []), ...(id === "dex" ? c("dexteritySaveDisadvantage") : [])]);
  }
  for (const [id, skill] of Object.entries(system?.skills ?? {})) {
    push(`skill.${id}`, `system.skills.${id}.roll.mode`, skill?.roll?.mode,
      value => value < 0 ? (id === "ste" && context.stealthArmor ? [context.stealthArmor] : []) : (context.athlete?.skills?.includes(id) ? [context.athlete.name] : []));
  }
  push("initiative", "system.attributes.init.roll.mode", system?.attributes?.init?.roll?.mode,
    value => value > 0 ? [...c("initiativeAdvantage"), ...(context.athlete?.initiative ? [context.athlete.name] : [])] : c("initiativeDisadvantage"));
  // Global modes only effects set.
  const rolls = system?.rolls?.ability ?? {};
  for (const [key, scope] of [["check", "ability.check.all"], ["save", "ability.save.all"], ["skill", "skill.all"], ["tool", "tool"]]) {
    push(scope, `system.rolls.ability.${key}.mode`, rolls[key]?.mode, () => []);
  }
  return rows;
}

/** The kind of roll a scope covers and which ability or skill: "*" for all of them, so "all checks" folds with per-ability rows. */
function scopeFamily(scope) {
  const parts = String(scope ?? "").split(".");
  if (parts[0] === "ability" && ["check", "save"].includes(parts[1])) return { family: `ability.${parts[1]}`, id: parts[2] && parts[2] !== "all" ? parts[2] : "*" };
  if (["check", "save"].includes(parts[0])) return { family: `ability.${parts[0]}`, id: parts[1] && parts[1] !== "all" ? parts[1] : "*" };
  if (parts[0] === "skill") return { family: "skill", id: parts[1] && parts[1] !== "all" ? parts[1] : "*" };
  return { family: null, id: null };
}

/**
 * One row per cause and kind of roll: Poisoned on all six ability checks reads "Poisoned · Ability checks", on
 * the physical three "Strength, Dexterity and Constitution checks". Adds `scopeText` and sorts own rules before
 * rules against the character, then advantage, disadvantage and blocks.
 */
export function foldRows(rows = [], labels = {}) {
  const L = merge(labels);
  const groups = new Map();
  for (const row of rows) {
    const { family, id } = scopeFamily(row.scope);
    const key = [row.grants ? 1 : 0, row.type, row.name, row.source ?? "", row.when?.expression ?? "", family ?? row.scope].join("\u0001");
    if (!groups.has(key)) groups.set(key, { row, family, ids: [] });
    if (id && !groups.get(key).ids.includes(id)) groups.get(key).ids.push(id);
  }
  const text = ({ row, family, ids }) => {
    if (!family) return describeScope(row.scope, L);
    const table = family === "skill" ? L.skillNames : L.abilityNames;
    const order = Object.keys(table);
    const all = ids.includes("*") || (order.length && order.every(key => ids.includes(key)));
    if (family === "skill") return all ? L.skills : fill(L.skillWith, { skill: joinList(sorted(ids, order).map(key => table[key] ?? key), L.lang) });
    const names = joinList(sorted(ids, order).map(key => table[key] ?? key), L.lang);
    if (family === "ability.check") return all ? L.checks : fill(L.checkWith, { ability: names });
    return all ? L.saves : fill(L.saveWith, { ability: names });
  };
  const folded = [...groups.values()].map(group => ({ ...group.row, scopeText: text(group) }));
  return folded.sort((a, b) => Number(a.grants) - Number(b.grants) || ORDER[a.type] - ORDER[b.type]
    || a.name.localeCompare(b.name) || a.scopeText.localeCompare(b.scopeText));
}

function sorted(ids, order) {
  const rank = id => { const index = order.indexOf(id); return index < 0 ? order.length : index; };
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Put one source on Midi's tracker: ADV and DIS add, NOADV and NODIS suppress that side. */
export function applyToTracker(tracker, type, id, label) {
  if (!tracker || !RULE_TYPES.has(type)) return false;
  const side = type === "ADV" || type === "NOADV" ? tracker.advantage : tracker.disadvantage;
  if (!side) return false;
  if (type === "NOADV" || type === "NODIS") side.suppress?.(id, label);
  else side.add?.(id, label);
  return true;
}

/**
 * Mode effects grouped by the feature (or the actor) that carries them. `entries` are plain:
 * [{ id, uuid, name, disabled, parentId, parentName, img, effect }], in sheet order. One group per parent,
 * with the active mode's id (at most one is meant to be on).
 */
export function modeGroups(entries = []) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.parentId)) groups.set(entry.parentId, { parentId: entry.parentId, parentName: entry.parentName ?? "", img: entry.img ?? "", activeId: null, modes: [] });
    const group = groups.get(entry.parentId);
    const active = !entry.disabled;
    group.modes.push({ id: entry.id, uuid: entry.uuid, name: entry.name, active, effect: entry.effect ?? null });
    if (active && !group.activeId) group.activeId = entry.id;
  }
  return [...groups.values()];
}

/**
 * The effect updates that switch one mode of a group on (`chosenId`), or every mode off (null): modes on the
 * same feature are exclusive, and nothing already in the right state is touched.
 */
export function planModeSwitch(group = [], chosenId = null) {
  const updates = [];
  for (const entry of group) {
    const disabled = entry.id !== chosenId;
    if (!!entry.disabled !== disabled) updates.push({ _id: entry.id, disabled });
  }
  return updates;
}

/** The rules one mode effect carries, Midi flags and D&D5e roll mode keys alike, for its panel group. */
export function modeRules(effect) {
  const rows = catalogue([{ ...effect, disabled: false }]);
  for (const change of effect?.changes ?? []) {
    const match = String(change?.key ?? "").match(/^system\.(abilities\.(\w+)\.(check|save)|skills\.(\w+)|attributes\.init|rolls\.ability\.(check|save|skill|tool))\.(?:roll\.)?mode$/);
    const value = Math.sign(Number(change?.value) || 0);
    if (!match || !value) continue;
    const scope = match[2] ? `ability.${match[3]}.${match[2]}` : match[4] ? `skill.${match[4]}` : match[5]
      ? ({ check: "ability.check.all", save: "ability.save.all", skill: "skill.all", tool: "tool" })[match[5]] : "initiative";
    rows.push({ type: value > 0 ? "ADV" : "DIS", grants: false, scope, name: String(effect.name ?? ""), source: "", when: ALWAYS });
  }
  return rows;
}

/**
 * Hardwipe's own attack sources. A registered rule is { id, name, rule, test(workflow), describe?, active? }:
 * `test` returns "ADV", "DIS", "NOADV" or "NODIS" to add a source (anything else adds nothing); `describe` is
 * { type, scope } and `active(actor)` says whether the rule is in force on a character now, which is the only
 * way a registered rule appears on the sheet. Macros and other modules can also answer the
 * "hardwipe.attackSources" hook with (workflow, add).
 */
export class RollRules {
  static _sources = new Map();
  static _initialized = false;

  static get api() {
    return {
      register: source => this.register(source), unregister: id => this.unregister(id), list: () => this.list(),
      catalogue: actor => this.sheetContext(actor), evaluate: workflow => this.evaluate(workflow),
      modes: actor => modeGroups(this.modeEffects(actor)), setMode: (actor, uuid, groupId) => this.setMode(actor, uuid, groupId)
    };
  }

  static register(source) {
    const { id, name, rule = "", test, describe = null, active = null } = source ?? {};
    if (typeof id !== "string" || !id.trim()) throw new Error("A roll rule needs an id.");
    if (typeof name !== "string" || !name.trim()) throw new Error(`Roll rule ${id} needs a name.`);
    if (typeof test !== "function") throw new Error(`Roll rule ${id} needs a test(workflow) function.`);
    const entry = Object.freeze({ id: id.trim(), name: name.trim(), rule: String(rule ?? "").trim(), test,
      describe: describe && typeof describe === "object" ? { ...describe } : null, active: typeof active === "function" ? active : null });
    this._sources.set(entry.id, entry);
    return entry;
  }

  static unregister(id) { return this._sources.delete(id); }
  static list() { return [...this._sources.values()]; }

  /** The sources the registered rules add for one workflow: [{ type, id, label }]. A rule that throws adds nothing. */
  static evaluate(workflow, sources = this.list()) {
    const out = [];
    for (const source of sources) {
      let verdict;
      try { verdict = source.test(workflow); }
      catch (error) { console.warn(`${ID} | Roll rule ${source.id} failed`, error); continue; }
      if (!RULE_TYPES.has(verdict)) continue;
      out.push({ type: verdict, id: `hardwipe:${source.id}`, label: source.rule ? `${source.name} - ${source.rule}` : source.name });
    }
    return out;
  }

  static initialize() {
    if (this._initialized) return;
    this._initialized = true;
    // Midi resets its tracker and asks before it reads flags; returning nothing keeps its evaluation going.
    Hooks.on("midi-qol.preCheckAttackAdvantage", workflow => { this._apply(workflow); });
  }

  static _apply(workflow) {
    const tracker = workflow?.attackRollModifierTracker;
    if (!tracker || !workflow.activity?.attack) return;
    const add = (type, id, label) => applyToTracker(tracker, type, String(id), String(label));
    for (const entry of this.evaluate(workflow)) add(entry.type, entry.id, entry.label);
    Hooks.callAll("hardwipe.attackSources", workflow, add);
  }

  /** Registered rules in force on an actor now, as rows. A rule without `active` cannot be known to apply and is left out. */
  static liveRows(actor) {
    const rows = [];
    for (const source of this.list()) {
      let live = false;
      try { live = !!source.active?.(actor); } catch { live = false; }
      if (!live) continue;
      rows.push({ type: RULE_TYPES.has(source.describe?.type) ? source.describe.type : "ADV", grants: false,
        scope: source.describe?.scope ?? "attack.all", name: source.name, source: "", when: ALWAYS });
    }
    return rows;
  }

  /** What the Roll rules panel shows for one actor: its feature modes, and the rules in force now. */
  static sheetContext(actor) {
    const labels = localizedLabels();
    const t = key => game.i18n.localize(`HARDWIPE.Rules.${key}`);
    const decorate = row => ({ ...row, ...ROW_STYLE[row.type], chip: game.i18n.localize(`HARDWIPE.Advisory.Mode.${CHIP[row.type]}`), detail: rowDetail(row), whenLabel: t("When") });
    const applied = [...(actor?.appliedEffects ?? [])];
    const rows = [
      ...catalogue(applied.filter(effect => !isMode(effect)).map(plainEffect)),
      ...flagRows(actor?._source?.flags?.["midi-qol"], labels),
      ...explainRollModes(actor?.system, systemContext(actor, applied, t("SheetMode"))),
      ...this.liveRows(actor)
    ];
    const folded = foldRows(rows, labels).map(decorate);
    const canToggle = !!actor?.isOwner;
    const modes = modeGroups(this.modeEffects(actor)).map(group => {
      const active = group.modes.find(mode => mode.active);
      return { ...group, canToggle, offLabel: t("ModeOff"), modes: group.modes.map(mode => ({ ...mode, canToggle, parentId: group.parentId })),
        rows: active ? foldRows(modeRules(active.effect), labels).map(row => decorate({ ...row, name: row.scopeText, scopeText: "", source: "" })) : [] };
    });
    const mine = folded.filter(row => !row.grants);
    const against = folded.filter(row => row.grants);
    return { show: !!(modes.length || mine.length || against.length), modes, mine, against, canToggle,
      labels: { title: t("Title"), against: t("Against"), when: t("When") } };
  }

  /** The actor's mode effects (the `mode` flag): on its features and items when transferred, and on the actor itself. */
  static modeEffects(actor) {
    const out = [];
    const push = (effect, parent, parentId, parentName, img) => out.push({
      id: effect.id, uuid: effect.uuid, name: effect.name, disabled: !!effect.disabled, parent, parentId, parentName, img,
      effect: { ...plainEffect(effect), source: parentName }
    });
    for (const effect of actor?.effects ?? []) if (isMode(effect)) push(effect, actor, "actor", actor.name, actor.img);
    for (const item of actor?.items ?? []) for (const effect of item.effects ?? []) if (effect.transfer && isMode(effect)) push(effect, item, item.id, item.name, item.img);
    return out;
  }

  /** Switch one mode on (by uuid) or every mode of a group off (uuid null): the owner or the GM only. */
  static async setMode(actor, uuid = null, groupId = null) {
    if (!actor?.isOwner) throw new Error(game.i18n.localize("HARDWIPE.Rules.NotOwner"));
    const effects = this.modeEffects(actor);
    const chosen = uuid ? effects.find(entry => entry.uuid === uuid) : null;
    if (uuid && !chosen) throw new Error(game.i18n.localize("HARDWIPE.Rules.ModeGone"));
    const group = effects.filter(entry => entry.parentId === (chosen?.parentId ?? groupId));
    const byParent = new Map();
    for (const change of planModeSwitch(group, chosen?.id ?? null)) {
      const entry = group.find(candidate => candidate.id === change._id);
      if (!byParent.has(entry.parent)) byParent.set(entry.parent, []);
      byParent.get(entry.parent).push(change);
    }
    for (const [parent, updates] of byParent) await parent.updateEmbeddedDocuments("ActiveEffect", updates);
    return byParent.size;
  }

  /**
   * A "Hardwipe mode" checkbox on the GM's Active Effect sheets. It joins the form only once ticked (or when the
   * effect already is a mode), so saving any other effect never writes a Hardwipe flag onto it.
   */
  static registerEffectConfig() {
    Hooks.on("renderActiveEffectConfig", (app, element) => {
      if (!game.user.isGM) return;
      const root = element?.querySelector ? element : element?.[0];
      const effect = app?.document;
      if (!root || !effect || root.querySelector(".hardwipe-mode-field")) return;
      const anchor = root.querySelector('input[name="disabled"]')?.closest(".form-group");
      if (!anchor) return;
      const t = key => game.i18n.localize(`HARDWIPE.Rules.${key}`);
      const doc = root.ownerDocument;
      const group = doc.createElement("div");
      group.className = "form-group hardwipe-mode-field";
      const label = doc.createElement("label");
      label.textContent = t("ModeFlag");
      const fields = doc.createElement("div");
      fields.className = "form-fields";
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.checked = isMode(effect);
      const named = () => {
        if (input.checked || isMode(effect)) input.name = `flags.${ID}.mode`;
        else input.removeAttribute("name");
      };
      named();
      input.addEventListener("change", named);
      fields.append(input);
      const hint = doc.createElement("p");
      hint.className = "hint";
      hint.textContent = t("ModeFlagHint");
      group.append(label, fields, hint);
      anchor.after(group);
    });
  }
}

const ROW_STYLE = {
  ADV: { kind: "adv", glyph: "fa-chevrons-up" }, DIS: { kind: "dis", glyph: "fa-chevrons-down" },
  NOADV: { kind: "block", glyph: "fa-ban" }, NODIS: { kind: "block", glyph: "fa-ban" }
};
const CHIP = { ADV: "Adv", DIS: "Dis", NOADV: "NoAdv", NODIS: "NoDis" };

const isMode = effect => effect?.getFlag?.(ID, "mode") === true;

/** The small line under a row's name: the rolls it covers, and the feature it comes from when that differs. */
function rowDetail(row) {
  const parts = [row.scopeText];
  if (row.source && row.source !== row.name) parts.push(row.source);
  return parts.filter(Boolean).join(" · ");
}

function plainEffect(effect) {
  return { name: effect.name, source: effectSource(effect), disabled: !!effect.disabled,
    changes: (effect.system?.changes ?? effect.changes ?? []).map(change => ({ key: change.key, value: change.value })) };
}

function effectSource(effect) {
  try {
    if (effect.parent?.documentName === "Item") return effect.parent.name ?? "";
    if (effect.origin) return globalThis.fromUuidSync?.(effect.origin)?.name ?? "";
  } catch { /* an origin that no longer resolves */ }
  return "";
}

/** What explainRollModes needs from a live actor. */
function systemContext(actor, applied, fallback) {
  const conditionTypes = CONFIG.DND5E?.conditionTypes ?? {};
  const leveled = Object.entries(conditionTypes).filter(([, config]) => Number.isFinite(config?.levels)).map(([key]) => key);
  const nameOf = (status, level) => {
    const base = game.i18n.localize(CONFIG.statusEffects?.find?.(entry => entry.id === status)?.name ?? conditionTypes[status]?.name ?? status);
    return level ? `${base} ${level}` : base;
  };
  const conditions = conditionsInForce(CONFIG.DND5E?.conditionEffects ?? {}, {
    statuses: [...(actor?.statuses ?? [])], immunities: [...(actor?.system?.traits?.ci?.value ?? [])],
    levels: actor?.system?.conditions ?? {}, leveled
  }, nameOf);
  const effects = {};
  for (const effect of applied) {
    for (const change of effect.system?.changes ?? effect.changes ?? []) {
      if (!/^system\..*\.mode$/.test(change.key ?? "")) continue;
      (effects[change.key] ??= []).push({ name: effect.name, value: change.value, mode: isMode(effect) });
    }
  }
  const armor = actor?.system?.attributes?.ac?.equippedArmor;
  const legacy = game.settings.get("dnd5e", "rulesVersion") === "legacy";
  const athlete = actor?.flags?.dnd5e?.remarkableAthlete && !legacy
    ? { name: game.i18n.localize(CONFIG.DND5E?.characterFlags?.remarkableAthlete?.name ?? "Remarkable Athlete"),
      skills: CONFIG.DND5E?.characterFlags?.remarkableAthlete?.skills ?? [], initiative: true } : null;
  return {
    conditions, effects, fallback,
    physical: Object.entries(CONFIG.DND5E?.abilities ?? {}).filter(([, config]) => config?.type === "physical").map(([key]) => key),
    stealthArmor: armor?.system?.properties?.has?.("stealthDisadvantage") ? armor.name : null,
    athlete
  };
}

function localizedLabels() {
  const t = key => game.i18n.localize(`HARDWIPE.Rules.${key}`);
  const names = table => Object.fromEntries(Object.entries(table ?? {}).map(([key, value]) => [key, game.i18n.localize(value?.label ?? String(value))]));
  return {
    everything: t("Scope.everything"), attacks: t("Scope.attacks"), attacksWith: t("Scope.attacksWith"),
    attackTypes: { mwak: t("Scope.mwak"), rwak: t("Scope.rwak"), msak: t("Scope.msak"), rsak: t("Scope.rsak") },
    abilityRolls: t("Scope.abilityRolls"), abilityWith: t("Scope.abilityWith"), checks: t("Scope.checks"), checkWith: t("Scope.checkWith"),
    saves: t("Scope.saves"), saveWith: t("Scope.saveWith"), skills: t("Scope.skills"), skillWith: t("Scope.skillWith"),
    deathSaves: t("Scope.deathSaves"), concentration: t("Scope.concentration"), tools: t("Scope.tools"), initiative: t("Scope.initiative"),
    actorFlag: t("ActorFlag"), sheetMode: t("SheetMode"),
    targetHas: t("Gloss.targetHas"), youHave: t("Gloss.youHave"), targetIs: t("Gloss.targetIs"), youAre: t("Gloss.youAre"), itemIs: t("Gloss.itemIs"),
    and: t("Gloss.and"), or: t("Gloss.or"), lang: game.i18n.lang,
    abilityNames: names(CONFIG.DND5E?.abilities), skillNames: names(CONFIG.DND5E?.skills)
  };
}
