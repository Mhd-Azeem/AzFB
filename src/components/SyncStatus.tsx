import { useResource } from "../hooks/useResource";
export function SyncStatus({ onSettings }: { onSettings: () => void }) {
  const r = useResource<{
    connected: number;
    last_sync_at: string | null;
    last_webhook_at: string | null;
    last_scheduler_completed_at: string | null;
    last_scheduler_error: string | null;
    app_error: string | null;
    pending: number | null;
    failed: number | null;
  }>("/sync-status", 30000);
  if (!r.data)
    return r.error ? (
      <p className="range-label">
        Sync status unavailable.{" "}
        <button className="text-button" onClick={r.reload}>
          Retry
        </button>
      </p>
    ) : null;
  const d = r.data;
  const stale =
    !d.last_scheduler_completed_at ||
    Date.parse(d.last_scheduler_completed_at) < Date.now() - 15 * 60000;
  const issue =
    d.app_error ||
    d.last_scheduler_error ||
    (d.failed
      ? `${d.failed} failed import job(s). Review diagnostics and replay failures.`
      : stale && d.connected
        ? "Background sync heartbeat is delayed. Check Settings."
        : "");
  return (
    <div className="sync-status" role="status">
      <span>
        {!d.connected
          ? "Connect Facebook to enable automatic sync."
          : issue
            ? issue
            : "Automatic sync enabled. Background recovery every 5 minutes; this screen refreshes every 30 seconds."}
      </span>
      <small>
        Last lead sync:{" "}
        {d.last_sync_at ? new Date(d.last_sync_at).toLocaleString() : "Not yet"}{" "}
        - Pending: {d.pending || 0}
        {d.connected && !d.last_webhook_at
          ? " - No signed lead webhook received yet"
          : ""}
      </small>
      <button className="text-button" onClick={onSettings}>
        Sync settings
      </button>
      {r.error && <small>Latest status refresh failed.</small>}
    </div>
  );
}
