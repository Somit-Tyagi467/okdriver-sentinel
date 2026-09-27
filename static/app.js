const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const state = {
  token: "",
  user: "admin",
  cameras: [],
  events: [],
  historyEvents: [],
  entities: [],
  alerts: [],
  watchlist: [],
  audit: [],
  markers: new Map(),
  map: null,
  trackingMap: null,
  overviewTraceLayer: null,
  trackingTraceLayer: null,
};
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const api = async (path, opts = {}) => {
  const r = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.token}`,
      ...(opts.headers || {}),
    },
  });
  let d = {};
  try {
    d = await r.json();
  } catch {}
  if (!r.ok) throw Error(d.error || `Request failed (${r.status})`);
  return d;
};
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2800);
}
function time(value) {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function date(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function cameraStatus(c) {
  return `<span class="cam-dot ${esc(c.status)}"></span>`;
}
function markerIcon(cam) {
  return L.divIcon({
    className: "",
    html: `<div class="map-marker ${esc(cam.status)}">◉</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}
function initMap() {
  if (!window.L || state.map) return;
  state.map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: false,
  }).setView([23.025, 72.577], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(state.map);
  setTimeout(() => state.map.invalidateSize(), 100);
}
function initTrackingMap() {
  if (!window.L || state.trackingMap) return;
  state.trackingMap = L.map("trackingMap", {
    zoomControl: true,
    scrollWheelZoom: false,
  }).setView([23.025, 72.577], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(state.trackingMap);
  setTimeout(() => state.trackingMap.invalidateSize(), 100);
}
function upsertMarker(cam) {
  if (!state.map) return;
  const marker = state.markers.get(cam.id);
  const popup = `<b>${esc(cam.name)}</b><br>${esc(cam.id)} · ${esc(cam.status)}<br>${esc(cam.department)}`;
  if (marker) {
    marker
      .setLatLng([cam.latitude, cam.longitude])
      .setIcon(markerIcon(cam))
      .bindPopup(popup);
  } else
    state.markers.set(
      cam.id,
      L.marker([cam.latitude, cam.longitude], { icon: markerIcon(cam) })
        .addTo(state.map)
        .bindPopup(popup),
    );
}
function renderStats() {
  $("#onlineCount").textContent = state.cameras.filter(
    (c) => c.status === "Online",
  ).length;
  $("#cameraTotal").textContent = state.cameras.length;
  $("#openCount").textContent = state.alerts.filter(
    (a) => a.status !== "Resolved",
  ).length;
  $("#eventCount").textContent = state.events.length;
  $("#navAlerts").textContent = state.alerts.filter(
    (a) => a.status === "Open",
  ).length;
  $("#navAlerts").classList.toggle(
    "hidden",
    !state.alerts.some((a) => a.status === "Open"),
  );
}
function renderFeeds() {
  const term = $("#cameraSearch")?.value.toLowerCase() || "",
    filter = $("#cameraFilter")?.value || "";
  const cams = state.cameras.filter(
    (c) =>
      (!term || `${c.name} ${c.id} ${c.zone}`.toLowerCase().includes(term)) &&
      (!filter || c.status === filter),
  );
  $("#feedGrid").innerHTML =
    cams
      .map(
        (c, i) =>
          `<article class="feed-card"><div class="feed-visual"><canvas class="feed-canvas" data-id="${esc(c.id)}"></canvas><div class="feed-label">${esc(c.id)} · ${esc(c.name.toUpperCase())}</div><div class="feed-live">${c.status === "Offline" ? "NO SIGNAL" : "● SIMULATED LIVE"}</div><div class="feed-corner">${esc(c.zone)} · ${new Date().toLocaleDateString()}</div></div><div class="feed-meta">${cameraStatus(c)}<div><strong>${esc(c.name)}</strong><small>${esc(c.protocol)} adapter · ${esc(c.department)}</small></div><span class="status ${esc(c.status)}">${esc(c.status)}</span></div></article>`,
      )
      .join("") ||
    '<div class="panel empty-state">No cameras match the selected filters.</div>';
  startCanvases();
}
let raf = [];
function startCanvases() {
  raf.forEach(cancelAnimationFrame);
  raf = [];
  $$(".feed-canvas").forEach((canvas, i) => {
    const ctx = canvas.getContext("2d");
    let tick = 0;
    function draw() {
      const rect = canvas.getBoundingClientRect(),
        dpr = window.devicePixelRatio || 1;
      if (
        canvas.width !== rect.width * dpr ||
        canvas.height !== rect.height * dpr
      ) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width,
        h = rect.height;
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#3b5553");
      sky.addColorStop(0.52, "#809088");
      sky.addColorStop(0.53, "#353d39");
      sky.addColorStop(1, "#202927");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#a7aaa0";
      ctx.fillRect(0, h * 0.43, w, h * 0.14);
      ctx.fillStyle = "#333c38";
      ctx.fillRect(0, h * 0.57, w, h * 0.43);
      ctx.fillStyle = "#d1c9a5";
      for (let j = -1; j < 7; j++)
        ctx.fillRect((j * 65 - tick * 0.35) % (w + 70), h * 0.755, 30, 2);
      for (let b = 0; b < 5; b++) {
        let x =
            ((b * 115 + tick * (b % 2 ? -0.38 : 0.5) + i * 39) % (w + 100)) -
            48,
          y = h * 0.69 + (b % 2) * 34;
        ctx.fillStyle = ["#c46f4e", "#d6d5c7", "#5283a0", "#c7a03e", "#819a7f"][
          b
        ];
        ctx.beginPath();
        ctx.roundRect(x, y, 37, 14, 3);
        ctx.fill();
        ctx.fillStyle = "#e5c894";
        ctx.fillRect(x + 5, y + 2, 9, 5);
        ctx.fillRect(x + 21, y + 2, 9, 5);
        ctx.fillStyle = "#171b19";
        ctx.fillRect(x + 5, y + 12, 7, 4);
        ctx.fillRect(x + 26, y + 12, 7, 4);
      }
      ctx.strokeStyle = "#ffffff44";
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(0, h * 0.57);
      ctx.lineTo(w, h * 0.57);
      ctx.stroke();
      ctx.setLineDash([]);
      tick += 1;
      raf[i] = requestAnimationFrame(draw);
    }
    draw();
  });
}
function renderAlerts() {
  const items = state.alerts.filter((a) => a.status !== "Resolved").slice(0, 7);
  $("#alertList").innerHTML = items.length
    ? items
        .map(
          (a) =>
            `<div class="alert-item"><div class="alert-mark">!</div><div class="alert-copy"><b>${esc(a.vehicle_number)} <span class="status ${a.priority === "High" ? "Offline" : "Degraded"}">${esc(a.priority)}</span></b><p>${esc(a.camera_name)} · ${esc(a.reason)}</p><small>${time(a.timestamp)} · ${Math.round(a.confidence * 100)}% confidence</small>${a.status === "Open" ? `<div class="alert-actions"><button class="mini-button" data-alert="${a.id}" data-status="Acknowledged">Acknowledge</button><button class="mini-button" data-alert="${a.id}" data-status="Resolved">Resolve</button></div>` : `<div class="alert-actions"><span class="tag">${esc(a.status.toUpperCase())}</span></div>`}</div></div>`,
        )
        .join("")
    : '<div class="empty-state">No active watchlist matches. Generate a demo event to see the alert flow.</div>';
}
function renderDetections() {
  const rows = state.events.slice(0, 12);
  $("#detectionRows").innerHTML =
    rows
      .map(
        (e) =>
          `<tr><td><button class="entity-link" data-trace="${esc(e.vehicle_number)}">${esc(e.vehicle_number)}</button></td><td>${esc(e.camera_name || e.camera_id)}</td><td>${esc(e.event_type)}</td><td class="confidence">${Math.round(e.confidence * 100)}%</td><td>${time(e.timestamp)}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="5" class="empty-state">No events yet. Use “Generate detection” or POST /api/events.</td></tr>';
}
function renderDetectionHistory() {
  const term = $("#historySearch")?.value.trim().toUpperCase() || "",
    camera = $("#historyCamera")?.value || "";
  const cams = [...new Set(state.cameras.map((c) => c.id))];
  if (
    $("#historyCamera") &&
    $("#historyCamera").options.length !== cams.length + 1
  ) {
    $("#historyCamera").innerHTML =
      '<option value="">All cameras</option>' +
      cams
        .map(
          (id) =>
            `<option value="${esc(id)}">${esc(id)} · ${esc(state.cameras.find((c) => c.id === id)?.name || "")}</option>`,
        )
        .join("");
  }
  const rows = state.historyEvents.filter(
    (e) =>
      (!term || e.vehicle_number.includes(term)) &&
      (!camera || e.camera_id === camera),
  );
  $("#historyCount").textContent =
    `Showing ${rows.length} of ${state.historyEvents.length} loaded events`;
  $("#allDetectionRows").innerHTML =
    rows
      .map(
        (e) =>
          `<tr><td><button class="entity-link" data-track-entity="${esc(e.vehicle_number)}">${esc(e.vehicle_number)}</button></td><td>${esc(e.camera_name)} <small>${esc(e.camera_id)}</small></td><td>${esc(e.event_type)}</td><td>${esc(e.vehicle_type)}</td><td class="confidence">${Math.round(e.confidence * 100)}%</td><td>${date(e.timestamp)}</td><td><button class="mini-button" data-track-entity="${esc(e.vehicle_number)}">Trace vehicle</button></td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="7" class="empty-state">No matching detection events. Generate a detection to start a history.</td></tr>';
}
function renderEntities() {
  const term = $("#entitySearch")?.value.trim().toUpperCase() || "";
  const rows = state.entities.filter(
    (e) => !term || e.vehicle_number.includes(term),
  );
  $("#entityCount").textContent = `${rows.length} vehicles`;
  $("#entityRows").innerHTML =
    rows
      .map(
        (e) =>
          `<tr><td><strong>${esc(e.vehicle_number)}</strong></td><td>${e.detection_count}</td><td>${date(e.first_seen)}</td><td>${date(e.last_seen)}</td><td>${esc(e.last_camera)} <small>${esc(e.last_camera_id)}</small></td><td><button class="mini-button" data-track-entity="${esc(e.vehicle_number)}">Trace →</button></td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="6" class="empty-state">No vehicle detections have been recorded yet. Generate a demo event or ingest an ANPR event.</td></tr>';
}
function renderAlertsCenter() {
  const filter = $("#alertFilter")?.value || "";
  const rows = state.alerts.filter((a) => !filter || a.status === filter);
  $("#allAlertList").innerHTML = rows.length
    ? rows
        .map(
          (a) =>
            `<div class="alert-item"><div class="alert-mark">!</div><div class="alert-copy"><b>${esc(a.vehicle_number)} <span class="status ${a.priority === "High" ? "Offline" : "Degraded"}">${esc(a.priority)}</span></b><p>${esc(a.camera_name)} · ${esc(a.reason)} · ${esc(a.entity_type)}</p><small>${date(a.timestamp)} · ${Math.round(a.confidence * 100)}% confidence</small><div class="alert-actions"><span class="tag">${esc(a.status.toUpperCase())}</span>${a.status !== "Resolved" ? `<button class="mini-button" data-alert="${a.id}" data-status="${a.status === "Open" ? "Acknowledged" : "Resolved"}">${a.status === "Open" ? "Acknowledge" : "Resolve"}</button>` : ""}<button class="mini-button" data-track-entity="${esc(a.vehicle_number)}">Trace vehicle</button></div></div></div>`,
        )
        .join("")
    : '<div class="empty-state">No alerts match this filter.</div>';
}
function renderCameras() {
  const term = $("#registrySearch")?.value.toLowerCase() || "",
    filter = $("#registryFilter")?.value || "";
  const cams = state.cameras.filter(
    (c) =>
      (!filter || c.status === filter) &&
      (!term || JSON.stringify(c).toLowerCase().includes(term)),
  );
  $("#registryCount").textContent = `${cams.length} cameras`;
  $("#cameraRows").innerHTML =
    cams
      .map(
        (c) =>
          `<tr><td>${cameraStatus(c)} <strong>${esc(c.id)}</strong><br><small>${esc(c.name)}</small></td><td>${esc(c.department)}<br><small>${esc(c.zone)}</small></td><td>${esc(c.protocol)}<br><small>${esc(c.endpoint_ref)}</small></td><td>${Number(c.latitude).toFixed(4)}, ${Number(c.longitude).toFixed(4)}</td><td><span class="status ${esc(c.status)}">${esc(c.status)}</span></td><td>${date(c.last_heartbeat)}</td><td>${state.user === "admin" ? `<button class="mini-button" data-edit-camera="${esc(c.id)}">Edit</button>` : ""}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="7" class="empty-state">No cameras found.</td></tr>';
  $(`#cameraTotal`).textContent = state.cameras.length;
}
function renderWatchlist() {
  $("#watchCount").textContent =
    `${state.watchlist.filter((w) => w.active).length} active`;
  $("#cameraTotal").textContent = state.cameras.length;
  $("#watchRows").innerHTML =
    state.watchlist
      .map(
        (w) =>
          `<tr><td><strong>${esc(w.identifier)}</strong></td><td>${esc(w.entity_type)}</td><td>${esc(w.reason)}</td><td><span class="status ${w.priority === "High" ? "Offline" : "Degraded"}">${esc(w.priority)}</span></td><td><span class="status ${w.active ? "Online" : "Offline"}">${w.active ? "Active" : "Disabled"}</span></td><td>${date(w.created_at)}</td><td>${state.user === "admin" ? `<button class="mini-button" data-watch="${w.id}" data-active="${w.active ? "false" : "true"}">${w.active ? "Disable" : "Enable"}</button>` : ""}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="7" class="empty-state">Watchlist is empty.</td></tr>';
}
function renderAudit() {
  $("#auditList").innerHTML =
    state.audit
      .map(
        (a) =>
          `<div class="audit-row"><time>${date(a.timestamp)}</time><b>${esc(a.action.replaceAll(".", " · "))}</b><small>${esc(a.actor)} · ${esc(a.target)}</small></div>`,
      )
      .join("") ||
    '<div class="empty-state">No administrative activity yet.</div>';
}
function renderAuditAll() {
  renderAudit();
  $("#auditAllList").innerHTML =
    state.audit
      .map(
        (a) =>
          `<div class="audit-row"><time>${date(a.timestamp)}</time><b>${esc(a.action.replaceAll(".", " · "))}</b><small>${esc(a.actor)} · ${esc(a.target)} · ${esc(a.details)}</small></div>`,
      )
      .join("") || '<div class="empty-state">No recorded activity yet.</div>';
}
function renderAll() {
  renderStats();
  renderFeeds();
  renderAlerts();
  renderDetections();
  renderCameras();
  renderWatchlist();
  renderAuditAll();
  renderDetectionHistory();
  renderEntities();
  renderAlertsCenter();
  if (state.map) state.cameras.forEach(upsertMarker);
}
async function refresh() {
  const [d, history, entities] = await Promise.all([
    api("/api/bootstrap"),
    api("/api/events?limit=1000"),
    api("/api/entities"),
  ]);
  state.cameras = d.cameras;
  state.events = d.detections;
  state.historyEvents = history.items;
  state.entities = entities.items;
  state.alerts = d.alerts;
  state.watchlist = d.watchlist;
  state.audit = d.audit;
  renderAll();
}
function view(name) {
  $$(".content").forEach((el) =>
    el.classList.toggle("hidden", el.id !== `${name}View`),
  );
  $$(".nav").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name),
  );
  $("#pageName").textContent = name.replaceAll("_", " ").toUpperCase();
  if (name === "overview") {
    initMap();
    setTimeout(() => state.map?.invalidateSize(), 100);
  }
  if (name === "tracking") {
    initTrackingMap();
    setTimeout(() => state.trackingMap?.invalidateSize(), 100);
  }
}
function showModal(html) {
  $("#modalContent").innerHTML = html;
  $("#modal").classList.remove("hidden");
}
function closeModal() {
  $("#modal").classList.add("hidden");
}
function cameraForm(cam = {}) {
  showModal(
    `<h2>${cam.id ? "Edit camera" : "Onboard camera"}</h2><p>Register a camera source and its location metadata.</p><form id="cameraForm"><div class="form-grid"><label>Camera ID<input name="id" value="${esc(cam.id || "")}" ${cam.id ? "readonly" : ""} required placeholder="C005"></label><label>Name<input name="name" value="${esc(cam.name || "")}" required></label><label>Department<input name="department" value="${esc(cam.department || "")}" required></label><label>Zone<input name="zone" value="${esc(cam.zone || "")}" required></label><label>Latitude<input name="latitude" type="number" step="any" value="${esc(cam.latitude ?? "23.02")}" required></label><label>Longitude<input name="longitude" type="number" step="any" value="${esc(cam.longitude ?? "72.57")}" required></label><label>Camera type<input name="camera_type" value="${esc(cam.camera_type || "Traffic")}" required></label><label>Protocol<select name="protocol"><option ${cam.protocol === "SIMULATOR" ? "selected" : ""}>SIMULATOR</option><option ${cam.protocol === "RTSP" ? "selected" : ""}>RTSP</option><option ${cam.protocol === "ONVIF" ? "selected" : ""}>ONVIF</option><option ${cam.protocol === "HLS" ? "selected" : ""}>HLS</option></select></label><label class="full">Stream endpoint reference<input name="endpoint_ref" value="${esc(cam.endpoint_ref || "sim://ahmedabad/new-camera")}" required><small>Use a non-secret adapter reference; credentials belong in a secrets manager.</small></label><label>Storage metadata<input name="storage" value="${esc(cam.storage || "Edge buffer 24h")}"></label>${cam.id ? `<label>Status<select name="status"><option ${cam.status === "Online" ? "selected" : ""}>Online</option><option ${cam.status === "Degraded" ? "selected" : ""}>Degraded</option><option ${cam.status === "Offline" ? "selected" : ""}>Offline</option></select></label>` : ""}</div><button class="primary modal-submit">${cam.id ? "Save camera" : "Add camera"}</button></form>`,
  );
  $("#cameraForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (cam.id) {
        delete body.id;
        await api(`/api/cameras/${encodeURIComponent(cam.id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else
        await api("/api/cameras", {
          method: "POST",
          body: JSON.stringify(body),
        });
      closeModal();
      await refresh();
      toast(cam.id ? "Camera updated" : "Camera onboarded");
    } catch (err) {
      toast(err.message);
    }
  };
}
function watchForm() {
  showModal(
    `<h2>Add watchlist identifier</h2><p>Use synthetic identifiers only in this demonstration.</p><form id="watchForm"><div class="form-grid"><label>Identifier<input name="identifier" placeholder="GJ01AB1234" required></label><label>Entity type<select name="entity_type"><option>Vehicle</option><option>Person</option></select></label><label class="full">Reason<input name="reason" value="Synthetic demonstration record" required></label><label>Priority<select name="priority"><option>High</option><option selected>Medium</option><option>Low</option></select></label></div><button class="primary modal-submit">Add identifier</button></form>`,
  );
  $("#watchForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("/api/watchlist", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      closeModal();
      await refresh();
      toast("Watchlist identifier added");
    } catch (err) {
      toast(err.message);
    }
  };
}
async function makeDemoEvent() {
  const cams = state.cameras.filter((c) => c.status !== "Offline");
  if (!cams.length) return toast("No online cameras available");
  const matching = Math.random() < 0.58;
  const vehicle = matching
    ? Math.random() < 0.7
      ? "GJ01AB1234"
      : "GJ05CD6789"
    : `GJ${String(Math.floor(Math.random() * 10)).padStart(2, "0")}XY${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const cam = cams[Math.floor(Math.random() * cams.length)];
  try {
    const r = await api("/api/events", {
      method: "POST",
      body: JSON.stringify({
        camera_id: cam.id,
        timestamp: new Date().toISOString(),
        vehicle_number: vehicle,
        confidence: 0.88 + Math.random() * 0.11,
        vehicle_type: ["Car", "Motorcycle", "Truck"][
          Math.floor(Math.random() * 3)
        ],
        event_type: "ANPR",
        bounding_box: { x: 0.34, y: 0.46, width: 0.2, height: 0.14 },
        source_id: `demo-${crypto.randomUUID()}`,
      }),
    });
    await refresh();
    toast(
      r.alert
        ? `Watchlist match: ${vehicle} · alert created`
        : `Detection received: ${vehicle}`,
    );
  } catch (e) {
    toast(e.message);
  }
}
async function trace(q) {
  if (!q) return;
  try {
    const r = await api(`/api/entities/search?q=${encodeURIComponent(q)}`),
      detail = $("#trackingRoute"),
      summary = $("#traceResult");
    if (!r.events.length) {
      const message = `No movement history found for <b>${esc(r.query)}</b>.`;
      if (detail) {
        detail.className = "trace-result empty";
        detail.innerHTML = message + " Generate a detection first.";
      }
      if (summary) {
        summary.className = "trace-result empty";
        summary.innerHTML =
          message + " Generate a matching demo detection first.";
      }
      return;
    }
    const heading = `<div class="trace-head"><b>${esc(r.query)}</b><span>${r.events.length} recorded sighting${r.events.length === 1 ? "" : "s"}</span></div>`,
      stops = r.events
        .map(
          (e, i) =>
            `<div class="trace-stop"><span class="trace-pin"></span><div><b>${i + 1}. ${esc(e.camera_name)} <small>${esc(e.camera_id)}</small></b><small>${date(e.timestamp)} · ${Number(e.latitude).toFixed(4)}, ${Number(e.longitude).toFixed(4)} · ${Math.round(e.confidence * 100)}%</small></div></div>`,
        )
        .join("");
    if (detail) {
      detail.className = "trace-result";
      detail.innerHTML = heading + stops;
      $("#trackingTitle").textContent = `Movement timeline · ${r.query}`;
      $("#trackingSubtitle").textContent =
        `${r.events.length} saved detection${r.events.length === 1 ? "" : "s"} in chronological order.`;
      $("#trackingInput").value = q;
    }
    if (summary) {
      summary.className = "trace-result";
      summary.innerHTML = heading + stops;
    }
    const trackingVisible = !$("#trackingView").classList.contains("hidden"),
      map = trackingVisible ? state.trackingMap : state.map;
    if (map && window.L) {
      const layerKey = trackingVisible
        ? "trackingTraceLayer"
        : "overviewTraceLayer";
      if (state[layerKey]) map.removeLayer(state[layerKey]);
      const layer = L.layerGroup().addTo(map),
        points = r.events.map((e) => [Number(e.latitude), Number(e.longitude)]);
      if (points.length > 1)
        L.polyline(points, {
          color: "#2c8758",
          weight: 4,
          dashArray: "6 5",
        }).addTo(layer);
      r.events.forEach((e, i) =>
        L.circleMarker([e.latitude, e.longitude], {
          radius: 7,
          color: "#fff",
          weight: 2,
          fillColor: "#258553",
          fillOpacity: 1,
        })
          .bindPopup(
            `<b>${i + 1}. ${esc(e.camera_name)}</b><br>${date(e.timestamp)}<br>${esc(r.query)}`,
          )
          .addTo(layer),
      );
      state[layerKey] = layer;
      map.fitBounds(points, { padding: [30, 30], maxZoom: 14 });
    }
  } catch (e) {
    toast(e.message);
  }
}
async function consumeStream() {
  while (state.token) {
    try {
      const response = await fetch("/api/events/stream", {
        headers: { Authorization: `Bearer ${state.token}` },
      });
      if (!response.ok) throw Error("stream disconnected");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop();
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const msg = JSON.parse(line.slice(6));
          const d = msg.data;
          if (msg.type === "detection") {
            state.events.unshift(d);
            state.events = state.events.slice(0, 60);
            renderStats();
            renderDetections();
            toast(`New detection: ${d.vehicle_number} · ${d.camera_id}`);
          }
          if (msg.type === "alert") {
            const ix = state.alerts.findIndex((a) => a.id === d.id);
            ix >= 0 ? (state.alerts[ix] = d) : state.alerts.unshift(d);
            renderStats();
            renderAlerts();
            toast(`⚠ Watchlist alert: ${d.vehicle_number}`);
          }
          if (msg.type === "camera") {
            const ix = state.cameras.findIndex((c) => c.id === d.id);
            ix >= 0 ? (state.cameras[ix] = d) : state.cameras.push(d);
            renderStats();
            renderFeeds();
            renderCameras();
            upsertMarker(d);
          }
          if (msg.type === "watchlist") {
            state.watchlist.unshift(d);
            renderWatchlist();
          }
        }
      }
    } catch (e) {
      if (!state.token) return;
      await new Promise((r) => setTimeout(r, 1800));
    }
  }
}
async function login(username, password) {
  const r = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "Login failed");
  state.token = d.token;
  state.user = d.user;
  $("#login").classList.add("hidden");
  $("#app").classList.remove("hidden");
  $("#accountName").textContent = d.user === "admin" ? "Admin" : "Operator";
  $("#greeting").textContent =
    `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, ${d.user}`;
  $$(".admin-only").forEach((el) =>
    el.classList.toggle("hidden", d.role !== "admin"),
  );
  await refresh();
  view("overview");
  consumeStream();
}
$("#loginForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const d = Object.fromEntries(new FormData(e.currentTarget));
    await login(d.username, d.password);
  } catch (err) {
    $("#loginError").textContent = err.message;
  }
};
$("#logout").onclick = () => {
  state.token = "";
  $("#app").classList.add("hidden");
  $("#login").classList.remove("hidden");
};
$$(".nav").forEach((b) => (b.onclick = () => view(b.dataset.view)));
$$('[data-view="overview"].text-button').forEach(
  (b) => (b.onclick = () => view("overview")),
);
$("#demoEvent").onclick = makeDemoEvent;
$("#addCamera").onclick = () => cameraForm();
$("#addWatchlist").onclick = watchForm();
$("#closeModal").onclick = closeModal;
$(".modal-backdrop").onclick = closeModal;
$("#cameraSearch").oninput = renderFeeds;
$("#cameraFilter").onchange = renderFeeds;
$("#registrySearch").oninput = renderCameras;
$("#registryFilter").onchange = renderCameras;
$("#traceForm").onsubmit = (e) => {
  e.preventDefault();
  trace($("#traceInput").value.trim().toUpperCase());
};
document.addEventListener("click", async (e) => {
  const tr = e.target.closest("[data-trace]");
  if (tr) {
    $("#traceInput").value = tr.dataset.trace;
    trace(tr.dataset.trace);
    return;
  }
  const al = e.target.closest("[data-alert]");
  if (al) {
    try {
      await api(`/api/alerts/${al.dataset.alert}`, {
        method: "PATCH",
        body: JSON.stringify({ status: al.dataset.status }),
      });
      await refresh();
      toast(`Alert ${al.dataset.status.toLowerCase()}`);
    } catch (err) {
      toast(err.message);
    }
    return;
  }
  const ec = e.target.closest("[data-edit-camera]");
  if (ec) {
    const cam = state.cameras.find((c) => c.id === ec.dataset.editCamera);
    cameraForm(cam);
    return;
  }
  const wl = e.target.closest("[data-watch]");
  if (wl) {
    try {
      await api(`/api/watchlist/${wl.dataset.watch}`, {
        method: "PATCH",
        body: JSON.stringify({ active: wl.dataset.active === "true" }),
      });
      await refresh();
      toast("Watchlist status updated");
    } catch (err) {
      toast(err.message);
    }
  }
});
setInterval(
  () =>
    ($("#clock").textContent = new Date().toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })),
  1000,
);

// Keep the new full-history pages in sync with the existing live event handlers.
const renderDetectionsBase = renderDetections;
renderDetections = function () {
  renderDetectionsBase();
  for (const event of state.events) {
    const isNew = !state.historyEvents.some((old) => old.id === event.id);
    if (isNew) state.historyEvents.unshift(event);
    let entity = state.entities.find(
      (item) => item.vehicle_number === event.vehicle_number,
    );
    if (!entity) {
      entity = {
        vehicle_number: event.vehicle_number,
        detection_count: 1,
        first_seen: event.timestamp,
        last_seen: event.timestamp,
        last_camera: event.camera_name || event.camera_id,
        last_camera_id: event.camera_id,
        latitude: event.latitude,
        longitude: event.longitude,
      };
      state.entities.unshift(entity);
    } else if (isNew) {
      entity.detection_count += 1;
      if (event.timestamp >= entity.last_seen) {
        entity.last_seen = event.timestamp;
        entity.last_camera = event.camera_name || event.camera_id;
        entity.last_camera_id = event.camera_id;
        entity.latitude = event.latitude;
        entity.longitude = event.longitude;
      }
      if (event.timestamp < entity.first_seen)
        entity.first_seen = event.timestamp;
    }
  }
  state.historyEvents = state.historyEvents.slice(0, 1000);
  renderDetectionHistory();
  renderEntities();
};
const renderAlertsBase = renderAlerts;
renderAlerts = function () {
  renderAlertsBase();
  renderAlertsCenter();
};
trace = async function (query) {
  let plate = String(query || "")
    .trim()
    .toUpperCase();
  if (!plate) return;
  if (!state.entities.some((entity) => entity.vehicle_number === plate))
    await refresh();
  if (!state.entities.some((entity) => entity.vehicle_number === plate)) {
    view("tracking");
    $("#entitySearch").value = plate;
    renderEntities();
    const matches = state.entities.filter((entity) =>
      entity.vehicle_number.includes(plate),
    );
    $("#trackingRoute").className = "trace-result empty";
    $("#trackingRoute").innerHTML = matches.length
      ? `Found ${matches.length} possible vehicle${matches.length === 1 ? "" : "s"}. Select the exact vehicle number and use Trace to avoid combining different vehicles.`
      : `No recorded vehicle matches <b>${esc(plate)}</b>. Generate a detection first.`;
    return;
  }
  try {
    const result = await api(
        `/api/entities/search?q=${encodeURIComponent(plate)}&exact=true`,
      ),
      detail = $("#trackingRoute"),
      summary = $("#traceResult");
    if (!result.events.length) {
      toast("No detections are recorded for this vehicle");
      return;
    }
    const heading = `<div class="trace-head"><b>${esc(plate)}</b><span>${result.events.length} recorded sighting${result.events.length === 1 ? "" : "s"}</span></div>`;
    const stops = result.events
      .map(
        (event, index) =>
          `<div class="trace-stop"><span class="trace-pin"></span><div><b>${index + 1}. ${esc(event.camera_name)} <small>${esc(event.camera_id)}</small></b><small>${date(event.timestamp)} · ${Number(event.latitude).toFixed(4)}, ${Number(event.longitude).toFixed(4)} · ${Math.round(event.confidence * 100)}%</small></div></div>`,
      )
      .join("");
    detail.className = "trace-result";
    detail.innerHTML = heading + stops;
    $("#trackingTitle").textContent = `Movement timeline · ${plate}`;
    $("#trackingSubtitle").textContent =
      `All ${result.events.length} saved detection${result.events.length === 1 ? "" : "s"}, oldest first.`;
    $("#trackingInput").value = plate;
    if (summary) {
      summary.className = "trace-result";
      summary.innerHTML = heading + stops;
    }
    const trackingVisible = !$("#trackingView").classList.contains("hidden"),
      map = trackingVisible ? state.trackingMap : state.map;
    if (map && window.L) {
      const key = trackingVisible ? "trackingTraceLayer" : "overviewTraceLayer";
      if (state[key]) map.removeLayer(state[key]);
      const group = L.layerGroup().addTo(map),
        points = result.events.map((event) => [
          Number(event.latitude),
          Number(event.longitude),
        ]);
      if (points.length > 1)
        L.polyline(points, {
          color: "#2c8758",
          weight: 4,
          dashArray: "6 5",
        }).addTo(group);
      result.events.forEach((event, index) =>
        L.circleMarker([event.latitude, event.longitude], {
          radius: 7,
          color: "#fff",
          weight: 2,
          fillColor: "#258553",
          fillOpacity: 1,
        })
          .bindPopup(
            `<b>${index + 1}. ${esc(event.camera_name)}</b><br>${date(event.timestamp)}<br>${esc(plate)}`,
          )
          .addTo(group),
      );
      state[key] = group;
      map.fitBounds(points, { padding: [30, 30], maxZoom: 14 });
      setTimeout(() => map.invalidateSize(), 100);
    }
  } catch (error) {
    toast(error.message);
  }
};
$("#historySearch").oninput = renderDetectionHistory;
$("#historyCamera").onchange = renderDetectionHistory;
$("#entitySearch").oninput = renderEntities;
$("#alertFilter").onchange = renderAlertsCenter;
$("#trackingForm").onsubmit = (event) => {
  event.preventDefault();
  trace($("#trackingInput").value);
};
$$(".text-button[data-view]").forEach(
  (button) => (button.onclick = () => view(button.dataset.view)),
);
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-track-entity]");
  if (!target) return;
  const plate = target.dataset.trackEntity;
  view("tracking");
  $("#entitySearch").value = "";
  renderEntities();
  trace(plate);
});
