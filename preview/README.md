# Ready Set Midi companion for Hardwipe

`ready-set-midi-14.0.10.2-hardwipe.zip` is the Ready Set Midi 14.0.10.2 build that Hardwipe 0.7.46 and later are tested with. It is the one companion build that supports both halves of Hardwipe's wall work:

- **Ranged wall cover:** the `midi-qol.computeCoverBonus`, `computeTargetAC`, `targetHitResolved`, `wallCoverRange` and `coverAutoRollDamage` hooks, with `MidiQOL.hardwipeCoverBridgeVersion = 1`.
- **Area spells damage walls:** the spell card records the placed area even with Save to Chat Card off. It counts several placed areas, and keeps a pending instantaneous area on the map until the GM rules on its wall damage.

Install it in place of any other Ready Set Midi or Midi-QOL build, with libWrapper, socketlib and DAE. Don't enable standalone Walled Regions or Walled Templates alongside Hardwipe. It is not a public release asset. See [development status](../docs/Development.md) and the [wall guide](../docs/Walls.md).

## How it was built

`merge-companion.py` rebuilds it exactly:
1. It starts from the cover-bridge bundle (JavaScript SHA256 `cea0bbb7…`, checked by hash).
2. It adds only the twelve hunks of `Workflow.wall-effects.patch`, in their compiled form.
3. Each hunk must match exactly once.

```text
python -I merge-companion.py <cover-bridge ready-set-midi folder> <output folder>
```

`Workflow.wall-effects.patch` stays here as the readable TypeScript form of those hunks.

## Verification

Hashes are in `verification.json`. The build was tested on Foundry 14.367 with D&D5e 6.0.5, with separate GM and player clients:
- **Area spells:** a Fireball against walls proposed eight sections, was applied 40 → 30, kept its area on the map while the review was pending, and was auto-removed on schedule when no walls were hit.
- **Ranged cover:** +2 half cover from Hardwipe's hook, then a near miss into cover proposed and applied a wall hit.
- **Hits:** a clean hit applied damage once.
- **Braindance (0.7.47):** a full memory run on top of it.

It replaces the earlier wall-effects preview build (zip `B397FDBC…`, JavaScript `40CBB1E4…`). That build had the area changes but none of the cover hooks.
