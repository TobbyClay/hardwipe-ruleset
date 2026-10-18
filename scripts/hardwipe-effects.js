/**
 * Reading Active Effects for people: what an effect grants, as rows, and how long it lasts, as a ring.
 *
 * Any effect works, including the GM's own: its changes (key, type, value) are labelled where Hardwipe knows the key
 * (AC, speed, initiative, ability and skill bonuses, damage and attack bonuses, resistances, Ready Set Midi's advantage
 * flags), numbers read before → after against the actor, and an unknown key still shows, tidied, with its value.
 * Conditions the effect adds are rows too. A GM who wants different wording writes a bulleted list in the effect's
 * description: those bullets become the rows instead.
 *
 * The ring's length follows the duration on a log scale (a round is a sliver, a minute about a quarter, ten minutes
 * half, an hour two thirds, a day the whole ring); on the Turn tab it drains with the time left.
 */
const ROUND = 6;
const DAY = 86400;

/* Duration --------------------------------------------------------------------------------------- */

/** How much of the ring a duration of this many seconds takes: 0.06 for a round up to 1 for a day or longer. */
export function ringScale(seconds) {
  if (!Number.isFinite(seconds)) return 1;
  if (seconds <= ROUND) return 0.06;
  return Math.min(1, Math.max(0.06, Math.log10(seconds / ROUND) / Math.log10(DAY / ROUND)));
}

/**
 * The ring for an effect's duration: its total length, and the lit part (the whole length on a card, the time left
 * on the Turn tab). `seconds` and `secondsRemaining` are Foundry's prepared duration.
 * @returns {{length: number, lit: number, indefinite: boolean}}
 */
export function durationRing(seconds, secondsRemaining = seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return { length: 1, lit: 1, indefinite: true };
  const length = ringScale(seconds);
  const left = Number.isFinite(secondsRemaining) ? Math.max(0, Math.min(1, secondsRemaining / seconds)) : 1;
  return { length, lit: length * left, indefinite: false };
}

/* Changes ----------------------------------------------------------------------------------------- */

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const ATTACKS = { mwak: "Melee weapon", rwak: "Ranged weapon", msak: "Melee spell", rsak: "Ranged spell" };
const SPEEDS = { walk: "Speed", fly: "Fly speed", swim: "Swim speed", climb: "Climb speed", burrow: "Burrow speed" };
const TRAITS = { dr: "Resistance", di: "Immunity", dv: "Vulnerability", ci: "Condition immunity" };

/**
 * The label for a change's key, and where the number it changes can be read on an actor (for before → after).
 * @param {string} key
 * @param {{skills?: object}} [names]   Display names (dnd5e's skills), when available.
 * @returns {{label: string, read?: string, unit?: string}|null}
 */
export function changeLabel(key, names = {}) {
  let m;
  if (/^system\.attributes\.ac\.(bonus|value|flat|min|calc)$/.test(key)) return { label: "AC", read: "system.attributes.ac.value" };
  if ((m = /^system\.attributes\.movement\.(walk|fly|swim|climb|burrow)$/.exec(key))) return { label: SPEEDS[m[1]], read: key, unit: " ft" };
  if (key === "system.attributes.movement.all") return { label: "All speeds", unit: " ft" };
  if (key === "system.attributes.init.bonus") return { label: "Initiative", read: "system.attributes.init.total" };
  if (key === "system.attributes.hp.tempmax") return { label: "Max HP", read: "system.attributes.hp.max" };
  if (key === "system.attributes.hp.temp") return { label: "Temp HP" };
  if ((m = /^system\.attributes\.senses\.(?:ranges\.)?(darkvision|blindsight|tremorsense|truesight)$/.exec(key))) return { label: m[1].charAt(0).toUpperCase() + m[1].slice(1), read: key, unit: " ft" };
  if (key === "system.attributes.exhaustion") return { label: "Exhaustion", read: key };
  if ((m = /^system\.abilities\.(\w+)\.value$/.exec(key))) return { label: `${m[1].toUpperCase()} score`, read: key };
  if ((m = /^system\.abilities\.(\w+)\.bonuses\.(save|check)$/.exec(key))) return { label: `${m[1].toUpperCase()} ${m[2] === "save" ? "saves" : "checks"}` };
  if ((m = /^system\.bonuses\.abilities\.(save|check|skill)$/.exec(key))) return { label: { save: "Saving throws", check: "Ability checks", skill: "Skill checks" }[m[1]] };
  if ((m = /^system\.bonuses\.(mwak|rwak|msak|rsak)\.(attack|damage)$/.exec(key))) return { label: `${ATTACKS[m[1]]} ${m[2] === "attack" ? "attacks" : "damage"}` };
  if (key === "system.bonuses.spell.dc") return { label: "Spell save DC" };
  if ((m = /^system\.skills\.(\w+)\.bonuses\.(check|passive)$/.exec(key))) return { label: `${names.skills?.[m[1]] ?? m[1].toUpperCase()}${m[2] === "passive" ? " (passive)" : ""}` };
  if ((m = /^system\.traits\.(dr|di|dv|ci)\.value$/.exec(key))) return { label: TRAITS[m[1]] };
  return null;
}

/** Ready Set Midi's advantage and disadvantage flags as words: "ADV on DEX saves", "Attacks against you have DIS". */
export function midiFlagLabel(key) {
  const m = /^flags\.midi-qol\.(grants\.)?(advantage|disadvantage)\.(.+)$/.exec(key);
  if (!m) return null;
  const mode = m[2] === "advantage" ? "ADV" : "DIS";
  const parts = m[3].split(".");
  let what;
  if (parts[0] === "all") what = "everything";
  else if (parts[0] === "attack") what = parts[1] && parts[1] !== "all" ? `${ATTACKS[parts[1]]?.toLowerCase() ?? parts[1]} attacks` : "attacks";
  else if (parts[0] === "ability" && ["save", "check"].includes(parts[1])) {
    const ability = parts[2] && parts[2] !== "all" ? `${parts[2].toUpperCase()} ` : "";
    what = `${ability}${parts[1] === "save" ? "saves" : "checks"}`;
  } else if (parts[0] === "skill") what = parts[1] && parts[1] !== "all" ? `${parts[1].toUpperCase()} checks` : "skill checks";
  else if (parts[0] === "deathSave") what = "death saves";
  else if (parts[0] === "concentration") what = "concentration saves";
  else what = parts.join(" ");
  return m[1] ? `${m[2] === "advantage" ? "Attacks against you have ADV" : "Attacks against you have DIS"}${parts[0] === "attack" && parts[1] && parts[1] !== "all" ? ` (${what})` : ""}` : `${mode} on ${what}`;
}

/** An unknown key, tidied: "system.bonuses.weapon.critical" → "Bonuses › weapon › critical". */
export function tidyKey(key) {
  const parts = String(key).replace(/^(system|flags)\./, "").split(".").filter(Boolean);
  if (!parts.length) return String(key);
  const [first, ...rest] = parts;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" › ");
}

const signed = n => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;

/**
 * One change as a row.
 * @param {{key: string, type?: string, mode?: number, value: any}} change
 * @param {{read?: (path: string) => any, applied?: boolean, names?: object}} [context]
 *   `read` looks up a value on the actor; `applied` says whether the actor's values already include this effect.
 * @returns {{label: string, before?: number, after?: number, change: string}}
 */
export function changeRow(change, { read, applied = false, names } = {}) {
  const key = String(change.key ?? "");
  const type = change.type ?? ["custom", "multiply", "add", "downgrade", "upgrade", "override"][change.mode] ?? "add";
  const raw = change.value;
  const midi = midiFlagLabel(key);
  if (midi) return { label: midi, change: "ON" };
  const known = changeLabel(key, names);
  const label = known?.label ?? tidyKey(key);
  const unit = known?.unit ?? "";
  const number = typeof raw === "number" ? raw : (typeof raw === "string" && /^[+-]?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : null);
  if (known && /^system\.traits\./.test(key)) return { label: `${label}: ${Array.isArray(raw) ? raw.join(", ") : raw}`, change: type === "subtract" ? "OFF" : "ON" };
  if (number === null) {
    const text = Array.isArray(raw) ? raw.join(", ") : String(raw ?? "");
    return { label, change: type === "override" ? `= ${text}` : /^[+-]/.test(text) ? text : `+${text}` };
  }
  // Before → after, when the actor's number is readable and the change is arithmetic.
  const current = known?.read && read ? Number(read(known.read)) : NaN;
  if (Number.isFinite(current)) {
    const apply = base => ({ add: base + number, subtract: base - number, multiply: base * number, override: number,
      upgrade: Math.max(base, number), downgrade: Math.min(base, number) })[type] ?? base + number;
    const unapply = after => ({ add: after - number, subtract: after + number, multiply: number ? after / number : after })[type];
    const before = applied ? unapply(current) : current;
    const after = applied ? current : apply(current);
    if (Number.isFinite(before) && Number.isFinite(after)) {
      return { label, before, after, unit, change: signed(after - before) };
    }
  }
  const change_ = { add: signed(number), subtract: signed(-number), multiply: `×${number}`, override: `= ${number}`, upgrade: `≥ ${number}`, downgrade: `≤ ${number}` }[type] ?? signed(number);
  return { label, change: `${change_}${unit && /^[+−=≥≤]/.test(change_) ? unit : ""}` };
}

/** Bullet items in an HTML description: the GM's own wording for the rows. */
export function bulletRows(html) {
  const items = [...String(html ?? "").matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(m => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim()).filter(Boolean);
  return items.map(text => ({ label: text, change: "" }));
}

/**
 * Everything an effect grants, as rows: the GM's bullets if there are any, else each change, then each condition.
 * @param {{changes?: object[], statuses?: Iterable<string>, description?: string}} effect
 * @param {object} [context]   As for changeRow, plus `statusName` (id → display name).
 */
export function effectRows(effect, context = {}) {
  const bullets = bulletRows(effect.description);
  if (bullets.length) return bullets;
  const rows = (effect.changes ?? []).filter(change => change?.key).map(change => changeRow(change, context));
  for (const status of effect.statuses ?? []) rows.push({ label: context.statusName?.(status) ?? status, change: "ON", status: true });
  return rows;
}

export { ABILITIES };
