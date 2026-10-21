# Card gallery

[← Overview](../README.md) · [Combat](Combat.md) · [Rests](Rests.md) · [Cyberware](Cyberware.md) · [GM settings](GM.md)

Hardwipe gives each kind of action its own software-inspired display. Click any image to open the full capture. The examples use synthetic characters and scenes, so the QA names are demonstration data.

[Weapons](#weapon-outcomes-and-gm-review) · [Makers](#weapon-makers) · [Spells](#spell-programs) · [Concentration](#concentration-interrupts) · [Checks](#checks-and-initiative) · [Gear](#gear-and-class-features) · [Consumables](#consumables) · [Features](#class-features) · [Tools](#tools) · [Prompts](#prompts) · [Crew](#crew-maneuvers) · [Implants](#cyberware-diagnostics) · [Rests](#short-rest-monitor) · [Chat](#typed-messages) · [Rolls](#plain-rolls) · [System cards](#edge-strikes-and-downed) · [Roll calls](#roll-calls) · [Braindance](#braindance) · [Heat](#mission-heat-styles)

## Weapon outcomes and GM review

Use a weapon activity to make the roll; the GM confirms each target. The verdict, attack dice, damage breakdown, and apply controls share one card. [Combat and approval →](Combat.md)

*Hit, critical and miss: 2026-10-18; critical miss: 0.7.38; GM review: 0.7.43.*

<table>
  <tr>
    <td valign="top"><a href="media/attack-hit-current.png"><img src="media/attack-hit-current.png" alt="Confirmed hit: The target verdict sits above the attack and damage totals." width="280"></a><br><strong>Confirmed hit</strong><br>The target verdict sits above the attack and damage totals.</td>
    <td valign="top"><a href="media/attack-crit-current.png"><img src="media/attack-crit-current.png" alt="Critical hit: Critical damage, cover, and target status remain visible together." width="280"></a><br><strong>Critical hit</strong><br>Critical damage, cover, and target status remain visible together.</td>
    <td valign="top"><a href="media/attack-miss-current.png"><img src="media/attack-miss-current.png" alt="Miss: A missed attack keeps its rolled result and any associated save controls." width="280"></a><br><strong>Miss</strong><br>A missed attack keeps its rolled result and any associated save controls.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/attack-fumble.webp"><img src="media/attack-fumble.webp" alt="Critical miss: A natural 1 is clearly marked after the GM decision." width="280"></a><br><strong>Critical miss</strong><br>A natural 1 is clearly marked after the GM decision.</td>
    <td valign="top"><a href="media/attack-review-gm.webp"><img src="media/attack-review-gm.webp" alt="Private GM review: Choose Hit, Critical, or Miss for each target; pending attacks wait for confirmation." width="280"></a><br><strong>Private GM review</strong><br>Choose Hit, Critical, or Miss for each target; pending attacks wait for confirmation.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/attack-applied-log.webp"><img src="media/attack-applied-log.webp" alt="Confirmed hit with the applied damage logged on the card and an Undo button" width="280"></a><br><strong>Damage you can take back (0.7.45)</strong><br>Damage the workflow applied is logged on the card as Auto, with Undo.</td>
  </tr>
</table>

### Weapon makers

<img src="media/weapon-makers.webp" alt="Twelve Heavy Pistol attack cards, one confirmed hit each: unbranded, then Arasaka, Militech, Kang Tao, Tsunami Defense Systems, Budget Arms, Malorian Arms, Constitutional Arms, Techtronika, PALE, ???? and Maelstrom, each with its own bar, emblem and serial plate" width="900">

*(Next release.)* Set a weapon's **Manufacturer** on its Details tab and its attack card wears that maker: the bar and wordmark, an emblem behind the head, the title's type, a serial plate, and the roll card's rail. The outcome still reads where it always does: the outline, the verdict strip and the targets keep their hit, miss and critical colours, and a miss fades the brand.

Eleven makers have a style: **Arasaka**, **Militech**, **Kang Tao**, **Tsunami Defense Systems**, **Budget Arms**, **Malorian Arms**, **Constitutional Arms**, **Techtronika**, **Maelstrom**, and the campaign's own **PALE** (circuit hands forcing their way in through a damaged card) and **????** (a card running out of power). Any other maker shows its name on the plain card's bar; no maker keeps the plain card. A card follows the weapon's current maker, so changing it redraws the weapon's cards already in chat.

## Spell programs

Spell activities appear as a running program. Read the output, open Info for the description, and resolve any requested saves. [Spells and saves →](Combat.md#saving-throws)

*Native captures: 0.7.38.*

<table>
  <tr>
    <td valign="top"><a href="media/spell-attack.webp"><img src="media/spell-attack.webp" alt="Awaiting GM: A spell attack remains pending until the target outcome is confirmed." width="310"></a><br><strong>Awaiting GM</strong><br>A spell attack remains pending until the target outcome is confirmed.</td>
    <td valign="top"><a href="media/spell-hit.webp"><img src="media/spell-hit.webp" alt="Confirmed spell attack: The program displays its resolved attack and damage." width="310"></a><br><strong>Confirmed spell attack</strong><br>The program displays its resolved attack and damage.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/spell-save.webp"><img src="media/spell-save.webp" alt="Saving-throw spell: Each target has its own waiting, saved, or failed result." width="310"></a><br><strong>Saving-throw spell</strong><br>Each target has its own waiting, saved, or failed result.</td>
    <td valign="top"><a href="media/spell-heal.webp"><img src="media/spell-heal.webp" alt="Healing program: Healing keeps its roll and application controls in the spell window." width="310"></a><br><strong>Healing program</strong><br>Healing keeps its roll and application controls in the spell window.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/spell-npc-save-button.webp"><img src="media/spell-npc-save-button.webp" alt="Spell card waiting for a Wisdom save with the Roll save button" width="280"></a><br><strong>NPC saves wait for the GM (0.7.44)</strong><br>The GM rolls them from the card's Roll save.</td>
    <td valign="top"><a href="media/effect-choice.webp"><img src="media/effect-choice.webp" alt="Effect chooser listing the six Bestow Curse options" width="230"></a><br><strong>One effect, chosen (0.7.44)</strong><br>When an activity carries several alternative effects, the caster picks one.</td>
  </tr>
</table>

## Concentration interrupts

Damage interrupts the held program and asks for a Constitution save. Roll from the request; its state changes with the result. These examples show the owner/GM view. [Concentration controls →](Combat.md#concentration)

*Native captures: 0.7.38.*

<table>
  <tr>
    <td valign="top"><a href="media/conc-interrupt.webp"><img src="media/conc-interrupt.webp" alt="Interrupt received: Roll CON save from the request using the normal roll dialog." width="280"></a><br><strong>Interrupt received</strong><br>Roll CON save from the request using the normal roll dialog.</td>
    <td valign="top"><a href="media/conc-held.webp"><img src="media/conc-held.webp" alt="Recovered: A successful save reports that the program is still running." width="280"></a><br><strong>Recovered</strong><br>A successful save reports that the program is still running.</td>
    <td valign="top"><a href="media/conc-lost.webp"><img src="media/conc-lost.webp" alt="Program crashed: A failed save displays the concentration loss." width="280"></a><br><strong>Program crashed</strong><br>A failed save displays the concentration loss.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/conc-offline.webp"><img src="media/conc-offline.webp" alt="Host offline: An incapacitated host offers End program." width="280"></a><br><strong>Host offline</strong><br>An incapacitated host offers End program.</td>
    <td valign="top"><a href="media/conc-ended.webp"><img src="media/conc-ended.webp" alt="Program closed: The ended state makes an intentional shutdown explicit." width="280"></a><br><strong>Program closed</strong><br>The ended state makes an intentional shutdown explicit.</td>
    <td valign="top"><a href="media/conc-save-collapsed.webp"><img src="media/conc-save-collapsed.webp" alt="Save folded into the record: The linked save collapses to a compact result after resolution." width="280"></a><br><strong>Save folded into the record</strong><br>The linked save collapses to a compact result after resolution.</td>
  </tr>
</table>

## Checks and initiative

Skills, abilities, saves, initiative, and concentration saves share readable roll totals and natural-die badges. Open the total for the dice breakdown. [Roll controls →](Combat.md#read-and-apply-a-roll)

*Native captures: 0.7.38.*

<table>
  <tr>
    <td valign="top"><a href="media/check-skill.webp"><img src="media/check-skill.webp" alt="Skill check: Advantage shows the kept and dropped dice." width="280"></a><br><strong>Skill check</strong><br>Advantage shows the kept and dropped dice.</td>
    <td valign="top"><a href="media/check-ability.webp"><img src="media/check-ability.webp" alt="Ability check: Disadvantage retains a visible account of the roll." width="280"></a><br><strong>Ability check</strong><br>Disadvantage retains a visible account of the roll.</td>
    <td valign="top"><a href="media/save-card-modifier.webp"><img src="media/save-card-modifier.webp" alt="Saving throw: a dial with the DC at the top, the reading and Δ, and the verdict." width="280"></a><br><strong>Saving throw (0.7.44)</strong><br>A dial: the DC at the top, the reading right or left of it, Δ and Saved or Failed in the middle; a bonus shows in violet.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/initiative-order.png"><img src="media/initiative-order.png" alt="Four initiative cards after a burst of rolls: each shows its total, its place (1st to 4th) and who it acts after and before; only the newest, Juno 1st, shows the turn order as portraits" width="280"></a><br><strong>Initiative</strong><br>Each roll is one row: the total, your place in the turn order, and who you act after and before. Places update as everyone else rolls; the newest initiative card shows the whole order. Combatants hidden from players stay out of their view.</td>
    <td valign="top"><a href="media/check-concentration.webp"><img src="media/check-concentration.webp" alt="Concentration save: The save card records the concentration outcome." width="280"></a><br><strong>Concentration save</strong><br>The save card records the concentration outcome.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/save-dial-redline.png"><img src="media/save-dial-redline.png" alt="A natural 20 save: the needle in the dial's red zone, saved by 7" width="250"></a><br><strong>Natural 20 (0.7.44)</strong><br>The needle pegs into the redline and bounces off the limiter.</td>
    <td valign="top"><a href="media/save-dial-crack.png"><img src="media/save-dial-crack.png" alt="A natural 1 save: the dial cracked, failed by 10" width="250"></a><br><strong>Natural 1 (0.7.44)</strong><br>The gauge cracks, with dead segments and the result knocked out of line.</td>
  </tr>
</table>

## Gear and class features

Use the item or feature through its native activity. The card exposes uses, rolls, saves, or healing appropriate to that activity. [Player actions →](Players.md)

*Native captures: 0.7.38.*

<table>
  <tr>
    <td valign="top"><a href="media/item-potion.webp"><img src="media/item-potion.webp" alt="Potion of Healing: The consumable card carries its healing roll." width="280"></a><br><strong>Potion of Healing</strong><br>The consumable card carries its healing roll.</td>
    <td valign="top"><a href="media/item-alchemist.webp"><img src="media/item-alchemist.webp" alt="Alchemist’s Fire: A consumable can include damage and a saving-throw table." width="280"></a><br><strong>Alchemist’s Fire</strong><br>A consumable can include damage and a saving-throw table.</td>
    <td valign="top"><a href="media/item-tool.webp"><img src="media/item-tool.webp" alt="Thieves’ Tools: The tool card collects associated check results." width="280"></a><br><strong>Thieves’ Tools</strong><br>The tool card collects associated check results.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/feature-second-wind.webp"><img src="media/feature-second-wind.webp" alt="Second Wind: A healing feature shows its result and remaining use information." width="280"></a><br><strong>Second Wind</strong><br>A healing feature shows its result and remaining use information.</td>
    <td valign="top"><a href="media/feature-action-surge.webp"><img src="media/feature-action-surge.webp" alt="Action Surge: A utility feature presents its use without inventing an attack." width="280"></a><br><strong>Action Surge</strong><br>A utility feature presents its use without inventing an attack.</td>
    <td valign="top"><a href="media/feature-poison-breath.webp"><img src="media/feature-poison-breath.webp" alt="Poison Breath: A feature with saves reports the affected targets." width="280"></a><br><strong>Poison Breath</strong><br>A feature with saves reports the affected targets.</td>
  </tr>
</table>

## Consumables

One card per use: the item with the doses left, then a scope drawn by what it did, with the result on it. Where there's a roll, the number **is** the roll: click it for the dice. Targets and what happened to them are written out under the scope. **Details** opens the description; the item's own buttons (Refund, Place template) sit beside it. [Effects on the Turn tab →](Players.md#read-your-turn)

<table>
  <tr>
    <td valign="top"><a href="media/consumable-heal.png"><img src="media/consumable-heal.png" alt="Stim Injector card: a vitals trace behind 7 hit points, 2d4 + 2, with Heal, Temp HP and the target count" width="250"></a><br><strong>Heal</strong><br>A vitals trace; the healing roll, Heal and Temp HP.</td>
    <td valign="top"><a href="media/consumable-damage.png"><img src="media/consumable-damage.png" alt="Frag Grenade card: blast radius with two pinned targets, 15 fire with DEX 13 half, the dice drawer open, both targets failed and took 15" width="250"></a><br><strong>Damage and a save</strong><br>The blast with each target pinned (hover for who), the damage roll with its dice open, each target's save and damage.</td>
    <td valign="top"><a href="media/consumable-buff.png"><img src="media/consumable-buff.png" alt="Reflex Booster card: Overclock for 1 minute on Mags in a cyan ring, AC 13 to 15, Speed 30 to 40 ft, advantage on DEX saves, Remove" width="250"></a><br><strong>Buff</strong><br>A ring as long as the effect lasts; what it grants, before → after.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/consumable-condition.png"><img src="media/consumable-condition.png" alt="Flashbang card: Blinded, CON 12, two pinned targets and both failed" width="250"></a><br><strong>Condition and a save</strong><br>The blast, the condition and its save; who resisted and who got it.</td>
    <td valign="top"><a href="media/consumable-utility.png"><img src="media/consumable-utility.png" alt="Smoke Canister card: Deployed, 20 ft emanation, 1 minute" width="250"></a><br><strong>Utility</strong><br>Nothing to roll or apply: the deployed area and how long it lasts.</td>
  </tr>
</table>

## Class features

Features that heal, buff, force a save or just engage use the same one-card layout as consumables, in the feature's orange, with their uses left and when they come back (**0/1 · SR**) in the bar. Features that attack keep the attack card. **Action Surge** reads **+1 Action · this turn**, and on your own turn in combat the Turn tab gives the action back (with a fresh Attack action).

<table>
  <tr>
    <td valign="top"><a href="media/feature-action-surge-card.png"><img src="media/feature-action-surge-card.png" alt="Action Surge card: +1 Action this turn, a second action chip lit, 0 of 1 uses until a short rest" width="250"></a><br><strong>Action Surge</strong><br>The second action chip lights up; the Turn tab's action is Ready again.</td>
    <td valign="top"><a href="media/feature-second-wind-card.png"><img src="media/feature-second-wind-card.png" alt="Second Wind card: a vitals trace behind 2 hit points, 1d10, with the + bonus, Heal, Temp HP" width="250"></a><br><strong>Second Wind</strong><br>A healing feature reads like a healing consumable, with the roll's +.</td>
  </tr>
</table>

## Tools

Using a tool posts its card with a **Roll check** button (the check is yours to roll; Ready Set Midi's own tool card had no button for it). The result lands on the tool card, in a scope drawn by the kind of tool, and the check's own card folds to a slim row underneath that keeps the roll's **+** and **DIS / ADV**. Click the total for the dice.

- **Most rolls have no DC.** The scope fills by how good the roll is for you (a 1 to a 20 on the die, plus everything added), in cyan, and the stamp names the highest standard DC the total beats, from **Easy · 10** to **Very hard · 25**, for the GM to rule on.
- **With a DC** on the tool's check, it reads **Success** in green or **Failure** in red.
- **Six families**, by the tool's D&D5e type: **Breach** (thieves' tools; cipher columns lock in), **Spoof** (disguise and forgery kits; ID match), **Synth** (alchemist's, herbalism, poisoner's, brewer's, cook's; purity), **Fab** (other artisan's tools; integrity), **Nav** (navigator's and cartographer's tools, vehicles; route lock), **Signal** (instruments and gaming sets; level). Anything else reads as Breach.

<a href="media/tool-cards.png"><img src="media/tool-cards.png" alt="Six tool cards with their slim check rows: Breach Kit 5 against DC 15, Failure, cipher 2 of 5 locked; Face Kit 20, beats Hard 20; Chem Rig 18, beats Medium 15; Fab Kit 11, beats Easy 10; Nav Deck 4 and Holo Deck 3, under 5" width="940"></a>

## Prompts

Hardwipe's own prompts (the off-turn **Reaction?**, Shield Block, comms, wall types, the Roll Tracker's confirms) and Ready Set Midi's **Apply Retroactive Bonus** share one terminal style: an accent header, a scanlined body, and the default button filled. Cyan asks about your turn, violet adds to a roll, red deletes or ends something.

<a href="media/hardwipe-dialogs.png"><img src="media/hardwipe-dialogs.png" alt="Three prompts: Reaction? in cyan with Yes, spend it; Apply Retroactive Bonus in violet with a formula field; Delete wall type in red with No as the default" width="900"></a>

## Crew maneuvers

Firing a crew maneuver posts a CREW card: the crew's camera feeds cut in, two staggered when a crewmate fires someone else's maneuver. A compact Glitch feed is a world setting. [Crew maneuvers →](Players.md#crew-maneuvers)

<table>
  <tr>
    <td valign="top"><a href="media/crew-card-cam.png"><img src="media/crew-card-cam.png" alt="CREW card: Mags's camera feed, Crew combo 1, Strike, Entry Stack" width="250"></a><br><strong>Combo cam</strong><br>Mags's Entry Stack, round 1.</td>
    <td valign="top"><a href="media/crew-card-cam-duo.png"><img src="media/crew-card-cam-duo.png" alt="CREW card with two staggered feeds, Crew combo 2, Overwatch, Spotter Mark" width="250"></a><br><strong>A crewmate fires it</strong><br>Two feeds: Mags fires Juno's Spotter Mark.</td>
    <td valign="top"><a href="media/crew-card-feed.png"><img src="media/crew-card-feed.png" alt="Glitch feed CREW card: Mags, Entry Stack, Strike, Executed" width="250"></a><br><strong>Glitch feed</strong><br>The same card as a kill-feed line.</td>
  </tr>
</table>

## Cyberware diagnostics

Activated implants use a diagnostic panel with their body region, status, and charges. The underlying item activities still supply attacks, saves, and effects. [Cyberware, inventory, and slots →](Cyberware.md)

*Native captures: 0.7.38.*

<table>
  <tr>
    <td valign="top"><a href="media/implant-optics.webp"><img src="media/implant-optics.webp" alt="Kiroshi Optics: An activated effect displays the implant region and charges." width="310"></a><br><strong>Kiroshi Optics</strong><br>An activated effect displays the implant region and charges.</td>
    <td valign="top"><a href="media/implant-blades.webp"><img src="media/implant-blades.webp" alt="Mantis Blades: An implant melee attack uses the shared attack and damage controls." width="310"></a><br><strong>Mantis Blades</strong><br>An implant melee attack uses the shared attack and damage controls.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/implant-sonic.webp"><img src="media/implant-sonic.webp" alt="Sonic Shock: A save-based implant displays the target saving throws." width="310"></a><br><strong>Sonic Shock</strong><br>A save-based implant displays the target saving throws.</td>
    <td valign="top"><a href="media/implant-neural.webp"><img src="media/implant-neural.webp" alt="Neural Co-Processor: An always-on implant identifies its passive status." width="310"></a><br><strong>Neural Co-Processor</strong><br>An always-on implant identifies its passive status.</td>
  </tr>
</table>

## Short-rest monitor

These four captures show the dialog rather than separate chat posts. Roll one Hit Die at a time, inspect the treatment log, and complete the rest when ready. [Rests and recovery →](Rests.md)

*Native captures: 0.7.38.*

<table>
  <tr>
    <td valign="top"><a href="media/rest-8.webp"><img src="media/rest-8.webp" alt="Critical condition: The medical display is red at low HP." width="330"></a><br><strong>Critical condition</strong><br>The medical display is red at low HP.</td>
    <td valign="top"><a href="media/rest-15.webp"><img src="media/rest-15.webp" alt="Stabilizing: HP and the treatment log update inside the dialog." width="330"></a><br><strong>Stabilizing</strong><br>HP and the treatment log update inside the dialog.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/rest-25.webp"><img src="media/rest-25.webp" alt="Healthy: The monitor turns green as the character recovers." width="330"></a><br><strong>Healthy</strong><br>The monitor turns green as the character recovers.</td>
    <td valign="top"><a href="media/rest-picker.webp"><img src="media/rest-picker.webp" alt="Spell-slot recovery: Eligible recovery abilities open a picker with a level budget." width="330"></a><br><strong>Spell-slot recovery</strong><br>Eligible recovery abilities open a picker with a level budget.</td>
  </tr>
</table>

<details>
<summary>Watch the native short-rest monitor in motion · audited preview</summary>

<a href="media/rest-medscan-live.gif"><img src="media/rest-medscan-live.gif" alt="Recorded native short-rest ECG and HP display; one real Hit Die raises HP from 22 to 24" width="420"></a>

Thirty sequential native captures show the running trace and one actual Hit Die expenditure. [Recording provenance](Media.md#fresh-guide-screenshots-and-recording).

</details>

## Combined rest receipts

Completing the rest posts one combined receipt. Closing early produces an incomplete receipt while preserving Hit Dice already spent and healing already received. [Read the receipt →](Rests.md#one-final-receipt)

*Native captures: 0.7.38.*

<table>
  <tr>
    <td valign="top"><a href="media/receipt-short.webp"><img src="media/receipt-short.webp" alt="Short rest completed: HP, Hit Dice, and recovered resources appear together." width="310"></a><br><strong>Short rest completed</strong><br>HP, Hit Dice, and recovered resources appear together.</td>
    <td valign="top"><a href="media/receipt-arcane.webp"><img src="media/receipt-arcane.webp" alt="Recovery ability used: The receipt includes recovered spell slots." width="310"></a><br><strong>Recovery ability used</strong><br>The receipt includes recovered spell slots.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/receipt-long.webp"><img src="media/receipt-long.webp" alt="Long rest completed: The thermal slip records the completed long rest." width="310"></a><br><strong>Long rest completed</strong><br>The thermal slip records the completed long rest.</td>
    <td valign="top"><a href="media/receipt-incomplete.webp"><img src="media/receipt-incomplete.webp" alt="Rest cut short: Already-rolled healing remains recorded without completing resource recovery." width="310"></a><br><strong>Rest cut short</strong><br>Already-rolled healing remains recorded without completing resource recovery.</td>
  </tr>
</table>

## Typed messages

<a href="media/chat-thread-current.png"><img src="media/chat-thread-current.png" alt="Chat as a comm feed in QA Player's view: the GM and QA Player in public bubbles, Juno and Mags texting by phone, Mags in character, an emote across the feed, two whispers and the Breach Guard in character" width="300"></a>

*2026-10-18, QA Player's view.* What people type reads as a comm feed: notched portraits and cut-corner bubbles, your own on the right, a name line in the player's colour with the time. **Public** (Foundry's default mode) is the plain bubble, naming the player and the character they play. Marked: **in character** (the mode button or `/ic`) gets a cyan edge and a signal meter (red for anyone who isn't a player character); an **emote** (`/me`) is a status line across the feed; a **whisper** (`/w Name`, `/gm`) is a dashed violet bubble saying to whom; a **text from Smartphone Widget** is a green bubble saying to whom, by phone, in the sender's colour (the module's `[PHONE]` line becomes that tag). Messages in a row from the same voice, within five minutes, join the run above.

<a href="media/chat-light-mode.png"><img src="media/chat-light-mode.png" alt="The same feed in light mode: light bubbles under the Charged card, which stays dark" width="260"></a>

*Light mode (2026-10-18).* With Foundry's interface set to light, the feed turns light, with names in a deeper shade of each player's colour. Hardwipe's cards stay dark terminals in both schemes; their contents are pinned to the dark theme so Foundry's light text colours can't reach inside them.

## Plain rolls

<a href="media/roll-formula-current.png"><img src="media/roll-formula-current.png" alt="Roll card: Shotgun spread, 2d6 + 3, dice 2 and 4, plus 3, total 9" width="260"></a>

*2026-10-18, a roll typed in chat: `/r 2d6 + 3 # Shotgun spread` (no item; the title is the label after `#`).* A formula roll, a Hit Die, Hit Points or a recharge shows its dice as chips under the title (a die's top face lit, a 1 in red), with the total below; the total still opens the full breakdown.

## Edge, Strikes, and Downed

<table>
  <tr>
    <td valign="top"><a href="media/system-edge-current.png"><img src="media/system-edge-current.png" alt="Spent card: Juno, Edge spent, a cell draining to empty, Edge 0 of 1" width="250"></a><br><strong>Edge spent (2026-10-18)</strong><br>Just spend, with no play: the cell drains.</td>
    <td valign="top"><a href="media/system-downed-current.png"><img src="media/system-downed-current.png" alt="Downed card: Mags, Strike 1, 0 HP, Use Edge, ally action, or healing to recover, Stabilize 1 Edge" width="250"></a><br><strong>Downed (2026-10-18)</strong><br>A pulse that falters and which Strike this is; Stabilize for its owner while they hold Edge.</td>
    <td valign="top"><a href="media/system-flatline-current.png"><img src="media/system-flatline-current.png" alt="Flatline card: Juno dead, a trace that stops, no pulse, Strikes 3 of 3" width="250"></a><br><strong>Flatline (2026-10-18)</strong><br>Two beats, then nothing: Strike 3.</td>
  </tr>
</table>

### Edge plays

*2026-10-18, live in the QA world.* Spend opens the picker; each play posts its own card. Reroll's choice happens on the card whose die it changes.

<table>
  <tr>
    <td valign="top"><a href="media/edge-picker.png"><img src="media/edge-picker.png" alt="Spend Edge picker with Reroll, Interrupt, Stabilize and Execute tiles" width="250"></a><br><strong>Spend Edge</strong><br>Four plays; Stabilize greyed (not at 0 HP), Execute waiting on a target.</td>
    <td valign="top"><a href="media/edge-reroll-pick.png"><img src="media/edge-reroll-pick.png" alt="Die picker listing the Memory Merc's attack d20 and damage dice" width="250"></a><br><strong>Reroll: pick the die</strong><br>Recent cards and their dice.</td>
    <td valign="top"><a href="media/edge-reroll-attack-choose.png"><img src="media/edge-reroll-attack-choose.png" alt="Attack card with Juno's Edge strip: Keep 10 = 16 hit, Reroll 19 = 25 hit" width="250"></a><br><strong>On the attack</strong><br>Juno's choice on the Merc's attack card: keep 10 or take 19.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/edge-reroll-gm-ruling.png"><img src="media/edge-reroll-gm-ruling.png" alt="GM view: Now 8 vs AC 15, Mags was ruled hit, with Miss take back damage and Hit stands" width="250"></a><br><strong>The GM rules again</strong><br>A confirmed hit rerolled to 8 vs AC 15.</td>
    <td valign="top"><a href="media/edge-reroll-ruled-miss.png"><img src="media/edge-reroll-ruled-miss.png" alt="Attack card now Confirmed miss with Juno's Edge marker and GM: miss" width="250"></a><br><strong>Confirmed miss</strong><br>The banner flips and Mags's 9 damage comes back.</td>
    <td valign="top"><a href="media/edge-reroll-save-choose.png"><img src="media/edge-reroll-save-choose.png" alt="Save dial failed by 2 with Mags's Edge strip: Keep 3 failed, Reroll 17 saved" width="250"></a><br><strong>On a save</strong><br>Mags rerolls her failed DEX save: 3 or 17.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/edge-reroll-save-spell.png"><img src="media/edge-reroll-save-spell.png" alt="Fireball card listing Juno failed and Mags saved" width="250"></a><br><strong>The spell follows</strong><br>Mags moves to Saved; her damage is redone at half.</td>
    <td valign="top"><a href="media/edge-reroll-damage-choose.png"><img src="media/edge-reroll-damage-choose.png" alt="Fireball damage 32 with Juno's Edge strip: Keep 5 = 32, Reroll 3 = 30" width="250"></a><br><strong>On spell damage</strong><br>One of the Fireball's 5s: keep it or take a 3.</td>
    <td valign="top"><a href="media/edge-reroll-damage-taken.png"><img src="media/edge-reroll-damage-taken.png" alt="Fireball damage now 30 with the Edge marker" width="250"></a><br><strong>Damage taken</strong><br>32 → 30; applied damage adjusted for both targets.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/edge-interrupt.png"><img src="media/edge-interrupt.png" alt="Interrupt card: round 1, Mags's turn paused, Juno in the gap with 1 action" width="250"></a><br><strong>Interrupt</strong><br>Mags's turn torn open for one action.</td>
    <td valign="top"><a href="media/edge-interrupt-used.png"><img src="media/edge-interrupt-used.png" alt="Interrupt card stamped Done, Compact SMG in the slot" width="250"></a><br><strong>Interrupt used</strong><br>Juno's SMG shot used it: Done, the turn resumes.</td>
    <td valign="top"><a href="media/edge-interrupt-turn-tab.png"><img src="media/edge-interrupt-turn-tab.png" alt="Turn tab with the Interrupt chip under the action slots" width="300"></a><br><strong>On the Turn tab</strong><br>Until it's used or the turn moves on.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/edge-stabilize.png"><img src="media/edge-stabilize.png" alt="Stabilize card: a trace restarting, 1 HP from 0, the Strike undone" width="250"></a><br><strong>Stabilize</strong><br>1 HP, Downed cleared, the Strike taken back.</td>
    <td valign="top"><a href="media/edge-execute.png"><img src="media/edge-execute.png" alt="Execute card: a reticle and DROPPED, 30 to 0 HP no roll" width="250"></a><br><strong>Execute</strong><br>The Breach Guard drops, no roll.</td>
    <td valign="top"><a href="media/edge-charged.png"><img src="media/edge-charged.png" alt="Charged card: +1 Edge from the GM" width="250"></a><br><strong>Charged</strong><br>An award.</td>
  </tr>
</table>

<img src="media/edge-downed-strikes-0.7.39.webp" alt="Edge Spent, Downed with death saves disabled, and three-Strikes Flatline cards" width="900">

*Native captures: 0.7.39.* Edge announces a reroll expenditure. Downed directs the player toward recovery instead of death saves, and the third Strike announces Flatline. [Edge and Strikes →](Players.md#edge-strikes-and-downed)

## Shield Block

<table>
  <tr>
    <td valign="top"><a href="media/shield-choice-current.webp"><img src="media/shield-choice-current.webp" alt="Audited preview: native Shield Block choice with damage after defenses and available shield HP" width="330"></a><br><strong>Reaction choice · audited preview</strong><br>Choose Shield Block or Take damage when an equipped shield can absorb the hit.</td>
    <td valign="top"><a href="media/shield-hud.webp"><img src="media/shield-hud.webp" alt="Shield Block HUD records incoming damage, absorption, overflow, remaining durability, and a broken shield" width="330"></a><br><strong>Durability HUD · 0.7.40</strong><br>The result records incoming damage, absorption, damage through, and the broken state.</td>
  </tr>
</table>

[Shield rules and timing →](Combat.md#shield-block-uses-your-reaction)

## Walls and cover review

<a href="media/wall-impact-breach-review-0.7.39.webp"><img src="media/wall-impact-breach-review-0.7.39.webp" alt="Wall hit, five-foot breach, indestructible cover held, and private attack review examples" width="930"></a>

*Native captures: 0.7.39.* A wall impact reports its rolled damage, armor, and section HP. Destruction announces a five-foot breach; indestructible cover reports that it held. The final example is the private attack review. Wall damage retains its separate GM **Apply damage / Ignore** decision. [Wall types, targeting, and breaches →](Walls.md)


<a href="media/wall-area-review.webp"><img src="media/wall-area-review.webp" alt="GM review of a Fireball's wall damage: the sections it reaches and the proposed loss, with Apply and Ignore" width="330"></a>

*0.7.46.* An area spell's wall damage waits for the same GM review, section by section.
## Roll calls

<table>
  <tr>
    <td valign="top"><a href="media/roll-call-composer.png"><img src="media/roll-call-composer.png" alt="Roll call window with three participants, a Dexterity save, DC 13, Group" width="250"></a><br><strong>Ask</strong><br>The GM's Roll call window (Alt+R).</td>
    <td valign="top"><a href="media/roll-call-group.png"><img src="media/roll-call-group.png" alt="Group roll call: two passes, one fail, team passes" width="230"></a><br><strong>The crew rolls as one</strong><br>Two passes and a fail: the team passes.</td>
    <td valign="top"><a href="media/roll-call-contest.png"><img src="media/roll-call-contest.png" alt="Grapple contest: Athletics 21 against 1, Apply Grappled" width="230"></a><br><strong>Contests</strong><br>Two panels against each other, then Apply.</td>
  </tr>
</table>

<a href="media/party-requests-0.7.39.webp"><img src="media/party-requests-0.7.39.webp" alt="Party saving-throw request in GM and player views, plus a Perception check request" width="900"></a>

*Native captures: 0.7.39.* Request a check or save from a party. Owners roll for their characters, and results replace the waiting buttons. The GM view can include information withheld from the player view. [GM roll tools and settings →](GM.md)

Check and save requests are now drawn as a **roll call**, the same card the GM's Roll call window posts: one Roll button for your own characters, then each result with pass or fail when the DC is shown. Contests set two panels against each other. [Roll calls →](GM.md#roll-calls)

## Ordinary formula rolls

<a href="media/plain-rolls.webp"><img src="media/plain-rolls.webp" alt="Native ordinary 2d6 plus 3 roll and flavored Hacking the Door Panel roll" width="660"></a>

*Native captures: 0.7.39.* Plain rolls keep the formula and total. A supplied flavor becomes the readable title. These are ordinary roll cards, separate from attack approval or a short-rest dialog.

## Roll Tracker recap

<a href="media/roll-tracker-recap.webp"><img src="media/roll-tracker-recap.webp" alt="The Screamsheet recap card: a newsprint front page with headline, the lead natural 20 quote, the session's numbers, awards and a classified ad" width="260"></a>

*0.7.45.* **Post recap** turns a session into a Screamsheet front page in chat. [Roll Tracker →](GM.md#roll-tracker)

## Braindance

<table>
  <tr>
    <td valign="top"><a href="media/braindance-stamp.webp"><img src="media/braindance-stamp.webp" alt="Perception check with the BD stamp: The Afterlight tapes, BD Memory Merc, really QA Gunner" width="260"></a><br><strong>Every roll is stamped</strong><br>A check rolled in a memory carries the BD stamp and who really rolled it.</td>
    <td valign="top"><a href="media/braindance-clue-found.webp"><img src="media/braindance-clue-found.webp" alt="Player screen after a thermal scan: Burnt keycard on the canvas and the Clue found card" width="400"></a><br><strong>Clue found</strong><br>A scan that finds a clue reveals it on the canvas and posts what was learned.</td>
  </tr>
</table>

*0.7.47.* [Braindance →](Braindance.md)

## Mission Heat styles

Pick the mission’s presentation when starting it. Each style covers rising Heat, critical Heat, Lockdown, and a reduction in Heat. These montages show actual card states; they are still screenshots of interfaces that can animate. [Mission Heat →](GM.md#mission-heat)

### Threat broadcast

<a href="media/heat-threat-broadcast.webp"><img src="media/heat-threat-broadcast.webp" alt="Threat broadcast Heat cards with hazard stripes, escalation meter, and Lockdown stamp" width="940"></a>

*Native captures: 0.7.40.* Hazard stripes and a segmented meter announce the changing threat level.

### Corrupted feed

<a href="media/heat-corrupted-feed.webp"><img src="media/heat-corrupted-feed.webp" alt="Corrupted feed Heat cards with recording status, signal bars, and Heat percentage" width="940"></a>

*Native captures: 0.7.40.* A recording feed uses signal bars and percentages to show escalation.

### Police scanner

<a href="media/heat-police-scanner.webp"><img src="media/heat-police-scanner.webp" alt="Police scanner Heat cards with radar sweep and current Heat meter" width="940"></a>

*Native captures: 0.7.40.* Radar and scanner text frame the security response.

<details>
<summary>Start a mission and choose the Heat style</summary>

<img src="media/mission-heat-config.webp" alt="Mission Heat setup with Heat budget and card style selector" width="330">

*Native capture: 0.7.40.* Set the budget and choose the style before starting the mission.

</details>

## Turn-start styles

<a href="media/turn-styles.webp"><img src="media/turn-styles.webp" alt="Turn strip, timeline, and terminal turn-start cards with an Adrenal Pump Inject action" width="900"></a>

*Native captures: 0.7.40.* Choose a strip, timeline, or terminal presentation. The turn prompt can expose a qualifying Adrenal Pump **Inject** action. [Turn and interface settings →](GM.md)

## Ranged source advisory

<a href="media/ranged-advisory-current.webp"><img src="media/ranged-advisory-current.webp" alt="Roll mode scan under a ranged attack: the sources found and the mode to roll" width="302"></a>

*Native capture: 0.7.43.* The **roll mode scan** sits right under the attack roll. Each source evaluated by Ready Set Midi gets a row: ADV, DIS, or a block (NO ADV / NO DIS), with the source above the rule it comes from; a blocked source is struck through. Beside the title, **Roll** names the mode the sources call for: ADV, DIS, or Straight when advantage and disadvantage cancel. Only sources actually evaluated by Ready Set Midi appear. No evaluated source means no box. The roller or GM chooses the roll mode; the advisory does not change it. [Ranged hints and their limits →](Combat.md#ranged-hints-name-the-actual-source)

## Make the cards readable at your table

The GM can configure card colors, spell color rules, and save-button colors. Players can choose text size and settled-card folding. [Interface configuration →](GM.md) · [Capture versions and processing →](Media.md)
