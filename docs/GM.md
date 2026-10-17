# GM setup and interface controls

[← Overview](../README.md) · [Player guide](Players.md) · [Walls](Walls.md) · [Combat](Combat.md)

## Installation and first run

The public pair is **Hardwipe 0.7.47 + Ready Set Midi 14.0.10.2**, tested on **Foundry 14.367 / D&D5e 6.0.5**. Install both together from the [release page](https://github.com/TobbyClay/hardwipe-ruleset/releases/latest).

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

Native party roll requests use matching cards, showing the requested roll, DC when visible, each member's result, and outstanding Roll buttons. A party sheet's check or save request is drawn as a [roll call](#roll-calls); a rest request keeps its own card. Request visibility still follows the system's permissions and message mode.

## Roll calls

The **Roll call** window asks one or more characters or NPCs for a check or a save mid-scene, and its card collects the results. It is optional: players rolling from their sheets works exactly as before, and nothing waits on a roll call.

| <img src="media/roll-call-composer.png" alt="Roll call window: three participants, Dexterity save picked, DC 13 typed with Players see the DC on, resolved as Group, and a reason" width="330"> | <img src="media/roll-call-group.png" alt="Group roll call card: Dexterity saving throw DC 13 with two passes, one fail, and Team passes" width="300"> |
| --- | --- |

- **Open it** with **Alt+R** (rebind it under *Configure Controls*), the bullhorn in the token controls, or **Request roll** on a character's Turn tab (opens for that character). Opening it again adds the selected tokens to the open window.
- **Who rolls.** The selected tokens when you open it; **Add selected** adds more, **×** removes one.
- **Roll.** Quick picks for what comes up mid-fight (Athletics, Acrobatics, Perception, Stealth, Insight, Constitution, Dexterity and Wisdom saves), or any skill, ability check or saving throw from the list.
- **DC.** Type it; leave it empty for no DC. **Players see the DC** starts from D&D5e's *Challenge visibility* setting. With it off, players see **Rolled** instead of Pass or Fail, and the DC is hidden on their roll's card too. You always see the DC and the verdicts.
- **Resolve as** **Each** (everyone passes or fails on their own), **Group** (the crew passes when at least half pass), or **Contest** (exactly two participants: the first rolls the roll above, the second picks one of up to two opponent rolls; the higher total wins, a tie goes to the defender).
- **Reason** is optional and shows on the card.

On the card, a participant no active player owns (an NPC, or a character whose player isn't connected) gets a Roll button for you. A matching roll made from a sheet (same character, same skill, check or save) also answers an open roll call, so players who roll the usual way still count. The answering rolls fold to one line under the card. A contest's Roll buttons show the roller's bonus. When a Grapple or Shove contest goes to the challenger, **Apply Grappled** or **Knock Prone** puts the condition on the defender.

### The comms queue

<img src="media/comms-queue.png" alt="Queue tab of the Roll call window: a concentration interrupt that closes when resolved, a grapple contest and a Dexterity save roll call that close at the end of round 3, with Roll, Pin and Close buttons" width="420">

The Roll call window's **Queue** tab lists everything the table still owes: open roll calls and contests, saves on spell and attack cards, and concentration interrupts. Each row shows who still owes it (● online, ○ offline player) and when it closes.

- **Close** (×) takes it off every player's netlink strip. A roll call or contest then takes no more rolls, and its card reads **Roll call closed** with the missing rows marked **Skipped**. A save or an interrupt only leaves the strip and the queue; its card and Ready Set Midi carry on.
- **Roll** appears when an NPC or an offline player's character still owes the roll.
- **Pin** keeps a roll call open past its timer.
- **Close all** clears the queue, after a confirmation.

Roll calls and contests also close on their own. Three world settings control this:

| Setting | Default | Choices |
| --- | --- | --- |
| Roll calls close in combat | At the end of the round they were posted | end of the turn they were posted, when combat ends, never |
| Roll calls close out of combat | After 10 minutes | after 30 minutes, never |
| Waiting on you shows at most | 3, the rest under more | 5, all |

Saves on cards and concentration interrupts never close on a timer; they leave once resolved, or when you close them. The active GM's client does the closing, including for old unanswered roll calls still in the recent log when the world loads.

## Colors, text, folding, and motion

<img src="media/card-colours-current.png" alt="Card color configuration showing card families, result colors, and system card colors" width="440">

Open **Game Settings → Hardwipe Ruleset → Card colours**. The GM palette covers card families, system messages, results, abilities, damage types, turn starts, and roll requests. Changes recolor existing messages for everyone. Reset an individual color or use **Reset all**.

Spell colors have separate modes: one base color, by school, by player, or per spell. In per-spell mode, the spell Details tab exposes **Card colour**. SC – Item Rarity Colors can supply enabled school colors and item rarity styling.

**Card accent** selects Hardwipe phosphor or D&D5e gold on attack/spell controls. **Saving throw colours** can use ability colors or amber. Each player chooses **Card text size** independently.

**Fold settled cards after** accepts Never, 2, 5, or 10 minutes. Settled cards fold to useful titles and totals; pending saves and GM decisions remain open. Folding pauses while browsing older chat. Reopening a card is local to the viewer's session.

Fresh rolls have short entry animations; old cards do not replay them after reload. Reduced-motion preferences suppress animation.

## Roll Tracker

<img src="media/roll-tracker-overview.webp" alt="Roll Tracker overview: headline counters for rolls and spells, the ranking, the Friday Night Firefight strip, awards and per-session charts" width="900">

Open **Game Settings → Hardwipe Ruleset → Roll Tracker** (the window is called High Rollers). The **Show** menu picks one session, the unfiled rolls, or the whole campaign. The counters at the top are always that scope's rolls and spells cast, with the change on the session before.

| Tab | What it shows |
| --- | --- |
| Overview | The ranking by d20 average (role tag, characters, rolls, spells, natural 20s and 1s, the last ten d20s), the Friday Night Firefight strip (attacks and hit rate, crits, damage and the best hit, healing, downs), awards with their runners-up, the latest noted moments, and rolls and spells per session. |
| Players | A character screen for each player or character: rolls, spells, natural 20s and 1s and the best roll; accuracy, damage, magic, saves, checks and the hot streak around the d20 average; d20 faces with a one-line read on them; spells cast, per-session rolls and spells, and roll types. The arrows step through players. |
| Compare | Two players, the party or single characters, item-comparison style: player 1's numbers with green or red arrows against player 2, and who wins on how many stats. |
| Dice | Every d20 face each player threw, dropped advantage dice included, with a fairness verdict once there are 60 or more, and a dice bag by die type. |
| Moments | Every natural 1 and 20 with the GM's note. The GM writes or edits notes here; players read them. |
| Sessions | GM only: the session log, described below. |

| Players | Compare |
| --- | --- |
| <img src="media/roll-tracker-player.webp" alt="Players tab: a player's character screen with attribute hexes around the d20 average" width="440"> | <img src="media/roll-tracker-compare.webp" alt="Compare tab: two item-comparison cards with green and red arrows" width="440"> |

### Sessions

<img src="media/roll-tracker-session.webp" alt="Jack in dialog: start a new session with a name, date, start time and number, or continue the last one" width="440">

When the GM loads the world and nothing was rolled in the last hour, **Jack in** asks about tonight: start a new session (name, date, start time and number), or continue the last one. **Later** changes nothing. The same dialog opens from **New session** in the Sessions tab, and from **Start session** when no session is in play.

Rolls are filed by time. A new session ends the one before it at its last roll. **End session** closes the one in play; rolls after that wait as **unfiled** until a session's times cover them. The play button on a finished session makes it the session in play again.

<img src="media/roll-tracker-sessions.webp" alt="Session log with one session open for editing: name, number, date, start and end, and a note on how many entries the new times take in" width="900">

The pencil opens a session's name, number, date, start and end. Before saving, the editor says how many entries the new times take in or leave out; saving re-files every roll by time. **Import chat log** reads in older rolls: they join the session that covers them, and rolls outside every session form new sessions split at four-hour breaks. **Export** saves everything as JSON. Deleting a session removes its stats and notes; the chat log is never touched.

### Natural 1s and 20s

A box beside the chat asks the GM what was happening. **Enter** or the check mark saves the note, **Esc** or × skips it, and up to three wait at a time. Skipped rolls can be noted later under Moments. Only fresh rolls ask, never rolls read in from the log.

<img src="media/roll-tracker-prompts.webp" alt="Note prompts beside the chat for a natural 1 attack, a natural 20 check and a natural 1 check" width="360">

### Post recap and Show players

<img src="media/roll-tracker-recap-dialog.webp" alt="Recap dialog: headline and subhead fields beside a live preview of the Screamsheet" width="640">

**Post recap** opens the Screamsheet for the scope on screen. The headline and subhead are written from the session's awards and can be edited; the rest (the lead natural 20 and its note, the numbers, the story, quotes from the street, the top awards with runners-up and a classified ad) is built from the data. Posting sends it to chat for everyone.

**Show players** opens the tracker on every connected player's screen, on the tab and session the GM is looking at, even when players can't open it themselves. A banner says who opened it; dismissing the banner keeps the window.

**How rolls are counted.** The active GM's client records each roll as it reaches chat, and records it again if the card changes (retroactive advantage, a bonus, a resolved hit), so nothing counts twice. A roll counts for the player who owns the character, even when the GM rolled it, else for whoever rolled; NPC rolls count for the GM. Role tags are each character's highest-level class. Attacks count as hits or misses from their targets; saves and checks count as made or failed when they have a DC. If the GM was away, rolls posted meanwhile are read in when the GM next loads.

**Settings** (Hardwipe Ruleset section):

| Setting | Default | Effect |
| --- | --- | --- |
| Roll Tracker: record rolls | On | Turns recording off without losing what is recorded. |
| Roll Tracker: ask about the session at login | On | The Jack in dialog at login. |
| Roll Tracker: ask for a note on natural 1s and 20s | Every natural 1 and 20 | Or players' rolls only, or never. |
| Roll Tracker: players can open it | On | Players see every tab but Sessions, without note editing, and without rolls someone else made privately. Show players opens it for them either way. |

The tracker keeps its data in two world settings: the session in play with the unfiled rolls, written about a second after rolls arrive, and the finished sessions, written only when sessions change.

## Braindance

Run memories from the brain button in **Token Controls** (or **Alt+B**): pair player characters with NPCs, send sensory echoes, hide clues on the Visual, Audio and Thermal layers, mark and replay moments, and choose whether wall damage and Heat from the memory roll back when it ends. See the [Braindance guide](Braindance.md).

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
