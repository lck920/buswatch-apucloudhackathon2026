// Rule-based recommendations (no AI). For each overloaded window we test, in the queue simulator:
//   1. moving buses from an under-used hour on the same route (no extra cost),
//   2. a policy change: removing a reduced-service window (e.g. staggering driver lunch breaks),
//   3. if neither is possible, adding buses.
// Every option carries its cost (trips, bus-hours, RM, peak buses) next to its benefit.
import { scenarioDepartures, simulateRoute, stopOffsets, toHHMM, toMinutes } from "./simulation.js";
import { perSlotPerDay, hourLabel } from "./stats.js";

/** Day groups that share a timetable, e.g. Mon/Wed, Tue/Thu, Fri, Sat, plus any day with no classes (Sun). */
export function dayGroups(meta) {
  const groups = Object.entries(meta.day_patterns).map(([name, days]) => ({ name, days }));
  const covered = groups.flatMap((g) => g.days);
  return [...groups, ...meta.days.filter((d) => !covered.includes(d)).map((d) => ({ name: d, days: [d] }))];
}

const slotStart = (meta, i) => toMinutes(meta.service_start) + i * meta.slot_minutes;
export const windowLabel = (meta, w) =>
  `${toHHMM(slotStart(meta, w.startSlot))}–${toHHMM(slotStart(meta, w.endSlot + 1))}`;

/** Normal-week rows (falls back to all rows if the date filter only covers exam week). */
const normalRows = (rows) => {
  const n = rows.filter((r) => !r.is_exam_week);
  return n.length ? n : rows;
};

/**
 * Overloaded windows: route + day group + run of consecutive slots where the average
 * number of students per day who miss a full bus (summed over the route's stops) is above the threshold.
 */
export function findOverloadedWindows(meta, rows) {
  const use = normalRows(rows);
  const out = [];
  for (const route of Object.keys(meta.routes)) {
    for (const g of dayGroups(meta)) {
      const rs = use.filter((r) => r.route === route && g.days.includes(r.day_of_week));
      if (!rs.length) continue;
      const left = perSlotPerDay(rs, meta, "missed_bus");
      const over = (j) => j < left.length && left[j] >= meta.thresholds.overload_missed;
      let i = 0;
      while (i < left.length) {
        if (!over(i)) { i++; continue; }
        const startSlot = i;
        // extend the run; a single quieter slot between two overloaded ones doesn't split the window
        while (over(i + 1) || over(i + 2)) i += over(i + 1) ? 1 : 2;
        const run = left.slice(startSlot, i + 1);
        out.push({ route, group: g.name, days: g.days, startSlot, endSlot: i,
          missedPerDay: run.reduce((a, b) => a + b, 0), avgPerSlot: run.reduce((a, b) => a + b, 0) / run.length, rows: rs });
        i++;
      }
    }
  }
  return out.sort((a, b) => b.missedPerDay - a.missedPerDay);   // ranked by students per day who miss a full bus in the window
}

/** Hours on a route where under half the seats are used, with at least 2 buses to spare one. */
export function underusedHours(meta, rows, route, excludeHours = [], day = "Mon") {
  const deps = scenarioDepartures(meta, route, {}, day);
  const start = toMinutes(meta.service_start), end = toMinutes(meta.service_end);
  const out = [];
  for (let h = start / 60; h < end / 60; h++) {
    if (excludeHours.includes(h)) continue;
    const rs = rows.filter((r) => Math.floor(toMinutes(r.time_slot) / 60) === h);
    const cap = rs.reduce((a, r) => a + r.total_capacity, 0);
    const util = cap ? rs.reduce((a, r) => a + r.boarded, 0) / cap : 1;
    const buses = deps.filter((d) => d >= h * 60 && d < h * 60 + 60).length;
    if (util < meta.thresholds.underused_utilisation && buses >= 2) out.push({ hour: h, util, buses });
  }
  return out.sort((a, b) => a.util - b.util);
}

const pctText = (x) => `${Math.round(x * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "es"}`;
const signed = (v, digits = 0) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;

/** One-line cost of going from `before` to `after` (both from simulateRoute). */
export function costText(before, after) {
  const trips = after.tripsPerDay - before.tripsPerDay;
  const peak = after.peakBuses - before.peakBuses;
  const fleet = peak ? `${signed(peak)} bus${Math.abs(peak) === 1 ? "" : "es"} needed at the busiest moment` : "same fleet";
  if (Math.abs(trips) < 0.05) return peak ? `same trips and bus-hours, but ${fleet}.` : "none (same trips, bus-hours and fleet).";
  return `${signed(trips)} trips/day, ${signed(after.busHoursPerDay - before.busHoursPerDay, 1)} bus-hours/day ` +
    `(${signed(after.costPerDay - before.costPerDay)} RM/day), ${fleet}.`;
}

/**
 * Top recommendations, each tested in the simulator.
 * Returns [{route, group, days, window, missedPerDay, problem, before, options: [{action, text, scenario, after, cost}],
 *           plus the best option's action / sentence / scenario / after}]
 */
export function buildRecommendations(meta, rows, { limit = 3 } = {}) {
  const recs = [];
  const seen = new Set();
  for (const w of findOverloadedWindows(meta, rows)) {
    if (recs.length >= limit) break;
    const key = w.route + w.group;
    if (seen.has(key)) continue;   // one suggestion per route + day group keeps the list varied
    seen.add(key);

    const route = meta.routes[w.route];
    const before = simulateRoute(meta, w.rows, w.route);
    const day = w.days[0];
    const weekend = day in route.weekend_frequency;

    // Departure hours that feed the window (buses take up to maxOffset minutes to reach a stop)
    const maxOffset = Math.max(...stopOffsets(route.minutes_between));
    const winStart = slotStart(meta, w.startSlot), winEnd = slotStart(meta, w.endSlot + 1);
    const toHours = [];
    for (let h = Math.floor((winStart - maxOffset) / 60); h <= Math.floor((winEnd - 1) / 60); h++) toHours.push(h);
    const options = [];
    // text = full sentence (report), short = a few words for the cards
    const add = (action, text, scenario, short) => {
      const after = simulateRoute(meta, w.rows, w.route, scenario);
      if (after.missedPerDay < before.missedPerDay - 0.5) options.push({ action, text, short, scenario, after, cost: costText(before, after) });
    };

    // 1. Move 1-3 buses from the emptiest hours into the window (no extra cost); keep the best
    const exclude = [...toHours, toHours[0] - 1, toHours[toHours.length - 1] + 1];
    let best = null;
    for (const from of underusedHours(meta, w.rows, w.route, exclude, day).slice(0, 3)) {
      for (const toHour of toHours) {
        for (let k = 1; k <= Math.min(3, from.buses - 1); k++) {
          const scenario = { move: { fromHour: from.hour, toHour, count: k } };
          const left = simulateRoute(meta, w.rows, w.route, scenario).missedPerDay;
          if (left < before.missedPerDay - 0.5 && (!best || left < best.left)) best = { left, scenario, from, toHour, k };
        }
      }
    }
    if (best) add("move", `Move ${plural(best.k, "bus")} from the ${hourLabel(best.from.hour)} hour, which is ` +
      `${pctText(1 - best.from.util)} empty, to double up the ${hourLabel(best.toHour)} departure${best.k > 1 ? "s" : ""}.`, best.scenario,
      `Move ${plural(best.k, "bus")}: ${hourLabel(best.from.hour)} → ${hourLabel(best.toHour)}`);

    // 2. Policy: a reduced-service window (weekday only) that overlaps the hours feeding the overload
    const o = weekend ? null : route.frequency_overrides.find((x) =>
      toMinutes(x.start) < winEnd && toMinutes(x.end) > winStart - maxOffset);
    if (o) add("policy", `Stagger the ${o.reason.toLowerCase()} so ${w.route} keeps a bus every ${route.base_frequency} min ` +
      `from ${o.start} to ${o.end} instead of every ${o.frequency} min.`, { keepOverrides: false },
      `Stagger ${o.reason.toLowerCase()}: keep every ${route.base_frequency} min ${o.start}–${o.end}`);

    // 3. Allocate extra peak buses: a second bus on every :00 / :30 departure feeding the window
    const extra = { start: hourLabel(toHours[0]), end: hourLabel(toHours[toHours.length - 1] + 1), perHour: 2 };
    add("add", `Run a second bus on every departure from ${extra.start} to ${extra.end}.`, { extra },
      `2nd bus on each departure ${extra.start}–${extra.end}`);
    if (!options.length) continue;
    options.sort((a, b) => a.after.missedPerDay - b.after.missedPerDay);   // biggest benefit first

    const label = windowLabel(meta, w);
    const problem = `${w.route} is overloaded ${w.group} ${label} (≈ ${Math.round(w.missedPerDay)} students a day miss a full bus).`;
    const top = options[0];
    recs.push({ route: w.route, group: w.group, days: w.days, window: label, missedPerDay: w.missedPerDay, problem,
      before, options, applyDays: w.group, action: top.action, scenario: top.scenario, after: top.after,
      sentence: `${problem} ${top.text}` });
  }
  return recs;
}
