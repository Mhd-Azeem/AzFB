import { FileText } from "lucide-react";
import { useResource } from "../hooks/useResource";
import type { FormRecord, Identity } from "../../shared/contracts";
import { Empty, ErrorState, Loading, dateTime } from "../components/States";
import { refresh, write } from "../api";
import { useState } from "react";
export function Forms({
  identity,
  onLeads,
}: {
  identity: Identity;
  onLeads: (id: string) => void;
}) {
  const r = useResource<FormRecord[]>("/forms"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!r.data)
    return r.error ? (
      <ErrorState error={r.error} retry={r.reload} />
    ) : (
      <Loading />
    );
  if (!r.data.length)
    return (
      <section className="panel">
        <Empty title="No Instant Forms yet">
          <p>
            Connect a Facebook Page in Settings to discover its available forms.
          </p>
        </Empty>
      </section>
    );
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="forms-grid">
        {r.data.map((f) => (
          <section className="panel form-card" key={f.id}>
            <div className="form-card-top">
              <span className="metric-icon blue">
                <FileText size={23} />
              </span>
              <span className="subtle-pill">{f.status}</span>
            </div>
            <h2>{f.name}</h2>
            <p>
              {f.page_name} · Form {f.id}
            </p>
            <div className="form-stats">
              <div>
                <strong>{f.lead_count}</strong>
                <small>Stored submissions</small>
              </div>
              <div>
                <strong>{JSON.parse(f.questions_json).length}</strong>
                <small>Form questions</small>
              </div>
            </div>
            <small className="settings-hint">
              Last sync: {f.last_sync_at ? dateTime(f.last_sync_at) : "Never"}
            </small>
            {identity.role !== "Agent" && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={Boolean(f.selected)}
                  disabled={busy}
                  onChange={async (e) => {
                    setBusy(true);
                    try {
                      await write(
                        `/forms/${f.id}`,
                        { selected: e.target.checked },
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
                Collect leads from this form
              </label>
            )}
            <button className="button secondary" onClick={() => onLeads(f.id)}>
              Explore stored leads →
            </button>
          </section>
        ))}
      </div>
    </>
  );
}
