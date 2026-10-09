# Release and audited development status

[← Overview](../README.md) · [Combat changes](Combat.md) · [Wall changes](Walls.md)

## What Foundry installs today

The public release is **Hardwipe Ruleset 0.7.40** with **Ready Set Midi 14.0.10.1**. The documentation update does not create a new release, replace release assets, or install a module into an existing world. The default-branch manifest remains the public release manifest.

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

The source review must travel with the **matching tested companion bundle** in [preview](../preview/README.md). Its JavaScript SHA256 is:

```text
40CBB1E42A49565A1EAABE4488B0B9B05E21740A29EC17CB49BB4AB4A201D7FD
```

The native QA Windows file `scripts/hardwipe-ranged.js` uses CRLF line endings; its SHA256 is:

```text
C4614DC76ABC87D465A998C2FF45D9444945454CB20EA9CF9B2144D4962F4AA0
```

Git normalizes that file to LF without changing its code. The repository blob SHA256 is `3F40B1099E17CB3CD0D146F28BE4B29D4CE328BA20DCF64B2A0ED212B62A1C16`.

The preview manifest names version 0.7.41 and companion 14.0.10.2. Those public release assets do **not** exist yet. Do not use the development manifest as an installer until a coherent release publishes both verified packages and updates the release metadata.

## Verification scope

### Wall Effects integration, 2026-10-09

The later local development cohort bundles Walled Regions and adds Normal/Half wall-damage modes. It also corrects native multi-area placement counting and retains placed-area identities with full workflow snapshots disabled. This is a local preview, not a published release or installer update.

Its matching tested Ready Set Midi JavaScript SHA256 is:

```text
40CBB1E42A49565A1EAABE4488B0B9B05E21740A29EC17CB49BB4AB4A201D7FD
```

This hash supersedes the earlier companion hash **for the Wall Effects preview only**. Keep both records with their respective audit scope. Native Foundry 14.367 / D&D5e 6.0.5 GM and Player checks cover normal and half damage, threshold boundaries, private approval, Ignore, stale and duplicate decisions, reload, optical gaps, breaches, grouped undo, multiple origins, overlapping areas, and the existing Spread mode. The geometry suite has 16 passing cases; the production placement-count helper has six passing cases. Emanations and rings remain manual wall-damage cases; a native ring cast verified the warning.

### Actual Midi attribution correction, 2026-10-09

The ranged advisory now consumes Ready Set Midi's evaluated `attackRollModifierTracker.attribution` before removing automatic roll-mode changes. It no longer cancels that calculation, inspects actor statuses, treats a conditional expression as truthy, recomputes range/nearby geometry, or invents a generic system-modifier reminder. False conditions and absent attribution produce no box. Manual options, keyboard choices, and native dialog buttons remain authoritative. Older guessed advisories are hidden.

Native GM/Player checks exercised no-source silence, false and true conditional flags, named active-effect attribution, combined advantage/disadvantage, suppression, unlabelled native modes, explicit and dialog choices, required GM approval with unchanged HP, and melee-to-Thrown-to-melee restoration. The long-range fixture returned no Midi attribution in this configuration; its box remained hidden. Thrown mode cannot borrow a calculation made for melee. Source labels stay local to the rolling client and disappear after reload.

Six pure adapter tests and the existing sixteen wall-geometry tests pass. All 118 JavaScript entry files checked pass syntax validation; six placement-count helper checks pass. The current native advisory screenshot replaces the earlier guessed-source image. The older sixteen-case advisory audit describes superseded inference behavior and must not be used as acceptance for this implementation.

### Earlier preview audit

The audited cohort has source checks and disposable Foundry GM/Player runtime evidence for the exercised workflows. Its earlier advisory checks are superseded by the actual-attribution correction above. This is bounded verification, not an assertion that every module combination or possible scenario passes.

The original 0.7.40 publication records **11 checks** and a restart/redraw of **202 messages**. Keep that historical release evidence separate from the later preview audit.

Screenshots across these guides come from actual synthetic Foundry scenes. Older captures illustrate unchanged presentation; current preview captures are labeled. [Media notes](Media.md) records their provenance.
