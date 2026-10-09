# Tested development companion

This folder preserves the exact Ready Set Midi companion used for the Hardwipe 0.7.41 development preview. It is not a published release or an update to the production installation. Use it only in a disposable development world.

The ZIP contains the tested 14.0.10.2 runtime assets and manifest, with the freshly built JavaScript for multi-area placement and retained wall-review source regions. Every ZIP entry was compared to its packaging source. `verification.json` records the archive and JavaScript SHA256 values and the metadata provenance. The build source base still identifies 14.0.10, so coherent version/release/download metadata remains a publication prerequisite.

Hardwipe's normal repository files contain the matching ruleset source. Do not enable standalone Walled Regions/Walled Templates alongside the integrated implementation. See [development status](../docs/Development.md) and [wall guide](../docs/Walls.md).

`Workflow.wall-effects.patch` provides the readable source delta for the later Wall Effects integration, against the earlier audited local Workflow source (SHA256 `B3A4AFCC6B1701FA567EEB4C4EEC6DDBE918C17BCB62211C20F03D2ADD1AA21A`). The ZIP is the authoritative complete tested runtime; this narrow patch is not a standalone build recipe for the broader earlier companion corrections.
