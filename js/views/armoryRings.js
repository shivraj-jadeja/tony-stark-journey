// Chapter 3 · "Armory Rings": every armor Tony wore, as segments of an arc reactor (design/03).
//   right half = MCU (cyan) · left half = main comics, Earth-616 (gold)
//   outer ring = each side's 12 most-seen armors, angle = share of appearances within its half
//   inner ring = the rest, equal slices
//   broken arcs on the diagonals = armors Tony built for someone else, one arc per wearer
// Interaction: the hovered piece grows outward and widens while its neighbours ease aside (critically damped,
// frame-rate independent), with an optional gear sound. Hit-testing is plain maths on the live geometry, so
// there are no per-path listeners, and the animation frame loop runs only while pieces are moving.
// MCU pieces share the selected suit with the timeline in Chapter 4 (core/selection.js).
import { fmtUsd } from "../core/format.js";
import { onSuitSelect, selectSuit } from "../core/selection.js";
import { createGearSound } from "../core/gearSound.js";

const CYAN = "#5fd8ff", GOLD = "#e3a83c";
const R = { core: 52, inner: [64, 96], outer: [108, 176], others: [212, 226] };
const POP = { outer: 22, inner: 16, others: 12 };       // outward growth of the focused piece (px)
const GROW = { outer: 0.75, inner: 3.2, others: 0.7 };  // extra width of the focused piece (x its base weight)
const FALLOFF = [1, 0.4, 0.16, 0.05];                   // focus strength for the piece and its neighbours ±1..3
const SMOOTH = 0.24;                                    // seconds to settle
const GAP = 0.05, TAU = Math.PI * 2;
const HALF = { MCU: [GAP, Math.PI - GAP], Comics: [Math.PI + GAP, TAU - GAP] };
const DIAG = { "War Machine": 45, "Rescue": 135, "S.H.I.E.L.D. Alpha Team": 225, "Mister Fantastic": 315 };
const SOUND = { inner: ["light", 1], outer: ["heavy", 1], others: ["heavy", 1.35] };
const RING_ORDER = ["inner", "outer", "others"];

export function mountArmoryRings({ svg: svgEl, panel: panelEl, soundButton, armors, suits }) {
  const svg = d3.select(svgEl);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sound = createGearSound(soundButton);
  const suitByMark = new Map(suits.map(s => [s.mark, s]));

  // ---- groups: a run of pieces sharing one ring and one angular span ----
  const groups = [];
  const add = (ring, span, items, weight, color, universe, pad, label = null) =>
    groups.push({ ring, span, pad, color, universe, label,
      items: items.map(d => ({ d, w: weight(d), t: 0, v: 0, goal: 0, a0: 0, a1: 0 })) });
  for (const [u, color] of [["MCU", CYAN], ["Comics", GOLD]]) {
    const mine = armors.filter(a => a.universe === u);
    add("outer", HALF[u], mine.filter(a => a.ring === "outer"), a => Math.max(a.appearances, 1), color, u, 0.012);
    add("inner", HALF[u], mine.filter(a => a.ring === "inner"), () => 1, color, u, 0.003);
  }
  for (const [wearer, items] of d3.groups(armors.filter(a => a.ring === "others"), a => a.group)) {
    const c = (DIAG[wearer] ?? 0) * Math.PI / 180, span = (6 + 5 * items.length) * Math.PI / 180;
    add("others", [c - span / 2, c + span / 2], items, () => 1, items[0].universe === "MCU" ? CYAN : GOLD,
      items[0].universe, 0.02, wearer);
  }
  const pieces = groups.flatMap(g => g.items.map((p, i) => Object.assign(p, { g, i })));
  const ringPieces = Object.fromEntries(RING_ORDER.map(r => [r, pieces.filter(p => p.g.ring === r)]));

  // ---- geometry: widen each piece by its focus, then pack its group into the span ----
  function layout(g) {
    const [s0, s1] = g.span, ws = g.items.map(p => p.w * (1 + GROW[g.ring] * p.t)), tot = d3.sum(ws);
    const free = s1 - s0 - g.pad * g.items.length;
    let a = s0;
    g.items.forEach((p, i) => { p.a0 = a + g.pad / 2; a += ws[i] / tot * free + g.pad; p.a1 = a - g.pad / 2; });
  }
  const arc = d3.arc().cornerRadius(1.5);
  const pathOf = p => {
    const [r0, r1] = R[p.g.ring];
    return arc({ innerRadius: r0 - 2 * p.t, outerRadius: r1 + POP[p.g.ring] * p.t, startAngle: p.a0, endAngle: p.a1 });
  };
  const opacity = p => p.g.ring === "inner" ? 0.42 + 0.5 * p.t : p.g.ring === "others" ? 0.5 + 0.45 * p.t : 0.78 + 0.22 * p.t;
  groups.forEach(layout);

  // ---- marks ----
  const paths = svg.append("g").attr("class", "pieces").selectAll("path").data(pieces).join("path")
    .attr("class", p => `piece ${p.g.ring}`).attr("fill", p => p.g.color).attr("d", pathOf).attr("fill-opacity", opacity);
  const labels = svg.append("g").selectAll("text").data(ringPieces.outer).join("text").attr("class", "lbl").attr("dy", "0.32em")
    .text(p => p.d.name.replace("Mark ", "MK ").replace("Model ", "M"));
  const placeLabels = () => labels
    .attr("transform", p => {
      const a = (p.a0 + p.a1) / 2;
      return `rotate(${a * 180 / Math.PI - 90}) translate(${R.outer[1] + 6 + POP.outer * p.t},0)${a > Math.PI ? " rotate(180)" : ""}`;
    })
    .attr("text-anchor", p => (p.a0 + p.a1) / 2 > Math.PI ? "end" : "start")
    .classed("on", p => p.t > 0.5);
  placeLabels();
  for (const g of groups.filter(g => g.label)) {
    const c = (g.span[0] + g.span[1]) / 2, r = R.others[1] + 22;
    svg.append("text").attr("class", "grp").attr("fill", g.color).attr("x", Math.sin(c) * r).attr("y", -Math.cos(c) * r)
      .attr("dy", "0.32em").attr("text-anchor", Math.sin(c) > 0 ? "start" : "end").text(`${g.label} · ${g.items.length}`);
  }
  for (const [u, color] of [["MCU", CYAN], ["Comics", GOLD]]) {
    const m = (HALF[u][0] + HALF[u][1]) / 2, n = armors.filter(a => a.universe === u && a.ring !== "others").length;
    svg.append("text").attr("class", "half").attr("fill", color).attr("text-anchor", "middle")
      .attr("x", Math.sin(m) * 318).attr("y", -Math.cos(m) * 318 + 4).text(`${u === "MCU" ? "MCU" : "COMICS"} · ${n}`);
  }
  const core = svg.append("g").attr("class", "core");
  core.append("circle").attr("r", R.core);
  core.append("text").attr("class", "core-n").attr("text-anchor", "middle").attr("y", 9)
    .text(armors.filter(a => a.ring !== "others").length);
  core.append("text").attr("class", "core-l").attr("text-anchor", "middle").attr("y", 27).text("ARMORS WORN");

  // ---- animation: critically damped ease (no overshoot), runs only while something moves ----
  let raf = 0, last = 0;
  function tick(now) {
    raf = 0;
    const dt = Math.max(1 / 240, Math.min(0.05, last ? (now - last) / 1000 : 1 / 60));
    last = now;
    const w = 2 / SMOOTH, x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let moving = false;
    for (const p of pieces) {
      if (reduced) { p.t = p.goal; p.v = 0; continue; }
      const c = p.t - p.goal, tmp = (p.v + w * c) * dt;
      p.v = (p.v - w * tmp) * e;
      p.t = p.goal + (c + tmp) * e;
      if (Math.abs(p.goal - p.t) > 0.001 || Math.abs(p.v) > 0.001) moving = true; else { p.t = p.goal; p.v = 0; }
    }
    groups.forEach(layout);
    paths.attr("d", pathOf).attr("fill-opacity", opacity);
    placeLabels();
    if (moving) raf = requestAnimationFrame(tick); else last = 0;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  // ---- focus ----
  let current = null;
  function focus(p, { quiet = false, fromSelection = false } = {}) {
    if (p === current) return;
    current = p;
    for (const q of pieces) q.goal = 0;
    if (p) {
      FALLOFF.forEach((val, k) => {
        for (const j of [p.i - k, p.i + k]) {
          const q = p.g.items[j];
          if (q) q.goal = Math.max(q.goal, val);
        }
      });
      if (!quiet) sound.tick(...SOUND[p.g.ring]);
      renderPanel(panelEl, p);
      if (!fromSelection && p.d.mark != null && suitByMark.has(p.d.mark)) selectSuit(suitByMark.get(p.d.mark));
    }
    paths.classed("on", q => q === p);
    kick();
  }

  // hit-test on the live geometry: radius picks the ring, angle picks the piece
  function pick(px, py) {
    const r = Math.hypot(px, py);
    let a = Math.atan2(px, -py); if (a < 0) a += TAU;
    const ring = r >= R.others[0] - 6 && r <= R.others[1] + 16 ? "others"
      : r >= R.outer[0] - 4 && r <= R.outer[1] + 26 ? "outer"
      : r >= R.inner[0] - 4 && r < R.outer[0] - 4 ? "inner" : null;
    if (!ring) return null;
    for (const g of groups) {
      if (g.ring !== ring || a < g.span[0] - 0.02 || a > g.span[1] + 0.02) continue;
      return g.items.find(p => a >= p.a0 - g.pad && a <= p.a1 + g.pad) || null;
    }
    return null;
  }
  let pending = null;
  svg.on("pointermove pointerdown", e => {          // one pick per frame, however fast the pointer moves
    const [x, y] = d3.pointer(e, svgEl);
    if (!pending) requestAnimationFrame(() => { const hit = pick(...pending); pending = null; focus(hit); });
    pending = [x, y];
  }).on("pointerleave", () => focus(null));      // pieces settle back; the panel keeps the last armor

  // keyboard: ←/→ walk along the ring, ↑/↓ change ring, Esc clears
  svg.on("keydown", e => {
    if (!current) {
      if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Enter"].includes(e.key)) return;
      focus(ringPieces.outer[0]); e.preventDefault(); return;
    }
    const ring = current.g.ring;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const list = ringPieces[ring], step = e.key === "ArrowRight" ? 1 : -1;
      focus(list[(list.indexOf(current) + step + list.length) % list.length]);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const next = RING_ORDER[RING_ORDER.indexOf(ring) + (e.key === "ArrowUp" ? 1 : -1)];
      if (!next) return;
      const mid = (current.a0 + current.a1) / 2;
      focus(d3.least(ringPieces[next], p => Math.abs((p.a0 + p.a1) / 2 - mid)));
    } else if (e.key === "Escape") {
      focus(null);
    } else return;
    e.preventDefault();
  });

  // the timeline (Chapter 4) can select an MCU suit too
  onSuitSelect(s => {
    const p = pieces.find(q => q.d.universe === "MCU" && q.d.mark === s.mark);
    if (p) focus(p, { quiet: true, fromSelection: true });
  });
}

// ---- detail panel: only fields the sources give; blanks are left out, never filled in ----
function renderPanel(el, p) {
  const a = p.d, mcu = a.universe === "MCU", color = mcu ? CYAN : GOLD;
  const where = a.ring === "others" ? `Built by Tony for ${a.group}`
    : a.ring === "outer" ? `#${a.rank} most seen · ${mcu ? "MCU" : "main comics"}` : mcu ? "MCU" : "Main comics (Earth-616)";
  const rows = [
    a.appearances ? [mcu || a.ring === "others" ? "Appearances" : "Issues with Tony", a.appearances.toLocaleString("en-US")] : null,
    a.value != null ? ["Est. value", fmtUsd(a.value)] : null,
    a.built ? ["Built", a.built] : null,
    a.firstYear ? ["First seen", a.firstYear] : null,
    a.weight ? ["Weight", a.weight] : null,
    a.height ? ["Height", a.height] : null
  ].filter(Boolean).slice(0, 6);
  const chips = (a.films.length ? a.films : a.capabilities).map(x => `<span>${x}</span>`).join("");
  el.innerHTML = `
    <div class="model">${a.name}</div>
    <div class="code">${a.codename ? `"${a.codename}"` : a.era || "&nbsp;"}</div>
    <span class="chip" style="background:${color}">${where}</span>
    ${a.ability ? `<p class="ability">${a.ability}</p>` : ""}
    ${rows.length ? `<dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}
    ${a.first ? `<p class="src">First appearance: ${a.first}${a.designer ? ` · designed by ${a.designer}` : ""}</p>` : ""}
    ${chips ? `<div class="films">${chips}</div>` : ""}
    <p class="src"><a href="${a.url}" target="_blank" rel="noopener">Marvel Database page</a>${a.creators ? ` · created by ${a.creators}` : ""}</p>`;
}
