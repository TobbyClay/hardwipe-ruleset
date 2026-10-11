# GM setup and interface controls

[← Overview](../README.md) · [Player guide](Players.md) · [Walls](Walls.md) · [Combat](Combat.md)

## Installation and first run

The public pair is **Hardwipe 0.7.40 + Ready Set Midi 14.0.10.1**, tested on **Foundry 14.367 / D&D5e 6.0.5**. Install both together from the [release page](https://github.com/TobbyClay/hardwipe-ruleset/releases/latest).

| Install | Manifest |
| --- | --- |
| Hardwipe | `https://github.com/TobbyClay/hardwipe-ruleset/releases/latest/download/module.json` |
| Custom Ready Set Midi | `https://github.com/TobbyClay/hardwipe-ruleset/releases/latest/download/ready-set-midi-module.json` |

Enable Hardwipe, the custom Ready Set Midi fork, libWrapper, socketlib, and DAE. Keep standalone Midi-QOL and Ready Set Roll disabled when using the fork. Manual ZIPs contain module-named root folders for Foundry's `Data/modules` directory.

Set a character's sheet to **Hardwipe Character** if it explicitly uses another sheet. Hardwipe's default registration does not override an actor's saved sheet preference.

![Current Hardwipe character sheet](media/cyberware-current.png)

For a first-session setup: configure implant categories and service access, leave GM-confirmed attacks enabled, assign types to destructible scene walls, then start Mission Heat when the job begins.

## Mission Heat

<img src="media/mission-heat-config.webp" alt="Start Mission dialog lets the GM choose the Heat card style" width="750">

Use **Start Mission** on the Heat HUD. Choose the mission maximum and card style. The meter tracks the scene's escalation, with Hot at 50%, Critical at 75%, and Lockdown at its maximum. Drag the HUD by its header; each client's position persists. The thermometer in Token Controls shows or hides it.

| Threat broadcast | Corrupted feed | Police scanner |
| --- | --- | --- |
| <img src="media/heat-threat-broadcast.webp" alt="Threat broadcast with hazard tape and meter" width="270"> | <img src="media/heat-corrupted-feed.webp" alt="Corrupted camera feed with glitch details" width="270"> | <img src="media/heat-police-scanner.webp" alt="Police scanner with radar and escalation contacts" width="270"> |

All styles record Heat changes. The broadcast uses hazard strips and a ticker; the feed uses camera noise and displaced text; the scanner uses radar contacts. Reduced motion stops the animated effects. Older Heat messages use the broadcast fallback without the newer meter.

## Turn starts and party requests

<img src="media/turn-styles.webp" alt="Ticker strip, initiative timeline, and terminal turn-start styles" width="900">

The **Turn start card** setting selects Ticker strip, Initiative timeline, or Terminal line. Each keeps the turn's activity buttons usable and shows relevant recovered resources. Hidden combatants are omitted from the public order.

<img src="media/party-requests-0.7.39.webp" alt="Party roll request cards with member results and roll buttons" width="900">

Native party roll requests use matching cards, showing the requested roll, DC when visible, each member's result, and outstanding Roll buttons. Request visibility still follows the system's permissions and message mode.

## Colors, text, folding, and motion

<img src="media/card-colours-current.png" alt="Card color configuration showing card families, result colors, and system card colors" width="440">

Open **Game Settings → Hardwipe Ruleset → Card colours**. The GM palette covers card families, system messages, results, abilities, damage types, turn starts, and roll requests. Changes recolor existing messages for everyone. Reset an individual color or use **Reset all**.

Spell colors have separate modes: one base color, by school, by player, or per spell. In per-spell mode, the spell Details tab exposes **Card colour**. SC – Item Rarity Colors can supply enabled school colors and item rarity styling.

**Card accent** selects Hardwipe phosphor or D&D5e gold on attack/spell controls. **Saving throw colours** can use ability colors or amber. Each player chooses **Card text size** independently.

**Fold settled cards after** accepts Never, 2, 5, or 10 minutes. Settled cards fold to useful titles and totals; pending saves and GM decisions remain open. Folding pauses while browsing older chat. Reopening a card is local to the viewer's session.

Fresh rolls have short entry animations; old cards do not replay them after reload. Reduced-motion preferences suppress animation.

## Roll Tracker

<img src="media/roll-tracker-player.webp" alt="Roll Tracker player profile: tiles, d20 faces against a fair die, roll types, combat with hits and misses, and spells by level" width="900">

Open **Game Settings → Hardwipe Ruleset → Roll Tracker**. The window shows one session or the whole campaign (the **Show** menu), in six tabs:

| Tab | What it shows |
| --- | --- |
| Overview | Totals for the session, a leaderboard per player (rolls, d20 average with a luck gauge, natural 20s and 1s, hit rate, damage, spells, saves), awards, and the latest noted moments. **Post recap to chat** (GM) posts the totals, awards and moments as a card. |
| Players | One player, the party, or one character: d20 faces against a fair die, roll types, attacks, damage by type, spells by level and the most cast, saves by ability, the most rolled skills, initiative, death saves, concentration, downs, flatlines, Edge, and every d20 in order. |
| Compare | Any two of them side by side, metric by metric, with both d20 distributions overlaid. |
| Dice | Every d20 face each player threw, dropped advantage dice included, with a fairness test once there are 60 or more, and a dice bag by die type. |
| Moments | Every natural 1 and 20. The GM writes or edits notes here; players read them. |
| Sessions | GM only. Rename, view or delete a session, end the one in play, read in the chat log, or export everything as JSON. |

| Compare | Dice |
| --- | --- |
| <img src="media/roll-tracker-compare.webp" alt="Roll Tracker compare: a player against the GM, metric by metric, with tug bars" width="440"> | <img src="media/roll-tracker-dice.webp" alt="Roll Tracker dice: each player's d20 faces and a dice bag by die type" width="440"> |

**How rolls are counted.** The active GM's client records each roll as it reaches chat, and records it again if the card changes (retroactive advantage, a bonus, a resolved hit), so nothing counts twice. A roll counts for the player who owns the character, else for whoever rolled; NPC rolls count for the GM. Attacks count as hits or misses from their targets; untargeted attacks count as neither. Saves and checks count as made or failed when they have a DC. If the GM was away, rolls posted meanwhile are read in when the GM next loads. **Import chat log** reads in older rolls, sorts them into sessions by time, and skips any already recorded.

**Natural 1s and 20s.** A box beside the chat asks the GM what was happening. **Enter** or the quill saves the note, **Esc** or × skips it, and up to three wait at a time. Skipped rolls can be noted later under Moments. Only fresh rolls ask, never rolls read in from the log.

<img src="media/roll-tracker-prompts.webp" alt="Two note prompts beside the chat: a natural 20 attack being described, and a natural 1 save" width="380">

**Settings** (Hardwipe Ruleset section):

| Setting | Default | Effect |
| --- | --- | --- |
| Roll Tracker: record rolls | On | Turns recording off without losing what is recorded. |
| Roll Tracker: ask for a note on natural 1s and 20s | Every natural 1 and 20 | Or players' rolls only, or never. |
| Roll Tracker: players can open it | On | Players see the same window without Sessions and without note editing. Rolls someone else made privately (GM roll, blind or self) are left out of their numbers. |
| Roll Tracker: new session after a break of (hours) | 4 | The first roll after a break this long starts a new session. |

The tracker stores its data in two world settings: the session in play, written about a second after rolls arrive, and the finished sessions, written only when sessions change. Ending, deleting and importing change only the tracker, never the chat log. Clearing the chat log at the end of a session keeps every stat.

## When something looks wrong

| Symptom | Check |
| --- | --- |
| No Cyberware tab | Actor uses Hardwipe Character; item is Equipment with a Cyberware category |
| Implant action unavailable | Installed, enabled, undamaged, and has a visible normal Activity |
| Swap stays queued | Rest completed and required Ripperdoc service is enabled |
| Every wall is indestructible | Apply a type to the scene wall; creating a preset alone is insufficient |
| No styled cards | Hardwipe and the matching Ready Set Midi fork are active; conflicting roll modules are disabled; reload clients after updating |
| Shield Block missing | Applicable owned character has an equipped shield; reaction availability is separate |
| Attack waits forever | Active GM is connected; review belongs to the current roll; check the development notes for audited workflow fixes |
| Breach still drawn on map | Background art is unchanged; Foundry collision and vision geometry are what open |

Use the [card gallery](Cards.md) to compare expected output. Reports should include module/system/core versions, GM or Player role, the exact activity, the visible card, and a minimal reproduction without private campaign data.
