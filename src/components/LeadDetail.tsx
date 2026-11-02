import { WhatsAppButton } from "./WhatsAppButton";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Identity, LeadDetail as Detail } from "../../shared/contracts";
import { stages } from "../../shared/contracts";
import { useResource } from "../hooks/useResource";
import { refresh, write } from "../api";
import { Empty, ErrorState, Loading, dateTime } from "./States";
import { TaskForm } from "./TaskForm";
export function LeadDetail({
  leadId,
  identity,
  onClose,
}: {
  leadId: string;
  identity: Identity;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    r = useResource<Detail>(`/leads/${leadId}`),
    members =
      useResource<{ id: string; name: string; disabled: number }[]>("/members"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [contactPhone, setContactPhone] = useState<string | null>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      opener?.focus();
    };
  }, []);
  async function update(value: unknown) {
    setBusy(true);
    setError("");
    try {
      await write(`/leads/${leadId}`, value, "PATCH");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const d = r.data,
    l = d?.lead;
  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      aria-labelledby="detail-title"
    >
      <div className="detail">
        <div className="detail-top">
          <span className="eyebrow">LEAD PROFILE</span>
          <button
            className="icon-button"
            aria-label="Close lead details"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </div>
        {!l ? (
          r.error ? (
            <ErrorState error={r.error} retry={r.reload} />
          ) : (
            <Loading />
          )
        ) : (
          <>
            <h2 id="detail-title">{l.name}</h2>
            <p className="detail-id">
              Meta submission {l.lead_id} · {dateTime(l.submitted_at)}
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="inline-fields">
              <label className="field-label">
                Lead status
                <select
                  aria-label="Lead status"
                  value={l.status}
                  disabled={busy}
                  onChange={(e) => update({ status: e.target.value })}
                >
                  {stages.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Assigned agent
                <select
                  aria-label="Assigned agent"
                  value={l.assigned_to || ""}
                  disabled={busy || identity.role === "Agent"}
                  onChange={(e) =>
                    update({ assignedTo: e.target.value || null })
                  }
                >
                  <option value="">Unassigned</option>
                  {members.data?.map((m) => (
                    <option
                      key={m.id}
                      value={m.id}
                      disabled={Boolean(m.disabled)}
                    >
                      {m.name}
                      {m.disabled ? " (disabled)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <h3>Contact information</h3>
            <dl className="answers">
              <div>
                <dt>Email</dt>
                <dd>{l.email || "Not supplied"}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{l.phone || "Not supplied"}</dd>
              </div>
              <div>
                <dt>WhatsApp number</dt>
                <dd>{l.whatsapp_phone || l.phone || "Not supplied"}</dd>
              </div>
              <div>
                <dt>Form / Page</dt>
                <dd>
                  {l.form_name} / {l.page_name}
                </dd>
              </div>
              <div>
                <dt>Campaign / Ad</dt>
                <dd>
                  {l.campaign || "Unavailable"} / {l.ad_id || "Unavailable"}
                </dd>
              </div>
            </dl>
            <div className="contact-links">
              {l.phone && (
                <a
                  className="button secondary"
                  href={`tel:${l.phone.replace(/[^\d+]/g, "")}`}
                >
                  Call
                </a>
              )}
              {l.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email) && (
                <a
                  className="button secondary"
                  href={`mailto:${encodeURIComponent(l.email)}`}
                >
                  Email
                </a>
              )}
              <WhatsAppButton
                leadId={leadId}
                name={l.name}
                business={l.page_name}
                phone={contactPhone ?? (l.whatsapp_phone || l.phone)}
                disabled={busy}
                onError={setError}
              />
            </div>
            <label className="field-label">
              WhatsApp number (include country code)
              <input
                type="tel"
                value={contactPhone ?? (l.whatsapp_phone || l.phone)}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+94771234567"
                maxLength={80}
              />
            </label>
            <small className="settings-hint">
              Use a full international number. Corrections here apply to this
              contact attempt only. Opening WhatsApp moves New leads to
              Contacted; later stages stay unchanged. No message is sent
              automatically and delivery is not verified.
            </small>
            {!!d.possible_duplicates.length && (
              <div className="demo-banner section-gap">
                <div>
                  <strong>Possible repeat contact</strong>
                  <p>
                    {d.possible_duplicates.length} other submissions share this
                    email or phone. They have not been merged.
                  </p>
                </div>
              </div>
            )}
            <h3>All submitted answers</h3>
            <dl className="answers">
              {d.answers.map((a) => (
                <div key={a.field_key}>
                  <dt>{a.question}</dt>
                  <dd>
                    {(JSON.parse(a.values_json) as string[]).join(", ") ||
                      "No answer"}
                  </dd>
                </div>
              ))}
            </dl>
            <h3>Notes</h3>
            {d.notes.map((n) => (
              <article className="note" key={n.id}>
                <p>{n.body}</p>
                <small>
                  {n.author_name} · {dateTime(n.created_at)}
                </small>
              </article>
            ))}
            {!d.notes.length && <p className="settings-hint">No notes yet.</p>}
            <form
              className="task-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const element = e.currentTarget,
                  body = new FormData(element).get("body");
                setBusy(true);
                setError("");
                try {
                  await write(`/leads/${leadId}/notes`, { body });
                  element.reset();
                  refresh();
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field-label">
                Add a note
                <textarea name="body" rows={3} required maxLength={4000} />
              </label>
              <button className="button secondary" disabled={busy}>
                Save note
              </button>
            </form>
            <h3>Follow-ups</h3>
            {d.tasks.map((t) => (
              <div className="note" key={t.id}>
                <strong>{t.title}</strong>
                <small>
                  {dateTime(t.due_at)} ·{" "}
                  {t.completed_at ? "Complete" : t.priority} ·{" "}
                  {t.assignee_name || "Unassigned"}
                </small>
              </div>
            ))}
            <TaskForm identity={identity} leadId={leadId} />
            <h3>Activity timeline</h3>
            {d.activities.length ? (
              d.activities.map((a) => (
                <article className="note" key={a.id}>
                  <strong>{a.kind}</strong>
                  <p>
                    {(() => {
                      if (a.kind !== "updated") return a.detail;
                      try {
                        const change = JSON.parse(a.detail);
                        return `Stage: ${change.status}. Assigned to ${members.data?.find((m) => m.id === change.assignedTo)?.name || "no agent"}.`;
                      } catch {
                        return "Lead updated.";
                      }
                    })()}
                  </p>
                  <small>
                    {a.actor_name || "Meta ingestion"} ·{" "}
                    {dateTime(a.created_at)}
                  </small>
                </article>
              ))
            ) : (
              <Empty title="No activity yet" />
            )}
            {identity.role !== "Agent" && (
              <div className="danger-zone">
                <h3>Delete this submission</h3>
                <p>
                  Deletes this lead, answers, notes and follow-ups. A minimal
                  external-ID tombstone prevents re-import.
                </p>
                {confirmDelete ? (
                  <>
                    <button
                      className="button danger"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await write(`/leads/${leadId}`, {}, "DELETE");
                          refresh();
                          onClose();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Permanently delete lead
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="text-button"
                    onClick={() => setConfirmDelete(true)}
                  >
                    Review deletion
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
