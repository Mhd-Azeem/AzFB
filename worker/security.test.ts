import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testDatabase } from "./test-db";
import { app } from "./index";
import { dispatchInbox } from "./inbox";
import type { Env } from "./types";
import {
  encrypt,
  decrypt,
  hashPassword,
  hmac,
  sha,
  verifyPassword,
  verifySignature,
} from "./crypto";
import { after, now } from "./types";
import { one, rows, statement } from "./db";
import {
  saveLead,
  processJob,
  retryDelay,
  enqueueStatement,
  maintenance,
} from "./jobs";
import { leadFilter, makeCsv, pagination } from "./filters";
const origin = "http://localhost:8787",
  secret = "test-only-session-pepper-with-at-least-32-characters",
  bootstrap = "test-only-bootstrap-secret-at-least-32-characters";
let db: ReturnType<typeof testDatabase>, env: Env;
const context = {
  waitUntil: (_p: Promise<unknown>) => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;
async function req(
  path: string,
  method = "GET",
  body?: unknown,
  session?: { cookie: string; csrf: string },
  extra: Record<string, string> = {},
) {
  return app.request(
    `http://localhost:8787/api${path}`,
    {
      method,
      headers: {
        Origin: origin,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(session
          ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf }
          : {}),
        ...extra,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    env,
    context,
  );
}
async function provision() {
  return req(
    "/auth/bootstrap",
    "POST",
    {
      email: "owner@example.com",
      password: "a-test-password-123",
      name: "Owner",
      workspaceName: "Workspace A",
    },
    undefined,
    { "X-Bootstrap-Secret": bootstrap },
  );
}
async function login() {
  const res = await req("/auth/login", "POST", {
    email: "owner@example.com",
    password: "a-test-password-123",
  });
  expect(res.status).toBe(200);
  return {
    cookie: res.headers.get("Set-Cookie")!.split(";")[0],
    csrf: ((await res.json()) as { data: { csrf: string } }).data.csrf,
  };
}
async function seed(workspace: string, page = "111", form = "222") {
  const t = now();
  await statement(
    env,
    "INSERT OR IGNORE INTO facebook_pages(workspace_id,id,name,token_encrypted,tasks_json,authorized,subscribed,created_at,updated_at) VALUES(?,?,?,?,?,1,1,?,?)",
    workspace,
    page,
    "Test Page",
    await encrypt(
      env.TOKEN_ENCRYPTION_KEY,
      "fixture-page-token",
      `${workspace}:page:${page}`,
    ),
    "[]",
    t,
    t,
  ).run();
  await statement(
    env,
    "INSERT OR IGNORE INTO instant_forms(workspace_id,id,page_id,name,status,questions_json,selected,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)",
    workspace,
    form,
    page,
    "Test Form",
    "ACTIVE",
    JSON.stringify([{ key: "custom_question", label: "A custom question?" }]),
    t,
    t,
  ).run();
}
const fixture = {
  id: "333",
  form_id: "222",
  created_time: "2026-11-01T10:00:00+0000",
  ad_id: "444",
  field_data: [
    { name: "full_name", values: ["Real-shaped fixture"] },
    { name: "email", values: ["fixture@example.com"] },
    { name: "phone_number", values: ["+12025550100"] },
    { name: "custom_question", values: ["First", "Second"] },
  ],
};
beforeEach(() => {
  db = testDatabase();
  env = {
    DB: db.DB,
    ASSETS: {
      fetch: async () => new Response("frontend"),
    } as unknown as Fetcher,
    ENVIRONMENT: "local",
    APP_ORIGIN: origin,
    ALLOWED_ORIGINS: origin,
    SESSION_SECRET: secret,
    BOOTSTRAP_SECRET: bootstrap,
    TOKEN_ENCRYPTION_KEY: btoa("x".repeat(32)),
    META_APP_ID: "12345",
    META_APP_SECRET: "fixture-app-secret",
    META_GRAPH_VERSION: "v25.0",
    META_WEBHOOK_VERIFY_TOKEN: "fixture-verify",
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  db.close();
});
describe("cryptography and validation", () => {
  it("hashes passwords with pepper and verifies without storing plaintext", async () => {
    const hash = await hashPassword("long-password", secret);
    expect(hash).not.toContain("long-password");
    expect(await verifyPassword("long-password", hash, secret)).toBe(true);
    expect(await verifyPassword("wrong-password", hash, secret)).toBe(false);
    expect(await verifyPassword("long-password", hash, "wrong-pepper")).toBe(
      false,
    );
  });
  it("authenticates encrypted tokens to their workspace and rejects tampering", async () => {
    const encrypted = await encrypt(
      env.TOKEN_ENCRYPTION_KEY,
      "secret-token",
      "a:page:1",
    );
    expect(await decrypt(env.TOKEN_ENCRYPTION_KEY, encrypted, "a:page:1")).toBe(
      "secret-token",
    );
    await expect(
      decrypt(env.TOKEN_ENCRYPTION_KEY, encrypted, "b:page:1"),
    ).rejects.toThrow();
    await expect(
      decrypt(
        env.TOKEN_ENCRYPTION_KEY,
        encrypted.slice(0, -3) + "bad",
        "a:page:1",
      ),
    ).rejects.toThrow();
  });
  it("verifies the exact raw webhook bytes", async () => {
    const raw = new TextEncoder().encode('{ "entry": [] }').buffer,
      sig = `sha256=${await hmac("app-secret", raw)}`;
    expect(await verifySignature("app-secret", raw, sig)).toBe(true);
    expect(
      await verifySignature(
        "app-secret",
        new TextEncoder().encode('{"entry":[]}').buffer,
        sig,
      ),
    ).toBe(false);
    expect(await verifySignature("app-secret", raw, null)).toBe(false);
  });
  it("guards dates, SQL sort inputs, wildcard search and formula CSV cells", () => {
    expect(() =>
      pagination(new URLSearchParams("sort=DROP TABLE leads")),
    ).toThrow();
    expect(() =>
      leadFilter(new URLSearchParams("from=2026-02-30"), "w"),
    ).toThrow();
    expect(() =>
      leadFilter(new URLSearchParams("from=2026-11-02&to=2026-11-01"), "w"),
    ).toThrow();
    expect(leadFilter(new URLSearchParams("q=100%25"), "w").args[1]).toBe(
      "%100!%%",
    );
    const c = makeCsv(
      [{ name: '  =HYPERLINK("x")', note: "one, two\nthree" }],
      ["name", "note"],
    );
    expect(c).toContain('"\'  =HYPERLINK(""x"")"');
    expect(c).toContain('"one, two\nthree"');
  });
});
describe("authentication, authorization and workspace isolation", () => {
  it("keeps unread lead notifications across logins until the member marks them read", async () => {
    await provision();
    const first = await login(),
      wid = (await one<{ id: string }>(env, "SELECT id FROM workspaces"))!.id;
    await statement(
      env,
      "UPDATE workspace_members SET created_at=? WHERE workspace_id=?",
      new Date(Date.now() - 3600000).toISOString(),
      wid,
    ).run();
    await seed(wid);
    await saveLead(env, wid, "111", "222", fixture);
    await req("/auth/logout", "POST", {}, first);
    const second = await login();
    let n = (
      (await (
        await req("/notifications", "GET", undefined, second)
      ).json()) as { data: { newLeadCount: number } }
    ).data;
    expect(n.newLeadCount).toBe(1);
    expect((await req("/notifications/read", "POST", {}, second)).status).toBe(
      200,
    );
    n = (
      (await (
        await req("/notifications", "GET", undefined, second)
      ).json()) as { data: { newLeadCount: number } }
    ).data;
    expect(n.newLeadCount).toBe(0);
  });
  it("records WhatsApp attempts, validates numbers, preserves later stages and requires authentication", async () => {
    await provision();
    const session = await login();
    const wid = (await one<{ id: string }>(env, "SELECT id FROM workspaces"))!
      .id;
    await seed(wid);
    await saveLead(env, wid, "111", "222", fixture);
    const lead = (await one<{ id: string }>(
      env,
      "SELECT id FROM leads WHERE workspace_id=?",
      wid,
    ))!;
    const path = `/leads/${lead.id}/whatsapp`;
    expect((await req(path, "POST", { phone: "+94771234567" })).status).toBe(
      401,
    );
    expect(
      (await req(path, "POST", { phone: "0771234567" }, session)).status,
    ).toBe(400);
    expect(
      (await one<{ status: string }>(
        env,
        "SELECT status FROM leads WHERE id=?",
        lead.id,
      ))!.status,
    ).toBe("New");
    const result = await req(
      path,
      "POST",
      { phone: "+94 77 123 4567" },
      session,
    );
    expect(result.status).toBe(200);
    expect(((await result.json()) as { data: { url: string } }).data.url).toBe(
      "https://wa.me/94771234567",
    );
    expect(
      (await one<{ status: string }>(
        env,
        "SELECT status FROM leads WHERE id=?",
        lead.id,
      ))!.status,
    ).toBe("Contacted");
    for (const stage of ["Interested", "Converted", "Rejected"]) {
      await req(`/leads/${lead.id}`, "PATCH", { status: stage }, session);
      expect(
        (await req(path, "POST", { phone: "0094771234567" }, session)).status,
      ).toBe(200);
      expect(
        (await one<{ status: string }>(
          env,
          "SELECT status FROM leads WHERE id=?",
          lead.id,
        ))!.status,
      ).toBe(stage);
    }
    expect(
      await rows(
        env,
        "SELECT id FROM lead_activities WHERE lead_id=? AND kind='whatsapp_attempt'",
        lead.id,
      ),
    ).toHaveLength(4);
    expect(
      (
        await req(
          "/leads/unknown/whatsapp",
          "POST",
          { phone: "+94771234567" },
          session,
        )
      ).status,
    ).toBe(404);
  });
  it("persists multiple notes and task completion, filters/sorts server pages and calculates real analytics", async () => {
    await provision();
    const s = await login(),
      wid = (await one<{ id: string }>(env, "SELECT id FROM workspaces"))!.id;
    await seed(wid);
    for (let i = 0; i < 3; i++)
      await saveLead(env, wid, "111", "222", {
        ...fixture,
        id: String(800 + i),
        created_time: `2026-11-0${i + 1}T10:00:00Z`,
        field_data: [
          { name: "full_name", values: [["Zoe", "Amelia", "Noah"][i]] },
          { name: "email", values: ["person@example.test"] },
        ],
      });
    const leads = (
      (await (
        await req("/leads?pageSize=1&sort=name", "GET", undefined, s)
      ).json()) as {
        data: { items: { id: string; name: string }[]; total: number };
      }
    ).data;
    expect(leads.total).toBe(3);
    expect(leads.items[0].name).toBe("Amelia");
    const lid = leads.items[0].id;
    expect(
      (await req(`/leads/${lid}`, "PATCH", { status: "Converted" }, s)).status,
    ).toBe(200);
    for (const note of ["First conversation", "Follow-up context"])
      expect(
        (await req(`/leads/${lid}/notes`, "POST", { body: note }, s)).status,
      ).toBe(201);
    const detail = (
      (await (await req(`/leads/${lid}`, "GET", undefined, s)).json()) as {
        data: {
          notes: unknown[];
          possible_duplicates: unknown[];
          activities: unknown[];
        };
      }
    ).data;
    expect(detail.notes).toHaveLength(2);
    expect(detail.possible_duplicates).toHaveLength(2);
    expect(detail.activities.length).toBeGreaterThanOrEqual(4);
    const matched = (
      (await (
        await req(
          "/leads?q=Amelia&status=Converted&form=222&pageId=111&from=2026-11-01&to=2026-11-03",
          "GET",
          undefined,
          s,
        )
      ).json()) as { data: { total: number } }
    ).data;
    expect(matched.total).toBe(1);
    const next = (
      (await (
        await req("/leads?pageSize=1&page=2&sort=name", "GET", undefined, s)
      ).json()) as { data: { items: { name: string }[] } }
    ).data;
    expect(next.items[0].name).toBe("Noah");
    const task = await req(
      "/tasks",
      "POST",
      {
        leadId: lid,
        title: "Call again",
        dueAt: new Date(Date.now() - 60000).toISOString(),
        priority: "High",
      },
      s,
    );
    expect(task.status).toBe(201);
    const tid = ((await task.json()) as { data: { id: string } }).data.id;
    let metrics = (
      (await (
        await req(
          "/analytics?from=2026-11-01&to=2026-11-03",
          "GET",
          undefined,
          s,
        )
      ).json()) as {
        data: { total: number; conversionRate: number; followupsDue: number };
      }
    ).data;
    expect(metrics.total).toBe(3);
    expect(metrics.conversionRate).toBe(33.3);
    expect(metrics.followupsDue).toBe(1);
    expect(
      (await req(`/tasks/${tid}`, "PATCH", { completed: true }, s)).status,
    ).toBe(200);
    metrics = (
      (await (
        await req(
          "/analytics?from=2026-11-01&to=2026-11-03",
          "GET",
          undefined,
          s,
        )
      ).json()) as { data: typeof metrics }
    ).data;
    expect(metrics.followupsDue).toBe(0);
  });
  it("logout revokes the full rotation family and prevents an old token renewing it", async () => {
    await provision();
    const s = await login(),
      response = await req("/auth/rotate", "POST", {}, s),
      next = {
        cookie: response.headers.get("Set-Cookie")!.split(";")[0],
        csrf: ((await response.json()) as { data: { csrf: string } }).data.csrf,
      };
    expect((await req("/auth/me", "GET", undefined, s)).status).toBe(200);
    expect((await req("/auth/logout", "POST", {}, next)).status).toBe(200);
    expect((await req("/auth/rotate", "POST", {}, s)).status).toBe(401);
    expect((await req("/auth/me", "GET", undefined, next)).status).toBe(401);
  });
  it("serves all live read endpoints with an empty database and zero denominators", async () => {
    await provision();
    const s = await login();
    for (const path of [
      "/dashboard",
      "/analytics",
      "/leads",
      "/forms",
      "/tasks",
      "/members",
      "/workspace",
      "/notifications",
      "/meta/connection-status",
      "/meta/pages",
      "/meta/jobs",
    ])
      expect((await req(path, "GET", undefined, s)).status, path).toBe(200);
    const dashboard = (await (
      await req("/dashboard", "GET", undefined, s)
    ).json()) as { data: { total: number; conversionRate: number } };
    expect(dashboard.data.total).toBe(0);
    expect(dashboard.data.conversionRate).toBe(0);
  });
  it("provisions once, uses HttpOnly sessions, protects writes and logs out", async () => {
    expect((await provision()).status).toBe(201);
    expect((await provision()).status).toBe(409);
    expect((await req("/leads")).status).toBe(401);
    const session = await login(),
      me = await req("/auth/me", "GET", undefined, session);
    expect(((await me.json()) as { data: { role: string } }).data.role).toBe(
      "Owner",
    );
    expect(
      (await req("/auth/logout", "POST", {}, { ...session, csrf: "wrong" }))
        .status,
    ).toBe(403);
    expect((await req("/auth/logout", "POST", {}, session)).status).toBe(200);
    expect((await req("/auth/me", "GET", undefined, session)).status).toBe(401);
  });
  it("sets production secure cookies and blocks untrusted/missing origins", async () => {
    await provision();
    env.ENVIRONMENT = "production";
    env.APP_ORIGIN = "https://crm.example.test";
    env.ALLOWED_ORIGINS = "https://crm.example.test";
    const response = await req(
      "/auth/login",
      "POST",
      { email: "owner@example.com", password: "a-test-password-123" },
      undefined,
      { Origin: env.APP_ORIGIN },
    );
    expect(response.headers.get("Set-Cookie")).toContain("__Host-az_session=");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
    expect(
      (
        await req("/auth/login", "POST", {}, undefined, {
          Origin: "https://attacker.test",
        })
      ).status,
    ).toBe(403);
    expect(
      (await req("/auth/login", "POST", {}, undefined, { Origin: "" })).status,
    ).toBe(403);
  });
  it("locks repeated login attempts and revokes sessions on password change", async () => {
    await provision();
    for (let n = 0; n < 5; n++)
      expect(
        (
          await req("/auth/login", "POST", {
            email: "owner@example.com",
            password: "wrong",
          })
        ).status,
      ).toBe(401);
    expect(
      (
        await req("/auth/login", "POST", {
          email: "owner@example.com",
          password: "a-test-password-123",
        })
      ).status,
    ).toBe(429);
    await statement(env, "DELETE FROM auth_limits").run();
    const s = await login();
    expect(
      (
        await req(
          "/auth/password",
          "POST",
          {
            currentPassword: "a-test-password-123",
            password: "another-test-password-123",
          },
          s,
        )
      ).status,
    ).toBe(200);
    expect((await req("/auth/me", "GET", undefined, s)).status).toBe(401);
  });
  it("rotates with a bounded grace window and expires old tokens without interrupting in-flight refreshes", async () => {
    await provision();
    const s = await login(),
      rotated = await req("/auth/rotate", "POST", {}, s);
    expect(rotated.status).toBe(200);
    expect((await req("/auth/me", "GET", undefined, s)).status).toBe(200);
    const oldHash = await sha(s.cookie.split("=")[1]);
    await statement(
      env,
      "UPDATE sessions SET idle_expires_at=? WHERE id_hash=?",
      new Date(0).toISOString(),
      oldHash,
    ).run();
    expect((await req("/auth/me", "GET", undefined, s)).status).toBe(401);
    await statement(
      env,
      "UPDATE sessions SET idle_expires_at=?",
      new Date(0).toISOString(),
    ).run();
    const next = {
      cookie: rotated.headers.get("Set-Cookie")!.split(";")[0],
      csrf: ((await rotated.json()) as { data: { csrf: string } }).data.csrf,
    };
    expect((await req("/auth/me", "GET", undefined, next)).status).toBe(401);
  });
  it("isolates reads, writes, notes, export, assignments and tasks", async () => {
    await provision();
    const s = await login(),
      me = (
        (await (await req("/auth/me", "GET", undefined, s)).json()) as {
          data: { workspaceId: string; userId: string };
        }
      ).data;
    await seed(me.workspaceId);
    await saveLead(env, me.workspaceId, "111", "222", fixture);
    await statement(
      env,
      "INSERT INTO workspaces(id,name,created_at,updated_at) VALUES(?,?,?,?)",
      "other",
      "Other",
      now(),
      now(),
    ).run();
    await seed("other", "555", "666");
    await saveLead(env, "other", "555", "666", {
      ...fixture,
      id: "777",
      form_id: "666",
      field_data: [{ name: "full_name", values: ["Other workspace secret"] }],
    });
    const other = await one<{ id: string }>(
        env,
        "SELECT id FROM leads WHERE workspace_id=?",
        "other",
      ),
      own = await one<{ id: string }>(
        env,
        "SELECT id FROM leads WHERE workspace_id=?",
        me.workspaceId,
      );
    expect(
      (
        await req(
          `/leads/${other!.id}/whatsapp`,
          "POST",
          { phone: "+94771234567" },
          s,
        )
      ).status,
    ).toBe(404);
    expect((await req(`/leads/${other!.id}`, "GET", undefined, s)).status).toBe(
      404,
    );
    expect(
      (await req(`/leads/${other!.id}`, "PATCH", { status: "Converted" }, s))
        .status,
    ).toBe(404);
    expect(
      (await req(`/leads/${other!.id}/notes`, "POST", { body: "x" }, s)).status,
    ).toBe(404);
    expect(
      (
        await req(
          "/tasks",
          "POST",
          { leadId: other!.id, title: "call", dueAt: after(3600) },
          s,
        )
      ).status,
    ).toBe(404);
    expect(
      (await req(`/leads/${own!.id}`, "PATCH", { assignedTo: "other-user" }, s))
        .status,
    ).toBe(400);
    const list = await req("/leads?pageSize=1", "GET", undefined, s);
    expect(
      ((await list.json()) as { data: { total: number } }).data.total,
    ).toBe(1);
    const exported = await (
      await req("/leads/export", "GET", undefined, s)
    ).text();
    expect(exported).toContain("Real-shaped fixture");
    expect(exported).not.toContain("Other workspace secret");
  });
  it("allows agent status and notes but forbids connection and assignment changes", async () => {
    await provision();
    const owner = await login();
    const me = (
      (await (await req("/auth/me", "GET", undefined, owner)).json()) as {
        data: { workspaceId: string };
      }
    ).data;
    await seed(me.workspaceId);
    await saveLead(env, me.workspaceId, "111", "222", fixture);
    const lead = await one<{ id: string }>(
      env,
      "SELECT id FROM leads WHERE workspace_id=?",
      me.workspaceId,
    );
    expect(
      (
        await req(
          "/members",
          "POST",
          {
            email: "agent@example.com",
            name: "Agent",
            password: "agent-test-password",
            role: "Agent",
          },
          owner,
        )
      ).status,
    ).toBe(201);
    const loginResponse = await req("/auth/login", "POST", {
        email: "agent@example.com",
        password: "agent-test-password",
      }),
      s = {
        cookie: loginResponse.headers.get("Set-Cookie")!.split(";")[0],
        csrf: ((await loginResponse.json()) as { data: { csrf: string } }).data
          .csrf,
      };
    expect(
      (await req(`/leads/${lead!.id}`, "PATCH", { status: "Contacted" }, s))
        .status,
    ).toBe(200);
    expect(
      (await req(`/leads/${lead!.id}/notes`, "POST", { body: "First note" }, s))
        .status,
    ).toBe(201);
    expect(
      (await req(`/leads/${lead!.id}`, "PATCH", { assignedTo: null }, s))
        .status,
    ).toBe(403);
    expect((await req("/meta/connect", "GET", undefined, s)).status).toBe(403);
    expect(
      (await req("/meta/sync", "POST", { formIds: ["222"] }, s)).status,
    ).toBe(403);
    expect((await req(`/leads/${lead!.id}`, "DELETE", {}, s)).status).toBe(403);
  });
});
describe("Meta webhook and ingestion pipeline", () => {
  it("reports the failed Page stage and required permission without exposing provider messages or tokens", async () => {
    await provision();
    const s = await login(),
      wid = (await one<{ id: string }>(env, "SELECT id FROM workspaces"))!.id;
    await seed(wid);
    await statement(
      env,
      "UPDATE facebook_pages SET authorized=0,subscribed=0 WHERE workspace_id=?",
      wid,
    ).run();
    const permissions = [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_metadata",
      "pages_manage_ads",
      "leads_retrieval",
    ];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: { is_valid: true, app_id: "12345", scopes: permissions },
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: 200,
                error_subcode: 42,
                message:
                  "Requires pages_manage_ads permission; sensitive provider-token-value",
              },
            }),
            { status: 403 },
          ),
        ),
    );
    const response = await req(
      "/meta/pages/select",
      "POST",
      { pageId: "111" },
      s,
    );
    expect(response.status).toBe(403);
    const result = await response.text();
    expect(result).toContain("meta_page_form_discovery_200");
    expect(result).toContain("pages_manage_ads");
    expect(result).toContain("200/42");
    expect(result).not.toContain("provider-token-value");
    expect(result).not.toContain("fixture-page-token");
    const page = (await one<{
      authorized: number;
      subscribed: number;
      last_error: string;
    }>(env, "SELECT authorized,subscribed,last_error FROM facebook_pages"))!;
    expect(page.authorized).toBe(0);
    expect(page.subscribed).toBe(0);
    expect(page.last_error).toContain("form discovery");
  });
  it("dispatches a large signed batch in bounded slices and reclaims an expired inbox lease", async () => {
    await provision();
    const wid = (await one<{ id: string }>(env, "SELECT id FROM workspaces"))!
      .id;
    await seed(wid);
    const payload = {
      object: "page",
      entry: [
        {
          id: "111",
          changes: Array.from({ length: 7 }, (_, i) => ({
            field: "leadgen",
            value: {
              page_id: "111",
              form_id: "222",
              leadgen_id: String(900 + i),
            },
          })),
        },
      ],
    };
    const sig =
      "sha256=" + (await hmac(env.META_APP_SECRET!, JSON.stringify(payload)));
    expect(
      (
        await req("/webhooks/meta", "POST", payload, undefined, {
          "X-Hub-Signature-256": sig,
        })
      ).status,
    ).toBe(200);
    const inbox = (await one<{ id: string }>(
      env,
      "SELECT id FROM webhook_inbox",
    ))!;
    await dispatchInbox(env, inbox.id);
    expect((await rows(env, "SELECT id FROM sync_jobs")).length).toBe(3);
    await statement(
      env,
      "UPDATE webhook_inbox SET status='running',lease_until=? WHERE id=?",
      new Date(0).toISOString(),
      inbox.id,
    ).run();
    await dispatchInbox(env, inbox.id);
    await dispatchInbox(env, inbox.id);
    expect((await rows(env, "SELECT id FROM sync_jobs")).length).toBe(7);
    expect(
      (await one<{ status: string }>(env, "SELECT status FROM webhook_inbox"))
        ?.status,
    ).toBe("complete");
  });
  it("preserves partial-page progress on retry without double-counting imported leads", async () => {
    await provision();
    const wid = (await one<{ id: string }>(env, "SELECT id FROM workspaces"))!
      .id;
    await seed(wid);
    const job = enqueueStatement(
      env,
      wid,
      "111",
      "222",
      null,
      "history",
      "partial",
    );
    await job.statement.run();
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [fixture, { ...fixture, id: "334", field_data: null }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [fixture, { ...fixture, id: "334" }] }),
        ),
      );
    vi.stubGlobal("fetch", f);
    await processJob(env, job.id);
    expect(
      (await one<{ imported: number }>(env, "SELECT imported FROM sync_jobs"))
        ?.imported,
    ).toBe(1);
    await statement(
      env,
      "UPDATE sync_jobs SET status='pending',attempts=0,next_run_at=? WHERE id=?",
      new Date(0).toISOString(),
      job.id,
    ).run();
    await processJob(env, job.id);
    expect(
      (await one<{ imported: number }>(env, "SELECT imported FROM sync_jobs"))
        ?.imported,
    ).toBe(2);
  });
  it("binds OAuth state to the session, encrypts credentials and confirms Page subscription", async () => {
    await provision();
    const s = await login();
    const connect = await req("/meta/connect", "GET", undefined, s);
    expect(connect.status).toBe(200);
    const url = new URL(
        ((await connect.json()) as { data: { url: string } }).data.url,
      ),
      state = url.searchParams.get("state")!;
    expect(url.searchParams.get("redirect_uri")).toBe(
      origin + "/api/meta/callback",
    );
    expect(
      (await req("/meta/callback?state=wrong&code=code", "GET", undefined, s))
        .status,
    ).toBe(400);
    const permissions = [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_metadata",
      "pages_manage_ads",
      "leads_retrieval",
    ];
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "short-fixture" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "long-fixture" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              is_valid: true,
              app_id: "12345",
              user_id: "meta-user",
              expires_at: Math.floor(Date.now() / 1000) + 86400,
              scopes: permissions,
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: permissions.map((permission) => ({
              permission,
              status: "granted",
            })),
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "111",
                name: "Authorized Page",
                access_token: "page-fixture",
                tasks: ["MANAGE"],
              },
            ],
          }),
        ),
      );
    vi.stubGlobal("fetch", mock);
    expect(
      (
        await req(
          `/meta/callback?state=${state}&code=fixture-code`,
          "GET",
          undefined,
          s,
        )
      ).status,
    ).toBe(302);
    expect(
      (
        await req(
          `/meta/callback?state=${state}&code=fixture-code`,
          "GET",
          undefined,
          s,
        )
      ).status,
    ).toBe(400);
    const stored = await one<{ token_encrypted: string; workspace_id: string }>(
      env,
      "SELECT workspace_id,token_encrypted FROM meta_connections",
    );
    expect(stored!.token_encrypted).not.toContain("long-fixture");
    expect(
      await decrypt(
        env.TOKEN_ENCRYPTION_KEY,
        stored!.token_encrypted,
        `${stored!.workspace_id}:user`,
      ),
    ).toBe("long-fixture");
    const pages = await (await req("/meta/pages", "GET", undefined, s)).text();
    expect(pages).not.toContain("page-fixture");
    expect(pages).not.toContain("token_encrypted");
    mock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { is_valid: true, app_id: "12345", scopes: permissions },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "222",
                name: "Authorized form",
                status: "ACTIVE",
                questions: [],
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "12345", subscribed_fields: ["leadgen"] }],
          }),
        ),
      );
    expect(
      (await req("/meta/pages/select", "POST", { pageId: "111" }, s)).status,
    ).toBe(200);
    expect(
      (
        await one<{ authorized: number }>(
          env,
          "SELECT authorized FROM facebook_pages",
        )
      )?.authorized,
    ).toBe(1);
    expect(
      (await req("/forms/222", "PATCH", { selected: true }, s)).status,
    ).toBe(200);
    expect(
      (await req("/meta/sync", "POST", { formIds: ["222"] }, s)).status,
    ).toBe(202);
    expect((await rows(env, "SELECT * FROM sync_jobs")).length).toBe(1);
  });
  it("rejects OAuth callbacks from a different session and missing permissions", async () => {
    await provision();
    const first = await login(),
      second = await login();
    const u = new URL(
        (
          (await (
            await req("/meta/connect", "GET", undefined, first)
          ).json()) as { data: { url: string } }
        ).data.url,
      ),
      state = u.searchParams.get("state")!;
    expect(
      (
        await req(
          `/meta/callback?state=${state}&code=fixture`,
          "GET",
          undefined,
          second,
        )
      ).status,
    ).toBe(400);
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "short" })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "long" })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { is_valid: true, app_id: "12345", user_id: "u" },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
    vi.stubGlobal("fetch", mock);
    expect(
      (
        await req(
          `/meta/callback?state=${state}&code=fixture`,
          "GET",
          undefined,
          first,
        )
      ).status,
    ).toBe(403);
    expect((await rows(env, "SELECT * FROM meta_connections")).length).toBe(0);
  });
  it("runs incremental reconciliation with an overlap and saves the checkpoint", async () => {
    await provision();
    const wid = (await one<{ id: string }>(env, "SELECT id FROM workspaces"))!
      .id;
    await seed(wid);
    const old = new Date(Date.now() - 7 * 3600000).toISOString();
    await statement(
      env,
      "UPDATE instant_forms SET reconciled_at=? WHERE workspace_id=?",
      old,
      wid,
    ).run();
    const mock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: [fixture] })));
    vi.stubGlobal("fetch", mock);
    await maintenance(env);
    expect(mock).toHaveBeenCalledTimes(1);
    const filter = new URL(String(mock.mock.calls[0][0])).searchParams.get(
      "filtering",
    )!;
    expect(JSON.parse(filter)[0].field).toBe("time_created");
    expect(JSON.parse(filter)[0].value).toBe(
      Math.floor((Date.parse(old) - 48 * 3600000) / 1000),
    );
    expect(
      (await one<{ status: string }>(env, "SELECT status FROM sync_jobs"))
        ?.status,
    ).toBe("complete");
    const checkpoint = (await one<{ reconciled_at: string }>(
      env,
      "SELECT reconciled_at FROM instant_forms",
    ))!.reconciled_at;
    expect(checkpoint > old).toBe(true);
    await maintenance(env);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it("verifies challenge, rejects bad signatures and durably deduplicates replay", async () => {
    await provision();
    const wid = (await one<{ id: string }>(env, "SELECT id FROM workspaces"))!
      .id;
    await seed(wid);
    expect(
      await (
        await req(
          "/webhooks/meta?hub.mode=subscribe&hub.verify_token=fixture-verify&hub.challenge=123",
        )
      ).text(),
    ).toBe("123");
    expect(
      (
        await req(
          "/webhooks/meta?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=123",
        )
      ).status,
    ).toBe(403);
    const payload = {
        object: "page",
        entry: [
          {
            id: "111",
            changes: [
              {
                field: "leadgen",
                value: { page_id: "111", form_id: "222", leadgen_id: "333" },
              },
            ],
          },
        ],
      },
      raw = JSON.stringify(payload);
    expect((await req("/webhooks/meta", "POST", payload)).status).toBe(403);
    const signature = `sha256=${await hmac(env.META_APP_SECRET!, raw)}`;
    for (let n = 0; n < 2; n++)
      expect(
        (
          await req("/webhooks/meta", "POST", payload, undefined, {
            "X-Hub-Signature-256": signature,
          })
        ).status,
      ).toBe(200);
    const inbox = await rows<{ id: string }>(
      env,
      "SELECT id FROM webhook_inbox",
    );
    expect(inbox).toHaveLength(1);
    expect((await rows(env, "SELECT * FROM sync_jobs")).length).toBe(0);
    await dispatchInbox(env, inbox[0].id);
    await dispatchInbox(env, inbox[0].id);
    expect((await rows(env, "SELECT * FROM webhook_events")).length).toBe(1);
    expect((await rows(env, "SELECT * FROM sync_jobs")).length).toBe(1);
    expect((await rows(env, "SELECT * FROM leads")).length).toBe(0);
  });
  it("ingests once, preserves CRM edits and custom answers, and never merges submissions", async () => {
    await provision();
    const wid = (await one<{ id: string }>(env, "SELECT id FROM workspaces"))!
      .id;
    await seed(wid);
    expect(await saveLead(env, wid, "111", "222", fixture)).toBe(true);
    const lead = (await one<{ id: string }>(env, "SELECT id FROM leads"))!;
    await statement(
      env,
      "UPDATE leads SET status='Interested' WHERE workspace_id=? AND id=?",
      wid,
      lead.id,
    ).run();
    expect(await saveLead(env, wid, "111", "222", fixture)).toBe(false);
    expect(
      (await one<{ status: string }>(env, "SELECT status FROM leads"))?.status,
    ).toBe("Interested");
    const answer = await one<{ question: string; values_json: string }>(
      env,
      "SELECT question,values_json FROM lead_answers WHERE field_key='custom_question'",
    );
    expect(answer?.question).toBe("A custom question?");
    expect(JSON.parse(answer!.values_json)).toEqual(["First", "Second"]);
    await saveLead(env, wid, "111", "222", { ...fixture, id: "334" });
    expect((await rows(env, "SELECT * FROM leads")).length).toBe(2);
  });
  it("fetches full leads with server token, retries transient failures and dead-letters permission failures", async () => {
    await provision();
    const wid = (await one<{ id: string }>(env, "SELECT id FROM workspaces"))!
      .id;
    await seed(wid);
    const job = enqueueStatement(
      env,
      wid,
      "111",
      "222",
      "333",
      "lead",
      "lead:111:333",
    );
    await job.statement.run();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 4 } }), { status: 429 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(fixture)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 190 } }), { status: 400 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await processJob(env, job.id);
    let j = await one<{ status: string; next_run_at: string }>(
      env,
      "SELECT status,next_run_at FROM sync_jobs",
    );
    expect(j?.status).toBe("pending");
    expect(j!.next_run_at > now()).toBe(true);
    await statement(
      env,
      "UPDATE sync_jobs SET next_run_at=?",
      new Date(0).toISOString(),
    ).run();
    await processJob(env, job.id);
    expect(
      (await one<{ status: string }>(env, "SELECT status FROM sync_jobs"))
        ?.status,
    ).toBe("complete");
    expect(
      (fetchMock.mock.calls[1][1].headers as Record<string, string>)
        .Authorization,
    ).toBe("Bearer fixture-page-token");
    expect(String(fetchMock.mock.calls[1][0])).not.toContain(
      "fixture-page-token",
    );
    const denied = enqueueStatement(
      env,
      wid,
      "111",
      "222",
      "999",
      "lead",
      "lead:111:999",
    );
    await denied.statement.run();
    await processJob(env, denied.id);
    expect(
      (
        await one<{ status: string }>(
          env,
          "SELECT status FROM sync_jobs WHERE id=?",
          denied.id,
        )
      )?.status,
    ).toBe("dead");
    expect(
      (
        await one<{ authorized: number }>(
          env,
          "SELECT authorized FROM facebook_pages",
        )
      )?.authorized,
    ).toBe(0);
  });
  it("uses safe Graph cursors, resumes history and preserves uniqueness across pages", async () => {
    await provision();
    const wid = (await one<{ id: string }>(env, "SELECT id FROM workspaces"))!
      .id;
    await seed(wid);
    const job = enqueueStatement(
      env,
      wid,
      "111",
      "222",
      null,
      "history",
      "history:222",
    );
    await job.statement.run();
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [fixture],
            paging: {
              next: "https://evil.test/steal",
              cursors: { after: "cursor-one" },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [fixture, { ...fixture, id: "335" }] }),
        ),
      );
    vi.stubGlobal("fetch", f);
    await processJob(env, job.id);
    expect(
      (await one<{ cursor: string }>(env, "SELECT cursor FROM sync_jobs"))
        ?.cursor,
    ).toBe("cursor-one");
    await statement(
      env,
      "UPDATE sync_jobs SET next_run_at=?",
      new Date(0).toISOString(),
    ).run();
    await processJob(env, job.id);
    expect(String(f.mock.calls[1][0])).toContain("graph.facebook.com/");
    expect(String(f.mock.calls[1][0])).toContain("after=cursor-one");
    expect((await rows(env, "SELECT * FROM leads")).length).toBe(2);
  });
  it("prevents overlapping leases and stops imports after privacy deletion", async () => {
    await provision();
    const s = await login(),
      wid = (await one<{ id: string }>(env, "SELECT id FROM workspaces"))!.id;
    await seed(wid);
    await saveLead(env, wid, "111", "222", fixture);
    const lid = (await one<{ id: string }>(env, "SELECT id FROM leads"))!.id;
    expect((await req(`/leads/${lid}`, "DELETE", {}, s)).status).toBe(200);
    expect(await saveLead(env, wid, "111", "222", fixture)).toBe(false);
    expect((await rows(env, "SELECT * FROM lead_answers")).length).toBe(0);
    const job = enqueueStatement(
      env,
      wid,
      "111",
      "222",
      "333",
      "lead",
      "lease-test",
    );
    await job.statement.run();
    await statement(
      env,
      "UPDATE sync_jobs SET status='running',lease_until=? WHERE id=?",
      after(180),
      job.id,
    ).run();
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await processJob(env, job.id);
    expect(f).not.toHaveBeenCalled();
    expect(retryDelay(5)).toBeGreaterThanOrEqual(960);
  });
  it("enforces migration uniqueness and composite foreign keys", async () => {
    await provision();
    const wid = (await one<{ id: string }>(env, "SELECT id FROM workspaces"))!
      .id;
    await seed(wid);
    await saveLead(env, wid, "111", "222", fixture);
    const lid = (await one<{ id: string }>(env, "SELECT id FROM leads"))!.id;
    await expect(
      statement(
        env,
        "INSERT INTO lead_notes(id,workspace_id,lead_id,author_id,body,created_at) VALUES(?,?,?,?,?,?)",
        "bad",
        "other",
        lid,
        "no-user",
        "wrong workspace",
        now(),
      ).run(),
    ).rejects.toThrow();
    expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
