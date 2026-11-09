// Ask BusWatch: keyword intent detection (no LLM). Every answer is computed from the loaded rows
// and states the numbers it is based on.
import { loadData } from "./data.js";
import { startPage, renderFilters, applyFilters, el, fmt, pct } from "./ui.js";
import { groupBy, sum, uniqueDates, perSlotPerDay, avgWait, utilisation, hourLabel } from "./stats.js";
import { toMinutes } from "./simulation.js";
import { plot, slotAxis, COLORS } from "./charts.js";

const data = await startPage("ask", loadData);
const { meta } = data;
let rows = [], dayRows = [], rangeRows = [];
let chartId = 0;

const QUESTIONS = [
  "Why is the M Vertica shuttle crowded on Mondays?",
  "When is APU busiest?",
  "How much does rain matter?",
  "Which buses run empty?",
  "How is exam week different?",
  "When is the Mosque busiest on Friday?",
];

// ---------------------------------------------------------------------------
// Understanding the question
// ---------------------------------------------------------------------------
const STOP_WORDS = {
  "APU": ["apu", "campus", "university"], "LRT - Bukit Jalil": ["lrt", "bukit jalil", "train", "station"],
  "M Vertica": ["m vertica", "vertica"], "Parkhill": ["parkhill", "park hill"],
  "Mosque": ["mosque", "masjid"],
};
const DAY_WORDS = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat(ur)?", Sun: "sun" };

function parse(q) {
  const t = q.toLowerCase();
  const stop = Object.keys(STOP_WORDS).find((s) => STOP_WORDS[s].some((w) => new RegExp(`\\b${w}\\b`).test(t)));
  const day = Object.keys(DAY_WORDS).find((d) => new RegExp(`\\b${DAY_WORDS[d]}(day|s|\\b)`).test(t));
  const intent =
    /exam/.test(t) ? "exam" :
    /rain|weather|wet|storm/.test(t) ? "rain" :
    /empty|under.?used|quiet|waste|spare|half.?full/.test(t) ? "empty" :
    /\bwhy\b|cause|reason/.test(t) ? "why" :
    /wait|how long/.test(t) ? "wait" :
    /busiest|peak|rush|when\b.*(busy|crowd|full)|worst time|crowd|busy|full|left behind|miss|overflow|queue/.test(t) ? "busiest" :
    "unknown";
  return { intent, route: null, stop, day };   // one shuttle per path: the stop identifies it
}

// ---------------------------------------------------------------------------
// Answers: each returns { html, basis, chart: {traces, layout} }
// ---------------------------------------------------------------------------
const normal = (rs) => rs.filter((r) => !r.is_exam_week);
const dayName = (d) => ({ Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays", Sat: "Saturdays", Sun: "Sundays" })[d];

const shuttle = (route) => route.replace("APU ↔ ", "") + " shuttle";

/** Answer layout: one bold headline, then a few short points. */
const brief = (headline, points) =>
  `<p class="answer-head">${headline}</p>${points.length ? `<ul class="points">${points.filter(Boolean).map((p) => `<li>${p}</li>`).join("")}</ul>` : ""}`;

/** Route-specific rushes (e.g. Friday prayers) at this stop / route / day, as short points. */
function eventPoints({ stop, route, day }) {
  return meta.events.filter((e) => (!stop || e.stop === stop) && (!route || e.route === route) && (!day || e.days.includes(day)))
    .map((e) => `${e.name}: +${e.per_slot} students per half hour, ${e.days.join("/")} ${e.start}–${e.end}`);
}

function answerWhy({ route, day, stop }) {
  let rs = normal(rows).filter((r) => (!day || r.day_of_week === day) && (!stop || r.stop === stop));
  if (!route) {   // pick the route where most students miss a full bus
    const by = [...groupBy(rs, (r) => r.route)].map(([k, v]) => [k, sum(v, (r) => r.missed_bus)]).sort((a, b) => b[1] - a[1]);
    route = by[0]?.[0];
  }
  rs = rs.filter((r) => r.route === route);
  if (!rs.length) return cannot("there are no normal-week days matching that in the selected dates");
  const left = perSlotPerDay(rs, meta, "missed_bus");
  const wait = perSlotPerDay(rs, meta, "students_waiting");
  const seats = perSlotPerDay(rs, meta, "total_capacity");
  const peak = left.indexOf(Math.max(...left));
  const peakTime = meta.time_slots[peak];
  const r = meta.routes[route];

  // Reasons: classes ending just before the peak near this route's stops, and reduced service
  const peakMin = toMinutes(peakTime);
  const days = day ? [day] : meta.days;
  const ending = data.timetable.filter((c) => c.period === "regular" && r.stops.includes(c.nearest_stop) &&
    c.days.split("/").some((d) => days.includes(d)) &&
    toMinutes(c.end_time) + 10 >= peakMin - meta.slot_minutes && toMinutes(c.end_time) + 10 < peakMin + meta.slot_minutes);
  const students = sum(ending, (c) => c.students) / (day ? 1 : days.length);
  const override = r.frequency_overrides.find((o) => toMinutes(o.start) <= peakMin && peakMin < toMinutes(o.end) + 15);

  return {
    html: brief(`<b>${shuttle(route)}</b>${day ? ` on ${dayName(day)}` : ""}: worst at <b>${peakTime}</b>, ≈ ${fmt(left[peak])} students miss a full bus`, [
      ending.length ? `Classes ending ${[...new Set(ending.map((c) => c.end_time))].sort().join(" / ")} release ≈ ${fmt(students)} students` : "",
      override ? `${override.reason}: a bus only every ${override.frequency} min (${override.start}–${override.end}), normally ${r.base_frequency}` : "",
      `At ${peakTime}: ${fmt(wait[peak])} waiting for ${fmt(seats[peak])} seats`,
      ...eventPoints({ route, day, stop }),
    ]),
    basis: `${uniqueDates(rs)} normal-week days.`,
    chart: { traces: [
      { x: meta.time_slots, y: wait, name: "Waiting", mode: "lines", line: { color: COLORS.accent, width: 3 } },
      { x: meta.time_slots, y: seats, name: "Seats offered", mode: "lines", line: { color: COLORS.text, dash: "dot", shape: "hv" } },
      { x: meta.time_slots, y: left, name: "Miss a full bus", type: "bar", marker: { color: COLORS.overflow } },
    ], layout: { xaxis: slotAxis(meta), yaxis: { title: { text: "Students / day" } } } },
  };
}

function answerBusiest({ stop, day, route }) {
  const rs = normal(rows).filter((r) => (!day || r.day_of_week === day) && (!route || r.route === route));
  if (!stop) {
    const by = [...groupBy(rs, (r) => r.stop)].map(([k, v]) => [k, sum(v, (r) => r.missed_bus)]).sort((a, b) => b[1] - a[1]);
    stop = by[0]?.[0];
  }
  const s = rs.filter((r) => r.stop === stop);
  if (!s.length) return cannot("no rows match that stop/route/day in the selected dates");
  const wait = perSlotPerDay(s, meta, "students_waiting");
  const top = wait.map((v, i) => [meta.time_slots[i], v]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return {
    html: brief(`<b>${stop}</b>${day ? ` on ${dayName(day)}` : ""} is busiest at <b>${top[0][0]}</b> (≈ ${fmt(top[0][1])} waiting)`, [
      `Next: ${top.slice(1).map(([t, v]) => `${t} (${fmt(v)})`).join(", ")}`,
      stop === "APU" ? "Peaks follow classes ending at :50" : "Peaks come before classes start",
      ...eventPoints({ stop, route, day }),
    ]),
    basis: `Average per day, ${uniqueDates(s)} normal-week days.`,
    chart: { traces: [{ x: meta.time_slots, y: wait, type: "bar", marker: { color: wait.map((v) => v === top[0][1] ? COLORS.overflow : COLORS.accent) } }],
      layout: { xaxis: slotAxis(meta), yaxis: { title: { text: "Students waiting / day" } } } },
  };
}

function answerRain() {
  const rs = normal(rows);
  // Compare rainy and dry days of the SAME weekday so busy Mondays don't distort the result
  const ratios = [], leftDry = [], leftRain = [];
  for (const d of meta.days) {
    const dd = rs.filter((r) => r.day_of_week === d);
    const wet = dd.filter((r) => r.is_rainy), dry = dd.filter((r) => !r.is_rainy);
    if (!wet.length || !dry.length) continue;
    const perDay = (x, f) => sum(x, f) / uniqueDates(x);
    ratios.push(perDay(wet, (r) => r.new_arrivals) / perDay(dry, (r) => r.new_arrivals));
    leftDry.push(perDay(dry, (r) => r.missed_bus));
    leftRain.push(perDay(wet, (r) => r.missed_bus));
  }
  if (!ratios.length) return cannot("the selected dates don't include both rainy and dry days");
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const rainyDays = new Set(rs.filter((r) => r.is_rainy).map((r) => r.date)).size;
  return {
    html: brief(`Rain: <b>+${pct(mean(ratios) - 1)} riders</b>, <b>+${pct(mean(leftRain) / mean(leftDry) - 1)} miss a full bus</b>`, [
      `Dry day: ≈ ${fmt(mean(leftDry))} miss a full bus`,
      `Rainy day: ≈ ${fmt(mean(leftRain))}`,
    ]),
    basis: `${rainyDays} rainy vs ${uniqueDates(rs) - rainyDays} dry days, same weekdays compared.`,
    chart: { traces: [{ x: ["Dry day", "Rainy day"], y: [mean(leftDry), mean(leftRain)], type: "bar", marker: { color: [COLORS.accent, COLORS.overflow] } }],
      layout: { yaxis: { title: { text: "Miss a full bus / day" } } } },
  };
}

function answerEmpty({ route }) {
  const rs = normal(rows).filter((r) => !route || r.route === route);
  if (!rs.length) return cannot("no rows match in the selected dates");
  const hours = [...groupBy(rs, (r) => r.route + "|" + Math.floor(toMinutes(r.time_slot) / 60))]
    .map(([k, v]) => ({ route: k.split("|")[0], hour: +k.split("|")[1], util: utilisation(v) }));
  const worst = [...hours].sort((a, b) => a.util - b.util).slice(0, 4);
  const routes = [...new Set(hours.map((h) => h.route))];
  return {
    html: brief(`Emptiest: <b>${shuttle(worst[0].route)} ${hourLabel(worst[0].hour)}–${hourLabel(worst[0].hour + 1)}</b> (${pct(worst[0].util)} of seats used)`, [
      ...worst.slice(1).map((h) => `${shuttle(h.route)} ${hourLabel(h.hour)}: ${pct(h.util)} used`),
      `Overall: ${pct(utilisation(rs))} of seats used`,
    ]),
    basis: `Seats used ÷ seats offered, ${uniqueDates(rs)} normal-week days.`,
    chart: { traces: routes.map((r) => {
      const h = hours.filter((x) => x.route === r).sort((a, b) => a.hour - b.hour);
      return { x: h.map((x) => hourLabel(x.hour)), y: h.map((x) => x.util), name: r, mode: "lines+markers", line: { color: meta.routes[r].colour, width: 2.5 } };
    }), layout: { yaxis: { tickformat: ".0%", title: { text: "Seats used" } } } },
  };
}

function answerExam() {
  const exam = rows.filter((r) => r.is_exam_week), reg = normal(rows);
  if (!exam.length) return cannot("the selected dates don't include exam week (week " + meta.exam_week + "); widen the date filter");
  if (!reg.length) return cannot("the selected dates only cover exam week, so there is nothing to compare with");
  const pd = (x, f) => sum(x, f) / uniqueDates(x);
  const we = perSlotPerDay(exam, meta, "students_waiting"), wr = perSlotPerDay(reg, meta, "students_waiting");
  const peakE = meta.time_slots[we.indexOf(Math.max(...we))];
  return {
    html: brief(`Exam week: two big waves, peak at <b>${peakE}</b>`, [
      `Riders: ${fmt(pd(exam, (r) => r.new_arrivals))} / day (normal ${fmt(pd(reg, (r) => r.new_arrivals))})`,
      `Miss a full bus: ${fmt(pd(exam, (r) => r.missed_bus))} / day (normal ${fmt(pd(reg, (r) => r.missed_bus))})`,
    ]),
    basis: `${uniqueDates(exam)} exam-week vs ${uniqueDates(reg)} normal days.`,
    chart: { traces: [
      { x: meta.time_slots, y: wr, name: "Normal week", mode: "lines", line: { color: COLORS.accent, width: 2.5 } },
      { x: meta.time_slots, y: we, name: "Exam week", mode: "lines", line: { color: "#a78bfa", width: 2.5 } },
    ], layout: { xaxis: slotAxis(meta), yaxis: { title: { text: "Students waiting / day" } } } },
  };
}

function answerWait({ route, day }) {
  const rs = normal(rows).filter((r) => (!route || r.route === route) && (!day || r.day_of_week === day));
  if (!rs.length) return cannot("no rows match in the selected dates");
  const by = meta.stops.map((s) => [s, avgWait(rs.filter((r) => r.stop === s))]).filter(([, v]) => v > 0);
  const worst = [...by].sort((a, b) => b[1] - a[1])[0];
  return {
    html: brief(`Average wait${day ? ` on ${dayName(day)}` : ""}: <b>${fmt(avgWait(rs), 1)} min</b>`, [
      `Longest: ${worst[0]} (${fmt(worst[1], 1)} min)`,
    ]),
    basis: `${uniqueDates(rs)} normal-week days.`,
    chart: { traces: [{ x: by.map((b) => b[0]), y: by.map((b) => b[1]), type: "bar", marker: { color: COLORS.accent } }],
      layout: { yaxis: { title: { text: "Minutes" } } } },
  };
}

function cannot(why) {
  return {
    html: brief(`I can't answer that: ${why}.`, ["Try: busiest times, why a shuttle is crowded, rain, empty buses, waits, exam week"]),
    basis: "", chart: null,
  };
}

function answer(q) {
  const p = parse(q);
  rows = p.day ? rangeRows : dayRows;   // naming a day overrides the Days filter
  switch (p.intent) {
    case "why": return answerWhy(p);
    case "busiest": return answerBusiest(p);
    case "rain": return answerRain();
    case "empty": return answerEmpty(p);
    case "exam": return answerExam();
    case "wait": return answerWait(p);
    default: return cannot("the question doesn't match anything in the dataset");
  }
}

// ---------------------------------------------------------------------------
// Chat UI
// ---------------------------------------------------------------------------
const chat = document.getElementById("chat");

function ask(q) {
  if (!q.trim()) return;
  chat.append(el("div", { class: "msg user" }, q));
  const a = answer(q);
  const bot = el("div", { class: "msg bot" });
  bot.innerHTML = a.html;
  if (a.chart) {
    const id = `answer-chart-${++chartId}`;
    bot.append(el("div", { id, class: "chart short" }));
    chat.append(bot);
    plot(id, a.chart.traces, { ...a.chart.layout, margin: { l: 50, r: 10, t: 10, b: 40 } });
  } else chat.append(bot);
  if (a.basis) bot.append(el("p", { class: "basis" }, "Based on: " + a.basis));
  bot.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

document.getElementById("chips").append(...QUESTIONS.map((q) =>
  el("button", { class: "btn small", type: "button", onclick: () => ask(q) }, q)));
document.getElementById("ask-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("ask-input");
  ask(input.value);
  input.value = "";
});

renderFilters(data, (f) => {
  dayRows = applyFilters(data.rows, f, { stop: false });
  rangeRows = applyFilters(data.rows, { ...f, dayList: null }, { stop: false });
}, { stop: false, note: "Answers use the selected dates and days; naming a day in your question (e.g. Saturday) overrides the Days filter." });
