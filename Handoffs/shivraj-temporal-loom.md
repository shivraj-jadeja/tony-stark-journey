# Shivraj · Temporal Loom, thread river, snap artifact

Written Nov 24, 2026. Covers Chapter 5 (the Temporal Loom, the innovative view), the thread river behind the whole page, and the Chapter 6 snap artifact. Read the "Adding a chart" section before you add or change a chapter: the river behind the page reacts to your markup.

## What was added

| File | What it is |
|---|---|
| `js/views/temporalLoom.js` | The loom chart (Chapter 5). Every Tony Stark variant in the Marvel Database (786) is one thread running left to right by year. A thread is faint for its whole length and bright in the years that Tony appears. Threads sit in lanes by kind. The entry gate lets all threads in; each later gate closes an era, and its radius is the number of Tonys seen in that era. White dot = first dated appearance, red dot = listed death. |
| `js/core/threadRiver.js` | The same 786 threads as the page background, on one canvas (`#thread-river`) under `<main>`. They start under the hero image, swing down the page in one slow curve per chapter, enter the loom from the left, leave on the right, turn Doom green and end in the Doom image. They never leave the page: one wide bend takes them into the loom on the left and one out of it on the right. |
| `js/core/loomLayout.js` | Thread order, lanes, eras, gate sizes and lane colours, shared by the two files above. |
| `js/core/data.js` | `loadVariants()` |
| `js/main.js` | Builds the loom model once, starts the river in idle time, mounts the loom when its section is near. |
| `index.html` | `<canvas id="thread-river">`, `data-river-start` on the hero figure, `data-river-end` on the Doom figure, the Chapter 5 section. |
| `css/base.css`, `css/charts.css` | `#thread-river` rule; `.loom-*` block. Chart labels in every view are now 11 px or more in JetBrains Mono (they were 9.5 to 10.5 px). `.chart-box` no longer shows a scrollbar on wide screens. |
| `scripts/fetch_raw.py`, `scripts/build_processed.py` | New source `variants` and step `build_variants()`. Every rule is in the docstring. |
| `data/raw/marvel_fandom/tony_variants.json`, `data/processed/variants.csv`, `variant_years.csv`, `variants_meta.csv` | Raw pages (3.6 MB) and the three files the page loads. Columns: `data/README.md`. |
| `js/views/snapExplode.js`, `css/charts.css` | Chapter 6 snap artifact, see below. |

Built with Canvas 2D and D3 only. No three.js, no WebGL, no new library.

## How the loom works for a reader

- **Hover** a thread: a white line marks it and a small box names the reality, the year under the pointer and the appearances that year.
- **Click** a thread: Loki green runs along it from the click, the other threads dim, and the panel shows that life (appearances, media, identity, teams, occupation, armor models, first appearance, death and its cause, last appearance, appearances per year, story chapters, wiki link). Click it again, click empty space or press Esc to clear.
- **Keyboard:** focus the loom, ↑ ↓ step to the neighbouring thread, ← → step by debut year.
- **Find a reality** search box, two story buttons, and eight **lens** buttons that light up one group (Avengers members, public or secret identity, death listed, killer named, armor model named, seen in 2+ years). With a lens on, each gate reads "in the group / all" for its era.

## Chapter 6 · the snap artifact (`snapExplode.js`)

Not a chart: an illustration that reacts to the reader. Hover the frame (or focus it, or tap on touch) to open the F.R.I.D.A.Y. scan.

- **Armor plates** explode outward from the arc reactor. Each plate is cut from the film frame once, in idle time, then brightened, saturated, given a bevel and a warm rim, and stored as a small sprite. A frame only copies sprites. Tuning: `SHARD` at the top of the file. The gauntlet plates stay white because the frame is pure glare there.
- **Infinity Stones** are drawn as faceted SVG gems in their canon colours. All six sit in their sockets while the scan is open; the one you hover lifts out, grows and shows its name.
- **Nerves:** six glowing lines, one per stone in its colour, run from the gauntlet along the forearm, elbow and shoulder into the reactor, fading out from the shoulder on, with pulses travelling toward the reactor. Hovering a stone keeps its nerve bright and dims the rest. They draw on a small canvas over the arm only (`canvas.nerves`) and the loop runs only while the scan is open. Path points: `ARM` and `NERVE` at the top of the file, traced by eye on the still.
- **Readout text** (F.R.I.D.A.Y. lines, stone labels) is no longer faded by the frame's soft oval edge: that mask now applies to the picture canvases only.
- Open and moving: 12 ms per frame at 1900 px, integrated GPU. The older SVG scan animations (scan line, spinning rings, dashed flow) are still the largest cost; `design/05` (Shivraj's private plan) describes a full rebuild if a teammate takes it on.
- Not tested in Safari (the plate brightening uses a canvas filter Safari may ignore; plates would then look dull, nothing breaks).

## Adding a chart to the page

The normal steps are unchanged (README, "Adding a view"): a module in `js/views/`, a loader in `js/core/data.js`, markup in a `<section>`, styles in `css/charts.css`, `mountWhenNear("#id", ...)` in `js/main.js`.

What the river needs from you:

1. **Put the chapter in its own `<section>` directly inside `<main>`.** The river bends once for every `main > section`, alternating left and right, and re-routes by itself when a section is added, moved or changes height. No river code to edit.
2. **Keep the section background transparent** if you want the threads to show behind it. An opaque background simply hides them there.
3. **Use the shared classes for content, so the river dims under it.** It dims to about 28% under these and cannot be stirred there: `h1, h2, .eyebrow, .prose, .spec, .chart-box, .hall-grid, .panel, .legend, .note, .notes-grid, .slot, .ghost` (full list: `shieldOn` at the top of `js/core/threadRiver.js`). Wrap a chart in `.chart-box` and it is covered. If you invent a new wrapper class, add it to `shieldOn`, or bright threads will run under your chart.
4. **Do not give anything `position: fixed` with a z-index below 1**, and do not put elements outside `<main>` between the canvas and the content. The canvas is `z-index: 0`, `<main>` is `z-index: 1`.
5. **Do not move or rename** `data-river-start` (hero figure), `data-river-end` (Doom figure) or `#loomStage`. The river starts, passes through and ends at those.
6. The river takes no pointer events, so it cannot block your hover or click handlers.
7. Chart text: JetBrains Mono (`var(--f-mono)`) at 11 px or more for labels, axes and legends; Chakra Petch (`var(--f-display)`) for numbers and titles.
8. Check your chart with `?debug` in the URL: `__river.stats()` in the console shows the river's frame cost and how many content boxes it found (`shields`).

Data rule (course): every number comes from `data/processed/`, built by `scripts/build_processed.py` from `data/raw/`. Nothing typed in by hand.

## State

- Works: river, loom, hover, click select, keyboard, search, story buttons, lenses, panel, legend, reduced motion, 390 px and 1920 px layouts. Checked in headless Chrome; the only console message is the missing `favicon.ico`.
- **Not checked:** how the motion and scrolling feel on a real screen, a phone, Firefox, Safari.
- Known: the fixed HUD box covers the left end of the loom's legend and panel at the bottom of the screen.
- Known: about one page load in five has a single 200 ms pause when the river canvas is created.
- Known: the snap chapter is the slowest view on a throttled CPU, with or without the river (its old SVG animations).

Frame times (1440×900, integrated GPU, 144 Hz): idle 7.0 ms, hovering the loom 8.6 ms, scrolling the whole page 8.7 ms (7.3 ms without the river). With 4× CPU throttle, scrolling is 20.9 ms (14.1 ms without the river).

## Data

```
python scripts/fetch_raw.py variants     # about 12 minutes; add --force to refresh
python scripts/build_processed.py
```

No public source has numeric power stats per variant, so none are shown.

## Open questions

- Are the eight lenses the right groups?
- Chapter 5 wording (written with Claude, not yet confirmed).

## Branch state

All of the above is on `shivraj` and merged into `main` (fast-forward, `main` had no other work). Teammates: pull `main` and branch from it.
