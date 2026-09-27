import { cx } from "../utils/dashboard.js";
export function Badge({
  children,
  color = "slate"
}) {
  return <span className={`badge badge-${color}`}>{children}</span>;
}
export function Button({
  children,
  onClick,
  kind = "primary",
  disabled = false,
  className = "",
  type = "button"
}) {
  return <button type={type} disabled={disabled} onClick={onClick} className={cx("btn transition-all duration-150 hover:-translate-y-px", `btn-${kind}`, className)}>
      {children}
    </button>;
}
export function Metric({
  icon: Icon,
  label,
  value,
  note,
  tone = "blue"
}) {
  return <article className="metric card flex items-center gap-4">
      <div className={`metric-icon ${tone}`}>
        <Icon size={20} />
      </div>
      <div>
        <div className="muted small">{label}</div>
        <strong>{value}</strong>
        <div className="muted tiny">{note}</div>
      </div>
    </article>;
}
export function Header({
  title,
  sub,
  right
}) {
  return <div className="page-header flex items-center justify-between gap-5">
      <div>
        <h1>{title}</h1>
        <p className="muted">{sub}</p>
      </div>
      {right}
    </div>;
}
export function Table({
  columns,
  rows,
  empty = "No records found."
}) {
  return <div className="table-wrap overflow-x-auto">
      <table>
        <thead>
          <tr>{columns.map(column => <th key={column.label}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, index) => <tr key={row.id ?? index}>
                {columns.map(column => <td key={column.label}>
                    {column.render ? column.render(row, index) : row[column.key] ?? "—"}
                  </td>)}
              </tr>) : <tr>
              <td className="empty" colSpan={columns.length}>{empty}</td>
            </tr>}
        </tbody>
      </table>
    </div>;
}
export function CameraScene({
  status
}) {
  const color = status === "Online" ? "green" : status === "Degraded" ? "amber" : "red";
  return <div className="camera-thumb">
      <div className="sim-scene">
        <span className="sim-road" />
        <span className="sim-car car-one" />
        <span className="sim-car car-two" />
        <span className="sim-scan" />
      </div>
      <Badge color={color}>{status}</Badge>
    </div>;
}
