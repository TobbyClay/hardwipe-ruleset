# Hardwipe Ruleset 0.7.48

Cyberpunk character sheets, cyberware, wall cover, combat controls, braindance memories and crew maneuvers for Foundry VTT. This release brings everything since 0.7.40, the previous published release, with the matching Ready Set Midi 14.0.10.2 companion. 0.7.47 was built but never published; its changes are listed below and ship here.

## New in 0.7.48

**Crew Maneuvers:** a feature one character sets up and the rest of the crew pays off. *Entry Stack*: Mags stacks up on a door, Juno opens it, and both attack.
- **No new sheet fields:** set a feat's **Type** to **Crew Maneuver**, then pick its maneuver type from the second dropdown.
- **GM-defined types** (Game Settings → *Crew maneuver types*): what firing does (a weapon attack on the reaction, the feature's own activity, or a card), who fires it (the owner or the rest of the crew), and how long it stays armed. Strike, Support and Signal come ready.
- **Crewlink:** the Turn tab lists armed maneuvers. The crew reads *"Mags has set up Entry Stack:"* and the feature's description, with GM secrets left out.
- **CREW card:** a camera-feed chat card when a maneuver fires, two staggered feeds when a crewmate fires someone else's. A compact *Glitch feed* style is a world setting.

**Turn tab** on the Hardwipe character sheet: round and position, action, bonus action and reaction (Ready Set Midi's markers or Hardwipe's own ledger), movement, attacks left, one band per cost, standard actions, running programs, conditions, Edge and Strikes. Shield Block reads its reaction in combat.

**Roll calls:** a GM window (Alt+R) asks for checks and saves with a typed DC, as Each, Group or Contest, with Hardwipe-styled request and contest cards. A roll from the sheet answers an open roll call.

**Netlink and comms queue:** a strip on the Turn tab shows rolls waiting on you, and only when something is waiting. The GM gets a comms queue, with auto-close settings.

**Cyberware tab:** redesigned on D&D5e's own sheet parts, with the light theme fixed.

**Checks:** CI now runs the unit tests, parses every script, and checks the manifest, language files and module paths on each pull request.

## From 0.7.47

**Braindance (0.7.47):** play someone else's memory. The GM pairs player characters with NPCs; players play the NPC's full sheet, implants and token under a synchronized overlay.
- **Memory isn't reality:** wall damage, breaches and Mission Heat from the memory roll back when it ends.
- **Layers and clues:** Visual, Audio and Thermal layers with clues to scan for.
- **Sensory echoes:** they can impose disadvantage or take an implant offline.
- **Timeline:** with replays.
- **Records:** BD-stamped cards, and the Roll Tracker credits the real character.

**Area spells damage walls (0.7.46):**
- **Every shape:** Fireballs, cones, lines, cubes, emanations and rings hit every wall section they reach.
- **Settings:** set per spell, or as a default per shape.
- **Approval:** the GM reviews it like any other wall damage.

**Attack and save cards (0.7.42–0.7.45):**
- **Attacks:** attack cards arrive complete, damage applied by the workflow can be undone, and rolls can be changed after the fact (advantage, bonuses, rerolls, CRIT).
- **Saves:** saving throws read on a dial. Spells that ask for saves list every target with their result, NPC saves wait for the GM, and alternative effects let the caster choose one.
- **Advantage sources:** ranged attacks list every advantage or disadvantage source Ready Set Midi evaluated, and which mode to roll.

**High Rollers (0.7.45):** a Roll Tracker with sessions, players, awards, notes on natural 1s and 20s, and a Screamsheet recap.

**Walls and review:** a wall editor section for saved wall types, GM approval for every targeted attack, and separate GM Apply/Ignore decisions for wall damage.

**Look and fixes:**
- **Type:** Rajdhani is bundled (SIL OFL).
- **Code review:** a full review fixed phantom damage logs on ruled misses, player wall targeting on scenes without token vision, and unrelated Regions being rewritten by wall edits.
- **Performance:** off-screen card animations pause.
- **Localisation:** more player text is now translatable.

## Ready Set Midi 14.0.10.2 companion

The companion is attached to this release. Hardwipe's manifest installs it as a dependency. It is Ready Set Midi with Hardwipe's ranged-cover hooks and the area-wall changes:
- the spell card records the placed area;
- a pending area waits for the GM's wall review, then is removed once the GM decides when auto-remove is on;
- it no longer shows the GM "dnd5ereaction000 does not exist" at turn changes.

`preview/merge-companion.py` in the repository rebuilds it from the cover-bridge bundle.

## Install

Tested matrix: **Foundry 14.367**, **D&D5e 6.0.5**, **Ready Set Midi 14.0.10.2** (attached).

In Foundry Setup, open **Add-on Modules → Install Module** and paste this manifest URL:

`https://github.com/TobbyClay/hardwipe-ruleset/releases/latest/download/module.json`

The Hardwipe manifest links the matching Ready Set Midi; Foundry offers to install it. For a separate installation use:

`https://github.com/TobbyClay/hardwipe-ruleset/releases/latest/download/ready-set-midi-module.json`

Enable Hardwipe Ruleset, Ready Set Midi, libWrapper, socketlib and DAE. Ready Set Midi replaces standalone Midi-QOL and Ready Set Roll. Keep those disabled, along with standalone Walled Regions, Walled Templates and Braindance Suite.

**Upgrading from 0.7.40** (the previous published release):
- **Install both:** install Hardwipe and Ready Set Midi together, from this release.
- **One-time change:** on first load, Ready Set Midi's **Roll NPC saves** moves from *Auto* to *Chat Message* once, so the GM rolls NPC saves from the card.
- **Braindance Suite users:** restore any running memory, then disable that module.

Manual installation ZIPs and the full Hardwipe guide are attached below. Each ZIP contains its module-named root folder, which belongs under your Foundry User Data `Data/modules` folder.

## Verification

Every feature in this release was tested in a disposable world on Foundry 14.367 and D&D5e 6.0.5, with separate GM and player clients. The per-release test records are kept with the development audit.

**Final 0.7.47 checks:**
- **Tests:** 87 unit tests pass and every script parses.
- **Braindance:** a full run, including an exact rollback of a breached wall and Heat.
- **Companion:** area walls, ranged cover and turn changes, with no errors.

`SHA256SUMS.txt` records the attached assets. Ready Set Midi keeps its upstream authors and its MIT licence notice, with credits for the bundled sound files.
