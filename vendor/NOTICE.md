# Bundled Walled Regions

Hardwipe includes an adapted copy of the local Walled Regions 0.9.4 fork,
originally derived from caewok's Walled Templates.
Upstream: https://github.com/caewok/fvtt-walled-templates
Local source: `Foundry - Walled Templates Migration/walled-regions`.

The adaptation preserves the `walled-regions` document flag namespace, hosts
settings, keybindings, and libWrapper registration under `hardwipe-ruleset`,
and adds normal/half structural-damage modes plus a read-only geometry API.
Hardwipe does not replace the upstream author's copyright or license.

- Walled Regions/Walled Templates code: MIT; see `walled-regions/LICENSE`.
- GeometryLib: MIT, Copyright (c) 2022 Michael Enion; see
  `walled-regions/scripts/geometry/LICENSE.md`.
- Bundled Clipper2 JavaScript port: Boost Software License 1.0. Original source
  headers identify Angus Johnson and retain the license reference; full text is
  in `walled-regions/scripts/geometry/clipper2_esm2020/LICENSE.txt`.
- Font Awesome SVG icons: CC BY 4.0, Fonticons, Inc. Existing attribution and
  license text are retained in `walled-regions/assets/LICENSE.txt`.

Original module source, tests, documentation, development tooling, and release
manifests are not modified by this bundled copy. Development-only tests and
standalone changelog pop-ups are excluded from Hardwipe's runtime bundle.
