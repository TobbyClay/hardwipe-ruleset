# Hardwipe Ruleset 0.7.50

Wall heights come from Foundry's scene levels, and the wall type windows use Foundry's own form layout. The companion stays **Ready Set Midi 14.0.10.3**, attached again.

## New in 0.7.50

**Wall height from scene levels:** Foundry 14 puts each wall on one or more scene levels, and each level has a bottom and a top elevation.
- **The wall's height:** a wall stands from the lowest bottom to the highest top of its levels; a wall on no level is full height.
- **Shots:** Hardwipe applies that range to shots. A cover line that crosses a wall above its levels' top, or below their bottom, passes: a drone at 30 ft shoots over the 0–20 ft walls of the ground level.
- **Everything else:** Foundry already keeps each level's walls to that level for sight, light, sound and movement, so Hardwipe no longer changes sight itself.
- **The wall editor:** its Hardwipe section shows the height the wall's levels give, and follows the Levels field as it changes.
- **0.7.49's top height is gone:** the per-wall and per-type value is removed. A low barricade no longer has a height of its own; it blocks shots across its level like any wall.

**Wall type windows:**
- **Same layout:** **Wall types** (Hardwipe settings) and **Configure wall cover** (Walls toolbar) now look like Foundry's own windows:
  - Details, Durability and Targeting sections;
  - a hint under each field;
  - maximum and starting HP on one row;
  - buttons that stay below the scrolling fields.
- **Configure wall cover:** it shows the chosen type's values, editable once you pick **Custom values**.

**Fixed:** area spells now honour the elevations of the scene levels a wall and the area are on, and damage marks sit at their wall's level. Both read a level's elevation from the wrong place before.

## Install

Tested matrix: **Foundry 14.367**, **D&D5e 6.0.6**, **Ready Set Midi 14.0.10.3** (attached).

In Foundry Setup, open **Add-on Modules → Install Module** and paste this manifest URL:

`https://github.com/TobbyClay/hardwipe-ruleset/releases/latest/download/module.json`

The Hardwipe manifest links the matching Ready Set Midi; Foundry offers to install it. For a separate installation use:

`https://github.com/TobbyClay/hardwipe-ruleset/releases/latest/download/ready-set-midi-module.json`

Enable Hardwipe Ruleset, Ready Set Midi, libWrapper, socketlib and DAE. Ready Set Midi replaces standalone Midi-QOL and Ready Set Roll. Keep those disabled, along with standalone Walled Regions, Walled Templates and Braindance Suite.

**Upgrading from 0.7.49:**
- **Ready Set Midi:** update Hardwipe; Ready Set Midi 14.0.10.3 is unchanged.
- **First load:** the GM's first load removes any top height set in 0.7.49, from walls and from wall types, and says what it changed.
- **Barricades:** walls that used a top height now block at their levels' full range.

Each ZIP contains its module-named root folder, which belongs under your Foundry User Data `Data/modules` folder.

## Verification

- **Automated:** 240 unit tests pass, every script parses as a module, and the manifest, language files and paths check out.
- **In Foundry 14.367 with D&D5e 6.0.6:** a disposable world with separate GM and player clients:
  - cover against a wall on a 0–20 ft level: half on the ground, none with both tokens at 30 ft;
  - a wall on no level: half at any height, through the companion's engine and Hardwipe's fallback alike;
  - the upgrade removed planted 0.7.49 heights;
  - wall types created, saved and deleted;
  - custom values applied through Configure wall cover;
  - a player's attack through the wall at half cover.
- **Console:** no Hardwipe or Ready Set Midi errors.
- **Hashes:** `SHA256SUMS.txt` records the attached assets.
