# Actual Ready Set Midi attribution correction

The previous ranged box cancelled Midi's calculation and inferred reasons from actor statuses, flag truthiness, and its own geometry. This implementation removes that collector and the cancellation. It snapshots the actual evaluated Midi tracker before clearing automatic ranged mode changes. No attribution means no advisory. Manual buttons/options/keys are excluded from source labels. Guessed version-two cards are hidden.

Native QA: Foundry 14.367, D&D5e 6.0.5, Hardwipe candidate 0.7.41, Ready Set Midi candidate 14.0.10.2. Separate authenticated GM and Player sessions in the synthetic hardwipe-qa world, loopback port 30003. Native active effects and Midi conditional evaluation were used, with no synthetic replacement of Foundry APIs.

Validated: clean attack, false conditional flag, true conditional active effect with real effect name, both directions, suppression, unlabelled native modifier, explicit advantage/disadvantage, clicked native Disadvantage button against an actual Advantage source, pending GM approval with no early HP loss, source privacy on another client and after reload, and melee to Thrown to melee restoration. A naturally rolled 20 in the melee transition remained pending until the GM confirmed it.

The 40-foot range fixture with a 20-foot normal range returned no attribution from Midi in this configuration. It produces no box; no geometry fallback is invented. This does not certify Midi's range detector. The initial assertion expecting a range source was corrected to validate the user's actual contract: absent Midi evidence stays hidden. That diagnostic result is retained alongside final acceptance.

Six pure adapter tests and sixteen wall geometry tests passed. All 118 JavaScript files checked parsed, six production placement-helper checks passed, and the existing 22 Wall Effects native postcondition checks still passed against saved native evidence. No new full wall run is claimed for this small advisory-only change; Midi's bundle and all area scripts are unchanged from that run.

No browser error events were recorded in the final Player session. Existing dependency deprecation warnings remain. Tests did not exhaust every third-party macro, ranged spell, key combination or reload interruption. A thrown mode whose attribution was calculated as melee stays silent instead of borrowing that source list.

Production Foundry and campaign data were unchanged. QA clients closed, own server stopped, original QA manifest and fixture restored. Preview packages were read back and every payload compared. Release publication/installation remain separate from the requested branch push.
