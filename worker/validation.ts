import { ApiError } from "./types";
import type { Ctx } from "./types";
export async function body(c: Ctx): Promise<Record<string, unknown>> {
  if (!c.req.header("Content-Type")?.startsWith("application/json"))
    throw new ApiError(415, "content_type", "Send application/json.");
  const text = await c.req.text();
  if (text.length > 32768)
    throw new ApiError(413, "too_large", "Request is too large.");
  try {
    const v = JSON.parse(text);
    if (!v || Array.isArray(v) || typeof v !== "object") throw Error();
    return v;
  } catch {
    throw new ApiError(400, "invalid_json", "Invalid JSON object.");
  }
}
export function text(v: unknown, name: string, max = 200, required = true) {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    throw new ApiError(400, "validation", `Invalid ${name}.`);
  return v.trim();
}
export function choice<T extends string>(
  v: unknown,
  values: readonly T[],
  name: string,
): T {
  if (typeof v !== "string" || !values.includes(v as T))
    throw new ApiError(400, "validation", `Invalid ${name}.`);
  return v as T;
}
export function email(v: unknown) {
  const s = text(v, "email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    throw new ApiError(400, "validation", "Enter a valid email.");
  return s;
}
export function password(v: unknown) {
  if (typeof v !== "string" || v.length < 12 || v.length > 128)
    throw new ApiError(
      400,
      "validation",
      "Use a password of 12–128 characters.",
    );
  return v;
}
export function externalId(v: unknown) {
  const s = text(v, "Meta identifier", 64);
  if (!/^\d+$/.test(s))
    throw new ApiError(400, "validation", "Invalid Meta identifier.");
  return s;
}
export function iso(v: unknown) {
  const s = text(v, "date", 40);
  const n = Date.parse(s);
  if (!Number.isFinite(n)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(s))
    throw new ApiError(400, "validation", "Invalid date.");
  return new Date(n).toISOString();
}
export function keys(b: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(b).some((k) => !allowed.includes(k)))
    throw new ApiError(400, "validation", "Unexpected field.");
}
