// Scroll-driven background reactor and HUD.
// Performance: the only per-frame work is writing one CSS variable (--p). Coil lighting, ring rotation,
// core size and the HUD bar are all CSS calc() off --p, so the browser composites them without layout.
// --p is written on the reactor and the HUD only, never on :root: a custom property on :root is
// inherited by every element, so changing it there restyles the whole page on every scroll frame.
// Chapter labels come from an IntersectionObserver instead of measuring sections on every scroll.
const NS = "http://www.w3.org/2000/svg";
const COILS = 12;
const DOOM_FROM = 0.8, DOOM_TO = 0.9;

export function initScrollReactor() {
  const root = document.documentElement;
  const pTargets = [document.getElementById("reactor-bg"), document.querySelector(".hud")].filter(Boolean);
  const coils = document.getElementById("rbCoils");
  const ticks = document.getElementById("rbTicks");
  const pct = document.getElementById("hudPct");
  const year = document.getElementById("hudYear");
  const label = document.getElementById("hudLabel");

  // static geometry, built once
  const arc = d3.arc().innerRadius(138).outerRadius(170).cornerRadius(2);
  for (let i = 0; i < COILS; i++) {
    const a0 = (i / COILS) * 2 * Math.PI + 0.06, a1 = ((i + 1) / COILS) * 2 * Math.PI - 0.06;
    for (const cls of ["coil-bed", "coil"]) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", arc({ startAngle: a0, endAngle: a1 }));
      p.setAttribute("class", cls);
      p.style.setProperty("--i", i);
      coils.appendChild(p);
    }
  }
  for (let i = 0; i < 72; i++) {
    const l = document.createElementNS(NS, "line");
    l.setAttribute("y1", -120);
    l.setAttribute("y2", i % 6 ? -127 : -134);
    l.setAttribute("transform", `rotate(${i * 5})`);
    l.setAttribute("class", "stroke");
    l.setAttribute("stroke-width", 1.4);
    ticks.appendChild(l);
  }

  // per-frame: one CSS variable, plus text/color only when they actually change
  const toDoom = d3.interpolateRgb("#5fd8ff", "#3f8a4e");
  let lastP = -1, lastPct = -1, lastMix = -1, queued = false;
  const frame = () => {
    queued = false;
    const max = root.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
    if (Math.abs(p - lastP) < 0.0005) return;
    lastP = p;
    const pv = p.toFixed(4);
    for (const el of pTargets) el.style.setProperty("--p", pv);
    const n = Math.round(p * 100);
    if (n !== lastPct) { lastPct = n; pct.textContent = String(n).padStart(3, "0") + "%"; }
    const mix = Math.min(1, Math.max(0, (p - DOOM_FROM) / (DOOM_TO - DOOM_FROM)));
    if (Math.abs(mix - lastMix) > 0.01 || (mix !== lastMix && (mix === 0 || mix === 1))) {
      lastMix = mix;
      root.style.setProperty("--live", toDoom(mix));
    }
  };
  const request = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };
  addEventListener("scroll", request, { passive: true });
  addEventListener("resize", request, { passive: true });
  frame();

  // HUD chapter: the last section whose top has crossed the middle of the screen
  const chapters = [...document.querySelectorAll("main [data-year]")];
  const visible = new Set();
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target)));
    const cur = chapters.filter(c => visible.has(c)).pop() || chapters[0];
    year.textContent = cur.dataset.year;
    label.textContent = cur.dataset.label;
  }, { rootMargin: "0px 0px -50% 0px" });
  chapters.forEach(c => io.observe(c));
}
