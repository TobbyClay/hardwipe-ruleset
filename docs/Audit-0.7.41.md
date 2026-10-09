# Audited runtime fixes: 0.7.41 candidate

[Release status](Development.md) · [Combat](Combat.md) · [Walls](Walls.md)

This development branch brings the complete audited Hardwipe source cohort into Git. It is a **draft**, not an installable public release. Public 0.7.40 remains unchanged. The matching Ready Set Midi 14.0.10.2 candidate must be released with it; do not substitute a rebuild of the stale workspace dist.

## Corrections

| Area | Corrected behavior |
| --- | --- |
| Ranged choices | Player/GM chooses Normal, Advantage, or Disadvantage. Only sources evaluated by Ready Set Midi appear; no unconditional manual-mode notice. Ranged weapons, ranged spells, and Thrown mode are covered. |
| Wall editing | Compact controls at the bottom of native Wall Configuration assign a saved type and preserve or explicitly reset section HP. |
| Approval | Every targeted creature attack waits, including GM/NPC attacks and player-owned targets, natural 20/1, and non-damaging attacks. Keyed rerolls and current chat state reject stale decisions. Saves, damage, and on-hit effects cannot run early. |
| Missing workflow | Stop without automatic stored-damage fallback. A live workflow must resume resolution; otherwise roll again. |
| Criticals and shields | Per-target critical dice join native damage before mitigation/Shield. Matching type/property groups aggregate before resistance rounding. Manual and prompted Shield Block share mitigation ordering. |
| Privacy and context | Hidden checks, formula/recharge/usage information, save linkage, and same-Actor unlinked token boundaries retain visibility and identity checks. |
| Character state | Same-client Edge spends and Strike updates serialize; no cross-client transaction guarantee is claimed. |
| Wall state | Surviving-endpoint lookup retains neighboring section HP after a breach; GM Apply/Ignore remains separate, including repeat/stale refusal and Undo. |

## Exercised verification

Disposable native clients used **Foundry 14.367 / D&D5e 6.0.5 / Hardwipe 0.7.41 candidate / Ready Set Midi 14.0.10.2 candidate** with separate authenticated GM and Player sessions. This is bounded regression coverage, not every possible spell, geometry, module, or persistence failure.

| Area | Evidence scope |
| --- | --- |
| Checks | 15 GM + 15 Player cases: ability, skill, save, tool, concentration in all three roll modes; native totals matched displayed totals. |
| Additional rolls | 11 GM + 10 Player cases: weapon/spell roll modes, damage/healing/temp HP, reroll persistence, PC death-save replacement, GM initiative. |
| Targeted approval | GM/Player/NPC/owned-PC targets, natural 20/1, no-damage activity, reroll/stale decision, mixed criticals, follow-up saves, and missing-GM failure. |
| Privacy | 62 assertions per viewer across public, GM, blind, and self modes and token/request boundaries. |
| Shields | Pending refusal, normal/resistant/immune, decline/manual/resisted-manual, temp HP, break/unequip, overkill, mixed critical + save + reaction. |
| Walls | Type CRUD/assignment, preserve/reset HP, partial/full/open/glass/melee cover, threshold 9/10/11, Apply/Ignore, stale/repeat refusal, Player direct attack, breach/neighbor/Undo, prepared vision/light preview, permission refusal. |
| Rests and sheets | One die at a time, no intermediate chat, combined receipt, HP cap/cancel/no dice/silent rest, native implant service rules, rarity colors, restricted-player paper-doll picker and persistence. |
| Independent contracts | Combat 65/65; critical arithmetic/manual 16/16; independent critical/property 24/24; privacy/context 24/24; Midi privacy 8/8; wall methods 36/36; earlier inferred advisory checks superseded by [actual Midi attribution acceptance](Audit-Midi-Attribution.md). Counts overlap and must not be summed as unique scenarios. |

All nine audited Hardwipe replacements match the candidate hashes. All eleven JavaScript files in this source cohort pass Node syntax checks, and the manifest's local entrypoints exist. The source PR adds fourteen functional files relative to public main; unchanged files are preserved.

## Release prerequisites and limits

The required **actual tested companion bundle** SHA256 is:

```text
FB6BA1AB4F49A601CBE8D4DF3C4F4F2BD87F8730A1B229209158EE977E2D0FF6
```

The candidate packages were verified against their exact local release baselines, replacing only audited entries. Before publication, assign coherent release/download identities, include the tested companion, verify the actual ZIP payloads, and run release/upgrade acceptance. The draft manifest's future release URL is not an available installer.

Not certified: all third-party rules, all spells/effects, all levels/elevations/door directions, simultaneous writes across clients, every long-rest recovery rule, exhaustive interruption between persistence writes, or a production upgrade. Installed Midi forces detail-mode damage; the legacy-false receipt path has method-level coverage only. A small pre-existing concentration uptime display issue at world-time zero remains outside these fixes.

No campaign data, QA controls, local license, server logs, or test-world database is included in the repository. Documentation screenshots use synthetic data.

## Later integration and correction

[Integrated Wall Effects acceptance](Audit-Wall-Effects.md) adds Normal/Half area wall damage with private GM approval. [Actual Midi attribution acceptance](Audit-Midi-Attribution.md) replaces the earlier guessed ranged source list. These later cohorts use companion JavaScript SHA256 `40CBB1E42A49565A1EAABE4488B0B9B05E21740A29EC17CB49BB4AB4A201D7FD`, preserved in the [preview artifact](../preview/README.md). The earlier companion hash above remains historical, not the current preview requirement.
