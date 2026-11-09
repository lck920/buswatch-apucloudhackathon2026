// Demand Forecast: predicted queue vs seats offered for one stop / route / day.
import { loadData } from "./data.js";
import { startPage, renderFilters, filterDates, fmt, pct } from "./ui.js";
import { shuttleBetween, destinations, perSlotPerDay } from "./stats.js";
import { toMinutes } from "./simulation.js";
import { plot, slotAxis, COLORS } from "./charts.js";

const data = await startPage("supply-demand", loadData);
const { meta } = data;
const controls = document.getElementById("sd-controls");
let filters = null;
const choice = { from: null, to: null, date: null, stop: null, route: null };   // stop = from, route = its shuttle

const options = (values, selected, label = (v) => v) =>
  values.map((v) => `<option value="${v}" ${v === selected ? "selected" : ""}>${label(v)}</option>`).join("");

function dayLabel(date) {
  const r = data.rows.find((x) => x.date === date);
  return `${r.day_of_week} ${date}${r.is_rainy ? " - rain" : ""}${r.is_exam_week ? " - exam week" : ""}`;
}

function renderControls() {
  const dates = filterDates(data, filters);
  choice.from = choice.from ?? (filters.stop !== "all" ? filters.stop : "APU");
  const tos = destinations(meta, choice.from);
  if (!tos.includes(choice.to)) choice.to = tos[0];
  choice.stop = choice.from;
  choice.route = shuttleBetween(meta, choice.from, choice.to);
  if (!dates.includes(choice.date)) choice.date = dates.find((d) => data.rows.find((r) => r.date === d).day_of_week === "Mon") ?? dates[0];
  if (!dates.length) { controls.innerHTML = "<p>No days match the filters.</p>"; return; }

  controls.innerHTML = `
    <label>From <select name="from">${options(meta.stops, choice.from)}</select></label>
    <label>To <select name="to">${options(tos, choice.to)}</select></label>
    <label>Day <select name="date">${options(dates, choice.date, dayLabel)}</select></label>`;
  controls.querySelectorAll("select").forEach((s) => s.addEventListener("change", () => {
    choice[s.name] = s.value;
    renderControls();
    draw();
  }));
}

function draw() {
  const rows = data.rows.filter((r) => r.date === choice.date && r.stop === choice.stop && r.route === choice.route)
    .sort((a, b) => a.slot - b.slot);
  const x = rows.map((r) => r.time_slot);
  const pred = rows.map((r) => r.predicted_waiting);
  const cap = rows.map((r) => r.total_capacity);
  const overflow = rows.map((r, i) => pred[i] > cap[i]);

  // Shade each slot where the predicted queue is bigger than the seats on offer
  const shapes = overflow.flatMap((o, i) => o ? [{
    type: "rect", xref: "x", yref: "paper", x0: i - 0.5, x1: i + 0.5, y0: 0, y1: 1,
    fillcolor: "rgba(240,68,56,0.16)", line: { width: 0 }, layer: "below" }] : []);

  plot("sd-chart", [
    { x, y: rows.map((r) => r.students_waiting), name: "Actually waiting", type: "bar", marker: { color: "rgba(152,162,179,0.35)" } },
    { x, y: pred, name: "Forecast", mode: "lines+markers", line: { color: COLORS.accent, width: 3, shape: "spline" }, marker: { size: 5 } },
    { x, y: cap, name: "Seats on the bus", type: "scatter", mode: "lines", line: { shape: "hv", color: COLORS.busy, width: 2, dash: "dash" } },
  ], { shapes, xaxis: slotAxis(meta), yaxis: { title: { text: "Students waiting" } }, hovermode: "x unified", bargap: 0.25,
    legend: { orientation: "h", y: 1.12, x: 0 }, margin: { l: 52, r: 16, t: 36, b: 40 } });

  const n = overflow.filter(Boolean).length;
  document.getElementById("sd-caption").textContent = "Grey bars: students actually waiting. Blue line: the forecast. Orange dashes: seats on the bus. " + (n
    ? `${n} red zone${n === 1 ? "" : "s"}: more students expected than seats. That's when students push and cut the queue.`
    : "No red zones: the buses have enough seats for everyone expected.");
}

// Plain-language names for the model's inputs (several technical inputs share one name)
const FEATURE_LABELS = {
  finishing_now: "Students finishing class now", finishing_prev: "Students who finished 30 min ago",
  starting_in_30: "Classes starting in 30 min", starting_in_60: "Classes starting in 1 hour",
  day_of_week: "Day of the week", time_slot: "Time of day", route: "Which shuttle", stop: "Which stop",
  is_rainy: "Rain", rain_x_finishing_now: "Rain", rain_x_finishing_prev: "Rain",
  buses_scheduled: "Buses scheduled", capacity_scheduled: "Buses scheduled", is_exam_week: "Exam week",
};

function renderModel() {
  const m = data.metrics;
  if (!m) return;
  const err = m.chosen.mae, guess = m.baseline.mae;
  const example = 40;
  document.getElementById("model-card").innerHTML = `
    <h2>How accurate is the forecast?</h2>
    <p class="muted small">We hid ${m.test_weeks.length} weeks from the model, asked it to forecast them, then compared with what really happened.</p>
    <div class="grid kpis">
      <div class="kpi"><div class="label">Typical error</div><div class="value">±${fmt(err, 1)}<small> students</small></div>
        <div class="sub">per stop, per departure</div></div>
      <div class="kpi"><div class="label">Better than a simple guess</div><div class="value">${pct(1 - err / guess)}</div>
        <div class="sub">guess = average of past weeks (±${fmt(guess, 1)})</div></div>
      <div class="kpi"><div class="label">Weeks it won</div><div class="value">${m.weeks_beating_baseline}<small> of ${m.test_weeks.length}</small></div>
        <div class="sub">weeks ${m.test_weeks.join(", ")}, never seen in training</div></div>
    </div>
    <p class="notice small" style="margin-top:1rem">Example: if the forecast says <b>${example}</b> students will be waiting,
      expect roughly <b>${fmt(example - err)}–${fmt(example + err)}</b>.</p>
    <p class="small muted">Why is the simple guess close? The timetable repeats every week, so last week's average is already decent.
      The forecast's real advantage is that it can predict a <b>new timetable</b> or unusual weather, which an average can't.</p>`;

  // Group the inputs under plain names, drop the ones the model barely uses, biggest first
  const grouped = {};
  for (const f of m.feature_importance) {
    const name = FEATURE_LABELS[f.feature] ?? f.feature.replaceAll("_", " ");
    grouped[name] = (grouped[name] || 0) + f.importance;
  }
  const items = Object.entries(grouped).filter(([, v]) => v >= 0.01).sort((a, b) => a[1] - b[1]);
  plot("importance", [{ type: "bar", orientation: "h", x: items.map(([, v]) => v), y: items.map(([k]) => k),
    text: items.map(([, v]) => pct(v)), textposition: "outside", cliponaxis: false,
    marker: { color: COLORS.accent }, hovertemplate: "%{y}: %{x:.0%}<extra></extra>" }],
  { xaxis: { tickformat: ".0%", range: [0, Math.max(...items.map(([, v]) => v)) * 1.2] },
    yaxis: { automargin: true, dtick: 1 }, margin: { l: 10, r: 10, t: 10, b: 30 } });
}

renderFilters(data, (f) => { filters = f; renderControls(); draw(); });
renderModel();
