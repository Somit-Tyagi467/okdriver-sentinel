import { DashboardProvider } from "./context/DashboardContext.jsx";
import DashboardLayout from "./components/DashboardLayout.jsx";
import LoginPage from "./components/LoginPage.jsx";
import useDashboard from "./hooks/useDashboard.js";
export default function App() {
  const {
    authenticated,
    loginProps,
    dashboard
  } = useDashboard();
  if (!authenticated) return <LoginPage {...loginProps} />;
  return <DashboardProvider value={dashboard}>
      <DashboardLayout />
    </DashboardProvider>;
}
