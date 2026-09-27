import { Command } from "lucide-react";
import { Button } from "./ui.jsx";
export default function LoginPage({
  error,
  login,
  setLogin,
  doLogin
}) {
  return <div className="login-page">
      <div className="login-card">
        <div className="brand-mark"><Command size={22} /></div>
        <p className="eyebrow">OKDRIVER · SENTINEL</p>
        <h1>Command center sign in</h1>
        <p className="muted">Sign in to view camera detections and vehicle alerts.</p>
        <form onSubmit={doLogin} className="stack">
          <label>Username<input value={login.username} onChange={event => setLogin({
            ...login,
            username: event.target.value
          })} autoComplete="username" /></label>
          <label>Password<input type="password" value={login.password} onChange={event => setLogin({
            ...login,
            password: event.target.value
          })} autoComplete="current-password" /></label>
          {error && <div className="error-box">{error}</div>}
          <Button type="submit" className="full">Sign in</Button>
        </form>
        <div className="login-help">Local demo users: <b>admin</b> and <b>operator</b>. Set both passwords in your local <code>.env</code> file.</div>
      </div>
    </div>;
}
