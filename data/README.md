# Data

`raw/` holds files exactly as downloaded. `processed/` holds the cleaned files the site loads, built by
`scripts/build_processed.py`. Never edit either by hand: change the script and rebuild.

```
python scripts/fetch_raw.py          # download anything missing (add --force to refresh)
python scripts/build_processed.py    # rebuild processed/
```

Wikidata's query service sometimes limits clients to one request per minute. `fetch_raw.py` waits out
the limit, so the Wikidata step can take a while.

## Sources

| Folder | Source | What it gives the story | License |
|---|---|---|---|
| `raw/kaggle/` | [MCU Iron Man Suits](https://www.kaggle.com/datasets/butleriii/mcu-iron-man-suits-dataset) (49 suits) | MCU armor: era, codename, ability, build date, estimated value, films | Kaggle dataset page; committed by hand (Kaggle needs a login) |
| `raw/marvel_fandom/` | [Marvel Database](https://marvel.fandom.com/wiki/Category:Anthony_Stark_(Earth-616)/Appearances), every issue in the Tony Stark (Earth-616) and Victor von Doom (Earth-616) appearance categories, with each issue's categories; plus every page in [Category:Iron Man Armor](https://marvel.fandom.com/wiki/Category:Iron_Man_Armor) (wikitext + appearance count) | Comic issues per year, writers, armor models, co-appearing characters, Doom overlap, the Armory Rings | CC BY-SA 3.0 |
| `raw/fivethirtyeight/` | [FiveThirtyEight comic-characters](https://github.com/fivethirtyeight/data/tree/master/comic-characters) | All ~16,000 Marvel characters with appearance counts and first year; Tony and Doom in context | CC BY 4.0 |
| `raw/wikidata/` | [Wikidata](https://query.wikidata.org/) SPARQL exports (queries are in `fetch_raw.py`) | MCU films (release, box office, IMDb id), Robert Downey Jr.'s filmography and roles, Iron Man across media | CC0 |
| `raw/imdb/` | [IMDb non-commercial datasets](https://developer.imdb.com/non-commercial-datasets/), `title.ratings` | Film ratings and vote counts | Non-commercial use; git-ignored (9 MB), re-fetch with `fetch_raw.py imdb` |

All sources are public. Nothing in this folder is invented or model-generated.

## Processed files

### `suits.csv`: one row per MCU armor (49)
| Column | Meaning | Abstract type |
|---|---|---|
| `mark` | Mark number | ordinal |
| `model` | "Mark 42" | categorical identifier |
| `era` | Foundations · Prototypes / Specialists · Post-Malibu | nominal |
| `codename` | e.g. "Prodigal Son"; blank if none | nominal |
| `ability` | primary ability (free text) | text |
| `date_label` | build date as written in the source | text |
| `date_start`, `date_end` | parsed build date or interval | temporal |
| `date_is_interval` | true when the source gives a range ("May-Dec 2012") | boolean |
| `value_usd` | estimated fictional value | quantitative (ratio), fan estimate |
| `films` | films the suit appears in, `|`-separated | multivalued nominal |

Parsing rules: "Feb 2008" becomes the 15th of the month; "Early/Mid/Late 2016" becomes Feb 1 / Jul 1 / Nov 1;
"May-Dec 2012" becomes an interval from May 1 to Dec 28. "$1.8 Billion" becomes 1800000000.

### `films.csv`: released MCU films, plus Avengers: Doomsday
`title, short, release_date, worldwide_gross_usd, imdb_id, imdb_rating, imdb_votes, rdj_role, wikidata_id`

- `release_date` is the earliest date Wikidata lists (often the premiere).
- `worldwide_gross_usd`: the box-office value qualified as worldwide; otherwise the largest listed value.
- `rdj_role`: "Tony Stark" when Wikidata lists MCU Tony Stark as a character, or when any suit in `suits.csv`
  appears in the film (Wikidata misses Iron Man 3, Age of Ultron, Civil War and Homecoming). Otherwise Downey's
  role as Wikidata states it. Wikidata lists him in Spider-Man: No Way Home as "Peter Parker"; treat that as a
  Wikidata error.
- `short` is a label code for charts (IM, IM2, AVG...) for Tony's films only.

### `rdj_filmography.csv`: every Wikidata work with Robert Downey Jr. in the cast
`title, release_date, role, mcu, imdb_id, imdb_rating, imdb_votes, wikidata_id`

### `iron_man_media.csv`: works Wikidata links to Iron Man or MCU Tony Stark
`title, type, medium (comics | film | tv | video game | other), date, wikidata_id`. Sparse: Wikidata only lists
some comic issues. Use it for "Iron Man across media", not for issue counts.

### `comics_tony_issues.csv`: one row per comic issue Tony appears in
`title, series, volume, issue, cover_year, cover_month, writers, pencilers, armor_models, doom, n_characters`

- Pages without a cover date (magazines, non-comics) are dropped.
- `writers`, `pencilers`, `armor_models` are `|`-separated. `armor_models` uses the wiki's armor names ("Iron Man Armor Model 1").
- `doom` is true when Victor von Doom (Earth-616) also appears.

### `comics_tony_by_year.csv`
`year, issues, doom_issues, armor_models` (distinct armor models seen that year). Years with no issues are included as 0.

### `comics_armor_models.csv`
`armor_model, issues, first_year, last_year`

### `comics_tony_costars.csv`: top 150 Earth-616 characters by issues shared with Tony
`character, shared_issues, first_year, last_year`. Teams appear too ("Avengers (Earth-616)").

### `comics_doom_by_year.csv`
`year, doom_issues, with_tony`

### `armors_all.csv`: every armor Tony wore (MCU + main comics), plus the ones he built for others
Built by `build_armors()` from `raw/marvel_fandom/iron_man_armor_pages.json` (every page in Category:Iron Man Armor,
with each page's appearance count) joined to `suits.csv`, `comics_armor_models.csv` and `films.csv`.

| Column | Meaning | Abstract type |
|---|---|---|
| `id` | Marvel Database page title | categorical identifier |
| `name` | "Mark 42", "Model 37", "War Machine Armor MK III" | categorical |
| `universe` | MCU (Earth-199999) · Comics (Earth-616) | nominal |
| `ring` | outer (12 most-seen per universe) · inner (the rest) · others (built for someone else) | nominal, derived |
| `rank` | rank by appearances within its universe | ordinal, derived |
| `group` | wearer, for `others` (War Machine, Rescue, S.H.I.E.L.D. Alpha Team, Mister Fantastic) | nominal |
| `appearances`, `unit` | MCU: size of the page's "/Appearances" category; comics: issues with Tony (`comics_armor_models.csv`) | quantitative (count) |
| `mark`, `codename`, `era`, `ability`, `built`, `value_usd`, `films` | from `suits.csv` (MCU only; value is a fan estimate) | mixed |
| `first_appearance`, `first_year`, `last_year` | first issue/film; years from `comics_armor_models.csv` or `films.csv` | text, temporal |
| `lead_designer`, `creators` | infobox: in-story designer, real-world creators | text |
| `weight`, `height` | infobox, only where the page gives one (7 and 5 of 272 pages) | text |
| `capabilities` | `{{Power|…}}` tags in the page text, `|`-separated (25 of 272 pages) | multivalued nominal |
| `source_url` | Marvel Database page | URL |

Rules: Earth-616 and Earth-199999 only. "Tony wore it" = Anthony Stark in CurrentOwner/PreviousOwners, or the owner is
written as "Iron Man", or no owner is listed and Tony is lead designer (Models 8, 61, YT1). Ties in the top-12 rank go to
the higher estimated value. Nothing is filled in: blank fields stay blank.

### `marvel_characters.csv`: FiveThirtyEight table, trimmed
`name, alignment, sex, alive, appearances, first_year, is_tony, is_doom`. Its counts stop in 2014; the Marvel
Database files above are current.

## Known caveats

- Suit values are fan estimates of fictional prices; label them as estimates in every chart.
- Marvel Database categories are community-edited, so counts can shift slightly on a re-fetch. The fetch date is
  stored inside each raw JSON file.
- Wikidata box-office figures come from several sources and are not always labelled worldwide; check headline
  numbers against Box Office Mojo before quoting them.
