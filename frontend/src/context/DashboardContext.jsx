import { createContext, useContext } from "react";
const DashboardContext = createContext(null);
export function DashboardProvider({
  value,
  children
}) {
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}
export function useDashboard() {
  const dashboard = useContext(DashboardContext);
  if (!dashboard) {
    throw new Error("Dashboard components must be rendered inside DashboardProvider.");
  }
  return dashboard;
}
