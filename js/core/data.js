// Loaders for data/processed/*. Each file is fetched once and shared by every view that asks for it.
// Columns are documented in data/README.md; regenerate the files with scripts/build_processed.py.
const d3 = window.d3;
const cache = new Map();
const once = (key, fn) => {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
};
const date = s => (s ? new Date(`${s}T00:00:00`) : null);

export const ERAS = ["Foundations", "Prototypes / Specialists", "Post-Malibu"];

export const loadSuits = () => once("suits", () =>
  d3.csv("data/processed/suits.csv", r => {
    const start = date(r.date_start), end = date(r.date_end);
    return {
      mark: +r.mark,
      model: r.model,
      era: r.era,
      codename: r.codename || null,
      ability: r.ability,
      dateLabel: r.date_label,
      start, end,
      mid: new Date((+start + +end) / 2),
      interval: r.date_is_interval === "true",
      value: +r.value_usd,
      films: r.films ? r.films.split("|") : []
    };
  }).then(rows => {
    const byValue = [...rows].sort((a, b) => b.value - a.value);
    rows.forEach(s => (s.rank = byValue.indexOf(s) + 1));
    return rows;
  }));

export const loadFilms = () => once("films", () =>
  d3.csv("data/processed/films.csv", r => ({
    title: r.title,
    short: r.short,
    date: date(r.release_date),
    gross: r.worldwide_gross_usd ? +r.worldwide_gross_usd : null,
    imdbId: r.imdb_id,
    rating: r.imdb_rating ? +r.imdb_rating : null,
    rdjRole: r.rdj_role || null,
    asTony: /tony stark|iron man/i.test(r.rdj_role || "")
  })));

// Every armor Tony wore (MCU + main comics) plus the ones he built for others. Rules: build_armors() in build_processed.py.
export const loadArmors = () => once("armors", () =>
  d3.csv("data/processed/armors_all.csv", r => ({
    id: r.id,
    name: r.name,
    universe: r.universe,                 // "MCU" | "Comics"
    ring: r.ring,                         // "outer" (famous 12) | "inner" | "others" (built for someone else)
    rank: r.rank ? +r.rank : null,
    group: r.group || null,               // wearer, for ring "others"
    appearances: +r.appearances || 0,
    unit: r.unit,                         // "appearances" (MCU) | "issues" (comics)
    mark: r.mark ? +r.mark : null,
    codename: r.codename || null,
    era: r.era || null,
    ability: r.ability || null,
    built: r.built || null,
    value: r.value_usd ? +r.value_usd : null,
    films: r.films ? r.films.split("|") : [],
    first: r.first_appearance || null,
    firstYear: r.first_year ? +r.first_year : null,
    lastYear: r.last_year ? +r.last_year : null,
    designer: r.lead_designer || null,
    creators: r.creators || null,
    weight: r.weight || null,
    height: r.height || null,
    capabilities: r.capabilities ? r.capabilities.split("|") : [],
    url: r.source_url
  })));

export const loadComicsByYear = () => once("comicsByYear", () =>
  d3.csv("data/processed/comics_tony_by_year.csv", d3.autoType));
