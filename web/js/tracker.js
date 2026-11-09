// Live Bus Tracker: a map of APU and Bukit Jalil with simulated bus GPS, plus an arrivals board.
// Buses follow the timetable: a bus leaving one end at time d is on the road until d + travel_minutes,
// so its position is a straight-line interpolation between the two stops. No real GPS is used.
import { loadData } from "./data.js";
import { startPage, loadLevel, store } from "./ui.js";
import { groupBy, load } from "./stats.js";
import { toMinutes, toHHMM } from "./simulation.js";

const data = await startPage("tracker", loadData);
const { meta } = data;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const serviceDayOf = (dow) => Object.keys(meta.service_days).find((k) => meta.service_days[k].includes(dow));
const start = toMinutes(meta.service_start), end = toMinutes(meta.service_end);
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };

// Live when the real clock is inside service hours, otherwise a demo time the user can scrub/play
const saved = store("buswatch.tracker") || {};
const state = {
  service: meta.service_days[saved.service] ? saved.service : serviceDayOf(DAY_NAMES[new Date().getDay()]),
  live: nowMinutes() >= start && nowMinutes() < end,
  time: 8 * 60 + 20,     // demo default: morning rush
  playing: false,
};
const currentTime = () => (state.live ? nowMinutes() : state.time);

// Departures per (route, from-stop) for the chosen service day, in minutes
function departures(route, stop) {
  return data.schedule.filter((b) => b.service_day === state.service && b.route === route && b.stop === stop)
    .map((b) => toMinutes(b.arrival_time)).sort((a, b) => a - b);
}

// Typical crowd level when a bus leaves `stop` at minute t (normal weeks, this service day)
const crowdCache = new Map();
function crowd(route, stop, t) {
  const key = `${state.service}|${route}|${stop}`;
  if (!crowdCache.has(key)) {
    const days = meta.service_days[state.service];
    crowdCache.set(key, groupBy(data.rows.filter((r) => r.route === route && r.stop === stop && !r.is_exam_week &&
      days.includes(r.day_of_week)), (r) => r.slot));
  }
  const rs = crowdCache.get(key).get(Math.floor((t - start) / meta.slot_minutes));
  return rs ? loadLevel(load(rs), meta.thresholds) : "ok";
}

const shortName = (route) => route.replace("APU ↔ ", "");
const fmtTime = (m) => toHHMM(Math.floor(m));
const inMin = (m) => (m < 1 ? "now" : `${Math.round(m)} min`);

// ---------------------------------------------------------------------------
// Controls: service day, live / demo time, play
// ---------------------------------------------------------------------------
function renderControls() {
  store("buswatch.tracker", { service: state.service });
  const t = currentTime();
  document.getElementById("tk-controls").innerHTML = `
    <div class="tabs" role="tablist">${Object.keys(meta.service_days).map((s) =>
      `<button type="button" class="tab ${s === state.service ? "active" : ""}" data-s="${s}" aria-selected="${s === state.service}">${s}</button>`).join("")}</div>
    <div class="clock"><span class="live-dot ${state.live ? "on" : ""}"></span><b id="tk-clock">${fmtTime(t)}</b>
      <span class="muted small">${state.live ? "Live (your clock)" : "Demo time"}</span></div>
    <label class="slider">Time of day
      <input type="range" id="tk-time" min="${start}" max="${end - 1}" step="1" value="${Math.min(end - 1, Math.max(start, Math.floor(t)))}"></label>
    <div class="btn-row">
      <button type="button" class="btn" id="tk-play">${state.playing ? "Pause" : "Play"}</button>
      <button type="button" class="btn" id="tk-now">Now</button>
    </div>`;
  document.querySelectorAll("#tk-controls .tab").forEach((b) => b.addEventListener("click", () => {
    state.service = b.dataset.s; crowdCache.clear(); renderControls(); tick();
  }));
  document.getElementById("tk-time").addEventListener("input", (e) => { state.live = false; state.time = +e.target.value; tick(); });
  document.getElementById("tk-play").addEventListener("click", () => { state.live = false; state.time = Math.floor(currentTime()); state.playing = !state.playing; renderControls(); });
  document.getElementById("tk-now").addEventListener("click", () => {
    state.playing = false;
    state.live = nowMinutes() >= start && nowMinutes() < end;
    state.service = serviceDayOf(DAY_NAMES[new Date().getDay()]);
    if (!state.live) state.time = 8 * 60 + 20;
    crowdCache.clear(); renderControls(); tick();
  });
}

// ---------------------------------------------------------------------------
// Map (Leaflet + OpenStreetMap tiles). Falls back to a message if Leaflet can't load.
// ---------------------------------------------------------------------------
let map = null;
const busLayer = [];
function initMap() {
  const host = document.getElementById("map");
  if (!window.L) {
    host.innerHTML = '<div class="chart-missing">Map unavailable: it needs internet to load. The arrivals board still works.</div>';
    return;
  }
  map = L.map(host, { scrollWheelZoom: false, attributionControl: true });
  // OpenStreetMap tiles (no key needed); dark mode darkens them with a CSS filter
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19,
  }).addTo(map);
  const loc = meta.stop_locations;
  for (const [route, r] of Object.entries(meta.routes)) {   // one line per shuttle path
    L.polyline(r.stops.map((s) => loc[s]), { color: r.colour, weight: 4, opacity: 0.6, dashArray: "6 6" }).addTo(map);
  }
  for (const stop of meta.stops) {
    L.marker(loc[stop], { icon: L.divIcon({ className: "stop-pin", html: `<span class="${stop === "APU" ? "campus" : ""}"></span><b>${stop}</b>`, iconSize: [0, 0] }) })
      .addTo(map);
  }
  map.fitBounds(L.latLngBounds(Object.values(loc)).pad(0.12));
}

/** Buses on the road at minute t: [{route, from, to, dep, arrive, frac}] */
function busesOnRoad(t) {
  const out = [];
  for (const [route, r] of Object.entries(meta.routes)) {
    for (const [from, to] of [[r.stops[0], r.stops[1]], [r.stops[1], r.stops[0]]]) {
      for (const dep of departures(route, from)) {
        if (dep <= t && t < dep + r.travel_minutes) out.push({ route, from, to, dep, arrive: dep + r.travel_minutes, frac: (t - dep) / r.travel_minutes });
      }
    }
  }
  return out;
}

/** Buses waiting at a stop for their next departure (when no bus is already driving there). */
function busesWaiting(t, onRoad) {
  const out = [];
  for (const [route, r] of Object.entries(meta.routes)) {
    for (const stop of r.stops) {
      const next = departures(route, stop).find((d) => d >= Math.floor(t));
      const coming = onRoad.some((b) => b.route === route && b.to === stop && b.arrive > next);
      if (next != null && !coming) out.push({ route, stop, next });
    }
  }
  return out;
}

function busMarker(pos, route, tip, waiting) {
  const m = L.marker(pos, { icon: L.divIcon({ className: `bus-pin ${waiting ? "waiting" : ""}`, iconSize: [22, 22],
    html: `<span style="background:${meta.routes[route].colour}">🚌</span>` }) }).bindTooltip(tip).addTo(map);
  busLayer.push(m);
}

function drawBuses(t) {
  if (!map) return;
  busLayer.splice(0).forEach((m) => m.remove());
  const loc = meta.stop_locations;
  const onRoad = busesOnRoad(t);
  for (const b of onRoad) {
    const [a, z] = [loc[b.from], loc[b.to]];
    busMarker([a[0] + (z[0] - a[0]) * b.frac, a[1] + (z[1] - a[1]) * b.frac], b.route,
      `${shortName(b.route)} shuttle → ${b.to}<br>Arrives ${fmtTime(b.arrive)} (in ${inMin(b.arrive - t)})`, false);
  }
  for (const w of busesWaiting(t, onRoad)) {
    const other = meta.routes[w.route].stops.find((s) => s !== w.stop);
    // nudge waiting buses off the stop pin so several at APU don't overlap
    const i = Object.keys(meta.routes).indexOf(w.route);
    const pos = [loc[w.stop][0] + 0.0012 * Math.cos(i * 1.6), loc[w.stop][1] + 0.0012 * Math.sin(i * 1.6)];
    busMarker(pos, w.route, `${shortName(w.route)} shuttle waiting at ${w.stop}<br>Leaves for ${other} at ${fmtTime(w.next)} (in ${inMin(w.next - t)})`, true);
  }
}

// ---------------------------------------------------------------------------
// Arrivals board: next departure from each end of each shuttle
// ---------------------------------------------------------------------------
function drawBoard(t) {
  const rows = [];
  for (const [route, r] of Object.entries(meta.routes)) {
    for (const [from, to] of [[r.stops[0], r.stops[1]], [r.stops[1], r.stops[0]]]) {
      const deps = departures(route, from);
      const next = deps.find((d) => d >= Math.floor(t));
      const onRoad = busesOnRoad(t).find((b) => b.route === route && b.to === to);
      rows.push({ route, from, to, next, onRoad, level: next != null ? crowd(route, from, next) : null });
    }
  }
  document.getElementById("eta-board").innerHTML = `
    <thead><tr><th>From → To</th><th>Next bus</th><th>Leaves in</th><th>On the road</th></tr></thead>
    <tbody>${rows.map((x) => `<tr>
      <td><span style="color:${meta.routes[x.route].colour}">●</span> ${x.from} → ${x.to}</td>
      <td>${x.next != null ? `<span class="dot ${x.level}" title="${x.level}"></span>${fmtTime(x.next)}` : `<span class="muted">No more today</span>`}</td>
      <td class="big-cell">${x.next != null ? inMin(x.next - t) : "–"}</td>
      <td class="muted small">${x.onRoad ? `arrives ${fmtTime(x.onRoad.arrive)}` : "–"}</td></tr>`).join("")}</tbody>`;
}

function tick() {
  const t = currentTime();
  const clock = document.getElementById("tk-clock");
  if (clock) clock.textContent = fmtTime(t);
  const slider = document.getElementById("tk-time");
  if (slider && document.activeElement !== slider) slider.value = Math.min(end - 1, Math.max(start, Math.floor(t)));
  drawBuses(t);
  drawBoard(t);
}

renderControls();
initMap();
tick();
// Live: refresh every 5 s. Playing: one simulated minute per second.
setInterval(() => {
  if (state.playing) { state.time = state.time + 1 >= end ? start : state.time + 1; tick(); }
}, 1000);
setInterval(() => { if (state.live && !state.playing) tick(); }, 5000);
