# Player guide

[← Overview](../README.md) · [Cyberware](Cyberware.md) · [Rests](Rests.md) · [Combat](Combat.md) · [Card gallery](Cards.md)

## Start on the character sheet

Use **Hardwipe Character** as your character's sheet. Inventory, activities, effects, spells, and the ordinary D&D5e controls remain available. The chip tab opens your cyberware and the hourglass tab your [turn](#read-your-turn); the sidebar holds Edge and the Strikes tray.

![Current character sheet and implant states](media/cyberware-current.png)

The example shows online implants, a disabled spine implant, and damaged dermal equipment. State labels carry the meaning even when rarity colors change the frame.

## Use an action

![Cyberware actions listed in Inventory alongside the service pistol](media/inventory-actions-current.png)

An implant with an activity has a named action button on its **same inventory item**. Use it there or from Cyberware's detail panel. Activation cost and remaining charges are visible. Carried, disabled, and damaged implants cannot activate. Passive-only implants do not acquire an extra action.

Use weapons, spells, tools, and features through their normal activities. Their cards keep the relevant controls; selecting a roll total opens the dice breakdown.

*(Next release.)* A **tool** card has a **Roll check** button: the check's result lands on the tool card, and the check's own message folds to one line with its **+** and DIS/ADV. A **consumable** or **feature** reads as one card: what it did, who it hit, and **Details** for the description. Your **initiative** card shows where you are in the turn order and follows the others' rolls.

## Read your turn

<img src="media/turn-effects.png" alt="Active effects on the Turn tab: Overclock 30 sec, Steadied 9 min 30 sec, Night Optics 59 min 30 sec and Corp Sync 23 hr 59 min, each in a ring of its own length, with what they grant" width="420">

<img src="media/turn-panel-current.png" alt="Turn tab at the start of your turn: the netlink strip with a Perception roll call, DC hidden; the action, bonus action and reaction ready, 0 of 30 ft moved, 2 of 2 attacks left, and the Action band with weapons and the standard actions" width="420">

The hourglass tab is your **Turn** helper: where your turn stands, and what you can still do with it.

- **Action, Bonus action, Reaction.** Three chips at the top read **Ready** or **Spent**. On someone else's turn your action and bonus action read **Standby**, but your reaction stays live. While you're working through the Attack action, the action reads **Attacking · 1 left**. Click a chip to correct it, for example after a Help that had nothing to click.
- **Movement.** The distance you've moved this turn, read from your token's path, against your speed for the way you're moving. Difficult terrain counts what it costs. The cells turn amber at your limit and red past it.
- **Attack action.** How many attacks you have left out of what one Attack action gives you (**2/2**, **1/2**, **0/2**), with the feature that grants them (Extra Attack, Two Extra Attacks, Thirsting Blade). What counts is each activity's [Action type](#attack-action-or-action).
- **What you can use.** Below, one band per cost lists what you can spend it on: weapons in hand first, then implants, features and programs (with your spell slots beside them), each with to-hit or DC, damage and range. Click one to use it; hover its image for the full item. Consumables and tools fold away under **Gear**, and anything slower than a turn under **Outside combat**.
- **What's greyed and why.** A spent band greys its options (mid-attack, only what's left of the Attack action stays lit); using one anyway only warns you, since Action Surge exists. An option also says why it may not work now: **Not drawn**, **No uses left**, **No slots left**, an implant that's **Offline** or **Damaged**.
- **Opportunity attacks.** Your equipped melee weapons also sit in the Reaction band, with their first attack that is an Attack action. On someone else's turn, attacking with one from there spends your reaction.
- **Off your turn, you're asked.** Use anything that costs an action on someone else's turn from anywhere else (the Action band, your sheet, a macro) and a small **Reaction?** box asks whether that was your reaction. **Yes, spend it** spends it; **No** leaves it, and takes back a reaction Ready Set Midi marked for an off-turn attack. If your reaction was already gone, nothing asks.
- **Standard actions.** At the foot of the Action band, one row each for Dash, Disengage, Dodge, Hide, Grapple and Shove, with what it does and what it would cost right now. Dash, Disengage and Hide fall back to your bonus action once the action is gone, as Cunning Action allows. Dash doubles your movement, Dodge puts **Dodging** on you until your next turn, and Hide rolls Stealth. Grapple and Shove take one attack of your Attack action and roll Athletics; with exactly one creature targeted they post a [contest](#roll-calls-and-contests) instead. Click a taken row again to take it back. Help, Ready, Search and the like have nothing to track, so just tell the table.
- **Netlink.** The terminal strip above the chips lists the rolls the table is waiting on you for, each with a solid **Roll** button, so you don't have to dig through chat. Red is a save you owe right now (**Interrupt** for concentration, **Save** for a spell's save), amber a GM's **Roll call**, cyan a **Contest**. It says **DC 12**, or **DC hidden** when the GM keeps it to themselves. Saves you owe now come first; past the GM's limit the rest fold under **Show all**. After you roll, the strip shows **Sent to the GM** with your total for a few seconds. With nothing pending there is no strip.
- **Action Surge.** Using it on your own turn in combat gives the action back on this tab, with a fresh Attack action.
- **Active effects.** Each effect running on you (a stim, a spell, a GM's custom effect) shows its icon in a ring as long as it lasts, from a sliver for a round to the whole ring for a day, lit for the time left. It drains as rounds and game time pass. Beside it: the time left and what it grants (AC +2, Darkvision ≥ 60 ft). **×** removes it.
- **Running programs and conditions.** What you're concentrating on, with **End program**, and every condition on you with **×** to clear it. Exhaustion comes off one level at a time; a condition that comes from an item, such as an implant, isn't cleared here.
- **Edge & Strikes.** The same Edge and Strikes as the sidebar, with **Spend** (the Edge picker), and **Recover · 1 Edge** (Stabilize) while you're Downed. A live Interrupt shows under the action slots.

Everything resets when your turn starts; your reaction comes back then too. When Ready Set Midi counts reactions (its **Enforce Reactions** setting is anything but *Do not check*) or bonus actions (**Enforce Bonus Actions** prompts for characters or all actors), the chips follow Midi's markers, so they always match the icon on your token. Shield Block reads the same Reaction chip.

### Attack action or Action

<img src="media/activity-action-type.png" alt="Burst Fire's Activation tab: Cost Action, and Action type Action" width="420">

Anything that costs an action either is one attack of the Attack action, or takes the whole action. An activity with an Action cost has an **Action type** beside its **Cost**, on the activity's **Activation** tab:

- **Attack action:** one attack. Extra Attack gives you more in the same action, Grapple and Shove can take the others, and it can be an opportunity attack.
- **Action:** the whole action, like a burst of fire or a spell. Using it spends the action, and no attacks are left.

Until someone picks, weapon and unarmed attacks are **Attack action** and everything else, spell attacks included, is **Action**. The Cost stays D&D5e's own **Action**, so Ready Set Midi and other modules still see an action.

### Roll calls and contests

<img src="media/netlink-strip.png" alt="Netlink strip with four rolls: a concentration interrupt, a grapple to defend against with Athletics or Acrobatics, a Dexterity save roll call at DC 13, and an Athletics roll call with the DC hidden" width="420">

The GM can post a **roll call**: a check or a save for one or more of you, with or without a DC on show. It's a convenience, not a gate. When the GM just says "roll Perception", roll from your sheet as usual; a roll call only keeps everyone's results in one place.

- Press **Roll** on the card or on the netlink strip, or roll it from your sheet as usual: while a roll call waits on you for that skill, check or save, a matching roll from the sheet counts as your answer. The normal roll dialog opens, so advantage, bonuses and Edge work as usual. Your roll's own card folds to one dashed line under the roll call (**Answered on the roll call**); click it to open it again.
- The card marks each of you **Waiting**, then **Pass** or **Fail** with the margin when the DC is shown, or **Rolled** when the GM keeps it hidden. A group check also says whether the crew passes: at least half of you must.
- The GM can close a roll call, and it also closes on its own (by default at the end of the combat round it was posted in). It then leaves your strip, the card reads **Roll call closed**, and anyone who hadn't rolled shows **Skipped**.
<img src="media/roll-call-contest.png" alt="Grapple contest card: Athletics 21 against the drone's Athletics 1, a +20 margin, and the GM's Apply Grappled button" width="300">

- **Contests.** Grapple or Shove from the Turn tab with one creature targeted posts a contest card: your Athletics against its Athletics or Acrobatics (whoever controls it picks). When you defend, each button shows your bonus (**Athletics +5**, **Acrobatics +2**). The higher total wins and a tie goes to the defender; the card shows both totals and the margin, and the GM applies **Grappled** or **Prone** from it. With no target, or several, it's a plain Athletics roll.

## Crew maneuvers

A crew maneuver is a feature one character sets up and the rest of the crew pays off. What it does is written in the feature's description; its type (Strike, Overwatch and so on) decides who fires it and how long it lasts.

| Your armed maneuver | A crewmate's, that you fire |
| --- | --- |
| <img src="media/crew-turn-tab.png" alt="Crewlink panel: Armed · Strike, Entry Stack, Reaction · one weapon attack, with Fire · Heavy Pistol and stand down" width="360"> | <img src="media/crew-turn-incoming.png" alt="Crewlink panel: Juno · Overwatch, Juno has set up Spotter Mark, its description, and Fire · Heavy Pistol" width="360"> |

1. Use it from your Turn tab, where it's tagged **Crew**. It's now **armed**: your token shows its icon, and your Turn tab's **crewlink** panel lists it with how long it lasts.
2. The rest of the crew sees *Mags has set up Entry Stack:* and the feature's description in their own crewlink.
3. When the moment comes, whoever fires it presses the button:
   - a **Fire · weapon** button rolls that weapon and uses the firer's reaction (if that's already spent, Fire only warns);
   - a **Fire · activity** button uses the feature's own activity;
   - **Trigger** just posts the card.

   Some types are fired by the character who set them up; others by anyone else in the crew, from their crewmate's row.
4. **×** stands down without using it.

Nothing watches the table: the crew says when it happens, and the firer presses the button. The CREW card goes to chat, and an attack goes to the GM's review like any other.

| Combo cam (the usual card) | When a crewmate fires it |
| --- | --- |
| <img src="media/crew-card-cam.png" alt="CREW card, Combo cam: REC, crew link, R1 · T1, Mags's camera feed, Crew combo ×1, Strike, Entry Stack in large italic, Mags triggers Entry Stack" width="250"> | <img src="media/crew-card-cam-duo.png" alt="CREW card, Combo cam: two staggered camera feeds, CAM 01 · Juno and CAM 02 · Mags, Crew combo ×2, Overwatch, Spotter Mark" width="250"> |

The GM can switch the card to the compact **Glitch feed** instead.

## Edge, Strikes, and Downed

![Current Edge meter, expanded Strikes tray, unavailable implant actions, and shield HP in Inventory](media/resources-shield-current.png)

<img src="media/edge-downed-strikes-0.7.39.webp" alt="Edge spent, death saves replaced, and Flatlined announcements" width="800">

**Edge** is one point, earned by playing it cool: you hold at most one. **Spend** (sidebar or Turn tab) opens the picker with four plays; one that can't apply right now is greyed with the reason. **Just spend** spends it with no play, as before.

- **Reroll.** Any single die from anyone: an attack's d20 (yours, an ally's, an enemy's), one die of a damage roll, a save, a check. Pick the die from the list of recent cards (point at a card to find it in chat). The new die is rolled at once and both results appear on that card: you (or the GM) press **Keep** or **Reroll**, and everyone else sees that you're choosing. Taking the new die changes the card as any reroll does. Damage already applied is adjusted for everyone it hit. A save that flips moves that target between saved and failed on the spell, and their damage follows. An attack the GM already ruled on goes back to the GM, who rules again on the card: a hit that becomes a miss takes the damage back.
- **Interrupt.** One action or bonus action, now, even on someone else's turn. The Turn tab shows **Interrupt · 1 action or bonus action**. Your next action or bonus action uses it, off turn without asking whether it was your reaction. Or press **Action** or **Bonus action** on the card. It lapses when the turn moves on.
- **Stabilize.** At 0 HP: back up at 1 HP, Downed cleared, and the Strike from going down taken back. **Recover · 1 Edge** on the Strikes tray and **Stabilize · 1 Edge** on your Downed card do the same.
- **Execute.** Target one mook (an NPC without Legendary Resistance) and it drops to 0 HP with no damage roll. The GM's client applies it, so a GM must be online.

Each play posts its own card; an award posts a **Charged** card.

**Strikes** replaces the character death-save tracker. Open its tray to see the three cells and your status. At zero HP, a character becomes Downed under Hardwipe's rules; three Strikes means Dead. A qualifying long rest clears living characters' Strikes and Downed. An ordinary rest or Edge recovery cannot revive someone on three Strikes. NPC zero-HP handling stays separate.

The module blocks ordinary character death-save rolls and explains the replacement in chat. Healing and ally assistance remain available through the game's normal actions and the GM's adjudication.

## Who made your gun

*(Next release.)* A weapon, armour, consumable or tool has a **Manufacturer** field on its Details tab. Type a name or pick one from the list: Night City's makers from Cyberpunk 2077 and Cyberpunk RED, plus the campaign's own. A weapon from a maker with a style gets that maker's attack card (Arasaka, Militech, Kang Tao, Tsunami, Budget Arms, Malorian Arms, Constitutional Arms, Techtronika, Maelstrom, PALE and ????); any other maker shows its name on the card's bar. Leave it empty for the plain card. [Every maker's card →](Cards.md#weapon-makers)

## Roll initiative your way

| On the air | Under the camera |
| --- | --- |
| <img src="media/initiative-radio.png" alt="96.6 Pirate FM call-in: ON AIR, the host Mikey Max shouting 'Is that a flatline I hear? Not on my show! Move it, Mags!', Mags as the caller, a station dial, Your move caller: Initiative (DEX) +3, Go live and Hang up" width="360"> | <img src="media/initiative-ncpd.png" alt="NCPD dispatch terminal: 10-34 shots fired, round 1, 3 hostile; Mags on cam 19; a Post-it on the monitor reading 'Logging this one for the report. Method of engagement?'; Method of engagement: Initiative (DEX) +3; Log it and Look away" width="360"> |

*(Next release.)* Rolling initiative, from your sheet or the combat tracker, opens a window that asks what you're using. Two voices take turns: **96.6 Pirate FM**, where the host puts you on the air as the caller and the dial tunes to your pick, and **NCPD dispatch**, a night-shift cop watching the fight on a camera, with his question on a Post-it stuck to the monitor. Each has its own lines, and both mention the scene and the round.

The dropdown lists ordinary initiative first, then every skill with your bonus. Blending into a crowd when it kicks off, roll Deception; chasing your target, Athletics. The GM has the final say on what fits.

A skill rolls in place of your initiative modifier; condition penalties still apply. The initiative card names the skill, and its DIS/ADV switch works as usual. **Hang up** or **Look away** rolls nothing. The window can be resized, and it opens in the middle of the screen. NPCs and the GM's **Roll All** keep ordinary initiative.

## Attack and react

1. Target the creature and use your weapon or attack activity.
2. Choose normal, advantage, or disadvantage as appropriate.
3. Inspect the roll while the GM confirms the outcome.
4. Resolve eligible saves and reactions when prompted.

<img src="media/attack-review-gm.webp" alt="The GM's private attack confirmation controls" width="330">

GM review and wall review are separate decisions. A shot that strikes cover never silently damages the wall. [Combat](Combat.md) explains the cards and [Walls](Walls.md#target-a-wall-directly) explains direct wall targeting.

## Rest and recover

<img src="media/receipt-short.webp" alt="Combined short-rest receipt" width="330">

Open **Short Rest**, roll Hit Dice one at a time, and finish when ready. The chat receives one receipt instead of one message per die. Closing early keeps healing already rolled but does not complete resource recovery or implant swaps. [See the full rest flow](Rests.md).

## Inside a braindance

When the GM puts you in a memory, your NPC sheet opens and your token changes; play it like your own. The bar at the top right switches editing layers (**Alt+L**) and **Scan** (**Alt+S**) reads a spot on the canvas for clues. Traces only show on their layer. Your comfort controls are under the brain button; **Alt+Shift+B** hides the visuals on your screen. See the [Braindance guide](Braindance.md).

## Chat

*(Next release.)* What you type shows as a comm feed: your messages on the right, everyone else's on the left, a run of messages grouped under one name. The buttons over the chat box (or a command for one message) pick the kind:

| You use | It shows as |
| --- | --- |
| **Public** (the globe, selected by default) | A plain bubble with your name and your character |
| **In character** (the hat) or `/ic` | Your character speaking: a cyan edge |
| `/me` (or `/emote`) | A line across the feed: *Mags checks the mag* |
| **To GMs** (the spy), `/w Name` or `/gm` | A dashed violet bubble that says who it went to |
| **Blind** or **Self** | A plain bubble; Foundry already hides it from whoever shouldn't see it |

Texts sent with **Smartphone Widget** show as phone texts, to whom, in your colour. In Foundry's light mode the feed turns light; cards stay dark.

## Make cards comfortable to read

**Card text size** is your own preference: Normal, Large, or Extra large. **Fold settled cards after** keeps old results compact. Click a folded card or its header control to reopen it. Pending reviews and saves remain open. Reduced-motion preferences stop the decorative motion.

[Browse the card examples →](Cards.md)
