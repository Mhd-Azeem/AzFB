import { useResource } from "../hooks/useResource";
import { refresh, write } from "../api";
import { useState } from "react";
export function Notifications({
  onLeads,
  onTasks,
}: {
  onLeads: () => void;
  onTasks: () => void;
}) {
  const r = useResource<{
      newLeadCount: number;
      tasks: { id: string; title: string }[];
      checkedAt: string;
    }>("/notifications", 300000),
    [error, setError] = useState("");
  if (!r.data?.newLeadCount && !r.data?.tasks.length)
    return r.error ? (
      <p className="range-label">
        Notifications unavailable.{" "}
        <button className="text-button" onClick={r.reload}>
          Retry
        </button>
      </p>
    ) : null;
  return (
    <div className="demo-banner">
      <div>
        <strong>
          {r.data.newLeadCount} new leads ·{" "}
          {r.data.tasks.length === 20 ? "20+" : r.data.tasks.length} of your
          tasks overdue
        </strong>
        <p>Checked every 5 minutes while this tab is visible. {error}</p>
      </div>
      <button onClick={onLeads}>Leads</button>
      <button onClick={onTasks}>Tasks</button>
      <button
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
    </div>
  );
}
