# Release and audited development status

[← Overview](../README.md) · [Combat changes](Combat.md) · [Wall changes](Walls.md)

## What Foundry installs today

The public release is **Hardwipe Ruleset 0.7.48** with **Ready Set Midi 14.0.10.2**; both are attached to the [release](https://github.com/TobbyClay/hardwipe-ruleset/releases/latest), and Hardwipe's manifest installs the companion as a dependency. Release notes: [0.7.48](RELEASE-0.7.48.md).

`main` carries work merged after 0.7.48 ([pull request 13](https://github.com/TobbyClay/hardwipe-ruleset/pull/13)): Edge's four plays, the card family pass, typed chat as a comm feed, and light mode. It is not in an installer yet; the guides mark it **Next release**.

0.7.47 was built and documented but never published on GitHub; everything in it ships in 0.7.48, so the previous public installer was 0.7.40. The 0.7.41 audited preview below is historical; everything in it shipped too.

## Audited preview

The **0.7.41 / Ready Set Midi 14.0.10.2** source cohort is under review in the repository's `audit/0.7.41-runtime-fixes` branch. It includes:

- A compact native wall editor section at the bottom of the window, so the GM can assign a saved wall type.
- Source-specific ranged advantage/disadvantage hints with no generic manual-mode notice and no automatic roll-mode change.
- Approval for all targeted creature attacks, including GM/NPC rolls and player-owned targets, with natural 20/1 confirmation, keyed rerolls, stale-decision rejection, current chat-state reads, a retroactive card-update review hook, and the gate before saves.
- Damage and on-hit effects blocked until approval; no stale stored-damage fallback when the live workflow is unavailable.
- Per-target critical damage retained in the native mitigation and Shield Block path, including damage properties and rounding.
- Shield durability, state concurrency, concentration, item-card, and message-card corrections from the bounded GM/Player audit.
- A separate explicit GM Apply/Ignore wall-damage flow.

<img src="media/ranged-advisory-current.webp" alt="Actual audited preview card with identified advantage and disadvantage sources" width="350">

Hardwipe 0.7.48 ships with the **tested companion**, attached to the release and rebuilt by [`preview/merge-companion.py`](../preview/README.md):
- the cover-bridge build;
- the wall-effects changes;
- removal of reviewed instantaneous areas once the GM decides;
- an ordered expiry of the reaction and bonus-action markers.

Its JavaScript SHA256 is:

```text
AE2B209D700C2B07B0AF49FD512D8B19925BDD692244BED310FC3D8D1E2594C0
```

The first combined build for 0.7.46 was `2A9B6075…`.

The 0.7.41 audit and the Wall Effects preview below used the earlier build `40CBB1E4…`, which lacked the ranged-cover hooks.

The native QA Windows file `scripts/hardwipe-ranged.js` uses CRLF line endings; its SHA256 is:

```text
C4614DC76ABC87D465A998C2FF45D9444945454CB20EA9CF9B2144D4962F4AA0
```

Git normalizes that file to LF without changing its code. The repository blob SHA256 is `3F40B1099E17CB3CD0D146F28BE4B29D4CE328BA20DCF64B2A0ED212B62A1C16`.

The 0.7.41 preview manifest was never published as an installer; its features shipped in **0.7.48** with Ready Set Midi 14.0.10.2.

## Automated checks

Every pull request and every push to `main` runs [`.github/workflows/ci.yml`](../.github/workflows/ci.yml):

- **Unit tests:** `node --test tests/*.test.mjs`.
- **Script parsing:** every file under `scripts/` is parsed as an ES module, and `chat-portraits.js` as a classic script. Plain `node --check file.js` is not used for the modules: on Node 24 it lets a syntax error in a file with `import`/`export` pass unreported.
- **Manifest, language files and paths** ([`.github/scripts/check-module.mjs`](../.github/scripts/check-module.mjs)):
  - every file `module.json` lists exists;
  - every language file parses, and no key is also the start of another key (Foundry would drop the whole file);
  - every `modules/hardwipe-ruleset/…` path in the scripts exists.

  Names must match exactly, case included, because Foundry servers on Linux are case-sensitive.

Run them before pushing, from the repository root, with Node 24:

```bash
node --test tests/*.test.mjs
node .github/scripts/check-module.mjs
```

These checks don't replace runtime verification in Foundry; see the scope below.

## Verification scope

### Wall Effects integration, 2026-10-09

The later local development cohort bundles Walled Regions and adds Normal/Half wall-damage modes. It also corrects native multi-area placement counting and retains placed-area identities with full workflow snapshots disabled. This is a local preview, not a published release or installer update.

Its matching tested Ready Set Midi JavaScript SHA256 is:

```text
40CBB1E42A49565A1EAABE4488B0B9B05E21740A29EC17CB49BB4AB4A201D7FD
```

This hash supersedes the earlier companion hash **for the Wall Effects preview only**. Keep both records with their respective audit scope. Native Foundry 14.367 / D&D5e 6.0.5 GM and Player checks cover normal and half damage, threshold boundaries, private approval, Ignore, stale and duplicate decisions, reload, optical gaps, breaches, grouped undo, multiple origins, overlapping areas, and the existing Spread mode. The geometry suite has 16 passing cases; the production placement-count helper has six passing cases. Emanations and rings remain manual wall-damage cases; a native ring cast verified the warning.

**Superseded in 0.7.46:** emanations and rings now damage walls (an emanation from every point of the caster's space, a ring across its band), and the per-shape defaults offer the damage modes. Native player casts of every dnd5e area shape, GM approval, Ignore, breach, undo and a stale emanation were rechecked; the geometry suite has 20 passing cases. See `_release-audit/area-walls-0.7.46/QA-Report.md`.

### Edge plays, card pass, typed chat and light mode, after 0.7.48

Checked on Foundry 14.367, D&D5e 6.0.5 and Ready Set Midi 14.0.10.2 in the disposable QA world, with a GM and two players in separate browsers, each step clicked by the player it belongs to:

- **Reroll** on an NPC's attack confirmed as a hit (keep, take, and a taken reroll that turned the hit into a miss, ruled again by the GM), on a failed spell save, and on a spell's damage after it was applied.
- **Interrupt** used off turn without the Reaction? prompt; **Stabilize** from the picker and from the Downed card; **Execute** from a player's client, and refused on a Legendary Resistance target.
- **Cards and chat:** the initiative, consumable, tool and feature cards; the typed-chat feed with phone texts; light mode across chat, the sheet, the Turn and Cyberware tabs, settings windows and dialogs, with a contrast check over every card.

One reroll in the hit-to-miss check was forced low on the spender's client; every other die was as rolled. Smartphone Widget itself isn't installed in the QA world: its texts were posted in the module's exact message shape. 152 unit tests.

### Turn tab, roll calls and Crew Maneuvers, 0.7.48

Crew Maneuvers were checked on Foundry 14.367, D&D5e 6.0.5 and Ready Set Midi 14.0.10.2 with a GM and two players in separate browsers: Feature Type and subtype, the GM's maneuver types, weapon, activity and card payoffs, a crewmate firing someone else's maneuver through the GM, round and turn expiry, both CREW card styles, and the netlink strip. Not covered: expiry with no GM online, Ready Set Midi's prompt reaction modes, NPC crew, and descriptions with images or tables. See `_release-audit/crew-maneuvers/QA-Report.md`. The Turn tab, roll calls, netlink, comms queue and Cyberware tab redesign were built and checked in earlier local sessions. CI runs the unit tests, script parsing and the module check on every pull request.

### Braindance, 0.7.47

Braindance Suite 0.2.1 was merged into Hardwipe (`scripts/braindance/`, `scripts/hardwipe-braindance.js`, `styles/braindance.css`). It is verified on Foundry 14.367, D&D5e 6.0.5 and the merged Ready Set Midi companion, with separate GM and player clients. The checks covered entering a memory and recovering after a reload, attacks under GM review with BD stamps and Roll Tracker credit, all four echoes with mechanics and their expiry, clue placement and scans on every layer, timeline replay, and an exact rollback of a breach plus Heat. Coexistence with the standalone module was checked too. 45 new unit tests. See `_release-audit/braindance-0.7.47/QA-Report.md`.

### Actual Midi attribution correction, 2026-10-09

The ranged advisory now consumes Ready Set Midi's evaluated `attackRollModifierTracker.attribution` before removing automatic roll-mode changes. It no longer cancels that calculation, inspects actor statuses, treats a conditional expression as truthy, recomputes range/nearby geometry, or invents a generic system-modifier reminder. False conditions and absent attribution produce no box. Manual options, keyboard choices, and native dialog buttons remain authoritative. Older guessed advisories are hidden.

Native GM/Player checks exercised no-source silence, false and true conditional flags, named active-effect attribution, combined advantage/disadvantage, suppression, unlabelled native modes, explicit and dialog choices, required GM approval with unchanged HP, and melee-to-Thrown-to-melee restoration. The long-range fixture returned no Midi attribution in this configuration; its box remained hidden. Thrown mode cannot borrow a calculation made for melee. Source labels stay local to the rolling client and disappear after reload.

Six pure adapter tests and the existing sixteen wall-geometry tests pass. All 118 JavaScript entry files checked pass syntax validation; six placement-count helper checks pass. The current native advisory screenshot replaces the earlier guessed-source image. The older sixteen-case advisory audit describes superseded inference behavior and must not be used as acceptance for this implementation.

### Earlier preview audit

The audited cohort has source checks and disposable Foundry GM/Player runtime evidence for the exercised workflows. Its earlier advisory checks are superseded by the actual-attribution correction above. This is bounded verification, not an assertion that every module combination or possible scenario passes.

The original 0.7.40 publication records **11 checks** and a restart/redraw of **202 messages**. Keep that historical release evidence separate from the later preview audit.

Screenshots across these guides come from actual synthetic Foundry scenes. Older captures illustrate unchanged presentation; current preview captures are labeled. [Media notes](Media.md) records their provenance.
