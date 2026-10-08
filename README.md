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

---

# Hardwipe Ruleset 0.7.40

Character cyberware, physical wall cover and breaches for Foundry VTT 14.367 and D&D5e 6.0.5. This release works with the custom **Ready Set Midi 14.0.10.1** fork in this workspace. Update both modules together. Ready Set Midi replaces Midi-QOL and includes its own roll presentation; activate the fork with lib-wrapper, socketlib and DAE, and use its declared conflict rules.

## Character sheet and inventory

Use the **Hardwipe Character** character sheet. It extends the native D&D5e character sheet and adds a Cyberware tab while preserving native inventory, activities, effects and rest dialogs. The module registers it as the default character sheet. A character explicitly configured to use another sheet keeps that preference; change the character's sheet configuration to get the full Cyberware tab.

Create an **Equipment** Item and select one of the new **Cyberware: …** equipment categories. Put it in the character's inventory. The same Item appears in its body region on the Cyberware tab; the tab does not create a copy or a second inventory. Existing Items need explicit category selection. The module does not guess which existing equipment represents an implant.

The Cyberware tab places inventory slot cards on both sides of the approved translucent body scan. Each card displays the actual implant icon, name and state; selecting a card highlights its body region and opens that category's controls below. A status dot marks each state: filled green for enabled, hollow for disabled, red for damaged. Empty regions are dashed outlines. The doll has genuine alpha transparency. The slot cards share the implant cards' street-deck style: a dark scanline panel with a chamfered corner, the name in display caps, and a left edge coloured by state (cyan online, amber dashed when disabled, red when damaged). Empty slots are dashed outlines. The item list below the doll uses the same panels, with the same state-coloured edge. The panel around the doll adds no background texture. Implant controls in the detail panel are labelled buttons: power and service actions on the left, the queued **Install**, **Remove** or **Cancel** action on the right.

An installed, enabled and undamaged implant is equipped and applies its normal transferred passive Active Effects. User-disabled effects stay disabled. Installed implants that are disabled or damaged still occupy their slots, but their effects and activity use are suppressed.

When **SC - Item Rarity Colors** is active, filled Cyberware slot frames and item names follow its configured inventory border and title colors, including custom rarity tiers, gradients and glow. The selected category's item icons and names use the same settings. The installed implant supplies its slot's rarity; an empty installation previews the first stored item. SC's own inventory toggles control these effects and palette changes refresh open cards. Card panels keep their dark street-deck surface; SC supplies the border and name colours. The left state edge and state chip still distinguish enabled, disabled and damaged implants, and the gold selection, drawn inside the card, remains visible. With SC inactive, Cyberware keeps its normal appearance. Compatibility verified against SC 3.0.14.

For an implant with an explicit action, bonus action, reaction or other activation, configure a normal **D&D5e Activity on that same Equipment Item**. Its named activity and activation cost appear as directly usable controls on the Inventory row alongside weapons, and in the Cyberware detail panel. Native Inventory activation filters include it normally. The module does not create a duplicate weapon or feature. Uninstalled, disabled and damaged implants show unavailable action controls and the underlying use hook also blocks their use. Passive-only implants do not get an invented action. Hidden activities remain hidden.

The native equipment indicator reflects installation and explains the rest requirement; it cannot bypass the queued swap by toggling equipped directly.

Edge is a native sidebar meter directly below Hit Dice, with a labelled Spend control; the GM award button sits in its label row. While a character has Edge, the meter shows a lit circuit trace with a signal pulse running into Spend (still for users who reduce motion). Strikes uses the death-save tray beneath it, laid out like the native tracker in the street-deck style: three centred cells on a circuit trace that lights up to the latest Strike, the Stable, Downed or Dead status with the count, and a colour that moves from phosphor to amber to red, with hazard tape at Flatline. The tray tab shows the count and is tinted once a Strike is taken; small GM adjustment controls sit in the tray's corner. The labelled recovery action appears only when a living, downed character can spend Edge. The tray uses its actual content height, preserving access to its tab and its open state across sheet updates.

| Region | Equipment category | Swap service |
| --- | --- | --- |
| Brain Implant | Cyberware: Brain Implant | Ripperdoc |
| Spine | Cyberware: Spine | Ripperdoc |
| Torso | Cyberware: Torso | Ripperdoc |
| Arms | Cyberware: Arms | Ripperdoc |
| Hands * | Cyberware: Hands | Self |
| Legs * | Cyberware: Legs | Self |
| Eyes * | Cyberware: Eyes | Self |
| Nervous System | Cyberware: Nervous System | Ripperdoc |
| Audio | Cyberware: Audio | Ripperdoc |
| Dermal | Cyberware: Dermal | Ripperdoc |

Each region holds **one installed package**. Hands, Legs, Eyes and Arms represent a paired package, rather than separate left and right capacities. Any number of carried alternatives can remain in inventory. Equipment cards sit on both sides of the translucent front-view paper doll, showing real inventory icons, names and states. Selecting a card highlights its body region and opens its controls below the figure. Small regions (brain implant, eyes, audio) also get a ring around them when selected, so they read at sheet size. Every region with an installed implant is lit on the doll with a hatched glow: pale phosphor while online, breathing slowly; dashed amber when disabled; red when damaged. The selected region is gold. A thin gold callout line joins the selected slot card to its region. Custom paper dolls hide these overlays, as before. Charges show as slanted pale phosphor pips on installed slot cards and in the list below the doll. Each item in the list below the doll shows its description, with formatting, links and inline rolls. Long descriptions show three lines with **Read more**, and the toggle stays as you left it while the sheet is open. Disabled selections use a dashed highlight; damaged selections use the sheet's danger color. Counts come from the same inventory Items.

Cyberware replaces attunement for these Items. Installed cyberware is derived as equipped, consumes no attunement capacity, and hides common attunement fields in its Equipment editor. Ordinary equipment keeps its native attunement behavior. Native equip toggles cannot bypass installation.

## Short rests

The short-rest dialog rolls Hit Dice **one at a time**. Choose the die size, select **Roll Hit Die**, and see its result and the running total of HP actually recovered inside the dialog. Expand a result for its formula and dice breakdown. Multiclass characters retain their available die sizes; native D&D5e handles CON, roll modifiers, Hit Dice consumption, and maximum HP. Individual Hit Dice do not create chat cards. Completing the rest posts the system's one combined rest summary, and normal resource recovery and queued qualifying cyberware swaps still run.

The dialog is a Ripperdoc med-scan monitor that takes the patient's health colour: red below a third of maximum HP (**Critical**), blue below two thirds (**Stable**) and green above (**Healthy**). It changes as dice heal. The heart trace sweeps across the screen like a live monitor, an erratic arrhythmia while critical; with reduced motion turned on in the browser, it stays still. A large HP readout shows what has been recovered. The HP bar shows the HP you started with in grey, then a striped segment for each die, and a dashed range for what the next die could give. Each die size is a chip showing how many are left. The treatment log lists every roll; open one to see its faces and bonus, and whether healing was capped at maximum HP.

**Rest abilities** lists features meant for a short rest: any activity that activates on a short rest (the same ones dnd5e offers on its rest card), plus Arcane Recovery and Natural Recovery. **Use** runs the feature as usual. Arcane Recovery and Natural Recovery open a spell-slot picker instead: pick expended slots up to half your Wizard or Druid level in combined levels, none above level 5, then **Recover slots** spends the feature's use and restores them. **Also restored when you rest** previews what completing the rest brings back: feature and item uses (with each formula shown when it is rolled), pact slots, resources, and queued implants, including those that stay queued without a ripperdoc. Ticking **New Day** adds what recovers at dawn, dusk or each day.

Each die and its healing apply immediately, matching the native workflow. Closing the dialog keeps them and posts one recovery summary, but does not complete the rest, recover rest resources, or apply queued swaps. Opening a second dialog for the same actor on one client focuses the first. Hit Dice rolled directly from the sheet, long rests, party rest requests, and another module's custom rest dialog retain their normal behavior.

### Rest receipts

Every rest summary in chat prints as a safehouse receipt: short rests, long rests, and short rests closed early. It lists HP recovered (with each Hit Die rolled), Hit Dice, spell slots and item or feature uses that came back, rest abilities used in the dialog (with the slots Arcane Recovery brought back), then implants installed, removed or still queued, and Strikes or Downed cleared by a long rest. A rest closed early is stamped **Rest incomplete**; a long rest that ends at full HP is stamped **Fully patched**. Players who can't see the character see only the HP and Hit Dice lines, as with dnd5e's own card. Activities offered after a rest stay under the receipt.

## Personal paper dolls

Owners without Foundry's **Browse Files** permission get a compact **Image path or URL** dialog instead of a file browser. They can paste a GM-supplied Foundry image path or an HTTP(S) image URL. Uploading and browsing still follow the world's normal file permissions.

Right-click the body image in the **Cyberware** tab and choose **Choose paper doll image**. Foundry's native image picker lets you browse or upload a PNG, WebP or another supported image, or paste its Foundry path or web URL. The GM or character owner can change it. The choice saves per character and is shared with other users viewing that character. Closing the picker without selecting an image leaves the current doll unchanged. Right-click again and choose **Use default paper doll** to remove the override. Keyboard users can focus the doll and press **Shift+F10** or the context-menu key. There is no permanent customization button on the sheet.

Use a transparent portrait image with the entire figure visible; **1024 × 1536** is the recommended frame. Images retain their aspect ratio. The default scan has no continuous nose-to-pelvis line or central pelvic hub. Missing custom images fall back to the default without erasing the saved path. Invalid legacy flag values also use the default.

Inventory slot cards, item rarity colors, selection and implant controls work with either image. Default body-region highlights remain on the default scan. Custom images hide those fixed-coordinate overlays because a different character's proportions may not match them; the selected slot card and its detail panel still identify the active category. Changing the artwork never changes equipment, implant states or effects.

## Installation and states

Use **Queue installation** or **Queue removal** in the Cyberware tab. Choosing a replacement queues removal of the installed package and installation of the alternative as one region plan. Cancelling that plan retains the installed package.

- **Carried:** in inventory, passive effects suppressed and activities unavailable.
- **Installed and enabled:** occupies its region, passive effects and activities available.
- **Disabled:** remains installed and occupied, with passive effects and activities unavailable.
- **Damaged:** remains installed and occupied, with passive effects and activities unavailable.
- **Queued:** a pending installation or removal; the current installation stays in effect until a qualifying rest completes.

Hands, Legs and Eyes may be swapped by their owner during a **short or long rest**. Other regions require a **short or long rest with a Ripperdoc**. The GM declares current Ripperdoc access using the small **Service** control in the tab header, which shows Ripperdoc and tools access as lit or dimmed icons; the module does not infer medical service from an NPC name or proximity. If service is absent, the ordinary rest completes and those queued swaps remain pending.

Rest changes are merged into the native D&D5e rest's Item updates. Installation does not refill charges unless the Item's normal recovery rules do so. Existing user-disabled Active Effects stay disabled.

Owners can enable or disable an installed, undamaged implant. **Reset** clears disabled state; **Repair** clears damage. These service actions require Cyberware tools or Ripperdoc access, or a GM override. Service availability is GM-controlled and the menu stays collapsed until opened. The cyberware Equipment editor has a compact GM-only damage toggle for adjudicating EMP, sabotage or injury without a new dialog. This release supplies the states and controls; it does not add a universal EMP attack, humanity score or cyberpsychosis roll.

## Walls as cover

Enable **Automatic wall cover** in the module settings. The patched Ready Set Midi workflow uses scene walls as physical obstacles during ranged attack resolution, including transparent ballistic glass. Open doors allow shots through. Melee attacks ignore cover, including native cover-status AC and optional AC reactions.

The calculation casts nine rays from the attacker's center to inset points across the target's footprint on the same scene level:

| Blocked rays | Physical cover |
| --- | --- |
| Fewer than 5 of 9 | No AC bonus |
| 5 or 6 of 9 | Half cover, +2 AC |
| 7 or 8 of 9 | Three-quarters cover, +5 AC |
| All 9 | Full cover; the character cannot be hit through that wall |

Native status cover and attack-specific partial-cover reductions continue through Midi's AC calculation. Full physical cover intercepts the shot after reaction and force-hit resolution. Cover does not waive weapon range limits.

For **ranged weapon attacks**, the player targets the character normally. The module decides whether the shot strikes an intervening wall:

- Partial cover: a missed attack hits cover when its final total is **at least final AC minus 5**. A lower miss does not damage the wall. A successful character hit damages the character.
- Full physical cover: the character is blocked. A total **at least AC without cover minus 5** hits the wall; a lower total misses.
- A natural one never damages cover. A natural twenty cannot pass through full physical cover.
- Roll normal weapon damage for a qualifying impact. If Midi's selected mode automates damage, a cover impact permits its damage roll even though the character was missed. A deliberately manual damage mode stays manual.
- Check the raw weapon damage against the wall's damage threshold. Below the threshold, the section takes no damage at all. A qualifying roll then subtracts wall armor, and the remainder reduces the section's HP. Healing and temporary HP rolls do not damage walls.
- Excess damage stops at the wall. Breaching cover never transfers the same shot's overflow to the character.

For example, a character with AC 15 behind half cover has final AC 17. An attack total of 12–16 damages the intervening wall, 11 or less misses, and 17 or more hits the character. Behind full cover, a total of 10 or more hits the wall while the character remains protected.

## Durability and breaches

As GM, open **Settings → Game Settings → Hardwipe Ruleset → Manage wall types**. The small manager lets you create, edit, duplicate and delete named types. Each type defines material appearance, AC, maximum and starting HP, armor reduction and damage threshold. These initial values are editable:

| Wall type | AC | HP per section | Armor per impact | Damage threshold |
| --- | ---: | ---: | ---: | ---: |
| Glass | 10 | 10 | 0 | 0 |
| Light partition | 10 | 20 | 2 | 3 |
| Concrete | 10 | 40 | 5 | 10 |
| Reinforced wall | 10 | 80 | 10 | 15 |

Select one or more walls in **Wall Controls**, then use **Configure wall cover** (brick icon) and choose a saved type, custom values, or indestructible cover. Durability is per five-foot section. Existing HP and damaged sections are preserved unless **Reset section HP to starting HP** is checked; lowering maximum HP clamps current HP. Editing or deleting a type never changes walls already configured. Reapply a type explicitly to update those walls. Concurrent GM edits are serialized through the active GM, and stale edits to the same type are rejected.

Untagged solid walls are indestructible cover. Explicitly tagged ballistic glass blocks shots even when its sight and light restrictions are clear. Existing wall flags without a damage threshold retain threshold 0 until reconfigured. Thresholds do not accumulate across separate attacks. For example, against threshold 10 and armor 5, a damage roll of 9 causes zero damage; a roll of 10 causes 5 damage; a roll of 14 causes 9 damage.

### Direct wall attacks

Players can control one character they own, choose **Target wall** in Token Controls, and click a visible wall. A marker highlights the five-foot section. They then use a normal weapon attack from the character sheet. The native attack roll is checked against that wall's AC; a hit rolls the weapon's normal damage and posts the same GM **Apply damage / Ignore** review. Weapon use and ammunition remain in the native activity workflow. A natural one misses. Creature targets are cleared for that use, so selecting a creature afterward cannot redirect the wall attack or offer that creature a reaction. Melee attacks need to be within reach; ranged attacks respect normal and long range, with disadvantage at long range.

Escape, changing the controlled character, moving the attacker or switching scenes cancels selection. An intervening intact wall blocks selection of a wall behind it. Players cannot select hidden secret doors or walls outside current visibility. Only the DM can apply wall damage. Direct targeting supports ordinary weapon attack activities; spell attacks, area attacks and special range formulas supplied by other modules are outside this feature's scope.

HP belongs to fixed five-foot intervals along the original wall. When a section reaches zero, the module deletes that interval and creates the remaining wall segments. Repeated off-center impacts in the same interval share HP. A section clipped by a wall end, or an entire wall shorter than five feet, removes only the existing wall portion. Remaining segments preserve door data, movement/sight/light/sound restrictions, direction, level membership, unknown flags and damage in adjoining sections. Five feet uses the scene's grid scale, including metric conversion.

**Undo last wall damage** restores the previous HP, surface marks, sight/light boundaries and any breached wall section together, including after reloading. The module refuses to overwrite walls or visual helpers that have since been edited. The scene retains up to 20 undo snapshots; duplicate-impact receipts persist so replaying an old card cannot damage a wall again. Legacy breach snapshots remain supported.

Every qualifying wall impact waits for a GM decision, including attacks rolled by a GM. A GM-only chat prompt shows the weapon's rolled damage, the wall's armor reduction, the struck section's current and proposed HP, and whether applying it would open a breach. The prompt is a street-deck card: material and section, the protected target, rolled damage minus armor as chips, and a section HP bar whose proposed loss blinks until the GM decides. A breach adds a Breach warning. **Apply damage** applies that proposal and stamps the card Applied; **Ignore** closes it without changing wall HP or geometry and stamps it Ignored. Applied impacts post a matching Wall hit, Wall breached or Cover held card. Pending prompts remain available after reload. Repeated approvals cannot apply the same impact twice. An attack or damage roll alone never changes wall durability or opens a breach.

The active GM serializes Apply and Ignore decisions. Only a GM may make either decision; Player socket requests cannot apply wall damage. The receiver verifies the originating chat message, actor ownership, speaker, activity, canonical attack and damage rolls, target AC resolution and current geometry before applying an approved impact. Changed tokens, wall coordinates, physical obstruction samples, or durability values stop stale damage. A failed approval stays pending for review. For direct attacks, the GM must view the attack's scene when applying it. Cover and hit calculation remain automatic; HP and geometry changes require the explicit GM action.

### Surface damage and glimpses

**Show damage and glimpses** is enabled by default in **Configure wall cover**. Damage uses transparent surface marks for glass, light construction, concrete and reinforced walls; it adds no panel background or global texture. Marks appear at the struck section and grow through three stages:

| Section HP remaining | Appearance | Vision and light | Movement and shooting cover |
| --- | --- | --- | --- |
| Full HP | Intact | Original wall restrictions | Original physical barrier |
| Damaged, above half HP | Small scar or crack | Original wall restrictions | Full barrier retained |
| Half HP or less | Cracked surface | A slit spanning 10% of the struck section | Full barrier retained |
| Quarter HP or less | Heavier surface damage | The slit widens to 20% | Full barrier retained |
| Zero HP | Five-foot breach | The destroyed interval is open | That interval is removed |

These are genuine Foundry sight and light openings: players can see tokens and receive illumination through the slit according to their normal vision and lighting. Seeing a target through a crack does not make it shootable through that wall. The continuous parent Wall still supplies physical cover and movement collision until destruction. The breach-causing shot never passes excess damage to the target.

Sight and light use separate generated Wall boundaries that preserve the parent's level, direction and threshold settings. These helpers never count as ballistic cover. Already transparent glass stays transparent. Opening and closing a damaged door, moving its parent wall and removing the wall synchronize or remove its helpers. When the parent is unchanged, switching scenes or reloading preserves the helper IDs and Undo snapshots.

Surface marks follow the player's **current vision** on the scene level; newly damaged surfaces behind an obstruction are not revealed through explored fog. Scenes without token vision show the surface marks normally. Damage and openings appear only after the GM presses **Apply damage**, including for GM attacks and even when Midi automates the weapon's damage roll. Armor that absorbs all damage creates no new mark.

Selecting a generated sight boundary for **Configure wall cover** resolves to its physical parent. Turning off **Show damage and glimpses** restores the original sight/light restrictions and removes the generated marks and boundaries. The optional reset clears section damage. Generated helpers are managed by the module; if one was manually edited, further damage or Undo stops to preserve that edit until the DM explicitly reconfigures the parent.

The feature overlays existing map artwork. It does not repaint or cut holes in a Scene background image. A destroyed wall may therefore remain drawn on the map, even though its Foundry wall boundary is open.

## GM-confirmed attacks

**GM-confirmed attacks** (module setting, on by default) requires approval for every attack against a creature, including GM rolls, NPC attacks, and attacks against player-owned characters. The attack card shows the weapon and its rolls with an **Awaiting GM** verdict. Players can inspect the rolls as usual, but the result stays hidden. The GM gets a private review card for each target showing the total, the AC including cover, and the margin, with **Hit**, **Critical** and **Miss** buttons. Ready Set Midi's computed result is pre-selected. With several targets, the GM sets each one and presses **Confirm all**. The attack card then updates for everyone to **Confirmed hit**, **Critical hit**, **Confirmed miss** or **Critical miss**. If the targets have different results, the verdict reads **Mixed results** and each target row carries a small hit or miss icon.

- Damage is rolled immediately but applied only after the decision. A miss applies nothing.
- A natural critical (normally a 20) is always a critical hit, and a natural 1 is always a critical miss. Both wait for the GM's explicit confirmation of that rule outcome.
- A melee hit 10 or more over AC proposes a critical, which the GM confirms or downgrades. With the setting off, the 10-over-AC melee rule upgrades the attack automatically, as before.
- A critical chosen by the GM rolls the weapon's damage dice once more, without modifiers. If every damaged target is a critical, the extra dice join the attack's own damage. Otherwise they are applied to the critical targets separately.
- The attacker's Ready Set Midi workflow waits for the decision, then applies damage, effects and macros as normal. If that client reloads or disconnects first, the GM's decision applies the rolled damage stored on the card instead, and on-hit effects must be applied by hand.
- If a review cannot reach a GM, the workflow stops without applying damage and reports the problem. Reconnect a GM and roll again. A GM's own attacks use the same approval card and resume locally.
- Weapon attacks use the styled weapon and roll cards whether or not they need GM review. An attack without a creature target shows **Attack** without inventing a hit or miss. Direct wall attacks keep their separate GM-only **Apply wall damage** / **Ignore** review.
- Deleting a pending attack card cancels its workflow.
- The banner and the review card tag the attack as **Ranged attack**, **Melee attack** or **Cyber attack**. Spell attacks are cyber attacks.
- The weapon's name is the card's title, next to a gem. With SC Item Rarity Colors active, the name glows and the gem shines in its rarity colour from SC's palette. The bar above the title shows the weapon type and rarity.
- Below the title: the attack type and activity, the weapon's range, properties and mastery as icon chips, the verdict strip, and one row per target. Target rows carry no result text: the rail colour, the lock ring around the portrait and a gentle animation show it. Last comes the item's description in a labelled panel, in normal body text. It shows three lines with **Read more** and **Show less**, opened separately for each viewer. The item's own Attack and Damage buttons are not shown, because those rolls are on the roll card below.
- Each target row notes the target's cover when the attack was rolled, such as **½ cover · Concrete**. That's Hardwipe wall cover, named after the wall's material, or a cover status on the target, whichever is greater. It's recorded on the card, so moving tokens later doesn't change it.
- When a target drops to 0 HP, the most recent card that targeted it is stamped on that target's row, or with a small icon in its save row. The stamp reads **Downed** for a player character, or **Flatlined** for an NPC or a character who is dead or on three Strikes. The active GM's client records it, and later events don't change older cards.
- The attack and damage rolls sit on their own card. The damage shows as one total that glows in a blend of its damage types, weighted by damage dealt. Under it, a thin bar is split by damage type and sized by damage dealt, with the split listed underneath. Hovering a segment shows its amount and lights that type in the list and the drawer; clicking the bar opens the drawer, like the total. Each damage roll, including a weapon's save damage, gets its own total and drawer. Clicking a roll opens its dice in a drawer right below it: the attack drawer shows the d20s (a dropped die is struck through), the modifiers, the total and the formula, and the damage drawer shows the dice grouped by type, each glowing in its type's colour, with extra critical dice marked Crit. Under each damage total, above the Shield Block, a row of **×1**, **½** and **×2** buttons applies the whole total (every damage type, with resistances counted per type) to your selected or targeted tokens; a healing total gets **Heal** and **Temp HP** instead. The last button, **Targets** (with a count), applies the total to the card's own targets instead (the user's own token for a self-heal): the targets hit by an attack, or for save damage those who failed (and half to those who saved, when the save halves it); its tooltip names them. Every application is logged under the row (who, how much each token's HP changed, by whom) for GMs and whoever applied it, with **Undo** to give the hit points back. If a retroactive roll leaves an attack without damage (a natural 1), the damage section says **No damage · critical miss** instead of showing the old numbers. They replace Ready Set Midi's own row on these cards and stay locked while the GM decides or saves are outstanding.
- The attack's header line carries a **Dis | Adv** switch with the current mode lit. Clicking the other side switches the roll through Ready Set Midi's retroactive advantage: it rolls the extra d20 and redraws the card, and the dropped die is greyed. Only the roller and the GM can use it; everyone else sees the mode.
- The roll card's rail and attack box take the verdict's colour: amber while the GM decides, green for a hit, cyan for a critical, dim for a miss, and hazard tape for a critical miss. A critical also frames the damage total in cyan with a **Crit · dice ×2** chip.
- On a card that was just rolled, the d20 flickers briefly before settling, damage totals count up, and a natural 1 glitches the attack box once. Cards seen later (after a reload, or scrolling back) never animate, and reduced motion skips it.
- Each damage type in the damage drawer has quick ½, ×1 and ×2 buttons that apply that type's damage to your selected or targeted tokens, following Ready Set Midi's *Apply damage to* setting. They use dnd5e's damage application, so resistances, immunities and vulnerabilities count. The buttons unlock once the GM has decided, because the attack applies its own damage on that decision. Damage that depends on a saving throw also waits until every save is in.
- On attack and spell cards Hardwipe's pale phosphor green replaces dnd5e's gold accents (roll boxes and rules, the natural-d20 badge, icons and outlines), and the natural-20 badge is the critical cyan. The **Card accent** setting switches them back to dnd5e gold. Other chat cards keep dnd5e's gold.
- While the GM decides, the attacker can still switch the roll to advantage or disadvantage, or add a bonus. The review card then shows the current total and notes the change. Once the attack is resolved, the switch locks (a padlock shows) and the bonus control is hidden. A critical is always the GM's call, so the reroll-as-critical control does not appear on these cards.

## Saving throws on cards

When a weapon or spell calls for a saving throw (a poisoned blade's Constitution save, a Cone of Cold), its card shows a **Saving throw** block under the damage. It lists the ability and DC, a button coloured by ability (Strength red, Dexterity green, Constitution orange, Intelligence blue, Wisdom teal, Charisma violet), and each target with their roll and **Saved**, **Failed** or **Waiting**.

- The button appears only to someone who owns a target still waiting. A player rolls their own characters' saves, with the usual roll dialog when it is a single save. The GM's button reads **Roll pending saves** and rolls every outstanding save at once.
- The save is a normal dnd5e saving throw made as that token and linked to the card. Ready Set Midi's waiting save resolves exactly as if it had been rolled from its own prompt, so half damage, effects and macros follow as usual.
- Results update on every client as each save comes in.
- It works on any Ready Set Midi card with a save, including NPC attacks on player characters, which the GM review doesn't cover. On a weapon, the save is the save activity Ready Set Midi runs as the attack's other activity.
- Ready Set Midi waits for players' saves only when its player-save setting asks players to roll. When it rolls saves automatically, the block simply lists the results.
- The **Saving throw colours** setting can switch every save button to Hardwipe amber.

## Spell cards

Every spell card is a small program window framed like a browser: the spell's file (`cone_of_cold.prg`) and **Info** are its two tabs, and the address bar shows the caster and a process number. The status badge at the end of the address bar shows **Running** while saves are outstanding, **Awaiting GM** while a spell attack is under review, and **Exit 0** once it's done.

- **Output** (the file's tab) shows the spell's name with a school gem, its level, school, target, casting time and components, and the description cut to three lines with **Read more**. Below that come the attack verdict and target rows for spell attacks, then the saving-throw table with a progress bar for saves.
- **Info** shows the full description and the spell's components, casting time, range, target, duration, school, save and level. The tab you pick stays on your screen only; nobody else's card changes.
- The spell's own buttons (Damage, Healing, Place template, Consume resource and so on) sit in the window's footer and work as before. Attack and save buttons are left out: the roll card and the save block replace them.
- The roll card sits below the window, with the same dice drawers, damage bars, chips, verdict colours and per-type apply buttons as weapon cards.
- **Spell card colour** picks one of four schemes. **One colour** uses **Spell card base colour** (violet by default) for every spell. **By school** uses a colour per school of magic, or SC Item Rarity Colors' school colour when that school's colour is enabled there. **By player** uses the casting player's colour. **Per spell** uses **Card colour** on the spell sheet's Details tab, which appears in that mode; any spell without one uses the base colour. Changing any of these recolours the cards already in the log.

Ambient sweeps on verdicts, save buttons and pending rows run briefly every six or seven seconds instead of looping. With reduced motion they stop.

## Implant cards

Using an implant's activity posts a diagnostic panel instead of the usual item card.

- A header with the implant's file name (`kiroshi_optics.sys`), its body region and an **Online** light. Cyberware can only be used while installed, enabled and repaired, so later damage never changes an older card.
- The default paper doll with that region lit, and a ring around small regions (eyes, audio, brain implant). A scan passes down it once when the card is posted; reduced motion skips it.
- The activity type (Activated, Melee attack, Ranged attack, Save, Heal, Damage or Reaction), the name in its SC rarity colour, the activation, target or range and duration, and charges as lit pips.
- A strip for each effect the activity applies, with its duration.
- For attack implants, the verdict and target rows from GM-confirmed attacks. For save implants, the saving-throw block.
- The description panel, and the item's own buttons (Apply effects, Damage, Place template, Refund and so on) in the footer.
- The roll card below, as on weapon cards. An activity that rolls nothing gets no roll card.

## Check cards

Ability checks, skill and tool checks, saving throws, concentration and death saves, and initiative rolls post a compact panel.

- A bar in the ability's colour names the roll (**Skill check**, **Saving throw** and so on) with the ability's abbreviation. The skill, tool or ability is the title, with the ability beside a skill. The **Saving throw colours** setting turns every bar amber; death saves are red and initiative cyan.
- The **Dis | Adv** switch sits beside the title and works as on attack cards.
- The roll is one box between rules in the bar's colour (Ready Set Midi's own rules beside each box included), with the natural d20 on its corner (cyan for a natural 20, red for a natural 1). An advantage or disadvantage pair sits side by side with the dropped die dimmed. Clicking the roll opens its dice and formula in a drawer.
- A roll against a DC adds a **Success** or **Failure** strip, and the box takes that colour, when dnd5e's challenge visibility lets the viewer see it.

## Item and feature cards

Every other item use, such as a potion, a tool, a piece of gear, a class feature, a feat or a monster ability, posts a spec panel. Items are phosphor green, and features are signal orange.

- A bar with the item type, subtype and rarity (or **Feature** and its kind), and the quantity or the feature's requirement.
- The item's image (a hexagon for features), its name in its SC rarity colour, and the activity used with its type. Ready Set Midi's activity types read as dnd5e's (**Heal**, not *Midi Heal*) here, on weapon cards and in the Cyberware tab.
- Activation, range, target, duration and properties as icon chips; uses as pips with the recovery period; the check or save the activity asks for; a strip for each effect it applies; the saving-throw block when the card knows who must save; and the description panel.
- The item's own buttons (Damage, Healing, Ability Check, Apply effects, Place template and so on) and dnd5e's target picker sit in a strip under the roll card, or under the panel when nothing has been rolled yet, and work as before. Spell and implant cards use the same strip, in the spell's colour or implant cyan.
- Uses and charges show as they were when the card was posted, so using the item again never changes older cards (cards from before 0.7.28 still show the current uses).
- The roll card below, as on weapon cards. Healing shows one **Heal** button per type in its drawer, and no Shield Block.

## Card colours

**Card colours** in the module settings (GM only) opens a window with a colour picker for every colour the cards use, in six groups:

- **Card types**: item, feature and implant cards.
- **Hardwipe system cards**: Edge spent, Downed, Flatlined, Shield Block, Heat rising and dropping, critical Heat and Lockdown, wall hit and cover held, wall breached and shield broken, and the GM reviews.
- **Rolls, turns and requests**: dnd5e's roll-only messages, turn starts and roll requests.
- **Results**: waiting for the GM, hit, critical hit (and the natural-20 badge), miss, critical miss (and the natural-1 badge), save or check succeeded, save or check failed, and the Targets button and applied log.
- **Abilities**: the six ability colours used by save buttons and check cards (the **Saving throw colours** setting can still turn them all amber).
- **Damage types**: each damage type's glow, split bar and dice, plus healing and temporary hit points.

Each picker has a reset, and **Reset all** restores Hardwipe's palette. Colours apply to everyone and recolour the cards already in the log. Spell colours keep their own settings.

## Concentration checks

When a concentrating character takes damage, the request to roll a Concentration save posts as the held spell's program window (`bless.prg`, in the same browser frame as spell cards), whispered to the character's owners and the GM as before. It shows the spell, how long it has been running and the damage taken, and an amber **interrupt** screen with a **Roll CON save** button and the DC. Nothing rolls on its own: the player or the GM presses the button, with the normal roll dialog for advantage and bonuses. Ready Set Midi's automatic roll is skipped for these requests, and its end-on-failure still applies.

When the save lands, the window switches to a green **recovered** screen, or a red **flatlined** crash screen with the roll and a stop code, and the save's own card collapses to one line under it (click to open). When a character falls unconscious or is incapacitated while concentrating, dnd5e's prompt becomes a **Host offline** screen with **End program**, which ends concentration.

## System cards, rolls, turns and requests

Hardwipe's own announcements use the card style: a coloured bar with an icon and what happened (Edge, Downed, Strikes, wall impacts and the GM reviews), the headline, the detail and a footer. Shield Block is a targeting HUD: corner brackets, the shield's durability, what came in, what it absorbed and what got through, and a ruled HP bar with the HP just lost flashing; a broken shield reads **Shield offline**. Heat and Lockdown use the style picked when the mission starts (below). Each kind has its own colour in the Card colours window, they follow the text size, and they fold like other cards once nothing on them waits for the GM. Cards already in the log take the new look.

dnd5e messages that were plain dnd5e get the same frame: roll-only messages (a Hit Die, class Hit Points, a formula roll, a recharge, and a plain /roll or macro roll) show what was rolled in the bar and the dice below, with their breakdown on click as before. A turn start is a slim card in one of three styles (world setting **Turn start card**): a ticker strip with the round and the turn order as ticks, an initiative timeline with a node per combatant, or a terminal line. Each shows what came back, and the turn's activities as buttons that still use them. Hidden combatants are left out of the turn order. A roll request (from a party's sheet) shows the roll asked for and the DC, then each party member with a Roll button, their total, or a tick.

## Concentration, text size and folding

- A concentration save card names the spells held when it was rolled (**Holding Bless**). On a success it adds **Concentration held**; on a failure it is stamped **Concentration lost**, and if the concentration effect is still on the actor (Ready Set Midi ends it itself unless set not to), its owner and the GM get **End concentration**.
- **Card text size** (Normal, Large, Extra large) scales the text and numbers on Hardwipe's chat cards for you only.
- **Fold settled cards after** (Never, 2, 5 or 10 minutes, default 5) shrinks attack, spell, implant, item and feature cards, system cards and settled GM reviews to their title, verdict and totals once they are that old and nothing on them waits for the GM or for saves. Folding pauses while you are scrolled up the log. Click a folded card, or the fold toggle beside its timestamp, to open it; your choice lasts for the session.

## Interface conventions

Sheet, item-editor and chat additions use native D&D5e chrome with one rule set. Gold marks what you can act on or what is selected: buttons, focus, the selected slot and its body region, and section labels in native condensed capitals. Green, amber and red mark state only: enabled or sound, queued or worn, damaged or broken. They use the same hues as the Mission Heat HUD's Clean, Hot and Critical states. Every Hardwipe sheet control shares one button style. The Strikes tray, wall cards, attack cards, Mission Heat HUD and other Hardwipe chat cards use the street-deck look, with matching chamfered controls. On every Ready Set Midi card, the attack roll is laid out like the damage roll: each d20 result sits in its own box between gold rules, with the natural die as a corner badge (green for a natural 20, red for a natural 1; on Hardwipe cards the badge is a hexagon with the number centred, cyan for a natural 20). An advantage or disadvantage pair sits side by side with the dropped die dimmed. Damage totals glow faintly in their damage type's colour, as do the dice in their breakdown. Hovering an attack roll on another card shows the advantage and disadvantage arrows; Hardwipe cards use the **Dis | Adv** switch instead. Hovering a damage roll shows the critical-damage die. Both glow softly. Glows on chat cards are a tight 2px edge, buttons and bars are flat fills, and scanlines appear only on screens: the roll boxes, the implant read-out, the concentration screens and the short-rest monitor.

## Mission Heat

The Mission Heat HUD opens beside the scene controls and navigation, clear of the sidebar. Drag its header to move it; the position is kept per client across re-renders and reloads. With no mission running it is a slim bar, and the GM gets a **Start Mission** button. During a mission the meter marks the Hot (50%) and Critical (75%) thresholds. The token-controls thermometer button shows or hides it.

**Start Mission** also picks the **Heat card style** for that mission's chat announcements. Each card shows the change on a Heat meter (one cell per point, coloured Clean, Hot, Critical and Lockdown, new cells flashing and lost cells left as ghosts):

- **Threat broadcast**: marching hazard tape, a title that slices and splits, the meter, and the line scrolling as a ticker. Lockdown strobes and stamps NCPD.
- **Corrupted feed**: a hijacked camera feed with static, a REC light, letters knocked out of line, a jittering Heat percentage and VU bars. Lockdown floods it with red.
- **Police scanner**: a radar sweep that picks up more contacts as Heat climbs and spins faster in Lockdown, beside the state and a Heat bar.

Heat cards posted before 0.7.40 show in the threat broadcast style without the meter. All motion stops for players who turn on reduced motion.

## Other rules and scope

Shield Block spends the character's **normal Midi reaction**, with exact shield absorption and overflow. Wall-only damage does not offer or consume Shield Block. Other reaction use prevents Shield Block, and the shared reaction resets through Midi's normal turn handling. NPC zero HP does not invoke character Strikes/Downed. Three Strikes remain dead through ordinary rest and cannot be bypassed with Edge recovery.

The compact Shield Block button appears on a damage card only when its applicable targets include a character you can control with an equipped shield. Carrying a shield does not qualify. Native D&D damage trays follow their recorded-target or selected-token source; alternate roll cards use controlled or targeted tokens. Equipping, unequipping, changing selection, spending a reaction or rebuilding a native target list refreshes existing cards. An equipped shield with an unavailable reaction displays a disabled button with a reason. This UI update does not change the reaction-expiry integration described in the release QA report.

Shield HP is stored on the actual Equipment Item. Its readout is a number badge beside one cell per HP point, with nothing drawn over the cells; it turns amber at 60% or less, red at 30% or less, and shows Broken at zero. The item editor and inventory meters refresh from that saved state after damage, healing, repair and Shield Block. Each client queues HP changes per shield, including Shield Block, so overlapping local edits use the result of the preceding write. The editor briefly disables all HP adjustment controls while its update is pending. HP stays within 0–10; zero marks the shield broken and unequips it. Healing or repair clears the broken state, but does not automatically re-equip the item. Macros can use `game.hardwipe.shields.damage(item, amount)`, `.heal(item, amount)` and `.repair(item)`.

Cover is a **two-dimensional footprint calculation within a Foundry scene level**. This release does not model wall height, elevation penetration, token silhouettes, destructible map artwork, automatic damage to Tiles, ricochets or bullet penetration. A breach changes Foundry wall geometry and therefore subsequent cover/vision/movement checks; background art remains unchanged. Implant content and balance are authored as normal Equipment Items and Active Effects; there is no new implant compendium in this release.

## Integration data

Cyberware classification uses `system.type.value = "hardwipe-<region>"`. Item state lives in `flags["hardwipe-ruleset"].cyberware` with `version`, `installed`, `disabled`, `damaged` and `pending`. The public API is `game.hardwipe.cyberware`; use its installation, cancellation, reset and repair methods so region and service rules remain enforced.

Wall material and section HP live in `flags["hardwipe-ruleset"].cover` on the Wall document. Scene flags hold breach history and duplicate receipts. `game.hardwipe.cover.inspectCover({attacker, target, activity})` returns the sampled result, fraction and first physical impact.

A card with a saving throw records its save list in `flags["hardwipe-ruleset"].saves` (`ability`, `dc` and `targets` with token `uuid`, display `name` and `img`), written by the caster's client; results are read from dnd5e save messages whose `flags.dnd5e.originatingMessage` is the card. A spell's own card colour lives in `flags["hardwipe-ruleset"].cardColor`.

Ready Set Midi exposes `MidiQOL.hardwipeCoverBridgeVersion = 1` and the `midi-qol.computeCoverBonus`, `computeTargetAC`, `wallCoverRange`, `targetHitResolved` and `coverAutoRollDamage` hooks. Canonical per-target resolution is persisted on originating cards for GM verification. The bridge also supports forced normal-reaction consumption while retaining cancellable reaction hooks.
