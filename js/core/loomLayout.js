// Shared layout for the Temporal Loom (design/04). Two modules draw the same threads and must agree on them:
//   core/threadRiver.js   the page-long background river that carries the threads into and out of the loom
//   views/temporalLoom.js the loom chart itself (Chapter 5)
// Everything here is derived from data/processed/variants.csv and variant_years.csv: the thread order, the lanes,
// the eras, the gate sizes. The only constants are the layout fractions in STAGE and LANE below.
const d3 = window.d3;

// Where the loom sits inside its stage box, as fractions of the box (layout only, no data).
// The loom leaves about a quarter of the width free on each side, so the threads are seen arriving and leaving.
const STAGE = { x0: 0.27, x1: 0.77, yc: 0.46, half: 0.3, overlap: 0.025 };
// A lane never gets thinner than this share of the loom's height, so a lane with one thread can still be hovered.
const LANE = { floor: 0.055, gap: 0.018 };
// One tint per lane (names as written by build_variants() in scripts/build_processed.py). Hue only groups;
// brightness carries the data. The family is the page's arc-reactor blue (--arc) with cool neighbours, so the
// threads belong to the page; the one warm thread is the MCU Tony the story follows. Loki green stays unique to
// the selected thread, and Doom green to the end of the page.
const LANE_TINT = { "Earth-616 comics": "#eaf9ff", "MCU": "#ffb07a", "Other comics": "#6fd4ff", "TV series": "#7f9dff",
                    "Films": "#b9a2ff", "Other media": "#62e0d0", "Undated": "#5f7f96" };
export const tintOf = lane => LANE_TINT[lane] || "#6fd4ff";
const ERA_TICKS = 6;          // asks d3 for about this many round year steps; d3 picks the actual boundaries
const GATE_MIN = 0.07;        // radius of a gate with zero variants, as a share of the largest gate

const NARROW = { below: 720, x0: 0.17, x1: 0.87 };   // on a phone the loom needs the width more than the margins
export function stageGeometry(w, h) {
  const x0 = w < NARROW.below ? NARROW.x0 : STAGE.x0, x1 = w < NARROW.below ? NARROW.x1 : STAGE.x1;
  return { w, h, x0: w * x0, x1: w * x1, yc: h * STAGE.yc, half: h * STAGE.half, ov: w * STAGE.overlap };
}

// Deterministic 0..1 value per thread index, used only to spread threads in depth inside the river (not data).
const hash01 = i => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// Order the threads and derive lanes, eras and river strands.
//   thread.u   vertical position in the loom, -1 (top) .. 1 (bottom)
//   lanes      one band per kind of variant, ordered by the lane's earliest debut
//   eras       year ranges between d3's round ticks; count = variants with an appearance dated in that range
//   strands    runs of threads sharing a lane and a debut era: the sub-bundles that braid in the river
export function buildLoomModel(variants) {
  const dated = variants.filter(v => v.firstYear != null);
  const yearMin = d3.min(dated, v => v.firstYear), yearMax = d3.max(dated, v => v.lastYear);
  const cuts = d3.scaleLinear().domain([yearMin, yearMax]).ticks(ERA_TICKS).filter(t => t > yearMin && t <= yearMax);
  const bounds = [yearMin, ...cuts, yearMax + 1];
  const eras = d3.pairs(bounds).map(([from, to]) => ({ from, to: to - 1, count: 0 }));
  const eraOf = year => Math.min(eras.length - 1, d3.bisectRight(cuts, year));
  for (const v of variants) {
    const hit = new Set(v.years.map(y => eraOf(y.year)));
    hit.forEach(i => eras[i].count++);
    v.era = v.firstYear == null ? eras.length : eraOf(v.firstYear);   // undated variants sit after the last era
  }

  const lanes = d3.groups(variants, v => v.lane)
    .map(([name, items]) => ({ name, items, first: d3.min(items, v => v.firstYear) ?? Infinity }))
    .sort((a, b) => a.first - b.first || d3.ascending(a.name, b.name));
  const room = 1 - LANE.gap * (lanes.length - 1);
  const raw = lanes.map(l => Math.max(l.items.length / variants.length, LANE.floor));
  const scale = room / d3.sum(raw);
  let y = 0;
  const threads = [];
  lanes.forEach((lane, li) => {
    const h = raw[li] * scale;
    lane.index = li;
    lane.y0 = -1 + 2 * y;
    lane.y1 = -1 + 2 * (y + h);
    lane.items.sort((a, b) => (a.firstYear ?? Infinity) - (b.firstYear ?? Infinity)
      || b.appearances - a.appearances || d3.ascending(a.id, b.id));
    lane.items.forEach((v, j) => {
      v.laneIndex = li;
      v.u = lane.y0 + (j + 0.5) / lane.items.length * (lane.y1 - lane.y0);
      v.index = threads.length;
      threads.push(v);
    });
    y += h + LANE.gap;
  });

  const strands = d3.groups(threads, v => `${v.laneIndex}|${v.era}`).map(([, items], k) => {
    const u0 = items[0].u, u1 = items[items.length - 1].u, mid = (u0 + u1) / 2, half = Math.max((u1 - u0) / 2, 1e-6);
    items.forEach(v => {
      v.strand = k;
      v.su = (v.u - mid) / half;            // position across the strand, -1..1
      v.sv = hash01(v.index) * 2 - 1;       // depth inside the strand, -1..1
    });
    return { index: k, lane: items[0].laneIndex, items, mid, share: items.length / threads.length };
  });

  return { threads, lanes, strands, eras, yearMin, yearMax, total: threads.length };
}

// Scales for one stage size. Gates: the entry gate lets every thread in; each later gate closes an era and its
// radius is the number of variants that appear in that era (sqrt scale, so ring AREA follows the count).
// envelope(x) is the half-height of the thread bundle at pixel x: it eases from gate to gate.
export function loomScales(model, geom) {
  const x = d3.scaleLinear().domain([model.yearMin, model.yearMax + 1]).range([geom.x0, geom.x1]);
  const r = d3.scaleSqrt().domain([0, model.total]).range([geom.half * GATE_MIN, geom.half]);
  const gates = [
    { entry: true, x: geom.x0, count: model.total, r: r(model.total) },
    ...model.eras.map(e => ({ entry: false, era: e, x: x(e.to + 1), count: e.count, r: r(e.count) }))
  ];
  const env = d3.scaleLinear()
    .domain(gates.map(g => g.x)).range(gates.map(g => g.r))
    .interpolate((a, b) => t => a + (b - a) * d3.easeCubicInOut(t))
    .clamp(true);
  return { x, r, gates, envelope: env, entryHalf: gates[0].r, exitHalf: gates[gates.length - 1].r };
}
