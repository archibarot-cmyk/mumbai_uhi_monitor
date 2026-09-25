/* ==========================================================================
   Mumbai UHI Monitor — app.js
   Plain vanilla JS. No build step, no framework.

   >>> TO USE YOUR REAL DATA <<<
   Place these files in the SAME FOLDER as index.html:
     - wards.geojson       (ward polygons + risk properties)
     - bounds.json         ([[lat_min,lng_min],[lat_max,lng_max]])
     - weather_now.json    ({ condition, confidence, source_temp })
     - lst_overlay.png     (the colored heatmap image)
   The fetch() calls below already point at those exact relative filenames —
   nothing else needs to change.

   NOTE ON DOUBLE-CLICKING index.html:
   Opening a file directly (file:// in the address bar) makes most browsers
   block fetch() of local JSON files as a security measure (this is a browser
   CORS rule, not a bug in this code). Two ways to see REAL data:
     1. Run a tiny local server from this folder, e.g.:
          python3 -m http.server
        then open http://localhost:8000
     2. Upload the folder to any static host (GitHub Pages, Netlify, S3, etc.)
   If fetch() fails for any reason (file:// restrictions, missing file, bad
   JSON, etc.), the app quietly falls back to the bundled MOCK_* data below
   so you always see a working demo.
   ========================================================================== */

// --------------------------------------------------------------------------
// 1. MOCK / FALLBACK DATA — used automatically if the real files can't load
// --------------------------------------------------------------------------
const MOCK_WARDS = {
  type: "FeatureCollection",
  features: [
    mkWard("Colaba", [72.80, 18.90, 72.89, 19.00], {
      lst: 34.2, ndvi: 0.28, population_density: 28000, power_temp: 33.5,
      population_density_worldpop: 27500, population_census: 26800, impervious_pct: 78,
      risk_score: 62, risk_level: "Medium",
      recommendation: "Increase tree canopy along coastal roads and add shaded transit stops."
    }),
    mkWard("Chembur", [72.89, 18.90, 72.98, 19.00], {
      lst: 38.9, ndvi: 0.14, population_density: 34000, power_temp: null,
      population_density_worldpop: 33100, population_census: null, impervious_pct: 85,
      risk_score: 81, risk_level: "Severe",
      recommendation: "Priority zone: deploy cool-roof retrofits and expand green cover near industrial belts."
    }),
    mkWard("Dadar", [72.80, 19.00, 72.89, 19.10], {
      lst: 36.5, ndvi: 0.19, population_density: 42000, power_temp: 35.0,
      population_density_worldpop: null, population_census: 41200, impervious_pct: 82,
      risk_score: 74, risk_level: "High",
      recommendation: "Add pocket parks and reflective pavement near transit hubs."
    }),
    mkWard("Kurla", [72.89, 19.00, 72.98, 19.10], {
      lst: 37.8, ndvi: 0.12, population_density: 45000, power_temp: 36.1,
      population_density_worldpop: 44000, population_census: 43500, impervious_pct: 88,
      risk_score: 79, risk_level: "High",
      recommendation: "Expand drainage-linked green infrastructure to reduce heat and flood risk together."
    }),
    mkWard("Bandra West", [72.80, 19.10, 72.89, 19.20], {
      lst: 33.1, ndvi: 0.31, population_density: 25000, power_temp: 32.0,
      population_density_worldpop: 24500, population_census: null, impervious_pct: 70,
      risk_score: 48, risk_level: "Medium",
      recommendation: "Maintain existing green cover and monitor coastal heat trends."
    }),
    mkWard("Andheri East", [72.89, 19.10, 72.98, 19.20], {
      lst: 39.4, ndvi: 0.10, population_density: 31000, power_temp: null,
      population_density_worldpop: 30500, population_census: 29800, impervious_pct: 91,
      risk_score: 85, risk_level: "Severe",
      recommendation: "Priority zone: retrofit industrial roofs and add street-level shade structures."
    }),
    mkWard("Malad", [72.80, 19.20, 72.89, 19.30], {
      lst: 31.8, ndvi: 0.42, population_density: 18000, power_temp: 30.9,
      population_density_worldpop: 17600, population_census: 17900, impervious_pct: 58,
      risk_score: 29, risk_level: "Low",
      recommendation: "Continue current green space maintenance; low intervention priority."
    }),
    mkWard("Borivali", [72.89, 19.20, 72.98, 19.30], {
      lst: 30.5, ndvi: 0.48, population_density: 15000, power_temp: 29.8,
      population_density_worldpop: null, population_census: 14700, impervious_pct: 51,
      risk_score: 22, risk_level: "Low",
      recommendation: "No immediate action needed; area benefits from adjacent national park green cover."
    }),
  ]
};

function mkWard(name, [lngMin, latMin, lngMax, latMax], props) {
  return {
    type: "Feature",
    properties: { ward_name: name, ...props },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [lngMin, latMin], [lngMax, latMin], [lngMax, latMax], [lngMin, latMax], [lngMin, latMin]
      ]]
    }
  };
}

const MOCK_BOUNDS = [[18.90, 72.80], [19.30, 72.98]];

const MOCK_WEATHER = { condition: "cloudy", confidence: 0.82, source_temp: 33.4 };

// --------------------------------------------------------------------------
// 2. DATA LOADING HELPERS
// --------------------------------------------------------------------------

/** Fetch JSON from `path`; on any failure, log why and use `fallback` instead. */
async function fetchJSONWithFallback(path, fallback, label) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(
      `[UHI] Could not load ${label} from "${path}" (${err.message}). ` +
      `Using bundled sample data instead. See the note at the top of app.js ` +
      `about serving this folder over http:// to load real files.`
    );
    return fallback;
  }
}

/** Render "N/A" for null/undefined values, otherwise the value + optional unit. */
function fmt(value, unit = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return `${value}${unit}`;
}

const RISK_ORDER = { Low: 0, Medium: 1, High: 2, Severe: 3 };
const RISK_COLORS = {
  Low: "#45b571",
  Medium: "#e3b23c",
  High: "#e07a2e",
  Severe: "#d64435",
};

// --------------------------------------------------------------------------
// 3. APP STATE
// --------------------------------------------------------------------------
let map;
let wardLayerByName = new Map();   // ward_name -> Leaflet layer
let wardFeatures = [];             // flat array of GeoJSON feature properties
let sortState = { key: "risk_score", asc: false };
let searchTerm = "";
let alertFilterOnly = false;
let weatherTimer = null;

// --------------------------------------------------------------------------
// 4. MAP SETUP
// --------------------------------------------------------------------------
function initMap() {
  map = L.map("map", { scrollWheelZoom: true }).setView([19.07, 72.87], 11);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 18,
  }).addTo(map);
}

function addLstOverlay(bounds) {
  // bounds.json format is [[lat_min, lng_min], [lat_max, lng_max]] —
  // that is exactly the [[south, west], [north, east]] shape Leaflet expects.
  const leafletBounds = L.latLngBounds(bounds[0], bounds[1]);
  L.imageOverlay("lst_overlay.png", leafletBounds, { opacity: 0.65 })
    .addTo(map)
    .on("error", () => {
      console.warn("[UHI] lst_overlay.png not found — skipping heat overlay image (map still works).");
    });
}

function riskStyle(feature) {
  const level = feature.properties.risk_level;
  return {
    color: "#0d1a2b",
    weight: 1,
    fillColor: RISK_COLORS[level] || "#888",
    fillOpacity: 0.55,
  };
}

function buildPopupHTML(props) {
  const level = props.risk_level || "Unknown";
  return `
    <div class="popup-ward-name">${escapeHTML(props.ward_name)}</div>
    <div class="popup-risk-row">
      <span class="risk-pill risk-${level}">${escapeHTML(level)}</span>
      <span class="popup-risk-score">Risk score: ${fmt(props.risk_score)}</span>
    </div>
    <p class="popup-recommendation">${escapeHTML(props.recommendation || "No recommendation available.")}</p>
    <details class="popup-sources">
      <summary>Data sources</summary>
      <dl class="popup-sources-grid">
        <dt>LST</dt><dd>${fmt(props.lst, "°C")}</dd>
        <dt>NDVI</dt><dd>${fmt(props.ndvi)}</dd>
        <dt>NASA POWER temp</dt><dd>${fmt(props.power_temp, "°C")}</dd>
        <dt>Impervious %</dt><dd>${fmt(props.impervious_pct, "%")}</dd>
        <dt>Pop. density</dt><dd>${fmt(props.population_density)}</dd>
        <dt>Pop. density (WorldPop)</dt><dd>${fmt(props.population_density_worldpop)}</dd>
        <dt>Population (Census)</dt><dd>${fmt(props.population_census)}</dd>
      </dl>
    </details>
  `;
}

function escapeHTML(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function addWardLayer(wardsGeoJSON) {
  const layer = L.geoJSON(wardsGeoJSON, {
    style: riskStyle,
    onEachFeature: (feature, layer) => {
      layer.bindPopup(buildPopupHTML(feature.properties));
      wardLayerByName.set(feature.properties.ward_name, layer);
    },
  }).addTo(map);

  try {
    map.fitBounds(layer.getBounds(), { padding: [20, 20] });
  } catch (e) {
    // if geometry is empty/invalid, just keep the default Mumbai view
  }
}

function focusWard(wardName) {
  if (!map) return; // map failed to load; table still works standalone
  const layer = wardLayerByName.get(wardName);
  if (!layer) return;
  const bounds = layer.getBounds ? layer.getBounds() : null;
  if (bounds && bounds.isValid()) {
    map.flyToBounds(bounds, { padding: [60, 60], duration: 0.6 });
  }
  layer.openPopup();
}

// --------------------------------------------------------------------------
// 5. RANKING TABLE
// --------------------------------------------------------------------------
function getVisibleRows() {
  let rows = wardFeatures.slice();

  if (alertFilterOnly) {
    rows = rows.filter(r => r.risk_level === "High" || r.risk_level === "Severe");
  }
  if (searchTerm.trim()) {
    const q = searchTerm.trim().toLowerCase();
    rows = rows.filter(r => (r.ward_name || "").toLowerCase().includes(q));
  }

  const { key, asc } = sortState;
  rows.sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (key === "risk_level") {
      av = RISK_ORDER[av] ?? -1;
      bv = RISK_ORDER[bv] ?? -1;
    }
    if (av === null || av === undefined) av = asc ? Infinity : -Infinity;
    if (bv === null || bv === undefined) bv = asc ? Infinity : -Infinity;
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av < bv) return asc ? -1 : 1;
    if (av > bv) return asc ? 1 : -1;
    return 0;
  });

  return rows;
}

function renderTable() {
  const tbody = document.getElementById("wardTableBody");
  const rows = getVisibleRows();

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty">No wards match your search/filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr data-ward="${escapeHTML(r.ward_name)}">
      <td>${escapeHTML(r.ward_name)}</td>
      <td class="score-cell">${fmt(r.risk_score)}</td>
      <td><span class="risk-pill risk-${r.risk_level || ""}">${escapeHTML(r.risk_level || "N/A")}</span></td>
      <td class="recommendation-cell">${escapeHTML(r.recommendation || "N/A")}</td>
    </tr>
  `).join("");

  tbody.querySelectorAll("tr[data-ward]").forEach(tr => {
    tr.addEventListener("click", () => focusWard(tr.getAttribute("data-ward")));
  });

  updateSortHeaderIndicators();
}

function updateSortHeaderIndicators() {
  document.querySelectorAll("#wardTable thead th").forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.getAttribute("data-key") === sortState.key) {
      th.classList.add(sortState.asc ? "sort-asc" : "sort-desc");
    }
  });
}

function initTableSorting() {
  document.querySelectorAll("#wardTable thead th").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-key");
      if (sortState.key === key) {
        sortState.asc = !sortState.asc;
      } else {
        sortState = { key, asc: key !== "risk_score" }; // default risk_score to descending (worst first)
      }
      renderTable();
    });
  });
}

function initSearch() {
  const input = document.getElementById("wardSearch");
  input.addEventListener("input", () => {
    searchTerm = input.value;
    renderTable();
  });
}

function initFilterChip() {
  document.getElementById("filterChipClear").addEventListener("click", () => {
    alertFilterOnly = false;
    document.getElementById("filterChip").classList.add("hidden");
    renderTable();
  });
}

// --------------------------------------------------------------------------
// 6. ALERTS BANNER
// --------------------------------------------------------------------------
function initAlertsBanner() {
  const severe = wardFeatures.filter(w => w.risk_level === "Severe").length;
  const high = wardFeatures.filter(w => w.risk_level === "High").length;
  const banner = document.getElementById("alertsBanner");
  const bannerText = document.getElementById("alertsBannerText");

  if (severe === 0 && high === 0) {
    banner.classList.add("hidden");
    return;
  }

  const parts = [];
  if (severe > 0) parts.push(`${severe} ward${severe > 1 ? "s" : ""} at Severe risk`);
  if (high > 0) parts.push(`${high} ward${high > 1 ? "s" : ""} at High risk`);
  bannerText.textContent = `⚠️ ${parts.join(" · ")} today`;
  banner.classList.remove("hidden");

  banner.addEventListener("click", () => {
    alertFilterOnly = true;
    const chip = document.getElementById("filterChip");
    document.getElementById("filterChipText").textContent =
      `Showing only High/Severe risk wards (${severe + high})`;
    chip.classList.remove("hidden");
    renderTable();
    document.querySelector(".ranking-column").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// --------------------------------------------------------------------------
// 7. WEATHER BADGE
// --------------------------------------------------------------------------
const WEATHER_ICONS = { clear: "☀️", cloudy: "☁️", rainy: "🌧️" };

async function refreshWeather() {
  const data = await fetchJSONWithFallback("weather_now.json", MOCK_WEATHER, "weather data");
  const icon = WEATHER_ICONS[data.condition] || "🌡️";
  document.getElementById("weatherIcon").textContent = icon;
  document.getElementById("weatherCondition").textContent = data.condition || "Unknown";
  const confidencePct = data.confidence !== undefined && data.confidence !== null
    ? `${Math.round(data.confidence * 100)}%`
    : "N/A";
  document.getElementById("weatherDetail").textContent =
    `${fmt(data.source_temp, "°C")} · confidence ${confidencePct}`;
}

function initWeatherBadge() {
  refreshWeather();
  weatherTimer = setInterval(refreshWeather, 60000); // every 60s
}

// --------------------------------------------------------------------------
// 8. LAST UPDATED LABEL
// --------------------------------------------------------------------------
function setLastUpdated() {
  const now = new Date();
  document.getElementById("lastUpdated").textContent =
    `Last updated: ${now.toLocaleString()}`;
}

// --------------------------------------------------------------------------
// 9. BOOTSTRAP
// --------------------------------------------------------------------------
async function init() {
  initTableSorting();
  initSearch();
  initFilterChip();

  const [wardsGeoJSON, bounds] = await Promise.all([
    fetchJSONWithFallback("wards.geojson", MOCK_WARDS, "ward data"),
    fetchJSONWithFallback("bounds.json", MOCK_BOUNDS, "overlay bounds"),
  ]);

  // The table, alerts banner and weather badge don't depend on Leaflet at all,
  // so they're built first and always work even if the map can't load.
  wardFeatures = wardsGeoJSON.features.map(f => f.properties);
  renderTable();
  initAlertsBanner();
  initWeatherBadge();
  setLastUpdated();

  // Map setup is wrapped separately: if the Leaflet CDN is blocked (ad-blocker,
  // offline, corporate proxy, etc.) the rest of the dashboard still works.
  try {
    if (typeof L === "undefined") {
      throw new Error("Leaflet failed to load from the CDN (check your internet connection).");
    }
    initMap();
    addLstOverlay(bounds);
    addWardLayer(wardsGeoJSON);
  } catch (err) {
    console.error("[UHI] Map could not be initialized:", err);
    const mapEl = document.getElementById("map");
    mapEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;
                  color:#90a6c2;text-align:center;padding:2rem;font-size:0.9rem;">
        Map couldn't load (Leaflet didn't come through from the CDN).<br/>
        The ward ranking table on the right still works normally.
      </div>`;
  }
}

document.addEventListener("DOMContentLoaded", init);
