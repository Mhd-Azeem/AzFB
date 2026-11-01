import { useState } from "react";
import { refresh, write } from "../api";
import type { Identity } from "../../shared/contracts";
import { useResource } from "../hooks/useResource";
export function TaskForm({
  identity,
  leadId,
  onSaved,
}: {
  identity: Identity;
  leadId?: string;
  onSaved?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const members = useResource<{ id: string; name: string; disabled: number }[]>(
    identity.role === "Agent" ? null : "/members",
  );
  return (
    <form
      className="task-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const element = e.currentTarget,
          f = new FormData(element),
          due = String(f.get("dueAt"));
        setBusy(true);
        setError("");
        try {
          await write("/tasks", {
            title: f.get("title"),
            dueAt: new Date(due + "Z").toISOString(),
            priority: f.get("priority"),
            assignedTo: f.get("assignedTo") || identity.userId,
            ...(leadId ? { leadId } : {}),
          });
          element.reset();
          refresh();
          onSaved?.();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field-label">
        Follow-up title
        <input
          name="title"
          required
          maxLength={200}
          placeholder="Call to discuss requirements"
        />
      </label>
      <label className="field-label">
        Due date & time (UTC)
        <input name="dueAt" type="datetime-local" required />
      </label>
      <div className="inline-fields">
        <label className="field-label">
          Priority
          <select name="priority" defaultValue="Normal">
            <option>Low</option>
            <option>Normal</option>
            <option>High</option>
          </select>
        </label>
        <label className="field-label">
          Assigned agent
          <select name="assignedTo" defaultValue={identity.userId}>
            <option value={identity.userId}>{identity.name} (you)</option>
            {identity.role !== "Agent" &&
              members.data
                ?.filter((m) => !m.disabled && m.id !== identity.userId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="button secondary" disabled={busy}>
        {busy ? "Saving…" : "Create follow-up"}
      </button>
    </form>
  );
}
