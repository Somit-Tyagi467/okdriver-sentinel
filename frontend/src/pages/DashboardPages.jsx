import { Activity, AlertTriangle, CarFront, Eye, MapPinned, Plus, Search, ShieldCheck, Video } from "lucide-react";
import { Badge, Button, CameraScene, Header, Metric, Table } from "../components/ui.jsx";
import RecentAlerts from "../components/RecentAlerts.jsx";
import TrackingMap from "../components/TrackingMap.jsx";
import { useDashboard } from "../context/DashboardContext.jsx";
import { centers, cx, fmt, vehicleOf } from "../utils/dashboard.js";
function OverviewPage() {
  const {
    selectedCenter,
    data,
    online,
    openAlerts,
    activeWatchlist,
    recent,
    simulateDetection,
    setPage,
    selectedVehicle,
    selectRecentAlert
  } = useDashboard();
  return <>
    <Header title="Overview" sub={`Live monitoring summary for ${selectedCenter.name || selectedCenter.id} Command Center`} right={<div className="flex items-center gap-2"><Button kind="secondary" onClick={simulateDetection}><Activity size={16} /> Simulate detection</Button><Badge color="green"><Activity size={13} /> LIVE DEMO</Badge></div>} />
    <div className="metric-grid">
      <Metric icon={Video} label="Registered cameras" value={data.cameras.length} note={`${online} currently online`} />
      <Metric icon={Eye} label="Vehicle sightings" value={data.detections.length} note="Visible in this session" tone="violet" />
      <Metric icon={AlertTriangle} label="Open alerts" value={openAlerts} note="Require attention" tone="red" />
      <Metric icon={ShieldCheck} label="Active identifiers" value={activeWatchlist.length} note="Monitoring matches" tone="green" />
    </div>
    <RecentAlerts recent={recent} selectedVehicle={selectedVehicle} onSelect={selectRecentAlert} />
    <section className="section-card">
      <div className="section-title"><div><h2>Camera network</h2><p className="muted small">Synthetic camera previews; this demo does not stream live video.</p></div><Button kind="secondary" onClick={() => setPage("Camera Registry")}>View registry</Button></div>
      <div className="camera-grid">{data.cameras.slice(0, 6).map(camera => <div className="camera-card" key={camera.id}><CameraScene status={camera.status} /><b>{camera.name}</b><span className="muted small">{camera.id} · {camera.zone}</span></div>)}</div>
    </section>
  </>;
}
function CameraRegistryPage() {
  const {
    data,
    user,
    setShowCamera
  } = useDashboard();
  return <><Header title="Camera Registry" sub="Camera sources and current health" right={user?.role === "admin" && <Button onClick={() => setShowCamera(true)}><Plus size={16} /> Register camera</Button>} />
    <section className="section-card"><Table rows={data.cameras} columns={[{
        label: "Camera",
        render: row => <b>{row.name}</b>
      }, {
        label: "ID",
        key: "id"
      }, {
        label: "Command center",
        render: row => centers.find(item => item.id === row.command_center_id)?.name || row.command_center_id
      }, {
        label: "Department",
        key: "department"
      }, {
        label: "Zone",
        key: "zone"
      }, {
        label: "Status",
        render: row => <Badge color={row.status === "Online" ? "green" : row.status === "Degraded" ? "amber" : "red"}>{row.status}</Badge>
      }, {
        label: "Last heartbeat",
        render: row => fmt(row.last_heartbeat)
      }]} /></section>
  </>;
}
function DetectionHistoryPage() {
  const {
    data,
    traceSelected
  } = useDashboard();
  return <><Header title="Detection History" sub="Chronological vehicle sightings available to your profile" />
    <section className="section-card"><Table rows={[...data.detections].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))} columns={[{
        label: "Vehicle",
        render: row => <b>{vehicleOf(row)}</b>
      }, {
        label: "Seen at",
        render: row => fmt(row.timestamp)
      }, {
        label: "Camera",
        key: "camera_name"
      }, {
        label: "Type",
        key: "vehicle_type"
      }, {
        label: "Confidence",
        render: row => `${Math.round((row.confidence || 0) * 100)}%`
      }, {
        label: "Trace",
        render: row => <Button kind="secondary" onClick={() => traceSelected(vehicleOf(row))}>Trace</Button>
      }]} /></section>
  </>;
}
function VehicleTrackingPage() {
  const {
    selectedCenter,
    entities,
    entityQuery,
    searchEntities,
    traceQuery,
    setTraceQuery,
    traceSelected,
    mapAnchor,
    traceEvents
  } = useDashboard();
  return <><Header title="Vehicle Tracking" sub="Search the detected vehicle directory or trace a vehicle's ordered sightings" />
    <section className="section-card"><div className="search-row">
      <div className="search-box"><Search size={17} /><input placeholder="Search all detected vehicle numbers…" value={entityQuery} onChange={event => searchEntities(event.target.value)} onKeyDown={event => event.key === "Enter" && searchEntities()} /></div>
      <Button onClick={() => searchEntities()}>Search vehicles</Button>
      <div className="search-box trace-box"><MapPinned size={17} /><input placeholder="Exact vehicle number to trace" value={traceQuery} onChange={event => setTraceQuery(event.target.value.toUpperCase())} onKeyDown={event => event.key === "Enter" && traceSelected(traceQuery)} /></div>
      <Button kind="secondary" onClick={() => traceSelected(traceQuery)} disabled={!traceQuery.trim()}>Trace route</Button>
    </div>
    <div className="entity-list">{entities.map(entity => <button key={entity.vehicle_number} className={cx("entity-item", traceQuery === entity.vehicle_number && "selected")} onClick={() => traceSelected(entity.vehicle_number)}><CarFront size={18} /><b>{entity.vehicle_number}</b><span className="muted">{entity.detection_count} sightings</span><span className="muted small">Last: {fmt(entity.last_seen)}</span></button>)}</div></section>
    <section ref={mapAnchor} className="section-card tracking-layout"><div className="section-title"><div><h2>{traceQuery ? `Route for ${traceQuery}` : "Vehicle trace map"}</h2><p className="muted small">Numbered pins follow timestamp order, oldest first.</p></div>{traceQuery && <Badge color="blue">{traceEvents.length} sighting{traceEvents.length === 1 ? "" : "s"}</Badge>}</div>
      <TrackingMap events={traceEvents} center={selectedCenter.coords} />
      <div className="timeline">{traceEvents.map((event, index) => <article className="timeline-item" key={event.id || index}><span className="number-dot">{index + 1}</span><div><b>{index === 0 ? "First sighting" : `${index + 1}${["st", "nd", "rd"][index] || "th"} sighting`} · {vehicleOf(event)}</b><div className="muted small">{fmt(event.timestamp)} · {event.camera_name} · {Math.round((event.confidence || 0) * 100)}% confidence</div></div></article>)}{traceQuery && !traceEvents.length && <p className="muted">No sightings found for this exact vehicle number.</p>}</div>
    </section>
  </>;
}
function AlertCenterPage() {
  const {
    user,
    setShowIdentifier,
    recent,
    selectedVehicle,
    selectRecentAlert,
    alertQuery,
    setAlertQuery,
    alertStatus,
    setAlertStatus,
    alertVehicleState,
    setAlertVehicleState,
    clearAlertFilters,
    numberedAlerts,
    traceSelected,
    updateAlert
  } = useDashboard();
  return <><Header title="Alert Center" sub="Recent unique vehicles stay separate from the full, filterable alert history" right={user?.role === "admin" && <Button onClick={() => setShowIdentifier(true)}><Plus size={16} /> Add identifier</Button>} />
    <RecentAlerts recent={recent} selectedVehicle={selectedVehicle} onSelect={selectRecentAlert} />
    <section className="section-card"><div className="section-title"><div><h2>Alert history</h2><p className="muted small">Status and text filters apply to this list only.</p></div>
      <div className="filter-row"><div className="search-box"><Search size={16} /><input placeholder="Search vehicle, camera, reason…" value={alertQuery} onChange={event => setAlertQuery(event.target.value)} /></div>
        <select aria-label="Alert status" value={alertStatus} onChange={event => setAlertStatus(event.target.value)}><option>All statuses</option><option>Open</option><option>Acknowledged</option><option>Resolved</option></select>
        <select aria-label="Watchlist vehicle state" value={alertVehicleState} onChange={event => setAlertVehicleState(event.target.value)}><option>Active</option><option>Inactive</option><option>All vehicles</option></select>
        <Button kind="secondary" onClick={clearAlertFilters}>Clear</Button>
      </div></div>
      {selectedVehicle && <div className="filter-notice">Showing only <b>{selectedVehicle}</b> · <button onClick={clearAlertFilters}>Clear vehicle filter</button></div>}
      <Table rows={numberedAlerts} columns={[{
        label: "Instance",
        render: row => <span className="number-dot small-dot">{row.instance_no}</span>
      }, {
        label: "Vehicle",
        render: row => <b>{vehicleOf(row)}</b>
      }, {
        label: "Seen",
        render: row => fmt(row.timestamp)
      }, {
        label: "Camera",
        key: "camera_name"
      }, {
        label: "Reason",
        key: "reason"
      }, {
        label: "Priority",
        render: row => <Badge color={row.priority === "High" ? "red" : "amber"}>{row.priority}</Badge>
      }, {
        label: "Status",
        render: row => <Badge color={row.status === "Open" ? "red" : row.status === "Resolved" ? "green" : "amber"}>{row.status}</Badge>
      }, {
        label: "Actions",
        render: row => <div className="table-actions"><Button kind="secondary" onClick={() => traceSelected(vehicleOf(row))}>Trace</Button>{row.status === "Open" && <Button kind="secondary" onClick={() => updateAlert(row, "Acknowledged")}>Acknowledge</Button>}{row.status !== "Resolved" && <Button kind="secondary" onClick={() => updateAlert(row, "Resolved")}>Resolve</Button>}</div>
      }]} />
    </section>
  </>;
}
function WatchlistPage() {
  const {
    user,
    data,
    setShowIdentifier,
    activeWatchlist,
    watchlistFilter,
    setWatchlistFilter,
    visibleWatchlist,
    toggleIdentifier
  } = useDashboard();
  return <><Header title="Watchlist" sub="Identifiers matched by incoming vehicle sightings" right={user?.role === "admin" && <Button onClick={() => setShowIdentifier(true)}><Plus size={16} /> Add identifier</Button>} />
    <section className="section-card"><div className="section-title"><div><h2>Vehicle identifiers</h2><p className="muted small">Inactive identifiers stay stored and can be shown with the filter.</p></div><div className="filter-row"><Badge color="green">{activeWatchlist.length} active</Badge><select aria-label="Watchlist vehicle state" value={watchlistFilter} onChange={event => setWatchlistFilter(event.target.value)}><option>Active</option><option>Inactive</option><option>All vehicles</option></select></div></div>
      <Table rows={visibleWatchlist} columns={[{
        label: "Identifier",
        render: row => <b>{row.identifier}</b>
      }, {
        label: "Type",
        key: "entity_type"
      }, {
        label: "Reason",
        key: "reason"
      }, {
        label: "Priority",
        render: row => <Badge color={row.priority === "High" ? "red" : "amber"}>{row.priority}</Badge>
      }, {
        label: "Status",
        render: row => <Badge color={row.active ? "green" : "slate"}>{row.active ? "Active" : "Inactive"}</Badge>
      }, {
        label: "Added",
        render: row => fmt(row.created_at)
      }, ...(user?.role === "admin" ? [{
        label: "Action",
        render: row => <Button kind="secondary" onClick={() => toggleIdentifier(row)}>{row.active ? "Disable" : "Enable"}</Button>
      }] : [])]} />
    </section>
  </>;
}
function AuditLogPage() {
  const {
    data
  } = useDashboard();
  return <><Header title="Audit Log" sub="Administrative audit activity visible to your role" /><section className="section-card"><Table rows={data.audit} columns={[{
        label: "Time",
        render: row => fmt(row.timestamp)
      }, {
        label: "Actor",
        key: "actor"
      }, {
        label: "Action",
        render: row => <b>{row.action}</b>
      }, {
        label: "Target",
        key: "target"
      }, {
        label: "Details",
        render: row => row.details
      }]} /></section></>;
}
const pages = {
  Overview: OverviewPage,
  "Camera Registry": CameraRegistryPage,
  "Detection History": DetectionHistoryPage,
  "Vehicle Tracking": VehicleTrackingPage,
  "Alert Center": AlertCenterPage,
  Watchlist: WatchlistPage,
  "Audit Log": AuditLogPage
};
export default function DashboardPages() {
  const {
    page
  } = useDashboard();
  const Page = pages[page] || OverviewPage;
  return <Page />;
}
