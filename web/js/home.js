// Home page: headline numbers + links.
import { loadData } from "./data.js";
import { startPage, renderFilters, applyFilters, fmt, pct } from "./ui.js";
import { kpis } from "./stats.js";
import { findOverloadedWindows, windowLabel } from "./recommendations.js";

const data = await startPage("index", loadData);

const LINKS = [
  ["overview.html", "Crowd Overview", "KPIs and a stop × time heatmap of crowding."],
  ["supply-demand.html", "Demand Forecast", "Predicted queue against seats offered, per stop."],
  ["simulator.html", "Schedule Simulator", "Change a shuttle's schedule and replay demand."],
  ["recommendations.html", "Smart Recommendations", "Plain-language fixes with expected impact."],
  ["ask.html", "Ask BusWatch", "Quick answers with the numbers behind them."],
  ["bus-times.html", "Timetable", "Mon–Fri, Saturday and Sunday timetables with crowd dots."],
  ["tracker.html", "Live Bus Tracker", "Map of the shuttles with simulated GPS and arrival times."],
];
document.getElementById("links").innerHTML = LINKS.map(([href, title, text]) =>
  `<a class="card link-card" href="${href}"><h3>${title}</h3><p class="muted">${text}</p></a>`).join("");

const card = (label, value, sub) =>
  `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;

renderFilters(data, (f) => {
  const rows = applyFilters(data.rows, f);
  const k = kpis(rows);
  const top = findOverloadedWindows(data.meta, rows)[0];
  document.getElementById("headline").innerHTML = [
    card("Students who miss a full bus / day", fmt(k.missedPerDay), `of ≈ ${fmt(k.boardedPerDay / 2)} riders a day - ${k.days} days`),
    card("Average wait", `${fmt(k.avgWait, 1)}<small> min</small>`, "weighted by students waiting"),
    card("Seats used", pct(k.utilisation), "buses run mostly empty off-peak"),
    top ? card("Worst window", `${top.group} ${windowLabel(data.meta, top)}`, top.route)
        : card("Worst window", "–", "no overloaded window"),
    data.metrics ? card("Model accuracy (R²)", fmt(data.metrics.chosen.r2, 2), `MAE ${fmt(data.metrics.chosen.mae, 1)} students`) : "",
  ].join("");
});
