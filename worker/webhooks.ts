import { Hono } from "hono";
import type { Bindings } from "./types";
import { ApiError, id, now } from "./types";
import { equal, sha, verifySignature } from "./crypto";
import { statement } from "./db";
import { notifyInbox, type LeadEvent } from "./inbox";
export const webhooks = new Hono<Bindings>();
webhooks.get("/", async (c) => {
  if (!c.env.META_WEBHOOK_VERIFY_TOKEN)
    throw new ApiError(
      503,
      "webhook_not_configured",
      "Webhook is not configured.",
    );
  const token = c.req.query("hub.verify_token") || "",
    challenge = c.req.query("hub.challenge");
  if (
    c.req.query("hub.mode") !== "subscribe" ||
    !equal(await sha(token), await sha(c.env.META_WEBHOOK_VERIFY_TOKEN)) ||
    !challenge ||
    challenge.length > 200
  )
    throw new ApiError(
      403,
      "verification_failed",
      "Webhook verification failed.",
    );
  return c.text(challenge);
});
webhooks.post("/", async (c) => {
  if (!c.env.META_APP_SECRET)
    throw new ApiError(
      503,
      "webhook_not_configured",
      "Webhook is not configured.",
    );
  const raw = await c.req.arrayBuffer();
  if (
    !(await verifySignature(
      c.env.META_APP_SECRET,
      raw,
      c.req.header("X-Hub-Signature-256") || null,
    ))
  )
    throw new ApiError(403, "invalid_signature", "Invalid webhook signature.");
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new ApiError(400, "invalid_json", "Invalid webhook JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new ApiError(400, "invalid_payload", "Invalid webhook object.");
  const payload = data as {
    object?: string;
    entry?: {
      id?: unknown;
      changes?: { field?: unknown; value?: Record<string, unknown> }[];
    }[];
  };
  if (payload.object !== "page" || !Array.isArray(payload.entry))
    return c.json({ ok: true, data: { accepted: true } });
  const events: LeadEvent[] = [];
  for (const entry of payload.entry) {
    if (!entry || typeof entry.id !== "string" || !Array.isArray(entry.changes))
      continue;
    for (const change of entry.changes) {
      if (!change || change.field !== "leadgen" || !change.value) continue;
      const v = change.value;
      if (
        v.page_id !== entry.id ||
        ![v.page_id, v.form_id, v.leadgen_id].every(
          (s) => typeof s === "string" && /^\d{1,64}$/.test(s),
        )
      )
        continue;
      events.push({
        page_id: v.page_id as string,
        form_id: v.form_id as string,
        leadgen_id: v.leadgen_id as string,
        ...(typeof v.ad_id === "string" ? { ad_id: v.ad_id } : {}),
        ...(typeof v.created_time === "number"
          ? { created_time: v.created_time }
          : {}),
      });
    }
  }
  if (events.length) {
    const hash = await sha(raw),
      t = now();
    await statement(
      c.env,
      "INSERT OR IGNORE INTO webhook_inbox(id,events_json,received_at,updated_at) VALUES(?,?,?,?)",
      hash,
      JSON.stringify(events),
      t,
      t,
    ).run();
    c.executionCtx.waitUntil(notifyInbox(c.env, hash));
  }
  return c.json({ ok: true, data: { accepted: true } });
});
