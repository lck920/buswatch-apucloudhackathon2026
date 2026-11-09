// BusWatch queue engine: a line-for-line port of utils/simulation.py.
// If you change a formula in one file, change it in the other.
// tests/test_parity.mjs re-simulates every day/route/stop and compares with demand.csv.

export const roundHalfUp = (x) => Math.floor(x + 0.5);
export const round1 = (x) => Math.floor(x * 10 + 0.5) / 10;

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function toHHMM(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// First-stop departure times; the frequency in force at a departure decides the next one.
export function departureTimes(baseFrequency, overrides, serviceStart, serviceEnd) {
  const deps = [];
  let t = serviceStart;
  while (t < serviceEnd) {
    deps.push(t);
    let freq = baseFrequency;
    for (const o of overrides) if (o.start <= t && t < o.end) freq = o.frequency;
    t += freq;
  }
  return deps;
}

export function stopOffsets(minutesBetween) {
  let total = 0;
  return minutesBetween.map((m) => (total += m));
}

export function busesPerSlot(departures, offset, serviceStart, slotMinutes, numSlots) {
  const counts = new Array(numSlots).fill(0);
  for (const d of departures) {
    const slot = Math.floor((d + offset - serviceStart) / slotMinutes);
    if (slot >= 0 && slot < numSlots) counts[slot] += 1;
  }
  return counts;
}

export function simulateQueue(newArrivals, buses, seatsPerBus, giveUpShare, slotMinutes, maxHeadway, maxWait) {
  const n = newArrivals.length;
  const out = [];
  let carry = 0, carryMissed = 0;   // still waiting / of whom already saw a full bus leave
  const half = Math.floor(60 / slotMinutes / 2);
  for (let i = 0; i < n; i++) {
    const waiting = carry + newArrivals[i];
    const capacity = buses[i] * seatsPerBus;
    const boarded = Math.min(waiting, capacity);
    // No bus this slot: nobody is left behind, they keep waiting.
    // Otherwise count students left behind for the FIRST time (repeat-missers board first).
    const left = buses[i] === 0 ? 0 : waiting - boarded;
    const missed = buses[i] === 0 ? 0 : left - Math.max(0, carryMissed - capacity);

    // Headway from the slots with a bus in the surrounding hour;
    // two buses doubling up on one departure add seats, not frequency
    const lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half - 1);
    const windowSlots = hi - lo + 1;
    let count = 0;
    for (let j = lo; j <= hi; j++) count += buses[j] > 0 ? 1 : 0;
    const headway = count === 0 ? maxHeadway : Math.min(maxHeadway, (slotMinutes * windowSlots) / count);

    let wait;
    if (waiting === 0) wait = 0;
    else wait = Math.min(maxWait, headway / 2 + headway * (left / waiting));

    out.push({
      students_waiting: waiting, buses_arrived: buses[i], total_capacity: capacity,
      boarded, left_behind: left, missed_bus: missed, avg_wait_minutes: round1(wait),
    });
    if (buses[i] === 0) carry = waiting;
    else carryMissed = carry = left - roundHalfUp(left * giveUpShare);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scenario helpers for the What-If simulator (browser only)
// ---------------------------------------------------------------------------

// Place `count` extra buses on the hour's :00 / :30 departures (a 3rd bus doubles up on :00 again),
// so the timetable keeps its 30-minute pattern and extra buses simply double up.
const evenlyInHour = (start, count) => Array.from({ length: count }, (_, i) => start + (i % 2) * 30);

/**
 * Departures for a route on one day under a scenario.
 * scenario = { baseFrequency, keepOverrides, extra: {start, end, perHour}, move: {fromHour, toHour, count} }
 * (start/end "HH:MM", hours are integers like 14)
 * baseFrequency / keepOverrides change the weekday timetable only; Sat/Sun use route.weekend_frequency
 * (null = no service). extra and move apply on any day that has a service.
 */
export function scenarioDepartures(meta, routeName, scenario = {}, day = "Mon") {
  const route = meta.routes[routeName];
  const start = toMinutes(meta.service_start), end = toMinutes(meta.service_end);
  let deps;
  if (day in route.weekend_frequency) {
    const f = route.weekend_frequency[day];
    if (!f) return [];
    deps = departureTimes(f, [], start, end);
  } else {
    const keep = scenario.keepOverrides ?? true;
    const overrides = keep
      ? route.frequency_overrides.map((o) => ({ start: toMinutes(o.start), end: toMinutes(o.end), frequency: o.frequency }))
      : [];
    deps = departureTimes(scenario.baseFrequency ?? route.base_frequency, overrides, start, end);
  }

  const extra = scenario.extra;
  if (extra && extra.perHour > 0) {
    for (let h = toMinutes(extra.start); h < toMinutes(extra.end); h += 60) {
      for (const t of evenlyInHour(h, extra.perHour)) if (t < toMinutes(extra.end) && t < end) deps.push(t);
    }
  }

  const move = scenario.move;
  if (move && move.count > 0 && move.fromHour !== move.toHour) {
    const inFrom = deps.filter((d) => d >= move.fromHour * 60 && d < move.fromHour * 60 + 60).sort((a, b) => a - b);
    const k = Math.min(move.count, inFrom.length);
    // Remove k buses spread across the hour (keeps the remaining gaps even-ish)
    const remove = new Set(Array.from({ length: k }, (_, i) => inFrom[Math.floor(((i + 0.5) * inFrom.length) / k)]));
    deps = deps.filter((d) => !remove.has(d));
    for (const t of evenlyInHour(move.toHour * 60, k)) if (t >= start && t < end) deps.push(t);
  }
  return deps.sort((a, b) => a - b);
}

/** Buses needed at once: the most trips overlapping (each ties up a bus for round_trip_minutes). */
export function peakBuses(departures, roundTrip) {
  let peak = 0;
  for (const t of departures) peak = Math.max(peak, departures.filter((d) => d <= t && d > t - roundTrip).length);
  return peak;   // ponytail: O(n^2), n is ~150 trips a day
}

/**
 * Replay demand for one route under a scenario (each day uses its own Mon-Fri / Sat / Sun timetable).
 * rows: demand rows (any dates) - only this route's rows are used.
 * Returns totals, cost figures, and per-slot left-behind (averaged per day).
 */
export function simulateRoute(meta, rows, routeName, scenario = {}) {
  const route = meta.routes[routeName];
  const start = toMinutes(meta.service_start);
  const numSlots = meta.time_slots.length;
  const q = meta.queue;
  const offsets = stopOffsets(route.minutes_between);

  // Group new_arrivals by (date, stop) into 48-slot arrays
  const groups = new Map();
  for (const r of rows) {
    if (r.route !== routeName) continue;
    const key = r.date + "|" + r.stop;
    if (!groups.has(key)) groups.set(key, { stop: r.stop, day: r.day_of_week, arr: new Array(numSlots).fill(0) });
    groups.get(key).arr[r.slot] = r.new_arrivals;
  }

  // Timetable per weekday name, computed once
  const supply = {};
  const supplyFor = (day) => (supply[day] ??= (() => {
    const deps = scenarioDepartures(meta, routeName, scenario, day);
    const perStop = {};
    route.stops.forEach((stop, k) => {
      perStop[stop] = {
        buses: busesPerSlot(deps, offsets[k], start, meta.slot_minutes, numSlots),
        seats: roundHalfUp(meta.bus_seats * route.seats_free[k]),
      };
    });
    return { deps, perStop };
  })());

  const t = { waiting: 0, boarded: 0, left: 0, missed: 0, capacity: 0, waitWeighted: 0, new: 0 };
  const leftBySlot = new Array(numSlots).fill(0), missedBySlot = new Array(numSlots).fill(0);
  const dates = new Map();   // date -> weekday name
  for (const [key, g] of groups) {
    dates.set(key.split("|")[0], g.day);
    const s = supplyFor(g.day).perStop[g.stop];
    if (!s) continue;
    const sim = simulateQueue(g.arr, s.buses, s.seats, q.give_up_share, meta.slot_minutes, q.max_headway, q.max_wait);
    sim.forEach((x, i) => {
      t.waiting += x.students_waiting;
      t.boarded += x.boarded;
      t.left += x.left_behind;
      t.missed += x.missed_bus;
      missedBySlot[i] += x.missed_bus;
      t.capacity += x.total_capacity;
      t.waitWeighted += x.avg_wait_minutes * x.students_waiting;
      t.new += g.arr[i];
      leftBySlot[i] += x.left_behind;
    });
  }
  const days = Math.max(1, dates.size);
  // Cost: trips per day, bus-hours (trips x round trip), money, and buses needed at the busiest moment
  const dayList = [...dates.values()];
  const tripsPerDay = dayList.reduce((a, d) => a + supplyFor(d).deps.length, 0) / days;
  const busHoursPerDay = (tripsPerDay * route.round_trip_minutes) / 60;
  return {
    days: dates.size,
    avgWait: t.waiting ? t.waitWeighted / t.waiting : 0,
    leftBehind: t.left,
    leftBehindPerDay: t.left / days,
    missedPerDay: t.missed / days,
    boardedPerDay: t.boarded / days,
    utilisation: t.capacity ? t.boarded / t.capacity : 0,
    tripsPerDay,
    busHoursPerDay,
    costPerDay: busHoursPerDay * meta.cost_per_bus_hour,
    peakBuses: Math.max(0, ...[...new Set(dayList)].map((d) => peakBuses(supplyFor(d).deps, route.round_trip_minutes))),
    leftBySlot: leftBySlot.map((v) => v / days),
    missedBySlot: missedBySlot.map((v) => v / days),
  };
}
