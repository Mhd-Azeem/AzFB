import type { Env, Principal } from "./types";
import { id, now, ApiError } from "./types";
export function statement(env: Env, sql: string, ...args: unknown[]) {
  return env.DB.prepare(sql).bind(...args);
}
export async function rows<T = Record<string, unknown>>(
  env: Env,
  sql: string,
  ...args: unknown[]
): Promise<T[]> {
  return (await statement(env, sql, ...args).all<T>()).results;
}
export async function one<T = Record<string, unknown>>(
  env: Env,
  sql: string,
  ...args: unknown[]
): Promise<T | null> {
  return statement(env, sql, ...args).first<T>();
}
export function audit(
  env: Env,
  a: Pick<Principal, "workspaceId" | "userId">,
  action: string,
  target?: string,
) {
  return statement(
    env,
    "INSERT INTO audit_logs(id,workspace_id,actor_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)",
    id(),
    a.workspaceId,
    a.userId,
    action,
    target ?? null,
    now(),
  );
}
export async function member(env: Env, workspace: string, user: string | null) {
  if (
    user &&
    !(await one(
      env,
      "SELECT 1 FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND m.user_id=? AND u.disabled=0",
      workspace,
      user,
    ))
  )
    throw new ApiError(
      400,
      "invalid_assignee",
      "Choose an active member of this workspace.",
    );
}
export async function ownedLead(env: Env, workspace: string, lead: string) {
  const record = await one(
    env,
    "SELECT * FROM leads WHERE workspace_id=? AND id=?",
    workspace,
    lead,
  );
  if (!record) throw new ApiError(404, "not_found", "Lead not found.");
  return record;
}
