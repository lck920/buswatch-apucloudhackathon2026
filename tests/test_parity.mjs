// Simulator parity test: re-simulate every day/route/stop with web/js/simulation.js
// and check boarded, left_behind and avg_wait_minutes match data/output/demand.csv.
//
//   node tests/test_parity.mjs
import { readFileSync } from "node:fs";
import { scenarioDepartures, busesPerSlot, stopOffsets, simulateQueue, simulateRoute, roundHalfUp, toMinutes } from "../web/js/simulation.js";

const root = new URL("..", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("web/data/meta.json", root)));
const lines = readFileSync(new URL("data/output/demand.csv", root), "utf8").trim().split(/\r?\n/);
const header = lines[0].split(",");
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const rows = lines.slice(1).map((l) => l.split(","));

const start = toMinutes(meta.service_start);
const nSlots = meta.time_slots.length;
const groups = new Map();
for (const r of rows) {
  const key = `${r[col.date]}|${r[col.route]}|${r[col.stop]}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

let checked = 0, mismatches = 0;
for (const [key, g] of groups) {
  const [, routeName, stop] = key.split("|");
  const route = meta.routes[routeName];
  const k = route.stops.indexOf(stop);
  const deps = scenarioDepartures(meta, routeName, {}, g[0][col.day_of_week]);
  const buses = busesPerSlot(deps, stopOffsets(route.minutes_between)[k], start, meta.slot_minutes, nSlots);
  const seats = roundHalfUp(meta.bus_seats * route.seats_free[k]);
  const sim = simulateQueue(g.map((r) => +r[col.new_arrivals]), buses, seats,
    meta.queue.give_up_share, meta.slot_minutes, meta.queue.max_headway, meta.queue.max_wait);
  sim.forEach((s, i) => {
    checked++;
    const r = g[i];
    for (const f of ["students_waiting", "buses_arrived", "total_capacity", "boarded", "left_behind", "missed_bus", "avg_wait_minutes"]) {
      if (s[f] !== +r[col[f]]) {
        if (mismatches++ < 5) console.error(`Mismatch ${key} ${r[col.time_slot]} ${f}: js=${s[f]} csv=${r[col[f]]}`);
      }
    }
  });
}
if (mismatches) { console.error(`FAIL: ${mismatches} mismatches in ${checked} slots`); process.exit(1); }

// The route-level helper must reproduce the CSV totals too
const asRows = rows.map((r) => ({ date: r[col.date], day_of_week: r[col.day_of_week], route: r[col.route], stop: r[col.stop],
  slot: meta.time_slots.indexOf(r[col.time_slot]), new_arrivals: +r[col.new_arrivals] }));
for (const routeName of Object.keys(meta.routes)) {
  const res = simulateRoute(meta, asRows, routeName);
  const csvLeft = rows.filter((r) => r[col.route] === routeName).reduce((a, r) => a + +r[col.left_behind], 0);
  if (res.leftBehind !== csvLeft) { console.error(`FAIL: ${routeName} total left ${res.leftBehind} vs ${csvLeft}`); process.exit(1); }
}
console.log(`OK: ${checked.toLocaleString()} slots match demand.csv exactly (boarded, left_behind, avg_wait)`);
