// Chapter 6 · The snap: hover to blow the remaining Mark 85 armor apart and reveal a F.R.I.D.A.Y. scan.
//
// Why canvas: the first draft drew ~250 SVG <image> clones (one per shard), which made hovering laggy.
// Here each shard is pre-rendered once into a small sprite canvas (in idle time), and an animation
// frame only runs while shards are moving: ~250 drawImage calls on one canvas, then it stops.
//
// Layers inside .snap-stage, bottom to top:
//   canvas.rest    the untouched still
//   canvas.opened  dimmed still with Tony's face kept lit (cross-faded in with CSS)
//   svg.skel       the F.R.I.D.A.Y. skeleton scan (static SVG; CSS animations run only while open)
//   canvas.shards  armor plates, drawn only while open or animating
//   canvas.nerves  six glowing nerves, one per stone and in its colour, from the gauntlet up the arm to the
//                  reactor (small canvas over the arm only; its loop runs only while the scan is open)
//   svg.snap-top   hover targets, the six stones drawn as cut gems, and the label tag
//
// All coordinates are pixels in the 1920×808 still, traced by eye. Stone positions follow the glows on
// the gauntlet; the Time Stone sits on the thumb and is the least certain.
const NS = "http://www.w3.org/2000/svg";
const VB = { x: 640, y: 60, w: 1060, h: 748 };       // visible crop of the still
const CENTER = [1207, 470];                            // explosion center (arc reactor)
const DUR = 800, SPREAD = 0.5, SHRINK = 0.22;

const ARMOR = [
  { d: 120, pts: [[1060,345],[1110,330],[1150,335],[1190,345],[1235,330],[1290,340],[1300,380],[1240,395],[1180,400],[1110,395],[1065,385]] }, // collar
  { d: 150, pts: [[1065,385],[1110,395],[1180,400],[1240,395],[1300,380],[1350,400],[1370,470],[1360,560],[1300,575],[1200,580],[1100,575],[1080,500],[1060,430]] }, // chest plate
  { d: 170, pts: [[1000,360],[1060,345],[1065,385],[1060,430],[1080,500],[1100,575],[1060,600],[1010,590],[990,480]] }, // right upper arm
  { d: 170, pts: [[890,300],[1000,290],[1010,330],[1000,480],[1010,590],[960,612],[900,600],[880,450]] },          // right forearm
  { d: 130, pts: [[885,175],[1000,160],[1030,230],[1010,290],[890,300],[872,250]] },                              // gauntlet hand
  { d: 180, pts: [[1290,340],[1350,350],[1400,390],[1430,440],[1440,520],[1400,560],[1360,560],[1370,470],[1350,400],[1300,380]] }, // left shoulder
  { d: 150, pts: [[1360,560],[1400,560],[1440,520],[1470,640],[1480,808],[1400,808],[1380,700]] },                // left arm
  { d: 160, pts: [[1100,575],[1200,580],[1300,575],[1360,560],[1380,700],[1400,808],[1080,808],[1060,700],[1060,600]] } // abdomen
];
const FACE = [[1118,160],[1180,140],[1245,160],[1262,240],[1245,322],[1200,336],[1152,330],[1124,296],[1108,222]];
const STONES = [
  { n: "Power", c: "#d36cff", x: 903, y: 236, d: "the Orb, from Morag" },
  { n: "Space", c: "#3fa9ff", x: 940, y: 248, d: "the Tesseract" },
  { n: "Reality", c: "#ff3d4f", x: 961, y: 247, d: "the Aether" },
  { n: "Soul", c: "#ff9a2e", x: 979, y: 253, d: "traded for on Vormir" },
  { n: "Mind", c: "#ffd23f", x: 955, y: 312, d: "from Loki's scepter" },
  { n: "Time", c: "#7be36b", x: 902, y: 285, d: "the Eye of Agamotto" }
];
const REACTOR = { n: "Arc reactor", c: "#5fd8ff", x: 1207, y: 452, d: "powers the suit and stores its nanites" };
// The arm the nerves follow, traced on the still: wrist, forearm, elbow, upper arm, shoulder, chest, reactor.
const ARM = [[948, 330], [960, 450], [985, 592], [1022, 480], [1062, 372], [1128, 408], [REACTOR.x, REACTOR.y]];
const SHOULDER = 4;                                    // index in ARM: the nerves start to fade from here
const NERVE = { box: [850, 150, 420, 500], spread: 4.2, wave: 5, grow: 900, fadeTo: 0.03, pulses: 3, speed: 0.00042 };

const easeOut = t => 1 - (1 - t) ** 3;
const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);

export async function mountSnapExplode({ stage, keys, src }) {
  const img = new Image();
  img.src = src;
  await img.decode();

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvasLayer = cls => { const c = document.createElement("canvas"); c.className = cls; stage.appendChild(c); return c; };
  const svgLayer = cls => {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", `${VB.x} ${VB.y} ${VB.w} ${VB.h}`);
    s.setAttribute("class", cls);
    s.setAttribute("aria-hidden", "true");
    stage.appendChild(s);
    return d3.select(s);
  };
  const restC = canvasLayer("rest"), openC = canvasLayer("opened");
  const skel = svgLayer("skel");
  const shardC = canvasLayer("shards");
  const nerveC = canvasLayer("nerves");
  const [nbx, nby, nbw, nbh] = NERVE.box;              // the nerve canvas only covers the arm
  Object.assign(nerveC.style, { left: `${(nbx - VB.x) / VB.w * 100}%`, top: `${(nby - VB.y) / VB.h * 100}%`,
    width: `${nbw / VB.w * 100}%`, height: `${nbh / VB.h * 100}%` });
  const top = svgLayer("snap-top");
  drawSkeleton(skel);

  // ---- nerves: one per stone, drawn with d3.line on the small canvas ----
  // Each nerve leaves its stone, joins the arm at the wrist a little to one side of its neighbours, wavers a
  // few pixels like a vein, and closes in on the reactor. Points are fixed (seeded), so nothing is computed per frame.
  const smooth = pts => {                                // Chaikin corner cutting, twice: rounds the elbow and shoulder
    for (let r = 0; r < 2; r++) {
      const out = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx2, by2] = pts[i + 1];
        out.push([ax * 0.75 + bx2 * 0.25, ay * 0.75 + by2 * 0.25], [ax * 0.25 + bx2 * 0.75, ay * 0.25 + by2 * 0.75]);
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    return pts;
  };
  const nrand = seeded(6);
  const armLen = d3.sum(d3.pairs(ARM), ([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]));
  const toShoulder = d3.sum(d3.pairs(ARM.slice(0, SHOULDER + 1)), ([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]));
  const nerves = STONES.map((s, i) => {
    const side = (i - (STONES.length - 1) / 2) * NERVE.spread, ph = nrand() * 6.28, ph2 = nrand() * 6.28;
    const ctrl = smooth([[s.x, s.y], [(s.x + ARM[0][0]) / 2 + side, (s.y + ARM[0][1]) / 2], ...ARM]);
    const pts = [];                                      // resample every ~7 px, then push sideways
    let run = 0;
    for (let j = 0; j < ctrl.length - 1; j++) {
      const [ax, ay] = ctrl[j], [bx2, by2] = ctrl[j + 1], L = Math.hypot(bx2 - ax, by2 - ay), n = Math.max(1, Math.round(L / 7));
      for (let q = 0; q < n; q++) {
        const f = q / n, d = run + L * f, end = Math.min(1, d / 60, (armLen + 60 - d) / 90);   // no offset at the stone or the reactor
        const off = (side + NERVE.wave * (Math.sin(d * 0.045 + ph) + 0.6 * Math.sin(d * 0.11 + ph2))) * Math.max(0, end);
        pts.push([ax + (bx2 - ax) * f - (by2 - ay) / L * off, ay + (by2 - ay) * f + (bx2 - ax) / L * off, d]);
      }
      run += L;
    }
    pts.push([REACTOR.x, REACTOR.y, run]);
    const fadeFrom = toShoulder + 40;                    // light of each point: full to the shoulder, then down to the reactor
    pts.forEach(p => { p[3] = p[2] <= fadeFrom ? 1 : Math.max(NERVE.fadeTo, 1 - (1 - NERVE.fadeTo) * (p[2] - fadeFrom) / (run - fadeFrom)); });
    const dot = document.createElement("canvas"), dg = dot.getContext("2d");
    dot.width = dot.height = 32;
    const grad = dg.createRadialGradient(16, 16, 0, 16, 16, 16), c = d3.rgb(s.c);
    grad.addColorStop(0, "rgba(255,255,255,.95)"); grad.addColorStop(0.3, `rgba(${c.r},${c.g},${c.b},.8)`); grad.addColorStop(1, `rgba(${c.r},${c.g},${c.b},0)`);
    dg.fillStyle = grad; dg.fillRect(0, 0, 32, 32);
    return { stone: s, pts, len: run, dot, phase: nrand() };
  });
  const nerveLine = d3.line().x(p => p[0]).y(p => p[1]);
  let nk = 1, nerveOn = false, nerveRaf = 0, nerveT0 = 0, nerveOff = 0, focusStone = null;
  function sizeNerves() {
    const r = stage.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 1.5);
    nk = r.width * dpr / VB.w;
    nerveC.width = Math.max(1, Math.round(nbw * nk)); nerveC.height = Math.max(1, Math.round(nbh * nk));
  }
  // One frame: every nerve in a few short pieces (so its light can fall off along the way), as three strokes each
  // (wide and faint, medium, thin and white-hot: a glow without shadowBlur), then the pulses travelling to the reactor.
  function drawNerves(now) {
    const ctx = nerveC.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, nerveC.width, nerveC.height);
    const grown = reduced ? 1 : clamp01((now - nerveT0) / NERVE.grow);
    const out = nerveOn ? 1 : 1 - clamp01((now - nerveOff) / 260);
    if (out <= 0) return false;
    ctx.setTransform(nk, 0, 0, nk, -nbx * nk, -nby * nk);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    nerveLine.context(ctx);
    const piece = 6;
    for (const nv of nerves) {
      const dim = focusStone && focusStone !== nv.stone ? 0.22 : 1;
      const flick = reduced ? 1 : 0.82 + 0.18 * Math.sin(now * 0.006 + nv.phase * 20);
      const upTo = Math.floor((nv.pts.length - 1) * easeOut(grown));
      for (let j = 0; j < upTo; j += piece) {
        const seg = nv.pts.slice(j, Math.min(upTo, j + piece) + 1), a = seg[0][3] * dim * flick * out;
        for (const [width, alpha, color] of [[9, 0.1, nv.stone.c], [4, 0.34, nv.stone.c], [1.4, 0.9, "#ffffff"]]) {
          ctx.beginPath(); nerveLine(seg);
          ctx.lineWidth = width; ctx.globalAlpha = alpha * a; ctx.strokeStyle = color; ctx.stroke();
        }
      }
      if (!reduced && grown >= 1) for (let q = 0; q < NERVE.pulses; q++) {
        const f = (now * NERVE.speed + nv.phase + q / NERVE.pulses) % 1, p = nv.pts[Math.floor(f * (nv.pts.length - 1))];
        ctx.globalAlpha = p[3] * dim * out;
        ctx.drawImage(nv.dot, p[0] - 7, p[1] - 7, 14, 14);
      }
    }
    ctx.globalAlpha = 1;
    return true;
  }
  function nerveLoop(now) {
    nerveRaf = 0;
    if (drawNerves(now) && !reduced && !document.hidden) nerveRaf = requestAnimationFrame(nerveLoop);
  }
  const wakeNerves = () => { if (!nerveRaf) nerveRaf = requestAnimationFrame(nerveLoop); };

  // ---- shards: Voronoi cells inside each armor section (seeded, so the pattern is stable) ----
  const rand = seeded(85);
  const shards = [];
  ARMOR.forEach(part => {
    const cen = d3.polygonCentroid(part.pts);
    const vx = cen[0] - CENTER[0], vy = cen[1] - CENTER[1], L = Math.hypot(vx, vy) || 1;
    const xs = part.pts.map(p => p[0]), ys = part.pts.map(p => p[1]);
    const b = [d3.min(xs), d3.min(ys), d3.max(xs), d3.max(ys)];
    const n = Math.max(8, Math.min(42, Math.round(Math.abs(d3.polygonArea(part.pts)) / 750)));
    const seeds = [];
    for (let t = 0; seeds.length < n && t < 6000; t++) {
      const q = [b[0] + rand() * (b[2] - b[0]), b[1] + rand() * (b[3] - b[1])];
      if (d3.polygonContains(part.pts, q)) seeds.push(q);
    }
    const vor = d3.Delaunay.from(seeds).voronoi(b);
    seeds.forEach((_, i) => {
      const cell = vor.cellPolygon(i);
      if (!cell) return;
      const c = d3.polygonCentroid(cell);
      const cx = cell.map(p => p[0]), cy = cell.map(p => p[1]);
      shards.push({
        part, cell, c,
        box: [d3.min(cx), d3.min(cy), d3.max(cx) - d3.min(cx), d3.max(cy) - d3.min(cy)],
        dx: vx / L * part.d + (c[0] - cen[0]) * SPREAD,
        dy: vy / L * part.d + (c[1] - cen[1]) * SPREAD,
        rot: (rand() - 0.5) * 12 * Math.PI / 180,
        delay: L * 0.6 + rand() * 180,
        edge: new Path2D(`M${cell.join("L")}Z`),
        from: 0, cur: 0
      });
    });
  });

  // ---- sizing: canvases match the stage in device pixels (capped at 2x) ----
  let k = 1, W = 0, H = 0, sprites = null, spriteJob = 0;
  const base = ctx => ctx.setTransform(k, 0, 0, k, -VB.x * k, -VB.y * k);
  function resize() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
    k = W / VB.w;
    [restC, openC, shardC].forEach(c => { c.width = W; c.height = H; });
    const rc = restC.getContext("2d");
    base(rc); rc.drawImage(img, 0, 0);
    drawOpened(openC.getContext("2d"));
    sprites = null;
    buildSprites(++spriteJob);
    if (open || animating) drawShards();
    sizeNerves();
    if (open) wakeNerves();
  }
  function drawOpened(ctx) {
    base(ctx);
    ctx.filter = "grayscale(0.8) brightness(0.45)";
    ctx.drawImage(img, 0, 0);
    ctx.filter = "none";
    // soft-edged face cut-out so Tony stays visible while the armor is open
    const m = document.createElement("canvas");
    m.width = W; m.height = H;
    const mc = m.getContext("2d");
    base(mc);
    mc.filter = `blur(${16 * k}px)`;
    mc.fill(new Path2D(`M${FACE.join("L")}Z`));
    mc.filter = "none";
    mc.globalCompositeOperation = "source-in";
    mc.drawImage(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(m, 0, 0);
  }
  // Pre-render each shard into its own small canvas, a slice at a time during idle periods.
  function buildSprites(job, all = false) {
    const out = sprites || (sprites = []);
    const step = deadline => {
      if (job !== spriteJob) return;
      while (out.length < shards.length && (all || !deadline || deadline.timeRemaining() > 2)) {
        const s = shards[out.length];
        const [bx, by, bw, bh] = s.box;
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.ceil(bw * k)); c.height = Math.max(1, Math.ceil(bh * k));
        const ctx = c.getContext("2d");
        ctx.setTransform(k, 0, 0, k, -bx * k, -by * k);
        ctx.clip(new Path2D(`M${s.part.pts.join("L")}Z`));
        ctx.clip(s.edge);
        ctx.drawImage(img, 0, 0);
        out.push(c);
      }
      if (out.length < shards.length && !all) schedule(step);
    };
    all ? step() : schedule(step);
  }
  const schedule = fn => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(() => fn(null), 16));

  // ---- animation: runs only while shards are moving ----
  let open = false, animating = false, t0 = 0;
  function drawShards() {
    const ctx = shardC.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!sprites || sprites.length < shards.length) buildSprites(spriteJob, true);
    ctx.strokeStyle = "#5fd8ff";
    for (let i = 0; i < shards.length; i++) {
      const s = shards[i], e = s.cur;
      if (e <= 0 && !open) continue;
      const sc = 1 - SHRINK * e;
      base(ctx);
      ctx.translate(s.c[0] + s.dx * e, s.c[1] + s.dy * e);
      ctx.rotate(s.rot * e);
      ctx.scale(sc, sc);
      ctx.translate(-s.c[0], -s.c[1]);
      ctx.globalAlpha = 1 - 0.5 * e;
      ctx.drawImage(sprites[i], s.box[0], s.box[1], s.box[2], s.box[3]);
      if (e > 0.02) {
        ctx.globalAlpha = 0.55 * e;
        ctx.lineWidth = 1 / (k * sc);
        ctx.stroke(s.edge);
      }
    }
    ctx.globalAlpha = 1;
  }
  function tick(now) {
    const t = now - t0;
    let moving = false;
    for (const s of shards) {
      const target = open ? 1 : 0;
      const delay = open && !reduced ? s.delay : 0;
      const p = reduced ? 1 : clamp01((t - delay) / DUR);
      s.cur = s.from + (target - s.from) * easeOut(p);
      if (p < 1) moving = true;
    }
    drawShards();
    if (moving) requestAnimationFrame(tick);
    else {
      animating = false;
      if (!open) shardC.getContext("2d").clearRect(0, 0, W, H);
    }
  }
  function setOpen(on) {
    if (on === open) return;
    open = on;
    stage.classList.toggle("open", on);
    shards.forEach(s => (s.from = s.cur));
    t0 = performance.now();
    nerveOn = on;
    if (on) nerveT0 = t0; else nerveOff = t0;
    wakeNerves();
    focusPart(null);
    if (!animating) { animating = true; requestAnimationFrame(tick); }
  }

  // ---- hover targets: stones and reactor are the only labelled parts ----
  const tag = top.append("g").attr("class", "tag");
  const tagRect = tag.append("rect").attr("rx", 2).attr("height", 60);
  const tagT = tag.append("text").attr("class", "t").attr("x", 14).attr("y", 26);
  const tagS = tag.append("text").attr("class", "s").attr("x", 14).attr("y", 46);
  const tagLine = top.append("line").attr("stroke", "#5fd8ff").attr("stroke-width", 1.2).attr("opacity", 0);
  const reactorRing = top.append("circle").attr("cx", REACTOR.x).attr("cy", REACTOR.y).attr("r", 40)
    .attr("fill", "none").attr("stroke", REACTOR.c).attr("stroke-width", 2).attr("opacity", 0);
  const hand = [945, 270];
  STONES.forEach(s => {
    const vx = s.x - hand[0], vy = s.y - hand[1], L = Math.hypot(vx, vy) || 1;
    s.px = vx / L * 46; s.py = vy / L * 46 - 10;
  });
  // Each stone is drawn as a cut gem in its own colour (no photo crop: the still's glare blew those out to white).
  // An oval of GEM.sides facets round a flat table; each facet is shaded by how much it faces the light.
  const GEM = { sides: 10, rx: 8.5, ry: 10.5, table: 0.52, light: -2.2 };
  const ring = k => d3.range(GEM.sides).map(i => { const a = (i + 0.5) / GEM.sides * 2 * Math.PI; return [Math.cos(a) * GEM.rx * k, Math.sin(a) * GEM.ry * k]; });
  const outer = ring(1), inner = ring(GEM.table);
  const defs = top.append("defs");
  STONES.forEach((s, i) => {
    const glow = defs.append("radialGradient").attr("id", `gemGlow${i}`);
    glow.append("stop").attr("offset", 0).attr("stop-color", s.c).attr("stop-opacity", 0.75);
    glow.append("stop").attr("offset", 0.45).attr("stop-color", s.c).attr("stop-opacity", 0.28);
    glow.append("stop").attr("offset", 1).attr("stop-color", s.c).attr("stop-opacity", 0);
    const tbl = defs.append("radialGradient").attr("id", `gemTable${i}`).attr("cx", 0.36).attr("cy", 0.3).attr("r", 0.8);
    tbl.append("stop").attr("offset", 0).attr("stop-color", "#fff");
    tbl.append("stop").attr("offset", 0.35).attr("stop-color", d3.color(s.c).brighter(0.9));
    tbl.append("stop").attr("offset", 1).attr("stop-color", d3.color(s.c).darker(0.5));
  });
  const stoneG = top.append("g").selectAll("g").data(STONES).join("g").attr("transform", d => `translate(${d.x},${d.y})`);
  const stoneIn = stoneG.append("g").attr("class", "gem").attr("transform", "translate(0,0) scale(1)").attr("opacity", 0);
  stoneIn.each(function (d, si) {
    const g = d3.select(this), base = d3.color(d.c);
    g.append("circle").attr("r", 21).attr("fill", `url(#gemGlow${si})`);
    g.append("polygon").attr("points", outer.join(" ")).attr("fill", base.darker(1.6));
    for (let i = 0; i < GEM.sides; i++) {
      const j = (i + 1) % GEM.sides, mid = Math.atan2(outer[i][1] + outer[j][1], outer[i][0] + outer[j][0]);
      const lit = Math.cos(mid - GEM.light);             // 1 = facing the light, -1 = facing away
      g.append("polygon").attr("points", [outer[i], outer[j], inner[j], inner[i]].join(" "))
        .attr("fill", lit > 0 ? base.brighter(lit * 1.5) : base.darker(-lit * 1.7)).attr("stroke", base.brighter(1.8)).attr("stroke-width", 0.18).attr("stroke-opacity", 0.55);
    }
    g.append("polygon").attr("points", inner.join(" ")).attr("fill", `url(#gemTable${si})`).attr("stroke", "#fff").attr("stroke-width", 0.22).attr("stroke-opacity", 0.6);
    g.append("ellipse").attr("cx", -2.6).attr("cy", -4.4).attr("rx", 2.1).attr("ry", 1.1).attr("transform", "rotate(-32 -2.6 -4.4)").attr("fill", "#fff").attr("opacity", 0.85);
    g.append("circle").attr("cx", 3.4).attr("cy", 5.6).attr("r", 0.7).attr("fill", "#fff").attr("opacity", 0.6);
  });
  const hot = (sel, d) => sel.attr("class", "hot")
    .on("pointerenter", () => focusPart(d)).on("pointerleave", () => focusPart(null))
    .on("click", e => { e.stopPropagation(); setOpen(true); focusPart(d); });
  stoneG.each(function (d) { hot(d3.select(this).append("circle").attr("r", 13), d); });
  hot(top.append("circle").attr("cx", REACTOR.x).attr("cy", REACTOR.y).attr("r", 40), REACTOR);

  function focusPart(p) {
    const isStone = p && p !== REACTOR;
    focusStone = isStone ? p : null;                     // its nerve stays bright, the other five dim
    if (open && reduced) wakeNerves();
    // while the scan is open every gem sits in its socket; the one in focus lifts out and grows
    stoneIn.interrupt().transition().duration(reduced ? 0 : 300).ease(d3.easeBackOut)
      .attr("opacity", d => (d === p || open ? 1 : 0))
      .attr("transform", d => (d === p ? `translate(${d.px},${d.py}) scale(3)` : "translate(0,0) scale(1)"));
    reactorRing.attr("opacity", p === REACTOR ? 1 : 0);
    if (!p) { tag.classed("on", false); tagLine.attr("opacity", 0); return; }
    tagT.text(isStone ? `${p.n} Stone` : p.n).attr("fill", p.c);
    tagS.text(p.d);
    const w = Math.max(tagT.node().getComputedTextLength(), tagS.node().getComputedTextLength()) + 28;
    tagRect.attr("width", w);
    const ax = isStone ? p.x + p.px : p.x, ay = isStone ? p.y + p.py : p.y;
    const tx = isStone ? VB.x + 20 : p.x + 90, ty = ay - 30;
    tag.attr("transform", `translate(${tx},${ty})`).classed("on", true).raise();
    tagLine.attr("x1", isStone ? tx + w : tx).attr("y1", ty + 30).attr("x2", isStone ? ax - 32 : ax + 42).attr("y2", ay).attr("opacity", .8).raise();
  }

  // ---- input: mouse hover, keyboard focus, tap to toggle ----
  stage.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") setOpen(true); });
  stage.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") setOpen(false); });
  let lastPointer = "mouse";
  stage.addEventListener("pointerdown", e => { lastPointer = e.pointerType; });
  stage.addEventListener("click", () => { if (lastPointer !== "mouse") setOpen(!open); });
  stage.addEventListener("focus", () => setOpen(true));
  stage.addEventListener("blur", () => setOpen(false));
  d3.select(keys).selectAll("button").data([...STONES, REACTOR]).join("button")
    .html(d => `<i style="background:${d.c}"></i>${d === REACTOR ? "Reactor" : d.n}`)
    .on("mouseenter focus click", (e, d) => { setOpen(true); focusPart(d); })
    .on("mouseleave blur", () => setOpen(false));

  let rt;
  new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(resize, 120); }).observe(stage);
  resize();
}

// F.R.I.D.A.Y. scan: what sits under the plates. Static SVG in still-image coordinates.
function drawSkeleton(sk) {
  const defs = sk.append("defs");
  const hex = defs.append("pattern").attr("id", "hexMesh").attr("width", 30).attr("height", 52).attr("patternUnits", "userSpaceOnUse");
  hex.append("path").attr("d", "M15 0L30 8.66V25.98L15 34.64L0 25.98V8.66ZM15 34.64V52").attr("fill", "none").attr("stroke", "#5fd8ff").attr("stroke-width", .7);
  const torso = defs.append("clipPath").attr("id", "torsoClip");
  [0, 1, 2, 5, 6, 7].forEach(i => torso.append("polygon").attr("points", ARMOR[i].pts.join(" ")));
  sk.append("rect").attr("class", "mesh").attr("x", 980).attr("y", 320).attr("width", 520).attr("height", 500)
    .attr("fill", "url(#hexMesh)").attr("clip-path", "url(#torsoClip)").attr("opacity", .3);

  // spine and ribs
  sk.append("line").attr("class", "dim").attr("x1", 1200).attr("y1", 345).attr("x2", 1214).attr("y2", 808);
  d3.range(372, 800, 24).forEach(y => {
    const x = 1200 + (y - 345) * 14 / 463;
    sk.append("line").attr("x1", x - 11).attr("x2", x + 11).attr("y1", y).attr("y2", y);
  });
  d3.range(6).forEach(i => {
    const y = 398 + i * 30, x = 1202 + i * 1.2;
    sk.append("path").attr("class", "dim").attr("d", `M${x},${y} Q${x - 80},${y - 14} ${1082 + i * 7},${y + 36}`);
    sk.append("path").attr("class", "dim").attr("d", `M${x},${y} Q${x + 80},${y - 14} ${1338 - i * 7},${y + 36}`);
  });
  sk.append("path").attr("d", "M1200,368 Q1130,350 1062,372 M1200,368 Q1270,350 1330,380");

  // arms: shoulder, elbow, wrist, hand bones up to the stone sockets
  sk.append("line").attr("x1", 1062).attr("y1", 372).attr("x2", 985).attr("y2", 592);
  sk.append("line").attr("x1", 979).attr("y1", 590).attr("x2", 942).attr("y2", 332);
  sk.append("line").attr("x1", 991).attr("y1", 590).attr("x2", 954).attr("y2", 332);
  const knuckles = [[903,236],[940,248],[961,247],[979,253]], tips = [[912,180],[940,168],[968,174],[994,196]];
  knuckles.forEach((kn, i) => sk.append("path").attr("d", `M948,330L${kn}L${tips[i]}`));
  sk.append("path").attr("d", "M948,330L908,300L896,262");
  sk.append("line").attr("x1", 1330).attr("y1", 380).attr("x2", 1420).attr("y2", 600);
  sk.append("line").attr("x1", 1420).attr("y1", 600).attr("x2", 1452).attr("y2", 808);
  [[1062,372],[1330,380],[985,592],[948,330],[1420,600]].forEach(([x, y]) => {
    sk.append("circle").attr("class", "dim").attr("cx", x).attr("cy", y).attr("r", 17);
    sk.append("circle").attr("class", "node").attr("cx", x).attr("cy", y).attr("r", 7);
  });

  // power conduits out of the reactor
  ["M1207,452L1120,410L1062,372L985,592L948,330L950,262", "M1207,452L1290,410L1330,380L1420,600L1452,808",
   "M1207,452L1182,560L1162,808", "M1207,452L1236,560L1258,808"]
    .forEach(d => sk.append("path").attr("class", "flow").attr("d", d));
  STONES.forEach(s => sk.append("circle").attr("cx", s.x).attr("cy", s.y).attr("r", 13).style("stroke", s.c));

  // reactor core
  sk.append("circle").attr("class", "spin").attr("cx", REACTOR.x).attr("cy", REACTOR.y).attr("r", 46).attr("stroke-dasharray", "3 5");
  sk.append("circle").attr("class", "spin rev").attr("cx", REACTOR.x).attr("cy", REACTOR.y).attr("r", 66).attr("stroke-dasharray", "22 9");
  sk.append("polygon").attr("points", `${REACTOR.x - 21},${REACTOR.y - 13} ${REACTOR.x + 21},${REACTOR.y - 13} ${REACTOR.x},${REACTOR.y + 24}`);

  // scan line, frame corners and readouts
  sk.append("line").attr("class", "scan").attr("x1", 1050).attr("x2", 1390).attr("y1", 340).attr("y2", 340);
  [[1040,325,1,1],[1395,325,-1,1],[1040,800,1,-1],[1395,800,-1,-1]].forEach(([x, y, sx, sy]) =>
    sk.append("path").attr("d", `M${x},${y + sy * 26}V${y}H${x + sx * 26}`).attr("stroke-width", 2));
  [["F.R.I.D.A.Y. · BIOSCAN", ""], ["MARK 85 · NANOTECH ARMOR", ""], ["ARMOR INTEGRITY · CRITICAL", "warn"],
   ["GAUNTLET LOAD · 6 / 6 STONES", ""], ["POWER ROUTING · RIGHT ARM", ""]]
    .forEach(([t, c], i) => sk.append("text").attr("class", c).attr("x", 1440).attr("y", 150 + i * 24).text(t));
}

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
