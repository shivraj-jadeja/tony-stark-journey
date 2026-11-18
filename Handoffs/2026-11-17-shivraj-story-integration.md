# 2026-11-17 · Shivraj · Story integration (comics chart, pose backdrops, Doom epilogue)

## What changed

| File | Change |
|---|---|
| `index.html` | Chapter order is now Hero → Comics → Cave → Hall of Armor → After New York → **Loom (new slot)** → Snap → Doom. The co-star network slot is removed. The comics slot is replaced by a real chart. Pose backdrops are added to the Hall, Loom and Snap headers. The Doom epilogue is now full-bleed. The sources list shows the current view status. |
| `js/views/comicsByYear.js` (new) | Area chart: Tony issues per year (gold), issues that also include Doom (green, same scale), and distinct armor models per year (cyan line, right axis). Hover or ←/→ keys pick a year. Legend buttons show and hide each series. |
| `js/main.js` | Mounts the comics chart lazily, together with the existing comics spec strip. |
| `js/core/scrollReactor.js` | **Perf fix:** `--p` is now written on `#reactor-bg` and `.hud` only, not on `:root`. Before, every scroll frame restyled the whole page. No visual change. |
| `css/base.css` | `.ghost` / `.has-ghosts` backdrop styles. Full-bleed `.doom-hero` epilogue. Removed the old `.doom-grid` / `.doom-fig` rules. Mobile: one ghost per section, fainter. |
| `css/charts.css` | `#comicsChart` block |
| `assets/img/ghosts/*.webp` (new) | 6 pose backdrops (Iron Man in cyan, Doom in green). The tint and soft edge are baked into the image, so no CSS blending is needed. |
| `assets/img/doomsday-armsspread-{940,1880}.webp` (new) | Doom epilogue image |
| `assets/img/CREDITS.md`, `README.md` | Credits for the new images; story table and perf notes |
| `.gitignore` | Ignores personal planning files (`Plan.md`, `Rule.md`, `CLAUDE.md`, `design/`). `Handoffs/` stays tracked. |

## State

- Works: comics chart, backdrops with the scroll reactor underneath, full-bleed Doom epilogue, perf fix. Checked in headless Chrome at 1440×900 with no console errors.
- Placeholders: the Loom section is a slot (next work package).
- Unchanged: `armorReactor.js` (to be rebuilt as the Armory Rings), `suitTimeline.js`, `snapExplode.js`.
- `assets/img/doomsday-doom-520/868.webp` are no longer referenced. They are kept until the team decides.
- Known, from before: at 1440×900 the HUD box overlaps the hero subtitle's first words.

## How to check

Open `index.html` with Live Server. Scroll through the comics chart (hover, ←/→ after clicking it, legend toggles), the Hall, Loom and Snap headers (faint pose images over the reactor), and the end (full-size Doom).

## Data

No data changes. The comics chart reads `data/processed/comics_tony_by_year.csv`.

## Next steps

1. Armory Rings (rebuild of the Hall of Armor chart with MCU and comic armors). Data: Marvel Database armor pages.
2. Temporal Loom.

## Open questions

- Teammates: views 2 (comics) and 3 (suit timeline) and the snap view are yours to extend or restyle.
