# Rules and integration reference

[← Overview](../README.md) · [Visual guides](Hardwipe-Guide.md) · [Development status](Development.md)

This page collects the details needed for adjudication or integration. Start with the illustrated feature guides for ordinary use. Public installer: **0.7.40 / Ready Set Midi 14.0.10.1**. Audited preview changes are called out in [Development](Development.md).

## Cover calculation

Ranged cover casts nine rays from the attacker's center to inset points across the target's footprint on the same scene level.

| Blocked rays | Physical cover |
| --- | --- |
| 0–4 | No AC bonus |
| 5–6 | Half cover: +2 AC |
| 7–8 | Three-quarters cover: +5 AC |
| 9 | Full physical cover: character cannot be hit through the wall |

<img src="media/wall-impact-breach-review-0.7.39.webp" alt="Cover held, wall impact, breach, and GM review examples" width="900">

Native status cover and attack-specific partial-cover reductions remain part of Midi's AC calculation. Full physical cover intercepts a shot after reactions and force-hit resolution. Melee ignores cover. Tagged ballistic glass blocks shots even when its sight/light restrictions are clear; open doors allow them through.

For a ranged weapon near miss, partial cover intercepts when the final total is at least **final AC − 5**. Through full cover, compare against **AC without cover − 5**. A natural 1 does not damage cover; a natural 20 does not bypass full cover. Range limits remain in force.

Example: base AC **15**, half cover **+2**, final AC **17**. A total of **12–16** can damage cover, **11 or less** misses, and **17+** hits the character. With full cover, **10+** can strike the wall while the character remains blocked. Wall damage still requires the GM's Apply decision.

Durability belongs to fixed five-foot intervals along the original wall. Threshold is checked against qualifying rolled damage before armor. Equal-to-threshold qualifies. Each impact is independent. Excess damage stops at cover. Scene grid scale and metric conversion determine five feet.

## Character and shield rules

Cyberware regions hold one package each. Hands, Legs, Eyes, and Arms are paired packages. Hands, Legs, and Eyes swap during a short or long rest without a Ripperdoc; every other region needs one. Installed, enabled, undamaged cyberware applies its native effects and activities. Carried, disabled, and damaged cyberware does not.

Shield Block spends the normal Midi reaction. Shield HP is saved on the equipment item, clamped to 0–10. Broken shields unequip; repaired shields require explicit re-equipping. NPC zero HP does not invoke character Strikes. Three Strikes remains Dead through normal rest and Edge recovery.

## Public integration surfaces

Use the managers instead of writing flags directly so ownership, queue, service, and state rules run.

| Surface | Purpose |
| --- | --- |
| `game.hardwipe.cyberware` | Classification, state, queue installation/removal, cancel, enable, reset, repair, service access |
| `game.hardwipe.cover.inspectCover({attacker, target, activity})` | Physical ray result, fraction, and first impact |
| `game.hardwipe.cover.manageWallTypes()` | Open the in-app type manager |
| `game.hardwipe.shields.damage(item, amount)` | Change shield HP through the manager |
| `game.hardwipe.shields.heal(item, amount)` / `.repair(item)` | Recover shield durability |
| `game.hardwipe.edge` / `.strikes` / `.heat` | Character resources and scene escalation |

| Stored data | Location |
| --- | --- |
| Cyberware category | Equipment `system.type.value = "hardwipe-<region>"` |
| Cyberware state | Item `flags["hardwipe-ruleset"].cyberware`: `version`, `installed`, `disabled`, `damaged`, `pending` |
| Wall durability | Wall `flags["hardwipe-ruleset"].cover` |
| Wall history and duplicate receipts | Scene Hardwipe flags |
| Saving-throw roster | Message `flags["hardwipe-ruleset"].saves` |
| Linked save result | Save message `flags.dnd5e.originatingMessage` |
| Per-spell card color | Spell `flags["hardwipe-ruleset"].cardColor` |

Ready Set Midi exposes `MidiQOL.hardwipeCoverBridgeVersion = 1` and the `midi-qol.computeCoverBonus`, `computeTargetAC`, `wallCoverRange`, `targetHitResolved`, and `coverAutoRollDamage` hooks. Canonical per-target resolution is persisted for GM verification. The companion's tested bundle is required for the audited preview; copying only a Hardwipe script is insufficient.

## Limits that matter at the table

Cover is two-dimensional within a scene level. Hardwipe does not model wall height, elevation penetration, token silhouettes, ricochets, bullet penetration, destructive map painting, or automatic Tile damage. Direct wall targeting supports ordinary weapon attack activities.

Generated sight/light helpers are module-managed and do not count as ballistic cover. Editing them manually can stop further damage or Undo until the parent is explicitly reconfigured. Undo retains up to 20 scene snapshots and refuses to overwrite intervening edits.

The audited Edge/Strikes queues serialize operations on **one client**; they are not a cross-client transaction guarantee. Third-party macros and roll modules need their own compatibility checks. There is no bundled implant balance compendium, cyberpsychosis subsystem, global Power Attack, Called Shots, or Sudden Charge rule.

The [original 0.7.40 guide](archive/Hardwipe-Guide-0.7.40.md) is retained as a historical release document. Its old fallback-damage and separate critical-application descriptions are superseded by the explicitly labeled audited preview.
