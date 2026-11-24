# Tony Stark's Journey

A scrollytelling data story for CSE 478 (Foundations of Data Visualization), Fall 2026. It follows Tony Stark
from his 1963 comic debut, through the Marvel Cinematic Universe and his armors, to Robert Downey Jr.'s
casting as Doctor Doom.

Team: Shivraj Jadeja, Akshith Kumar Dharavath, Khashim Abdirakhman

## Run it

No build step and no install. The page loads CSV files with `fetch`, so it must be served over HTTP:

1. Open this folder in VS Code.
2. Install the **Live Server** extension.
3. Right-click `index.html` and choose **Open with Live Server**.

Opening `index.html` straight from disk (`file://`) will not load the data.

## Folder layout

```
index.html              story markup, one <section> per chapter
css/base.css            tokens (colors, fonts), layout, hero, HUD, background reactor
css/charts.css          one block per view, named after its module
js/main.js              entry point; mounts each view when its section nears the screen
js/core/                shared code: data loaders, lazy mounting, scroll reactor, formatting, selection
js/views/               one module per visualization
js/vendor/              D3 v7.9.0 (kept local so the page works offline)
assets/img/             WebP stills, see assets/img/CREDITS.md
data/raw/               downloads exactly as fetched (do not edit by hand)
data/processed/         cleaned files the site loads
data/README.md          every dataset: source, license, fields, cleaning rules
scripts/fetch_raw.py    downloads data/raw/
scripts/build_processed.py  builds data/processed/ from data/raw/
```

## Story and view status

| Chapter | Section id | View | Status |
|---|---|---|---|
| Hero · Jericho demo (2008) | – | photo + hero numbers | built |
| 1 · The comic book (1963) | `#comics` | issues per year area chart (`comicsByYear.js`) | built (base) |
| 2 · The cave | – | Mark I spec strip | built |
| 3 · Hall of Armor | `#hall` | Armory Rings: every armor Tony wore, MCU + comics (`armoryRings.js`) | built |
| 4 · After New York | `#surge` | zoomed beeswarm + box office (`suitTimeline.js`) | built |
| 5 · The multiverse | `#loom` | Temporal Loom: every Tony Stark variant as a thread through era gates (`temporalLoom.js`), the innovative view | built |
| 6 · Sacrifice | `#snap` | Mark 85 exploded scan (`snapExplode.js`) | built, rebuild planned |
| Epilogue · Doom | – | full-bleed Doom photo + countdown | built |

Pose backdrops: faint Iron Man / Doom pose images sit behind the Hall of Armor, Loom and Snap headers
(`assets/img/ghosts/`, `.ghost` in `css/base.css`). The scroll reactor stays underneath them.

The thread river: the threads of the Temporal Loom run behind the whole page (`js/core/threadRiver.js`, one canvas,
`#thread-river`). They start under the hero image, swing down the page in one slow curve per chapter, enter the loom
from the left, leave it on the right, turn Doom green and end in the Doom image. Each thread is one variant from
`variants.csv`. The river finds its way from the page itself: it starts at the element with `data-river-start`, ends
at the one with `data-river-end`, and bends once for every `main > section`. If you add or reorder a chapter, it
re-routes on its own. It sits below `<main>`, takes no pointer events, and dims itself under text and charts
(`shieldOn` in the module lists the selectors it treats as content; add yours if your chart uses a new class).

Other chapters and any extra chart types are open for teammates to extend.
The course needs at least 5 visualization techniques, one of them innovative.

## Adding a view

1. Create `js/views/myView.js` exporting `mountMyView({ ...elements, ...data })`. Draw once inside it.
2. Add a loader to `js/core/data.js` if you need a new processed file.
3. Put the view's markup in its `<section>` in `index.html` and its styles in a new block in `css/charts.css`.
4. Register it in `js/main.js` with `mountWhenNear("#sectionId", ...)` and a dynamic `import()`.

## Performance rules

The first draft lagged. These keep the page smooth:

- **Nothing heavy runs on scroll.** The background reactor and HUD bar are CSS driven by one `--p` variable, written on `#reactor-bg` and `.hud` only (on `:root` it would restyle the whole page every frame); chapter labels use an `IntersectionObserver`.
- **Decorative images are pre-baked.** Pose backdrops carry their tint and soft edge in the WebP itself; no `mix-blend-mode`, `filter` or `mask-image` at runtime.
- **Views mount lazily.** Each view's code and data load only when its section is about 800px away.
- **Animate on canvas when there are many marks.** The snap explosion pre-renders ~250 shard sprites in idle time and runs an animation frame only while shards move.
- **Bake what does not change.** The loom draws its 786 threads once into a canvas; a hover redraws one thread. The thread river scrolls natively (an absolutely positioned canvas, not a fixed one), draws threads as yarns of 5, puts its glow in a buffer an eighth of the canvas size, and lowers its own resolution or detail if frames run late (`?debug` in the URL exposes `__river.stats()`).
- **No `backdrop-filter` and no SVG filters on elements that move.**
- **Images are WebP with `srcset`, lazy-loaded below the fold.**
- **Precompute in Python, not in the browser.** Parsing and aggregation happen in `scripts/build_processed.py`.

## Updating the data

```
python scripts/fetch_raw.py          # downloads anything missing into data/raw/
python scripts/build_processed.py    # rebuilds data/processed/
```

Both scripts use only the Python standard library (Python 3.9+). The Kaggle suit CSV is committed by hand
because Kaggle requires a login.
