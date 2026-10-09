# Card gallery

[← Overview](../README.md) · [Combat](Combat.md) · [Rests](Rests.md) · [Cyberware](Cyberware.md) · [GM settings](GM.md)

Hardwipe gives each kind of action its own software-inspired display. Click any image to open the full capture. The examples use synthetic characters and scenes, so the QA names are demonstration data.

> **Release status:** the public installer is **0.7.40**. The 38 core examples below are native captures from **0.7.38**; later system examples are labeled **0.7.39** or **0.7.40**. Anything labeled **audited preview** comes from tested local source and does not imply a published 0.7.41 release. See [development status](Development.md) and [media provenance](Media.md).

[Weapons](#weapon-outcomes-and-gm-review) · [Spells](#spell-programs) · [Concentration](#concentration-interrupts) · [Checks](#checks-and-initiative) · [Gear](#gear-and-class-features) · [Implants](#cyberware-diagnostics) · [Rests](#short-rest-monitor) · [System cards](#edge-strikes-and-downed) · [Heat](#mission-heat-styles)

## Weapon outcomes and GM review

Use a weapon activity to make the roll; the GM confirms each target. The verdict, attack dice, damage breakdown, and apply controls share one card. [Combat and approval →](Combat.md)

*Native captures: 0.7.38.*

<table>
  <tr>
    <td valign="top"><a href="media/attack-hit.webp"><img src="media/attack-hit.webp" alt="Confirmed hit: The target verdict sits above the attack and damage totals." width="280"></a><br><strong>Confirmed hit</strong><br>The target verdict sits above the attack and damage totals.</td>
    <td valign="top"><a href="media/attack-crit.webp"><img src="media/attack-crit.webp" alt="Critical hit: Critical damage, cover, and target status remain visible together." width="280"></a><br><strong>Critical hit</strong><br>Critical damage, cover, and target status remain visible together.</td>
    <td valign="top"><a href="media/attack-miss.webp"><img src="media/attack-miss.webp" alt="Miss: A missed attack keeps its rolled result and any associated save controls." width="280"></a><br><strong>Miss</strong><br>A missed attack keeps its rolled result and any associated save controls.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/attack-fumble.webp"><img src="media/attack-fumble.webp" alt="Critical miss: A natural 1 is clearly marked after the GM decision." width="280"></a><br><strong>Critical miss</strong><br>A natural 1 is clearly marked after the GM decision.</td>
    <td valign="top"><a href="media/attack-review-gm.webp"><img src="media/attack-review-gm.webp" alt="Private GM review: Choose Hit, Critical, or Miss for each target; pending attacks wait for confirmation." width="280"></a><br><strong>Private GM review</strong><br>Choose Hit, Critical, or Miss for each target; pending attacks wait for confirmation.</td>
  </tr>
</table>

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
    <td valign="top"><a href="media/check-save.webp"><img src="media/check-save.webp" alt="Saving throw: The ability and total are easy to identify." width="280"></a><br><strong>Saving throw</strong><br>The ability and total are easy to identify.</td>
  </tr>
  <tr>
    <td valign="top"><a href="media/check-initiative.webp"><img src="media/check-initiative.webp" alt="Initiative: The initiative result uses the same roll language." width="280"></a><br><strong>Initiative</strong><br>The initiative result uses the same roll language.</td>
    <td valign="top"><a href="media/check-concentration.webp"><img src="media/check-concentration.webp" alt="Concentration save: The save card records the concentration outcome." width="280"></a><br><strong>Concentration save</strong><br>The save card records the concentration outcome.</td>
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

## Edge, Strikes, and Downed

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

## Party roll requests

<a href="media/party-requests-0.7.39.webp"><img src="media/party-requests-0.7.39.webp" alt="Party saving-throw request in GM and player views, plus a Perception check request" width="900"></a>

*Native captures: 0.7.39.* Request a check or save from a party. Owners roll for their characters, and results replace the waiting buttons. The GM view can include information withheld from the player view. [GM roll tools and settings →](GM.md)

## Ordinary formula rolls

<a href="media/plain-rolls.webp"><img src="media/plain-rolls.webp" alt="Native ordinary 2d6 plus 3 roll and flavored Hacking the Door Panel roll" width="660"></a>

*Native captures: 0.7.39.* Plain rolls keep the formula and total. A supplied flavor becomes the readable title. These are ordinary roll cards, separate from attack approval or a short-rest dialog.

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

<a href="media/ranged-advisory-current.webp"><img src="media/ranged-advisory-current.webp" alt="Audited preview: a ranged attack shows sources actually evaluated by Ready Set Midi" width="294"></a>

*Native capture: audited preview.* Only sources actually evaluated by Ready Set Midi appear beneath the roll. No evaluated source means no box. The roller or GM chooses the roll mode; the advisory does not change it. [Ranged hints and their limits →](Combat.md#ranged-hints-name-the-actual-source)

## Make the cards readable at your table

The GM can configure card colors, spell color rules, and save-button colors. Players can choose text size and settled-card folding. [Interface configuration →](GM.md) · [Capture versions and processing →](Media.md)
