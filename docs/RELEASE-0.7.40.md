# Hardwipe Ruleset 0.7.40

Cyberpunk character sheets, cyberware, wall cover and combat controls for Foundry VTT.

## Changes

- Shield Block cards use a targeting HUD with durability, absorbed damage, damage through, and a broken-shield state.
- Mission Heat offers Threat broadcast, Corrupted feed and Police scanner styles, chosen in Start Mission, with a Heat meter and recorded changes.
- Turn-start cards offer Ticker strip, Initiative timeline and Terminal line styles, with usable activity buttons.
- Existing cards retain their information when redrawn. Animations respect reduced-motion preferences.
- Includes the October 6 chat-header correction for names, timestamps, roll flavor and whisper recipients.
- Preserves required GM attack confirmation and the separate GM Apply/Ignore decisions for wall damage.

## Install

Tested matrix: **Foundry 14.367**, **D&D5e 6.0.5**, **Ready Set Midi 14.0.10.1**.

In Foundry Setup, open **Add-on Modules → Install Module** and paste this manifest URL:

`https://github.com/TobbyClay/hardwipe-ruleset/releases/latest/download/module.json`

The Hardwipe manifest links the matching custom Ready Set Midi dependency. For a separate installation use:

`https://github.com/TobbyClay/hardwipe-ruleset/releases/latest/download/ready-set-midi-module.json`

Enable Hardwipe Ruleset, Ready Set Midi, libWrapper, socketlib and DAE. Ready Set Midi replaces standalone Midi-QOL and Ready Set Roll; keep those conflicting modules disabled.

Manual installation ZIPs and the full Hardwipe guide are attached below. ZIPs contain their module-named root directories and belong under your Foundry User Data `Data/modules` folder.

## Verification

The completed 0.7.40 build passed 11 recorded checks with separate GM and Player clients, including a restart and redraw of 202 messages without console errors. The shared chat-header correction has separate runtime verification. Publication retains the tested gameplay files; packaging changes add GitHub installation metadata, installation documentation and the verified header correction. This publication does not claim a new full gameplay test of every module combination.

`SHA256SUMS.txt` records the attached assets. Ready Set Midi retains its upstream authors and bundled license notices.
