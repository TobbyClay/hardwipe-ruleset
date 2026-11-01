# Hardwipe Ruleset 0.7.49

Cyberpunk character sheets, cyberware, wall cover, combat controls, braindance memories and crew maneuvers for Foundry VTT. This release brings everything since 0.7.48, with the matching **Ready Set Midi 14.0.10.3** companion.

## New in 0.7.49

**Legendary cards:** a rare weapon gets a chat card of its own, in place of the plain card and its maker's style.
- **Which weapons:** those at or above **Legendary cards from** (a setting), in the order of the rarity list, so Custom D&D tiers (Gonk, Street, Nova, Preem, Iconic…) count as the GM ranks them.
- **Its own card:** one of eight designs made that weapon's own: art, a hue, the title's type and colour, its own lines.
- **Signature cards:** hand-built for Exhibit C, Johnny Silverhand's Malorian Arms 3516, Skippy, Guts, Plan B, Overwatch, Lizzie, La Chingona Dorada and Satori, each on one weapon at a time, with a slot for a logo from the world's own files.
- **Card Studio** (GM, Hardwipe settings): write cards in HTML and CSS and share them as files. Every client cleans a card before showing it: images, GIFs, video and https links are allowed; scripts, handlers, forms, frames and plain http are removed.
- The GM sets it from a crown on the weapon's card or from the weapon sheet; players see the result, never the controls.

**Roll rules:** the **Roll rules** panel at the bottom of the Turn tab (under Features on NPCs) shows the rules in force on the character right now, each named after its cause.
- **Feature modes:** a feature's modes (a stance, an aim setting) switch from the panel, one at a time.
- **The roll mode scan** is saved on attack cards and shown on melee when Ready Set Midi applied a mode. Players never see a target's rule by name: it reads *Granted by the target*.
- **Built-in rules:** Poisoned gives disadvantage on attack rolls (Exhaustion 3 too, under the legacy rules), from D&D5e's own table.
- **For macros and modules:** `game.hardwipe.rules.register(…)` and the `hardwipe.attackSources` hook.

**Edge: one point, four plays.** **Spend** opens a picker:
- **Reroll:** any single die on any card.
- **Interrupt:** an action or bonus action on someone else's turn.
- **Stabilize:** from 0 back to 1 HP.
- **Execute:** a targeted mook drops with no damage roll.

Each play posts its own cut-in card; Downed, Flatline and Edge spent are cards too.

**Combat:**
- **Mission Heat in thirds:** Clean, Hot and Critical, then Lockdown. Until Critical, a hit on a surprised mook can be a **Coup de Grace**.
- **Variant initiative:** a character's initiative can be any skill, and the card names it.
- **Weapon makers:** a weapon's **Manufacturer** dresses its card (Arasaka, Militech, Kang Tao and more).
- **The Eye:** a GM tool for the AIs behind the Blackwall to look back.

**Walls:**
- **Top height:** a wall type or wall can have a top height. Anyone whose eyes are above it sees and shoots over it; light, sound, movement and area blasts still stop at the wall.
- **Reposition:** a card whose use puts down an area (a grenade, a spell, a feature) can place it again. The region moves and keeps its effects and links; a wall review still pending for the old spot no longer applies.

**Sheets and cards:**
- **NPC sheet:** NPCs get the **Hardwipe NPC** sheet, with a Cyberware tab once they carry an implant. The GM can install or remove an implant at once.
- **Shields:** each shield can have its own maximum HP (the GM sets it on the shield, 1 to 99; 10 by default).
- **One card family:** initiative, consumable, tool and feature cards share one layout. The initiative card shows your place in the turn order, live; consumables show ammo counts and duration rings; tools have **Roll check**.
- **The Turn tab:**
  - it asks whether an off-turn action was your reaction;
  - weapon swings count against the Attack action;
  - active effects drain a ring with the time left.
- **Typed chat** reads as a comm feed, with Smartphone Widget texts; **light mode** works, with Hardwipe's cards kept dark.
- **Unidentified items:** players no longer see an unidentified item's rarity on attack and item cards. SC Item Rarity Colors 3.0.15 and later can draw them in its own Unidentified style.

**Upkeep:**
- **World data upgrades:** the active GM's client upgrades world data once per version, and says what it changed. `game.hardwipe.migrate({ force: true })` runs the steps again.
- **Roll Tracker:** the GM's **Inspect adv/dis rolls** shows which rules put attack rolls at advantage or disadvantage.
- **Crew maneuvers:** a crewmate's request to fire someone else's maneuver is checked by the GM against the owner's fight.

## Ready Set Midi 14.0.10.3 companion

The companion is attached to this release, and Hardwipe's manifest installs it as a dependency (14.0.10.3 or later). It is built from source and adds:
- **Built-in cover:** the calculation is adapted from Simple Cover 5e (MIT), worked out during each attack and never left on the target. Hardwipe's ranged cover uses it: lines pass through holes in damaged walls and over walls lower than the eye line.
- **Hooks for modules:** `midi-qol.coverWalls` and `MidiQOL.computeCoverDetails(attacker, target)`.
- **Initiative:** changing an initiative roll from its card updates only the speaker's own combatant.

## Install

Tested matrix: **Foundry 14.367**, **D&D5e 6.0.6**, **Ready Set Midi 14.0.10.3** (attached).

In Foundry Setup, open **Add-on Modules → Install Module** and paste this manifest URL:

`https://github.com/TobbyClay/hardwipe-ruleset/releases/latest/download/module.json`

The Hardwipe manifest links the matching Ready Set Midi; Foundry offers to install it. For a separate installation use:

`https://github.com/TobbyClay/hardwipe-ruleset/releases/latest/download/ready-set-midi-module.json`

Enable Hardwipe Ruleset, Ready Set Midi, libWrapper, socketlib and DAE. Ready Set Midi replaces standalone Midi-QOL and Ready Set Roll. Keep those disabled, along with standalone Walled Regions, Walled Templates and Braindance Suite.

**Upgrading from 0.7.48:**
- **Update both:** update Hardwipe and Ready Set Midi together.
- **First load:** the GM's first load upgrades the world's data once (shields get their maximum) and says what changed.
- **Sheets:** NPCs take the Hardwipe NPC sheet unless one was chosen for them.

Each ZIP contains its module-named root folder, which belongs under your Foundry User Data `Data/modules` folder.

## Verification

- **Automated:** 238 unit tests pass, every script parses as a module, and the manifest, language files and paths check out.
- **In Foundry:** the release builds were run in a disposable world on Foundry 14.367, D&D5e 6.0.6 and Custom D&D 5.6.0, with separate GM and player clients:
  - a signature card's ranged attack with half cover and the roll mode scan;
  - a poisoned melee attack;
  - an unidentified weapon and unidentified ammunition, which keep their rarity from the player;
  - the Roll rules panel, Edge controls, the shield maximum, the NPC Cyberware tab, the weapon sheet's Legendary section;
  - wall top height through the companion's cover engine;
  - the wall types editor and the Card Studio.
- **Console:** no Hardwipe or Ready Set Midi errors.
- **Hashes:** `SHA256SUMS.txt` records the attached assets. Ready Set Midi keeps its upstream authors and its MIT licence notice, with Simple Cover 5e's notice and credits for the bundled sound files.
