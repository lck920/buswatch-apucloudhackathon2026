// Overview: KPI cards + stop x time heatmap of crowd level.
import { loadData } from "./data.js";
import { startPage, renderFilters, applyFilters, fmt } from "./ui.js";
import { kpis, heatmap } from "./stats.js";
import { plot, slotAxis, COLORS } from "./charts.js";

const data = await startPage("overview", loadData);
const { meta } = data;
const th = meta.thresholds;

const card = (label, value, sub) =>
  `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;

renderFilters(data, (f) => {
  const rows = applyFilters(data.rows, f);
  const k = kpis(rows);
  document.getElementById("kpis").innerHTML = [
    card("Average wait", `${fmt(k.avgWait, 1)}<small> min</small>`, "weighted by students waiting"),
    card("Students who miss a full bus", `${fmt(k.missedPerDay)}<small> / day</small>`, `of ≈ ${fmt(k.boardedPerDay / 2)} riders a day (${fmt(k.boardedPerDay)} boardings)`),
    card("Worst stop", k.worstStop?.stop ?? "–", k.worstStop ? `${fmt(k.worstStop.left)} miss a full bus / day` : ""),
    card("Worst departure", k.worstSlot?.slot ?? "–", k.worstSlot ? `${fmt(k.worstSlot.left)} miss a full bus / day` : ""),
  ].join("");

  // Heatmap: always every stop (the stop filter only narrows the cards above), coloured by level
  // (0 ok, 1 busy, 2 overflow); hover shows the real load value
  const loads = heatmap(applyFilters(data.rows, f, { stop: false }), meta);
  const level = loads.map((row) => row.map((v) => v == null ? null : v > th.overflow ? 2 : v >= th.busy ? 1 : 0));
  const text = loads.map((row) => row.map((v) => v == null ? "no data" : v === Infinity ? "no bus" : v.toFixed(2)));
  plot("heatmap", [{
    type: "heatmap", z: level, x: meta.time_slots, y: meta.stops, text, zmin: 0, zmax: 2,
    colorscale: [[0, COLORS.ok], [0.333, COLORS.ok], [0.334, COLORS.busy], [0.666, COLORS.busy], [0.667, COLORS.overflow], [1, COLORS.overflow]],
    showscale: false, xgap: 2, ygap: 2,
    hovertemplate: "%{y} - %{x}<br>Load %{text}<extra></extra>",
  }], { xaxis: { ...slotAxis(meta), gridcolor: "rgba(0,0,0,0)" }, yaxis: { automargin: true, gridcolor: "rgba(0,0,0,0)" },
    margin: { l: 110, r: 10, t: 10, b: 40 } });
});
