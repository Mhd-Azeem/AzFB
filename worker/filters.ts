import { ApiError } from "./types";
import { stages } from "../shared/contracts";
export function leadFilter(params: URLSearchParams, workspace: string) {
  const clauses = ["l.workspace_id=?"],
    args: unknown[] = [workspace];
  const q = params.get("q")?.trim();
  if (q) {
    if (q.length > 200)
      throw new ApiError(400, "validation", "Search is too long.");
    clauses.push(
      `(l.name LIKE ? ESCAPE '!' OR l.email LIKE ? ESCAPE '!' OR l.phone LIKE ? ESCAPE '!' OR l.campaign LIKE ? ESCAPE '!' OR f.name LIKE ? ESCAPE '!' OR p.name LIKE ? ESCAPE '!' OR l.lead_id LIKE ? ESCAPE '!')`,
    );
    const term = `%${q.replace(/[!%_]/g, "!$&")}%`;
    if (new TextEncoder().encode(term).length > 50)
      throw new ApiError(
        400,
        "validation",
        "Search is too long for the database. Use a shorter name, email fragment, phone or campaign.",
      );
    args.push(...Array(7).fill(term));
  }
  for (const [key, col] of [
    ["status", "l.status"],
    ["form", "l.form_id"],
    ["pageId", "l.page_id"],
    ["assignedTo", "l.assigned_to"],
    ["source", "l.source"],
  ] as const) {
    const value = params.get(key);
    if (value) {
      if (
        value.length > 128 ||
        (key === "status" && !stages.includes(value as (typeof stages)[number]))
      )
        throw new ApiError(400, "validation", `Invalid ${key}.`);
      clauses.push(`${col}=?`);
      args.push(value);
    }
  }
  for (const [key, operator] of [
    ["from", ">="],
    ["to", "<"],
  ] as const) {
    const v = params.get(key);
    if (v) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        !Number.isFinite(Date.parse(v)) ||
        new Date(v).toISOString().slice(0, 10) !== v
      )
        throw new ApiError(
          400,
          "validation",
          "Use real UTC dates in YYYY-MM-DD format.",
        );
      clauses.push(`l.submitted_at ${operator} ?`);
      args.push(
        key === "to"
          ? new Date(Date.parse(v) + 86400000).toISOString()
          : `${v}T00:00:00.000Z`,
      );
    }
  }
  if (
    params.get("from") &&
    params.get("to") &&
    params.get("from")! > params.get("to")!
  )
    throw new ApiError(
      400,
      "validation",
      "Start date must be before end date.",
    );
  return { where: clauses.join(" AND "), args };
}
export const leadJoins =
  "FROM leads l LEFT JOIN instant_forms f ON f.workspace_id=l.workspace_id AND f.id=l.form_id LEFT JOIN facebook_pages p ON p.workspace_id=l.workspace_id AND p.id=l.page_id";
export const leadColumns =
  "l.id,l.workspace_id,l.lead_id,l.form_id,l.page_id,l.name,l.email,l.phone,l.campaign,l.ad_id,l.submitted_at,l.status,l.assigned_to,l.source,l.created_at,l.updated_at,COALESCE(f.name,l.form_id) AS form_name,COALESCE(p.name,l.page_id) AS page_name";
export function pagination(params: URLSearchParams) {
  const page = Number(params.get("page") || 1),
    pageSize = Number(params.get("pageSize") || 25);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 100000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw new ApiError(400, "validation", "Invalid pagination.");
  const sort = params.get("sort") || "newest";
  const order = (
    {
      newest: "l.submitted_at DESC,l.id DESC",
      oldest: "l.submitted_at ASC,l.id ASC",
      name: "l.name COLLATE NOCASE ASC,l.id ASC",
    } as Record<string, string>
  )[sort];
  if (!order) throw new ApiError(400, "validation", "Invalid sort order.");
  return { page, pageSize, offset: (page - 1) * pageSize, order };
}
export function csvCell(value: unknown) {
  const s = String(value ?? "");
  return `"${(/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;
}
export function makeCsv(records: Record<string, unknown>[], columns: string[]) {
  return (
    "\ufeff" +
    [columns, ...records.map((r) => columns.map((k) => r[k]))]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")
  );
}
