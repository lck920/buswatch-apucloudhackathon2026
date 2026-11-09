// Recommendations test: every suggested option must lower left-behind when run through the
// simulator, and a "move" must cost nothing extra.
//
//   node tests/test_recommendations.mjs
import { readFileSync } from "node:fs";
import { decodeDemand } from "../web/js/data.js";
import { buildRecommendations } from "../web/js/recommendations.js";
import { simulateRoute } from "../web/js/simulation.js";

const read = (f) => JSON.parse(readFileSync(new URL(`../web/data/${f}`, import.meta.url)));
const meta = read("meta.json");
const rows = decodeDemand(read("demand.json"));
const fail = (msg) => { console.error("FAIL:", msg); process.exit(1); };

const recs = buildRecommendations(meta, rows, { limit: 5 });
if (!recs.length) fail("no recommendations");
for (const r of recs) {
  console.log("-", r.problem);
  // Re-check every option independently on its own days
  const dayRows = rows.filter((x) => x.route === r.route && r.days.includes(x.day_of_week) && !x.is_exam_week);
  const before = simulateRoute(meta, dayRows, r.route);
  for (const o of r.options) {
    const after = simulateRoute(meta, dayRows, r.route, o.scenario);
    console.log(`    [${o.action}] ${o.text}\n      miss a full bus/day ${before.missedPerDay.toFixed(0)} -> ${after.missedPerDay.toFixed(0)} · ${o.cost}`);
    if (!(after.missedPerDay < before.missedPerDay)) fail(`${o.action} option does not cut missed buses`);
    if (o.action === "move" && after.tripsPerDay !== before.tripsPerDay) fail("a move changed the trip count");
    if (o.action !== "move" && !(after.costPerDay > before.costPerDay)) fail(`${o.action} option shows no extra cost`);
  }
}
if (!recs.some((r) => r.options.some((o) => o.action === "policy"))) fail("expected a policy option (reduced-service window)");
console.log(`OK: ${recs.length} recommendations, ${recs.reduce((a, r) => a + r.options.length, 0)} options, all cut the students who miss a full bus`);
