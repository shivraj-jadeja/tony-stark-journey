"""Turn data/raw/* into the small, clean files the site loads from data/processed/.

Standard library only:

    python scripts/build_processed.py

Every rule that changes or derives a value is written here, so the write-up can cite it.
Column meanings are documented in data/README.md.
"""
import csv
import gzip
import json
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"
TODAY = date.today().isoformat()


def write(name, rows, fields):
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / name, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"  {name}: {len(rows)} rows")


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def qid(url):
    return url.rsplit("/", 1)[-1] if url else ""


# ------------------------------------------------------------------ MCU suits (Kaggle)
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}
PART = {"Early": 2, "Mid": 7, "Late": 11}  # "Early 2016" -> Feb, "Mid" -> Jul, "Late" -> Nov


def parse_build_date(s):
    """Approximate in-universe build dates -> (start, end, is_interval)."""
    if m := re.fullmatch(r"(\w{3})-(\w{3}) (\d{4})", s):          # "May-Dec 2012"
        y = int(m[3])
        return date(y, MONTHS[m[1]], 1), date(y, MONTHS[m[2]], 28), True
    if m := re.fullmatch(r"(Early|Mid|Late) (\d{4})", s):          # "Mid 2009"
        d = date(int(m[2]), PART[m[1]], 1)
        return d, d, False
    if m := re.fullmatch(r"(\w{3}) (\d{4})", s):                   # "Feb 2008" -> mid-month
        d = date(int(m[2]), MONTHS[m[1]], 15)
        return d, d, False
    raise ValueError(f"unparsed build date: {s!r}")


def parse_value(s):
    """'$100 Million' -> 100000000, '$1.8 Billion' -> 1800000000, '$0' -> 0."""
    m = re.fullmatch(r"\$([\d.]+)\s*(Million|Billion)?", s.strip(), re.I)
    mult = {"million": 1e6, "billion": 1e9}.get((m[2] or "").lower(), 1)
    return int(round(float(m[1]) * mult))


def build_suits():
    rows = []
    for r in read_csv(RAW / "kaggle" / "mcu_iron_man_suits.csv"):
        r = {k.strip(): v.strip() for k, v in r.items()}
        start, end, interval = parse_build_date(r["Date Made"])
        rows.append({
            "mark": int(r["Model"].replace("Mark ", "")),
            "model": r["Model"],
            "era": r["Era"],
            "codename": "" if r["Codename"] == "N/A" else r["Codename"],
            "ability": r["Primary Ability"],
            "date_label": r["Date Made"],
            "date_start": start.isoformat(),
            "date_end": end.isoformat(),
            "date_is_interval": str(interval).lower(),
            "value_usd": parse_value(r["Estimated Value"]),
            "films": "|".join(f.strip() for f in r["Key Movie Appearances"].split(",")),
        })
    write("suits.csv", rows, list(rows[0]))


# ------------------------------------------------------------------ Films (Wikidata + IMDb)
SHORT = {
    "Iron Man": "IM", "The Incredible Hulk": "TIH", "Iron Man 2": "IM2", "The Avengers": "AVG", "Iron Man 3": "IM3",
    "Avengers: Age of Ultron": "AoU", "Captain America: Civil War": "CW", "Spider-Man: Homecoming": "HC",
    "Avengers: Infinity War": "IW", "Avengers: Endgame": "EG", "Avengers: Doomsday": "DD",
}


def load_ratings(ids):
    """IMDb rating and votes for just the ids we need (the full table is ~1.5M rows)."""
    path = RAW / "imdb" / "title.ratings.tsv.gz"
    if not path.exists():
        print("  (no IMDb file; ratings left blank. Run fetch_raw.py imdb)")
        return {}
    out = {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        next(f)
        for line in f:
            tconst, rating, votes = line.rstrip("\n").split("\t")
            if tconst in ids:
                out[tconst] = (rating, votes)
    return out


def build_films():
    rdj = defaultdict(lambda: {"dates": set(), "roles": set()})
    for r in read_csv(RAW / "wikidata" / "rdj_filmography.csv"):
        e = rdj[qid(r["film"])]
        e.update(title=r["title"], imdb=r["imdb"])
        if r["date"][:4].isdigit():
            e["dates"].add(r["date"][:10])
        if r["roleName"]:
            e["roles"].add(r["roleName"])

    # Rule: keep released theatrical films only; drop TV, announced projects and alternate cuts.
    skip_types = ("television", "miniseries", "film project", "extended cut", "re-release")
    rows = read_csv(RAW / "wikidata" / "mcu_films.csv")
    skipped = {qid(r["film"]) for r in rows if any(t in r["typeLabel"].lower() for t in skip_types)}
    mcu = defaultdict(lambda: {"dates": set(), "box": {}, "tony": False})
    for r in rows:
        if qid(r["film"]) in skipped or not r["title"]:
            continue
        e = mcu[qid(r["film"])]
        e.update(title=r["title"], imdb=r["imdb"])
        e["tony"] |= r.get("tony") == "true"
        if r["date"][:4].isdigit():
            e["dates"].add(r["date"][:10])
        if r["box"]:
            e["box"][r["boxScopeLabel"] or ""] = max(float(r["box"]), e["box"].get(r["boxScopeLabel"] or "", 0))

    suit_films = {f.strip() for r in read_csv(RAW / "kaggle" / "mcu_iron_man_suits.csv")
                  for f in r["Key Movie Appearances "].split(",")}
    ratings = load_ratings({e["imdb"] for e in list(mcu.values()) + list(rdj.values()) if e.get("imdb")})

    def worldwide(box):
        # Rule: prefer a value qualified as worldwide; otherwise the largest value (Wikidata lists
        # domestic/opening figures alongside the worldwide total without always qualifying them).
        for scope, v in box.items():
            if "world" in scope.lower():
                return int(v)
        return int(max(box.values())) if box else ""

    films = []
    for q, e in mcu.items():
        rel = min(e["dates"]) if e["dates"] else ""
        if not rel or rel > TODAY and "Doom" not in e["title"]:  # rule: released films, plus Doomsday for the epilogue
            continue
        rating = ratings.get(e.get("imdb"), ("", ""))
        role = "; ".join(sorted(rdj[q]["roles"])) if q in rdj else ""
        # rule: a film is a Tony Stark film if Wikidata lists MCU Tony Stark as a character, or if any
        # suit in the Kaggle suit dataset appears in it (Wikidata misses several of these).
        if e["tony"] or e["title"] in suit_films:
            role = "Tony Stark"
        films.append({
            "title": e["title"], "short": SHORT.get(e["title"], ""), "release_date": rel,
            "worldwide_gross_usd": worldwide(e["box"]), "imdb_id": e.get("imdb", ""),
            "imdb_rating": rating[0], "imdb_votes": rating[1], "rdj_role": role, "wikidata_id": q,
        })
    films.sort(key=lambda f: f["release_date"] or "9999")
    write("films.csv", films, list(films[0]))

    rows = []
    for q, e in rdj.items():
        rating = ratings.get(e.get("imdb"), ("", ""))
        rows.append({
            "title": e["title"], "release_date": min(e["dates"]) if e["dates"] else "",
            "role": "; ".join(sorted(e["roles"])), "mcu": str(q in mcu).lower(),
            "imdb_id": e.get("imdb", ""), "imdb_rating": rating[0], "imdb_votes": rating[1], "wikidata_id": q,
        })
    rows.sort(key=lambda r: r["release_date"] or "9999")
    write("rdj_filmography.csv", rows, list(rows[0]))


# ------------------------------------------------------------------ Iron Man across media (Wikidata)
def medium(type_label):
    t = type_label.lower()
    if "comic" in t or "series" in t and "television" not in t and "video game" not in t or "reprint" in t or "storyline" in t:
        return "comics"
    if "film" in t or "quel" in t:
        return "film"
    if "television" in t:
        return "tv"
    if "video game" in t:
        return "video game"
    return "other"


def build_media():
    seen, rows = set(), []
    for r in read_csv(RAW / "wikidata" / "iron_man_works.csv"):
        q = qid(r["work"])
        if q in seen or re.fullmatch(r"Q\d+", r["workLabel"]):
            continue
        seen.add(q)
        rows.append({"title": r["workLabel"], "type": r["typeLabel"], "medium": medium(r["typeLabel"]),
                     "date": r["date"][:10] if r["date"][:4].isdigit() else "", "wikidata_id": q})
    rows.sort(key=lambda r: r["date"] or "9999")
    write("iron_man_media.csv", rows, list(rows[0]))


# ------------------------------------------------------------------ Comics (Marvel Database)
TITLE = re.compile(r"^(?P<series>.+?) Vol (?P<vol>\d+) (?P<issue>.+)$")
COVER = re.compile(r"^(?P<year>\d{4})(?:, (?P<month>\w+))? Cover Date$")
MONTH_NUM = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August",
                                          "September", "October", "November", "December"], 1)}
TONY = "Anthony Stark (Earth-616)"
DOOM = "Victor von Doom (Earth-616)"


def parse_issue(rec):
    cats = rec["categories"]
    m = TITLE.match(rec["title"])
    year = month = ""
    for c in cats:
        if cm := COVER.match(c):
            year = cm["year"]
            month = MONTH_NUM.get(cm["month"] or "", "") or month
    chars = sorted(c.removesuffix("/Appearances") for c in cats if c.endswith("(Earth-616)/Appearances"))
    return {
        "title": rec["title"],
        "series": m["series"] if m else rec["title"],
        "volume": m["vol"] if m else "",
        "issue": m["issue"] if m else "",
        "cover_year": year,
        "cover_month": month,
        "writers": "|".join(sorted(c.removesuffix("/Writer") for c in cats if c.endswith("/Writer"))),
        "pencilers": "|".join(sorted(c.removesuffix("/Penciler") for c in cats if c.endswith("/Penciler"))),
        "armor_models": "|".join(sorted(c.removesuffix("/Appearances") for c in cats
                                        if c.endswith("/Appearances") and "Armor" in c and "(Earth-616)" not in c)),
        "doom": str(DOOM in chars).lower(),
        "n_characters": len(chars),
        "_chars": chars,
    }


def build_comics():
    def load(key):
        path = RAW / "marvel_fandom" / f"{key}_issues.json"
        return [parse_issue(r) for r in json.loads(path.read_text(encoding="utf-8"))["issues"]] if path.exists() else []

    tony = [i for i in load("tony_stark_616") if i["cover_year"]]  # rule: drop non-comic pages (no cover date)
    tony.sort(key=lambda i: (i["cover_year"], str(i["cover_month"]).zfill(2), i["title"]))
    write("comics_tony_issues.csv", tony, [k for k in tony[0] if not k.startswith("_")])

    by_year = defaultdict(lambda: {"issues": 0, "doom_issues": 0, "armors": set()})
    armor = defaultdict(lambda: {"issues": 0, "years": []})
    costar = defaultdict(lambda: {"shared_issues": 0, "years": []})
    for i in tony:
        y = int(i["cover_year"])
        b = by_year[y]
        b["issues"] += 1
        b["doom_issues"] += i["doom"] == "true"
        for a in filter(None, i["armor_models"].split("|")):
            b["armors"].add(a)
            armor[a]["issues"] += 1
            armor[a]["years"].append(y)
        for c in i["_chars"]:
            if c != TONY:
                costar[c]["shared_issues"] += 1
                costar[c]["years"].append(y)

    years = range(min(by_year), max(by_year) + 1)  # rule: include zero years so a line chart has no gaps
    write("comics_tony_by_year.csv",
          [{"year": y, "issues": by_year[y]["issues"], "doom_issues": by_year[y]["doom_issues"],
            "armor_models": len(by_year[y]["armors"])} for y in years],
          ["year", "issues", "doom_issues", "armor_models"])
    write("comics_armor_models.csv",
          sorted(({"armor_model": a, "issues": v["issues"], "first_year": min(v["years"]), "last_year": max(v["years"])}
                  for a, v in armor.items()), key=lambda r: (r["first_year"], -r["issues"])),
          ["armor_model", "issues", "first_year", "last_year"])
    top = sorted(costar.items(), key=lambda kv: -kv[1]["shared_issues"])[:150]  # rule: top 150 co-stars
    write("comics_tony_costars.csv",
          [{"character": c, "shared_issues": v["shared_issues"], "first_year": min(v["years"]), "last_year": max(v["years"])}
           for c, v in top],
          ["character", "shared_issues", "first_year", "last_year"])

    doom = [i for i in load("victor_von_doom_616") if i["cover_year"]]
    if doom:
        d_year = defaultdict(lambda: [0, 0])
        for i in doom:
            d_year[int(i["cover_year"])][0] += 1
            d_year[int(i["cover_year"])][1] += TONY in i["_chars"]
        ys = range(min(d_year), max(d_year) + 1)
        write("comics_doom_by_year.csv",
              [{"year": y, "doom_issues": d_year[y][0], "with_tony": d_year[y][1]} for y in ys],
              ["year", "doom_issues", "with_tony"])


# ------------------------------------------------------------------ Marvel characters (FiveThirtyEight)
def build_characters():
    rows = []
    for r in read_csv(RAW / "fivethirtyeight" / "marvel-wikia-data.csv"):
        name = r["name"]
        rows.append({
            "name": name,
            "alignment": r["ALIGN"].replace(" Characters", ""),
            "sex": r["SEX"].replace(" Characters", ""),
            "alive": r["ALIVE"].replace(" Characters", ""),
            "appearances": r["APPEARANCES"],
            "first_year": r["Year"],
            "is_tony": str(name.startswith("Iron Man (Anthony")).lower(),
            "is_doom": str(name.startswith("Victor von Doom")).lower(),
        })
    write("marvel_characters.csv", rows, list(rows[0]))


# ------------------------------------------------------------------ Every armor Tony wore (Marvel Database + Kaggle)
FANDOM_WIKI = "https://marvel.fandom.com/wiki/"
# Wearer groups for armors Tony designed but did not wear (matched on the page's owner fields).
WEARERS = {"James Rhodes": "War Machine", "Virginia Potts": "Rescue", "Alpha Team": "S.H.I.E.L.D. Alpha Team",
           "Reed Richards": "Mister Fantastic"}


def infobox(wikitext, field):
    """Raw value of one '| Field = value' infobox line (values can run over several lines)."""
    m = re.search(r"^\|\s*" + field + r"\s*=(.*?)(?=^\|\s*\w+\s*=|^\}\}|\Z)", wikitext, re.M | re.S)
    return m[1].strip() if m else ""


def wiki_text(s):
    """Wiki markup -> plain text: links keep their label, refs/templates/HTML dropped, whitespace squeezed."""
    s = re.sub(r"\{\{r\|[^{}]*\}\}", "", s)                         # citation refs
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)         # [[target|label]] -> label
    s = re.sub(r"<br\s*/?>", "; ", s)
    s = re.sub(r"<[^>]+>|\{\{[^{}]*\}\}|'''?", "", s)
    s = re.sub(r"^\*\s*", "", s, flags=re.M)
    return re.sub(r"\s+", " ", s).strip(" ;")


def roman(s):
    v = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}
    return sum(-v[a] if b and v[b] > v[a] else v[a] for a, b in zip(s, list(s[1:]) + [None]))


def build_armors():
    """Rules (design/03, locked with Shivraj on Nov 18):
    - Realities: Earth-616 (main comics) and Earth-199999 (MCU) only.
    - Tony's armors: 'Iron Man Armor ...' pages whose CurrentOwner/PreviousOwners list Anthony Stark. Pages with no
      owner at all but Tony as lead designer (Models 8, 61, YT1) also count as Tony's.
    - Armors Tony designed but someone else wore -> ring 'others', grouped by wearer (WEARERS).
    - Appearances: MCU = size of the page's '/Appearances' category; comics = issues in comics_armor_models.csv.
    - Famous: top 12 per universe by appearances (ties: higher est. value first) -> outer ring; the rest -> inner ring.
    - Kaggle (suits.csv) wins for MCU codename, era, ability, build date, est. value, films; the Marvel Database
      page gives first appearance, designer, creators, weight, height, capability tags and the source link."""
    raw = json.loads((RAW / "marvel_fandom" / "iron_man_armor_pages.json").read_text(encoding="utf-8"))
    suits = {int(r["mark"]): r for r in read_csv(OUT / "suits.csv")}
    comic_counts = {r["armor_model"]: r for r in read_csv(OUT / "comics_armor_models.csv")}
    film_years = {r["title"].lower(): r["release_date"][:4] for r in read_csv(OUT / "films.csv")}

    rows = []
    for p in raw["pages"]:
        title, w = p["title"], p["wikitext"]
        reality = infobox(w, "Reality")
        mcu = "199999" in reality
        if not (mcu or "Earth-616" in reality):
            continue
        owners = " ".join(infobox(w, k) for k in ("CurrentOwner", "PreviousOwners"))
        designer = wiki_text(infobox(w, "LeadDesigner"))
        tony_designed = "Anthony Stark" in infobox(w, "LeadDesigner")
        # owner "Iron Man" written as plain text (Model 8) also means Tony
        tony_wore = "Anthony Stark" in owners or owners.strip() == "Iron Man" or (not owners.strip() and tony_designed)
        first = wiki_text(infobox(w, "First"))
        row = {
            "id": title, "universe": "MCU" if mcu else "Comics", "first_appearance": first,
            "lead_designer": designer, "creators": wiki_text(infobox(w, "Creators")).replace(";", ","),
            "weight": wiki_text(infobox(w, "Weight")), "height": wiki_text(infobox(w, "Dimensions")),
            "capabilities": "|".join(sorted({t.strip() for t in re.findall(r"\{\{Power\|([^|}]+)", w)})),
            "source_url": FANDOM_WIKI + title.replace(" ", "_"),
        }
        mk = re.fullmatch(r"Iron Man Armor MK ([IVXLC]+) \(Earth-199999\)", title)
        if title.startswith("Iron Man Armor") and tony_wore:
            if mcu:
                if not mk:
                    continue
                n = roman(mk[1]); s = suits.get(n, {})
                row.update(name=f"Mark {n}", mark=n, appearances=p.get("appearances", 0), unit="appearances",
                           codename=s.get("codename", ""), era=s.get("era", ""), ability=s.get("ability", ""),
                           built=s.get("date_label", ""), value_usd=s.get("value_usd", ""), films=s.get("films", ""),
                           first_year=film_years.get(re.sub(r" \(film\)$", "", first).lower(), ""))
            else:
                c = comic_counts.get(title, {})
                row.update(name=title.removeprefix("Iron Man Armor "), appearances=int(c.get("issues") or 0), unit="issues",
                           first_year=c.get("first_year", ""), last_year=c.get("last_year", ""))
            row["ring"] = "inner"
            rows.append(row)
        elif tony_designed:   # designed by Tony, worn by someone else (War Machine MK I lists both Rhodes and Tony)
            group = next((g for k, g in WEARERS.items() if k in owners), None)
            if group:
                row.update(name=re.sub(r" \(Earth-\d+\)$", "", title), ring="others", group=group, unit="",
                           appearances=p.get("appearances", 0))
                rows.append(row)

    for uni in ("MCU", "Comics"):
        mine = [r for r in rows if r["universe"] == uni and r["ring"] == "inner"]
        mine.sort(key=lambda r: (-int(r["appearances"] or 0), -float(r.get("value_usd") or 0), r["name"]))
        for i, r in enumerate(mine):
            r["rank"] = i + 1
            if i < 12:
                r["ring"] = "outer"
    order = {"outer": 0, "inner": 1, "others": 2}
    rows.sort(key=lambda r: (r["universe"], order[r["ring"]], r.get("rank") or 0, r["name"]))
    write("armors_all.csv", rows, ["id", "name", "universe", "ring", "rank", "group", "appearances", "unit", "mark",
                                   "codename", "era", "ability", "built", "value_usd", "films", "first_appearance",
                                   "first_year", "last_year", "lead_designer", "creators", "weight", "height",
                                   "capabilities", "source_url"])


# ------------------------------------------------------------------ Tony Stark variants (Marvel Database)
VARIANT_TITLE = re.compile(r"^(?:Anthony|Antonio|Tony) Stark \((.+)\)$")
DATED = re.compile(r"^(\d{4})(?:, \w+)?( Cover Date)?$")
RELEASED = re.compile(r"^Comics Released in (\d{4})$")
# Medium of an appearance page, from the wiki's own page-type categories.
MEDIA = {"Comics": "comics", "Episodes": "tv", "Feature Films": "film", "Web Films": "film", "Short Films": "film",
         "LEGO short films": "film"}
LANES = {"comics": "Other comics", "tv": "TV series", "film": "Films", "other": "Other media"}
UNDATED = "Undated"


def variant_field(wikitext, field):
    """Infobox value as plain text, with footnotes (<ref>...</ref>) removed before the markup is stripped."""
    return wiki_text(re.sub(r"<ref[^>]*?/>|<ref[^>]*>.*?</ref>", "", infobox(wikitext, field), flags=re.S))


def page_year(cats):
    """Year of one appearance page: its cover date (comics), else its release category, else its date category."""
    cover = [int(m[1]) for c in cats if (m := DATED.match(c)) and m[2]]
    released = [int(m[1]) for c in cats if (m := RELEASED.match(c))]
    plain = [int(m[1]) for c in cats if (m := DATED.match(c)) and not m[2]]
    return (cover or released or plain or [None])[0]


def page_medium(cats):
    if any(DATED.match(c) and c.endswith("Cover Date") or RELEASED.match(c) for c in cats):
        return "comics"
    return next((MEDIA[c] for c in cats if c in MEDIA), "other")


def build_variants():
    """Rules (design/04):
    - A variant is a Marvel Database character page titled "Anthony Stark (...)". A redirect of that form counts when
      it lands on an "Antonio Stark (...)" or "Tony Stark (...)" page (Earth-1610's Tony is filed as Antonio).
      Redirects that land on someone else (Arno Stark, Iron Moth, a Skrull impostor) are dropped, and so are
      disambiguation pages.
    - Years come from the pages in the variant's "/Appearances" and "/Minor Appearances" categories: cover year for
      comics, release year otherwise. Pages without a date are counted in the totals but have no year.
    - first_year / last_year: earliest and latest dated page. A variant with no dated page has no years.
    - death_year: the year of the page named in the infobox "Death" field, when that page is dated.
    - lane: Earth-616 and Earth-199999 (the MCU) are their own lanes; every other variant goes by the medium most of
      its appearance pages belong to (ties: comics, then tv, film, other). "Other media" is games, novels, stage shows
      and anything else the wiki does not file as a comic, episode or film. A variant with no dated page goes to
      "Undated".
    - chapters: the page's level-3 history headings in page order. They are ordered, not dated.
    - teams: the {{m|Team}} links in the infobox "Affiliation" field (current and former), reality suffix removed.
    - killed_by: the infobox "KilledBy" names, reality suffix removed. cause_of_death: that field as plain text.
    - armors: the "Iron Man Armor ..." pages linked in the infobox "Equipment" field (the bare "Iron Man Armor"
      link names no model, so it is not listed).
    - occupation: the lines of the infobox "Occupation" field, current and former together.
    - seen_comics / seen_tv / seen_film / seen_other: how many of the variant's appearance pages are of each medium.
    Nothing is filled in: blank fields stay blank."""
    path = RAW / "marvel_fandom" / "tony_variants.json"
    if not path.exists():
        print("  skipped (run: python scripts/fetch_raw.py variants)")
        return
    raw = json.loads(path.read_text(encoding="utf-8"))
    pages = dict(raw["appearance_pages"])
    main = RAW / "marvel_fandom" / "tony_stark_616_issues.json"
    if main.exists():   # issues already fetched for Chapter 1 carry their cover dates there
        pages.update({i["title"]: i["categories"] for i in json.loads(main.read_text(encoding="utf-8"))["issues"]})

    rows, year_rows = [], []
    for v in raw["variants"]:
        title, w = v["title"], v["wikitext"]
        m = VARIANT_TITLE.match(title)
        if not m or "Marvel Database:Character Template" not in w[:200]:
            continue
        reality = infobox(w, "Reality").strip()
        years = defaultdict(lambda: [0, 0])
        media = Counter()
        for kind, titles in enumerate((v["appearances"], v["minor_appearances"])):
            for t in titles:
                cats = pages.get(t, [])
                media[page_medium(cats)] += 1
                if y := page_year(cats):
                    years[y][kind] += 1
        if reality == "Earth-616":
            lane = "Earth-616 comics"
        elif reality == "Earth-199999":
            lane = "MCU"
        elif not years:
            lane = UNDATED
        else:
            order = ["comics", "tv", "film", "other"]
            lane = LANES[max(order, key=lambda k: (media[k], -order.index(k)))]
        first, death = variant_field(w, "First"), variant_field(w, "Death")
        chapters = [wiki_text(h) for h in re.findall(r"^===\s*([^=].*?)\s*===\s*$", infobox(w, "History"), re.M)]
        no_reality = lambda s: re.sub(r"\s*\((?:Earth-[^)]*|[^)]*\) \(Earth-[^)]*)\)$", "", s.strip())
        teams = list(dict.fromkeys(no_reality(t) for t in re.findall(r"\{\{[mM]\|([^|}]+)", infobox(w, "Affiliation"))))
        killers = [no_reality(k) for k in wiki_text(infobox(w, "KilledBy")).split(";") if k.strip()]
        armors = sorted({no_reality(a).removeprefix("Iron Man Armor").strip() for a in
                         re.findall(r"\[\[(Iron Man Armor[^|\]#]*)", infobox(w, "Equipment"))} - {""})
        jobs = [wiki_text(j).strip(" .:") for j in re.split(r"[\n*;]", re.sub(r"<ref[^>]*?/>|<ref[^>]*>.*?</ref>", "", infobox(w, "Occupation"), flags=re.S))]
        jobs = list(dict.fromkeys(j[:1].upper() + j[1:] for j in jobs if j and j.lower() != "formerly"))
        rows.append({
            "id": title, "name": variant_field(w, "Name") or "Anthony Stark", "designation": m[1].replace(") (", ", "),
            "reality": reality, "lane": lane, "alias": variant_field(w, "CurrentAlias"),
            "appearances": len(v["appearances"]), "minor_appearances": len(v["minor_appearances"]),
            "first_year": min(years) if years else "", "last_year": max(years) if years else "",
            "first_appearance": first, "death": death, "death_year": page_year(pages.get(death, [])) or "",
            "identity": variant_field(w, "Identity"), "creators": variant_field(w, "Creators").replace(";", ","),
            "chapters": "|".join(c for c in chapters if c),
            "teams": "|".join(teams), "occupation": "|".join(jobs),
            "killed_by": "|".join(killers),
            "cause_of_death": re.sub(r"^#\s*", "", variant_field(w, "CauseOfDeath")).replace(" # ", "; "),
            "armors": "|".join(armors),
            "seen_comics": media["comics"], "seen_tv": media["tv"], "seen_film": media["film"], "seen_other": media["other"],
            "source_url": FANDOM_WIKI + title.replace(" ", "_"),
        })
        year_rows += [{"id": title, "year": y, "appearances": a, "minor_appearances": b} for y, (a, b) in sorted(years.items())]
    rows.sort(key=lambda r: (r["first_year"] or 9999, -r["appearances"], r["id"]))
    write("variants.csv", rows, list(rows[0]))
    write("variant_years.csv", year_rows, ["id", "year", "appearances", "minor_appearances"])
    write("variants_meta.csv", [{"key": "fetched", "value": raw["fetched"]}, {"key": "source", "value": raw["source"]}],
          ["key", "value"])


if __name__ == "__main__":
    for step in (build_suits, build_films, build_media, build_comics, build_characters, build_armors, build_variants):
        print(step.__name__)
        step()
    print("done")
