"""Download every raw dataset used by the story into data/raw/.

Standard library only, so it runs on any Python 3.9+ without installs:

    python scripts/fetch_raw.py            # fetch everything missing
    python scripts/fetch_raw.py --force    # re-download everything
    python scripts/fetch_raw.py fandom     # fetch one source (fandom, armor, variants, wikidata, fivethirtyeight, imdb)

Raw files are kept exactly as downloaded. Cleaning happens in build_processed.py.
The Kaggle suit CSV cannot be fetched without a Kaggle login, so it is committed by hand
(see data/README.md).
"""
import gzip
import json
import shutil
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
UA = "tony-stark-journey/0.1 (CSE 478 course project; data visualization)"
FORCE = "--force" in sys.argv


def get(url, params=None, accept=None, retries=4):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA, **({"Accept": accept} if accept else {})})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # network hiccups and rate limits: back off and retry
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt * 3
            if getattr(e, "code", None) == 429:  # Wikidata sometimes limits to 1 request per minute
                wait = int(e.headers.get("Retry-After") or 65)
            print(f"  retry in {wait}s ({e})")
            time.sleep(wait)


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(f"  wrote {path.relative_to(ROOT)} ({len(data) / 1024:.0f} KB)")


def needed(path):
    if path.exists() and not FORCE:
        print(f"  skip {path.relative_to(ROOT)} (exists)")
        return False
    return True


# ---------------------------------------------------------------- FiveThirtyEight
def fetch_fivethirtyeight():
    """Marvel Wikia character table behind FiveThirtyEight's 'Comic Books Are Still Made By Men...' (CC BY 4.0)."""
    print("FiveThirtyEight comic characters")
    out = RAW / "fivethirtyeight" / "marvel-wikia-data.csv"
    if needed(out):
        save(out, get("https://raw.githubusercontent.com/fivethirtyeight/data/master/comic-characters/marvel-wikia-data.csv"))


# ---------------------------------------------------------------- Wikidata
SPARQL = {
    # Every work Wikidata links to Iron Man (comics character Q180704) or MCU Tony Stark (Q23894967).
    "iron_man_works.csv": """
SELECT ?work ?workLabel ?typeLabel (MIN(?d) AS ?date) WHERE {
  VALUES ?ch { wd:Q180704 wd:Q23894967 }
  { ?work wdt:P674 ?ch } UNION { ?ch wdt:P1441 ?work }
  ?work wdt:P31 ?type .
  OPTIONAL { ?work wdt:P577 ?d } OPTIONAL { ?work wdt:P580 ?d }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} GROUP BY ?work ?workLabel ?typeLabel ORDER BY ?date""",
    # MCU entries (series Q642878) with type, release date, IMDb id, every box-office value, and whether
    # MCU Tony Stark (Q23894967) is listed as a character or as RDJ's role. TV series are dropped in the build step.
    "mcu_films.csv": """
SELECT ?film ?title ?typeLabel ?date ?imdb ?box ?boxScopeLabel ?tony WHERE {
  ?film wdt:P179 wd:Q642878 .
  OPTIONAL { ?film rdfs:label ?en FILTER(lang(?en) = "en") }
  OPTIONAL { ?film rdfs:label ?mul FILTER(lang(?mul) = "mul") }
  BIND(COALESCE(?en, ?mul) AS ?title)  # many items now keep their English title only as the "mul" label
  OPTIONAL { ?film wdt:P31 ?type }
  OPTIONAL { ?film wdt:P577 ?date }
  OPTIONAL { ?film wdt:P345 ?imdb }
  OPTIONAL { ?film p:P2142 ?bst . ?bst ps:P2142 ?box . OPTIONAL { ?bst pq:P3005 ?boxScope } }
  BIND(EXISTS { ?film wdt:P674 wd:Q23894967 } || EXISTS { ?film p:P161 ?c . ?c ps:P161 wd:Q165524 ; pq:P453 wd:Q23894967 } AS ?tony)
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} ORDER BY ?date""",
    # Robert Downey Jr. (Q165524) filmography with the character he played.
    "rdj_filmography.csv": """
SELECT ?film ?title ?date ?imdb ?roleName WHERE {
  ?film p:P161 ?st . ?st ps:P161 wd:Q165524 .
  OPTIONAL { ?film rdfs:label ?en FILTER(lang(?en) = "en") }
  OPTIONAL { ?film rdfs:label ?mul FILTER(lang(?mul) = "mul") }
  BIND(COALESCE(?en, ?mul) AS ?title)  # many items now keep their English title only as the "mul" label
  OPTIONAL { ?st pq:P453 ?role .
    OPTIONAL { ?role rdfs:label ?ren FILTER(lang(?ren) = "en") }
    OPTIONAL { ?role rdfs:label ?rmul FILTER(lang(?rmul) = "mul") } }
  BIND(COALESCE(?ren, ?rmul) AS ?roleName)
  OPTIONAL { ?film wdt:P577 ?date }
  OPTIONAL { ?film wdt:P345 ?imdb }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} ORDER BY ?date""",
}


def fetch_wikidata():
    """Wikidata SPARQL exports (CC0)."""
    print("Wikidata")
    for name, query in SPARQL.items():
        out = RAW / "wikidata" / name
        if needed(out):
            save(out, get("https://query.wikidata.org/sparql", {"query": query}, accept="text/csv"))
            time.sleep(5)


# ---------------------------------------------------------------- IMDb
def fetch_imdb():
    """IMDb non-commercial ratings table. Large (~9 MB gz), so it is git-ignored and filtered in the build step."""
    print("IMDb ratings")
    out = RAW / "imdb" / "title.ratings.tsv.gz"
    if needed(out):
        save(out, get("https://datasets.imdbws.com/title.ratings.tsv.gz"))


# ---------------------------------------------------------------- Marvel Database (Fandom)
FANDOM_API = "https://marvel.fandom.com/api.php"
FANDOM_CATEGORIES = {
    "tony_stark_616": "Category:Anthony Stark (Earth-616)/Appearances",
    "victor_von_doom_616": "Category:Victor von Doom (Earth-616)/Appearances",
}


def keep_category(c):
    """Drop noise (places, species, letterers) but keep everything a chart might need."""
    c = c.removeprefix("Category:")
    return (
        c.endswith("Cover Date")
        or c.startswith("Comics Released in")
        or c.endswith("/Writer") or c.endswith("/Penciler")
        or c.endswith("/Appearances") and ("(Earth-616)" in c or "Armor" in c or "Avengers" in c)
        or " Vol " in c and "/" not in c
    )


def fetch_fandom():
    """Every comic issue in a Marvel Database appearance category, with that issue's categories (CC BY-SA 3.0)."""
    print("Marvel Database (marvel.fandom.com)")
    for key, cat in FANDOM_CATEGORIES.items():
        out = RAW / "marvel_fandom" / f"{key}_issues.json"
        if not needed(out):
            continue
        issues, params = {}, {
            "action": "query", "format": "json", "generator": "categorymembers", "gcmtitle": cat,
            "gcmnamespace": 0, "gcmlimit": 50, "prop": "categories", "cllimit": "max",
        }
        cont, n = {}, 0
        while True:
            data = json.loads(get(FANDOM_API, {**params, **cont}))
            for p in data.get("query", {}).get("pages", {}).values():
                rec = issues.setdefault(p["title"], [])
                rec += [c["title"].removeprefix("Category:") for c in p.get("categories", []) if keep_category(c["title"])]
            n += 1
            if n % 10 == 0:
                print(f"  {key}: {len(issues)} issues after {n} requests")
            if "continue" not in data:
                break
            cont = data["continue"]
            time.sleep(0.35)  # be polite to the wiki
        payload = {"source": f"https://marvel.fandom.com/wiki/{cat.replace(' ', '_')}", "fetched": time.strftime("%Y-%m-%d"),
                   "issues": [{"title": t, "categories": sorted(set(cs))} for t, cs in sorted(issues.items())]}
        save(out, json.dumps(payload, ensure_ascii=False, indent=0).encode("utf-8"))


def fetch_armor_pages():
    """Wikitext of every page in Category:Iron Man Armor (all realities; the build step filters), CC BY-SA 3.0,
    plus each armor's appearance count (size of its "<page>/Appearances" category).
    About 272 pages: one list request, then batches of 50. Runs offline, never in the browser."""
    print("Marvel Database armor pages")
    out = RAW / "marvel_fandom" / "iron_man_armor_pages.json"
    if not needed(out):
        return
    titles, cont = [], {}
    while True:
        data = json.loads(get(FANDOM_API, {"action": "query", "format": "json", "list": "categorymembers",
                                           "cmtitle": "Category:Iron Man Armor", "cmnamespace": 0, "cmlimit": 500, **cont}))
        titles += [m["title"] for m in data["query"]["categorymembers"]]
        if "continue" not in data:
            break
        cont = data["continue"]
        time.sleep(0.35)
    pages = {}
    for i in range(0, len(titles), 50):
        data = json.loads(get(FANDOM_API, {"action": "query", "format": "json", "formatversion": 2, "prop": "revisions",
                                           "rvprop": "content", "rvslots": "main", "titles": "|".join(titles[i:i + 50])}))
        for p in data["query"]["pages"]:
            if "revisions" in p:
                pages[p["title"]] = p["revisions"][0]["slots"]["main"]["content"]
        time.sleep(0.35)  # be polite to the wiki
    counts, names = {}, sorted(pages)
    for i in range(0, len(names), 50):
        cats = [f"Category:{t}/Appearances" for t in names[i:i + 50]]
        data = json.loads(get(FANDOM_API, {"action": "query", "format": "json", "formatversion": 2,
                                           "prop": "categoryinfo", "titles": "|".join(cats)}))
        for p in data["query"]["pages"]:
            counts[p["title"].removeprefix("Category:").removesuffix("/Appearances")] = p.get("categoryinfo", {}).get("pages", 0)
        time.sleep(0.35)
    payload = {"source": "https://marvel.fandom.com/wiki/Category:Iron_Man_Armor", "fetched": time.strftime("%Y-%m-%d"),
               "pages": [{"title": t, "appearances": counts.get(t, 0), "wikitext": pages[t]} for t in names]}
    save(out, json.dumps(payload, ensure_ascii=False, indent=0).encode("utf-8"))


def fandom_query(params):
    """One MediaWiki query, following `continue` until the result is complete. Yields each response."""
    cont = {}
    while True:
        data = json.loads(get(FANDOM_API, {"action": "query", "format": "json", "formatversion": 2, **params, **cont}))
        yield data
        if "continue" not in data:
            return
        cont = data["continue"]
        time.sleep(0.35)  # be polite to the wiki


def fetch_variants():
    """Every Tony Stark variant in the Marvel Database (CC BY-SA 3.0): each page titled "Anthony Stark (...)",
    plus the page a redirect of that form points to (Earth-1610's Tony is filed as "Antonio Stark (Earth-1610)").
    Per variant: the page wikitext, and the members of its "/Appearances" and "/Minor Appearances" categories.
    Per appearance page: its date and medium categories (the ones without a "/"), which give the year.
    Issues already in tony_stark_616_issues.json are not fetched twice; the build step reads their dates from there.
    About 950 pages and a few thousand appearance pages, so this takes a while. A checkpoint lets it resume."""
    print("Marvel Database Tony Stark variants")
    out = RAW / "marvel_fandom" / "tony_variants.json"
    if not needed(out):
        return
    part = out.with_suffix(".partial.json")
    state = json.loads(part.read_text(encoding="utf-8")) if part.exists() and not FORCE else {}

    def checkpoint():
        part.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")

    # 1. page titles (sub-pages such as "/Gallery" are not characters)
    if "titles" not in state:
        titles = []
        for data in fandom_query({"list": "allpages", "apprefix": "Anthony Stark (", "apnamespace": 0, "aplimit": 500}):
            titles += [p["title"] for p in data["query"]["allpages"] if "/" not in p["title"]]
        state["titles"] = sorted(set(titles))
        checkpoint()
    titles = state["titles"]
    print(f"  {len(titles)} page titles")

    # 2. wikitext, following redirects
    if "pages" not in state:
        pages, redirects = {}, {}
        for i in range(0, len(titles), 50):
            for data in fandom_query({"prop": "revisions", "rvprop": "content", "rvslots": "main", "redirects": 1,
                                      "titles": "|".join(titles[i:i + 50])}):
                for r in data["query"].get("redirects", []):
                    redirects[r["from"]] = r["to"]
                for p in data["query"]["pages"]:
                    if "revisions" in p:
                        pages[p["title"]] = p["revisions"][0]["slots"]["main"]["content"]
            print(f"  wikitext {min(i + 50, len(titles))}/{len(titles)}")
            time.sleep(0.35)
        state["pages"], state["redirects"] = pages, redirects
        checkpoint()
    pages, redirects = state["pages"], state["redirects"]

    # 3. which appearance categories exist, then their members
    kinds = ("Appearances", "Minor Appearances")
    if "members" not in state:
        names, sizes = sorted(pages), {}
        cats = [f"Category:{t}/{k}" for t in names for k in kinds]
        for i in range(0, len(cats), 50):
            for data in fandom_query({"prop": "categoryinfo", "titles": "|".join(cats[i:i + 50])}):
                for p in data["query"]["pages"]:
                    if p.get("categoryinfo", {}).get("pages"):
                        sizes[p["title"]] = p["categoryinfo"]["pages"]
            time.sleep(0.35)
        print(f"  {len(sizes)} appearance categories with pages")
        members = {}
        for n, cat in enumerate(sorted(sizes)):
            got = []
            for data in fandom_query({"list": "categorymembers", "cmtitle": cat, "cmnamespace": 0, "cmlimit": 500}):
                got += [m["title"] for m in data["query"]["categorymembers"]]
            members[cat.removeprefix("Category:")] = got
            if n % 50 == 49:
                print(f"  members {n + 1}/{len(sizes)}")
            time.sleep(0.35)
        state["members"] = members
        checkpoint()
    members = state["members"]

    # 4. date and medium categories of every appearance page not already in the Earth-616 issue file
    known = set()
    main_file = RAW / "marvel_fandom" / "tony_stark_616_issues.json"
    if main_file.exists():
        known = {i["title"] for i in json.loads(main_file.read_text(encoding="utf-8"))["issues"]}
    dated = state.setdefault("dated", {})
    todo = sorted({t for ms in members.values() for t in ms} - known - set(dated))
    print(f"  {len(todo)} appearance pages to date ({len(dated)} done)")
    for i in range(0, len(todo), 50):
        batch = todo[i:i + 50]
        got = {t: [] for t in batch}
        for data in fandom_query({"prop": "categories", "cllimit": "max", "titles": "|".join(batch)}):
            for p in data["query"]["pages"]:
                got.setdefault(p["title"], [])
                got[p["title"]] += [c["title"].removeprefix("Category:") for c in p.get("categories", []) if "/" not in c["title"]]
        dated.update({t: sorted(set(cs)) for t, cs in got.items()})
        if (i // 50) % 10 == 9:
            print(f"  dated {i + len(batch)}/{len(todo)}")
            checkpoint()
        time.sleep(0.35)
    checkpoint()

    target = {v: k for k, v in redirects.items()}
    payload = {
        "source": "https://marvel.fandom.com/wiki/Special:PrefixIndex?prefix=Anthony+Stark+(",
        "fetched": time.strftime("%Y-%m-%d"),
        "variants": [{"title": t, "redirect_from": target.get(t, ""), "wikitext": pages[t],
                      "appearances": members.get(f"{t}/Appearances", []),
                      "minor_appearances": members.get(f"{t}/Minor Appearances", [])} for t in sorted(pages)],
        "appearance_pages": {t: dated[t] for t in sorted(dated)},
    }
    save(out, json.dumps(payload, ensure_ascii=False, indent=0).encode("utf-8"))
    part.unlink(missing_ok=True)


SOURCES = {"fivethirtyeight": fetch_fivethirtyeight, "wikidata": fetch_wikidata, "imdb": fetch_imdb, "fandom": fetch_fandom,
           "armor": fetch_armor_pages, "variants": fetch_variants}

if __name__ == "__main__":
    picked = [a for a in sys.argv[1:] if not a.startswith("--")] or list(SOURCES)
    for name in picked:
        SOURCES[name]()
    print("done")
