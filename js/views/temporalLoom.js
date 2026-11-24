// Chapter 5 · "Temporal Loom": every Tony Stark variant in the Marvel Database as one thread (design/04).
//   x            year, left to right (comic cover date, or release year for episodes and films)
//   one thread   one variant. It is faint for its whole length and bright in the years it appears;
//                brighter = more appearances that year (log scale)
//   lanes        threads are stacked by kind (Earth-616, other comics, TV, films, MCU ...), earliest debut on top
//   gates        the entry gate lets every thread in. Each later gate closes an era; its radius is the number of
//                variants that appear in that era (sqrt scale). The bundle is squeezed to fit each gate, so the
//                loom's outline is the count of active Tonys over time
//   dots         white = first dated appearance, red = the year of the death the wiki lists
// The threads arrive from, and leave into, the background river (core/threadRiver.js); both use core/loomLayout.js.
//
// Interaction: hovering a thread marks it with a white line and a small readout (reality, year, appearances).
// Clicking or tapping selects it: Loki green runs along it from the point of the click, the other threads dim, and
// the panel shows that Tony's life. Clicking the selected thread again, or empty space, clears the selection.
// Arrow keys step between threads, Enter pins, Esc clears, and the search box finds a reality by name.
//
// Performance: all threads are drawn once into the base canvas (the glow is one blurred copy, also baked). A hover
// redraws a single thread on the small top canvas. Hit-testing is a binary search over the thread order, so there
// are no per-thread DOM nodes or listeners. The loop runs only while the loom is on screen.
import { fmtInt } from "../core/format.js";
import { loomScales, stageGeometry, tintOf } from "../core/loomLayout.js";

const d3 = window.d3;
const GREEN = "#4dff6a", GREEN_CORE = "#c8ffd0";
const CFG = {
  dpr: 2, maxPx: 3000,        // canvas resolution caps
  step: 8,                    // px between samples of a thread
  faint: 0.085,               // light of an inactive thread
  dim: 0.2,                   // threads outside the chosen lens keep this share of their light
  active: [0.5, 1],           // light of an active year: 1 appearance .. the busiest year in the data
  levels: 5,                  // brightness steps the active years are batched into
  hit: 9,                     // px: how close the pointer must be to a thread
  grow: 650,                  // ms for the green to run the length of the loom
  settle: 70,                 // ms the pointer rests on a thread before the panel is rebuilt
  squash: 0.2,                // gates are circles seen at an angle
  glints: 44                  // streaks of light travelling along the threads (motion only, not data)
};

export function mountTemporalLoom({ stage, panel, tip, search, options, quick, legend, lensBox, lensNote, model, river }) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = getComputedStyle(document.documentElement);
  const RED = css.getPropertyValue("--red").trim(), GOLD = css.getPropertyValue("--gold").trim();
  const base = stage.querySelector(".loom-base"), hi = stage.querySelector(".loom-hi");
  const svg = d3.select(stage.querySelector("svg"));
  const { threads, lanes } = model;
  const us = Float32Array.from(threads, v => v.u);
  const byId = new Map(threads.map(v => [v.id, v]));
  const debutOrder = d3.sort(threads.filter(v => v.firstYear != null), v => v.firstYear, v => -v.appearances);
  threads.forEach(v => { v.byYear = new Map(v.years.map(y => [y.year, y.n])); });
  const busiest = d3.max(threads, v => d3.max(v.years, y => y.n));
  const light = d3.scaleLog().domain([1, busiest]).range(CFG.active).clamp(true);

  // ---- lenses: light up the threads that share one fact from the wiki page; the rest go dim ----
  // Each test reads a column of variants.csv (rules in build_variants()). Counts are computed here, not typed.
  const LENSES = [
    { key: "all", label: "All Tonys", test: () => true },
    { key: "avengers", label: "Avengers members", test: v => v.teams.some(t => /Avengers/.test(t)) },
    { key: "public", label: "Public identity", test: v => v.identity === "Public" },
    { key: "secret", label: "Secret identity", test: v => v.identity === "Secret" },
    { key: "death", label: "Death listed", test: v => !!v.death },
    { key: "killer", label: "Killer named", test: v => v.killedBy.length > 0 },
    { key: "armor", label: "Armor model named", test: v => v.armors.length > 0 },
    { key: "long", label: "Seen in 2+ years", test: v => v.firstYear != null && v.lastYear > v.firstYear }
  ].map(l => ({ ...l, count: threads.filter(l.test).length }));
  let lens = LENSES[0];
  const eraOf = year => model.eras.findIndex(e => year >= e.from && year <= e.to);
  threads.forEach(v => { v.eraSet = new Set(v.years.map(y => eraOf(y.year))); });

  let w = 0, h = 0, dpr = 1, geom, sc, xs, env, spark;
  let hover = null, pinned = null, shown = null, growFrom = 0, growStart = 0, riverLit = null;
  let inView = false, raf = 0, pointer = null, queued = false, panelTimer = 0;

  const yAt = (v, px) => geom.yc + v.u * sc.envelope(px);
  const threadLine = d3.line().x((e, i) => xs[i]);

  // ---- bake: every thread, once ----
  function bake() {
    const t0 = performance.now();
    const box = stage.getBoundingClientRect();
    w = Math.round(box.width); h = Math.round(box.height);
    if (!w || !h) return;
    geom = stageGeometry(w, h); sc = loomScales(model, geom);
    dpr = Math.min(devicePixelRatio || 1, CFG.dpr, CFG.maxPx / w);
    for (const c of [base, hi]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    xs = d3.range(geom.x0 - geom.ov, geom.x1 + geom.ov + CFG.step, CFG.step);
    env = xs.map(sc.envelope);

    const g = base.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    // far halves of the gates, behind the threads
    const arc = d3.arc().context(g);
    g.fillStyle = GOLD;
    for (const gate of sc.gates) {
      g.save(); g.translate(gate.x, geom.yc); g.scale(CFG.squash, 1); g.globalAlpha = 0.3;
      g.beginPath(); arc({ innerRadius: gate.r + 3, outerRadius: gate.r + 9, startAngle: 0, endAngle: Math.PI }); g.fill();
      g.restore();
    }

    g.globalCompositeOperation = "lighter";
    threadLine.context(g);
    // Threads outside the chosen lens are drawn the same way, only dimmer (CFG.dim).
    const sides = [[true, 1], [false, CFG.dim]];
    // 1. the whole length of every thread, faint
    g.lineWidth = 1;
    for (const lane of lanes) for (const [on, k] of sides) {
      g.strokeStyle = tintOf(lane.name);
      g.globalAlpha = CFG.faint * k;
      g.beginPath();
      for (const v of lane.items) if (lens.test(v) === on) threadLine.y((e, i) => geom.yc + v.u * e)(env);
      g.stroke();
    }
    // 2. the years each variant appears in, batched by lane, lens and brightness level
    g.lineWidth = 1.8;
    g.lineCap = "round";
    for (const lane of lanes) for (const [on, k] of sides) {
      g.strokeStyle = d3.interpolateRgb(tintOf(lane.name), "#fff")(0.45);
      const batches = d3.group(lane.items.filter(v => lens.test(v) === on).flatMap(v => v.years.map(y => ({ v, y }))), d => Math.round(light(d.y.n) * CFG.levels));
      for (const [level, items] of batches) {
        g.globalAlpha = level / CFG.levels * k;
        g.beginPath();
        for (const { v, y } of items) {
          const xa = sc.x(y.year), xb = sc.x(y.year + 1), n = Math.max(1, Math.ceil((xb - xa) / CFG.step));
          g.moveTo(xa, yAt(v, xa));
          for (let j = 1; j <= n; j++) { const px = xa + (xb - xa) * j / n; g.lineTo(px, yAt(v, px)); }
        }
        g.stroke();
      }
    }
    // 3. canon dots: first dated appearance (white), listed death (red)
    for (const [on, k] of sides) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.95 * k;
      g.fillStyle = "#f2fbff";
      g.beginPath();
      for (const v of threads) if (v.firstYear != null && lens.test(v) === on) { const px = sc.x(v.firstYear); g.moveTo(px + 1.6, yAt(v, px)); g.arc(px, yAt(v, px), 1.6, 0, 7); }
      g.fill();
      g.globalCompositeOperation = "source-over";
      g.fillStyle = RED;
      g.beginPath();
      for (const v of threads) if (v.deathYear != null && lens.test(v) === on) { const px = sc.x(v.deathYear + 0.5); g.moveTo(px + 2.1, yAt(v, px)); g.arc(px, yAt(v, px), 2.1, 0, 7); }
      g.fill();
    }
    // 4. glow: one blurred quarter-size copy, added back (skipped where canvas filters are missing)
    if ("filter" in g) {
      const soft = document.createElement("canvas"), sg = soft.getContext("2d");
      soft.width = Math.ceil(base.width / 4); soft.height = Math.ceil(base.height / 4);
      sg.filter = `blur(${Math.max(2, Math.round(3 * dpr))}px)`;
      sg.drawImage(base, 0, 0, soft.width, soft.height);
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.75;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(soft, 0, 0, base.width, base.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    // 5. fade both ends: the background river fades the other way across the same strip
    const fade = g.createLinearGradient(geom.x0 - geom.ov, 0, geom.x1 + geom.ov, 0), f = geom.ov / (geom.x1 - geom.x0 + 2 * geom.ov);
    fade.addColorStop(0, "rgba(0,0,0,0)"); fade.addColorStop(f, "#000"); fade.addColorStop(1 - f, "#000"); fade.addColorStop(1, "rgba(0,0,0,0)");
    g.globalCompositeOperation = "destination-in";
    g.globalAlpha = 1;
    g.fillStyle = fade;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = "source-over";

    drawFrame();
    drawChrome();
    performance.measure("loom-bake", { start: t0, end: performance.now() });
  }

  // ---- SVG on top: near halves of the gates, labels, axis, the selected thread's canon events ----
  function drawChrome() {
    svg.attr("viewBox", `0 0 ${w} ${h}`);
    const arc = d3.arc();
    const era = g => g.entry ? "All" : g.era.from === g.era.to ? `${g.era.from}` : `${g.era.from}–${String(g.era.to).slice(-2)}`;
    svg.selectAll("g.gate").data(sc.gates).join(enter => {
      const g = enter.append("g").attr("class", "gate");
      g.append("path").attr("class", "rim");
      g.append("path").attr("class", "rim thin");
      g.append("text").attr("class", "gate-n");
      g.append("text").attr("class", "gate-era");
      return g;
    }).attr("transform", d => `translate(${d.x},${geom.yc})`).each(function (d) {
      const g = d3.select(this), near = { startAngle: Math.PI, endAngle: 2 * Math.PI };
      g.select(".rim").attr("transform", `scale(${CFG.squash},1)`).attr("d", arc({ innerRadius: d.r + 3, outerRadius: d.r + 9, ...near }));
      g.select(".rim.thin").attr("transform", `scale(${CFG.squash},1)`).attr("d", arc({ innerRadius: d.r + 13, outerRadius: d.r + 14.5, ...near }));
      // with a lens on, each gate reads "Tonys in the lens / all Tonys" for its era
      const i = sc.gates.indexOf(d) - 1, inLens = d.entry ? lens.count : threads.filter(v => v.eraSet.has(i) && lens.test(v)).length;
      g.select(".gate-n").attr("y", -d.r - 26).text(lens.key === "all" ? fmtInt(d.count) : `${fmtInt(inLens)} / ${fmtInt(d.count)}`);
      g.select(".gate-era").attr("y", -d.r - 46).text(era(d));
    });
    svg.selectAll("g.axis").data([0]).join("g").attr("class", "axis").attr("transform", `translate(0,${h - 40})`)
      .call(d3.axisBottom(sc.x).tickValues([model.yearMin, ...model.eras.slice(1).map(e => e.from), model.yearMax]).tickFormat(d3.format("d")).tickSizeOuter(0));
    svg.selectAll("text.axis-ttl").data([0]).join("text").attr("class", "axis-ttl").attr("x", (geom.x0 + geom.x1) / 2).attr("y", h - 6)
      .text("Year of appearance (comic cover date, or release year)");
    svg.selectAll("text.lane").data(lanes).join("text").attr("class", "lane")
      .attr("x", geom.x0 - sc.entryHalf * CFG.squash - 16).attr("y", d => geom.yc + (d.y0 + d.y1) / 2 * sc.entryHalf).attr("dy", "0.32em")
      .attr("fill", d => tintOf(d.name)).text(d => `${d.name} · ${fmtInt(d.items.length)}`);
    svg.selectAll("g.marks").data([0]).join("g").attr("class", "marks");
    drawMarks();
  }
  function drawMarks() {
    const v = shown, rows = !v || v.firstYear == null ? [] : [
      { k: "first", x: sc.x(v.firstYear), label: `First · ${v.firstYear}`, side: -1 },
      ...(v.deathYear != null ? [{ k: "death", x: sc.x(v.deathYear + 0.5), label: `Death · ${v.deathYear}`, side: 1 }] : []),
      ...(v.lastYear !== v.firstYear ? [{ k: "last", x: sc.x(v.lastYear + 1), label: `Last · ${v.lastYear}`, side: -1 }] : [])
    ];
    svg.select("g.marks").selectAll("g").data(rows, d => d.k).join(enter => {
      const g = enter.append("g");
      g.append("circle").attr("r", 4.5);
      g.append("text");
      return g;
    }).attr("class", d => d.k).attr("transform", d => `translate(${d.x},${yAt(v, d.x)})`)
      .select("text").attr("y", d => d.side * 14).attr("dy", d => d.side < 0 ? 0 : "0.7em")
      .attr("text-anchor", d => d.k === "last" ? "start" : d.k === "first" ? "end" : "middle").text(d => d.label);
  }

  // ---- top canvas: sparks, and the selected thread in Loki green growing from the point of touch ----
  const glints = reduced ? [] : d3.range(CFG.glints).map(() => ({ v: null, x: 0, s: 0 }));
  const respawn = (gl, anywhere) => {
    gl.v = debutOrder[Math.floor(Math.random() * debutOrder.length)];
    gl.x = anywhere ? geom.x0 + Math.random() * (geom.x1 - geom.x0) : geom.x0 - geom.ov;
    gl.s = 40 + Math.random() * 110;
  };
  function makeSpark() {
    spark = document.createElement("canvas");
    spark.width = spark.height = 32;
    const g = spark.getContext("2d"), grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(238,250,255,.95)"); grad.addColorStop(0.35, "rgba(130,214,255,.35)"); grad.addColorStop(1, "rgba(130,214,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  }
  let lastT = 0;
  function drawFrame(now = performance.now()) {
    if (!geom) return false;
    const g = hi.getContext("2d"), dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0);
    lastT = now;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = "lighter";
    for (const gl of glints) {
      if (!gl.v) respawn(gl, true);
      gl.x += gl.s * dt;
      if (gl.x > geom.x1 + geom.ov) respawn(gl, false);
      const edge = Math.min(1, (gl.x - geom.x0 + geom.ov) / geom.ov, (geom.x1 + geom.ov - gl.x) / geom.ov);
      g.globalAlpha = 0.6 * Math.max(0, edge) * (shown ? 0.35 : 1);
      g.drawImage(spark, gl.x - 20, yAt(gl.v, gl.x) - 1.6, 22, 3.2);    // a streak, so it cannot be read as a data dot
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    // the thread under the pointer: a plain white line, so it is clear which thread a click would select
    if (hover && hover !== shown) {
      g.lineCap = "round"; g.lineJoin = "round";
      threadLine.context(g).y((en, i) => geom.yc + hover.u * en);
      for (const [width, alpha] of [[5, 0.14], [1.5, 0.95]]) {
        g.beginPath(); threadLine(env);
        g.lineWidth = width; g.globalAlpha = alpha; g.strokeStyle = "#f2fbff"; g.stroke();
      }
      g.globalAlpha = 1;
    }
    let growing = false;
    if (shown) {
      const v = shown, xa = geom.x0 - geom.ov, xb = geom.x1 + geom.ov;
      const e = reduced ? 1 : d3.easeCubicOut(Math.min(1, (now - growStart) / CFG.grow));
      const left = growFrom - (growFrom - xa) * e, right = growFrom + (xb - growFrom) * e;
      growing = e < 1;
      g.save();
      g.beginPath(); g.rect(left, 0, right - left, h); g.clip();
      g.lineCap = "round"; g.lineJoin = "round";
      threadLine.context(g).y((en, i) => geom.yc + v.u * en);
      for (const [width, alpha, color] of [[15, 0.09, GREEN], [7, 0.22, GREEN], [2.6, 1, GREEN], [1, 0.9, GREEN_CORE]]) {
        g.beginPath(); threadLine(env);
        g.lineWidth = width; g.globalAlpha = alpha; g.strokeStyle = color; g.stroke();
      }
      // the years this Tony appears in burn white-green
      g.globalAlpha = 1; g.strokeStyle = "#f2fff4"; g.lineWidth = 3.4;
      g.beginPath();
      for (const y of v.years) {
        const x0 = sc.x(y.year), x1 = sc.x(y.year + 1), n = Math.max(1, Math.ceil((x1 - x0) / CFG.step));
        g.moveTo(x0, yAt(v, x0));
        for (let k = 1; k <= n; k++) { const px = x0 + (x1 - x0) * k / n; g.lineTo(px, yAt(v, px)); }
      }
      g.stroke();
      g.restore();
      if (growing) {
        g.globalCompositeOperation = "lighter";
        for (const px of [left, right]) g.drawImage(spark, px - 13, yAt(v, px) - 13, 26, 26);
        g.globalCompositeOperation = "source-over";
      } else if (riverLit !== v) { riverLit = v; river?.setHighlight(v); }
    }
    return growing || glints.length > 0;
  }
  function loop(now) {
    raf = 0;
    if (drawFrame(now) && inView && !document.hidden) raf = requestAnimationFrame(loop);
    else lastT = 0;
  }
  const wake = () => { if (!raf) raf = requestAnimationFrame(loop); };

  // ---- hit-test: un-squeeze the pointer's y, binary-search the thread order, prefer a thread active that year ----
  function pick(px, py) {
    if (px < geom.x0 - geom.ov || px > geom.x1 + geom.ov) return null;
    const E = sc.envelope(px), un = (py - geom.yc) / E, tol = CFG.hit / E;
    if (un < -1 - tol || un > 1 + tol) return null;
    const year = Math.floor(sc.x.invert(px));
    let best = null, score = Infinity;
    for (let i = d3.bisectLeft(us, un - tol), end = d3.bisectRight(us, un + tol); i < end; i++) {
      const v = threads[i], d = Math.abs(us[i] - un) * E;
      const s = d + (v.byYear.has(year) ? 0 : v.firstYear != null && year >= v.firstYear && year <= v.lastYear ? CFG.hit : CFG.hit * 2);
      if (s < score) { score = s; best = v; }
    }
    return best;
  }

  // ---- selection ----
  function show(v, fromX) {
    if (v === shown) return;
    shown = v;
    stage.classList.toggle("has-pick", !!v);
    if (v) { growFrom = fromX ?? sc.x(v.firstYear ?? model.yearMin); growStart = performance.now(); }
    if (riverLit) { riverLit = null; river?.setHighlight(null); }
    drawMarks();
    // The thread lights at once; the panel follows when the pointer rests, so a fast sweep does not rebuild it every frame.
    clearTimeout(panelTimer);
    if (v && v === hover) panelTimer = setTimeout(() => renderPanel(shown), CFG.settle);
    else renderPanel(v);
    if (reduced) drawFrame(); else wake();
  }
  const current = () => pinned;       // only a click (or the keyboard, search, a story button) selects; hover just points
  function pin(v, fromX) {
    pinned = v;
    stage.setAttribute("aria-label", v ? `Temporal Loom. Selected: ${v.designation}. Arrow keys step between threads, Escape clears.` : stageLabel);
    show(current(), fromX);
  }
  const stageLabel = stage.getAttribute("aria-label");

  function renderTip(v, px, py) {
    if (!v || px == null) { tip.style.opacity = 0; return; }
    const year = Math.floor(sc.x.invert(px)), n = v.byYear.get(year);
    tip.innerHTML = `<b>${esc(v.designation)}</b><div class="m">${year} · ${n ? `${fmtInt(n)} appearance${n > 1 ? "s" : ""}` : "no appearance listed"}</div>`;
    tip.style.opacity = 1;
    tip.style.transform = `translate(${Math.min(px + 16, w - 230)}px, ${Math.max(8, py - 58)}px)`;
  }

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function renderPanel(v) {
    if (!v) {   // nothing selected: the overview. How many threads each lane holds, as bars on one scale.
      const most = d3.max(lanes, l => l.items.length), bar = d3.scaleLinear().domain([0, most]).range([0, 100]);
      const single = threads.filter(t => t.firstYear != null && t.firstYear === t.lastYear).length;
      panel.innerHTML = `
        <div class="loom-empty">
          <div class="model">${fmtInt(model.total)} threads</div>
          <p>Each thread is one Tony Stark listed in the Marvel Database. ${fmtInt(single)} of them are seen in a single year, so most threads light up once and go dark.</p>
          <p>Click a thread to light it and read that life: first appearance, death if the wiki lists one, last appearance, and the story chapters in order.</p>
        </div>
        <div class="loom-lanes">
          <h3>Threads per lane</h3>
          <ul>${lanes.map(l => `<li><span>${esc(l.name)}</span><i><b style="width:${bar(l.items.length).toFixed(1)}%;background:${tintOf(l.name)}"></b></i><em>${fmtInt(l.items.length)}</em></li>`).join("")}</ul>
        </div>`;
      return;
    }
    const few = (list, n = 3) => list.length > n ? `${list.slice(0, n).join(", ")} +${list.length - n} more` : list.join(", ");
    const how = v.killedBy.length ? `Killed by ${few(v.killedBy)}` : v.cause;
    const events = [
      ["First appearance", v.first, v.firstYear],
      ["Death", [v.death, how].filter(Boolean).join(" · "), v.deathYear],
      ["Last dated appearance", null, v.lastYear !== v.firstYear ? v.lastYear : null]
    ].filter(e => e[1] || e[2] != null);
    const media = [["comics", v.seen.comics], ["episodes", v.seen.tv], ["films", v.seen.film], ["other", v.seen.other]].filter(m => m[1]);
    const facts = [["Appearances", `${fmtInt(v.appearances)} + ${fmtInt(v.minor)} minor`],
      ["Years seen", v.firstYear == null ? "not dated" : v.firstYear === v.lastYear ? v.firstYear : `${v.firstYear}–${v.lastYear}`],
      ["Seen in", media.map(m => `${fmtInt(m[1])} ${m[0]}`).join(", ")], ["Identity", v.identity],
      ["Teams", few(v.teams)], ["Occupation", few(v.occupation)], ["Armor models", few(v.armors)],
      ["Created by", v.creators]].filter(f => f[1] != null && f[1] !== "");
    panel.innerHTML = `
      <div class="loom-id">
        <div class="lane-chip" style="color:${tintOf(v.lane)}">${esc(v.lane)}</div>
        <div class="model">${esc(v.designation)}</div>
        <div class="code">${esc(v.name)}${v.alias ? ` · ${esc(v.alias)}` : ""}</div>
        <dl>${facts.map(([k, val]) => `<div><dt>${k}</dt><dd>${esc(val)}</dd></div>`).join("")}</dl>
      </div>
      <div class="loom-life">
        <h3>Canon events</h3>
        ${events.length ? `<ol class="events">${events.map(([k, title, year]) => `<li><span>${k}</span><b>${year ?? "undated"}</b>${title ? `<em>${esc(title)}</em>` : ""}</li>`).join("")}</ol>` : `<p class="note">The wiki lists no dated event for this Tony.</p>`}
        <svg class="loom-spark" viewBox="0 0 320 84" role="img" aria-label="Appearances per year for ${esc(v.designation)}"></svg>
      </div>
      <div class="loom-journey">
        <h3>Journey</h3>
        ${v.chapters.length ? `<ol>${v.chapters.map(c => `<li>${esc(c)}</li>`).join("")}</ol><p class="note">Story chapters from the wiki page, in order. They are not dated.</p>`
          : `<p class="note">The wiki page has no story chapters for this Tony.</p>`}
        <p class="src"><a href="${esc(v.url)}" target="_blank" rel="noopener">Marvel Database page</a></p>
      </div>`;
    // appearances per year, on the loom's own time axis
    const s = d3.select(panel).select(".loom-spark"), m = { l: 4, r: 4, t: 14, b: 16 }, W = 320, H = 84;
    const x = d3.scaleLinear().domain([model.yearMin, model.yearMax + 1]).range([m.l, W - m.r]);
    const top = d3.max(v.years, y => y.n) || 1, y = d3.scaleLinear().domain([0, top]).range([H - m.b, m.t]);
    s.append("line").attr("class", "base").attr("x1", m.l).attr("x2", W - m.r).attr("y1", H - m.b).attr("y2", H - m.b);
    s.selectAll("rect").data(v.years).join("rect").attr("x", d => x(d.year)).attr("width", Math.max(1, x(1) - x(0) - 0.6))
      .attr("y", d => y(d.n)).attr("height", d => H - m.b - y(d.n));
    s.append("text").attr("x", m.l).attr("y", H - 3).text(model.yearMin);
    s.append("text").attr("x", W - m.r).attr("y", H - 3).attr("text-anchor", "end").text(model.yearMax);
    s.append("text").attr("x", m.l).attr("y", 9).text(v.years.length ? `appearances per year (with minor) · peak ${fmtInt(top)}` : "no dated appearances");
  }

  // ---- legend: brightness ramp, gate size, dots ----
  function renderLegend() {
    const lo = d3.interpolateRgb("#07090d", tintOf(lanes[0].name));
    legend.innerHTML = `
      <span class="key"><i class="ramp" style="background:linear-gradient(90deg, ${lo(CFG.active[0] * 0.5)}, #fff)"></i>brighter = more appearances that year, minor ones included (1 to ${fmtInt(busiest)})</span>
      <span class="key"><i class="ring"></i>gate size = Tonys seen in that era</span>
      <span class="key"><i class="dot first"></i>first dated appearance</span>
      <span class="key"><i class="dot death"></i>death listed by the wiki</span>
      <span class="key"><i class="dot pick"></i>the thread you click</span>`;
  }

  // ---- wiring ----
  const local = e => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function onPointer() {
    queued = false;
    if (!pointer) return;
    const [px, py] = pointer, v = pick(px, py);
    hover = v;
    stage.style.cursor = v ? "pointer" : "";
    renderTip(v, px, py);
    if (reduced) drawFrame(); else wake();
  }
  stage.addEventListener("pointermove", e => {
    if (e.pointerType === "touch") return;                 // touch selects on tap (click), so scrolling stays free
    pointer = local(e);
    if (!queued) { queued = true; requestAnimationFrame(onPointer); }
  });
  stage.addEventListener("pointerleave", () => { pointer = null; hover = null; renderTip(null); if (reduced) drawFrame(); else wake(); });
  stage.addEventListener("click", e => {
    const [px, py] = local(e), v = pick(px, py);
    hover = null;
    pin(v && v !== pinned ? v : null, px);
    renderTip(v, px, py);
  });
  stage.addEventListener("keydown", e => {
    const cur = current(), i = cur ? cur.index : -1;
    let next = null;
    if (e.key === "Escape") { pin(null); return; }
    if (e.key === "ArrowDown") next = threads[Math.min(threads.length - 1, i + 1)];
    else if (e.key === "ArrowUp") next = threads[Math.max(0, i - 1)];
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const j = cur ? debutOrder.indexOf(cur) : -1, step = e.key === "ArrowRight" ? 1 : -1;
      next = debutOrder[Math.min(debutOrder.length - 1, Math.max(0, j + step))];
    } else return;
    e.preventDefault();
    hover = null;
    pin(next);
  });

  // search: any reality by name
  options.innerHTML = threads.map(v => `<option value="${esc(v.designation)}">`).join("");
  const find = q => {
    q = q.trim().toLowerCase();
    return q ? threads.find(v => v.designation.toLowerCase() === q) || threads.find(v => v.designation.toLowerCase().includes(q)) : null;
  };
  search.addEventListener("change", () => { const v = find(search.value); if (v) { hover = null; pin(v); } });
  // story buttons: each names a thread by its page title in data-thread
  quick.forEach(b => b.addEventListener("click", () => { const v = byId.get(b.dataset.thread); if (v) { hover = null; pin(v); stage.focus({ preventScroll: true }); } }));

  // lens buttons: one per group, with its size; choosing one re-bakes the threads (about 15 ms)
  function renderLens() {
    lensBox.innerHTML = LENSES.map(l => `<button type="button" data-lens="${l.key}" aria-pressed="${l === lens}">${l.label}<b>${fmtInt(l.count)}</b></button>`).join("");
    lensNote.textContent = lens.key === "all"
      ? "Light up a group: the gates then show how many of that group appear in each era."
      : `${lens.label}: ${fmtInt(lens.count)} of ${fmtInt(model.total)} Tonys (${d3.format(".0%")(lens.count / model.total)}), as their wiki pages state it. Blank fields count as "no".`;
  }
  lensBox.addEventListener("click", e => {
    const b = e.target.closest("button[data-lens]");
    if (!b) return;
    lens = LENSES.find(l => l.key === b.dataset.lens);
    renderLens();
    bake();
  });

  makeSpark();
  renderLens();
  renderLegend();
  renderPanel(null);
  let timer = 0;
  new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(bake, w ? 160 : 0); }).observe(stage);
  new IntersectionObserver(es => { inView = es.some(e => e.isIntersecting); if (inView) wake(); }, { rootMargin: "100px 0px" }).observe(stage);
  document.addEventListener("visibilitychange", wake);
  bake();
  const start = byId.get(stage.dataset.pin);
  if (start) pin(start);
}
