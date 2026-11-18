// Chapter 1 · "Sixty years of comics": Tony Stark comic issues per year since 1963 (gold area), the issues
// Doctor Doom also appears in (green area, same scale), and distinct armor models seen per year (cyan line,
// right-hand scale). Data: data/processed/comics_tony_by_year.csv (Marvel Database, CC BY-SA).
// Interaction: hover or arrow keys pick a year (rule + tooltip); legend buttons show/hide each series.
// Base view for teammates to extend (design/02, option 2B).
const W = 980, H = 420, M = { t: 34, r: 56, b: 40, l: 56 };
const GOLD = "#e3a83c", DOOM = "#4f9a5c", ARC = "#5fd8ff";

export function mountComicsByYear({ svg: svgEl, box, tip: tipEl, legend: legendEl, rows }) {
  const svg = d3.select(svgEl);
  const years = rows.map(d => d.year);
  const x = d3.scaleLinear().domain(d3.extent(years)).range([M.l, W - M.r]);
  const y = d3.scaleLinear().domain([0, d3.max(rows, d => d.issues)]).nice().range([H - M.b, M.t]);
  const y2 = d3.scaleLinear().domain([0, d3.max(rows, d => d.armor_models)]).nice().range([H - M.b, M.t]);

  // axes and gridlines (margin convention)
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - M.b})`)
    .call(d3.axisBottom(x).tickFormat(d3.format("d")).ticks(12).tickSize(4));
  svg.append("g").attr("class", "axis grid").attr("transform", `translate(${M.l},0)`)
    .call(d3.axisLeft(y).ticks(6).tickSize(-(W - M.l - M.r)))
    .call(g => g.select(".domain").remove());
  svg.append("g").attr("class", "axis").attr("transform", `translate(${W - M.r},0)`)
    .call(d3.axisRight(y2).ticks(5).tickSize(4));
  svg.append("text").attr("class", "ttl").attr("x", M.l).attr("y", M.t - 16).text("Issues per year");
  svg.append("text").attr("class", "ttl").attr("x", W - M.r).attr("y", M.t - 16).attr("text-anchor", "end").text("Armor models (line)");
  svg.append("text").attr("class", "ttl").attr("x", (M.l + W - M.r) / 2).attr("y", H - 4).attr("text-anchor", "middle").text("Cover year");

  // series
  const area = acc => d3.area().x(d => x(d.year)).y0(y(0)).y1(d => y(acc(d))).curve(d3.curveMonotoneX);
  const series = [
    { key: "issues", label: "Tony issues", color: GOLD,
      node: svg.append("path").datum(rows).attr("class", "s-area").attr("fill", GOLD).attr("fill-opacity", .55).attr("d", area(d => d.issues)) },
    { key: "doom", label: "with Doctor Doom", color: DOOM,
      node: svg.append("path").datum(rows).attr("class", "s-area").attr("fill", DOOM).attr("fill-opacity", .9).attr("d", area(d => d.doom_issues)) },
    { key: "armor", label: "armor models", color: ARC,
      node: svg.append("path").datum(rows).attr("class", "s-line").attr("fill", "none").attr("stroke", ARC).attr("stroke-width", 1.6)
        .attr("d", d3.line().x(d => x(d.year)).y(d => y2(d.armor_models)).curve(d3.curveMonotoneX)) }
  ];

  // hover: a year rule, focus dots, tooltip
  const rule = svg.append("line").attr("class", "rule").attr("y1", M.t).attr("y2", H - M.b).style("opacity", 0);
  const dots = svg.append("g").style("opacity", 0);
  const dIssues = dots.append("circle").attr("r", 4).attr("fill", GOLD);
  const dDoom = dots.append("circle").attr("r", 4).attr("fill", DOOM);
  const dArmor = dots.append("circle").attr("r", 4).attr("fill", ARC);
  const tip = d3.select(tipEl);
  const byYear = new Map(rows.map(d => [d.year, d]));
  let current = null;

  function show(yr, cx, cy) {
    const d = byYear.get(yr);
    if (!d) return;
    current = yr;
    const px = x(yr);
    rule.attr("x1", px).attr("x2", px).style("opacity", 1);
    dIssues.attr("cx", px).attr("cy", y(d.issues));
    dDoom.attr("cx", px).attr("cy", y(d.doom_issues));
    dArmor.attr("cx", px).attr("cy", y2(d.armor_models));
    dots.style("opacity", 1);
    tip.html(`<b>${yr}</b><br>${d.issues} issues · ${d.doom_issues} with Doom<div class="m">${d.armor_models} distinct armor models</div>`)
      .style("opacity", 1);
    // position next to the rule (in box pixels), flipping left near the right edge
    const r = box.getBoundingClientRect(), sr = svgEl.getBoundingClientRect(), k = sr.width / W;
    const tw = tipEl.offsetWidth;
    let left = sr.left - r.left + box.scrollLeft + px * k + 14;
    if (left + tw > box.scrollLeft + r.width) left -= tw + 28;
    tip.style("left", `${left}px`).style("top", `${(cy ?? sr.top - r.top + M.t * k + 20)}px`);
  }
  function hide() { current = null; rule.style("opacity", 0); dots.style("opacity", 0); tip.style("opacity", 0); }

  svg.append("rect").attr("class", "hit").attr("x", M.l).attr("y", M.t).attr("width", W - M.l - M.r).attr("height", H - M.t - M.b)
    .attr("fill", "transparent")
    .on("pointermove", e => {
      const [mx] = d3.pointer(e);
      const r = box.getBoundingClientRect();
      show(Math.round(x.invert(mx)), null, e.clientY - r.top + 14);
    })
    .on("pointerleave", hide);

  // keyboard: focus the chart, then arrow keys step through years
  svgEl.setAttribute("tabindex", "0");
  svgEl.addEventListener("keydown", e => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) { if (e.key === "Escape") hide(); return; }
    e.preventDefault();
    const yr = Math.max(years[0], Math.min(years[years.length - 1], (current ?? years[0] - step) + step));
    show(yr);
  });
  svgEl.addEventListener("blur", hide);

  // legend doubles as series toggles
  d3.select(legendEl).selectAll("button").data(series).join("button")
    .attr("aria-pressed", "true")
    .html(s => `<i style="background:${s.color}"></i>${s.label}`)
    .on("click", function (e, s) {
      const on = this.getAttribute("aria-pressed") !== "true";
      this.setAttribute("aria-pressed", String(on));
      s.node.interrupt().transition().duration(200).style("opacity", on ? 1 : 0);
    });
}
