import { Activity, AlertTriangle, CircleHelp, Command, LogOut, Plus, ShieldCheck, Users, X } from "lucide-react";
import { Button } from "./ui.jsx";
import DashboardPages from "../pages/DashboardPages.jsx";
import { useDashboard } from "../context/DashboardContext.jsx";
import { centers, cx, navigationItems } from "../utils/dashboard.js";
function IdentifierModal() {
  const {
    showIdentifier,
    setShowIdentifier,
    identifier,
    setIdentifier,
    addIdentifier
  } = useDashboard();
  if (!showIdentifier) return null;
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setShowIdentifier(false)}>
    <form className="modal" onSubmit={addIdentifier}>
      <div className="modal-head"><div><h2>Add watchlist identifier</h2><p className="muted small">A match creates an alert for future detections.</p></div><button type="button" className="icon-button" onClick={() => setShowIdentifier(false)}><X /></button></div>
      <label>Vehicle / identifier number<input autoFocus required maxLength={32} value={identifier.identifier} onChange={event => setIdentifier({
          ...identifier,
          identifier: event.target.value.toUpperCase()
        })} placeholder="e.g. GJ01AB1234" /></label>
      <div className="form-grid"><label>Entity type<select value={identifier.entity_type} onChange={event => setIdentifier({
            ...identifier,
            entity_type: event.target.value
          })}><option>Vehicle</option><option>Person</option><option>Other</option></select></label><label>Priority<select value={identifier.priority} onChange={event => setIdentifier({
            ...identifier,
            priority: event.target.value
          })}><option>Low</option><option>Medium</option><option>High</option></select></label></div>
      <label>Reason<textarea value={identifier.reason} onChange={event => setIdentifier({
          ...identifier,
          reason: event.target.value
        })} placeholder="Why is this identifier monitored?" /></label>
      <div className="modal-actions"><Button kind="secondary" onClick={() => setShowIdentifier(false)}>Cancel</Button><Button type="submit"><Plus size={16} /> Save identifier</Button></div>
    </form>
  </div>;
}
function CameraModal() {
  const {
    showCamera,
    setShowCamera,
    cameraDraft,
    setCameraDraft,
    addCamera
  } = useDashboard();
  if (!showCamera) return null;
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setShowCamera(false)}>
    <form className="modal" onSubmit={addCamera}>
      <div className="modal-head"><div><h2>Register camera</h2><p className="muted small">Adds a camera source to the selected city command center.</p></div><button type="button" className="icon-button" onClick={() => setShowCamera(false)}><X /></button></div>
      <div className="form-grid"><label>Camera ID<input required maxLength={20} value={cameraDraft.id} onChange={event => setCameraDraft({
            ...cameraDraft,
            id: event.target.value.toUpperCase()
          })} placeholder="CAM-101" /></label><label>Camera name<input required value={cameraDraft.name} onChange={event => setCameraDraft({
            ...cameraDraft,
            name: event.target.value
          })} placeholder="Junction name" /></label></div>
      <div className="form-grid"><label>Latitude<input required type="number" step="any" value={cameraDraft.latitude} onChange={event => setCameraDraft({
            ...cameraDraft,
            latitude: event.target.value
          })} /></label><label>Longitude<input required type="number" step="any" value={cameraDraft.longitude} onChange={event => setCameraDraft({
            ...cameraDraft,
            longitude: event.target.value
          })} /></label></div>
      <div className="form-grid"><label>Department<input required value={cameraDraft.department} onChange={event => setCameraDraft({
            ...cameraDraft,
            department: event.target.value
          })} /></label><label>Zone<input required value={cameraDraft.zone} onChange={event => setCameraDraft({
            ...cameraDraft,
            zone: event.target.value
          })} /></label></div>
      <label>Endpoint reference<input required value={cameraDraft.endpoint_ref} onChange={event => setCameraDraft({
          ...cameraDraft,
          endpoint_ref: event.target.value
        })} /></label>
      <div className="modal-actions"><Button kind="secondary" onClick={() => setShowCamera(false)}>Cancel</Button><Button type="submit"><Plus size={16} /> Register camera</Button></div>
    </form>
  </div>;
}
export default function DashboardLayout() {
  const {
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
    toast
  } = useDashboard();
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Command size={20} /></div><div><b>okDriver</b><span>SENTINEL · CONTROL</span></div></div>
      <label className="center-label">COMMAND CENTER<select value={selectedCenter.id} onChange={event => {
          setCenter(allowedCenters.find(item => item.id === event.target.value) || centers[0]);
          setSelectedVehicle("");
          setAlertQuery("");
          setAlertStatus("All statuses");
          setTraceQuery("");
          setTraceEvents([]);
          setEntities([]);
          setEntityQuery("");
          setPage("Overview");
        }}>
        {centers.filter(center => user?.role === "admin" || allowedCenters.some(item => item.id === center.id)).map(center => <option key={center.id} value={center.id}>{center.id} · {center.state}</option>)}
      </select></label>
      <div className="nav-label">WORKSPACE</div><nav>{navigationItems.map(([label, Icon]) => <button key={label} className={cx("nav-item", page === label && "active")} onClick={() => setPage(label)}><Icon size={18} /><span>{label}</span>{label === "Alert Center" && openAlerts > 0 && <i>{openAlerts}</i>}</button>)}</nav>
      <div className="sidebar-spacer" /><div className="role-card"><div className="role-avatar">{user?.role === "admin" ? <ShieldCheck size={18} /> : <Users size={18} />}</div><div><b>{user?.username}</b><span>{user?.role === "admin" ? "Administrator" : "Command Operator"}</span></div><button title="Role permissions" onClick={() => setToast(user?.role === "admin" ? "Admin: see all command centers and audit activity; manage watchlist identifiers and camera records." : "Operator: work within the assigned command center, review/trace detections, update alerts, and see own/admin audit activity.")}><CircleHelp size={16} /></button></div>
      <button className="logout" onClick={signOut}><LogOut size={17} /> Sign out</button>
    </aside>
    <main className="main"><div className="topbar"><div className="crumb"><span>Sentinel</span><span>/</span><b>{page}</b></div><div className="top-actions"><span className="state-pill"><span /> Data scoped to {selectedCenter.name || selectedCenter.id}</span><button className="icon-button" title="Refresh" onClick={() => load()}><Activity size={18} /></button><button className="profile" onClick={signOut}>{user?.username?.slice(0, 1).toUpperCase()}</button></div></div>
      <div className="content">{error && <div className="error-banner"><AlertTriangle size={16} />{error}<button onClick={() => setError("")}><X size={16} /></button></div>}{loading && <div className="loading-bar" />}<DashboardPages /><footer>okDriver Sentinel · Synthetic demonstration data · {selectedCenter.name || selectedCenter.id} Command Center</footer></div>
    </main>
    <IdentifierModal /><CameraModal />{toast && <div className="toast"><ShieldCheck size={16} />{toast}</div>}
  </div>;
}
