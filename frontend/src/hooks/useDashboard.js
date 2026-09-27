import { useEffect, useMemo, useRef, useState } from "react";
import { centers, vehicleOf } from "../utils/dashboard.js";
export default function useDashboard() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("Overview");
  const [center, setCenter] = useState(centers[0]);
  const [allowedCenters, setAllowedCenters] = useState([centers[0]]);
  const [data, setData] = useState({
    cameras: [],
    detections: [],
    alerts: [],
    watchlist: [],
    audit: []
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [traceQuery, setTraceQuery] = useState("");
  const [entityQuery, setEntityQuery] = useState("");
  const [entities, setEntities] = useState([]);
  const [traceEvents, setTraceEvents] = useState([]);
  const [alertQuery, setAlertQuery] = useState("");
  const [alertStatus, setAlertStatus] = useState("All statuses");
  const [selectedVehicle, setSelectedVehicle] = useState("");
  const [alertVehicleState, setAlertVehicleState] = useState("Active");
  const [watchlistFilter, setWatchlistFilter] = useState("Active");
  const [showIdentifier, setShowIdentifier] = useState(false);
  const [identifier, setIdentifier] = useState({
    identifier: "",
    entity_type: "Vehicle",
    reason: "",
    priority: "Medium"
  });
  const [showCamera, setShowCamera] = useState(false);
  const [cameraDraft, setCameraDraft] = useState({
    id: "",
    name: "",
    department: "Traffic Control",
    latitude: "",
    longitude: "",
    camera_type: "Traffic",
    protocol: "SIMULATOR",
    endpoint_ref: "sim://new-camera",
    zone: "Central Zone"
  });
  const [login, setLogin] = useState({
    username: "",
    password: ""
  });
  const mapAnchor = useRef(null);
  const selectedCenter = center || centers[0];
  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Command-Center-ID": center.id,
        ...(token ? {
          Authorization: `Bearer ${token}`
        } : {}),
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  };
  const load = async (auth = token) => {
    if (!auth) return;
    setLoading(true);
    try {
      const response = await fetch("/api/bootstrap", {
        headers: {
          Authorization: `Bearer ${auth}`,
          "X-Command-Center-ID": center.id
        }
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load dashboard");
      setData({
        cameras: body.cameras || [],
        detections: body.detections || [],
        alerts: body.alerts || [],
        watchlist: body.watchlist || [],
        audit: body.audit || []
      });
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (token) load();
  }, [token, center]);
  useEffect(() => {
    if (!token) return;
    let active = true;
    const controller = new AbortController();
    const connect = async () => {
      try {
        const response = await fetch("/api/events/stream", {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Command-Center-ID": center.id
          },
          signal: controller.signal
        });
        if (!response.ok || !response.body) throw new Error("Live updates disconnected");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (active) {
          const {
            value,
            done
          } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, {
            stream: true
          });
          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = chunks.pop() || "";
          for (const chunk of chunks) {
            const line = chunk.split(/\r?\n/).find(row => row.startsWith("data: "));
            if (!line) continue;
            const message = JSON.parse(line.slice(6));
            if (["camera", "detection", "alert", "watchlist"].includes(message.type)) void load(token);
          }
        }
      } catch (error) {
        if (active && error.name !== "AbortError") {
          await new Promise(resolve => setTimeout(resolve, 1500));
          if (active) void connect();
        }
      }
    };
    void connect();
    return () => {
      active = false;
      controller.abort();
    };
  }, [token, center.id]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }, [page]);
  useEffect(() => {
    if (page === "Vehicle Tracking" && traceQuery) {
      const t = setTimeout(() => mapAnchor.current?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      }), 220);
      return () => clearTimeout(t);
    }
  }, [page, traceQuery, traceEvents]);
  const doLogin = async e => {
    e.preventDefault();
    setError("");
    let response;
    try {
      response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(login)
      });
    } catch {
      setError("Service is offline. Start the server and try again.");
      return;
    }
    let body = {};
    try {
      body = await response.json();
    } catch {}
    if (response.status === 401) {
      setError("Wrong username or password. Please try again.");
      return;
    }
    if (!response.ok) {
      setError([502, 503, 504].includes(response.status) ? "Service is offline. Start the server and try again." : "Unable to sign in right now. Please try again.");
      return;
    }
    const allowed = (body.command_centers || []).map(c => centers.find(x => x.id === c.id) || {
      id: c.id,
      name: c.name,
      state: c.state,
      coords: [c.latitude, c.longitude]
    });
    setAllowedCenters(allowed.length ? allowed : [centers[0]]);
    setCenter(allowed[0] || centers[0]);
    setUser({
      username: body.user,
      role: body.role
    });
    setToken(body.token);
    setPage("Overview");
    setSelectedVehicle("");
    setAlertQuery("");
    setTraceQuery("");
    setEntities([]);
    setTraceEvents([]);
  };
  const signOut = () => {
    setToken("");
    setUser(null);
    setData({
      cameras: [],
      detections: [],
      alerts: [],
      watchlist: [],
      audit: []
    });
    setEntities([]);
    setEntityQuery("");
    setTraceEvents([]);
    setSelectedVehicle("");
    setAlertQuery("");
    setAlertStatus("All statuses");
    setTraceQuery("");
    setError("");
    setToast("");
    setShowIdentifier(false);
    setShowCamera(false);
    setPage("Overview");
    setCenter(centers[0]);
  };
  const showTrace = async vehicle => {
    const plate = vehicleOf({
      vehicle_number: vehicle
    }).toUpperCase();
    setTraceQuery(plate);
    setEntityQuery(plate);
    setPage("Vehicle Tracking");
    try {
      const r = await api(`/api/entities/search?q=${encodeURIComponent(plate)}&exact=true`);
      setTraceEvents(r.events || []);
      setEntities([{
        vehicle_number: plate,
        detection_count: r.events?.length || 0
      }]);
    } catch (e) {
      setTraceEvents([]);
      setError(e.message);
    }
  };
  const searchEntities = async (q = entityQuery) => {
    setEntityQuery(q);
    if (!q.trim()) {
      setEntities([]);
      return;
    }
    try {
      const r = await api(`/api/entities?q=${encodeURIComponent(q)}`);
      setEntities(r.items || []);
    } catch (e) {
      setError(e.message);
    }
  };
  const traceSelected = async v => {
    await showTrace(v);
    setTimeout(() => mapAnchor.current?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    }), 300);
  };
  const addIdentifier = async e => {
    e.preventDefault();
    try {
      await api("/api/watchlist", {
        method: "POST",
        body: JSON.stringify(identifier)
      });
      setIdentifier({
        identifier: "",
        entity_type: "Vehicle",
        reason: "",
        priority: "Medium"
      });
      setShowIdentifier(false);
      setToast("Identifier added to watchlist");
      await load();
    } catch (err) {
      setError(err.message);
    }
  };
  const simulateDetection = async () => {
    const availableCameras = data.cameras.filter(camera => camera.status !== "Offline");
    if (!availableCameras.length) {
      setError("There are no online cameras in this command center.");
      return;
    }
    const activeEntries = data.watchlist.filter(item => item.active);
    const matching = activeEntries.length > 0 && Math.random() < 0.58;
    const watched = activeEntries[Math.floor(Math.random() * activeEntries.length)];
    const vehicle = matching ? watched.identifier : `GJ${String(Math.floor(Math.random() * 10)).padStart(2, "0")}XY${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const camera = availableCameras[Math.floor(Math.random() * availableCameras.length)];
    try {
      const result = await api("/api/events", {
        method: "POST",
        body: JSON.stringify({
          camera_id: camera.id,
          timestamp: new Date().toISOString(),
          vehicle_number: vehicle,
          confidence: Number((0.88 + Math.random() * 0.11).toFixed(2)),
          vehicle_type: ["Car", "Motorcycle", "Truck"][Math.floor(Math.random() * 3)],
          event_type: "ANPR",
          bounding_box: {
            x: 0.34,
            y: 0.46,
            width: 0.2,
            height: 0.14
          },
          source_id: `demo-${crypto.randomUUID()}`
        })
      });
      await load();
      setToast(result.alert ? `Watchlist match: ${vehicle} · alert created` : `Detection received: ${vehicle}`);
    } catch (error) {
      setError(error.message);
    }
  };
  const addCamera = async e => {
    e.preventDefault();
    try {
      await api("/api/cameras", {
        method: "POST",
        body: JSON.stringify(cameraDraft)
      });
      setShowCamera(false);
      setCameraDraft({
        id: "",
        name: "",
        department: "Traffic Control",
        latitude: "",
        longitude: "",
        camera_type: "Traffic",
        protocol: "SIMULATOR",
        endpoint_ref: "sim://new-camera",
        zone: "Central Zone"
      });
      setToast("Camera registered");
      await load();
    } catch (err) {
      setError(err.message);
    }
  };
  const updateAlert = async (a, status) => {
    try {
      await api(`/api/alerts/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status
        })
      });
      await load();
      setToast(`Alert ${status.toLowerCase()}`);
    } catch (err) {
      setError(err.message);
    }
  };
  const toggleIdentifier = async item => {
    try {
      await api(`/api/watchlist/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          active: !item.active
        })
      });
      await load();
      setToast(`${item.identifier} ${item.active ? "disabled" : "enabled"}`);
    } catch (err) {
      setError(err.message);
    }
  };
  const alerts = data.alerts || [];
  const activeWatchlist = (data.watchlist || []).filter(item => item.active);
  const recent = useMemo(() => {
    const groups = new Map();
    [...alerts].filter(a => a.identifier_active !== 0).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).forEach(a => {
      const plate = vehicleOf(a);
      if (!groups.has(plate)) groups.set(plate, {
        ...a,
        alert_count: 0
      });
      groups.get(plate).alert_count++;
    });
    return [...groups.values()].slice(0, 4);
  }, [alerts]);
  const filteredAlerts = useMemo(() => alerts.filter(a => (!selectedVehicle || vehicleOf(a) === selectedVehicle) && (!alertQuery || JSON.stringify(a).toLowerCase().includes(alertQuery.toLowerCase())) && (alertStatus === "All statuses" || a.status === alertStatus) && (alertVehicleState === "All vehicles" || (alertVehicleState === "Active" ? a.identifier_active !== 0 : a.identifier_active === 0))).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)), [alerts, selectedVehicle, alertQuery, alertStatus, alertVehicleState]);
  const visibleWatchlist = (data.watchlist || []).filter(item => watchlistFilter === "All vehicles" || (watchlistFilter === "Active" ? Boolean(item.active) : !item.active));
  const alertNumber = new Map();
  const numberedAlerts = filteredAlerts.map(a => ({
    ...a,
    instance_no: (alertNumber.set(vehicleOf(a), (alertNumber.get(vehicleOf(a)) || 0) + 1), alertNumber.get(vehicleOf(a)))
  }));
  const online = data.cameras.filter(c => c.status === "Online").length;
  const openAlerts = alerts.filter(a => a.status === "Open" && a.identifier_active !== 0).length;
  const dashboard = {
    user,
    page,
    setPage,
    selectedCenter,
    allowedCenters,
    setCenter,
    setSelectedVehicle,
    setAlertQuery,
    setAlertStatus,
    setTraceQuery,
    setTraceEvents,
    setEntities,
    setEntityQuery,
    openAlerts,
    signOut,
    setToast,
    load,
    error,
    setError,
    loading,
    toast,
    data,
    online,
    activeWatchlist,
    recent,
    selectedVehicle,
    selectRecentAlert: vehicle => {
      setSelectedVehicle(vehicle);
      setAlertQuery(vehicle);
      setAlertVehicleState("Active");
      setPage("Alert Center");
    },
    simulateDetection,
    setShowCamera,
    traceSelected,
    entities,
    entityQuery,
    searchEntities,
    traceQuery,
    mapAnchor,
    traceEvents,
    setShowIdentifier,
    alertQuery,
    alertStatus,
    alertVehicleState,
    setAlertVehicleState,
    clearAlertFilters: () => {
      setSelectedVehicle("");
      setAlertQuery("");
      setAlertStatus("All statuses");
      setAlertVehicleState("Active");
    },
    numberedAlerts,
    updateAlert,
    watchlistFilter,
    setWatchlistFilter,
    visibleWatchlist,
    toggleIdentifier,
    showIdentifier,
    identifier,
    setIdentifier,
    addIdentifier,
    showCamera,
    cameraDraft,
    setCameraDraft,
    addCamera
  };
  return {
    authenticated: Boolean(token),
    loginProps: {
      error,
      login,
      setLogin,
      doLogin
    },
    dashboard
  };
}
