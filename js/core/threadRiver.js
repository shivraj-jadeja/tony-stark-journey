// The thread river: every Tony Stark variant as a thread that flows down the page behind the story (design/04).
//   segment A   starts under the hero image at the top right and swings down the page in wide, slow S-curves,
//               then turns in from the left to the loom's entry gate
//   (the loom)  drawn by views/temporalLoom.js on its own canvas; the two cross-fade at the gates
//   segment B   leaves the loom's last gate, swings on down, turns Doom green and ends inside the Doom image
//
// Course rules: this is plain Canvas 2D. The centreline is a d3.line (curveBasis) through one point per chapter,
// measured from the page, and the thread order, lanes and gate sizes come from core/loomLayout.js (data).
//
// Look: threads are grouped into strands (one lane + one debut era). A strand is a flat ribbon of parallel
// threads that leans and drifts a little around its neighbours, in x and in depth; depth scales a thread's
// sideways offset (perspective). Light adds up ("lighter"), so where ribbons cross they brighten.
//
// The river passes BEHIND the story. Wherever it runs under text or a chart it is dimmed to about a third
// (soft-edged "shields" measured from the page), and the pointer cannot stir it there, so content stays readable.
//
// It cannot lag behind scrolling: the canvas is not fixed. It is an ordinary absolutely positioned element, a
// little taller than the screen, so the browser scrolls it with the page on the compositor. Each frame redraws
// it and moves it back under the viewport; the extra height covers the frames in between.
//
// Performance (Rule.md 5):
//   - pointer-events none, below <main>: it never blocks or repaints a chart
//   - far from the loom, threads travel as yarns of CFG.yarn threads on one line (same light, a fraction of the
//     work); every yarn frays into its own threads on the way into the loom and re-twists on the way out
//   - one path and one stroke per strand, typed-array maths, nothing allocated per thread
//   - glow is one pre-rendered sprite stamped into a buffer an eighth of the canvas size and stretched over
//     it once per frame (never shadowBlur or a filter; full-size stamps cost the GPU 3x the threads)
//   - layout is measured on resize only; a frame reads scrollY and nothing else
//   - the loop sleeps when the river is off screen or the tab is hidden
//   - it measures its own frame pacing against the display's refresh interval and lowers the canvas resolution
//     one step if it cannot keep up (the cost is GPU fill, so resolution is the lever that matters)
//   - it also times its own script: on a slow CPU it goes "lite" (half, then a third, of the samples and yarns,
//     each drawn that much brighter), which keeps the look and cuts the work
//   - prefers-reduced-motion: no flow, no stir; one still frame per scroll position
import { loomScales, stageGeometry } from "./loomLayout.js";

const d3 = window.d3;

const CFG = {
  step: 36,                 // px between centreline samples
  maxSamples: 260,          // most samples drawn in one frame per segment
  over: 0.22,               // extra canvas above and below the screen, as a share of its height
  dpr: [1.5, 1.25, 1],      // canvas resolution, tried in order (see `pace`)
  pace: { slack: 1.22, frames: 40 },   // step down when frames arrive this much slower than the display for this long
  cpu: { ms: 4.5, frames: 24 },        // go one step lighter when the river's own script time per frame stays above this
  yarn: 5,                  // threads per yarn outside the fan zones
  swing: [0.15, 0.85],      // the river's far left and far right, as shares of the page width
  bundle: [0.06, 42, 96],   // bundle half-width: share of viewport width, min px, max px
  breathe: 0.2,             // how much the bundle swells and pinches along its length
  homeSpread: 0.9,          // how far strands sit from the centreline (x bundle half-width)
  wander: [0.24, 0.12],     // strand drift amplitudes (x bundle half-width)
  radius: [0.09, 0.4],      // strand ribbon half-width: min, and extra for the largest strand (x bundle half-width)
  flat: 0.22,               // ribbon thickness (depth spread of its threads) relative to its width
  depth: 0.45,              // strand depth swing, -1..1 scaled
  persp: 0.24,              // perspective strength
  twist: [0.00085, 0.4],    // radians of ribbon lean per px along the river, and how far it rocks
  line: [1.55, 1.15],       // thread width, CSS px: yarns in the river, single threads fanning into the loom
  alpha: 0.06,              // light of one thread
  glow: { every: 3, radius: 2.9, alpha: 0.15, scale: 8 },   // drawn into a buffer 1/scale the size, then stretched once
  shield: { scale: 40, grow: 26, strength: 0.72 },          // dimming behind content: mask buffer 1/scale the size (its
                                                            // stretch is the soft edge), box growth px, light removed
  shieldOn: "h1, h2, .eyebrow, .sub, .meta, .prose, .spec, .chart-box, .hall-grid, .panel, .iam, .snap, .loom-tools, .loom-lens, .legend, .note, .notes-grid, .countdown, .slot, .ghost",
  shieldInset: { ".ghost": 0.1 },                           // images with a feathered edge: the box is this much smaller
  reach: 1.1,               // the selected thread stays green this many viewport heights up and down the river
  motes: 36,                // sparks riding the threads downstream
  fan: [0.5, 110, 520],     // fan length: x the gate's distance from the turn's outer edge, min px, max px (it stays
                            // on the straight run, so the turn itself is a tight ribbon that cannot fold)
  dip: [0.42, 0.95],        // brightness fades to this share on the way to a gate, over this many screen heights,
                            // then rises again across the fan: no step where the river meets the loom
  // The C-turn into the loom and its mirror out of it. The river never leaves the page: its centreline keeps
  // `clear` bundle half-widths (at least `inside` of the width) away from the edge. `share` = corner radius as a
  // share of the room between that line and the gate; `tall` = height of the C in radii.
  turn: { inside: 0.06, clear: 1.75, share: 0.72, tall: 2.4, pinch: 0.55, reach: 1.1 },
  fade: 0.5,                // the river fades in over this share of a viewport height at its start
  stir: { cell: 54, radius: 150, gain: 0.45, max: 56, spring: 24, damp: 5.2 },
  highlight: "#4dff6a", highlightCore: "#c8ffd0"
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lowerBound = (arr, n, v) => {
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
};

export function initThreadRiver({ canvas, model, tints, start, stage, end, between = "main > section" }) {
  const born = performance.now();
  const ctx = canvas.getContext("2d");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = getComputedStyle(document.documentElement);
  const doom = ["--doom", "--doom-line", "--doom-deep"].map(n => d3.rgb(css.getPropertyValue(n).trim()));
  const arcColor = css.getPropertyValue("--arc").trim();
  const mainEl = document.querySelector("main");
  const { strands } = model;

  // ---- strands: fixed wave parameters, derived from the strand's index and its share of the threads ----
  const maxShare = d3.max(strands, s => s.share);
  const waves = strands.map(s => {
    const k = s.index, ph = k * 2.399963;               // golden angle keeps neighbouring strands out of phase
    const yarns = [];
    for (let i = 0; i < s.items.length; i += CFG.yarn) {
      const members = s.items.slice(i, i + CFG.yarn), lead = members[Math.floor(members.length / 2)];
      members.forEach(v => { v.yarn = lead; });
      yarns.push({ lead, members });
    }
    return {
      strand: s, yarns, ph, tint: tints[s.lane],
      home: s.mid * CFG.homeSpread,
      rad: CFG.radius[0] + CFG.radius[1] * Math.sqrt(s.share / maxShare),
      q1: 0.0016 + 0.0005 * Math.sin(ph), w1: 0.21 + 0.06 * Math.cos(ph * 1.3),
      q2: 0.0007 + 0.0003 * Math.cos(ph * 0.7), w2: 0.13 + 0.04 * Math.sin(ph * 2.1),
      q3: 0.0013 + 0.0004 * Math.sin(ph * 1.9), w3: 0.17 + 0.05 * Math.cos(ph * 0.6),
      tq: CFG.twist[0] * (1 + 0.35 * Math.cos(ph * 1.1)), tw: 0.14 + 0.05 * Math.sin(ph * 0.9)
    };
  });

  // ---- state ----
  let vw = 0, vh = 0, ch = 0, over = 0, docH = 0, dprLevel = 0, dpr = 1, base = 60, placed = -1;
  let segs = [], junction = null, sprites = null, shields = new Float32Array(0);
  const glowCanvas = document.createElement("canvas"), glow = glowCanvas.getContext("2d");
  const maskCanvas = document.createElement("canvas"), mask = maskCanvas.getContext("2d");
  let running = false, raf = 0, last = 0, cost = 0, highlight = null, shown = false;
  let refresh = Infinity, pace = 0, late = 0, settle = 0;   // display interval (ms), smoothed frame interval, late-frame run
  let lite = 0, heavy = 0;                                  // slow CPU: 1 = half the samples and yarns, 2 = a third

  // per-frame scratch (no allocation while drawing)
  const N = CFG.maxSamples;
  const sC = new Float32Array(N), sR = new Float32Array(N), sD = new Float32Array(N);
  const sCos = new Float32Array(N), sSin = new Float32Array(N), bx = new Float32Array(N), by = new Float32Array(N);

  // ---- pointer stir: a coarse grid of displaced, spring-damped cells pinned to the canvas ----
  const stir = { cols: 0, rows: 0, dx: null, dy: null, vx: null, vy: null, live: false,
                 cx: 0, cy: 0, px: 0, py: 0, lx: 0, ly: 0, has: false, moved: false };
  function sizeStir() {
    stir.cols = Math.ceil(vw / CFG.stir.cell) + 2;
    stir.rows = Math.ceil(ch / CFG.stir.cell) + 2;
    const n = stir.cols * stir.rows;
    stir.dx = new Float32Array(n); stir.dy = new Float32Array(n); stir.vx = new Float32Array(n); stir.vy = new Float32Array(n);
    stir.live = false;
  }
  function stepStir(dt) {
    const S = CFG.stir, { cols, rows, dx, dy, vx, vy } = stir;
    if (stir.moved && stir.has) {
      const mx = clamp((stir.px - stir.lx) * S.gain, -S.max, S.max), my = clamp((stir.py - stir.ly) * S.gain, -S.max, S.max);
      if (mx * mx + my * my > 0.02) {
        const c0 = Math.max(0, Math.floor((stir.px - S.radius) / S.cell)), c1 = Math.min(cols - 1, Math.ceil((stir.px + S.radius) / S.cell));
        const r0 = Math.max(0, Math.floor((stir.py - S.radius) / S.cell)), r1 = Math.min(rows - 1, Math.ceil((stir.py + S.radius) / S.cell));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
          const ex = c * S.cell - stir.px, ey = r * S.cell - stir.py, q = 1 - (ex * ex + ey * ey) / (S.radius * S.radius);
          if (q <= 0) continue;
          const i = r * cols + c, f = q * q * S.spring * 0.55;   // push as velocity, so the spring carries it out and back
          vx[i] += mx * f; vy[i] += my * f;
        }
        stir.live = true;
      }
    }
    stir.lx = stir.px; stir.ly = stir.py; stir.moved = false;
    if (!stir.live) return;
    let energy = 0;
    for (let i = 0, n = cols * rows; i < n; i++) {
      vx[i] += (-S.spring * dx[i] - S.damp * vx[i]) * dt;
      vy[i] += (-S.spring * dy[i] - S.damp * vy[i]) * dt;
      dx[i] = clamp(dx[i] + vx[i] * dt, -S.max, S.max);
      dy[i] = clamp(dy[i] + vy[i] * dt, -S.max, S.max);
      energy += Math.abs(dx[i]) + Math.abs(dy[i]) + (Math.abs(vx[i]) + Math.abs(vy[i])) * 0.05;
    }
    if (energy < 0.4) { dx.fill(0); dy.fill(0); vx.fill(0); vy.fill(0); stir.live = false; }
  }

  // ---- layout: measure the page (resize only), build both centrelines, sample them ----
  // d3.line draws the basis spline into this recorder instead of a canvas; the Béziers it emits are flattened
  // into a fine polyline, which is then re-sampled at even steps of arc length. (Asking an SVG path for
  // getPointAtLength gives the same points but took ~85 ms per layout; this takes under 1 ms.)
  const FLAT = 20;
  const recorder = {
    px: [], py: [], x: 0, y: 0,
    moveTo(x, y) { this.px.push(x); this.py.push(y); this.x = x; this.y = y; },
    lineTo(x, y) { this.px.push(x); this.py.push(y); this.x = x; this.y = y; },
    bezierCurveTo(x1, y1, x2, y2, x, y) {
      for (let i = 1; i <= FLAT; i++) {
        const t = i / FLAT, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        this.px.push(a * this.x + b * x1 + c * x2 + d * x); this.py.push(a * this.y + b * y1 + c * y2 + d * y);
      }
      this.x = x; this.y = y;
    },
    closePath() {}
  };
  const spline = d3.line().curve(d3.curveBasis).context(recorder);
  function sample(points, s0) {
    recorder.px = []; recorder.py = [];
    spline(points);
    const { px, py } = recorder, m = px.length, cum = new Float64Array(m);
    for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]);
    const len = cum[m - 1], n = Math.max(3, Math.ceil(len / CFG.step) + 1), ds = len / (n - 1);
    const seg = { n, ds, len, s0, x: new Float32Array(n), y: new Float32Array(n), ym: new Float32Array(n), nx: new Float32Array(n),
                  ny: new Float32Array(n), g: new Float32Array(n), wid: new Float32Array(n), calm: new Float32Array(n) };
    for (let i = 0, k = 1; i < n; i++) {
      const s = Math.min(len, i * ds);
      while (k < m - 1 && cum[k] < s) k++;
      const f = cum[k] > cum[k - 1] ? (s - cum[k - 1]) / (cum[k] - cum[k - 1]) : 0;
      seg.x[i] = px[k - 1] + (px[k] - px[k - 1]) * f; seg.y[i] = py[k - 1] + (py[k] - py[k - 1]) * f;
      seg.ym[i] = i ? Math.max(seg.ym[i - 1], seg.y[i]) : seg.y[i];   // non-decreasing, for the visible-range search
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const tx = seg.x[b] - seg.x[a], ty = seg.y[b] - seg.y[a], l = Math.hypot(tx, ty) || 1;
      seg.nx[i] = -ty / l; seg.ny[i] = tx / l;
    }
    return seg;
  }

  let sized = "";
  function layout() {
    const t0 = performance.now();
    vw = document.documentElement.clientWidth; vh = innerHeight;
    over = Math.round(vh * CFG.over); ch = vh + 2 * over;
    dpr = Math.min(devicePixelRatio || 1, CFG.dpr[dprLevel]);
    const size = `${vw}x${ch}@${dpr}`;
    if (size !== sized) {                                   // resizing a canvas clears it, so only when the size changed
      sized = size;
      canvas.style.height = `${ch}px`;
      canvas.width = Math.round(vw * dpr); canvas.height = Math.round(ch * dpr);
      glowCanvas.width = Math.ceil(vw / CFG.glow.scale); glowCanvas.height = Math.ceil(ch / CFG.glow.scale);
      maskCanvas.width = Math.ceil(vw / CFG.shield.scale); maskCanvas.height = Math.ceil(ch / CFG.shield.scale);
      sizeStir();
    }
    base = clamp(vw * CFG.bundle[0], CFG.bundle[1], CFG.bundle[2]);

    const sy = scrollY;
    const box = el => { const r = el.getBoundingClientRect(); return { top: r.top + sy, bottom: r.bottom + sy, left: r.left, width: r.width, height: r.height }; };
    docH = mainEl.getBoundingClientRect().bottom + sy;      // the canvas never reaches past the story, so it adds no scroll height
    const st = box(stage), geom = stageGeometry(st.width, st.height), sc = loomScales(model, geom);
    const from = box(start), to = box(end);
    const frac = (el, name, d) => (el.dataset[name] || d).split(/\s+/).map(Number);
    const [sxF, syF] = frac(start, "riverStart", "1 1"), [exF, eyF] = frac(end, "riverEnd", "0.5 0.3");
    const all = [...document.querySelectorAll(between)];
    const iLoom = all.findIndex(el => el.contains(stage)), iEnd = all.findIndex(el => el.contains(end));
    const side = [vw * CFG.swing[0], vw * CFG.swing[1]];    // the river's far left and far right
    // One point per chapter, at its middle, on alternating sides: the basis spline turns that into one slow S-curve
    // per chapter. Sides are counted back from the loom so the river arrives at the loom from the left.
    const swing = (els, firstSide, pts) => els.forEach((el, i) => { const b = box(el); pts.push([side[(firstSide + i) % 2], (b.top + b.bottom) / 2]); });

    // A: hero image → one swing per chapter → down the left of the loom chapter → loom entry gate
    const before = all.slice(0, iLoom).filter(el => box(el).top >= from.top + from.height * syF - 1);
    const x0 = st.left + geom.x0, x1 = st.left + geom.x1, yc = st.top + geom.yc;
    const loomBox = box(all[iLoom]);
    const yA = from.top + from.height * syF + vh * 0.03;
    const inside = Math.max(vw * CFG.turn.inside, base * CFG.turn.clear);   // closest the centreline comes to a page edge
    const startX = Math.min(from.left + from.width * sxF, vw) - inside;
    const A = [[startX, yA], [startX - vw * 0.06, yA + vh * 0.09]];
    swing(before, (before.length + 1) % 2, A);             // the last chapter before the loom is passed on the LEFT
    // Into the loom: one more S, like the swings above it. From the left swing the river keeps coming down, leans
    // out to a line just inside the left edge and bends once, wide, into the gate. The bend is one corner point:
    // `turnA` wide and `dropA` tall, as large as the room allows, and the bundle is pinched narrow there, so the
    // threads on the inside of the bend still have room to turn without crossing.
    const head = st.top - loomBox.top, run = yc - st.top;
    const near = Math.max(vw * CFG.turn.inside * CFG.turn.pinch, base * CFG.turn.pinch * CFG.turn.clear);   // edge clearance of the pinched bundle
    const edgeA = near, turnA = (x0 - edgeA) * CFG.turn.share, dropA = clamp(run + head * 0.4, turnA, turnA * CFG.turn.tall);
    A.push([edgeA, yc - dropA], [edgeA, yc], [edgeA + turnA, yc], [x0 - (x0 - edgeA - turnA) * 0.4, yc], [x0, yc]);
    const a = sample(A, 0);

    // B: loom exit gate → down the right of the loom chapter → one swing per chapter → the end image
    const after = all.slice(iLoom + 1, iEnd < 0 ? all.length : iEnd);
    const yEnd = to.top + to.height * eyF, xEnd = to.left + to.width * exF;
    const rest = vw - x1, runB = st.bottom - yc, tail = loomBox.bottom - st.bottom;
    // the way out mirrors it: straight out of the last gate, one wide bend down the right, then the next swing (right)
    const edgeB = vw - near, turnB = (edgeB - x1) * CFG.turn.share, dropB = clamp(runB + tail * 0.4, turnB, turnB * CFG.turn.tall);
    const B = [[x1, yc], [x1 + (edgeB - turnB - x1) * 0.4, yc], [edgeB - turnB, yc], [edgeB, yc], [edgeB, yc + dropB]];
    swing(after, 1, B);
    const yLast = B[B.length - 1][1], gap = to.top - yLast;
    B.push([xEnd + (B[B.length - 1][0] - xEnd) * 0.5, yLast + gap * 0.55], [xEnd, to.top - gap * 0.1], [xEnd, to.top + (yEnd - to.top) * 0.5], [xEnd, yEnd]);
    const b = sample(B, a.len + (x1 - x0));

    // blend to the loom's own thread positions near each gate
    // The fan (yarns fraying into single threads, bundle opening to the gate's height) starts back before the turn,
    // so the river thins out gradually instead of changing density, and so brightness, in one step at the gate.
    const fanA = clamp((x0 - edgeA) * CFG.fan[0], CFG.fan[1], CFG.fan[2]), fanB = clamp((edgeB - x1) * CFG.fan[0], CFG.fan[1], CFG.fan[2]);
    const ease = d3.easeCubicInOut;
    for (let i = 0; i < a.n; i++) {
      const dEnd = a.len - i * a.ds;
      a.g[i] = dEnd <= geom.ov ? 1 : dEnd >= fanA + geom.ov ? 0 : ease(1 - (dEnd - geom.ov) / fanA);
    }
    for (let i = 0; i < b.n; i++) {
      const s = i * b.ds;
      b.g[i] = s <= geom.ov ? 1 : s >= fanB + geom.ov ? 0 : ease(1 - (s - geom.ov) / fanB);
    }

    // shields: the boxes of text and charts the river passes behind (outermost matches only), in page coordinates
    const rects = [];
    for (const el of mainEl.querySelectorAll(CFG.shieldOn)) {
      if (stage.contains(el) || el.parentElement.closest(CFG.shieldOn) || el.closest("[data-river-start], [data-river-end]")) continue;
      const r = box(el), cut = Object.entries(CFG.shieldInset).find(([sel]) => el.matches(sel))?.[1] || 0;
      if (r.width > 4 && r.height > 4) rects.push(r.left + r.width * cut, r.top + r.height * cut, r.width * (1 - 2 * cut), r.height * (1 - 2 * cut));
    }
    shields = Float32Array.from(rects);

    for (const seg of [a, b]) {
      const raw = new Float32Array(seg.n);
      for (let i = 0; i < seg.n; i++) {
        const x = seg.x[i], y = seg.y[i];
        for (let k = 0; k < shields.length; k += 4) {
          if (x > shields[k] - 20 && x < shields[k] + shields[k + 2] + 20 && y > shields[k + 1] - 20 && y < shields[k + 1] + shields[k + 3] + 20) { raw[i] = 1; break; }
        }
      }
      for (let i = 0, k = 4; i < seg.n; i++) {
        let sum = 0, cnt = 0;
        for (let j = Math.max(0, i - k); j <= Math.min(seg.n - 1, i + k); j++) { sum += raw[j]; cnt++; }
        seg.calm[i] = sum / cnt;                            // 1 = under content: the pointer does not stir it there
        const s = seg.s0 + i * seg.ds, dStart = i * seg.ds, dEnd = seg.len - dStart;
        const taper = seg === a ? 0.5 + 0.5 * clamp(dStart / (vh * 0.8), 0, 1) : 0.3 + 0.7 * clamp(dEnd / (vh * 0.9), 0, 1);
        // towards a gate the bundle is pinched narrower (eased over CFG.turn.reach screen heights), for the bend
        const toGate = seg === a ? dEnd : dStart, open = clamp(toGate / (vh * CFG.turn.reach), 0, 1), pinch = CFG.turn.pinch + (1 - CFG.turn.pinch) * open * open * (3 - 2 * open);
        seg.wid[i] = base * (1 + CFG.breathe * Math.sin(s * 0.0011 + 1.3) * open) * taper * pinch;
      }
    }
    a.fanFrom = Math.max(0, lowerBound(a.g, a.n, 1e-6) - 1); a.fanTo = a.n - 1; a.loomHalf = sc.entryHalf; a.kind = "A";
    b.fanFrom = 0; b.fanTo = b.n - 1; while (b.fanTo > 0 && b.g[b.fanTo - 1] === 0) b.fanTo--; b.loomHalf = sc.exitHalf; b.kind = "B";
    a.y0 = yA; a.y1 = yc; b.y0 = yc; b.y1 = yEnd;
    a.fanX = [a.x[a.fanFrom], x0]; b.fanX = [x1, b.x[b.fanTo]];   // page x where each fan starts and ends
    a.level = dropA * 0.3; b.level = dropB * 0.3;           // page height near the gate over which the light stays level
    segs = [a, b];
    junction = { top: st.top, bottom: st.bottom, x0, x1, ov: geom.ov };
    const total = a.len + b.len;
    motes.forEach(m => { if (!(m.s < total)) m.s = Math.random() * total; });
    placed = -1;
    performance.measure("river-layout", { start: t0, end: performance.now() });
    wake();
  }

  // ---- sprites: one soft dot per colour, rendered once ----
  function makeSprites() {
    const dot = color => {
      const c = document.createElement("canvas"), g = c.getContext("2d");
      c.width = c.height = 128;
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64), rgb = d3.rgb(color);
      grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},.55)`);
      grad.addColorStop(0.4, `rgba(${rgb.r},${rgb.g},${rgb.b},.16)`);
      grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
      return c;
    };
    sprites = { warm: dot(d3.rgb(arcColor).darker(0.5)), doom: dot(doom[0]), spark: dot(d3.interpolateRgb(arcColor, "#fff")(0.75)), sparkDoom: dot(doom[0].brighter(1.2)) };
  }

  // ---- motes: sparks that ride a yarn downstream ----
  const allYarns = waves.flatMap(w => w.yarns.map(y => ({ wave: w, yarn: y })));
  const motes = reduced ? [] : d3.range(CFG.motes).map(i => ({ ref: allYarns[Math.floor(Math.abs(Math.sin(i * 91.7)) * allYarns.length) % allYarns.length], s: NaN, v: 46 + 70 * Math.abs(Math.sin(i * 12.9)), r: 2.2 + 3.2 * Math.abs(Math.cos(i * 4.1)) }));

  // strand centre, ribbon radius, lean and depth at each visible sample
  function wave(seg, w, a, b, t) {
    for (let j = a, k = 0; j <= b; j++, k++) {
      const s = seg.s0 + j * seg.ds, wid = seg.wid[j];
      const tw = w.ph + s * w.tq + CFG.twist[1] * Math.sin(s * 0.0009 + t * w.tw + w.ph);
      sCos[k] = Math.cos(tw); sSin[k] = Math.sin(tw);
      sC[k] = wid * (w.home + CFG.wander[0] * Math.sin(s * w.q1 - t * w.w1 + w.ph) + CFG.wander[1] * Math.sin(s * w.q2 + t * w.w2 + w.ph * 1.7));
      sD[k] = CFG.depth * Math.sin(s * w.q3 - t * w.w3 + w.ph * 2.3);
      sR[k] = wid * w.rad;
    }
  }
  // append the traced points to the current path as one smooth curve (quadratics through the midpoints)
  function curve(n) {
    ctx.moveTo(bx[0], by[0]);
    for (let k = 1; k < n - 1; k++) ctx.quadraticCurveTo(bx[k], by[k], (bx[k] + bx[k + 1]) / 2, (by[k] + by[k + 1]) / 2);
    ctx.lineTo(bx[n - 1], by[n - 1]);
  }

  // colour along the river is a function of page y: fade in at the start; turn Doom green and die out at the end
  function paint(seg, tint, top) {
    const grad = ctx.createLinearGradient(0, seg.y0 - top, 0, seg.y1 - top), c = d3.rgb(tint);
    const rgba = (col, al) => `rgba(${col.r | 0},${col.g | 0},${col.b | 0},${al})`;
    const span = seg.y1 - seg.y0, dip = clamp(vh * CFG.dip[1] / span, 0.02, 0.3);
    if (seg.kind === "A") {
      grad.addColorStop(0, rgba(c, 0));
      grad.addColorStop(clamp(vh * CFG.fade / span, 0.01, 0.6), rgba(c, 1));
      // dimmed fully before the fan starts and level from there on, so the yarns and the fan meet at one brightness
      grad.addColorStop(1 - dip, rgba(c, 1));
      grad.addColorStop(1 - Math.min(dip * 0.6, seg.level / span), rgba(c, CFG.dip[0]));
      grad.addColorStop(1, rgba(c, CFG.dip[0]));
    } else {
      grad.addColorStop(0, rgba(c, CFG.dip[0]));
      grad.addColorStop(Math.min(dip * 0.6, seg.level / span), rgba(c, CFG.dip[0]));
      grad.addColorStop(dip, rgba(c, 1));
      grad.addColorStop(0.42, rgba(d3.rgb(d3.interpolateRgb(c, doom[0])(0.85)), 1));
      grad.addColorStop(0.78, rgba(doom[1].brighter(0.5), 0.95));
      grad.addColorStop(0.97, rgba(doom[1], 0.7));
      grad.addColorStop(1, rgba(doom[2], 0));
    }
    return grad;
  }

  function visible(seg, top) {
    const m = base * 2.6;
    let a = Math.max(0, lowerBound(seg.ym, seg.n, top - m) - 1), b = Math.min(seg.n - 1, lowerBound(seg.ym, seg.n, top + ch + m));
    const off = i => seg.x[i] < -m || seg.x[i] > vw + m;
    while (a < b && off(a) && off(a + 1)) a++;
    while (b > a && off(b) && off(b - 1)) b--;
    if (b - a + 1 > N) b = a + N - 1;
    return b - a >= 2 ? [a, b] : null;
  }

  // Which samples to draw: every `stride`-th one from `from` to `to`, counted from `anchor` so that the sample at
  // the fan boundary (or at the gate) is always among them. Both ends are always included. Returns the count.
  const listA = new Int32Array(N + 2), listB = new Int32Array(N + 2);
  function pickSamples(list, from, to, stride, anchor) {
    if (to - from < 1) return 0;
    let n = 0;
    list[n++] = from;
    for (let j = from + 1 + ((anchor - from - 1) % stride + stride) % stride; j < to; j += stride) list[n++] = j;
    list[n++] = to;
    return n;
  }

  function drawSegment(seg, t, top) {
    const range = visible(seg, top);
    if (!range) return false;
    const [a, b] = range, isA = seg.kind === "A";
    // River part (yarns) and fan part (single threads) of the visible range. The fan curves are gentle, so the fan
    // uses every second sample. On a slow CPU (lite 1 or 2) the river also skips samples and draws every 2nd or 3rd
    // yarn that much brighter, and the fan draws every 2nd thread twice as bright: same light, less work.
    const stride = 1 + lite, thin = lite ? 2 : 1;
    const nr = pickSamples(listA, isA ? a : Math.max(a, seg.fanTo), isA ? Math.min(b, seg.fanFrom) : b, stride, isA ? seg.fanFrom : seg.fanTo);
    const nf = pickSamples(listB, Math.max(a, seg.fanFrom), Math.min(b, seg.fanTo), Math.max(2, stride), isA ? seg.fanTo : seg.fanFrom);
    const grads = new Map(), fans = new Map();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "butt";                                   // round ends would overlap where a yarn meets its fan and show as a seam
    for (const w of waves) {
      wave(seg, w, a, b, t);
      if (!grads.has(w.tint)) grads.set(w.tint, paint(seg, w.tint, top));
      ctx.strokeStyle = grads.get(w.tint);
      const near = 0.8 + 0.2 * sD[(b - a) >> 1] / CFG.depth;            // strands in front are a little brighter
      // a yarn carries the light of its threads (the strand's average yarn size), spread over its wider line
      const perYarn = w.strand.items.length / w.yarns.length;
      const yarnLight = Math.min(1, CFG.alpha * perYarn * near * CFG.line[1] / CFG.line[0] * 1.25);
      if (nr >= 2) {
        const skip = w.yarns.length > 1 ? stride : 1;
        ctx.lineWidth = CFG.line[0];
        ctx.beginPath();
        for (let i = 0; i < w.yarns.length; i += skip) {
          const lead = w.yarns[i].lead;
          traceShift(seg, w, lead.su, lead.sv, lead.u, a, listA, nr, top);
          curve(nr);
        }
        ctx.globalAlpha = Math.min(1, yarnLight * skip);
        ctx.stroke();
      }
      if (nf >= 2) {
        // The fan. Lines that lie on top of each other in one stroke do not add their light, so a yarn cannot simply
        // be replaced by its threads where it frays. Instead its lead thread carries on and hands the light over:
        // across the fan the lead fades from the whole yarn's light (dipped) to one thread's, while its siblings
        // fade in from nothing to one thread's. Same line width throughout. No step at either end.
        const items = w.strand.items, one = 1 / perYarn;
        if (!fans.has(w.tint)) {
          const c = d3.rgb(w.tint), col = al => `rgba(${c.r},${c.g},${c.b},${al})`;
          const lead = ctx.createLinearGradient(seg.fanX[0], 0, seg.fanX[1], 0), sib = ctx.createLinearGradient(seg.fanX[0], 0, seg.fanX[1], 0);
          lead.addColorStop(isA ? 0 : 1, col(CFG.dip[0])); lead.addColorStop(isA ? 1 : 0, col(Math.min(1, one)));
          sib.addColorStop(isA ? 0 : 1, col(0)); sib.addColorStop(isA ? 1 : 0, col(Math.min(1, one)));
          fans.set(w.tint, [lead, sib]);
        }
        const [leadStyle, sibStyle] = fans.get(w.tint);
        ctx.lineWidth = CFG.line[0];
        ctx.globalAlpha = yarnLight;
        ctx.strokeStyle = leadStyle;
        ctx.beginPath();
        for (const y of w.yarns) { traceShift(seg, w, y.lead.su, y.lead.sv, y.lead.u, a, listB, nf, top); curve(nf); }
        ctx.stroke();
        ctx.globalAlpha = Math.min(1, yarnLight * thin);
        ctx.strokeStyle = sibStyle;
        ctx.beginPath();
        for (let i = 0, k = 0; i < items.length; i++) {
          const v = items[i];
          if (v.yarn === v || k++ % thin) continue;
          traceShift(seg, w, v.yarn.su, v.yarn.sv, v.u, a, listB, nf, top);
          curve(nf);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";

    // hand over to the loom canvas: fade the river out across the overlap at the gate
    if (junction && junction.bottom - top > 0 && junction.top - top < ch) {
      const j = junction, gx0 = isA ? j.x0 - j.ov : j.x1, gx1 = gx0 + j.ov;
      const g = ctx.createLinearGradient(gx0, 0, gx1, 0);
      g.addColorStop(0, isA ? "rgba(0,0,0,0)" : "rgba(0,0,0,1)");
      g.addColorStop(1, isA ? "rgba(0,0,0,1)" : "rgba(0,0,0,0)");
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = g;
      ctx.fillRect(gx0, j.top - top, j.ov, j.bottom - j.top);
      ctx.fillStyle = "#000";
      if (isA) ctx.fillRect(gx1, j.top - top, j.x1 - gx1, j.bottom - j.top);
      ctx.globalCompositeOperation = "lighter";
    }

    // glow: soft sprites along the centreline, into the small buffer (frame() stretches it over the canvas)
    const G = CFG.glow, span = seg.y1 - seg.y0, q = 1 / G.scale;
    for (let j = a - (a % G.every) + G.every; j <= b; j += G.every) {
      const r = (seg.wid[j] + (seg.loomHalf - seg.wid[j]) * seg.g[j] * 0.5) * G.radius, x = seg.x[j], y = seg.y[j] - top;
      if (x < -r || x > vw + r || y < -r || y > ch + r) continue;
      const f = (seg.y[j] - seg.y0) / span;
      const mix = seg.kind === "B" ? clamp((f - 0.1) / 0.4, 0, 1) : 0;
      const al = G.alpha * (seg.kind === "A" ? clamp(f * (seg.y1 - seg.y0) / (vh * CFG.fade), 0, 1) : clamp((1 - f) * 6, 0, 1));
      if (mix < 1) { glow.globalAlpha = al * (1 - mix); glow.drawImage(sprites.warm, (x - r) * q, (y - r) * q, r * 2 * q, r * 2 * q); }
      if (mix > 0) { glow.globalAlpha = al * mix * 0.8; glow.drawImage(sprites.doom, (x - r) * q, (y - r) * q, r * 2 * q, r * 2 * q); }
    }
    return true;
  }
  // Screen position of one thread at the n samples in `list` (the strand arrays start at sample a): its yarn's
  // place in the leaning ribbon, pushed sideways by depth, blended to its own loom position near a gate, then
  // stirred (not near a gate, and not under content).
  function traceShift(seg, w, su, sv, u, a, list, n, top) {
    const S = CFG.stir, live = stir.live, cols = stir.cols;
    sv *= CFG.flat;
    for (let o = 0; o < n; o++) {
      const j = list[o], k = j - a;
      const lat = sC[k] + sR[k] * (su * sCos[k] - sv * sSin[k]);
      const dep = sD[k] + w.rad * (su * sSin[k] + sv * sCos[k]);
      const g = seg.g[j];
      let off = lat / (1 - dep * CFG.persp);
      if (g > 0) off += (u * seg.loomHalf - off) * g;
      let x = seg.x[j] + seg.nx[j] * off, y = seg.y[j] + seg.ny[j] * off - top;
      if (live && g < 1) {
        const fx = clamp(x / S.cell, 0, cols - 1.001), fy = clamp(y / S.cell, 0, stir.rows - 1.001);
        const cx = fx | 0, cy = fy | 0, ax = fx - cx, ay = fy - cy, i = cy * cols + cx, i2 = i + cols;
        const m00 = (1 - ax) * (1 - ay), m10 = ax * (1 - ay), m01 = (1 - ax) * ay, m11 = ax * ay, keep = (1 - g) * (1 - seg.calm[j]);
        x += (stir.dx[i] * m00 + stir.dx[i + 1] * m10 + stir.dx[i2] * m01 + stir.dx[i2 + 1] * m11) * keep;
        y += (stir.dy[i] * m00 + stir.dy[i + 1] * m10 + stir.dy[i2] * m01 + stir.dy[i2 + 1] * m11) * keep;
      }
      bx[o] = x; by[o] = y;
    }
  }

  function drawMotes(t, top, dt) {
    const total = segs[0].len + segs[1].len;
    ctx.globalCompositeOperation = "lighter";
    for (const m of motes) {
      m.s += m.v * dt;
      if (m.s > total) m.s -= total;
      const seg = m.s < segs[0].len ? segs[0] : segs[1], local = seg === segs[0] ? m.s : m.s - segs[0].len;
      const j = Math.min(seg.n - 2, Math.floor(local / seg.ds));
      const y = seg.y[j] - top;
      if (y < -120 || y > ch + 120 || seg.g[j] > 0.6) continue;
      const w = m.ref.wave, lead = m.ref.yarn.lead;
      wave(seg, w, j, j + 1, t);
      listA[0] = j; listA[1] = j + 1;
      traceShift(seg, w, lead.su, lead.sv, lead.u, j, listA, 2, top);
      const f = local / seg.ds - j, x = bx[0] + (bx[1] - bx[0]) * f, yy = by[0] + (by[1] - by[0]) * f;
      const prog = (seg.y[j] - seg.y0) / (seg.y1 - seg.y0);
      const fade = seg.kind === "A" ? clamp(prog * (seg.y1 - seg.y0) / (vh * CFG.fade), 0, 1) : clamp((1 - prog) * 5, 0, 1);
      ctx.globalAlpha = 0.85 * fade;
      ctx.drawImage(seg.kind === "B" && prog > 0.3 ? sprites.sparkDoom : sprites.spark, x - m.r, yy - m.r, m.r * 2, m.r * 2);
    }
    ctx.globalAlpha = 1;
  }

  // Dim the river wherever it runs under text or a chart. The boxes are filled into a tiny mask buffer; stretching
  // that buffer over the canvas blurs their edges for free, and "destination-out" takes the light away.
  function drawShields(top) {
    const S = CFG.shield, q = 1 / S.scale;
    mask.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    mask.fillStyle = "#000";
    for (let k = 0; k < shields.length; k += 4) {
      const y = shields[k + 1] - top - S.grow, h = shields[k + 3] + 2 * S.grow;
      if (y > ch || y + h < 0) continue;
      mask.fillRect((shields[k] - S.grow) * q, y * q, (shields[k + 2] + 2 * S.grow) * q, h * q);
    }
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = S.strength;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(maskCanvas, 0, 0, maskCanvas.width * S.scale, maskCanvas.height * S.scale);
    ctx.globalAlpha = 1;
  }

  // The selected thread, lit Loki green where the river carries it. The green is brightest at the loom and dies
  // out along the river (CFG.reach), so it never competes with the Doom green at the end of the page.
  const GLOW = [[13, 0.1, CFG.highlight], [6, 0.24, CFG.highlight], [2.4, 0.95, CFG.highlight], [0.9, 0.9, CFG.highlightCore]];
  function drawHighlight(t, top) {
    const v = highlight, w = waves[v.strand], reach = vh * CFG.reach, piece = 4;
    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";
    for (const seg of segs) {
      const range = visible(seg, top);
      if (!range) continue;
      const [a, b] = range;
      wave(seg, w, a, b, t);
      for (let j = a; j < b; j += piece) {
        const mid = Math.min(b, j + piece / 2) * seg.ds, fromGate = seg.kind === "A" ? seg.len - mid : mid;
        const fade = 1 - fromGate / reach;
        if (fade <= 0) continue;
        const jb = Math.min(b, j + piece), n = pickSamples(listA, j, jb, 1, j);
        traceShift(seg, w, v.yarn.su, v.yarn.sv, v.u, a, listA, n, top);
        for (const [width, alpha, color] of GLOW) {
          ctx.beginPath(); curve(n);
          ctx.lineWidth = width; ctx.globalAlpha = alpha * fade * fade; ctx.strokeStyle = color; ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1; ctx.lineCap = "butt";
  }

  // ---- frame ----
  function frame(now) {
    raf = 0;
    const t0 = performance.now(), gap = last ? now - last : 0, dt = Math.min(0.05, gap ? gap / 1000 : 0.016), t = reduced ? 0 : now / 1000;
    last = now;
    // put the canvas back under the viewport (it scrolls with the page between frames), never past the story's end
    const sy = scrollY, top = Math.round(clamp(sy - over, 0, Math.max(0, docH - ch)));
    if (top !== placed) { placed = top; canvas.style.transform = `translate3d(0,${top}px,0)`; }
    if (!reduced) {
      stir.px = stir.cx; stir.py = stir.cy + sy - top;
      stepStir(dt);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, ch);
    glow.globalCompositeOperation = "source-over";
    glow.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
    glow.globalCompositeOperation = "lighter";
    let drew = false;
    for (const seg of segs) drew = drawSegment(seg, t, top) || drew;
    if (drew) {
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(glowCanvas, 0, 0, glowCanvas.width * CFG.glow.scale, glowCanvas.height * CFG.glow.scale);
      if (motes.length) drawMotes(t, top, dt);
      if (shields.length) drawShields(top);
      if (highlight) drawHighlight(t, top);
      if (!shown) { shown = true; canvas.classList.add("on"); performance.measure("river-first-frame", { start: t0, end: performance.now() }); }
    }
    // Adapt: the shortest frame interval seen is the display's refresh interval. If frames keep arriving slower than
    // that, lower the canvas resolution one step. It never steps back up, so it cannot oscillate.
    cost += (performance.now() - t0 - cost) * 0.08;
    if (lite < 2 && drew && cost > CFG.cpu.ms) { if (++heavy > CFG.cpu.frames) { lite++; heavy = -CFG.cpu.frames; } } else if (heavy > 0) heavy = 0;
    if (drew && gap > 3 && gap < 100 && dprLevel < CFG.dpr.length - 1 && dpr > 1) {
      if (++settle > 20) {                                 // skip the first frames after a start or a resize
        refresh = Math.min(refresh, gap);
        pace = pace ? pace + (gap - pace) * 0.1 : gap;
        late = pace > refresh * CFG.pace.slack + 0.5 ? late + 1 : 0;
        if (late > CFG.pace.frames) { late = 0; pace = 0; settle = 0; dprLevel++; layout(); return; }
      }
    } else if (!drew) { settle = 0; pace = 0; late = 0; }
    running = drew && !reduced && !document.hidden;
    if (running) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  function wake() { if (!raf) raf = requestAnimationFrame(frame); }

  // ---- wiring ----
  makeSprites();
  let timer = 0;
  const relayout = () => { clearTimeout(timer); timer = setTimeout(layout, 140); };
  addEventListener("resize", relayout, { passive: true });
  addEventListener("scroll", wake, { passive: true });
  document.addEventListener("visibilitychange", wake);
  new ResizeObserver(relayout).observe(mainEl);            // lazy views change section heights
  if (!reduced) addEventListener("pointermove", e => {
    stir.cx = e.clientX; stir.cy = e.clientY;
    if (!stir.has) { stir.px = stir.lx = stir.cx; stir.py = stir.ly = stir.cy + over; stir.has = true; }
    stir.moved = true;
  }, { passive: true });
  layout();
  performance.measure("river-init", { start: born, end: performance.now() });

  return {
    setHighlight(v) { highlight = v || null; wake(); },
    config: CFG,                                           // tuning knobs, reachable as window.__river with ?debug
    relayout: layout,
    stats: () => ({ cost: +cost.toFixed(2), dpr, lite, refresh: +refresh.toFixed(2), pace: +pace.toFixed(2), running, samples: segs.map(s => s.n), shields: shields.length / 4 })
  };
}
