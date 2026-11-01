/**
 * Built-in attack rule for conditions. D&D5e lists the conditions that give disadvantage on attack rolls in its
 * condition table (`CONFIG.DND5E.conditionEffects.attackDisadvantage`) but nothing in this stack applies that
 * table to an attack. Hardwipe registers one rule per entry, read at ready so it follows the world's rules
 * version: Poisoned under both, Exhaustion 3 only under the legacy 2014 rules. The roll mode scan names the
 * condition, Midi applies it to melee attacks, and the Roll rules panel lists it while it is in force.
 * A rule stands aside when the condition's own effect already carries a Midi attack-disadvantage flag (as
 * Convenient Effects-style conditions do), so the character never gets the same disadvantage named twice.
 * Heavily encumbered (`physicalAttackDisadvantage`) is deliberately not included.
 */
import { RollRules, conditionsInForce } from "./hardwipe-roll-rules.js";

const TABLE_KEY = "attackDisadvantage";
const MIDI_ATTACK_DISADVANTAGE = /^flags\.midi-qol\.disadvantage\.attack\./;

/** The rule ids for a table's entries: "poisoned" → "condition-poisoned", "exhaustion-3" → "condition-exhaustion-3". */
export function conditionRuleIds(entries = []) {
  return [...entries].map(entry => `condition-${entry}`);
}

/**
 * Whether another module already gives this condition attack disadvantage: an applied effect that carries the
 * status itself and a Midi attack-disadvantage flag. `effects` are plain: [{ statuses: [...], keys: [...] }].
 */
export function handledElsewhere(effects = [], status) {
  return effects.some(effect => (effect?.statuses ?? []).includes(status) && (effect?.keys ?? []).some(key => MIDI_ATTACK_DISADVANTAGE.test(String(key))));
}

/** Whether one table entry is in force on a snapshot (see conditionsInForce), with the condition's name. */
export function entryInForce(entry, snapshot, nameOf) {
  const status = String(entry).split("-")[0];
  if (handledElsewhere(snapshot?.effects, status)) return null;
  return conditionsInForce({ [TABLE_KEY]: [entry] }, snapshot, nameOf)[TABLE_KEY]?.[0] ?? null;
}

/**
 * Register one rule per entry of the live table. `env` supplies { entries, snapshot(actor), nameOf, rule }:
 * the table's entries, a snapshot reader, the condition namer and the rule text. Returns the registered rules.
 */
export function registerConditionRules(env) {
  const { entries = [], snapshot, nameOf, rule } = env;
  return [...entries].map(entry => {
    const live = actor => !!actor && entryInForce(entry, snapshot(actor), nameOf) !== null;
    const [status, level] = String(entry).split("-");
    return RollRules.register({
      id: `condition-${entry}`, name: nameOf(status, level ? Number(level) : null), rule,
      test: workflow => live(workflow?.actor) ? "DIS" : null,
      describe: { type: "DIS", scope: "attack.all" },
      active: live
    });
  });
}

/** At ready: read D&D5e's table and condition config from the running game and register the rules. */
export function registerLiveConditionRules() {
  const conditionTypes = CONFIG.DND5E?.conditionTypes ?? {};
  const leveled = Object.entries(conditionTypes).filter(([, config]) => Number.isFinite(config?.levels)).map(([key]) => key);
  const nameOf = (status, level) => {
    const base = game.i18n.localize(CONFIG.statusEffects?.find?.(entry => entry.id === status)?.name ?? conditionTypes[status]?.name ?? status);
    return level ? `${base} ${level}` : base;
  };
  return registerConditionRules({
    entries: CONFIG.DND5E?.conditionEffects?.[TABLE_KEY] ?? [],
    snapshot: actor => ({
      statuses: [...(actor?.statuses ?? [])], immunities: [...(actor?.system?.traits?.ci?.value ?? [])],
      levels: actor?.system?.conditions ?? {}, leveled,
      effects: [...(actor?.appliedEffects ?? [])].map(effect => ({
        statuses: [...(effect.statuses ?? [])], keys: (effect.system?.changes ?? effect.changes ?? []).map(change => change.key)
      }))
    }),
    nameOf, rule: game.i18n.localize("HARDWIPE.Rules.AttackDisadvantage")
  });
}
