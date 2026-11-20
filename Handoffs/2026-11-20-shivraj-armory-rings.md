# 2026-11-20 · Shivraj · Armory Rings (Chapter 3)

## What changed

| File | Change |
|---|---|
| `js/views/armoryRings.js` (new) | Replaces `armorReactor.js` (deleted). Every armor Tony wore as arc-reactor segments. **Right half:** MCU (cyan). **Left half:** main comics (gold). **Outer ring:** the 12 most-seen per side, angle = share of appearances within that half. **Inner ring:** the rest, equal slices. **Broken arcs on the 4 diagonals:** armors Tony built for others, one arc per wearer. The hovered piece grows outward and widens while neighbours ease aside (critically damped, 0.24 s, no overshoot). Hit-testing is maths on the live geometry. The animation frame loop runs only while pieces move. ←/→ along a ring, ↑/↓ between rings, Esc clears. MCU pieces stay linked with the suit timeline (`selection.js`). |
| `js/core/gearSound.js` (new) | Synthesised gear sounds (Web Audio, no files). Light tick for the inner ring, heavy ratchet for the outer ring and arcs. **Off by default**; the "Gear sound" button turns it on. |
| `js/core/data.js` | `loadArmors()` |
| `js/main.js` | Mounts the Armory Rings (opens on Mark 42) |
| `index.html` | Hall section: new chart markup, sound button, new intro text (please check the wording) |
| `css/charts.css` | `#armoryChart` block replaces `#reactorChart`. Unused portrait styles removed. |
| `scripts/fetch_raw.py` | New source `armor`: all 272 pages in Category:Iron Man Armor, with wikitext and appearance counts |
| `scripts/build_processed.py` | New step `build_armors()` → `data/processed/armors_all.csv`. All rules are in its docstring. |
| `data/raw/marvel_fandom/iron_man_armor_pages.json` (new, ~1 MB) | Raw armor pages |
| `data/processed/armors_all.csv` (new) | 149 rows: 140 worn (MCU 50, comics 90; 24 outer + 116 inner) + 9 built for others |
| `data/README.md`, `README.md` | Docs for the new data and view |

## State

- Works: rings, hover pop-out, keyboard, panel, sound toggle, timeline link. Checked in headless Chrome through a harness that mounts the real module (`design/mockups/view-armory.html`, git-ignored). No console errors.
- **Not checked by Claude:** how the sound and the animation feel. Headless Chrome cannot play audio and runs only a few animation frames, so Shivraj tests both by hand.
- The other processed CSVs rebuild byte-identical.

## How to check

Live Server → scroll to Chapter 3. Sweep the cursor across both rings and the diagonal arcs. Turn on "Gear sound". Click the chart and use the arrow keys. Hover an MCU suit, then scroll to Chapter 4: the same suit is highlighted.

## Data

```
python scripts/fetch_raw.py armor      # add --force to refresh
python scripts/build_processed.py
```

## Next steps

1. Temporal Loom (design/04): variant data fetch, then the canvas view.

## Open questions

- Mark 85 (the snap suit) has 11 appearances, so it sits in the inner ring. Highlight it anyway?
