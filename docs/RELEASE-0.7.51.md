# Hardwipe Ruleset 0.7.51

A fix for initiative cards when several copies of one NPC are in a fight. The companion stays **Ready Set Midi 14.0.10.3**, attached again.

## Fixed in 0.7.51

**Initiative cards and copies of one NPC:** unlinked tokens of the same NPC share one actor, and an initiative card could be matched to the wrong copy.
- **Edge reroll:** rerolling a die on a copy's initiative card moved the first copy in the combat to the new total, not the copy that rolled. It now moves the card's own token.
- **Cards without a token:** a card rolled with no token on it is matched to a combatant only when one combatant has that actor; with several copies it no longer guesses the first.
- **Duplicated scenes:** a token card is matched only to a combatant on its own scene, so a combat on a copy of the scene (copies keep their token ids) is left alone.

## Install

Tested matrix: **Foundry 14.367**, **D&D5e 6.0.6**, **Ready Set Midi 14.0.10.3** (attached).

In Foundry Setup, open **Add-on Modules → Install Module** and paste this manifest URL:

`https://github.com/TobbyClay/hardwipe-ruleset/releases/latest/download/module.json`

The Hardwipe manifest links the matching Ready Set Midi; Foundry offers to install it. For a separate installation use:

`https://github.com/TobbyClay/hardwipe-ruleset/releases/latest/download/ready-set-midi-module.json`

Enable Hardwipe Ruleset, Ready Set Midi, libWrapper, socketlib and DAE. Ready Set Midi replaces standalone Midi-QOL and Ready Set Roll. Keep those disabled, along with standalone Walled Regions, Walled Templates and Braindance Suite.

**Upgrading from 0.7.50:** update Hardwipe; Ready Set Midi 14.0.10.3 is unchanged. Nothing in the world changes on load. Coming from 0.7.49 or earlier, read the [0.7.50 notes](RELEASE-0.7.50.md) first: its upgrade removes 0.7.49's wall top heights on the GM's first load.

Each ZIP contains its module-named root folder, which belongs under your Foundry User Data `Data/modules` folder.

## Verification

- **Automated:** 241 unit tests pass, every script parses as a module, and the manifest, language files and paths check out.
- **In Foundry 14.367 with D&D5e 6.0.6:** a disposable world with three unlinked copies of one NPC and a player character in combat:
  - an Edge reroll on the second copy's initiative card moved that copy and left the first alone;
  - each card's place and the newest card's order strip matched the combat.
- **Console:** no Hardwipe or Ready Set Midi errors.
- **Hashes:** `SHA256SUMS.txt` records the attached assets.
