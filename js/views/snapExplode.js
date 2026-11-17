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
//   svg.snap-top   hover targets, popped stones and the label tag
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
  const top = svgLayer("snap-top");
  drawSkeleton(skel);

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
    if (!on) focusPart(null);
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
  const defs = top.append("defs");
  defs.append("clipPath").attr("id", "snapStoneClip").append("circle").attr("r", 10);
  const stoneG = top.append("g").selectAll("g").data(STONES).join("g").attr("transform", d => `translate(${d.x},${d.y})`);
  const stoneIn = stoneG.append("g").attr("transform", "translate(0,0) scale(1)").attr("opacity", 0);
  stoneIn.append("image").attr("href", src).attr("width", 1920).attr("height", 808)
    .attr("x", d => -d.x).attr("y", d => -d.y).attr("clip-path", "url(#snapStoneClip)");
  stoneIn.append("circle").attr("r", 10).attr("fill", "none").attr("stroke", d => d.c);
  const hot = (sel, d) => sel.attr("class", "hot")
    .on("pointerenter", () => focusPart(d)).on("pointerleave", () => focusPart(null))
    .on("click", e => { e.stopPropagation(); setOpen(true); focusPart(d); });
  stoneG.each(function (d) { hot(d3.select(this).append("circle").attr("r", 13), d); });
  hot(top.append("circle").attr("cx", REACTOR.x).attr("cy", REACTOR.y).attr("r", 40), REACTOR);

  function focusPart(p) {
    const isStone = p && p !== REACTOR;
    stoneIn.interrupt().transition().duration(reduced ? 0 : 300).ease(d3.easeBackOut)
      .attr("opacity", d => (d === p ? 1 : 0))
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
