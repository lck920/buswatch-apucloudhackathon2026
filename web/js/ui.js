// Shared page chrome: sidebar menu, top header, badges, theme toggle, filter panel (persisted in localStorage), helpers.

// Inline stroke icons (24x24) for the sidebar menu and header buttons
const ICONS = {
  index: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  overview: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  "supply-demand": '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  simulator: '<path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  recommendations: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 3z"/>',
  ask: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  "bus-times": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  tracker: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  bus: '<rect x="4" y="4" width="16" height="13" rx="3"/><path d="M4 11h16M8 21v-4M16 21v-4M8 8h8"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const PAGES = [
  ["index", "Home", "index.html"],
  ["overview", "Crowd Overview", "overview.html"],
  ["supply-demand", "Demand Forecast", "supply-demand.html"],
  ["simulator", "Schedule Simulator", "simulator.html"],
  ["recommendations", "Smart Recommendations", "recommendations.html"],
  ["ask", "Ask BusWatch", "ask.html"],
  ["bus-times", "Timetable", "bus-times.html"],
  ["tracker", "Live Bus Tracker", "tracker.html"],
];

// ---- Theme (dark default). The <head> script applies the saved theme before paint. ----
const THEME_KEY = "buswatch.theme";
const currentTheme = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
function toggleTheme() {
  const next = currentTheme() === "light" ? "dark" : "light";
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private window: applies to this page only */ }
  document.documentElement.dataset.theme = next;
  location.reload();   // charts read their colours at load, so a reload re-draws everything in the new theme
}

/** Tiny element helper: el("div", {class: "x"}, "text", childEl) */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c instanceof Node ? c : String(c));
  return e;
}

export const fmt = (n, digits = 0) =>
  Number(n).toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const pct = (x, digits = 0) => `${fmt(x * 100, digits)}%`;

// ---- localStorage, wrapped (private windows can throw) ----
export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify(value));
  } catch { return null; }
}

/** Draw the sidebar menu, the top header (into <header id="topbar">) and the page breadcrumb. */
export function renderTopBar(pageId) {
  const label = PAGES.find(([id]) => id === pageId)?.[1] ?? "";
  const nav = PAGES.map(([id, text, href]) =>
    `<a href="${href}" class="${id === pageId ? "active" : ""}" ${id === pageId ? 'aria-current="page"' : ""}>${icon(id)}<span>${text}</span></a>`).join("");

  const sidebar = el("aside", { class: "sidebar", id: "sidebar", "aria-label": "Main menu" });
  sidebar.innerHTML = `
    <a class="logo" href="index.html"><span class="logo-mark">${icon("bus")}</span><span>Bus<b>Watch</b></span></a>
    <p class="menu-label">Menu</p>
    <nav class="menu" aria-label="Pages">${nav}</nav>
    <div class="sidebar-note"><b>Simulated data</b>All data are simulated, not real university records.</div>`;
  const backdrop = el("div", { class: "backdrop", onclick: () => document.body.classList.remove("menu-open") });
  document.body.prepend(sidebar, backdrop);

  const dark = currentTheme() === "dark";
  document.getElementById("topbar").innerHTML = `
    <div class="topbar-inner">
      <button type="button" class="icon-btn" id="menu-btn" aria-label="Open menu" aria-controls="sidebar">${icon("menu")}</button>
      <div class="topbar-title">${label}</div>
      <button type="button" class="icon-btn" id="theme-btn" aria-label="Switch to ${dark ? "light" : "dark"} mode"
        title="Switch to ${dark ? "light" : "dark"} mode">${icon(dark ? "sun" : "moon")}</button>
    </div>`;
  document.getElementById("menu-btn").addEventListener("click", () => document.body.classList.toggle("menu-open"));
  document.getElementById("theme-btn").addEventListener("click", toggleTheme);

  // Breadcrumb on the right of the page title: Home > Page
  const head = document.querySelector(".page-head");
  if (head && pageId !== "index") {
    const title = el("div");
    title.append(...head.childNodes);
    head.append(title, el("nav", { class: "breadcrumb", "aria-label": "Breadcrumb" },
      el("a", { href: "index.html" }, "Home"), el("span", {}, "›"), el("span", {}, label)));
  }
}

/** Record where the data came from ("supabase" or "offline") on <body data-source> (not shown; used by tests). */
export function setSourceBadge(source) {
  document.body.dataset.source = source;
}

// ---------------------------------------------------------------------------
// Filters (date range, days, stop), shared across pages
// ---------------------------------------------------------------------------
const FILTER_KEY = "buswatch.filters";
const DEFAULT_DAYS = "Mon - Fri";   // like APSpace's default tab

/** Filters as pages receive them: adds dayList (weekday names, or null for all days). */
const withDays = (data, f) => ({ ...f, dayList: f.days === "all" ? null : data.meta.service_days[f.days] });

/** Dates inside the date range and the Days filter. */
export function filterDates(data, f) {
  const dow = new Map(data.rows.map((r) => [r.date, r.day_of_week]));
  return data.dates.filter((d) => d >= f.from && d <= f.to && (!f.dayList || f.dayList.includes(dow.get(d))));
}

export function getFilters(data) {
  const saved = store(FILTER_KEY) || {};
  const first = data.dates[0], last = data.dates[data.dates.length - 1];
  const f = {
    from: saved.from >= first && saved.from <= last ? saved.from : first,
    to: saved.to >= first && saved.to <= last ? saved.to : last,
    stop: data.meta.stops.includes(saved.stop) ? saved.stop : "all",
    days: saved.days === "all" || data.meta.service_days[saved.days] ? saved.days : DEFAULT_DAYS,
  };
  if (f.from > f.to) [f.from, f.to] = [f.to, f.from];
  return f;
}

/** Keep rows in the date range and Days filter (and stop unless told to ignore it). */
export function applyFilters(rows, f, { stop = true } = {}) {
  return rows.filter((r) => r.date >= f.from && r.date <= f.to &&
    (!f.dayList || f.dayList.includes(r.day_of_week)) &&
    (!stop || f.stop === "all" || r.stop === f.stop));
}

/**
 * Render the filter panel into #filters. options.stop = false hides the stop filter.
 * onChange(filters) runs on every change (and once at start).
 */
export function renderFilters(data, onChange, options = {}) {
  const { stop = true, note = "" } = options;
  const host = document.getElementById("filters");
  let f = getFilters(data);
  const first = data.dates[0], last = data.dates[data.dates.length - 1];
  const opt = (v, label, sel) => `<option value="${v}" ${v === sel ? "selected" : ""}>${label}</option>`;

  host.innerHTML = `
    <details class="filters" open>
      <summary>Filters <span class="filter-summary"></span></summary>
      <div class="filter-row">
        <label>From <input type="date" name="from" min="${first}" max="${last}" value="${f.from}"></label>
        <label>To <input type="date" name="to" min="${first}" max="${last}" value="${f.to}"></label>
        <label>Days <select name="days">${Object.keys(data.meta.service_days).map((d) => opt(d, d, f.days)).join("")}${opt("all", "All days", f.days)}</select></label>
        ${stop ? `<label>Stop <select name="stop">${opt("all", "All stops", f.stop)}${data.meta.stops.map((s) => opt(s, s, f.stop)).join("")}</select></label>` : ""}
        <button type="button" class="btn small" name="reset">Reset</button>
      </div>
      ${note ? `<p class="muted small filter-note">${note}</p>` : ""}
    </details>`;

  const details = host.querySelector("details");
  if (window.matchMedia("(max-width: 700px)").matches) details.open = false;  // collapsed on phones

  const summary = () => {
    const days = filterDates(data, withDays(data, f)).length;
    host.querySelector(".filter-summary").textContent =
      `- ${days} days${f.days !== "all" ? " - " + f.days : ""}${stop && f.stop !== "all" ? " - " + f.stop : ""}`;
  };
  const changed = () => { store(FILTER_KEY, f); summary(); onChange(withDays(data, f)); };

  host.querySelectorAll("input, select").forEach((input) => input.addEventListener("change", () => {
    f[input.name] = input.value || (input.name === "from" ? first : input.name === "to" ? last : "all");
    if (f.from > f.to) [f.from, f.to] = [f.to, f.from];
    changed();
  }));
  host.querySelector("[name=reset]").addEventListener("click", () => {
    f = { from: first, to: last, stop: "all", days: DEFAULT_DAYS };
    host.querySelector("[name=from]").value = first;
    host.querySelector("[name=to]").value = last;
    host.querySelectorAll("select").forEach((s) => (s.value = s.name === "days" ? DEFAULT_DAYS : "all"));
    changed();
  });
  summary();
  onChange(withDays(data, f));
}

/** Common page start: top bar, load data, set badge. Shows an error card if loading fails. */
export async function startPage(pageId, loadData) {
  renderTopBar(pageId);
  try {
    const data = await loadData();
    setSourceBadge(data.source);
    return data;
  } catch (e) {
    document.getElementById("content").prepend(
      el("div", { class: "card error" }, "Could not load data: " + e.message +
        ". If you opened the file directly, run `python -m http.server` in web/ instead."));
    throw e;
  }
}

/** Status of a load value: ok / busy / overflow. */
export function loadLevel(load, thresholds) {
  if (load > thresholds.overflow) return "overflow";
  if (load >= thresholds.busy) return "busy";
  return "ok";
}
