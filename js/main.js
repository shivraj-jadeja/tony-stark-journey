// Entry point. Starts the scroll reactor right away, then mounts each view only when its section
// is about to scroll into view (core/lazy.js). To add a view: write js/views/<name>.js exporting a
// mount function, give its section an id in index.html, and register it below.
import { loadArmors, loadComicsByYear, loadFilms, loadSuits, loadVariants } from "./core/data.js";
import { mountWhenNear, whenIdle } from "./core/lazy.js";
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

// Chapter 3 · Hall of Armor: Armory Rings (opens on Mark 42, shared with the timeline)
mountWhenNear("#hall", async () => {
  const [{ mountArmoryRings }, armors, suits] = await Promise.all([import("./views/armoryRings.js"), loadArmors(), loadSuits()]);
  mountArmoryRings({ svg: $("#armoryChart"), panel: $("#suitPanel"), soundButton: $("#gearSound"), armors, suits });
  selectSuit(suits.find(s => s.mark === 42));
});

// Chapter 4 · suit timeline + box office
mountWhenNear("#surge", async () => {
  const [{ mountSuitTimeline }, suits, films] = await Promise.all([import("./views/suitTimeline.js"), loadSuits(), loadFilms()]);
  mountSuitTimeline({ svg: $("#timeline"), box: $("#timelineBox"), tip: $("#timelineTip"), suits, films });
});

// The thread river and Chapter 5 · Temporal Loom share one model of the variants (core/loomLayout.js).
// The river starts once the first paint is done; the loom chart mounts when its section is near.
const loom = Promise.all([import("./core/loomLayout.js"), loadVariants()])
  .then(([{ buildLoomModel, tintOf }, variants]) => {
    const model = buildLoomModel(variants);
    return { model, tints: model.lanes.map(l => tintOf(l.name)), fetched: variants.fetched };
  });
loom.then(({ model, fetched }) => {
  fillStat("variants", model.total.toLocaleString("en-US"));
  if (fetched) fillStat("variantsFetched", d3.utcFormat("%b %-d, %Y")(new Date(fetched)));
});
const river = new Promise(resolve => whenIdle(async () => {
  try {
    const [{ initThreadRiver }, { model, tints }] = await Promise.all([import("./core/threadRiver.js"), loom]);
    const flow = initThreadRiver({ canvas: $("#thread-river"), model, tints, start: $("[data-river-start]"), stage: $("#loomStage"), end: $("[data-river-end]") });
    if (new URLSearchParams(location.search).has("debug")) window.__river = flow;   // for profiling: __river.stats()
    resolve(flow);
  } catch (err) { console.error("[thread river]", err); resolve(null); }
}));
mountWhenNear("#loom", async () => {
  const [{ mountTemporalLoom }, { model }, flow] = await Promise.all([import("./views/temporalLoom.js"), loom, river]);
  mountTemporalLoom({ stage: $("#loomStage"), panel: $("#loomPanel"), tip: $("#loomTip"), search: $("#loomSearch"), options: $("#loomOptions"),
    quick: document.querySelectorAll(".loom-quick"), legend: $("#loomLegend"), lensBox: $("#loomLens"), lensNote: $("#loomLensNote"), model, river: flow });
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
