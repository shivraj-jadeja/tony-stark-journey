// Chapter 3 · "Hall of Armor": every MCU suit as a slice of an arc reactor.
// Angle = one equal slice per suit (clockwise by mark), radius = estimated value (log), inner ring = era.
// Hover, focus or arrow keys select a suit; the selection is shared with the timeline (core/selection.js).
import { ERAS } from "../core/data.js";
import { ERA_COLOR, ERA_SHORT, fmtUsd } from "../core/format.js";
import { onSuitSelect, selectSuit } from "../core/selection.js";

const R = { core: 54, eraIn: 64, eraOut: 80, suitIn: 92, suitMax: 268, label: 290 };
const POP = 16;

export function mountArmorReactor({ svg: svgEl, legend: legendEl, panel: panelEl, suits }) {
  const svg = d3.select(svgEl);
  const rv = d3.scaleLog().domain([5e7, 1e10]).range([R.suitIn + 16, R.suitMax]).clamp(true);
  const pie = d3.pie().value(1).sort(null).startAngle(0.16).endAngle(2 * Math.PI - 0.16).padAngle(0.01);
  const arcs = pie(suits);
  const mid = d => (d.startAngle + d.endAngle) / 2;

  const defs = svg.append("defs");
  const cg = defs.append("radialGradient").attr("id", "coreG");
  cg.append("stop").attr("offset", 0).attr("stop-color", "#ffffff");
  cg.append("stop").attr("offset", .45).attr("stop-color", "#5fd8ff");
  cg.append("stop").attr("offset", 1).attr("stop-color", "#5fd8ff").attr("stop-opacity", 0);
  const pat = defs.append("pattern").attr("id", "scrap").attr("width", 4).attr("height", 4)
    .attr("patternUnits", "userSpaceOnUse").attr("patternTransform", "rotate(45)");
  pat.append("rect").attr("width", 4).attr("height", 4).attr("fill", "#6e6a64");
  pat.append("line").attr("y2", 4).attr("stroke", "#e3a83c").attr("stroke-width", 1.5);

  // value rings, labelled in the gap at the top
  const grid = svg.append("g").attr("class", "grid");
  [1e8, 1e9, 1e10].forEach(v => {
    grid.append("circle").attr("r", rv(v));
    grid.append("text").attr("y", -rv(v) + 3).attr("dy", "-.3em").attr("text-anchor", "middle").text(fmtUsd(v));
  });
  grid.append("text").attr("y", -R.suitIn - 4).attr("text-anchor", "middle").text("est. value ↑");

  // era ring
  const eraSpans = ERAS.map(era => {
    const a = arcs.filter(d => d.data.era === era);
    return { era, startAngle: a[0].startAngle, endAngle: a[a.length - 1].endAngle, padAngle: 0.02 };
  });
  svg.append("g").selectAll("path").data(eraSpans).join("path")
    .attr("d", d3.arc().innerRadius(R.eraIn).outerRadius(R.eraOut))
    .attr("fill", d => ERA_COLOR[d.era]).attr("opacity", .55)
    .append("title").text(d => d.era);

  // suit slices
  const sliceArc = d3.arc().innerRadius(R.suitIn).cornerRadius(1.5).outerRadius(d => rv(Math.max(d.data.value, 5e7)));
  const slices = svg.append("g").selectAll("g").data(arcs).join("g")
    .attr("class", "slice").attr("tabindex", 0).attr("role", "button")
    .attr("aria-label", d => `${d.data.model}${d.data.codename ? " " + d.data.codename : ""}, ${fmtUsd(d.data.value)}`)
    .on("mouseenter focus", (e, d) => selectSuit(d.data))
    .on("keydown", (e, d) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      slices.nodes()[(suits.indexOf(d.data) + step + suits.length) % suits.length].focus();
    });
  slices.append("path").attr("d", sliceArc)
    .attr("fill", d => (d.data.value === 0 ? "url(#scrap)" : ERA_COLOR[d.data.era]));

  const marks = svg.append("g").selectAll("text").data(arcs).join("text")
    .attr("class", "mk").attr("text-anchor", "middle").attr("dominant-baseline", "middle")
    .attr("x", d => Math.sin(mid(d)) * R.label).attr("y", d => -Math.cos(mid(d)) * R.label)
    .text(d => d.data.mark);

  const core = svg.append("g");
  core.append("circle").attr("r", R.core).attr("fill", "url(#coreG)").attr("opacity", .85);
  core.append("circle").attr("r", R.core).attr("fill", "none").attr("stroke", "#5fd8ff").attr("stroke-width", 1.5);
  core.append("text").attr("class", "core-n").attr("text-anchor", "middle").attr("y", 8).text(suits.length);
  core.append("text").attr("class", "core-l").attr("text-anchor", "middle").attr("y", 28).text("ARMORS");

  d3.select(legendEl).selectAll("button").data(ERAS).join("button")
    .html(e => `<i style="background:${ERA_COLOR[e]}"></i>${ERA_SHORT[e]} · ${suits.filter(s => s.era === e).length}`)
    .on("mouseenter focus", (ev, e) => slices.classed("dim", d => d.data.era !== e))
    .on("mouseleave blur", () => slices.classed("dim", false));

  onSuitSelect(s => {
    slices.classed("on", d => d.data === s)
      .style("transform", d => (d.data === s ? `translate(${Math.sin(mid(d)) * POP}px, ${-Math.cos(mid(d)) * POP}px)` : null));
    marks.classed("on", d => d.data === s);
    renderPanel(panelEl, s, suits.length);
  });
}

// Placeholder helmet glyph; swap for attributed film stills later.
const PAINT = {
  1: ["#6e6a64", "#8a857c", "#1d1d1d"], 2: ["#c3c9d0", "#c3c9d0"], 9: ["#d9a441", "#d9a441"], 21: ["#d9a441", "#e6bb5c"],
  15: ["#8fa3b5", "#8fa3b5"], 16: ["#1c1f24", "#2a2e35"], 22: ["#2b2b2b", "#9aa0a6"], 33: ["#c3c9d0", "#b3261e"],
  37: ["#1f4a6b", "#d9a441"], 39: ["#e8e8e8", "#2f6fd6"], 41: ["#3a3d42", "#c3c9d0"]
};
function helmet(s) {
  const [shell, face, eye] = PAINT[s.mark] || ["#b3261e", "#d9a441"];
  return `<svg viewBox="0 0 100 120" aria-hidden="true">
    <path d="M50 4C22 4 10 26 10 52L12 84C14 98 26 112 50 116C74 112 86 98 88 84L90 52C90 26 78 4 50 4Z" fill="${shell}"/>
    <path d="M50 22C34 22 26 32 26 46L28 70L36 80L38 100L50 106L62 100L64 80L72 70L74 46C74 32 66 22 50 22Z" fill="${face}"/>
    <path d="M31 50L46 53L45 58L32 56Z M69 50L54 53L55 58L68 56Z" fill="${eye || "#eaf9ff"}"/>
    <path d="M41 92H59" stroke="rgba(0,0,0,.45)" stroke-width="2"/>
  </svg>`;
}

function renderPanel(el, s, total) {
  el.innerHTML = `
    <div class="panel-top">
      <div class="portrait">${helmet(s)}<span>STILL · TBD</span></div>
      <div style="min-width:0">
        <div class="model">${s.model}</div>
        <div class="code">${s.codename ? `"${s.codename}"` : "No codename"}</div>
        <span class="chip" style="background:${ERA_COLOR[s.era]}">${ERA_SHORT[s.era]}</span>
      </div>
    </div>
    <p class="ability">${s.ability}</p>
    <dl>
      <div><dt>Built</dt><dd>${s.dateLabel}</dd></div>
      <div><dt>Est. value</dt><dd>${fmtUsd(s.value)}</dd></div>
      <div><dt>Rank</dt><dd>#${s.rank} / ${total}</dd></div>
    </dl>
    <div class="films">${s.films.map(f => `<span>${f}</span>`).join("")}</div>`;
}
