import type { Context } from "hono";
import type { Role } from "../shared/contracts";
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  INGEST_QUEUE?: Queue<{ jobId?: string; inboxId?:string }>;
  ENVIRONMENT: "local" | "production";
  APP_ORIGIN: string;
  ALLOWED_ORIGINS: string;
  SESSION_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  BOOTSTRAP_SECRET?: string;
  META_APP_ID?: string;
  META_LOGIN_CONFIG_ID?:string;
  META_APP_SECRET?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  META_GRAPH_VERSION?: string;
}
export interface Principal {
  userId: string;
  workspaceId: string;
  role: Role;
  email: string;
  name: string;
  workspaceName: string;
  sessionHash: string;
  csrf: string;
  createdAt: string;
  expiresAt: string;
}
export type Bindings = {
  Bindings: Env;
  Variables: { auth: Principal; requestId: string };
};
export type Ctx = Context<Bindings>;
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export const after = (seconds: number) =>
  new Date(Date.now() + seconds * 1000).toISOString();
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
