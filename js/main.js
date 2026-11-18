// Entry point. Starts the scroll reactor right away, then mounts each view only when its section
// is about to scroll into view (core/lazy.js). To add a view: write js/views/<name>.js exporting a
// mount function, give its section an id in index.html, and register it below.
import { loadComicsByYear, loadFilms, loadSuits } from "./core/data.js";
import { mountWhenNear } from "./core/lazy.js";
import { initScrollReactor } from "./core/scrollReactor.js";
import { selectSuit } from "./core/selection.js";
import { comicsSpecRows, fillStat, initCountdown, renderSpec, suitSpecRows } from "./views/storyStats.js";

const $ = sel => document.querySelector(sel);

initScrollReactor();
initCountdown($("#days"), $("#daysLbl"));

// hero numbers
loadSuits().then(suits => fillStat("suits", suits.length));
loadFilms().then(films => fillStat("tonyFilms", films.filter(f => f.asTony && f.date && f.date <= new Date()).length));
loadComicsByYear().then(rows => fillStat("comicIssues", d3.sum(rows, d => d.issues).toLocaleString("en-US")));

// Chapter 1 · comics
mountWhenNear("#comics", async () => {
  const [{ mountComicsByYear }, rows] = await Promise.all([import("./views/comicsByYear.js"), loadComicsByYear()]);
  renderSpec($("#comicsSpec"), comicsSpecRows(rows));
  mountComicsByYear({ svg: $("#comicsChart"), box: $("#comicsBox"), tip: $("#comicsTip"), legend: $("#comicsLegend"), rows });
});

// Chapter 2 · Mark I
mountWhenNear("#mk1Spec", async () => {
  const suits = await loadSuits();
  renderSpec($("#mk1Spec"), suitSpecRows(suits.find(s => s.mark === 1), suits.length));
});

// Chapter 3 · Hall of Armor
mountWhenNear("#hall", async () => {
  const [{ mountArmorReactor }, suits] = await Promise.all([import("./views/armorReactor.js"), loadSuits()]);
  mountArmorReactor({ svg: $("#reactorChart"), legend: $("#eraLegend"), panel: $("#suitPanel"), suits });
  selectSuit(suits.find(s => s.mark === 42));
});

// Chapter 4 · suit timeline + box office
mountWhenNear("#surge", async () => {
  const [{ mountSuitTimeline }, suits, films] = await Promise.all([import("./views/suitTimeline.js"), loadSuits(), loadFilms()]);
  mountSuitTimeline({ svg: $("#timeline"), box: $("#timelineBox"), tip: $("#timelineTip"), suits, films });
});

// Chapter 6 · the snap
mountWhenNear("#snap", async () => {
  const { mountSnapExplode } = await import("./views/snapExplode.js");
  await mountSnapExplode({ stage: $("#snapStage"), keys: $("#snapKeys"), src: "assets/img/endgame-snap-1920.webp" });
});
mountWhenNear("#mk85Spec", async () => {
  const suits = await loadSuits();
  renderSpec($("#mk85Spec"), suitSpecRows(suits.find(s => s.mark === 85), suits.length));
});
