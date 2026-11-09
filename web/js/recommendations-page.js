// Recommendations page: rule-based suggestions, each run through the simulator, plus a summary report.
import { loadData } from "./data.js";
import { startPage, renderFilters, applyFilters, fmt, pct } from "./ui.js";
import { kpis } from "./stats.js";
import { plot, slotAxis, COLORS } from "./charts.js";
import { buildRecommendations, costText } from "./recommendations.js";

const data = await startPage("recommendations", loadData);
const { meta } = data;
let current = { recs: [], rows: [], filters: null };

const change = (b, a) => (b ? (a - b) / b : 0);

const OPTION_LABEL = { move: "Move a bus", policy: "Policy change", add: "Add buses" };
const shortName = (route) => route.replace("APU ↔ ", "") + " shuttle";
const saved = (r, o) => r.before.missedPerDay - o.after.missedPerDay;            // students a day helped
const extraRM = (r, o) => o.after.costPerDay - r.before.costPerDay;               // extra running cost / day
const costChip = (r, o) => {
  const rm = extraRM(r, o), peak = o.after.peakBuses - r.before.peakBuses;
  return `${Math.abs(rm) < 1 ? `<span class="chip good">No extra cost</span>` : `<span class="chip">+RM ${fmt(rm)} / day</span>`}` +
    (peak > 0 ? `<span class="chip">+${peak} bus at peak</span>` : "");
};

/** Insight cards: the headline numbers across all recommendations. */
function insightsHTML(recs, k) {
  const all = recs.flatMap((r) => r.options.map((o) => ({ r, o, saved: saved(r, o), rm: extraRM(r, o) })));
  const top = recs[0];
  const impact = all.reduce((a, b) => (b.saved > a.saved ? b : a), all[0]);
  // Best value: free options first (most students helped), else most students helped per RM
  const free = all.filter((x) => x.rm < 1);
  const value = free.length ? free.reduce((a, b) => (b.saved > a.saved ? b : a))
    : all.reduce((a, b) => (b.saved / b.rm > a.saved / a.rm ? b : a));
  const card = (label, v, sub) => `<div class="card kpi"><div class="label">${label}</div><div class="value">${v}</div><div class="sub">${sub}</div></div>`;
  return `<div class="grid kpis">
    ${card("Students who miss a full bus", `${fmt(k.missedPerDay)}<small> / day</small>`, "all shuttles, selected days")}
    ${card("Worst window", top.window, `${shortName(top.route)} - ${top.group}`)}
    ${card("Biggest impact", `−${fmt(impact.saved)}<small> / day</small>`, `${impact.o.short} (${shortName(impact.r.route)})`)}
    ${card("Best value", value.rm < 1 ? "Free" : `RM ${fmt(value.rm)}<small> / day</small>`, `${value.o.short}: −${fmt(value.saved)} students / day`)}
  </div>`;
}

function render() {
  const host = document.getElementById("recs");
  const { recs, rows } = current;
  if (!recs.length) {
    host.innerHTML = `<div class="card">No shuttle has an overloaded window in the selected dates. Try widening the date range.</div>`;
    return;
  }
  host.innerHTML = insightsHTML(recs, kpis(rows)) + `<div class="grid" style="margin-top:1.25rem">${recs.map((r, i) => {
    const best = r.options[0];
    const maxSaved = Math.max(...r.options.map((o) => saved(r, o)));
    return `<article class="card rec">
      <div class="rec-head">
        <span class="rank">#${i + 1}</span>
        <div class="rec-title"><h3>${shortName(r.route)}</h3>
          <div class="chips"><span class="chip">${r.group}</span><span class="chip">${r.window}</span></div></div>
        <div class="rec-big"><span class="label">Students who miss a full bus / day</span>
          <b>${fmt(r.before.missedPerDay)} → ${fmt(best.after.missedPerDay)}</b>
          <span class="delta good">${pct(change(r.before.missedPerDay, best.after.missedPerDay))} with the best option</span></div>
      </div>
      <div class="rec-body">
        <div><div id="rec-chart-${i}" class="chart mini"></div></div>
        <div class="options">${r.options.map((o, j) => `
          <div class="opt ${j === 0 ? "best" : ""}">
            <div class="opt-top"><span class="tag tag-${o.action}">${OPTION_LABEL[o.action]}</span>${j === 0 ? `<span class="best-label">Best</span>` : ""}</div>
            <p class="opt-text">${o.short}</p>
            <div class="bar"><span style="width:${(100 * saved(r, o)) / maxSaved}%"></span></div>
            <div class="opt-meta"><b>−${fmt(saved(r, o))}</b> students / day (${pct(change(r.before.missedPerDay, o.after.missedPerDay))}) ${costChip(r, o)}</div>
          </div>`).join("")}</div>
      </div>
    </article>`; }).join("")}</div>
    <p class="caption">Each card is one shuttle on its busiest days. The chart shows students who miss a full bus at each departure: now (bars) vs with the best option (line).
      Simulated on normal weeks in the selected dates.</p>`;

  recs.forEach((r, i) => plot(`rec-chart-${i}`, [
    { x: meta.time_slots, y: r.before.missedBySlot, name: "Now", type: "bar", marker: { color: "rgba(240,68,56,0.55)" } },
    { x: meta.time_slots, y: r.options[0].after.missedBySlot, name: "Best option", type: "scatter", mode: "lines", line: { color: COLORS.accent, width: 3 } },
  ], { xaxis: slotAxis(meta), yaxis: { title: { text: "Miss a bus / day" } }, margin: { l: 44, r: 8, t: 8, b: 36 },
    legend: { orientation: "h", y: 1.18, x: 0 }, bargap: 0.15, hovermode: "x unified" }));
}

// ---------------------------------------------------------------------------
// Management report: formatted HTML, printed (or saved as PDF) on its own
// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

function reportHTML() {
  const { recs, rows, filters } = current;
  const k = kpis(rows);
  const m = data.metrics;
  const days = filters.days === "all" ? "all days" : filters.days;
  const better = m ? 1 - m.chosen.mae / m.baseline.mae : 0;
  return `
    <h1>BusWatch - Management report</h1>
    <p class="report-meta">Period ${filters.from} to ${filters.to}, ${days} (${k.days} days) - generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} - <b>simulated data</b></p>

    <h2>1. Situation</h2>
    <table class="report-kpis"><tr>
      <td><b>${fmt(k.missedPerDay)}</b><span>students a day miss a full bus</span></td>
      <td><b>${fmt(k.boardedPerDay / 2)}</b><span>shuttle riders a day</span></td>
      <td><b>${fmt(k.avgWait, 1)} min</b><span>average wait</span></td>
      <td><b>${pct(k.utilisation)}</b><span>of seats used</span></td>
    </tr></table>
    <p>Buses run mostly empty between classes but overflow at class changes, which is when students push and cut the queue.
      ${k.worstStop ? `The worst stop is <b>${esc(k.worstStop.stop)}</b> (${fmt(k.worstStop.left)} students a day miss a full bus) and the worst departure is <b>${k.worstSlot.slot}</b>.` : ""}</p>

    <h2>2. Recommended changes</h2>
    ${recs.length ? `<table class="report-table">
      <thead><tr><th>#</th><th>Problem</th><th>Recommended action</th><th>Students missing a bus / day</th><th>Cost</th></tr></thead>
      <tbody>${recs.map((r, i) => `<tr>
        <td>${i + 1}</td>
        <td>${esc(r.route)}, ${r.group} ${r.window}</td>
        <td>${esc(r.options[0].text)}</td>
        <td>${fmt(r.before.missedPerDay)} → <b>${fmt(r.after.missedPerDay)}</b> (${pct(change(r.before.missedPerDay, r.after.missedPerDay))})</td>
        <td>${esc(costText(r.before, r.after))}</td></tr>`).join("")}</tbody></table>
      ${recs.some((r) => r.options.length > 1) ? `<h3>Cheaper alternatives</h3><ul>${recs.flatMap((r, i) => r.options.slice(1).map((o) =>
        `<li>For #${i + 1}: ${esc(o.text)} <i>(${pct(-change(r.before.missedPerDay, o.after.missedPerDay))} fewer students missing a bus; cost: ${esc(o.cost)})</i></li>`)).join("")}</ul>` : ""}`
    : "<p>No overloaded windows in this period.</p>"}

    <h2>3. How reliable is the forecast?</h2>
    ${m ? `<p>The forecast is usually within <b>±${fmt(m.chosen.mae, 1)} students</b> of the real queue at a stop, ${pct(better)} closer than
      simply using the average of past weeks (±${fmt(m.baseline.mae, 1)}). It was checked on ${m.test_weeks.length} weeks it had never seen and did
      better in ${m.weeks_beating_baseline} of them.</p>` : ""}

    <h2>4. Next steps</h2>
    <ol><li>Trial recommendation #1 for two weeks and count the queue at the affected departures.</li>
      <li>Run a short student survey and count queues at the busiest stops to replace the simulated assumptions with real numbers.</li></ol>
    <p class="report-note">All data are simulated, not real university records.</p>`;
}

document.getElementById("report-btn").addEventListener("click", () => {
  const host = document.getElementById("report");
  host.innerHTML = reportHTML();
  host.hidden = false;
  window.print();   // print CSS shows only the report; choose "Save as PDF" in the dialog
});

renderFilters(data, (f) => {
  const rows = applyFilters(data.rows, f, { stop: false });
  current = { rows, filters: f, recs: buildRecommendations(meta, rows, { limit: 5 }) };
  render();
  const report = document.getElementById("report");
  if (!report.hidden) report.innerHTML = reportHTML();   // keep the report in sync with the filters
}, { stop: false, note: "Recommendations work on whole shuttles (both ends), so the stop filter doesn't apply here." });
