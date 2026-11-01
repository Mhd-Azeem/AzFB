import type { Env } from "./types";
import { ApiError } from "./types";
import { hmac } from "./crypto";
export const scopes = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "leads_retrieval",
];
export function metaConfigured(e: Env) {
  try {
    if (
      atob(e.TOKEN_ENCRYPTION_KEY || "").length !== 32 ||
      new URL(e.APP_ORIGIN).origin !== e.APP_ORIGIN
    )
      return false;
  } catch {
    return false;
  }
  return Boolean(
    e.META_APP_ID &&
    e.META_APP_SECRET &&
    /^v\d+\.0$/.test(e.META_GRAPH_VERSION || "") &&
    e.TOKEN_ENCRYPTION_KEY &&
    e.APP_ORIGIN,
  );
}
export function callbackUri(e: Env) {
  return `${e.APP_ORIGIN}/api/meta/callback`;
}
export class GraphError extends Error {
  constructor(
    public code: string,
    public transient: boolean,
    public retryAfter = 60,
  ) {
    super(
      transient
        ? "Meta is temporarily unavailable or rate limited. Retry is scheduled."
        : "Meta access failed. Check Page lead access and reconnect Facebook.",
    );
  }
}
export interface GraphList<T> {
  data: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}
export async function graph<T>(
  env: Env,
  path: string,
  token: string,
  params: Record<string, string> = {},
  method = "GET",
): Promise<T> {
  if (!metaConfigured(env))
    throw new ApiError(
      503,
      "meta_not_configured",
      "Configure the Meta app, Graph version, origin and encryption key on the server.",
    );
  if (!/^[\w/]+$/.test(path) || path.includes(".."))
    throw new Error("Invalid Graph path.");
  const url = new URL(
      `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`,
    ),
    fields = {
      ...params,
      appsecret_proof: await hmac(env.META_APP_SECRET!, token),
    };
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  };
  if (method === "GET")
    Object.entries(fields).forEach(([k, v]) => url.searchParams.set(k, v));
  else {
    init.headers = {
      ...init.headers,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    init.body = new URLSearchParams(fields).toString();
  }
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new GraphError("network", true);
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new GraphError("invalid_response", response.status >= 500);
  }
  const error = (
    result as { error?: { code?: number; is_transient?: boolean } }
  )?.error;
  if (!response.ok || error) {
    const code = error?.code;
    throw new GraphError(
      String(code || response.status),
      Boolean(
        error?.is_transient ||
        response.status === 429 ||
        response.status >= 500 ||
        [1, 2, 4, 17, 32, 341, 613].includes(code || 0),
      ),
      Math.min(
        3600,
        Math.max(60, Number(response.headers.get("Retry-After")) || 60),
      ),
    );
  }
  return result as T;
}
export async function exchange(env: Env, params: Record<string, string>) {
  const url = new URL(
    `https://graph.facebook.com/${env.META_GRAPH_VERSION}/oauth/access_token`,
  );
  Object.entries({
    ...params,
    client_id: env.META_APP_ID!,
    client_secret: env.META_APP_SECRET!,
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new GraphError("oauth_network", true);
  }
  const b = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!response.ok || typeof b.access_token !== "string")
    throw new GraphError("oauth_exchange", false);
  return { access_token: b.access_token, expires_in: b.expires_in };
}
export interface DebugToken {
  data: {
    is_valid: boolean;
    app_id: string;
    user_id?: string;
    expires_at?: number;
    data_access_expires_at?: number;
    scopes?: string[];
    granular_scopes?: { scope: string; target_ids?: string[] }[];
  };
}
export async function debugToken(env: Env, token: string) {
  const d = await graph<DebugToken>(
    env,
    "debug_token",
    `${env.META_APP_ID}|${env.META_APP_SECRET}`,
    { input_token: token },
  );
  if (!d.data.is_valid || d.data.app_id !== env.META_APP_ID)
    throw new GraphError("invalid_token", false);
  const deadlines = [d.data.expires_at, d.data.data_access_expires_at].filter(
    (v): v is number => typeof v === "number" && v > 0,
  );
  if (deadlines.some((v) => v * 1000 <= Date.now()))
    throw new GraphError("expired_token", false);
  return {
    data: d.data,
    expiresAt: deadlines.length
      ? new Date(Math.min(...deadlines) * 1000).toISOString()
      : null,
  };
}
export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  tasks: string[];
}
export interface MetaForm {
  id: string;
  name: string;
  status?: string;
  questions?: { key: string; label?: string; type?: string }[];
}
export interface MetaLead {
  id: string;
  created_time: string;
  form_id?: string;
  ad_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  ad_name?: string;
  is_organic?: boolean;
  platform?: string;
  custom_disclaimer_responses?: unknown[];
  field_data: { name: string; values: string[] }[];
}
export const baseLeadFields = "id,created_time,form_id,ad_id,field_data";
export const leadFields =
  baseLeadFields +
  ",ad_name,campaign_id,campaign_name,is_organic,platform,custom_disclaimer_responses";
export async function fetchLeads<T>(
  env: Env,
  path: string,
  token: string,
  params: Record<string, string>,
) {
  try {
    return await graph<T>(env, path, token, { ...params, fields: leadFields });
  } catch (e) {
    if (e instanceof GraphError && ["100", "10", "200"].includes(e.code))
      return graph<T>(env, path, token, { ...params, fields: baseLeadFields });
    throw e;
  }
}
