// Data loading for every page.
// 1. Ask /api/config (Vercel function) for the Supabase URL + anon key.
// 2. If that works, load tables from Supabase (1000 rows per request: PostgREST limit).
// 3. If anything fails (no config, bad Wi-Fi, local server), use the bundled JSON in data/.
// The result is cached in memory, so each page loads it once.

const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
const PAGE = 1000;

let dataPromise = null;
let clientPromise = null;

const withTimeout = (promise, ms, what) =>
  Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Supabase client, or null when Supabase isn't configured/reachable. */
export function getSupabase() {
  if (!clientPromise) {
    clientPromise = (async () => {
      try {
        const cfg = await withTimeout(fetchJSON("/api/config"), 4000, "config");
        if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return null;
        const { createClient } = await withTimeout(import(SUPABASE_CDN), 8000, "supabase-js");
        return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      } catch (e) {
        console.info("Supabase not available, using offline copy:", e.message);
        return null;
      }
    })();
  }
  return clientPromise;
}

/** Load every row of a table, 1000 at a time, in parallel. */
async function fetchAll(sb, table, columns, orderBy) {
  const { count, error } = await sb.from(table).select(orderBy, { count: "exact", head: true });
  if (error) throw error;
  const pages = [];
  for (let from = 0; from < count; from += PAGE) {
    pages.push(sb.from(table).select(columns).order(orderBy).range(from, from + PAGE - 1)
      .then(({ data, error }) => { if (error) throw error; return data; }));
  }
  return (await Promise.all(pages)).flat();
}

const DEMAND_COLS = "date,week,day_of_week,time_slot,stop,route,students_waiting,new_arrivals," +
  "buses_arrived,total_capacity,boarded,left_behind,missed_bus,avg_wait_minutes,is_rainy,is_exam_week,predicted_waiting";

async function loadFromSupabase(sb, meta) {
  const [demand, timetable, schedule, metricsRows] = await withTimeout(Promise.all([
    fetchAll(sb, "demand", DEMAND_COLS, "id"),
    fetchAll(sb, "timetable", "*", "class_id"),
    fetchAll(sb, "bus_schedule", "*", "id"),
    sb.from("model_metrics").select("metrics").eq("id", 1).then(({ data, error }) => { if (error) throw error; return data; }),
  ]), 20000, "Supabase load");
  if (!demand.length) throw new Error("Supabase demand table is empty");
  const slotIndex = Object.fromEntries(meta.time_slots.map((s, i) => [s, i]));
  const rows = demand.map((r) => ({ ...r, slot: slotIndex[r.time_slot] }));
  return { rows, timetable, schedule, metrics: metricsRows[0]?.metrics };
}

/** Decode the columnar demand.json into row objects. */
export function decodeDemand(d) {
  const R = d.rows, D = d.dates, n = R.date.length;
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    const di = R.date[i];
    rows[i] = {
      date: D.date[di], week: D.week[di], day_of_week: D.day_of_week[di],
      is_rainy: D.is_rainy[di], is_exam_week: D.is_exam_week[di],
      slot: R.slot[i], time_slot: d.time_slots[R.slot[i]],
      stop: d.stops[R.stop[i]], route: d.routes[R.route[i]],
      students_waiting: R.students_waiting[i], new_arrivals: R.new_arrivals[i],
      buses_arrived: R.buses_arrived[i], total_capacity: R.total_capacity[i],
      boarded: R.boarded[i], left_behind: R.left_behind[i], missed_bus: R.missed_bus[i],
      avg_wait_minutes: R.avg_wait_minutes[i], predicted_waiting: R.predicted_waiting[i],
    };
  }
  return rows;
}

async function loadOffline() {
  const [demand, timetable, schedule, metrics] = await Promise.all(
    ["demand", "timetable", "bus_schedule", "metrics"].map((f) => fetchJSON(`data/${f}.json`)));
  return { rows: decodeDemand(demand), timetable, schedule, metrics };
}

/**
 * Everything a page needs: { meta, rows, timetable, schedule, metrics, dates, source }.
 * source is "supabase" or "offline".
 */
export function loadData() {
  if (!dataPromise) {
    dataPromise = (async () => {
      const meta = await fetchJSON("data/meta.json");   // config.py, always bundled
      let data = null, source = "offline";
      const sb = await getSupabase();
      if (sb) {
        try { data = await loadFromSupabase(sb, meta); source = "supabase"; }
        catch (e) { console.info("Supabase load failed, using offline copy:", e.message || e); }
      }
      if (!data) data = await loadOffline();
      const dates = [...new Set(data.rows.map((r) => r.date))].sort();
      return { meta, ...data, dates, source };
    })();
  }
  return dataPromise;
}
