# Walls: cover, durability, glimpses, and breaches

[← Overview](../README.md) · [GM setup](GM.md) · [Combat](Combat.md) · [Exact cover math](Reference.md#cover-calculation)

## Give a wall durability

| Manage presets | Apply a type to a wall — audited preview |
| --- | --- |
| <img src="media/wall-types-manager.webp" alt="Wall type manager with AC, HP, armor, and threshold fields" width="440"> | <img src="media/wall-config-current.webp" alt="Compact Hardwipe section at the bottom of Foundry's wall editor" width="380"> |

1. Open **Game Settings → Hardwipe Ruleset → Manage wall types**.
2. Create or edit a type with its material appearance, AC, maximum HP, starting HP, armor reduction, and damage threshold.
3. Select the scene wall and assign that type. In the public release, use **Wall Controls → Configure wall cover**. The audited preview also puts a compact Hardwipe section at the **bottom** of the native Wall Configuration window.
4. Save. Enable **Show damage and glimpses** for visible wear and sight/light slits.

Untagged solid walls are **indestructible cover**. A type existing in the manager does not assign it to every scene wall. Explicitly apply a type to each intended wall or selection.

| Initial type | AC | HP per five-foot section | Armor per impact | Damage threshold |
| --- | ---: | ---: | ---: | ---: |
| Glass | 10 | 10 | 0 | 0 |
| Light partition | 10 | 20 | 2 | 3 |
| Concrete | 10 | 40 | 5 | 10 |
| Reinforced wall | 10 | 80 | 10 | 15 |

These are editable presets. Create, duplicate, rename, or delete types in-app. Editing a preset does not retroactively change configured walls; reapply it to update them. Existing section damage remains unless **Reset section HP to starting HP** is selected. Lowering maximum HP clamps current HP.

## Threshold first, armor second

**Below the damage threshold, the wall takes no damage at all.** At or above it, subtract armor from the qualifying damage, then reduce that section's HP by the remainder.

For threshold **10** and armor **5**:

| Rolled damage | Section HP lost |
| ---: | ---: |
| 9 | 0 — below threshold |
| 10 | 5 |
| 14 | 9 |

Separate attacks do not accumulate toward the threshold. Healing and temporary HP do not damage walls. Old flagged walls without a threshold retain zero until reconfigured.

## Near misses can strike cover

Ranged attacks sample physical walls between the attacker and target. Melee attacks ignore cover. Partial cover adds AC; full physical cover prevents the shot from hitting the character, including on a natural 20.

For ranged weapon attacks, a partial-cover miss within **5 points below final AC** can strike the wall. Through full cover, compare the attack to **AC without cover minus 5**. A natural 1 never damages cover. The [rules reference](Reference.md#cover-calculation) gives the ray counts and a worked example.

## The GM approves every impact

<img src="media/wall-impact-breach-review-0.7.39.webp" alt="Wall impact results and the separate GM Apply damage or Ignore review" width="900">

The private review shows raw damage, threshold/armor context, section HP, proposed loss, and a breach warning. **Apply damage** changes HP and geometry; **Ignore** closes the proposal without changing the wall. This applies even to attacks rolled by the GM. A roll alone never changes wall durability.

Repeated approvals cannot apply one impact twice. Moved tokens, changed geometry, or changed durability can make a proposal stale and stop application. Pending review remains available after reload. Direct wall approval requires the GM to view that scene.

## Target a wall directly

![Actual Foundry wall targeting tool and selected five-foot section](media/wall-target-current.png)

1. Control one character you own.
2. Choose **Target wall** in Token Controls and click a visible wall.
3. Use an ordinary weapon attack from the character sheet.
4. On a hit against the wall's AC, resolve weapon damage and wait for GM Apply/Ignore.

The marker identifies the five-foot section. Melee needs reach; ranged attacks respect maximum range. **Audited preview:** long range gives a source-specific disadvantage hint and leaves roll mode to the player or GM.

Escape, movement, switching controlled characters, or changing scenes cancels selection. Creature targets are cleared for that use. An intervening intact wall blocks selecting another wall behind it; hidden secret doors and out-of-vision walls cannot be selected. Direct targeting covers ordinary weapon attacks, not spell attacks or area templates.

## Spell and area Wall Effects — development preview

Hardwipe bundles Walled Regions for native area placement and wall clipping. Open an area item's **Wall Effects** tab, check **Enable Walled Regions**, and choose the mode in the existing wall-interaction dropdown. The same choices are available in a placed Region's **Wall Effects** section.

| Item configuration | Private GM wall review |
| --- | --- |
| <img src="media/wall-effects-item-preview.webp" alt="Unreleased preview: Wall Effects tab with Damage walls — Half selected" width="420"> | <img src="media/wall-area-review-preview.webp" alt="Unreleased preview: original roll 30 becomes 15, loses 5 armor, and proposes 10 damage per section with Apply or Ignore" width="295"> |

| Mode | Area behavior | Wall durability |
| --- | --- | --- |
| Global default | Uses the configured default | No area wall damage |
| Do not block template | Original area passes through walls | No area wall damage |
| Block template | Area stops at walls | No area wall damage |
| Reflect/Spread template | Existing Walled Regions reflection or spread | No area wall damage |
| Damage walls — Normal | Area stops at standing physical walls | Proposes the full damage roll |
| Damage walls — Half | Area stops at standing physical walls | Proposes half the damage roll, rounded down |

For a Fireball-style effect, choose **Damage walls — Half**. Walls do not make a creature saving throw. Hardwipe starts with the original damage roll, applies the selected wall multiplier, checks the damage threshold, then subtracts armor. With threshold **10** and armor **5**:

| Original roll | Mode | Damage checked against threshold | HP lost per exposed section |
| ---: | --- | ---: | ---: |
| 18 | Half | 9 | 0 |
| 20 | Half | 10 | 5 |
| 30 | Half | 15 | 10 |
| 30 | Normal | 30 | 25 |

Each exposed five-foot section receives one proposed impact. Overlapping placements in the same cast do not hit a section twice. An intact wall shields walls behind it, including walls that have optical glimpse gaps. Destroying the front wall does not send that same blast onward to another wall.

Damage modes always use physical walls; the optical Wall Type selector is disabled for these modes. Circles, cones, lines, and rectangles are supported. **Emanations and rings require manual wall damage** in this version and display a warning when placed. Their ordinary spell damage can still be rolled.

The GM receives one private **Apply damage / Ignore** review for the cast, including all affected sections. Wall HP, surface marks, and geometry wait for approval. Changing the source area, damage roll, wall settings, or blockers invalidates the old proposal. A pending instantaneous area is retained so the GM can verify it; remove it after review when finished. **Undo last wall damage** restores the cast's wall changes together.

Use this bundled implementation with standalone Walled Regions and Walled Templates disabled. Existing `walled-regions` item and Region flags remain compatible. The source and bundled licenses are in [vendor/NOTICE.md](../vendor/NOTICE.md).

This is an unreleased development addition. It requires the matching Ready Set Midi build with pending-area retention. Direct non-area spell attacks against walls remain outside the wall-targeting tool's supported actions.

## Damage opens a glimpse before a breach

![Damaged wall with actual vision and light opening in a synthetic scene](media/wall-glimpse-current.png)

| Section HP | Surface | Vision and light | Movement and shots |
| --- | --- | --- | --- |
| Full | Intact | Original restrictions | Physical wall remains |
| Damaged, above half | Scar or crack | Original restrictions | Physical wall remains |
| Half or less | Cracked | 10% slit in the struck section | Physical wall remains |
| Quarter or less | Heavier damage | 20% slit | Physical wall remains |
| Zero | Five-foot breach | Destroyed interval open | Destroyed interval removed |

These are genuine Foundry vision and light openings. Players can glimpse tokens and illumination through the crack using normal vision rules. **Seeing through damage does not allow shooting through it** while the physical wall remains. Surface marks follow current vision and do not reveal unseen damage through explored fog.

At zero HP, Hardwipe removes that fixed five-foot interval and keeps the remaining segments. A short end section removes only the wall portion that exists. Door data, restrictions, direction, level membership, and adjacent section damage are preserved. Excess damage from the breach-causing shot never transfers to the character behind it.

## Undo and map artwork

**Undo last wall damage** restores HP, marks, sight/light boundaries, and breached geometry together, including after reload. Up to 20 snapshots are kept per scene. If someone has since edited the affected wall or its generated helpers, Undo stops to avoid overwriting their work.

Turning off damage and glimpses restores original sight/light restrictions and removes the visual helpers. Treat generated boundaries as module-managed; configure the physical parent wall.

Hardwipe changes Foundry wall geometry and overlays marks. It does not repaint the scene background. A wall drawn in the map art can remain visible after its collision boundary is breached. Cover is a two-dimensional footprint calculation on the scene level, without wall height, bullet penetration, or ricochets.
