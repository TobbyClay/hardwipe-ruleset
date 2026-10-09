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

The source review must travel with the **tested companion bundle**, not a fresh rebuild from stale workspace output. Its SHA256 is:

```text
FB6BA1AB4F49A601CBE8D4DF3C4F4F2BD87F8730A1B229209158EE977E2D0FF6
```

The audited `scripts/hardwipe-ranged.js` SHA256 is:

```text
5015687A93E49E96172F947C4EE40201EBEC2DF70967501C12C427DCEFC98B15
```

The preview manifest names version 0.7.41 and companion 14.0.10.2. Those public release assets do **not** exist yet. Do not use the development manifest as an installer until a coherent release publishes both verified packages and updates the release metadata.

## Verification scope

The audited cohort has source checks and disposable Foundry GM/Player runtime evidence for the exercised workflows. The most recent ranged advisory acceptance includes **16 source cases** and native GM/Player checks for identified sources, no-source silence, unchanged roll mode, and privacy. This is bounded verification, not an assertion that every module combination or possible scenario passes.

The original 0.7.40 publication records **11 checks** and a restart/redraw of **202 messages**. Keep that historical release evidence separate from the later preview audit.

Screenshots across these guides come from actual synthetic Foundry scenes. Older captures illustrate unchanged presentation; current preview captures are labeled. [Media notes](Media.md) records their provenance.
