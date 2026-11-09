// Timetable: APSpace-style timetable (Mon - Fri / Saturday / Sunday tabs, From -> To),
// plus a crowd dot per bus from the simulated queues.
import { loadData } from "./data.js";
import { startPage, store, loadLevel } from "./ui.js";
import { groupBy, load, routesForStop } from "./stats.js";
import { toMinutes } from "./simulation.js";

const data = await startPage("bus-times", loadData);
const { meta } = data;
const KEY = "buswatch.bustimes";
const saved = store(KEY) || {};
const state = {
  service: meta.service_days[saved.service] ? saved.service : Object.keys(meta.service_days)[0],
  from: meta.stops.includes(saved.from) ? saved.from : "LRT - Bukit Jalil",
  to: meta.stops.includes(saved.to) ? saved.to : "APU",
};
const LEVEL_TEXT = { ok: "usually has seats", busy: "busy", overflow: "often full: you may wait for the next bus" };

const opts = (values, sel) => values.map((v) => `<option ${v === sel ? "selected" : ""}>${v}</option>`).join("");
const twelveHour = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${String(((h + 11) % 12) + 1).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

function render() {
  store(KEY, state);
  document.getElementById("bt-tabs").innerHTML = Object.keys(meta.service_days).map((s) =>
    `<button type="button" role="tab" class="tab ${s === state.service ? "active" : ""}" aria-selected="${s === state.service}" data-s="${s}">${s}</button>`).join("");

  // "To" lists stops with a shuttle from "From"
  const reachable = meta.stops.filter((s) => s !== state.from &&
    routesForStop(meta, state.from).some((r) => meta.routes[r].stops.includes(s)));
  if (!reachable.includes(state.to)) state.to = reachable[0];
  document.getElementById("bt-controls").innerHTML = `
    <label>From <select name="from">${opts(meta.stops, state.from)}</select></label>
    <button type="button" class="btn swap-btn" id="bt-swap" aria-label="Swap From and To">⇅ Swap</button>
    <label>To <select name="to">${opts(reachable, state.to)}</select></label>`;

  document.querySelectorAll("#bt-tabs .tab").forEach((b) => b.addEventListener("click", () => { state.service = b.dataset.s; render(); }));
  document.querySelectorAll("#bt-controls select").forEach((s) => s.addEventListener("change", () => { state[s.name] = s.value; render(); }));
  document.getElementById("bt-swap").addEventListener("click", () => {
    if (routesForStop(meta, state.to).length) [state.from, state.to] = [state.to, state.from];
    render();
  });
  renderTimes();
}

function renderTimes() {
  const days = meta.service_days[state.service];
  const routes = routesForStop(meta, state.from).filter((r) => meta.routes[r].stops.includes(state.to));
  const host = document.getElementById("bt-results");
  host.innerHTML = routes.map((route) => {
    const times = data.schedule.filter((b) => b.service_day === state.service && b.route === route && b.stop === state.from)
      .map((b) => b.arrival_time).sort();
    // Typical crowd per slot at this stop on these days (normal weeks)
    const bySlot = groupBy(data.rows.filter((r) => r.route === route && r.stop === state.from &&
      days.includes(r.day_of_week) && !r.is_exam_week), (r) => r.slot);
    const level = (t) => {
      const rs = bySlot.get(Math.floor((toMinutes(t) - toMinutes(meta.service_start)) / meta.slot_minutes));
      return rs ? loadLevel(load(rs), meta.thresholds) : "ok";
    };
    const body = times.length
      ? `<div class="times">${times.map((t) => { const l = level(t);
          return `<span class="time" title="${LEVEL_TEXT[l]}"><span class="dot ${l}"></span>${twelveHour(t)}</span>`; }).join("")}</div>`
      : `<p class="muted">No shuttle on ${state.service}.</p>`;
    return `<section class="card">
      <h3 class="route-head"><span style="color:${meta.routes[route].colour}">●</span> ${state.from.toUpperCase()} ▸ ${state.to.toUpperCase()}
        <span class="muted small">${times.length} buses</span></h3>${body}</section>`;
  }).join("") + `<div class="legend-row"><span><span class="dot ok"></span>Usually has seats</span>
    <span><span class="dot busy"></span>Busy</span><span><span class="dot overflow"></span>Often full: expect to wait for the next bus</span></div>`;
}

render();
