// Explicitly local-only. Never sends a bootstrap secret to an external origin.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
const origin = "http://localhost:8787";
const secrets = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const at = l.indexOf("=");
      return [l.slice(0, at), l.slice(at + 1)];
    }),
);
mkdirSync("work", { recursive: true });
const account = existsSync("work/local-qa.json")
  ? JSON.parse(readFileSync("work/local-qa.json", "utf8"))
  : {
      email: "local-qa@example.test",
      password: randomBytes(24).toString("base64url"),
    };
let cookie = "",
  csrf = "";
async function request(path, method = "GET", body, extra = {}) {
  return fetch(origin + "/api" + path, {
    method,
    headers: {
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie, "X-CSRF-Token": csrf } : {}),
      ...extra,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const provision = await request(
  "/auth/bootstrap",
  "POST",
  {
    ...account,
    name: "Local verification owner",
    workspaceName: "Local verification workspace",
  },
  { "X-Bootstrap-Secret": secrets.BOOTSTRAP_SECRET },
);
if (provision.status !== 201 && provision.status !== 409)
  throw new Error("Local provisioning failed: " + provision.status);
writeFileSync("work/local-qa.json", JSON.stringify(account));
const login = await request("/auth/login", "POST", account);
if (login.status !== 200)
  throw new Error("Local login failed: " + login.status);
cookie = login.headers.get("set-cookie").split(";")[0];
csrf = (await login.json()).data.csrf;
const passed = [];
for (const path of [
  "/auth/me",
  "/dashboard",
  "/analytics",
  "/leads?pageSize=1",
  "/forms",
  "/tasks",
  "/members",
  "/workspace",
  "/notifications",
  "/meta/connection-status",
  "/meta/pages",
  "/meta/jobs",
]) {
  const res = await request(path);
  if (res.status !== 200) throw new Error(path + " returned " + res.status);
  const result = await res.json();
  if (!result.ok) throw new Error(path + " failed");
  passed.push(path);
}
const exportResponse = await request("/leads/export");
if (
  exportResponse.status !== 200 ||
  !(await exportResponse.text()).includes("lead_id")
)
  throw new Error("CSV export failed");
const task = await request("/tasks", "POST", {
  title: "Local verification follow-up",
  dueAt: new Date(Date.now() + 86400000).toISOString(),
  priority: "Normal",
});
if (task.status !== 201) throw new Error("Task create failed");
const tid = (await task.json()).data.id;
const complete = await request("/tasks/" + tid, "PATCH", { completed: true });
if (complete.status !== 200) throw new Error("Task completion failed");
const blocked = await request(
  "/workspace",
  "PATCH",
  { name: "Should not save" },
  { "X-CSRF-Token": "incorrect" },
);
if (blocked.status !== 403) throw new Error("CSRF was not enforced");
const logout = await request("/auth/logout", "POST", {});
if (logout.status !== 200) throw new Error("Logout failed");
const expired = await request("/leads");
if (expired.status !== 401) throw new Error("Session revocation failed");
console.log(
  JSON.stringify({
    passed: passed.length + 6,
    checks: passed,
    localOnly: true,
    credentialsPrinted: false,
  }),
);
