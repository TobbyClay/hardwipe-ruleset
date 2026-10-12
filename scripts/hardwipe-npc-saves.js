import { MODULE_ID } from "./hardwipe-state.js";

/**
 * NPC saving throws are rolled by the GM from the card that asked for them: the save block's ability button
 * ("Roll NPC saves"). That needs Ready Set Midi to wait for the roll ("Roll NPC saves: Chat Message") rather
 * than roll the save itself the moment the card lands ("Auto"), which leaves no button and no roll to read.
 * Once per world, the active GM's client switches Auto to Chat Message; a GM who switches it back keeps that.
 * In that mode Midi also whispers the GM a one-line request ("Drone DC 13 Wisdom Saving Throw - Mind Spike)");
 * the card's button covers it, so the line stays out of the log.
 */
const MIGRATION = "npcSavesDefault";
const PROMPT_FLAG = "midiSavePrompt";
const MIDI = "ready-set-midi";

export function registerNpcSaves() {
  if (!game.settings.settings.has(`${MODULE_ID}.${MIGRATION}`)) {
    game.settings.register(MODULE_ID, MIGRATION, { scope: "world", config: false, type: Number, default: 0 });
  }
  Hooks.on("preCreateChatMessage", message => {
    if (isMidiSavePrompt(message)) message.updateSource({ [`flags.${MODULE_ID}.${PROMPT_FLAG}`]: true });
  });
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const element = html?.querySelector ? html : html?.[0];
    if (element && message.getFlag(MODULE_ID, PROMPT_FLAG)) element.classList.add("hardwipe-midi-prompt");
  });
}

/** Midi's chat-mode save request: plain whispered text to GMs, no rolls or flags, "<name> DC n <ability> Saving Throw - <item>)". */
function isMidiSavePrompt(message) {
  if (message.rolls?.length || !message.whisper?.length || Object.keys(message.flags ?? {}).some(scope => scope !== "core")) return false;
  if (!message.whisper.every(id => game.users.get(id)?.isGM)) return false;
  const text = String(message.content ?? "");
  if (/<[a-z]/i.test(text)) return false;
  const label = game.i18n.localize("midi-qol.saving-throw");
  return !!label && label !== "midi-qol.saving-throw" && text.includes(` ${label}`) && / - .*\)\s*$/.test(text);
}

/** Once per world, on the active GM's client: NPC saves wait for the GM's button instead of rolling themselves. */
export async function applyNpcSavesDefault() {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id || !game.modules.get(MIDI)?.active) return;
  if ((game.settings.get(MODULE_ID, MIGRATION) ?? 0) >= 1) return;
  let config;
  try { config = foundry.utils.deepClone(game.settings.get(MIDI, "ConfigSettings")); } catch { return; }
  if (!config || typeof config !== "object") return;
  const changed = [];
  for (const key of ["rollNPCSaves", "rollNPCLinkedSaves"]) {
    if (config[key] === "auto") { config[key] = "none"; changed.push(key); }
  }
  try {
    if (changed.length) await game.settings.set(MIDI, "ConfigSettings", config);
    await game.settings.set(MODULE_ID, MIGRATION, 1);
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not set Ready Set Midi's NPC saves to Chat Message`, error);
    return;
  }
  if (changed.length) ui.notifications.info(game.i18n.localize("HARDWIPE.Cards.NpcSavesDefault"), { permanent: true });
}
