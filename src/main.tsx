import React, { Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Identity } from "../shared/contracts";
import { api, setCsrf, write } from "./api";
import { WorkspaceShell, type View } from "./components/WorkspaceShell";
import { Loading } from "./components/States";
import { Notifications } from "./components/Notifications";
import { LeadDetail } from "./components/LeadDetail";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Leads } from "./pages/Leads";
import { Forms } from "./pages/Forms";
import { Tasks } from "./pages/Tasks";
import { Settings } from "./pages/Settings";
import "./styles.css";
import "./live.css";
import "./theme.css";
import "./theme";
const DemoApp = lazy(() => import("./demo/DemoApp"));
function App() {
  const [identity, setIdentity] = useState<Identity | null>(null),
    [initial, setInitial] = useState(true),
    [reason, setReason] = useState(""),
    [view, setView] = useState<View>(
      new URLSearchParams(location.search).has("meta")
        ? "Settings"
        : "Overview",
    ),
    [selected, setSelected] = useState<string | null>(null),
    [leadPreset, setLeadPreset] = useState({
      status: "",
      form: "",
      version: 0,
    });
  useEffect(() => {
    api<Identity>("/auth/me")
      .then((i) => {
        setCsrf(i.csrf);
        setIdentity(i);
      })
      .catch((e) => {
        if (e.status !== 401) setReason(e.message);
      })
      .finally(() => setInitial(false));
    const expired = () => {
      setIdentity(null);
      setSelected(null);
      setReason("Your session expired. Sign in to continue.");
    };
    window.addEventListener("crm:session-expired", expired);
    return () => window.removeEventListener("crm:session-expired", expired);
  }, []);
  useEffect(() => {
    if (!identity) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        write<{ csrf: string }>("/auth/rotate", {})
          .then((r) => setCsrf(r.csrf))
          .catch(() => {});
    }, 15 * 60000);
    return () => clearInterval(timer);
  }, [identity]);
  const openLeads = (status = "", form = "") => {
    setLeadPreset((p) => ({ status, form, version: p.version + 1 }));
    setView("Leads");
  };
  if (initial) return <Loading />;
  if (!identity)
    return (
      <Login
        reason={reason}
        onLogin={(i) => {
          setIdentity(i);
          setReason("");
        }}
      />
    );
  async function logout() {
    try {
      await write("/auth/logout", {});
      setCsrf("");
      setIdentity(null);
      setSelected(null);
      setReason("Signed out.");
    } catch (e) {
      setReason((e as Error).message);
    }
  }
  return (
    <WorkspaceShell
      identity={identity}
      view={view}
      onView={setView}
      onLogout={logout}
    >
      <div className="page-heading">
        <div>
          <div className="eyebrow">FACEBOOK LEAD MANAGEMENT</div>
          <h1>
            {view === "Overview"
              ? "A clearer view of your growth."
              : view === "Leads"
                ? "Every lead. One workspace."
                : view === "Instant forms"
                  ? "Your forms, at a glance."
                  : view === "Analytics"
                    ? "Turn activity into insight."
                    : view === "Tasks"
                      ? "Make the next move."
                      : "Make the connection."}
          </h1>
          <p>
            {view === "Overview"
              ? "Good things start with a conversation. Here’s where yours stand."
              : "Manage your workspace with real, persistent customer records."}
          </p>
        </div>
      </div>
      {view === "Overview" && (
        <div className="home-leads-action">
          <button className="button primary" onClick={() => openLeads()}>
            View leads
          </button>
        </div>
      )}
      {reason && (
        <p className="form-error" role="alert">
          {reason}
        </p>
      )}
      <Notifications
        onLeads={() => openLeads()}
        onTasks={() => setView("Tasks")}
      />
      {(view === "Overview" || view === "Analytics") && (
        <Dashboard
          analytics={view === "Analytics"}
          onStatus={(s) => openLeads(s)}
        />
      )}{" "}
      {view === "Leads" && (
        <Leads
          key={leadPreset.version}
          initialStatus={leadPreset.status}
          initialForm={leadPreset.form}
          onOpen={setSelected}
        />
      )}{" "}
      {view === "Instant forms" && (
        <Forms identity={identity} onLeads={(id) => openLeads("", id)} />
      )}{" "}
      {view === "Tasks" && <Tasks identity={identity} onLead={setSelected} />}{" "}
      {view === "Settings" && (
        <Settings
          identity={identity}
          onSignedOut={() => {
            setCsrf("");
            setIdentity(null);
            setReason("Password changed. Please sign in.");
          }}
        />
      )}
      {selected && (
        <LeadDetail
          leadId={selected}
          identity={identity}
          onClose={() => setSelected(null)}
        />
      )}
    </WorkspaceShell>
  );
}
const demo = new URLSearchParams(location.search).get("mode") === "demo";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {demo ? (
      <>
        <div className="demo-exit">
          <strong>Fictional demo · Browser-local data only</strong>
          <a href="/">Return to secure sign in →</a>
        </div>
        <Suspense fallback={<Loading />}>
          <DemoApp />
        </Suspense>
      </>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
