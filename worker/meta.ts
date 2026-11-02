import { Hono } from "hono";
import type { Bindings, Env } from "./types";
import { ApiError, after, id, now } from "./types";
import { audit, one, rows, statement } from "./db";
import { requireAdmin, requireCsrf } from "./auth";
import { decrypt, encrypt, randomToken, sha } from "./crypto";
import { body, externalId, keys, text } from "./validation";
import {
  callbackUri,
  debugToken,
  exchange,
  graph,
  GraphError,
  metaConfigured,
  scopes,
  type GraphList,
  type MetaForm,
  type MetaPage,
} from "./meta-client";
import { enqueueStatement, signalJobs } from "./jobs";
export const metaRoutes = new Hono<Bindings>();
async function refreshForms(
  env: Env,
  workspace: string,
  pageId: string,
  token: string,
) {
  let cursor: string | undefined;
  const all: MetaForm[] = [];
  for (let i = 0; i < 10; i++) {
    const result: GraphList<MetaForm> = await graph(
      env,
      `${pageId}/leadgen_forms`,
      token,
      {
        fields: "id,name,status,questions",
        limit: "100",
        ...(cursor ? { after: cursor } : {}),
      },
    );
    if (!Array.isArray(result.data))
      throw new GraphError("invalid_forms", false);
    all.push(...result.data);
    if (!result.paging?.next) break;
    const next = result.paging.cursors?.after;
    if (!next || next === cursor)
      throw new GraphError("invalid_forms_cursor", false);
    cursor = next;
    if (i === 9)
      throw new ApiError(
        400,
        "forms_limit",
        "More than 1,000 forms are available. Narrow the Page setup before continuing.",
      );
  }
  const t = now(),
    updates: D1PreparedStatement[] = [];
  for (const form of all) {
    externalId(form.id);
    updates.push(
      statement(
        env,
        `INSERT INTO instant_forms(workspace_id,id,page_id,name,status,questions_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET name=excluded.name,status=excluded.status,questions_json=excluded.questions_json,updated_at=excluded.updated_at`,
        workspace,
        form.id,
        pageId,
        form.name,
        form.status || "UNKNOWN",
        JSON.stringify(form.questions || []),
        t,
        t,
      ),
    );
  }
  if (updates.length) await env.DB.batch(updates);
  return all;
}
metaRoutes.get("/connect", async (c) => {
  requireAdmin(c);
  requireCsrf(c);
  if (!metaConfigured(c.env))
    throw new ApiError(
      503,
      "meta_not_configured",
      "Meta configuration is incomplete. Ask the owner to configure the server.",
    );
  const a = c.get("auth"),
    state = randomToken();
  const target = c.req.query("accountId") || null;
  if (
    target &&
    !(await one(
      c.env,
      "SELECT 1 FROM meta_connections WHERE workspace_id=? AND meta_user_id=?",
      a.workspaceId,
      externalId(target),
    ))
  )
    throw new ApiError(404, "not_found", "Facebook account not found.");
  await statement(
    c.env,
    "INSERT INTO oauth_states(state_hash,session_family,workspace_id,expires_at,target_user_id) VALUES(?,?,?,?,?)",
    await sha(state),
    a.familyId,
    a.workspaceId,
    after(600),
    target,
  ).run();
  const url = new URL(
    `https://www.facebook.com/${c.env.META_GRAPH_VERSION}/dialog/oauth`,
  );
  Object.entries({
    client_id: c.env.META_APP_ID!,
    redirect_uri: callbackUri(c.env),
    state,
    response_type: "code",
    scope: scopes.join(","),
    ...(c.env.META_LOGIN_CONFIG_ID
      ? { config_id: c.env.META_LOGIN_CONFIG_ID }
      : {}),
    auth_type: "rerequest",
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  return c.json({ ok: true, data: { url: url.toString() } });
});
metaRoutes.get("/callback", async (c) => {
  requireAdmin(c);
  const a = c.get("auth"),
    state = c.req.query("state") || "",
    code = c.req.query("code");
  if (!state || state.length > 128)
    throw new ApiError(
      400,
      "oauth_state",
      "Invalid OAuth state. Reconnect Facebook.",
    );
  const consumed = await statement(
    c.env,
    "DELETE FROM oauth_states WHERE state_hash=? AND workspace_id=? AND session_family=? AND expires_at>? RETURNING state_hash,target_user_id",
    await sha(state),
    a.workspaceId,
    a.familyId,
    now(),
  ).first<{ state_hash: string; target_user_id: string | null }>();
  if (!consumed)
    throw new ApiError(
      400,
      "oauth_state",
      "OAuth state expired or was already used. Reconnect Facebook.",
    );
  if (c.req.query("error") || !code)
    return c.redirect(`${c.env.APP_ORIGIN}/?meta=cancelled`);
  if (!metaConfigured(c.env))
    throw new ApiError(503, "meta_not_configured", "Meta is not configured.");
  const short = await exchange(c.env, {
      code,
      redirect_uri: callbackUri(c.env),
    }),
    long = await exchange(c.env, {
      grant_type: "fb_exchange_token",
      fb_exchange_token: short.access_token,
    }),
    debug = await debugToken(c.env, long.access_token);
  const permissionResult = await graph<
      GraphList<{ permission: string; status: string }>
    >(c.env, "me/permissions", long.access_token),
    granted = permissionResult.data
      .filter((p) => p.status === "granted")
      .map((p) => p.permission);
  const missingPermissions = scopes.filter((s) => !granted.includes(s));
  if (missingPermissions.length)
    throw new ApiError(
      403,
      "missing_permissions",
      `Meta did not grant: ${missingPermissions.join(", ")}. Add these permissions to the Meta login configuration and reconnect Facebook.`,
    );
  if (!debug.data.user_id) throw new GraphError("missing_meta_user", false);
  if (consumed.target_user_id && consumed.target_user_id !== debug.data.user_id)
    throw new ApiError(
      400,
      "wrong_facebook_account",
      "You signed into a different Facebook account. Reconnect using the selected account, or choose Add Facebook account.",
    );
  const accountId = debug.data.user_id;
  const t = now();
  await c.env.DB.batch([
    statement(
      c.env,
      `INSERT INTO meta_connections(workspace_id,meta_user_id,token_encrypted,token_expires_at,permissions_json,status,connected_by,created_at,updated_at,label,token_context) VALUES(?,?,?,?,?,'authorized',?,?,?,?, 'account') ON CONFLICT(workspace_id,meta_user_id) DO UPDATE SET token_encrypted=excluded.token_encrypted,token_context=excluded.token_context,token_expires_at=excluded.token_expires_at,permissions_json=excluded.permissions_json,status='authorized',last_error=NULL,connected_by=excluded.connected_by,updated_at=excluded.updated_at`,
      a.workspaceId,
      debug.data.user_id,
      await encrypt(
        c.env.TOKEN_ENCRYPTION_KEY,
        long.access_token,
        `${a.workspaceId}:user:${accountId}`,
      ),
      debug.expiresAt,
      JSON.stringify(granted),
      a.userId,
      t,
      t,
      `Facebook account ${accountId}`,
    ),
    statement(
      c.env,
      "UPDATE facebook_pages SET authorized=0,subscribed=0 WHERE workspace_id=? AND id IN (SELECT page_id FROM meta_account_pages WHERE workspace_id=? AND meta_user_id=?)",
      a.workspaceId,
      a.workspaceId,
      accountId,
    ),
    audit(c.env, a, "meta.authorized"),
  ]);
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const result: GraphList<MetaPage> = await graph(
      c.env,
      "me/accounts",
      long.access_token,
      {
        fields: "id,name,access_token,tasks",
        limit: "100",
        ...(cursor ? { after: cursor } : {}),
      },
    );
    const pageUpdates: D1PreparedStatement[] = [];
    for (const p of result.data) {
      externalId(p.id);
      if (!p.access_token) continue;
      const owner = await one<{ meta_user_id: string }>(
        c.env,
        "SELECT meta_user_id FROM meta_account_pages WHERE workspace_id=? AND page_id=?",
        a.workspaceId,
        p.id,
      );
      // Shared Pages retain their original owner and source identity.
      if (owner && owner.meta_user_id !== accountId) continue;
      pageUpdates.push(
        statement(
          c.env,
          `INSERT INTO facebook_pages(workspace_id,id,name,token_encrypted,tasks_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,id) DO UPDATE SET name=excluded.name,token_encrypted=excluded.token_encrypted,tasks_json=excluded.tasks_json,last_error=NULL,updated_at=excluded.updated_at WHERE NOT EXISTS(SELECT 1 FROM meta_account_pages owner WHERE owner.workspace_id=excluded.workspace_id AND owner.page_id=excluded.id AND owner.meta_user_id<>?)`,
          a.workspaceId,
          p.id,
          p.name,
          await encrypt(
            c.env.TOKEN_ENCRYPTION_KEY,
            p.access_token,
            `${a.workspaceId}:page:${p.id}`,
          ),
          JSON.stringify(p.tasks || []),
          t,
          t,
          accountId,
        ),
        statement(
          c.env,
          "INSERT OR IGNORE INTO meta_account_pages(workspace_id,page_id,meta_user_id) VALUES(?,?,?)",
          a.workspaceId,
          p.id,
          accountId,
        ),
      );
    }
    if (pageUpdates.length) await c.env.DB.batch(pageUpdates);
    if (!result.paging?.next) break;
    const next = result.paging.cursors?.after;
    if (!next || next === cursor)
      throw new GraphError("invalid_pages_cursor", false);
    cursor = next;
    if (i === 9)
      throw new ApiError(
        400,
        "pages_limit",
        "Too many manageable Pages. Grant this app access only to the Pages you need.",
      );
  }
  return c.redirect(`${c.env.APP_ORIGIN}/?meta=authorized`);
});
metaRoutes.get("/pages", async (c) => {
  requireAdmin(c);
  return c.json({
    ok: true,
    data: await rows(
      c.env,
      "SELECT id,name,tasks_json,authorized,subscribed,token_expires_at,last_sync_at,last_webhook_at,last_error FROM facebook_pages WHERE workspace_id=? ORDER BY name",
      c.get("auth").workspaceId,
    ),
  });
});
metaRoutes.post("/pages/select", async (c) => {
  requireAdmin(c);
  const a = c.get("auth"),
    b = await body(c);
  keys(b, ["pageId"]);
  const pid = externalId(b.pageId),
    p = await one<{ token_encrypted: string }>(
      c.env,
      "SELECT token_encrypted FROM facebook_pages WHERE workspace_id=? AND id=?",
      a.workspaceId,
      pid,
    );
  if (!p)
    throw new ApiError(
      404,
      "not_found",
      "Page not available. Reconnect and grant Page access.",
    );
  let stage = "token_validation";
  try {
    const token = await decrypt(
        c.env.TOKEN_ENCRYPTION_KEY,
        p.token_encrypted,
        `${a.workspaceId}:page:${pid}`,
      ),
      debug = await debugToken(c.env, token);
    const missingPagePermissions = scopes.filter(
      (s) => !debug.data.scopes?.includes(s),
    );
    if (missingPagePermissions.length)
      throw new ApiError(
        403,
        "missing_permissions",
        `This Page token lacks: ${missingPagePermissions.join(", ")}. Add these permissions to the Meta login configuration and reconnect Facebook.`,
      );
    const grant = debug.data.granular_scopes?.find(
      (g) => g.scope === "leads_retrieval",
    );
    if (grant?.target_ids && !grant.target_ids.includes(pid))
      throw new ApiError(
        403,
        "lead_access",
        "Lead retrieval was not authorized for this Page.",
      );
    stage = "form_discovery";
    await refreshForms(c.env, a.workspaceId, pid, token);
    stage = "page_subscription";
    const subscribed = await graph<{ success: boolean }>(
      c.env,
      `${pid}/subscribed_apps`,
      token,
      { subscribed_fields: "leadgen" },
      "POST",
    );
    if (subscribed.success !== true)
      throw new GraphError("subscription_failed", false);
    stage = "subscription_confirmation";
    const confirmation = await graph<
      GraphList<{ id: string; subscribed_fields?: string[] }>
    >(c.env, `${pid}/subscribed_apps`, token, {
      fields: "id,subscribed_fields",
    });
    if (
      !confirmation.data.some(
        (v) =>
          v.id === c.env.META_APP_ID &&
          v.subscribed_fields?.includes("leadgen"),
      )
    )
      throw new GraphError("subscription_unconfirmed", false);
    await c.env.DB.batch([
      statement(
        c.env,
        "UPDATE facebook_pages SET authorized=1,subscribed=1,token_expires_at=?,last_error=NULL,updated_at=? WHERE workspace_id=? AND id=?",
        debug.expiresAt,
        now(),
        a.workspaceId,
        pid,
      ),
      statement(
        c.env,
        "UPDATE meta_connections SET status='connected',last_error=NULL,updated_at=? WHERE workspace_id=? AND meta_user_id IN (SELECT meta_user_id FROM meta_account_pages WHERE workspace_id=? AND page_id=?)",
        now(),
        a.workspaceId,
        a.workspaceId,
        pid,
      ),
      audit(c.env, a, "meta.page_connected", pid),
    ]);
    return c.json({ ok: true, data: { pageId: pid, subscribed: true } });
  } catch (error) {
    if (!(error instanceof GraphError) && !(error instanceof ApiError))
      throw error;
    const permissionHint =
      error instanceof GraphError && error.details?.requiredPermissions.length
        ? ` Meta requires ${error.details.requiredPermissions.join(", ")}. Add the required permission to the Meta login configuration, then reconnect Facebook.`
        : "";
    const code = error.code;
    const detail =
      error instanceof GraphError
        ? `Meta ${code}${error.details?.subcode ? `/${error.details.subcode}` : ""}`
        : code;
    const message = `Page connection failed during ${stage.replaceAll("_", " ")} (${detail}).${permissionHint || " " + error.message}`;
    await c.env.DB.batch([
      statement(
        c.env,
        "UPDATE facebook_pages SET last_error=?,updated_at=? WHERE workspace_id=? AND id=?",
        message,
        now(),
        a.workspaceId,
        pid,
      ),
      audit(c.env, a, "meta.page_connection_failed", pid),
    ]);
    throw new ApiError(
      error instanceof GraphError
        ? error.transient
          ? 503
          : 403
        : error.status,
      `meta_page_${stage}_${code}`,
      message,
    );
  }
});
metaRoutes.get("/forms", async (c) => {
  requireAdmin(c);
  requireCsrf(c);
  const a = c.get("auth"),
    pid = externalId(c.req.query("pageId")),
    p = await one<{ token_encrypted: string }>(
      c.env,
      "SELECT token_encrypted FROM facebook_pages WHERE workspace_id=? AND id=? AND authorized=1",
      a.workspaceId,
      pid,
    );
  if (!p) throw new ApiError(404, "not_found", "Connect the Page first.");
  const token = await decrypt(
    c.env.TOKEN_ENCRYPTION_KEY,
    p.token_encrypted,
    `${a.workspaceId}:page:${pid}`,
  );
  const forms = await refreshForms(c.env, a.workspaceId, pid, token);
  await audit(c.env, a, "meta.forms_refreshed", pid).run();
  return c.json({ ok: true, data: { count: forms.length } });
});
metaRoutes.post("/sync", async (c) => {
  requireAdmin(c);
  const a = c.get("auth"),
    b = await body(c);
  keys(b, ["formIds"]);
  if (
    !Array.isArray(b.formIds) ||
    b.formIds.length < 1 ||
    b.formIds.length > 20
  )
    throw new ApiError(400, "validation", "Choose 1–20 selected forms.");
  const ids: string[] = [];
  for (const raw of new Set(b.formIds)) {
    const fid = externalId(raw),
      f = await one<{ page_id: string }>(
        c.env,
        "SELECT f.page_id FROM instant_forms f JOIN facebook_pages p ON p.workspace_id=f.workspace_id AND p.id=f.page_id WHERE f.workspace_id=? AND f.id=? AND f.selected=1 AND p.authorized=1",
        a.workspaceId,
        fid,
      );
    if (!f)
      throw new ApiError(
        400,
        "form_not_connected",
        "Select a form on an authorized Page before syncing.",
      );
    const key = `history:${fid}`,
      existing = await one<{ id: string; status: string }>(
        c.env,
        "SELECT id,status FROM sync_jobs WHERE workspace_id=? AND dedupe_key=?",
        a.workspaceId,
        key,
      );
    if (existing) {
      if (["complete", "cancelled"].includes(existing.status))
        await statement(
          c.env,
          "UPDATE sync_jobs SET status='pending',attempts=0,cursor=NULL,since_at=NULL,imported=0,next_run_at=?,updated_at=? WHERE workspace_id=? AND id=? AND status IN('complete','cancelled')",
          now(),
          now(),
          a.workspaceId,
          existing.id,
        ).run();
      ids.push(existing.id);
    } else {
      const j = enqueueStatement(
        c.env,
        a.workspaceId,
        f.page_id,
        fid,
        null,
        "history",
        key,
      );
      await j.statement.run();
      ids.push(j.id);
    }
  }
  await audit(c.env, a, "meta.sync_requested").run();
  c.executionCtx.waitUntil(signalJobs(c.env, ids));
  return c.json(
    {
      ok: true,
      data: {
        jobIds: ids,
        message:
          "Sync durably scheduled. Available leads only; unavailable or expired leads cannot be recovered.",
      },
    },
    202,
  );
});
metaRoutes.get("/jobs", async (c) => {
  requireAdmin(c);
  const a = c.get("auth");
  return c.json({
    ok: true,
    data: await rows(
      c.env,
      "SELECT id,page_id,form_id,lead_id,kind,status,attempts,imported,next_run_at,last_error,error_code,updated_at FROM sync_jobs WHERE workspace_id=? ORDER BY updated_at DESC LIMIT 100",
      a.workspaceId,
    ),
  });
});
metaRoutes.post("/jobs/:id/replay", async (c) => {
  requireAdmin(c);
  const a = c.get("auth"),
    jid = text(c.req.param("id"), "job", 100);
  const result = await statement(
    c.env,
    "UPDATE sync_jobs SET status='pending',attempts=0,lease_until=NULL,lease_token=NULL,next_run_at=?,last_error=NULL,error_code=NULL,updated_at=? WHERE workspace_id=? AND id=? AND status='dead'",
    now(),
    now(),
    a.workspaceId,
    jid,
  ).run();
  if (!result.meta.changes)
    throw new ApiError(
      409,
      "not_replayable",
      "Job not found or not in dead-letter state.",
    );
  await audit(c.env, a, "meta.job_replayed", jid).run();
  c.executionCtx.waitUntil(signalJobs(c.env, [jid]));
  return c.json({ ok: true, data: { id: jid } }, 202);
});
metaRoutes.get("/connection-status", async (c) => {
  const a = c.get("auth"),
    connection = await one(
      c.env,
      "SELECT meta_user_id,label,status,permissions_json,token_expires_at,last_error,updated_at FROM meta_connections WHERE workspace_id=? ORDER BY created_at LIMIT 1",
      a.workspaceId,
    ),
    pages = await rows(
      c.env,
      "SELECT p.id,p.name,p.authorized,p.subscribed,p.last_sync_at,p.last_webhook_at,p.last_error,p.token_expires_at,m.meta_user_id AS account_id FROM facebook_pages p LEFT JOIN meta_account_pages m ON m.workspace_id=p.workspace_id AND m.page_id=p.id WHERE p.workspace_id=?",
      a.workspaceId,
    ),
    health = await one(
      c.env,
      "SELECT SUM(status='pending') AS pending,SUM(status='running') AS running,SUM(status='dead') AS failed FROM sync_jobs WHERE workspace_id=?",
      a.workspaceId,
    );
  return c.json({
    ok: true,
    data: {
      configured: metaConfigured(c.env),
      webhookConfigured: Boolean(
        c.env.META_WEBHOOK_VERIFY_TOKEN && c.env.META_APP_SECRET,
      ),
      callbackUri: metaConfigured(c.env) ? callbackUri(c.env) : null,
      webhookUri: metaConfigured(c.env)
        ? `${c.env.APP_ORIGIN}/api/webhooks/meta`
        : null,
      requiredScopes: scopes,
      connection:
        connection &&
        typeof connection.token_expires_at === "string" &&
        connection.token_expires_at <= now()
          ? {
              ...connection,
              status: "needs_reauth",
              last_error:
                "Facebook token access has expired. Reconnect Facebook.",
            }
          : connection,
      accounts: (
        await rows(
          c.env,
          "SELECT meta_user_id,label,status,permissions_json,token_expires_at,last_error,updated_at FROM meta_connections WHERE workspace_id=? ORDER BY created_at,meta_user_id",
          a.workspaceId,
        )
      ).map((account) =>
        account.status !== "disconnected" &&
        typeof account.token_expires_at === "string" &&
        account.token_expires_at <= now()
          ? {
              ...account,
              status: "needs_reauth",
              last_error:
                "Facebook token access has expired. Reconnect this account.",
            }
          : account,
      ),
      pages: pages.map((p) =>
        typeof p.token_expires_at === "string" && p.token_expires_at <= now()
          ? {
              ...p,
              authorized: 0,
              last_error: "Page token access has expired. Reconnect Facebook.",
            }
          : p,
      ),
      health,
      delivery: c.env.INGEST_QUEUE ? "queue-and-d1" : "d1-cron",
    },
  });
});
metaRoutes.get("/accounts", async (c) => {
  return c.json({
    ok: true,
    data: await rows(
      c.env,
      "SELECT meta_user_id,label,status FROM meta_connections WHERE workspace_id=? ORDER BY created_at,meta_user_id",
      c.get("auth").workspaceId,
    ),
  });
});
metaRoutes.patch("/accounts/:id", async (c) => {
  requireAdmin(c);
  const a = c.get("auth"),
    accountId = externalId(c.req.param("id")),
    b = await body(c);
  keys(b, ["label"]);
  const label = text(b.label, "account name", 100);
  if (
    !(await one(
      c.env,
      "SELECT 1 FROM meta_connections WHERE workspace_id=? AND meta_user_id=?",
      a.workspaceId,
      accountId,
    ))
  )
    throw new ApiError(404, "not_found", "Facebook account not found.");
  await c.env.DB.batch([
    statement(
      c.env,
      "UPDATE meta_connections SET label=?,updated_at=? WHERE workspace_id=? AND meta_user_id=?",
      label,
      now(),
      a.workspaceId,
      accountId,
    ),
    audit(c.env, a, "meta.account_renamed", accountId),
  ]);
  return c.json({ ok: true, data: { label } });
});
metaRoutes.post("/disconnect", async (c) => {
  requireAdmin(c);
  const a = c.get("auth"),
    b = await body(c);
  keys(b, ["accountId"]);
  if (!b.accountId)
    throw new ApiError(
      400,
      "account_required",
      "Select the Facebook account to disconnect.",
    );
  const accountId = externalId(b.accountId);
  const connection = await one<{
    token_encrypted: string;
    token_context: string;
  }>(
    c.env,
    "SELECT token_encrypted,token_context FROM meta_connections WHERE workspace_id=? AND meta_user_id=?",
    a.workspaceId,
    accountId,
  );
  if (!connection)
    throw new ApiError(404, "not_found", "Facebook account not found.");
  let revoked = !connection.token_encrypted;
  if (connection.token_encrypted)
    try {
      const token = await decrypt(
        c.env.TOKEN_ENCRYPTION_KEY,
        connection.token_encrypted,
        connection.token_context === "account"
          ? `${a.workspaceId}:user:${accountId}`
          : `${a.workspaceId}:user`,
      );
      revoked =
        (
          await graph<{ success: boolean }>(
            c.env,
            "me/permissions",
            token,
            {},
            "DELETE",
          )
        ).success === true;
    } catch {
      /* Local credentials are removed even if Meta is unavailable. */
    }
  const pageScope =
    "SELECT page_id FROM meta_account_pages WHERE workspace_id=? AND meta_user_id=?";
  await c.env.DB.batch([
    statement(
      c.env,
      "UPDATE meta_connections SET token_encrypted='',status='disconnected',last_error=NULL,updated_at=? WHERE workspace_id=? AND meta_user_id=?",
      now(),
      a.workspaceId,
      accountId,
    ),
    statement(
      c.env,
      `UPDATE facebook_pages SET token_encrypted='',authorized=0,subscribed=0,last_error=NULL,updated_at=? WHERE workspace_id=? AND id IN (${pageScope})`,
      now(),
      a.workspaceId,
      a.workspaceId,
      accountId,
    ),
    statement(
      c.env,
      `UPDATE instant_forms SET selected=0 WHERE workspace_id=? AND page_id IN (${pageScope})`,
      a.workspaceId,
      a.workspaceId,
      accountId,
    ),
    statement(
      c.env,
      `UPDATE sync_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,last_error=NULL,updated_at=? WHERE workspace_id=? AND page_id IN (${pageScope}) AND status IN ('pending','running','dead')`,
      now(),
      a.workspaceId,
      a.workspaceId,
      accountId,
    ),
    statement(
      c.env,
      "DELETE FROM oauth_states WHERE workspace_id=? AND target_user_id=?",
      a.workspaceId,
      accountId,
    ),
    audit(c.env, a, "meta.disconnected", accountId),
  ]);
  return c.json({
    ok: true,
    data: {
      disconnected: true,
      revoked,
      message: revoked
        ? "Selected Facebook account disconnected. CRM records and other accounts were retained."
        : "Selected account credentials removed. Meta revocation could not be confirmed; remove this app in that Facebook account's Business Integrations. Other accounts and CRM records were retained.",
    },
  });
});
