import {
  localDayWindow,
  localDateInput,
  nextFollowup,
  followupLabel,
} from "../followups";
import { useState } from "react";
import type { Identity, ListResult, TaskRecord } from "../../shared/contracts";
import { useResource } from "../hooks/useResource";
import { refresh, write } from "../api";
import { TaskForm } from "../components/TaskForm";
import { Empty, ErrorState, Loading } from "../components/States";
export function Tasks({
  identity,
  onLead,
}: {
  identity: Identity;
  onLead: (id: string) => void;
}) {
  const [page, setPage] = useState(1),
    [onlyOpen, setOnlyOpen] = useState(true),
    [due, setDue] = useState(""),
    [scope, setScope] = useState("mine"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const day = localDayWindow();
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "25",
    state: onlyOpen ? "open" : "all",
    due,
    ...day,
    ...(scope === "mine" ? { assignedTo: identity.userId } : {}),
  });
  const r = useResource<
    ListResult<TaskRecord> & {
      summary: {
        open: number;
        overdue: number;
        today: number;
        upcoming: number;
      };
    }
  >(`/tasks?${params}`, 300000);
  return (
    <div className="settings-grid">
      <section className="panel settings-card">
        <h2>Follow-up tasks</h2>
        <label className="field-label">
          Show follow-ups
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setPage(1);
            }}
          >
            <option value="mine">Assigned to me</option>
            <option value="workspace">Whole workspace</option>
          </select>
        </label>
        <div
          className="followup-summary"
          role="group"
          aria-label="Filter follow-ups by due date"
        >
          {[
            { id: "", label: "Open", count: r.data?.summary.open },
            { id: "overdue", label: "Overdue", count: r.data?.summary.overdue },
            { id: "today", label: "Due today", count: r.data?.summary.today },
            {
              id: "upcoming",
              label: "Upcoming",
              count: r.data?.summary.upcoming,
            },
          ].map((item) => (
            <button
              key={item.id}
              className={`button ${due === item.id ? "primary" : "secondary"}`}
              aria-pressed={due === item.id}
              onClick={() => {
                setDue(item.id);
                setOnlyOpen(true);
                setPage(1);
              }}
            >
              {item.label}: {item.count ?? 0}
            </button>
          ))}
        </div>
        <p className="settings-hint">
          Times use your device's local time. Due today includes any tasks
          already overdue today.
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => {
              setOnlyOpen(e.target.checked);
              setPage(1);
            }}
          />
          Only incomplete tasks
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {r.error ? (
          <ErrorState error={r.error} retry={r.reload} />
        ) : !r.data ? (
          <Loading />
        ) : !r.data.items.length ? (
          <Empty title="You’re all caught up" />
        ) : (
          r.data.items.map((t) => (
            <article className="task-item" key={t.id}>
              <label className="check-label">
                <input
                  type="checkbox"
                  aria-label={`Complete ${t.title}`}
                  checked={Boolean(t.completed_at)}
                  disabled={
                    busy ||
                    (identity.role === "Agent" &&
                      t.assigned_to !== identity.userId)
                  }
                  onChange={async (e) => {
                    setBusy(true);
                    try {
                      await write(
                        `/tasks/${t.id}`,
                        { completed: e.target.checked },
                        "PATCH",
                      );
                      refresh();
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                <strong>{t.title}</strong>
              </label>
              <p
                className={
                  !t.completed_at && t.due_at < new Date().toISOString()
                    ? "overdue"
                    : ""
                }
              >
                {new Date(t.due_at).toLocaleString()} -{" "}
                {followupLabel(t.due_at, Boolean(t.completed_at))} ·{" "}
                {t.priority}
              </p>
              <small>{t.assignee_name || "Unassigned"}</small>
              {t.lead_id && (
                <button
                  className="text-button"
                  onClick={() => onLead(t.lead_id!)}
                >
                  {t.lead_name || "Lead"} →
                </button>
              )}
              {!t.completed_at && (
                <button
                  className="text-button"
                  disabled={
                    busy ||
                    (identity.role === "Agent" &&
                      t.assigned_to !== identity.userId)
                  }
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await write(
                        `/tasks/${t.id}`,
                        { dueAt: nextFollowup(1) },
                        "PATCH",
                      );
                      refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remind me tomorrow at 9 AM
                </button>
              )}
              <details>
                <summary>Edit follow-up</summary>
                <form
                  className="task-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    setBusy(true);
                    try {
                      await write(
                        `/tasks/${t.id}`,
                        {
                          title: f.get("title"),
                          dueAt: new Date(String(f.get("due"))).toISOString(),
                          priority: f.get("priority"),
                        },
                        "PATCH",
                      );
                      refresh();
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <input
                    name="title"
                    aria-label="Task title"
                    defaultValue={t.title}
                    maxLength={200}
                    required
                  />
                  <input
                    name="due"
                    aria-label="Due time in your local timezone"
                    type="datetime-local"
                    defaultValue={localDateInput(t.due_at)}
                    required
                  />
                  <select
                    name="priority"
                    aria-label="Task priority"
                    defaultValue={t.priority}
                  >
                    <option>Low</option>
                    <option>Normal</option>
                    <option>High</option>
                  </select>
                  <button className="button secondary" disabled={busy}>
                    Save follow-up
                  </button>
                </form>
              </details>
            </article>
          ))
        )}
        <div className="table-footer">
          <button
            className="text-button"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button
            className="text-button"
            disabled={page * 25 >= (r.data?.total || 0)}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </section>
      <section className="panel settings-card">
        <h2>Plan the next conversation</h2>
        <p>
          Create a workspace task here, or open a lead to link a follow-up
          directly to that person’s submission.
        </p>
        <TaskForm identity={identity} />
      </section>
    </div>
  );
}
