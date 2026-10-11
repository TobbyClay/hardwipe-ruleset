import { MODULE_ID } from "./hardwipe-state.js";

/**
 * An activity that carries several effects for its targets usually means "one of these": Bestow Curse lists a
 * curse per ability, Blindness/Deafness both conditions, Hex an ability each. dnd5e's card lets you click the
 * one you want, but Ready Set Midi's automatic effect application applies every one of them. When an activity
 * has two or more such effects, Hardwipe turns on Midi's own "Choose effects" for that use, so the caster picks
 * the effect when it lands. A world setting turns this off for tables whose activities stack effects on purpose.
 */
const SETTING = "chooseAlternativeEffects";

export function registerEffectChoice() {
  if (!game.settings.settings.has(`${MODULE_ID}.${SETTING}`)) {
    game.settings.register(MODULE_ID, SETTING, {
      name: "HARDWIPE.Effects.ChooseSetting", hint: "HARDWIPE.Effects.ChooseSettingHint",
      scope: "world", config: true, type: Boolean, default: true
    });
  }
  // The workflow runs on its own copy of the activity (scaled for the slot), set up after targeting; mark that
  // copy at each later step, all of which come before Midi applies effects.
  const mark = workflow => {
    if (game.settings.get(MODULE_ID, SETTING) === false) return;
    for (const activity of [workflow?.activity, workflow?.otherActivity]) {
      const properties = activity?.midiProperties;
      if (properties && !properties.chooseEffects && targetEffects(activity) > 1) properties.chooseEffects = true;
    }
  };
  for (const hook of ["midi-qol.targetingComplete", "midi-qol.preCheckHits", "midi-qol.AttackRollComplete", "midi-qol.DamageRollComplete",
    "midi-qol.preCheckSaves", "midi-qol.postCheckSaves"]) Hooks.on(hook, mark);
}

/** Effects this activity would put on its targets: not passive (transfer), not enchantments, not save-only or self effects. */
function targetEffects(activity) {
  const level = activity.relevantLevel;
  return (activity.effects ?? []).filter(data => {
    const effect = data?.effect;
    if (!effect || effect.transfer === true || effect.type === "enchantment" || data.onSave === true) return false;
    if ((data.level?.min ?? -Infinity) > level || level > (data.level?.max ?? Infinity)) return false;
    const dae = effect.flags?.dae ?? {};
    return !dae.selfTarget && !dae.selfTargetAlways;
  }).length;
}
