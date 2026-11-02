import type { Env } from "./types";
import { now } from "./types";
import { rows, statement } from "./db";
import { graph, GraphError, type GraphList } from "./meta-client";
import { decrypt } from "./crypto";
import { maintenance } from "./jobs";
import { dispatchInbox } from "./inbox";
export async function scheduledSync(env: Env) {
  const started = now();
  await statement(
    env,
    "INSERT INTO sync_health(workspace_id,last_scheduler_at) SELECT id,? FROM workspaces WHERE 1 ON CONFLICT(workspace_id) DO UPDATE SET last_scheduler_at=excluded.last_scheduler_at,last_scheduler_error=NULL",
    started,
  ).run();
  try {
    const inbox = await rows<{ id: string }>(
      env,
      "SELECT id FROM webhook_inbox WHERE status='pending' OR (status='running' AND lease_until<?) ORDER BY updated_at LIMIT 1",
      now(),
    );
    for (const item of inbox) await dispatchInbox(env, item.id);
    await maintenance(env, inbox.length === 0);
    await statement(
      env,
      "UPDATE sync_health SET last_scheduler_completed_at=?,last_scheduler_error=NULL WHERE last_scheduler_at=?",
      now(),
      started,
    ).run();
  } catch {
    await statement(
      env,
      "UPDATE sync_health SET last_scheduler_error='Scheduled sync failed; durable jobs remain recoverable.' WHERE last_scheduler_at=?",
      started,
    ).run();
    throw new Error("scheduled_sync_failed");
  }
}
export async function auditSubscriptions(env: Env, workspace?: string) {
  const pages = await rows<{
    workspace_id: string;
    id: string;
    token_encrypted: string;
  }>(
    env,
    `SELECT workspace_id,id,token_encrypted FROM facebook_pages WHERE authorized=1 ${workspace ? "AND workspace_id=?" : ""} ORDER BY subscription_checked_at LIMIT 2`,
    ...(workspace ? [workspace] : []),
  );
  const expected = `${env.APP_ORIGIN}/api/webhooks/meta`;
  let appOk = false,
    appError: string | null = null;
  try {
    const result = await graph<
      GraphList<{
        object: string;
        callback_url?: string;
        active?: boolean;
        fields?: { name: string }[];
      }>
    >(
      env,
      `${env.META_APP_ID}/subscriptions`,
      `${env.META_APP_ID}|${env.META_APP_SECRET}`,
    );
    appOk = result.data.some(
      (s) =>
        s.object === "page" &&
        s.active !== false &&
        s.callback_url?.replace(/\/$/, "") === expected &&
        s.fields?.some((f) => f.name === "leadgen"),
    );
    if (!appOk)
      appError =
        "Meta app Page/leadgen webhook is missing, inactive or uses another callback. Configure the Page webhook callback in Meta Developers, then send a test lead.";
  } catch (e) {
    appError =
      e instanceof GraphError
        ? `App webhook verification failed (Meta ${e.code}). Check Meta Developers and retry.`
        : "App webhook verification failed. Retry the check.";
  }
  const workspaces = new Set(pages.map((p) => p.workspace_id));
  if (workspace) workspaces.add(workspace);
  for (const wid of workspaces)
    await statement(
      env,
      "INSERT INTO sync_health(workspace_id,app_checked_at,app_subscription_ok,app_error) VALUES(?,?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET app_checked_at=excluded.app_checked_at,app_subscription_ok=excluded.app_subscription_ok,app_error=excluded.app_error",
      wid,
      now(),
      appOk ? 1 : 0,
      appError,
    ).run();
  for (const page of pages) {
    let ok = false,
      error: string | null = null;
    try {
      const token = await decrypt(
        env.TOKEN_ENCRYPTION_KEY,
        page.token_encrypted,
        `${page.workspace_id}:page:${page.id}`,
      );
      let existingFields: string[] = [];
      const subscribed = async () => {
        const list = await graph<
          GraphList<{ id: string; subscribed_fields?: string[] }>
        >(env, `${page.id}/subscribed_apps`, token, {
          fields: "id,subscribed_fields",
        });
        const app = list.data.find((a) => a.id === env.META_APP_ID);
        existingFields = (app?.subscribed_fields || [])
          .filter((f) => typeof f === "string" && /^[a-z0-9_]+$/.test(f))
          .slice(0, 100);
        return existingFields.includes("leadgen");
      };
      ok = await subscribed();
      if (!ok) {
        await graph(
          env,
          `${page.id}/subscribed_apps`,
          token,
          {
            subscribed_fields: [
              ...new Set([...existingFields, "leadgen"]),
            ].join(","),
          },
          "POST",
        );
        ok = await subscribed();
      }
      if (!ok)
        error =
          "Page leadgen subscription could not be confirmed. Reconnect and verify this Page.";
    } catch (e) {
      error =
        e instanceof GraphError
          ? `Page webhook verification failed (Meta ${e.code}). Check granted permissions and reconnect if required.`
          : "Page webhook verification failed. Retry the check.";
    }
    await statement(
      env,
      "UPDATE facebook_pages SET subscription_checked_at=?,subscription_error=?,subscribed=? WHERE workspace_id=? AND id=?",
      now(),
      error,
      ok ? 1 : 0,
      page.workspace_id,
      page.id,
    ).run();
  }
}
