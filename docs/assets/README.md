# Asset provenance

The visual assets distributed with Agentic Company OS are project-owned and
covered by the repository's MIT license unless a file says otherwise.

- `dashboard.png` is the English dark desktop Home view (1366 × 900), captured
  and visually inspected on 30 September 2026 from the local production build
  with Keeper mascots. Its source is the passing `route-foundations` Chromium
  fixture. It contains fictional seeded agents and no third-party product
  screen. The older [combined verification record](../verification/2026-09-28-full-release-gates.md)
  describes a previous build, not this screenshot.
- `artifacts/agentic-company-os/src/assets/company-keeper-color-atlas.webp` contains
  ten original, fictional Keeper mascots created for this project with the
  built-in ImageGen tool and encoded as WebP for the application. The characters
  do not depict or impersonate people. Their order and visual rules are in
  [keeper-mascots.md](keeper-mascots.md).
  The original monochrome `company-keeper-atlas.webp` is retained as the edit
  reference; the application ships the colorful atlas. CSS provides the live
  motion, without an external animation service or per-frame model calls.
- `artifacts/agentic-company-os/public/favicon.svg` is project artwork derived
  from the first Keeper's visual grammar.

Do not add scraped headshots, customer data, screenshots containing credentials,
or assets with unclear redistribution rights. A pull request that adds a new
third-party asset must record its source, author, license, and required notice in
this file or in a colocated license file.
