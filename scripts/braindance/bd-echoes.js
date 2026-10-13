/**
 * Mechanical echoes: with "Echoes affect rolls" on, a sensory echo also lands on every memory form for its
 * duration, as an Active Effect read by Ready Set Midi.
 *
 * - Panic: disadvantage on ability checks and saving throws.
 * - Disorientation: disadvantage on attack rolls.
 * - Interference: disadvantage on Perception and Investigation, and braindance scans fail.
 * - Overload: one working, installed implant goes offline (Hardwipe cyberware); a form with none gets
 *   disadvantage on Intelligence and Wisdom saves instead.
 *
 * Everything here is plain data. The effects are removed when the echo ends, is cleared or replaced, and with
 * the forms themselves on Disconnect.
 */
import { MODULE_ID } from "./bd-state.js";

export const ECHO_FLAG = "braindanceEcho";
const flag = key => ({ key: `flags.midi-qol.${key}`, type: "override", value: "1" });

export const ECHO_CHANGES = Object.freeze({
  panic: [flag("disadvantage.ability.all")],
  disorientation: [flag("disadvantage.attack.all")],
  interference: [flag("disadvantage.skill.prc"), flag("disadvantage.skill.inv")],
  overload: []
});
export const OVERLOAD_FALLBACK = Object.freeze([flag("disadvantage.save.int"), flag("disadvantage.save.wis")]);

export const ICONS = Object.freeze({
  panic: "icons/svg/terror.svg",
  disorientation: "icons/svg/daze.svg",
  interference: "icons/svg/deaf.svg",
  overload: "icons/svg/lightning.svg"
});

/** Interference blocks scans only when it carries mechanics. */
export const scanBlocked = (cue, now = Date.now()) => Boolean(cue && cue.kind === "interference" && cue.mechanics && cue.endsAt > now);

/**
 * The Active Effect for one form. `implantId` is the implant Overload took offline (restored on removal);
 * without one, Overload falls back to save disadvantage.
 */
export function echoEffectData(cue, { name, description = "", implantId = null, now = Date.now() } = {}) {
  const seconds = Math.max(1, Math.ceil((cue.endsAt - now) / 1000));
  const changes = cue.kind === "overload" && !implantId ? OVERLOAD_FALLBACK : ECHO_CHANGES[cue.kind] ?? [];
  return {
    name, img: ICONS[cue.kind] ?? "icons/svg/aura.svg", description,
    system: { changes: changes.map(change => ({ ...change })) },
    duration: { value: seconds, units: "seconds" },
    flags: { [MODULE_ID]: { [ECHO_FLAG]: { cueId: cue.id, kind: cue.kind, implantId } } }
  };
}

/** Pick the implant Overload takes offline: the first installed, working one with an activity, else any working one. */
export function overloadTarget(implants) {
  const working = implants.filter(implant => implant.enabled);
  return working.find(implant => implant.active) ?? working[0] ?? null;
}
