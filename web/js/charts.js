// Plotly helpers so every chart matches the current theme (dark or light). Plotly is loaded from the CDN as a global.

const LIGHT = document.documentElement.dataset.theme === "light";
export const COLORS = {
  text: LIGHT ? "#344054" : "#e4e7ec", muted: LIGHT ? "#667085" : "#98a2b3",
  grid: LIGHT ? "#e4e7ec" : "#1d2939", card: LIGHT ? "#ffffff" : "#161f30", accent: "#465fff",
  ok: "#12b76a", busy: "#f79009", overflow: "#f04438",
};

export function layout(extra = {}) {
  return {
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: COLORS.text, family: "Outfit, system-ui, sans-serif", size: 13 },
    margin: { l: 52, r: 16, t: 16, b: 48 },
    xaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.grid, linecolor: COLORS.grid, automargin: true },
    yaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.grid, linecolor: COLORS.grid, rangemode: "tozero",
      automargin: true, tickformat: ",~r" },
    legend: { orientation: "h", y: -0.2, bgcolor: "rgba(0,0,0,0)" },
    hoverlabel: { bgcolor: COLORS.card, bordercolor: COLORS.accent, font: { color: COLORS.text }, namelength: -1 },
    ...extra,
  };
}

const CONFIG = { displayModeBar: false, responsive: true };

/** Draw (or redraw) a chart. extraLayout merges into the base layout (axes merged too). */
export function plot(target, traces, extraLayout = {}) {
  const node = typeof target === "string" ? document.getElementById(target) : target;
  if (!window.Plotly) {   // CDN unreachable (offline pitch): keep the page working without charts
    node.innerHTML = '<div class="chart-missing">Chart unavailable: Plotly could not load (no internet?). Numbers above are still correct.</div>';
    return Promise.resolve();
  }
  const base = layout();
  const l = { ...base, ...extraLayout,
    xaxis: { ...base.xaxis, ...(extraLayout.xaxis || {}) },
    yaxis: { ...base.yaxis, ...(extraLayout.yaxis || {}) } };
  // Readable hover: whole numbers (no 14.01429) unless a chart sets its own template
  const tidy = traces.map((t) => (t.hovertemplate || t.type === "heatmap" ? t
    : { ...t, hovertemplate: t.orientation === "h" ? "%{x:.0%}<extra></extra>" : "%{y:,.0f}" }));
  return window.Plotly.react(node, tidy, l, CONFIG);
}

/** Show a slot axis with hourly ticks only. */
export const slotAxis = (meta) => ({
  tickmode: "array",
  tickvals: meta.time_slots.filter((s) => s.endsWith(":00")),
  ticktext: meta.time_slots.filter((s) => s.endsWith(":00")),
});
