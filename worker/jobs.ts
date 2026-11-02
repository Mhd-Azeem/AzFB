import type { Env } from "./types";
import { after, id, now } from "./types";
import { one, rows, statement } from "./db";
import { decrypt, sha } from "./crypto";
import {
  graph,
  fetchLeads,
  GraphError,
  leadFields,
  type GraphList,
  type MetaLead,
} from "./meta-client";
export interface Job {
  id: string;
  workspace_id: string;
  page_id: string;
  form_id: string | null;
  lead_id: string | null;
  kind: "lead" | "history";
  status: string;
  attempts: number;
  cursor: string | null;
  lease_token: string;
  imported: number;
  since_at: string | null;
}
export function retryDelay(attempt: number, retryAfter = 0) {
  return (
    Math.min(21600, Math.max(retryAfter, 30 * 2 ** Math.min(attempt, 10))) +
    Math.floor(Math.random() * 20)
  );
}
export function enqueueStatement(
  env: Env,
  workspace: string,
  page: string,
  form: string,
  lead: string | null,
  kind: "lead" | "history",
  key: string,
) {
  const jid = id(),
    t = now();
  return {
    id: jid,
    statement: statement(
      env,
      "INSERT OR IGNORE INTO sync_jobs(id,workspace_id,page_id,form_id,lead_id,kind,dedupe_key,next_run_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      jid,
      workspace,
      page,
      form,
      lead,
      kind,
      key,
      t,
      t,
      t,
    ),
  };
}
export async function signalJobs(env: Env, ids: string[], delaySeconds = 0) {
  if (!env.INGEST_QUEUE) return;
  for (const jid of ids) {
    try {
      await env.INGEST_QUEUE.send({ jobId: jid }, { delaySeconds });
    } catch {
      /* D1 is the durable source of truth. Cron will retry delivery/work. */
    }
  }
}
export async function saveLead(
  env: Env,
  workspace: string,
  page: string,
  form: string,
  data: MetaLead,
  jobContext?: { id: string; lease: string },
) {
  if (
    !/^\d+$/.test(data.id) ||
    !Array.isArray(data.field_data) ||
    !Number.isFinite(Date.parse(data.created_time)) ||
    (data.form_id && data.form_id !== form)
  )
    throw new GraphError("invalid_lead_response", false);
  const selected = await one(
    env,
    "SELECT 1 FROM instant_forms WHERE workspace_id=? AND id=? AND page_id=? AND selected=1",
    workspace,
    form,
    page,
  );
  if (!selected) return false;
  if (
    data.field_data.length > 100 ||
    data.field_data.some(
      (v) =>
        !v ||
        typeof v.name !== "string" ||
        v.name.length > 200 ||
        !Array.isArray(v.values) ||
        v.values.some((x) => typeof x !== "string"),
    )
  )
    throw new GraphError("invalid_field_data", false);
  const fields = data.field_data.map((v) => ({
    name: v.name,
    values: [...v.values],
  }));
  if (data.custom_disclaimer_responses?.length)
    fields.push({
      name: "custom_disclaimer_responses",
      values: data.custom_disclaimer_responses.map((v) => JSON.stringify(v)),
    });
  if (new TextEncoder().encode(JSON.stringify(fields)).length > 500000)
    throw new GraphError("lead_answers_too_large", false);
  const val = (key: string) =>
    fields.find((v) => v.name === key)?.values.join(", ") || "";
  const name =
    val("full_name") ||
    [val("first_name"), val("last_name")].filter(Boolean).join(" ") ||
    "Unnamed lead";
  const lid = await sha(`${workspace}:${page}:${data.id}`),
    t = now(),
    questions = await one<{ questions_json: string }>(
      env,
      "SELECT questions_json FROM instant_forms WHERE workspace_id=? AND id=?",
      workspace,
      form,
    );
  let qs: { key: string; label?: string }[] = [];
  try {
    qs = JSON.parse(questions?.questions_json || "[]");
  } catch {
    /* Preserve original field keys. */
  }
  const result = await env.DB.batch([
    statement(
      env,
      `INSERT OR IGNORE INTO leads(id,workspace_id,lead_id,form_id,page_id,name,email,phone,campaign,ad_id,submitted_at,field_data_json,source_json,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM lead_tombstones WHERE workspace_id=? AND page_id=? AND lead_id=?) AND EXISTS(SELECT 1 FROM instant_forms f JOIN facebook_pages p ON p.workspace_id=f.workspace_id AND p.id=f.page_id WHERE f.workspace_id=? AND f.id=? AND f.page_id=? AND f.selected=1 AND p.authorized=1)`,
      lid,
      workspace,
      data.id,
      form,
      page,
      name.slice(0, 300),
      val("email").slice(0, 254),
      val("phone_number").slice(0, 100),
      data.campaign_name?.slice(0, 300) || "",
      data.ad_id || null,
      new Date(data.created_time).toISOString(),
      JSON.stringify(fields),
      JSON.stringify({
        ad_id: data.ad_id || null,
        campaign_id: data.campaign_id || null,
        ad_name: data.ad_name || null,
        platform: data.platform || null,
        is_organic: data.is_organic ?? null,
      }),
      t,
      t,
      workspace,
      page,
      data.id,
      workspace,
      form,
      page,
    ),
    ...(jobContext
      ? [
          statement(
            env,
            "UPDATE sync_jobs SET imported=imported+changes() WHERE workspace_id=? AND id=? AND lease_token=? AND status='running'",
            workspace,
            jobContext.id,
            jobContext.lease,
          ),
        ]
      : []),
    ...fields.map((f) =>
      statement(
        env,
        `INSERT OR IGNORE INTO lead_answers(id,workspace_id,lead_id,field_key,question,values_json,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM leads WHERE workspace_id=? AND id=?)`,
        `${lid}:${f.name}`,
        workspace,
        lid,
        f.name,
        qs.find((q) => q.key === f.name)?.label || f.name,
        JSON.stringify(f.values),
        t,
        workspace,
        lid,
      ),
    ),
    statement(
      env,
      `INSERT OR IGNORE INTO lead_activities(id,workspace_id,lead_id,actor_id,kind,detail,created_at) SELECT ?,?,?,NULL,'received','Lead received from Meta',? WHERE EXISTS(SELECT 1 FROM leads WHERE workspace_id=? AND id=?)`,
      `${lid}:received`,
      workspace,
      lid,
      t,
      workspace,
      lid,
    ),
  ]);
  return Boolean(result[0].meta.changes);
}
export async function processJob(env: Env, jobId: string) {
  const lease = id(),
    t = now();
  const job = await statement(
    env,
    `UPDATE sync_jobs SET status='running',attempts=attempts+1,lease_until=?,lease_token=?,updated_at=? WHERE id=? AND ((status='pending' AND next_run_at<=?) OR (status='running' AND lease_until<?)) RETURNING *`,
    after(180),
    lease,
    t,
    jobId,
    t,
    t,
  ).first<Job>();
  if (!job) return;
  try {
    const page = await one<{
      token_encrypted: string;
      authorized: number;
      token_expires_at: string | null;
    }>(
      env,
      "SELECT token_encrypted,authorized,token_expires_at FROM facebook_pages WHERE workspace_id=? AND id=?",
      job.workspace_id,
      job.page_id,
    );
    if (!page?.authorized) throw new GraphError("page_not_authorized", false);
    if (page.token_expires_at && page.token_expires_at <= now())
      throw new GraphError("expired_token", false);
    const form = await one(
      env,
      "SELECT 1 FROM instant_forms WHERE workspace_id=? AND id=? AND page_id=? AND selected=1",
      job.workspace_id,
      job.form_id,
      job.page_id,
    );
    if (!form) {
      await statement(
        env,
        "UPDATE sync_jobs SET status='cancelled',lease_until=NULL,updated_at=? WHERE id=? AND lease_token=? AND status='running'",
        now(),
        job.id,
        lease,
      ).run();
      return;
    }
    const token = await decrypt(
      env.TOKEN_ENCRYPTION_KEY,
      page.token_encrypted,
      `${job.workspace_id}:page:${job.page_id}`,
    );
    let next: string | null = null;
    if (job.kind === "lead") {
      const data = await fetchLeads<MetaLead>(env, job.lead_id!, token, {
        fields: leadFields,
      });
      if (data.id !== job.lead_id)
        throw new GraphError("lead_identity_mismatch", false);
      await saveLead(env, job.workspace_id, job.page_id, job.form_id!, data, {
        id: job.id,
        lease,
      });
    } else {
      const result = await fetchLeads<GraphList<MetaLead>>(
        env,
        `${job.form_id}/leads`,
        token,
        {
          fields: leadFields,
          limit: "5",
          ...(job.since_at
            ? {
                filtering: JSON.stringify([
                  {
                    field: "time_created",
                    operator: "GREATER_THAN",
                    value: Math.floor(Date.parse(job.since_at) / 1000),
                  },
                ]),
              }
            : {}),
          ...(job.cursor ? { after: job.cursor } : {}),
        },
      );
      if (!Array.isArray(result.data))
        throw new GraphError("invalid_page", true);
      for (const data of result.data)
        await saveLead(env, job.workspace_id, job.page_id, job.form_id!, data, {
          id: job.id,
          lease,
        });
      if (result.paging?.next) {
        next = result.paging.cursors?.after || null;
        if (!next || next === job.cursor)
          throw new GraphError("invalid_cursor", false);
      }
    }
    const finish = now();
    await env.DB.batch([
      statement(
        env,
        `UPDATE sync_jobs SET status=?,cursor=?,imported=imported+?,attempts=?,next_run_at=?,lease_until=NULL,lease_token=NULL,last_error=NULL,error_code=NULL,updated_at=? WHERE id=? AND lease_token=? AND status='running'`,
        next ? "pending" : "complete",
        next,
        0,
        next ? 0 : job.attempts,
        next ? after(10) : finish,
        finish,
        job.id,
        lease,
      ),
      statement(
        env,
        "UPDATE facebook_pages SET last_sync_at=?,last_error=NULL,updated_at=? WHERE workspace_id=? AND id=? AND authorized=1",
        finish,
        finish,
        job.workspace_id,
        job.page_id,
      ),
      statement(
        env,
        "UPDATE instant_forms SET last_sync_at=?,reconciled_at=CASE WHEN ?=1 THEN ? ELSE reconciled_at END,updated_at=? WHERE workspace_id=? AND id=?",
        finish,
        job.kind === "history" && !next ? 1 : 0,
        finish,
        finish,
        job.workspace_id,
        job.form_id,
      ),
      ...(job.kind === "lead"
        ? [
            statement(
              env,
              "UPDATE webhook_events SET state='processed',processed_at=? WHERE workspace_id=? AND page_id=? AND lead_id=?",
              finish,
              job.workspace_id,
              job.page_id,
              job.lead_id,
            ),
          ]
        : []),
    ]);
    if (next) await signalJobs(env, [job.id], 15);
  } catch (error) {
    const e =
        error instanceof GraphError
          ? error
          : new GraphError("processing_error", true),
      dead = !e.transient || job.attempts >= 8;
    await env.DB.batch([
      statement(
        env,
        `UPDATE sync_jobs SET status=?,next_run_at=?,lease_until=NULL,lease_token=NULL,last_error=?,error_code=?,updated_at=? WHERE id=? AND lease_token=? AND status='running'`,
        dead ? "dead" : "pending",
        after(retryDelay(job.attempts, e.retryAfter)),
        e.message,
        e.code,
        now(),
        job.id,
        lease,
      ),
      ...(dead
        ? [
            statement(
              env,
              "UPDATE facebook_pages SET last_error=?,updated_at=? WHERE workspace_id=? AND id=?",
              e.message,
              now(),
              job.workspace_id,
              job.page_id,
            ),
          ]
        : []),
      ...(["190", "10", "200", "invalid_token", "expired_token"].includes(
        e.code,
      )
        ? [
            statement(
              env,
              "UPDATE facebook_pages SET authorized=0,last_error=? WHERE workspace_id=? AND id=?",
              "Page authorization requires reconnection.",
              job.workspace_id,
              job.page_id,
            ),
            statement(
              env,
              "UPDATE meta_connections SET status='needs_reauth',last_error=?,updated_at=? WHERE workspace_id=? AND meta_user_id IN (SELECT meta_user_id FROM meta_account_pages WHERE workspace_id=? AND page_id=?)",
              "Page authorization requires reconnection.",
              now(),
              job.workspace_id,
              job.workspace_id,
              job.page_id,
            ),
          ]
        : []),
    ]);
    if (!dead)
      await signalJobs(
        env,
        [job.id],
        retryDelay(job.attempts, e.retryAfter) + 5,
      );
  }
}
export async function runDue(env: Env) {
  const queueLimit = env.INGEST_QUEUE ? 10 : 1;
  const jobs = await rows<{ id: string }>(
    env,
    "SELECT id FROM sync_jobs WHERE (status='pending' AND next_run_at<=?) OR (status='running' AND lease_until<?) ORDER BY next_run_at LIMIT ?",
    now(),
    now(),
    queueLimit,
  );
  if (env.INGEST_QUEUE)
    await signalJobs(
      env,
      jobs.map((j) => j.id),
    );
  else for (const job of jobs) await processJob(env, job.id);
}
export async function maintenance(env: Env) {
  const t = now();
  await env.DB.batch([
    statement(
      env,
      "DELETE FROM sessions WHERE expires_at<? OR idle_expires_at<?",
      t,
      t,
    ),
    statement(env, "DELETE FROM auth_limits WHERE reset_at<?", t),
    statement(env, "DELETE FROM oauth_states WHERE expires_at<?", t),
    statement(
      env,
      "DELETE FROM webhook_events WHERE received_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')",
    ),
    statement(
      env,
      "DELETE FROM sync_jobs WHERE status IN('complete','cancelled') AND updated_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')",
    ),
    statement(
      env,
      "DELETE FROM webhook_inbox WHERE status='complete' AND updated_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')",
    ),
  ]);
  // Index-bounded, limited retention work: deletion cascades answers, notes, tasks.
  const expired = await rows<{
    id: string;
    workspace_id: string;
    page_id: string;
    lead_id: string;
  }>(
    env,
    `SELECT l.id,l.workspace_id,l.page_id,l.lead_id FROM leads l JOIN workspaces w ON w.id=l.workspace_id WHERE l.submitted_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-'||w.retention_days||' days') LIMIT 2`,
  );
  for (const l of expired)
    await env.DB.batch([
      statement(
        env,
        "INSERT OR IGNORE INTO lead_tombstones(workspace_id,page_id,lead_id,deleted_at) VALUES(?,?,?,?)",
        l.workspace_id,
        l.page_id,
        l.lead_id,
        t,
      ),
      statement(
        env,
        "DELETE FROM leads WHERE workspace_id=? AND id=?",
        l.workspace_id,
        l.id,
      ),
    ]);
  const forms = await rows<{
    workspace_id: string;
    page_id: string;
    id: string;
    reconciled_at: string | null;
  }>(
    env,
    `SELECT f.workspace_id,f.page_id,f.id,f.reconciled_at FROM instant_forms f JOIN facebook_pages p ON p.workspace_id=f.workspace_id AND p.id=f.page_id WHERE f.selected=1 AND p.authorized=1 AND (f.reconciled_at IS NULL OR f.reconciled_at<?) ORDER BY f.reconciled_at LIMIT 2`,
    new Date(Date.now() - 6 * 3600000).toISOString(),
  );
  for (const f of forms) {
    const key = `history:${f.id}`,
      existing = await one<{ id: string; status: string }>(
        env,
        "SELECT id,status FROM sync_jobs WHERE workspace_id=? AND dedupe_key=?",
        f.workspace_id,
        key,
      );
    const since = f.reconciled_at
      ? new Date(Date.parse(f.reconciled_at) - 48 * 3600000).toISOString()
      : null;
    if (!existing) {
      const j = enqueueStatement(
        env,
        f.workspace_id,
        f.page_id,
        f.id,
        null,
        "history",
        key,
      );
      await env.DB.batch([
        j.statement,
        statement(
          env,
          "UPDATE sync_jobs SET since_at=? WHERE workspace_id=? AND id=?",
          since,
          f.workspace_id,
          j.id,
        ),
      ]);
    } else if (
      existing.status === "complete" ||
      existing.status === "cancelled"
    )
      await statement(
        env,
        "UPDATE sync_jobs SET status='pending',cursor=NULL,since_at=?,attempts=0,next_run_at=?,updated_at=? WHERE workspace_id=? AND dedupe_key=? AND status IN('complete','cancelled')",
        since,
        t,
        t,
        f.workspace_id,
        key,
      ).run();
  }
  await runDue(env);
}
