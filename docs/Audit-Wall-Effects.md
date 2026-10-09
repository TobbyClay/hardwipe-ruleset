# Integrated Wall Effects preview — 2026-10-09

Status: implemented in the development branch and verified in an isolated native Foundry world. No public release was created or replaced; the production module installation and campaign data were not changed.

Environment: Foundry VTT 14.367, D&D5e 6.0.5, Hardwipe development 0.7.41, tested Ready Set Midi preview metadata 14.0.10.2. GM and Player used separate browser sessions. The QA server bound only to 127.0.0.1:30003, and its process identity was checked before shutdown. The original QA world script and world manifest were restored after testing.

## Implemented behavior

- Bundled the local MIT-licensed Walled Regions 0.9.4 fork under Hardwipe, with host registrations and asset paths moved to Hardwipe and document flag compatibility retained.
- Added **Damage walls — Normal** and **Damage walls — Half** beside the existing Reflect/Spread mode in item and Region controls.
- Damage modes clip at standing physical walls. Optical damage helpers, sight thresholds, and one-way perception do not carry blast damage through intact physical cover.
- Each exposed five-foot section receives one impact per cast. Multiple placements retain their own origins; overlapping placements do not duplicate damage.
- Damage starts with the canonical original roll, applies the selected multiplier and rounds down, checks threshold, then subtracts armor. Walls make no saving throw.
- A separate private GM **Apply damage / Ignore** review controls all durability and geometry changes, including GM casts. Disabled Wall Effects do nothing even when a damage mode remains saved.
- All affected sections are planned from one original scene snapshot. Breaching a front wall does not propagate that same blast to a rear wall. Mutation and undo group the cast's changes.
- Pending instantaneous areas remain available for review instead of disappearing during automatic cleanup. Remove the area manually when finished with review.
- Corrected native D&D5e Region identity validation, inactive standalone flag access, scene-level sweep inputs, multiple placements in one Region, and delayed synchronization after Region deletion.

## Automated source checks

| Check | Result | Evidence |
| --- | --- | --- |
| Geometry, exposure, thresholds, rounding, doors, levels, holes, narrow visible slices, anchored sections, breaches, overlap, disabled modes | 16 passed | `geometry-tests-final.txt` |
| Production placement-count helper: native shapes, source shapes, holes, empty Region, legacy document | 6 passed | `placement-helper-checks.json` |
| JavaScript syntax across Hardwipe, vendor runtime, and Ready Set Midi bundle | 118 files, zero errors | `syntax-checks-final.json` |
| Full Workflow.ts transpilation syntax | Zero errors | `placement-helper-checks.json` |
| Manifest paths and bundled license files | Passed | `verify.cjs` |

Run these checks from the workspace with `node _release-audit/walled-regions-hardwipe-2026-10-09/verify.cjs`.

## Native GM/Player acceptance

The UI casts used native activity use, template placement, Damage Roll dialogs, and the actual chat Apply/Ignore controls. The visible QA fixture only created synthetic actors, items, walls, and scenes; exposed inspection controls; and invoked the real undo/negative permission API checks.

| Scenario | Observed result | Primary evidence |
| --- | --- | --- |
| Item configuration | Normal and Half appear beside Reflect/Spread; selected mode persists after close/reopen | `wall-effects-item-final.png`, interactive UI trace |
| Placed Region configuration | Normal override persists; physical damage hint displays and optical Wall Type is disabled | `wall-effects-region-final.png` |
| Player Half 30 | Seven front sections propose 10 damage each; walls stay at 40 pending approval; applying leaves each at 30 | `player-half-pending.json`, `gm-half-applied.json` |
| Half 18, threshold 10 | Structural roll 9 fails threshold; no HP or history changes | `gm-below-applied.json` |
| Half 20, threshold 10, armor 5 | Structural roll 10 qualifies; five HP lost per section | `gm-equal-applied.json` |
| GM Normal 30 | Private approval still required; no automatic mutation | `gm-normal-pending.json` |
| Ignore | Pending review resolves without changing walls | `gm-normal-ignored.json` |
| Reload then Normal approval | Canonical saved review works after GM reload, with full workflow snapshots disabled; seven sections reach 15 HP | `gm-normal-applied-after-reload.json` |
| Damaged optical glimpse wall | Front physical parent remains the only affected wall; rear wall is protected | `gm-glimpse-pending.json` |
| Breach 50 | Exposed front wall intervals removed; rear wall remains at 40; victim stays at 100; one history entry | `gm-breach-applied.json` |
| Grouped breach undo | Original front coordinates and HP restored in one undo | `gm-breach-undone.json` |
| Duplicate approval | Confirmation returns false and changes nothing | `gm-half-undone.json` checks |
| Player controls and API | Zero Apply damage buttons in Player UI; direct approval call denied | Native interactive trace; `player-half-final.json` confirms Player identity and pending unchanged walls. The earlier direct API denial was observed interactively; its check array was not separately saved. |
| Stale wall HP | Changing HP to 39 before Apply rejects the old proposal; no section changes or history entry | `gm-stale-rejected.json` |
| Two origins in one native Region | Source origins (450,450) and (1050,150) retained; seven front plus five rear sections; one review | `gm-twin-pending.json` |
| Multi-wall apply and undo | Each of 12 sections loses 10 HP once; one undo restores both walls | `gm-twin-applied.json`, `gm-twin-undone.json` |
| Fully overlapping placements | Two source shapes create only seven unique impacts, with HP 30 rather than 20 | `gm-overlap-pending.json`, `gm-overlap-applied.json` |
| Existing Spread mode | Native spell cast completes; no structural proposal or wall damage | `gm-spread-no-wall-damage.json` |
| Unsupported ring | Explicit manual-wall-damage warning names the spell; ordinary damage rolls; wall HP unchanged | Native warning trace, `gm-ring-unsupported.json` |
| Disabled saved Half mode | Native Region with enabled=false and damage-half creates no structural proposal or damage | `gm-disabled-no-wall-damage.json` |
| Final enabled regression | Enabled Half cast still applies 10 HP to seven sections after GM approval | `gm-final-sync-applied.json` |
| Final deletion cleanup | Zero Regions remain, original wall HP restored; no document-update/deletion errors | `final-cleanup-state.json`, `final-cleanup-errors.json` |

`native-acceptance.json` contains 22 programmatic assertions over the captured native state. These are postconditions from actual runtime interactions, not a simulated Foundry environment.

Earlier attempts exposed deleted-Region synchronization races and a test-reset Tile cleanup race. The vendor synchronization was fixed to use current membership and one native update. The disposable reset now explicitly owns helper cleanup and suppresses the ordinary parent-deletion cleanup hook. Final fresh-session checks passed; its only captured error was the initial browser-height notice before the usable viewport was applied. The intentionally stale approval produced an expected error notification in its own test.

## Scope and limitations

- Native circles and a ring warning were exercised. Cone, line, and rectangle support comes from the bundled shape implementations and geometry review; each shape was not separately cast in this bounded audit.
- Emanations and rings require manual wall damage in this version. Direct non-area spell attacks remain outside the direct wall targeting tool.
- Creature saving throw and damage mitigation are independent of structural damage. This audit did not rerun every creature save/reaction/module combination or the previous full targeted-attack approval suite.
- No-GM behavior remains pending with a warning by source inspection; disconnecting every GM during a new cast was not separately exercised here.
- Disable standalone Walled Regions/Walled Templates when using the bundled implementation; conflict metadata and namespace guards prevent duplicate ownership.
- This work does not claim inclusion in any remote ZIP or public release.

## Local artifacts

`package-preview.py` creates the two explicitly named preview ZIPs and reads their actual contents back, comparing every file against the source used to create it. It verifies manifest entry paths, module identity, CRC integrity, source/QA runtime agreement, and bundled license files. `package-verification.json` records versions, hashes, sizes, and source metadata provenance.

The Ready Set Midi preview package uses the tested QA 14.0.10.2 manifest and assets with the freshly built, verified bundle. The workspace source/dist base manifests remain 14.0.10. This is a local preview cohort, not a versioned release publication.

Full screenshots remain here; cropped native captures are also included in Hardwipe's wall guide and media provenance notes. No screenshots were recreated or generated. The matching companion is preserved under `preview/`; no public release is implied.
