import { Badge } from "./ui.jsx";
import { fmt, vehicleOf } from "../utils/dashboard.js";
export default function RecentAlerts({
  recent,
  selectedVehicle,
  onSelect
}) {
  return <section className="section-card">
      <div className="section-title">
        <div>
          <h2>Recent unique vehicle alerts</h2>
          <p className="muted small">Latest four active watchlist vehicles; repeat detections are grouped.</p>
        </div>
        <Badge color="red">{recent.length} vehicles</Badge>
      </div>
      <div className="recent-grid">
        {recent.map((alert, index) => <button className={`recent-alert ${selectedVehicle === vehicleOf(alert) ? "selected" : ""}`} key={vehicleOf(alert)} onClick={() => onSelect(vehicleOf(alert))}>
            <div className="recent-top">
              <span className="number-dot">{index + 1}</span>
              <Badge color={alert.status === "Open" ? "red" : "amber"}>{alert.status}</Badge>
            </div>
            <strong>{vehicleOf(alert)}</strong>
            <span className="muted small">{alert.alert_count} alert instance{alert.alert_count === 1 ? "" : "s"} · latest {fmt(alert.created_at)}</span>
            <span className="recent-cta">Open matching history →</span>
          </button>)}
        {!recent.length && <p className="muted">No active watchlist alerts yet.</p>}
      </div>
    </section>;
}
