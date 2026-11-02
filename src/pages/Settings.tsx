import { ThemeSettings } from "../components/ThemeSettings";
import { useState } from "react";
import type { FormRecord, Identity } from "../../shared/contracts";
import { useResource } from "../hooks/useResource";
import { api, refresh, write } from "../api";
import { ErrorState, Loading, dateTime } from "../components/States";
interface Page {
  id: string;
  name: string;
  authorized: number;
  subscribed: number;
  last_sync_at: string | null;
  last_webhook_at: string | null;
  last_error: string | null;
}
interface Connection {
  configured: boolean;
  webhookConfigured: boolean;
  callbackUri: string | null;
  webhookUri: string | null;
  connection: {
    status: string;
    permissions_json: string;
    token_expires_at: string | null;
    last_error: string | null;
  } | null;
  pages: Page[];
  health: {
    pending: number | null;
    running: number | null;
    failed: number | null;
  };
  delivery: string;
}
interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  disabled: number;
}
interface Job {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  imported: number;
  last_error: string | null;
  form_id: string | null;
  error_code: string | null;
}
export function Settings({
  identity,
  onSignedOut,
}: {
  identity: Identity;
  onSignedOut: () => void;
}) {
  const r = useResource<Connection>("/meta/connection-status", 300000),
    forms = useResource<FormRecord[]>("/forms"),
    members = useResource<Member[]>("/members"),
    jobs = useResource<Job[]>(
      identity.role === "Agent" ? null : "/meta/jobs",
      300000,
    ),
    workspace = useResource<{ name: string; retention_days: number }>(
      "/workspace",
    );
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [disconnect, setDisconnect] = useState(false);
  const admin = identity.role !== "Agent";
  async function act(fn: () => Promise<unknown>, success = "Saved.") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await fn();
      setMessage(typeof result === "string" ? result : success);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!r.data)
    return r.error ? (
      <ErrorState error={r.error} retry={r.reload} />
    ) : (
      <Loading />
    );
  const d = r.data;
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-success" role="status">
          {message}
        </p>
      )}
      <ThemeSettings />
      <div className="settings-grid">
        <section className="panel settings-card">
          <h2>Facebook connection</h2>
          <span
            className={`status ${d.connection?.status === "connected" ? "converted" : "rejected"}`}
          >
            <span />
            {d.connection?.status || "Not connected"}
          </span>
          <p>
            {d.configured
              ? "Authorize Facebook, connect a Page, and choose the forms to collect."
              : "Server configuration is incomplete. Configure the Meta app, origin, encryption key and Graph API version."}
          </p>
          {admin && (
            <button
              className="button primary"
              disabled={!d.configured || busy}
              onClick={() =>
                act(async () => {
                  const result = await api<{ url: string }>("/meta/connect");
                  window.location.assign(result.url);
                }, "Opening Facebook…")
              }
            >
              Connect / reconnect Facebook
            </button>
          )}
          <small className="settings-hint">
            Authorization alone does not prove lead retrieval works. Confirm a
            real test lead after selecting a Page and forms.
          </small>
          <dl className="connection-list">
            <div>
              <dt>Webhook secret configured</dt>
              <dd>{d.webhookConfigured ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd>{d.delivery}</dd>
            </div>
            <div>
              <dt>Token access deadline</dt>
              <dd>
                {d.connection?.token_expires_at
                  ? dateTime(d.connection.token_expires_at)
                  : "Not provided"}
              </dd>
            </div>
            <div>
              <dt>Granted permissions</dt>
              <dd>
                {d.connection
                  ? JSON.parse(d.connection.permissions_json).join(", ")
                  : "None"}
              </dd>
            </div>
          </dl>
          <p className="settings-hint">
            OAuth redirect: {d.callbackUri || "Not configured"}
            <br />
            Webhook callback: {d.webhookUri || "Not configured"}
          </p>
          {d.connection?.last_error && (
            <p className="form-error">{d.connection.last_error}</p>
          )}
          {admin && d.connection && (
            <div className="danger-zone">
              {disconnect ? (
                <>
                  <p>
                    Remove stored Meta credentials and attempt app permission
                    revocation. Existing CRM records stay saved.
                  </p>
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        const res = await write<{ message: string }>(
                          "/meta/disconnect",
                          {},
                        );
                        setDisconnect(false);
                        return res.message;
                      })
                    }
                  >
                    Confirm disconnect
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setDisconnect(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="text-button"
                  onClick={() => setDisconnect(true)}
                >
                  Review connection removal
                </button>
              )}
            </div>
          )}
        </section>
        <section className="panel settings-card">
          <h2>Pages & form discovery</h2>
          {!d.pages.length && (
            <p>
              No Pages available. Authorize Facebook to discover manageable
              Pages.
            </p>
          )}
          {d.pages.map((p) => (
            <article className="page-setting" key={p.id}>
              <h3>{p.name}</h3>
              <span
                className={`status ${p.authorized && p.subscribed ? "converted" : "rejected"}`}
              >
                <span />
                {p.authorized && p.subscribed
                  ? "Page subscription confirmed"
                  : "Not connected"}
              </span>
              <small className="settings-hint">
                Page {p.id}
                <br />
                Last retrieval:{" "}
                {p.last_sync_at ? dateTime(p.last_sync_at) : "Never"}
                <br />
                Last signed webhook:{" "}
                {p.last_webhook_at ? dateTime(p.last_webhook_at) : "Never"}
              </small>
              {p.last_error && <p className="form-error">{p.last_error}</p>}
              {admin && (
                <div className="contact-links">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () => write("/meta/pages/select", { pageId: p.id }),
                        "Page and subscription confirmed. Select forms in Instant forms.",
                      )
                    }
                  >
                    {p.authorized ? "Verify Page again" : "Connect this Page"}
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy || !p.authorized}
                    onClick={() =>
                      act(
                        () => api(`/meta/forms?pageId=${p.id}`),
                        "Forms refreshed.",
                      )
                    }
                  >
                    Refresh forms
                  </button>
                </div>
              )}
            </article>
          ))}
        </section>
        <section className="panel settings-card full-width">
          <h2>Sync & ingestion health</h2>
          <p>
            {d.health.pending || 0} pending · {d.health.running || 0} processing
            · {d.health.failed || 0} failed. Without Queues, processing runs
            every 10 minutes. Selected forms reconcile approximately every 6
            hours. Only currently available leads can be imported.
          </p>
          {admin && (
            <div className="contact-links">
              <button
                className="button primary"
                disabled={busy || !forms.data?.some((f) => f.selected)}
                onClick={() =>
                  act(
                    () =>
                      write("/meta/sync", {
                        formIds: forms
                          .data!.filter((f) => f.selected)
                          .slice(0, 20)
                          .map((f) => f.id),
                      }),
                    "Sync scheduled for up to 20 selected forms.",
                  )
                }
              >
                Sync Now
              </button>
              <button className="button secondary" onClick={() => refresh()}>
                Refresh health
              </button>
            </div>
          )}
          <p className="settings-hint">
            Select forms in Instant forms. Fix Page access before replaying
            permission failures. Replay resumes the stored cursor and
            deduplicates submissions.
          </p>
          {jobs.error && <ErrorState error={jobs.error} retry={jobs.reload} />}
          <div className="table-scroll">
            {admin && !!jobs.data?.length && (
              <table>
                <thead>
                  <tr>
                    <th>JOB / FORM</th>
                    <th>STATE</th>
                    <th>IMPORTED</th>
                    <th>DIAGNOSTIC</th>
                    <th>RECOVERY</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.data.map((j) => (
                    <tr key={j.id}>
                      <td>
                        {j.kind}
                        <small className="campaign">{j.form_id}</small>
                      </td>
                      <td>
                        {j.status} · attempt {j.attempts}
                      </td>
                      <td>{j.imported}</td>
                      <td className="wrap-cell">
                        {j.last_error || "—"}
                        {j.error_code && ` (${j.error_code})`}
                      </td>
                      <td>
                        {j.status === "dead" && (
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() =>
                              act(
                                () => write(`/meta/jobs/${j.id}/replay`, {}),
                                "Replay scheduled.",
                              )
                            }
                          >
                            Replay
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
        <section className="panel settings-card">
          <h2>Workspace & retention</h2>
          {workspace.data && (
            <form
              className="task-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                act(
                  () =>
                    write(
                      "/workspace",
                      {
                        name: f.get("name"),
                        retentionDays: Number(f.get("retention")),
                      },
                      "PATCH",
                    ),
                  "Workspace saved. Retention runs during scheduled maintenance.",
                );
              }}
            >
              <label className="field-label">
                Workspace name
                <input
                  name="name"
                  maxLength={100}
                  defaultValue={workspace.data.name}
                  required
                  disabled={identity.role !== "Owner"}
                />
              </label>
              <label className="field-label">
                Keep submissions for (days)
                <input
                  name="retention"
                  type="number"
                  min={1}
                  max={3650}
                  defaultValue={workspace.data.retention_days}
                  required
                  disabled={identity.role !== "Owner"}
                />
              </label>
              <p className="settings-hint">
                Retention uses original submission time. Old leads, answers,
                notes and linked tasks are permanently deleted in bounded
                batches. Minimal external-ID tombstones prevent re-import.
                Review before shortening retention.
              </p>
              <button
                className="button secondary"
                disabled={busy || identity.role !== "Owner"}
              >
                Save workspace
              </button>
            </form>
          )}
          <p className="settings-hint">
            For access/export requests, filter the Leads list and export
            matching submissions. For deletion, open each matching submission
            and review deletion.
          </p>
        </section>
        <section className="panel settings-card">
          <h2>Account security</h2>
          <p>
            {identity.email} · {identity.role}
          </p>
          <form
            className="task-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act(async () => {
                await write("/auth/password", {
                  currentPassword: f.get("current"),
                  password: f.get("password"),
                });
                onSignedOut();
              });
            }}
          >
            <label className="field-label">
              Current password
              <input
                name="current"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                required
              />
            </label>
            <label className="field-label">
              New password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <button className="button secondary" disabled={busy}>
              Change password & sign out everywhere
            </button>
          </form>
          <p className="settings-hint">
            Sessions expire after 1 hour idle or 8 hours total. Password changes
            revoke all sessions.
          </p>
        </section>
        <section className="panel settings-card full-width">
          <h2>Workspace access</h2>
          {members.error && (
            <ErrorState error={members.error} retry={members.reload} />
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>MEMBER</th>
                  <th>ROLE</th>
                  <th>ACCESS</th>
                </tr>
              </thead>
              <tbody>
                {members.data?.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.name}
                      <small className="campaign">{m.email}</small>
                    </td>
                    <td>
                      {identity.role === "Owner" && m.role !== "Owner" ? (
                        <select
                          aria-label={`Role for ${m.name}`}
                          value={m.role}
                          disabled={busy}
                          onChange={(e) =>
                            act(() =>
                              write(
                                `/members/${m.id}`,
                                { role: e.target.value },
                                "PATCH",
                              ),
                            )
                          }
                        >
                          <option>Admin</option>
                          <option>Agent</option>
                        </select>
                      ) : (
                        m.role
                      )}
                    </td>
                    <td>
                      {identity.role === "Owner" && m.role !== "Owner" ? (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            act(() =>
                              write(
                                `/members/${m.id}`,
                                { disabled: !m.disabled },
                                "PATCH",
                              ),
                            )
                          }
                        >
                          {m.disabled ? "Enable access" : "Disable access"}
                        </button>
                      ) : m.disabled ? (
                        "Disabled"
                      ) : (
                        "Active"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {identity.role === "Owner" && (
            <details className="section-gap">
              <summary>Add Admin or Agent</summary>
              <p>
                Create a unique initial password. Share it securely; the member
                can change it in Account security.
              </p>
              <form
                className="task-form member-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const element = e.currentTarget,
                    f = new FormData(element);
                  act(async () => {
                    await write("/members", {
                      name: f.get("name"),
                      email: f.get("email"),
                      password: f.get("password"),
                      role: f.get("role"),
                    });
                    element.reset();
                  }, "Member created.");
                }}
              >
                <label className="field-label">
                  Name
                  <input name="name" maxLength={100} required />
                </label>
                <label className="field-label">
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="off"
                    required
                  />
                </label>
                <label className="field-label">
                  Initial password
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
                <label className="field-label">
                  Role
                  <select name="role">
                    <option>Agent</option>
                    <option>Admin</option>
                  </select>
                </label>
                <button className="button secondary" disabled={busy}>
                  Create member
                </button>
              </form>
            </details>
          )}
        </section>
      </div>
    </>
  );
}
