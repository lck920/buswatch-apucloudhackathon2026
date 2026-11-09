// Pure statistics over demand rows (no DOM). Used by every page and by Node tests.

export const sum = (arr, f) => arr.reduce((a, r) => a + f(r), 0);
export const uniqueDates = (rows) => new Set(rows.map((r) => r.date)).size;

/** Group rows by key(r) -> array of rows. */
export function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

/** Wait weighted by students (each waiting student counts once per slot). */
export const avgWait = (rows) => {
  const w = sum(rows, (r) => r.students_waiting);
  return w ? sum(rows, (r) => r.avg_wait_minutes * r.students_waiting) / w : 0;
};

export const utilisation = (rows) => {
  const cap = sum(rows, (r) => r.total_capacity);
  return cap ? sum(rows, (r) => r.boarded) / cap : 0;
};

/** Headline KPIs for a set of rows. */
export function kpis(rows) {
  const days = Math.max(1, uniqueDates(rows));
  const left = sum(rows, (r) => r.missed_bus);
  const byStop = [...groupBy(rows, (r) => r.stop)].map(([stop, rs]) => ({ stop, left: sum(rs, (r) => r.missed_bus) / days }))
    .sort((a, b) => b.left - a.left);
  const bySlot = [...groupBy(rows, (r) => r.time_slot)].map(([slot, rs]) => ({ slot, left: sum(rs, (r) => r.missed_bus) / days }))
    .sort((a, b) => b.left - a.left);
  return {
    days: uniqueDates(rows),
    avgWait: avgWait(rows),
    missedPerDay: left / days,                              // each student counted once
    boardedPerDay: sum(rows, (r) => r.boarded) / days,
    utilisation: utilisation(rows),
    worstStop: byStop[0],
    worstSlot: bySlot[0],
  };
}

/** load = students waiting / seats offered. Infinity when nobody can board. */
export function load(rows) {
  const cap = sum(rows, (r) => r.total_capacity);
  const w = sum(rows, (r) => r.students_waiting);
  return cap ? w / cap : w > 0 ? Infinity : 0;
}

/** stop x time-slot matrix of load values. */
export function heatmap(rows, meta) {
  const g = groupBy(rows, (r) => r.stop + "|" + r.slot);
  return meta.stops.map((stop) => meta.time_slots.map((_, i) => {
    const rs = g.get(stop + "|" + i);
    return rs ? load(rs) : null;
  }));
}

/** Per-slot average per day of a field (summed over the rows in each slot). */
export function perSlotPerDay(rows, meta, field) {
  const days = Math.max(1, uniqueDates(rows));
  const out = new Array(meta.time_slots.length).fill(0);
  for (const r of rows) out[r.slot] += (typeof field === "function" ? field(r) : r[field]);
  return out.map((v) => v / days);
}

/** The shuttle that runs between two stops (one shuttle per path), or undefined. */
export const shuttleBetween = (meta, a, b) =>
  Object.keys(meta.routes).find((r) => meta.routes[r].stops.includes(a) && meta.routes[r].stops.includes(b));
/** Stops you can reach from `from` by shuttle. */
export const destinations = (meta, from) => meta.stops.filter((s) => s !== from && shuttleBetween(meta, from, s));

export const routesForStop = (meta, stop) =>
  Object.keys(meta.routes).filter((r) => meta.routes[r].stops.includes(stop));

export const hourLabel = (h) => `${String(h).padStart(2, "0")}:00`;
