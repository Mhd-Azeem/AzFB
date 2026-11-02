import { useState } from "react";
import { Zap } from "lucide-react";
import { api, setCsrf, write } from "../api";
import type { Identity } from "../../shared/contracts";
export function Login({
  onLogin,
  reason,
}: {
  onLogin: (i: Identity) => void;
  reason?: string;
}) {
  const [error, setError] = useState(reason || ""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-wrap">
      <section className="panel login-card">
        <span className="brand">
          <span className="brand-mark">
            <Zap />
          </span>
          AZ Leads
        </span>
        <h1>Your workspace, securely.</h1>
        <p>Sign in to manage your Facebook Instant Form leads.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              const r = await write<{ csrf: string }>("/auth/login", {
                email: f.get("email"),
                password: f.get("password"),
              });
              setCsrf(r.csrf);
              onLogin(await api<Identity>("/auth/me"));
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field-label">
            Email
            <input
              type="email"
              name="email"
              required
              autoComplete="username"
              maxLength={254}
            />
          </label>
          <label className="field-label">
            Password
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              maxLength={128}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="settings-hint">
          First setup? The owner must provision the initial account using the
          secure server bootstrap process.
        </p>
        <a className="text-button" href="/?mode=demo">
          Explore the separate fictional demo →
        </a>
      </section>
    </main>
  );
}
