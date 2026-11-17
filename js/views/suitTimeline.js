// Chapter 4 · "35 armors in eight months": suits by in-universe build date (x) and estimated value (y, log),
// with a piecewise x scale that zooms into May–Dec 2012, plus a worldwide box-office strip for Tony's films.
// Hovering a dot selects that suit everywhere (core/selection.js); hovering a film highlights its suits.
import { ERA_COLOR, fmtUsd } from "../core/format.js";
import { onSuitSelect, selectSuit } from "../core/selection.js";

const W = 980, M = { l: 70, r: 24 }, PLOT_TOP = 40, PLOT_BOT = 330, FILM_BASE = 520;
const BAND = [new Date(2012, 4, 1), new Date(2012, 11, 28)];

export function mountSuitTimeline({ svg: svgEl, box, tip: tipEl, suits, films }) {
  const svg = d3.select(svgEl);
  const x = d3.scaleTime()
    .domain([new Date(2007, 6, 1), new Date(2012, 3, 10), new Date(2013, 0, 20), new Date(2024, 3, 1)])
    .range([M.l, 330, 600, W - M.r]);
  const y = d3.scaleLog().domain([5e7, 1.4e10]).range([PLOT_BOT, PLOT_TOP]).clamp(true);

  // zoom band
  svg.append("rect").attr("class", "band").attr("x", x(BAND[0])).attr("width", x(BAND[1]) - x(BAND[0]))
    .attr("y", PLOT_TOP - 20).attr("height", PLOT_BOT - PLOT_TOP + 20);
  BAND.forEach(d => svg.append("line").attr("class", "band-edge")
    .attr("x1", x(d)).attr("x2", x(d)).attr("y1", PLOT_TOP - 20).attr("y2", FILM_BASE));
  svg.append("text").attr("class", "ttl").attr("x", (x(BAND[0]) + x(BAND[1])) / 2).attr("y", PLOT_TOP - 26)
    .attr("text-anchor", "middle").text("Zoomed: May–Dec 2012");

  // axes
  const yTicks = [1e8, 3e8, 1e9, 3e9, 1e10];
  yTicks.forEach(v => svg.append("line").attr("class", "gridl").attr("x1", M.l).attr("x2", W - M.r).attr("y1", y(v)).attr("y2", y(v)));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${M.l},0)`)
    .call(d3.axisLeft(y).tickValues(yTicks).tickFormat(fmtUsd).tickSize(4));
  svg.append("text").attr("class", "ttl").attr("x", 8).attr("y", PLOT_TOP - 26).text("Est. suit value (log)");
  const xTicks = [2008, 2009, 2010, 2011].map(yy => new Date(yy, 0, 1))
    .concat([new Date(2012, 4, 1), new Date(2012, 7, 1), new Date(2012, 10, 1)])
    .concat(d3.range(2014, 2025).map(yy => new Date(yy, 0, 1)));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${PLOT_BOT + 12})`)
    .call(d3.axisBottom(x).tickValues(xTicks).tickSize(4)
      .tickFormat(d => (d.getFullYear() === 2012 ? d3.timeFormat("%b '12")(d) : d.getFullYear())));

  // beeswarm, solved once up front (no live simulation)
  const nodes = suits.map(s => {
    const ty = y(Math.max(s.value, 5e7));
    return { s, tx: x(s.mid), ty, x: x(s.mid), y: ty };
  });
  const sim = d3.forceSimulation(nodes)
    .force("x", d3.forceX(d => d.tx).strength(d => (d.s.interval ? 0.02 : 0.8)))
    .force("y", d3.forceY(d => d.ty).strength(0.6))
    .force("c", d3.forceCollide(7.2)).stop();
  const lo = x(BAND[0]) + 8, hi = x(BAND[1]) - 8;
  for (let i = 0; i < 320; i++) {
    sim.tick();
    nodes.forEach(n => { if (n.s.interval) n.x = Math.max(lo, Math.min(hi, n.x)); });
  }

  const tip = d3.select(tipEl);
  const showTip = (e, html) => {
    const r = box.getBoundingClientRect();
    tip.html(html).style("opacity", 1);
    const tw = tipEl.offsetWidth;
    let left = e.clientX - r.left + box.scrollLeft + 14;
    if (left + tw > box.scrollLeft + r.width) left -= tw + 28;
    tip.style("left", `${left}px`).style("top", `${e.clientY - r.top + 14}px`);
  };
  const hideTip = () => tip.style("opacity", 0);

  const dots = svg.append("g").selectAll("circle").data(nodes).join("circle")
    .attr("class", "dot").attr("cx", d => d.x).attr("cy", d => d.y).attr("r", 6)
    .attr("fill", d => (d.s.value === 0 ? "#6e6a64" : ERA_COLOR[d.s.era]))
    .on("mouseenter", (e, d) => selectSuit(d.s))
    .on("mousemove", (e, d) => showTip(e, `<b>${d.s.model}</b>${d.s.codename ? ` · ${d.s.codename}` : ""}<br>${d.s.ability}<div class="m">${d.s.dateLabel} · ${fmtUsd(d.s.value)}</div>`))
    .on("mouseleave", hideTip);

  // annotations
  const nodeOf = mark => nodes.find(n => n.s.mark === mark);
  const annotate = (n, dx, dy, title, line, anchor = "start") => {
    if (!n) return;
    const tx = n.x + dx, ty = n.y + dy;
    svg.append("path").attr("class", "ann-line").attr("d", `M${n.x + Math.sign(dx) * 7},${n.y}L${tx - Math.sign(dx) * 4},${ty}`);
    svg.append("text").attr("class", "ann-b").attr("x", tx).attr("y", ty).attr("text-anchor", anchor).text(title);
    svg.append("text").attr("class", "ann").attr("x", tx).attr("y", ty + 16).attr("text-anchor", anchor).text(line);
  };
  annotate(nodeOf(1), 22, -44, "Mark 1 · $0", "built in a cave from scrap");
  annotate(nodeOf(85), -24, 8, "Mark 85 · $10B", "nano armor, Endgame", "end");
  annotate(nodeOf(44), -24, -22, "Hulkbuster · $1.8B", "first suit over $1B", "end");
  const burst = suits.filter(s => s.interval).length;
  svg.append("text").attr("class", "ann-b").attr("x", x(BAND[1]) + 14).attr("y", y(1.4e8)).text(`${burst} suits, Marks 8–42`);
  svg.append("text").attr("class", "ann").attr("x", x(BAND[1]) + 14).attr("y", y(1.4e8) + 16).text("the House Party Protocol fleet");

  // box-office strip: films where Robert Downey Jr. plays Tony Stark
  const tonyFilms = films.filter(f => f.asTony && f.gross && f.date && f.date < new Date(2024, 3, 1));
  tonyFilms.forEach(f => (f.n = suits.filter(s => s.films.includes(f.title)).length));
  const g = d3.scaleLinear().domain([0, 3e9]).range([0, 120]);
  svg.append("text").attr("class", "ttl").attr("x", 8).attr("y", FILM_BASE - 140).text("Worldwide box office (films)");
  svg.append("line").attr("x1", M.l).attr("x2", W - M.r).attr("y1", FILM_BASE).attr("y2", FILM_BASE).attr("stroke", "#2a3947");
  const fg = svg.append("g").selectAll("g").data(tonyFilms).join("g");
  fg.append("rect").attr("class", "film").attr("x", d => x(d.date) - 7).attr("width", 14)
    .attr("y", d => FILM_BASE - g(d.gross)).attr("height", d => g(d.gross))
    .on("mousemove", (e, d) => showTip(e, `<b>${d.title}</b><br>${fmtUsd(d.gross)} worldwide${d.rating ? ` · IMDb ${d.rating}` : ""}<div class="m">Released ${d3.timeFormat("%b %d, %Y")(d.date)} · ${d.n} suit${d.n === 1 ? "" : "s"} in dataset</div>`))
    .on("mouseenter", (e, d) => dots.classed("on", n => n.s.films.includes(d.title)))
    .on("mouseleave", () => { hideTip(); dots.classed("on", n => n.s === current); });
  fg.append("text").attr("class", "film-v").attr("x", d => x(d.date)).attr("y", d => FILM_BASE - g(d.gross) - 6).text(d => fmtUsd(d.gross));
  fg.append("text").attr("class", "film-lbl").attr("x", d => x(d.date)).attr("y", FILM_BASE + 16).text(d => d.short);

  let current = null;
  onSuitSelect(s => {
    current = s;
    dots.classed("on", n => n.s === s).attr("r", n => (n.s === s ? 8 : 6));
  });
}
