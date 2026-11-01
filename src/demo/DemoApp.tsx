import React, { useEffect, useRef, useState } from "react";

import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileText,
  LayoutDashboard,
  Link2,
  Mail,
  Menu,
  MoreHorizontal,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";
import {
  csv,
  demoLeads,
  filterLeads,
  forms,
  statuses,
  type Lead,
  type Status,
} from "../data";

type View = "Overview" | "Leads" | "Instant forms" | "Analytics" | "Settings";
const nav = [
  { name: "Overview", icon: LayoutDashboard },
  { name: "Leads", icon: Users },
  { name: "Instant forms", icon: FileText },
  { name: "Analytics", icon: BarChart3 },
  { name: "Settings", icon: Settings },
] as const;
const date = (value: string) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
function readLeads(): Lead[] {
  try {
    const saved = JSON.parse(localStorage.getItem("az-leads-v1") || "null");
    if (Array.isArray(saved) && saved.length === demoLeads.length)
      return demoLeads.map((l) => {
        const s = saved.find((v) => v.id === l.id);
        return {
          ...l,
          status: statuses.includes(s?.status) ? s.status : l.status,
          notes: typeof s?.notes === "string" ? s.notes : "",
        };
      });
  } catch {
    /* Storage unavailable: use session state. */
  }
  return demoLeads;
}
export default function DemoApp() {
  const [view, setView] = useState<View>("Overview"),
    [leads, setLeads] = useState(readLeads),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [form, setForm] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<string | null>(null),
    [mobile, setMobile] = useState(false),
    [notice, setNotice] = useState(""),
    [storageError, setStorageError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem("az-leads-v1", JSON.stringify(leads));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [leads]);
  useEffect(() => {
    setPage(1);
  }, [query, status, form, from, to]);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else if (dialog.current?.open) {
      dialog.current.close();
      trigger.current?.focus();
    }
  }, [selected]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const filtered = filterLeads(leads, query, status, form, from, to),
    visible = filtered.slice((page - 1) * 8, page * 8),
    lead = leads.find((l) => l.id === selected),
    converted = leads.filter((l) => l.status === "Converted").length;
  const go = (v: View) => {
    setView(v);
    setMobile(false);
  };
  const update = (patch: Partial<Lead>) =>
    setLeads((ls) =>
      ls.map((l) => (l.id === selected ? { ...l, ...patch } : l)),
    );
  const exportData = () => {
    const url = URL.createObjectURL(
      new Blob(["\ufeff" + csv(filtered)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "az-leads-demo.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported ${filtered.length} demo leads.`);
  };
  const openLead = (id: string) => {
    trigger.current = document.activeElement as HTMLElement;
    setSelected(id);
  };
  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("Overview");
          }}
        >
          <span className="brand-mark">
            <Zap size={23} fill="currentColor" />
          </span>
          <span>
            AZ Leads<span className="brand-sub">YOUR GROWTH WORKSPACE</span>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">AZ</span>
          <div>
            My workspace<small>Personal workspace</small>
          </div>
          <ChevronDown size={15} />
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {nav.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={view === name ? "active" : ""}
              onClick={() => go(name)}
              aria-current={view === name ? "page" : undefined}
            >
              <Icon size={19} />
              {name}
              {name === "Leads" && (
                <span className="count">{leads.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-mini">
            <span className="pulse" />
            <strong>Explore demo mode</strong>
            <p>
              Your workspace is ready.
              <br />
              Connect Meta to bring it to life.
            </p>
            <button onClick={() => go("Settings")}>
              View connection <ArrowUpRight size={15} />
            </button>
          </div>
          <button
            className="help"
            onClick={() => {
              go("Settings");
              setNotice("Connection setup steps are available below.");
            }}
          >
            <CircleHelp size={18} /> Help & getting started{" "}
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="avatar">AZ</span>
            <div>
              Workspace owner<small>Demo administrator</small>
            </div>
            <MoreHorizontal size={18} />
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
            <ChevronRight size={14} />
            <strong>{view}</strong>
          </div>
          <div className="top-actions">
            <span className="demo-pill">
              <span /> Demo workspace
            </span>
            <span className="top-avatar">AZ</span>
          </div>
        </header>
        <main id="main">
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
                        : "Make the connection."}
              </h1>
              <p>
                {view === "Overview"
                  ? "Good things start with a conversation. Here’s where yours stand."
                  : view === "Leads"
                    ? "Find the right conversation and take the next step."
                    : view === "Instant forms"
                      ? "Explore the Instant Forms behind your demo leads."
                      : view === "Analytics"
                        ? "Understand your demo pipeline and where leads come from."
                        : "Manage your workspace and prepare your Meta integration."}
              </p>
            </div>
            <button className="button secondary" onClick={exportData}>
              <ArrowDownToLine size={16} />
              Export leads
            </button>
          </div>
          <div className="demo-banner">
            <span className="demo-icon">
              <Sparkles size={18} />
            </span>
            <div>
              <strong>You’re exploring a demo workspace</strong>
              <p>
                All leads and metrics are fictional. Meta is not connected. Demo
                dates: 25 Oct – 1 Nov 2026.
              </p>
            </div>
            <button onClick={() => go("Settings")}>
              Connection settings <ArrowRight size={15} />
            </button>
          </div>
          {storageError && (
            <p role="alert" className="error">
              Browser storage is unavailable. Changes last only for this
              session.
            </p>
          )}
          {(view === "Overview" || view === "Analytics") && (
            <>
              <div className="kpis">
                {[
                  {
                    label: "Total leads",
                    value: leads.length,
                    icon: Users,
                    detail: "Across 3 demo forms",
                    color: "blue",
                  },
                  {
                    label: "New leads",
                    value: leads.filter((l) => l.status === "New").length,
                    icon: Sparkles,
                    detail: "Ready for a first hello",
                    color: "cyan",
                  },
                  {
                    label: "Contacted",
                    value: leads.filter((l) => l.status === "Contacted").length,
                    icon: Mail,
                    detail: "Conversations started",
                    color: "violet",
                  },
                  {
                    label: "Conversion rate",
                    value: `${Math.round((converted / leads.length) * 100)}%`,
                    icon: Activity,
                    detail: `${converted} leads converted`,
                    color: "green",
                  },
                ].map(({ label, value, icon: Icon, detail, color }) => (
                  <section className="kpi panel" key={label}>
                    <div className="kpi-top">
                      <span>{label}</span>
                      <span className={`metric-icon ${color}`}>
                        <Icon size={18} />
                      </span>
                    </div>
                    <strong>{value}</strong>
                    <small>
                      <span className="tiny-dot" />
                      {detail}
                    </small>
                  </section>
                ))}
              </div>
              <div className="chart-grid">
                <section className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Lead activity</h2>
                      <p>A little momentum, every day.</p>
                    </div>
                    <span className="subtle-pill">Last 8 demo days</span>
                  </div>
                  <div className="chart-legend">
                    <span />
                    <strong>{leads.length}</strong> leads collected{" "}
                    <small>● Instant Forms</small>
                  </div>
                  <div
                    className="bar-chart"
                    role="img"
                    aria-label="Demo leads by day: three leads per day from October 25 through November 1, 2026."
                  >
                    <div className="grid-lines">
                      <span>4</span>
                      <span>3</span>
                      <span>2</span>
                      <span>1</span>
                      <span>0</span>
                    </div>
                    <div className="bars">
                      {Array.from({ length: 8 }, (_, i) => (
                        <div className="bar-col" key={i}>
                          <div className="bar" style={{ height: "75%" }}>
                            <span>3 leads</span>
                          </div>
                          <small>{i === 7 ? "01 Nov" : `${25 + i} Oct`}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="chart-foot">
                    <span className="pulse" /> Fictional activity · UTC dates
                  </div>
                </section>
                <section className="panel pipeline">
                  <div className="panel-heading">
                    <div>
                      <h2>Your lead pipeline</h2>
                      <p>Every conversation has potential.</p>
                    </div>
                    <Activity size={18} />
                  </div>
                  <div className="pipeline-total">
                    <strong>{leads.length}</strong>
                    <span>total demo leads</span>
                  </div>
                  <div className="stacked-bar">
                    {statuses.map((s) => (
                      <div
                        key={s}
                        className={`segment ${s.toLowerCase()}`}
                        style={{
                          width: `${(leads.filter((l) => l.status === s).length / leads.length) * 100}%`,
                        }}
                      />
                    ))}
                  </div>
                  <div className="pipeline-list">
                    {statuses.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setStatus(s);
                          go("Leads");
                        }}
                      >
                        <span className={`status-dot ${s.toLowerCase()}`} />
                        <span>{s}</span>
                        <strong>
                          {leads.filter((l) => l.status === s).length}
                        </strong>
                        <small>
                          {Math.round(
                            (leads.filter((l) => l.status === s).length /
                              leads.length) *
                              100,
                          )}
                          %
                        </small>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}
          {(view === "Overview" || view === "Leads") && (
            <section className="panel leads-panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    {view === "Overview" ? "Recent leads" : "All leads"}{" "}
                    <span className="heading-count">{filtered.length}</span>
                  </h2>
                  <p>Your next opportunity could be right here.</p>
                </div>
                {view === "Overview" && (
                  <button className="text-button" onClick={() => go("Leads")}>
                    View all leads <ArrowRight size={15} />
                  </button>
                )}
              </div>
              <div className="filters">
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search leads"
                    placeholder="Search name, email, campaign…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter by status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">All statuses</option>
                  {statuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <select
                  aria-label="Filter by form"
                  value={form}
                  onChange={(e) => setForm(e.target.value)}
                >
                  <option value="">All forms</option>
                  {forms.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
                <label className="date-filter">
                  From
                  <input
                    aria-label="From date"
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <label className="date-filter">
                  To
                  <input
                    aria-label="To date"
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
                {(query || status || form || from || to) && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setQuery("");
                      setStatus("");
                      setForm("");
                      setFrom("");
                      setTo("");
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
              {from && to && from > to && (
                <p className="error" role="alert">
                  The start date must be on or before the end date.
                </p>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>LEAD</th>
                      <th>INSTANT FORM</th>
                      <th>STATUS</th>
                      <th>RECEIVED · UTC</th>
                      <th>
                        <span className="sr-only">Details</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((l, i) => (
                      <tr key={l.id}>
                        <td>
                          <button
                            className="lead-name"
                            onClick={() => openLead(l.id)}
                          >
                            <span className={`person person-${i % 4}`}>
                              {l.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
                            </span>
                            <span>
                              <strong>{l.name}</strong>
                              <small>{l.email}</small>
                            </span>
                          </button>
                        </td>
                        <td>
                          <span className="form-name">
                            <FileText size={14} />
                            {l.form}
                          </span>
                          <small className="campaign">{l.campaign}</small>
                        </td>
                        <td>
                          <span className={`status ${l.status.toLowerCase()}`}>
                            <span />
                            {l.status}
                          </span>
                        </td>
                        <td>
                          <span>{date(l.date)}</span>
                          <small className="campaign">
                            {l.date.slice(11, 16)}
                          </small>
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`View ${l.name}`}
                            onClick={() => openLead(l.id)}
                          >
                            <ArrowUpRight size={17} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visible.length && (
                  <div className="empty">
                    <Search size={30} />
                    <h3>No leads found</h3>
                    <p>Try a different search or clear your filters.</p>
                  </div>
                )}
              </div>
              <div className="table-footer">
                <span>
                  Showing {filtered.length ? (page - 1) * 8 + 1 : 0}–
                  {Math.min(page * 8, filtered.length)} of {filtered.length}{" "}
                  demo leads
                </span>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Previous page"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span>
                    Page {page} of {Math.max(1, Math.ceil(filtered.length / 8))}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Next page"
                    disabled={page * 8 >= filtered.length}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </section>
          )}
          {view === "Instant forms" && (
            <div className="forms-grid">
              {forms.map((f, i) => (
                <section className="panel form-card" key={f}>
                  <div className="form-card-top">
                    <span className="metric-icon blue">
                      <FileText size={23} />
                    </span>
                    <span className="subtle-pill">Demo form</span>
                  </div>
                  <h2>{f}</h2>
                  <p>
                    {
                      [
                        "Start meaningful conversations with future customers.",
                        "Help people find a place to call home.",
                        "Connect curious minds with their next course.",
                      ][i]
                    }
                  </p>
                  <div className="form-stats">
                    <div>
                      <strong>
                        {leads.filter((l) => l.form === f).length}
                      </strong>
                      <small>Demo leads</small>
                    </div>
                    <div>
                      <strong>3</strong>
                      <small>Custom questions</small>
                    </div>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setForm(f);
                      setStatus("");
                      setQuery("");
                      setFrom("");
                      setTo("");
                      go("Leads");
                    }}
                  >
                    Explore leads <ArrowRight size={16} />
                  </button>
                </section>
              ))}
            </div>
          )}
          {view === "Analytics" && (
            <section className="panel analytics-forms">
              <div className="panel-heading">
                <div>
                  <h2>Performance by form</h2>
                  <p>Calculated from the current demo dataset.</p>
                </div>
              </div>
              {forms.map((f) => {
                const ls = leads.filter((l) => l.form === f),
                  n = ls.filter((l) => l.status === "Converted").length;
                return (
                  <div className="performance" key={f}>
                    <FileText size={18} />
                    <strong>{f}</strong>
                    <span>{ls.length} leads</span>
                    <span>{n} converted</span>
                    <span>{Math.round((n / ls.length) * 100)}% conversion</span>
                  </div>
                );
              })}
            </section>
          )}
          {view === "Settings" && (
            <div className="settings-grid">
              <section className="panel settings-card">
                <span className="metric-icon blue">
                  <Link2 size={24} />
                </span>
                <h2>Facebook connection</h2>
                <span className="status rejected">
                  <span />
                  Not connected
                </span>
                <p>
                  Your demo workspace works without a Facebook account. Live
                  lead collection requires a secure backend and Meta
                  configuration.
                </p>
                <dl className="connection-list">
                  <div>
                    <dt>Facebook Page</dt>
                    <dd>Not configured</dd>
                  </div>
                  <div>
                    <dt>Backend API</dt>
                    <dd>Not configured</dd>
                  </div>
                  <div>
                    <dt>Leadgen webhook</dt>
                    <dd>Not configured</dd>
                  </div>
                  <div>
                    <dt>Last successful sync</dt>
                    <dd>Never</dd>
                  </div>
                </dl>
                <button className="button primary" disabled>
                  Connect Facebook · Coming with backend
                </button>
                <small className="settings-hint">
                  No credentials or access tokens are collected by this
                  frontend.
                </small>
              </section>
              <section className="panel settings-card">
                <span className="metric-icon violet">
                  <ShieldCheck size={24} />
                </span>
                <h2>Ready for the next chapter</h2>
                <p>What’s needed to receive real leads:</p>
                <ol className="setup-list">
                  <li>
                    <strong>Secure your workspace</strong>
                    <span>
                      Add backend authentication and authorize your
                      administrator.
                    </span>
                  </li>
                  <li>
                    <strong>Configure Meta on the server</strong>
                    <span>
                      Set up your Meta app, Page authorization and required
                      permissions. Keep tokens server-side.
                    </span>
                  </li>
                  <li>
                    <strong>Connect and verify webhooks</strong>
                    <span>
                      Validate incoming requests, retrieve form answers, and
                      store leads securely.
                    </span>
                  </li>
                  <li>
                    <strong>Replace the demo data source</strong>
                    <span>
                      Connect the dashboard to authenticated lead, form and
                      analytics endpoints.
                    </span>
                  </li>
                </ol>
              </section>
              <section className="panel settings-card full-width">
                <h2>Demo workspace data</h2>
                <p>
                  Status changes and notes are saved only in this browser. This
                  is not a secure or shared CRM database.
                </p>
                <button
                  className="button secondary"
                  onClick={() => {
                    setLeads(demoLeads.map((l) => ({ ...l })));
                    setNotice("Demo statuses and notes have been reset.");
                  }}
                >
                  Reset demo data
                </button>
              </section>
            </div>
          )}
          <footer className="footer">
            <span>
              <Zap size={13} /> AZ Leads CRM{" "}
              <span className="footer-dot">·</span> A little clarity. A lot of
              possibility.
            </span>
            <span>
              <ShieldCheck size={14} /> Frontend demo · No live Meta data
            </span>
          </footer>
        </main>
      </div>
      <dialog
        ref={dialog}
        onCancel={() => setSelected(null)}
        onClick={(e) => {
          if (e.target === dialog.current) setSelected(null);
        }}
        aria-labelledby="detail-title"
      >
        {lead && (
          <div className="detail">
            <div className="detail-top">
              <span className="eyebrow">LEAD DETAILS · DEMO</span>
              <button
                className="icon-button"
                aria-label="Close lead details"
                onClick={() => setSelected(null)}
              >
                <X size={21} />
              </button>
            </div>
            <span className="detail-avatar">
              {lead.name
                .split(" ")
                .map((n) => n[0])
                .join("")}
            </span>
            <h2 id="detail-title">{lead.name}</h2>
            <p className="detail-id">
              {lead.id} · Received {date(lead.date)} at{" "}
              {lead.date.slice(11, 16)} UTC
            </p>
            <label className="field-label">
              Lead status
              <select
                value={lead.status}
                onChange={(e) => update({ status: e.target.value as Status })}
              >
                {statuses.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <h3>Contact information</h3>
            <dl className="answers">
              <div>
                <dt>Email</dt>
                <dd>{lead.email}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{lead.phone}</dd>
              </div>
              <div>
                <dt>Instant Form</dt>
                <dd>{lead.form}</dd>
              </div>
              <div>
                <dt>Campaign</dt>
                <dd>{lead.campaign}</dd>
              </div>
            </dl>
            <h3>Instant Form answers</h3>
            <dl className="answers">
              {lead.answers.map((a) => (
                <div key={a.question}>
                  <dt>{a.question}</dt>
                  <dd>{a.answer}</dd>
                </div>
              ))}
            </dl>
            <label className="field-label">
              Private demo notes
              <textarea
                rows={4}
                placeholder="Add context for your next conversation…"
                value={lead.notes}
                onChange={(e) => update({ notes: e.target.value })}
              />
            </label>
            <p className="saved">
              <Check size={14} />{" "}
              {storageError
                ? "Kept for this session only"
                : "Changes saved in this browser"}
            </p>
          </div>
        )}
      </dialog>
      {notice && (
        <div role="status" className="toast">
          <Check size={18} />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
