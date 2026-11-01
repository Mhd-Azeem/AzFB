import {
  Activity,
  BarChart3,
  CheckSquare,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import type { Identity } from "../../shared/contracts";
export type View =
  "Overview" | "Leads" | "Instant forms" | "Analytics" | "Tasks" | "Settings";
const nav = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Leads", icon: Users },
  { name: "Instant forms", icon: FileText },
  { name: "Analytics", icon: BarChart3 },
  { name: "Tasks", icon: CheckSquare },
  { name: "Settings", icon: Settings },
] as const;
export function WorkspaceShell({
  identity,
  view,
  onView,
  onLogout,
  children,
}: {
  identity: Identity;
  view: View;
  onView: (v: View) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [mobile, setMobile] = useState(false);
  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a href="/" className="brand">
          <span className="brand-mark">
            <Zap size={23} />
          </span>
          <span>
            AZ Leads<span className="brand-sub">YOUR GROWTH WORKSPACE</span>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">AZ</span>
          <div>
            {identity.workspaceName}
            <small>{identity.role} workspace</small>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {nav.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={view === name ? "active" : ""}
              aria-current={view === name ? "page" : undefined}
              onClick={() => {
                onView(name);
                setMobile(false);
              }}
            >
              <Icon size={19} />
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-mini">
            <ShieldCheck size={16} />
            <strong> Private workspace</strong>
            <p>Customer records stay in your authenticated workspace.</p>
            <button
              onClick={() => {
                onView("Settings");
                setMobile(false);
              }}
            >
              Connection & ingestion <Activity size={15} />
            </button>
          </div>
          <div className="profile">
            <span className="avatar">
              {identity.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              {identity.name}
              <small>{identity.role}</small>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={onLogout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          className="scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(!mobile)}
            >
              <Menu />
            </button>
            <span>Workspace</span>
            <span>›</span>
            <strong>{view}</strong>
          </div>
          <span className="demo-pill">
            <ShieldCheck size={12} />
            Authenticated workspace
          </span>
        </header>
        <main id="main">
          {children}
          <footer className="footer">
            <span>
              <Zap size={13} />
              AZ Leads CRM · Your growth workspace
            </span>
            <span>Database records · UTC reporting</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
