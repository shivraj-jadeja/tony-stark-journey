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

// Every Tony Stark variant in the Marvel Database, with its appearances per year. Rules: build_variants() in build_processed.py.
export const loadVariants = () => once("variants", () => Promise.all([
  d3.csv("data/processed/variants.csv", r => ({
    id: r.id,                             // Marvel Database page title
    name: r.name,
    designation: r.designation,           // "Earth-199999", "Clone, Earth-616"
    reality: r.reality || null,
    lane: r.lane,
    alias: r.alias || null,
    appearances: +r.appearances || 0,
    minor: +r.minor_appearances || 0,
    firstYear: r.first_year ? +r.first_year : null,
    lastYear: r.last_year ? +r.last_year : null,
    first: r.first_appearance || null,
    death: r.death || null,
    deathYear: r.death_year ? +r.death_year : null,
    identity: r.identity || null,
    creators: r.creators || null,
    chapters: r.chapters ? r.chapters.split("|") : [],
    teams: r.teams ? r.teams.split("|") : [],
    occupation: r.occupation ? r.occupation.split("|") : [],
    killedBy: r.killed_by ? r.killed_by.split("|") : [],
    cause: r.cause_of_death || null,
    armors: r.armors ? r.armors.split("|") : [],
    seen: { comics: +r.seen_comics || 0, tv: +r.seen_tv || 0, film: +r.seen_film || 0, other: +r.seen_other || 0 },
    url: r.source_url
  })),
  d3.csv("data/processed/variant_years.csv", r => ({ id: r.id, year: +r.year, n: +r.appearances + +r.minor_appearances })),
  d3.csv("data/processed/variants_meta.csv")
]).then(([variants, years, meta]) => {
  const byId = d3.group(years, y => y.id);
  variants.forEach(v => { v.years = byId.get(v.id) || []; });
  variants.fetched = meta.find(m => m.key === "fetched")?.value || null;   // the day the wiki was read
  return variants;
}));
