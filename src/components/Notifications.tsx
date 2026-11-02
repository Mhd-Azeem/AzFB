import { useResource } from "../hooks/useResource";
import { refresh, write } from "../api";
import { useState } from "react";
import { localDayWindow, followupLabel } from "../followups";
export function Notifications({
  onLeads,
  onTasks,
  onLead,
}: {
  onLeads: () => void;
  onTasks: () => void;
  onLead: (id: string) => void;
}) {
  const r = useResource<{
    newLeadCount: number;
    tasks: {
      id: string;
      title: string;
      due_at: string;
      lead_id: string | null;
      lead_name: string | null;
    }[];
    followups: { open: number; overdue: number; today: number };
    checkedAt: string;
  }>(`/notifications?${new URLSearchParams(localDayWindow())}`, 300000);
  const [error, setError] = useState("");
  if (!r.data?.newLeadCount && !r.data?.tasks.length)
    return r.error ? (
      <p className="range-label">
        Reminders unavailable.{" "}
        <button className="text-button" onClick={r.reload}>
          Retry
        </button>
      </p>
    ) : null;
  const d = r.data;
  return (
    <aside
      className="panel reminder-panel"
      aria-label="New leads and follow-up reminders"
    >
      <div className="panel-heading">
        <div>
          <strong>
            {d.newLeadCount} new leads � {d.followups.overdue || 0} overdue
            follow-ups � {d.followups.today || 0} due today
          </strong>
          <p>
            Your assigned follow-ups. Times are local. Checked every 5 minutes
            while this tab is visible.
          </p>
        </div>
      </div>
      <ul className="reminder-items">
        {d.tasks.slice(0, 3).map((t) => (
          <li key={t.id}>
            <span
              className={followupLabel(t.due_at) === "Overdue" ? "overdue" : ""}
            >
              {followupLabel(t.due_at)}
            </span>
            <strong>{t.title}</strong>
            <span>{new Date(t.due_at).toLocaleString()}</span>
            <button
              className="text-button"
              onClick={() => (t.lead_id ? onLead(t.lead_id) : onTasks())}
            >
              {t.lead_name || "View task"}
            </button>
          </li>
        ))}
      </ul>
      <div className="contact-links">
        <button className="button secondary" onClick={onLeads}>
          View new leads
        </button>
        <button className="button secondary" onClick={onTasks}>
          Manage follow-ups
        </button>
        {d.newLeadCount > 0 && (
          <button
            className="text-button"
            onClick={async () => {
              try {
                await write("/notifications/read", {});
                refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Mark leads read
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {r.error && (
        <p className="form-error" role="alert">
          Reminder refresh failed.{" "}
          <button className="text-button" onClick={r.reload}>
            Retry
          </button>
        </p>
      )}
    </aside>
  );
}
