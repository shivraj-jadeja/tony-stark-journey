// Small data-driven text bits: hero numbers, spec strips and the Doomsday countdown.
import { fmtInt, fmtUsd } from "../core/format.js";

export function fillStat(name, value) {
  document.querySelectorAll(`[data-stat="${name}"]`).forEach(el => (el.textContent = value));
}

export function renderSpec(el, rows) {
  d3.select(el).selectAll("div").data(rows).join("div").html(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`);
}

export const suitSpecRows = (s, total) => [
  ["Model", s.model],
  ["Built", s.dateLabel],
  ["Est. value", fmtUsd(s.value)],
  ["Value rank", `#${s.rank} of ${total}`]
];

export function comicsSpecRows(byYear) {
  const total = d3.sum(byYear, d => d.issues);
  const peak = byYear.reduce((a, b) => (b.issues > a.issues ? b : a));
  const withDoom = d3.sum(byYear, d => d.doom_issues);
  return [
    ["First cover year", byYear[0].year],
    ["Issues with Tony", fmtInt(total)],
    ["Busiest year", `${peak.year} · ${peak.issues} issues`],
    ["Issues with Doom too", fmtInt(withDoom)]
  ];
}

export function initCountdown(numEl, labelEl, release = new Date(2026, 11, 18)) {
  const days = Math.ceil((release - new Date()) / 864e5);
  if (days > 0) numEl.textContent = days;
  else { numEl.textContent = "Now"; labelEl.innerHTML = "Avengers: Doomsday<br>in theaters"; }
}
