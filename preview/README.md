# Ready Set Midi companion for Hardwipe

`ready-set-midi-14.0.10.2-hardwipe.zip` is the Ready Set Midi 14.0.10.2 build that Hardwipe 0.7.46 and later are tested with. It supports both halves of Hardwipe's wall work and carries two fixes:

- **Ranged wall cover:** the `midi-qol.computeCoverBonus`, `computeTargetAC`, `targetHitResolved`, `wallCoverRange` and `coverAutoRollDamage` hooks, with `MidiQOL.hardwipeCoverBridgeVersion = 1`.
- **Area spells damage walls:** the spell card records the placed area even with Save to Chat Card off. It counts several placed areas, and keeps a pending instantaneous area on the map until the GM rules on its wall damage. With **auto-remove instantaneous templates** on, the area is then removed as soon as the GM decides; before, it stayed on the map.
- **No turn-change error:** at a combatant's turn start, Foundry 14 marks the reaction (and bonus-action) marker expired while Ready Set Midi deleted it at the same instant. The GM saw "dnd5ereaction000 does not exist in the EmbeddedCollection" at every turn change. Ready Set Midi now deletes the marker once Foundry has marked it expired. Combat end and rests still remove it directly, and Times Up setups are unchanged.

Install it in place of any other Ready Set Midi or Midi-QOL build, with libWrapper, socketlib and DAE. Don't enable standalone Walled Regions or Walled Templates alongside Hardwipe. It is not a public release asset. See [development status](../docs/Development.md) and the [wall guide](../docs/Walls.md).

## How it was built

`merge-companion.py` rebuilds it exactly:
1. It starts from the cover-bridge bundle (JavaScript SHA256 `cea0bbb7…`, checked by hash).
2. It adds the twelve hunks of `Workflow.wall-effects.patch` in their compiled form.
3. It adds the reviewed-area removal and the reaction and bonus-action marker fixes, each commented in place.
4. Each hunk must match exactly once.

```text
python -I merge-companion.py <cover-bridge ready-set-midi folder> <output folder>
```

`Workflow.wall-effects.patch` stays here as the readable TypeScript form of the wall-effects hunks.

## Verification

Hashes are in `verification.json`. The build was tested on Foundry 14.367 with D&D5e 6.0.5, with separate GM and player clients:
- **Area spells:** a Fireball against walls proposed eight sections and was applied 40 → 30. Its area stayed on the map for the pending review and was removed right after Apply, and again right after Ignore. A cast that hit no walls was auto-removed on schedule.
- **Turn changes:** reaction markers were set on two combatants across four turn changes and a combat deletion, with no errors. Each marker went once its holder's turn started; marked expired first, then deleted. The holder's reaction was available again.
- **Ranged cover:** +2 half cover from Hardwipe's hook, then a near miss into cover proposed a wall hit.
- **Hits:** a clean hit applied damage once.
- **Braindance (0.7.47):** a full memory run.

**Earlier builds:**
- **Wall-effects preview** (zip `B397FDBC…`, JavaScript `40CBB1E4…`): had the area changes but no cover hooks.
- **First combined build** (zip `6880A777…`, JavaScript `2A9B6075…`): had both, without the two fixes.
