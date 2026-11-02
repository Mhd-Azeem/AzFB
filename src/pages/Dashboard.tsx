import { Activity, Mail, Sparkles, Users } from "lucide-react";
import { stages, type Analytics } from "../../shared/contracts";
import { useResource } from "../hooks/useResource";
import { Empty, ErrorState, Loading } from "../components/States";
export function Dashboard({
  onStatus,
  analytics = false,
}: {
  onStatus: (s: string) => void;
  analytics?: boolean;
}) {
  const r = useResource<Analytics>(
    "/" + (analytics ? "analytics" : "dashboard"),
    30000,
  );
  if (!r.data)
    return r.error ? (
      <ErrorState error={r.error} retry={r.reload} />
    ) : (
      <Loading />
    );
  const d = r.data,
    max = Math.max(1, ...d.days.map((x) => x.total));
  return (
    <>
      {r.error && <ErrorState error={r.error} retry={r.reload} />}
      <p className="range-label">
        {d.from} – {d.to} · UTC · Last 30 days · {d.followupsDue} follow-ups due
        across the workspace
      </p>
      <div className="kpis">
        {[
          { label: "Total leads", value: d.total, icon: Users, color: "blue" },
          {
            label: "New leads",
            value: d.counts.New,
            icon: Sparkles,
            color: "cyan",
          },
          {
            label: "Contacted",
            value: d.counts.Contacted,
            icon: Mail,
            color: "violet",
          },
          {
            label: "Conversion rate",
            value: `${d.conversionRate}%`,
            icon: Activity,
            color: "green",
          },
        ].map(({ label, value, icon: Icon, color }) => (
          <section className="kpi panel" key={label}>
            <div className="kpi-top">
              <span>{label}</span>
              <span className={`metric-icon ${color}`}>
                <Icon size={18} />
              </span>
            </div>
            <strong>{value}</strong>
            <small>From stored lead records</small>
          </section>
        ))}
      </div>
      <div className="chart-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Lead activity</h2>
              <p>Original submission dates, in UTC.</p>
            </div>
            <span className="subtle-pill">Last 30 days</span>
          </div>
          {d.days.length ? (
            <div
              className="live-bars"
              role="img"
              aria-label={d.days
                .map((x) => `${x.day}: ${x.total} leads`)
                .join("; ")}
            >
              {d.days.map((x) => (
                <div className="live-bar-col" key={x.day}>
                  <strong>{x.total}</strong>
                  <div
                    className="live-bar"
                    style={{
                      height: `${Math.max(2, (x.total / max) * 140)}px`,
                    }}
                  />
                  <small>{x.day.slice(5)}</small>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="Your next opportunity starts here">
              <p>
                Connect a Page, select forms, and sync to see your first leads.
              </p>
            </Empty>
          )}
        </section>
        <section className="panel pipeline">
          <div className="panel-heading">
            <div>
              <h2>Your lead pipeline</h2>
              <p>Every conversation has potential.</p>
            </div>
          </div>
          <div className="pipeline-total">
            <strong>{d.total}</strong>
            <span>leads in this date range</span>
          </div>
          <div className="stacked-bar">
            {stages.map((s) => (
              <div
                key={s}
                className={`segment ${s.toLowerCase()}`}
                style={{
                  width: `${d.total ? (d.counts[s] / d.total) * 100 : 0}%`,
                }}
              />
            ))}
          </div>
          <div className="pipeline-list">
            {stages.map((s) => (
              <button key={s} onClick={() => onStatus(s)}>
                <span className={`status-dot ${s.toLowerCase()}`} />
                <span>{s}</span>
                <strong>{d.counts[s]}</strong>
                <small>
                  {d.total ? Math.round((d.counts[s] / d.total) * 100) : 0}%
                </small>
              </button>
            ))}
          </div>
        </section>
      </div>
      {analytics && (
        <>
          {[
            ["Performance by form", d.forms],
            ["Leads by campaign / source", d.campaigns],
            ["Agent performance", d.agents],
          ].map(([title, records]) => (
            <section
              className="panel analytics-forms section-gap"
              key={title as string}
            >
              <div className="panel-heading">
                <h2>{title as string}</h2>
              </div>
              {(
                records as { name: string; total: number; converted?: number }[]
              ).map((v, i) => (
                <div className="performance" key={`${v.name}-${i}`}>
                  <strong>{v.name}</strong>
                  <span>{v.total} leads</span>
                  {v.converted !== undefined && (
                    <span>{v.converted} converted</span>
                  )}
                </div>
              ))}
              {!(records as unknown[]).length && <Empty />}
            </section>
          ))}
        </>
      )}
    </>
  );
}
