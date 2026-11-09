// Schedule Simulator: change one shuttle's schedule, replay new_arrivals, compare before vs after.
import { loadData } from "./data.js";
import { startPage, renderFilters, applyFilters, el, fmt, pct } from "./ui.js";
import { simulateRoute, toMinutes } from "./simulation.js";
import { hourLabel } from "./stats.js";
import { buildRecommendations, dayGroups } from "./recommendations.js";
import { plot, slotAxis, COLORS } from "./charts.js";

const data = await startPage("simulator", loadData);
const { meta } = data;
const host = document.getElementById("sim-controls");
const firstHour = toMinutes(meta.service_start) / 60, lastHour = toMinutes(meta.service_end) / 60;
const HOURS = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);

let filters = null;
let state = null;

function defaultState(route) {
  const r = meta.routes[route];
  return {
    route, applyDays: "all", baseFrequency: r.base_frequency, keepOverrides: true,
    extra: { perHour: 0, start: 17, end: 18 },
    move: { count: 0, fromHour: 9, toHour: 12 },
  };
}

const opts = (values, sel, label = (v) => v) =>
  values.map((v) => `<option value="${v}" ${String(v) === String(sel) ? "selected" : ""}>${label(v)}</option>`).join("");

function renderControls() {
  const r = meta.routes[state.route];
  const overrides = r.frequency_overrides.length
    ? r.frequency_overrides.map((o) => `${o.start}–${o.end} every ${o.frequency} min (${o.reason})`).join("; ")
    : "none on this shuttle";
  host.innerHTML = `
    <div class="control-group">
      <h3>Shuttle &amp; days</h3>
      <div class="row">
        <label>Shuttle <select data-k="route">${opts(Object.keys(meta.routes), state.route)}</select></label>
        <label>Apply on <select data-k="applyDays">${opts(["all", ...dayGroups(meta).map((g) => g.name)], state.applyDays, (v) => v === "all" ? "All filtered days" : v)}</select></label>
      </div>
    </div>
    <div class="control-group">
      <h3>Weekday frequency</h3>
      <label>Mon–Fri bus every (minutes) <input type="number" min="15" max="60" step="15" data-k="baseFrequency" value="${state.baseFrequency}"></label>
      <label class="inline"><input type="checkbox" data-k="keepOverrides" ${state.keepOverrides ? "checked" : ""} ${r.frequency_overrides.length ? "" : "disabled"}>
        Keep reduced-service windows</label>
      <span class="small muted">${overrides}. Weekends: Sat every ${r.weekend_frequency.Sat ?? "–"} min, Sun ${r.weekend_frequency.Sun ? `every ${r.weekend_frequency.Sun} min` : "no service"}.</span>
    </div>
    <div class="control-group">
      <h3>Add extra buses</h3>
      <div class="row">
        <label>Per hour <input type="number" min="0" max="6" data-k="extra.perHour" value="${state.extra.perHour}"></label>
        <label>From <select data-k="extra.start">${opts(HOURS, state.extra.start, hourLabel)}</select></label>
        <label>To <select data-k="extra.end">${opts([...HOURS.slice(1), lastHour], state.extra.end, hourLabel)}</select></label>
      </div>
    </div>
    <div class="control-group">
      <h3>Move buses (same cost)</h3>
      <div class="row">
        <label>Buses <input type="number" min="0" max="4" data-k="move.count" value="${state.move.count}"></label>
        <label>From hour <select data-k="move.fromHour">${opts(HOURS, state.move.fromHour, hourLabel)}</select></label>
        <label>To hour <select data-k="move.toHour">${opts(HOURS, state.move.toHour, hourLabel)}</select></label>
      </div>
    </div>`;

  host.querySelectorAll("[data-k]").forEach((input) => input.addEventListener("change", () => {
    const [a, b] = input.dataset.k.split(".");
    let v = input.type === "checkbox" ? input.checked : input.value;
    if (input.type === "number" || /Hour|start|end/.test(b ?? "")) v = Math.max(+input.min || 0, Math.min(+input.max || 999, +v || 0));
    if (a === "route") { state = defaultState(v); renderControls(); }
    else if (b) state[a][b] = v;
    else state[a] = v;
    if (a === "baseFrequency") state.baseFrequency = Math.max(5, state.baseFrequency);
    document.getElementById("sim-note").textContent = "";
    run();
  }));
}

function scenario() {
  return {
    baseFrequency: state.baseFrequency, keepOverrides: state.keepOverrides,
    extra: { perHour: state.extra.perHour, start: hourLabel(state.extra.start), end: hourLabel(state.extra.end) },
    move: state.move,
  };
}

function run() {
  const group = dayGroups(meta).find((g) => g.name === state.applyDays);
  const rows = applyFilters(data.rows, filters, { stop: false })
    .filter((r) => r.route === state.route && (!group || group.days.includes(r.day_of_week)));
  if (!rows.length) {
    document.getElementById("sim-table").textContent = "No days match the filters.";
    return;
  }
  const before = simulateRoute(meta, rows, state.route);
  const after = simulateRoute(meta, rows, state.route, scenario());

  // Lower is better for wait / missed buses; higher is better for utilisation; trips = cost
  const line = (label, b, a, show, lowerIsBetter = true) => {
    const d = a - b;
    const good = lowerIsBetter ? d < 0 : d > 0;
    const cls = Math.abs(d) < 1e-9 ? "" : good ? "good" : "bad";
    return `<tr><td>${label}</td><td class="big">${show(b)}</td><td class="big">${show(a)}</td>
      <td class="delta ${cls}">${d > 0 ? "+" : ""}${show(d)}</td></tr>`;
  };
  document.getElementById("sim-table").innerHTML = `
    <table class="compare-table">
      <thead><tr><th>${state.route} - ${before.days} days</th><th>Before</th><th>After</th><th>Change</th></tr></thead>
      <tbody>
        ${line("Avg wait (min)", before.avgWait, after.avgWait, (v) => fmt(v, 1))}
        ${line("Miss a full bus / day", before.missedPerDay, after.missedPerDay, (v) => fmt(v))}
        ${line("Bus utilisation", before.utilisation, after.utilisation, (v) => pct(v, 1), false)}
        ${line("Bus trips / day", before.tripsPerDay, after.tripsPerDay, (v) => fmt(v, 1))}
        ${line("Bus-hours / day", before.busHoursPerDay, after.busHoursPerDay, (v) => fmt(v, 1))}
        ${line("Operating cost / day (RM)", before.costPerDay, after.costPerDay, (v) => fmt(v))}
        ${line("Buses needed at peak", before.peakBuses, after.peakBuses, (v) => fmt(v))}
      </tbody>
    </table>
    <p class="caption">Each student who watches a full bus leave is counted once. Utilisation = seats used ÷ seats offered.
      Buses leave every 30 min; extra buses double up on the :00 / :30 departures.
      Cost: each trip ties up a bus for ${meta.routes[state.route].round_trip_minutes} min at RM ${meta.cost_per_bus_hour} per bus-hour (simulated assumptions).</p>`;

  plot("sim-chart", [
    { x: meta.time_slots, y: before.missedBySlot, name: "Before", type: "scatter", mode: "lines", fill: "tozeroy",
      line: { color: COLORS.overflow, width: 2 }, fillcolor: "rgba(239,68,68,0.15)" },
    { x: meta.time_slots, y: after.missedBySlot, name: "After", type: "scatter", mode: "lines",
      line: { color: COLORS.accent, width: 3 } },
  ], { xaxis: slotAxis(meta), yaxis: { title: { text: "Miss a full bus / day" } }, hovermode: "x unified" });
}

document.getElementById("sim-reset").addEventListener("click", () => {
  state = defaultState(state.route);
  document.getElementById("sim-note").textContent = "";
  renderControls();
  run();
});

document.getElementById("sim-preset").addEventListener("click", () => {
  const rows = applyFilters(data.rows, filters, { stop: false });
  const top = buildRecommendations(meta, rows, { limit: 1 })[0];
  const note = document.getElementById("sim-note");
  if (!top) { note.textContent = "No overloaded window in the selected dates, so nothing to fix."; return; }
  state = defaultState(top.route);
  state.applyDays = top.applyDays;
  if (top.scenario.move) state.move = { ...top.scenario.move };
  if (top.scenario.keepOverrides === false) state.keepOverrides = false;
  if (top.scenario.extra) state.extra = { perHour: top.scenario.extra.perHour,
    start: toMinutes(top.scenario.extra.start) / 60, end: toMinutes(top.scenario.extra.end) / 60 };
  note.replaceChildren(el("b", {}, "Applied: "), top.sentence);
  renderControls();
  run();
});

renderFilters(data, (f) => {
  filters = f;
  if (!state) state = defaultState(Object.keys(meta.routes)[0]);
  renderControls();
  run();
}, { stop: false, note: "The simulator works on one shuttle (chosen below), both ends, so only the dates and days apply." });
