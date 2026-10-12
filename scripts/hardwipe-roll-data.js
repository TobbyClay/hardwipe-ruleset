/**
 * Roll Tracker data. Chat messages become compact roll records, and records become statistics.
 * Everything here works on plain data, so the tests run it without Foundry.
 *
 * A record's short keys:
 *   k key (message id, kind and index)   t timestamp   u player it counts for   b user who rolled
 *   a actor id   c kind   n natural d20 kept   m 1 advantage, -1 disadvantage   v total
 *   x DC or AC   o 1 success or hit, 0 failure or miss   r 1 critical   i item name   y item type
 *   l spell level   s ability, skill or tool key   d damage type   f dice rolled by faces   p 1 not public
 *   w d20 faces dropped by advantage or disadvantage   e Hardwipe event (downed, flatlined, edge)
 */

/** Kinds that roll a d20. */
export const D20_KINDS = new Set(["atk", "save", "death", "conc", "check", "skill", "tool", "init", "d20"]);
const SAVE_KINDS = new Set(["save", "death", "conc"]);
const CHECK_KINDS = new Set(["check", "skill", "tool"]);
const EVENTS = new Set(["downed", "flatlined", "edge"]);
const HEALING = new Set(["healing", "temphp"]);
const MODULE = "hardwipe-ruleset";

/** The kept d20 of a plain roll: { n, m, r, fumble, faces[] } or null. */
export function readD20(roll) {
  const die = (roll.dice ?? []).find(term => term.faces === 20);
  if (!die?.results?.length) return null;
  const kept = die.results.filter(result => result.a);
  const n = kept.length === 1 ? kept[0].v : null;
  let m = Number(roll.options?.advantageMode) || 0;
  if (!m && die.results.length > 1 && kept.length === 1) m = n === Math.max(...die.results.map(result => result.v)) ? 1 : -1;
  const crit = Number(roll.options?.criticalSuccess) || 20;
  const fumble = Number(roll.options?.criticalFailure) || 1;
  const dropped = die.results.filter(result => !result.a).map(result => result.v);
  return { n, m: Math.sign(m), r: n !== null && n >= crit, fumble: n !== null && n <= fumble, dropped };
}

function diceFaces(roll) {
  const out = {};
  for (const term of roll.dice ?? []) {
    if (!term.faces || !term.results?.length) continue;
    out[term.faces] = (out[term.faces] ?? 0) + term.results.length;
  }
  return out;
}

function numberOr(value, fallback = null) {
  const parsed = Number(value);
  return value === null || value === undefined || value === "" || !Number.isFinite(parsed) ? fallback : parsed;
}

/** What one roll in a message counts as. */
function rollKind(message, roll) {
  const system = message.system ?? {};
  const midi = roll.options?.["midi-qol"]?.rollType;
  const rollType = roll.options?.rollType;
  const damage = roll.kind === "damage" || rollType === "damage" || rollType === "healing" || midi === "defaultDamage" || midi === "otherDamage" || midi === "bonusDamage";
  if (damage) {
    const types = [roll.options?.type, ...(roll.options?.types ?? [])].filter(Boolean);
    return rollType === "healing" || (types.length && types.every(type => HEALING.has(type))) ? "heal" : "dmg";
  }
  if (message.type === "save") return system.type === "death" ? "death" : system.type === "concentration" ? "conc" : "save";
  if (message.type === "check") {
    if (system.type === "initiative") return "init";
    return system.skill ? "skill" : system.tool ? "tool" : "check";
  }
  if (message.flags?.core?.initiativeRoll) return "init";
  if (midi === "attack" || rollType === "attack") return "atk";
  if (message.type === "hitDie" || rollType === "hitDie") return "hd";
  if (message.type === "usage" && roll.kind === "d20") return "atk";
  return (roll.dice ?? []).some(term => term.faces === 20) ? "d20" : "roll";
}

function attackOutcome(message) {
  const midi = message.flags?.["midi-qol"] ?? {};
  if (Array.isArray(midi.resolvedTargetACs) && midi.resolvedTargetACs.length) {
    return { o: midi.resolvedTargetACs.some(entry => entry.isHit) ? 1 : 0, x: numberOr(midi.resolvedTargetACs[0].targetACWithoutCover) };
  }
  if (Array.isArray(midi.targets) && midi.targets.length && Array.isArray(midi.hitTargetUuids)) return { o: midi.hitTargetUuids.length ? 1 : 0, x: null };
  return { o: null, x: null };
}

/**
 * The records one chat message holds. `message` is plain data: { id, type, timestamp, author, speaker,
 * whisper, blind, system, flags, rolls }, each roll { kind: "d20"|"damage"|"", options, total,
 * dice: [{ faces, results: [{ v, a }] }] }. `userFor(actorId, authorId)` picks the player a roll counts for.
 */
export function extractRecords(message, { userFor = (actor, author) => author } = {}) {
  const system = message.system ?? {};
  const own = message.flags?.[MODULE] ?? {};
  const actorId = message.speaker?.actor || own.actorId || null;
  const base = { t: numberOr(message.timestamp, 0), u: userFor(actorId, message.author) ?? message.author ?? null, b: message.author ?? null, a: actorId };
  if ((message.whisper?.length ?? 0) > 0 || message.blind) base.p = 1;
  const records = [];
  const push = (key, data) => records.push(clean({ k: `${message.id}.${key}`, ...base, ...data }));

  if (message.type === "usage" && system.item?.name) {
    const spell = system.item.type === "spell";
    push("use", { c: "use", i: system.item.name, y: system.item.type ?? "", l: spell ? numberOr(system.level, 0) : null });
  }
  const event = own.type === "hardwipe-death" ? "flatlined" : own.kind;
  if (EVENTS.has(event) && (own.type === "hardwipe-card" || own.type === "hardwipe-death")) push("evt", { c: "evt", e: event });

  const seen = {};
  const itemName = system.item?.name ?? null;
  for (const roll of message.rolls ?? []) {
    const c = rollKind(message, roll);
    const index = seen[c] = (seen[c] ?? -1) + 1;
    const data = { c, v: numberOr(roll.total, 0), f: diceFaces(roll) };
    if (D20_KINDS.has(c)) {
      const d20 = readD20(roll);
      if (d20) Object.assign(data, { n: d20.n, m: d20.m || null, r: d20.r ? 1 : null, w: d20.dropped.length ? d20.dropped : null });
      if (c === "atk") {
        const outcome = attackOutcome(message);
        data.x = numberOr(roll.options?.target, outcome.x);
        data.o = outcome.o;
        data.i = itemName;
        if (d20?.fumble && data.o === null) data.o = 0;
      } else {
        data.x = numberOr(roll.options?.target, c === "death" ? 10 : null);
        if (data.x !== null) data.o = data.v >= data.x ? 1 : 0;
        data.s = c === "skill" ? system.skill : c === "tool" ? system.tool : system.ability ?? null;
      }
    } else if (c === "dmg" || c === "heal") {
      data.d = roll.options?.type ?? roll.options?.types?.[0] ?? null;
      data.r = roll.options?.isCritical ? 1 : null;
      data.i = itemName;
    } else if (itemName) data.i = itemName;
    push(`${c}.${index}`, data);
  }
  return records;
}

function clean(record) {
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value === null || value === undefined || value === "" || (typeof value === "object" && !Object.keys(value).length)) delete record[key];
  }
  return record;
}

// --- Statistics -------------------------------------------------------------------------------

const D20_SD = Math.sqrt((20 * 20 - 1) / 12);

function bump(map, key, by = 1) { if (key !== undefined && key !== null && key !== "") map[key] = (map[key] ?? 0) + by; }

/** Everything the window shows for one set of records. */
export function summarize(records) {
  const sorted = [...records].sort((a, b) => a.t - b.t || String(a.k).localeCompare(String(b.k)));
  const s = {
    records: sorted.length, rolls: 0, dice: {}, diceTotal: 0, first: null, last: null, actors: {},
    d20: { n: 0, sum: 0, hist: new Array(21).fill(0), raw: new Array(21).fill(0), nat20: 0, nat1: 0, adv: 0, dis: 0, hot: 0, cold: 0, timeline: [] },
    atk: { n: 0, hit: 0, miss: 0, crit: 0, fumble: 0 },
    dmg: { n: 0, total: 0, max: 0, maxItem: "", byType: {}, crit: 0 },
    heal: { n: 0, total: 0 },
    cast: { n: 0, byLevel: new Array(10).fill(0), bySpell: {}, leveled: 0 },
    use: { n: 0, byItem: {} },
    save: { n: 0, made: 0, known: 0, byAbility: {} },
    death: { n: 0, made: 0 }, conc: { n: 0, made: 0, known: 0 },
    check: { n: 0, made: 0, known: 0, bySkill: {} },
    init: { n: 0, sum: 0, best: null },
    evt: { downed: 0, flatlined: 0, edge: 0 }
  };
  let hot = 0, cold = 0;
  for (const record of sorted) {
    s.first ??= record.t;
    s.last = record.t;
    if (record.a) bump(s.actors, record.a);
    if (record.c === "use") {
      s.use.n++;
      bump(s.use.byItem, record.i);
      if (record.y === "spell") {
        s.cast.n++;
        const level = Math.min(Math.max(Number(record.l) || 0, 0), 9);
        s.cast.byLevel[level]++;
        if (level > 0) s.cast.leveled++;
        bump(s.cast.bySpell, record.i);
      }
      continue;
    }
    if (record.c === "evt") { if (record.e in s.evt) s.evt[record.e]++; continue; }
    s.rolls++;
    for (const [faces, count] of Object.entries(record.f ?? {})) { bump(s.dice, faces, count); s.diceTotal += count; }
    if (D20_KINDS.has(record.c) && Number.isFinite(record.n)) {
      const n = record.n;
      s.d20.n++;
      s.d20.sum += n;
      s.d20.hist[n]++;
      if (n === 20) s.d20.nat20++;
      if (n === 1) s.d20.nat1++;
      if (record.m === 1) s.d20.adv++;
      if (record.m === -1) s.d20.dis++;
      s.d20.timeline.push([record.t, n, record.k]);
      hot = n >= 11 ? hot + 1 : 0;
      cold = n <= 10 ? cold + 1 : 0;
      s.d20.hot = Math.max(s.d20.hot, hot);
      s.d20.cold = Math.max(s.d20.cold, cold);
    }
    // Every d20 face rolled, dropped dice included, for the fairness test.
    if (D20_KINDS.has(record.c) && Number.isFinite(record.n)) {
      s.d20.raw[record.n]++;
      for (const face of Array.isArray(record.w) ? record.w : []) if (face >= 1 && face <= 20) s.d20.raw[face]++;
    }
    switch (record.c) {
      case "atk":
        s.atk.n++;
        if (record.o === 1) s.atk.hit++;
        if (record.o === 0) s.atk.miss++;
        if (record.r) s.atk.crit++;
        if (record.n === 1) s.atk.fumble++;
        break;
      case "dmg":
        s.dmg.n++;
        s.dmg.total += record.v ?? 0;
        if ((record.v ?? 0) > s.dmg.max) { s.dmg.max = record.v; s.dmg.maxItem = record.i ?? ""; }
        bump(s.dmg.byType, record.d ?? "none", record.v ?? 0);
        if (record.r) s.dmg.crit++;
        break;
      case "heal": s.heal.n++; s.heal.total += record.v ?? 0; break;
      case "save":
        s.save.n++;
        if (record.o !== undefined) {
          s.save.known++;
          if (record.o === 1) s.save.made++;
          const entry = s.save.byAbility[record.s ?? "?"] ??= { n: 0, made: 0 };
          entry.n++;
          if (record.o === 1) entry.made++;
        }
        break;
      case "death": s.death.n++; if (record.o === 1) s.death.made++; break;
      case "conc": s.conc.n++; if (record.o !== undefined) { s.conc.known++; if (record.o === 1) s.conc.made++; } break;
      case "check": case "skill": case "tool":
        s.check.n++;
        if (record.o !== undefined) { s.check.known++; if (record.o === 1) s.check.made++; }
        if (record.c !== "check") bump(s.check.bySkill, `${record.c}:${record.s}`);
        break;
      case "init":
        s.init.n++;
        s.init.sum += record.v ?? 0;
        s.init.best = Math.max(s.init.best ?? -Infinity, record.v ?? 0);
        break;
    }
  }
  s.d20.avg = s.d20.n ? s.d20.sum / s.d20.n : null;
  s.d20.luck = s.d20.n ? (s.d20.avg - 10.5) / (D20_SD / Math.sqrt(s.d20.n)) : null;
  s.atk.rate = s.atk.hit + s.atk.miss ? s.atk.hit / (s.atk.hit + s.atk.miss) : null;
  s.save.rate = s.save.known ? s.save.made / s.save.known : null;
  s.check.rate = s.check.known ? s.check.made / s.check.known : null;
  s.init.avg = s.init.n ? s.init.sum / s.init.n : null;
  const rawN = s.d20.raw.reduce((sum, value) => sum + value, 0);
  s.d20.rawN = rawN;
  s.d20.fair = rawN ? chiSquareP(s.d20.raw.slice(1)) : null;
  return s;
}

/** Chi-square goodness of fit against a fair die: the p-value. */
export function chiSquareP(counts) {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  const expected = total / counts.length;
  const x2 = counts.reduce((sum, value) => sum + (value - expected) ** 2 / expected, 0);
  return 1 - lowerGamma((counts.length - 1) / 2, x2 / 2);
}

/** Regularized lower incomplete gamma P(a, x). */
function lowerGamma(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a, term = sum;
    for (let n = 1; n < 500; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-12) break; }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // Continued fraction for the upper tail.
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

function logGamma(z) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const coefficient of g) ser += coefficient / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/**
 * Superlatives across entities: [{ id, entities, value, detail, runner: { entities, value } | null }]. Ties
 * share the award; the runner-up is the next distinct score. Entities need enough rolls for the averages
 * and rates to mean something.
 */
export function awards(entries) {
  const out = [];
  const same = (a, b) => Math.abs(a - b) < 1e-9;
  const pick = (id, score, { min = () => true, lowest = false, detail = () => "", floor = 0 } = {}) => {
    const scored = entries.filter(entry => min(entry.stats)).map(entry => ({ entry, value: score(entry.stats) }))
      .filter(item => Number.isFinite(item.value) && (lowest || item.value > floor));
    if (!scored.length) return;
    const values = [...new Set(scored.map(item => item.value))].sort((a, b) => lowest ? a - b : b - a);
    const holders = value => scored.filter(item => same(item.value, value)).map(item => item.entry.id);
    const winners = scored.filter(item => same(item.value, values[0]));
    out.push({
      id, entities: holders(values[0]), value: values[0], detail: detail(winners[0].entry.stats),
      runner: values.length > 1 ? { entities: holders(values[1]), value: values[1] } : null
    });
  };
  const enough = stats => stats.d20.n >= 10;
  pick("golden", stats => stats.d20.avg, { min: enough });
  pick("cursed", stats => stats.d20.avg, { min: enough, lowest: true });
  pick("crits", stats => stats.d20.nat20);
  pick("fumbles", stats => stats.d20.nat1);
  pick("heavy", stats => stats.dmg.total);
  pick("biggest", stats => stats.dmg.max, { detail: stats => stats.dmg.maxItem });
  pick("sharpshooter", stats => stats.atk.rate, { min: stats => stats.atk.hit + stats.atk.miss >= 3 });
  pick("spells", stats => stats.cast.n);
  pick("will", stats => stats.save.rate, { min: stats => stats.save.known >= 3 });
  pick("smooth", stats => stats.check.rate, { min: stats => stats.check.known >= 3 });
  pick("medic", stats => stats.heal.total);
  pick("quick", stats => stats.init.avg, { min: stats => stats.init.n >= 2 });
  pick("hot", stats => stats.d20.hot, { min: stats => stats.d20.hot >= 3 });
  pick("cold", stats => stats.d20.cold, { min: stats => stats.d20.cold >= 3 });
  pick("busy", stats => stats.rolls);
  pick("downed", stats => stats.evt.downed + stats.evt.flatlined);
  return out;
}
