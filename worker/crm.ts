import { Hono } from "hono";
import type { Bindings } from "./types";
import { ApiError, id, now } from "./types";
import { audit, member, one, ownedLead, rows, statement } from "./db";
import { body, choice, email, iso, keys, password, text } from "./validation";
import { requireAdmin, requireOwner } from "./auth";
import { stages } from "../shared/contracts";
import {
  leadColumns,
  leadFilter,
  leadJoins,
  makeCsv,
  pagination,
} from "./filters";
import { hashPassword } from "./crypto";
export const crmRoutes = new Hono<Bindings>();
crmRoutes.get("/leads/export", async (c) => {
  const a = c.get("auth"),
    p = new URL(c.req.url).searchParams,
    f = leadFilter(p, a.workspaceId);
  const n = await one<{ total: number }>(
    c.env,
    `SELECT COUNT(*) AS total ${leadJoins} WHERE ${f.where}`,
    ...f.args,
  );
  if ((n?.total || 0) > 5000)
    throw new ApiError(
      400,
      "export_limit",
      "Narrow the filters to at most 5,000 leads.",
    );
  const result = await rows(
    c.env,
    `SELECT ${leadColumns},(SELECT json_group_object(field_key,json(values_json)) FROM lead_answers x WHERE x.workspace_id=l.workspace_id AND x.lead_id=l.id) AS custom_answers ${leadJoins} WHERE ${f.where} ORDER BY l.submitted_at DESC,l.id DESC LIMIT 5000`,
    ...f.args,
  );
  await audit(c.env, a, "leads.export").run();
  c.header("Content-Disposition", 'attachment; filename="az-leads.csv"');
  c.header("Content-Type", "text/csv; charset=utf-8");
  return c.body(
    makeCsv(result, [
      "id",
      "lead_id",
      "page_id",
      "page_name",
      "form_id",
      "form_name",
      "name",
      "email",
      "phone",
      "campaign",
      "ad_id",
      "submitted_at",
      "status",
      "assigned_to",
      "source",
      "custom_answers",
    ]),
  );
});
crmRoutes.get("/leads", async (c) => {
  const a = c.get("auth"),
    p = new URL(c.req.url).searchParams,
    f = leadFilter(p, a.workspaceId),
    pg = pagination(p);
  const [items, total] = await Promise.all([
    rows(
      c.env,
      `SELECT ${leadColumns} ${leadJoins} WHERE ${f.where} ORDER BY ${pg.order} LIMIT ? OFFSET ?`,
      ...f.args,
      pg.pageSize,
      pg.offset,
    ),
    one<{ total: number }>(
      c.env,
      `SELECT COUNT(*) AS total ${leadJoins} WHERE ${f.where}`,
      ...f.args,
    ),
  ]);
  return c.json({
    ok: true,
    data: {
      items,
      total: total?.total || 0,
      page: pg.page,
      pageSize: pg.pageSize,
    },
  });
});
crmRoutes.get("/leads/:id", async (c) => {
  const a = c.get("auth"),
    lid = c.req.param("id"),
    lead = await one(
      c.env,
      `SELECT ${leadColumns} ${leadJoins} WHERE l.workspace_id=? AND l.id=?`,
      a.workspaceId,
      lid,
    );
  if (!lead) throw new ApiError(404, "not_found", "Lead not found.");
  const [answers, notes, activities, tasks, duplicates] = await Promise.all([
    rows(
      c.env,
      "SELECT field_key,question,values_json FROM lead_answers WHERE workspace_id=? AND lead_id=? ORDER BY field_key",
      a.workspaceId,
      lid,
    ),
    rows(
      c.env,
      "SELECT n.id,n.body,n.created_at,u.name AS author_name FROM lead_notes n JOIN users u ON u.id=n.author_id WHERE n.workspace_id=? AND n.lead_id=? ORDER BY n.created_at,n.id",
      a.workspaceId,
      lid,
    ),
    rows(
      c.env,
      "SELECT a.id,a.kind,a.detail,a.created_at,u.name AS actor_name FROM lead_activities a LEFT JOIN users u ON u.id=a.actor_id WHERE a.workspace_id=? AND a.lead_id=? ORDER BY a.created_at DESC LIMIT 100",
      a.workspaceId,
      lid,
    ),
    rows(
      c.env,
      "SELECT t.*,l.name AS lead_name,u.name AS assignee_name FROM tasks t LEFT JOIN leads l ON l.workspace_id=t.workspace_id AND l.id=t.lead_id LEFT JOIN users u ON u.id=t.assigned_to WHERE t.workspace_id=? AND t.lead_id=? ORDER BY t.due_at LIMIT 100",
      a.workspaceId,
      lid,
    ),
    rows(
      c.env,
      "SELECT id,name,submitted_at FROM leads WHERE workspace_id=? AND id<>? AND ((email<>'' AND email=? COLLATE NOCASE) OR (phone<>'' AND phone=?)) ORDER BY submitted_at DESC LIMIT 10",
      a.workspaceId,
      lid,
      lead.email,
      lead.phone,
    ),
  ]);
  return c.json({
    ok: true,
    data: {
      lead,
      answers,
      notes,
      activities,
      tasks,
      possible_duplicates: duplicates,
    },
  });
});
crmRoutes.patch("/leads/:id", async (c) => {
  const a = c.get("auth"),
    lid = c.req.param("id");
  const previous = await ownedLead(c.env, a.workspaceId, lid),
    b = await body(c);
  keys(b, ["status", "assignedTo"]);
  if (!Object.keys(b).length)
    throw new ApiError(400, "validation", "Provide a change.");
  let status = previous.status,
    assigned = previous.assigned_to;
  if ("status" in b) status = choice(b.status, stages, "status");
  if ("assignedTo" in b) {
    requireAdmin(c);
    assigned =
      b.assignedTo === null ? null : text(b.assignedTo, "assignee", 100);
    await member(c.env, a.workspaceId, assigned as string | null);
  }
  const t = now();
  await c.env.DB.batch([
    statement(
      c.env,
      "UPDATE leads SET status=?,assigned_to=?,updated_at=? WHERE workspace_id=? AND id=?",
      status,
      assigned,
      t,
      a.workspaceId,
      lid,
    ),
    statement(
      c.env,
      "INSERT INTO lead_activities(id,workspace_id,lead_id,actor_id,kind,detail,created_at) VALUES(?,?,?,?,?,?,?)",
      id(),
      a.workspaceId,
      lid,
      a.userId,
      "updated",
      JSON.stringify({ status, assignedTo: assigned }),
      t,
    ),
    audit(c.env, a, "lead.updated", lid),
  ]);
  return c.json({ ok: true, data: { id: lid, status, assignedTo: assigned } });
});
crmRoutes.get("/leads/:id/activity", async (c) => {
  const a = c.get("auth"),
    lid = c.req.param("id");
  await ownedLead(c.env, a.workspaceId, lid);
  return c.json({
    ok: true,
    data: await rows(
      c.env,
      "SELECT a.id,a.kind,a.detail,a.created_at,u.name AS actor_name FROM lead_activities a LEFT JOIN users u ON u.id=a.actor_id WHERE a.workspace_id=? AND a.lead_id=? ORDER BY a.created_at DESC LIMIT 100",
      a.workspaceId,
      lid,
    ),
  });
});
crmRoutes.post("/leads/:id/notes", async (c) => {
  const a = c.get("auth"),
    lid = c.req.param("id");
  await ownedLead(c.env, a.workspaceId, lid);
  const b = await body(c);
  keys(b, ["body"]);
  const value = text(b.body, "note", 4000),
    nid = id(),
    t = now();
  await c.env.DB.batch([
    statement(
      c.env,
      "INSERT INTO lead_notes(id,workspace_id,lead_id,author_id,body,created_at) VALUES(?,?,?,?,?,?)",
      nid,
      a.workspaceId,
      lid,
      a.userId,
      value,
      t,
    ),
    statement(
      c.env,
      "INSERT INTO lead_activities(id,workspace_id,lead_id,actor_id,kind,detail,created_at) VALUES(?,?,?,?,?,?,?)",
      id(),
      a.workspaceId,
      lid,
      a.userId,
      "note",
      "Note added",
      t,
    ),
    audit(c.env, a, "lead.note_added", lid),
  ]);
  return c.json(
    {
      ok: true,
      data: { id: nid, body: value, created_at: t, author_name: a.name },
    },
    201,
  );
});
crmRoutes.delete("/leads/:id", async (c) => {
  requireAdmin(c);
  const a = c.get("auth"),
    lid = c.req.param("id"),
    l = await ownedLead(c.env, a.workspaceId, lid);
  await c.env.DB.batch([
    statement(
      c.env,
      "INSERT OR IGNORE INTO lead_tombstones(workspace_id,page_id,lead_id,deleted_at) VALUES(?,?,?,?)",
      a.workspaceId,
      l.page_id,
      l.lead_id,
      now(),
    ),
    statement(
      c.env,
      "DELETE FROM leads WHERE workspace_id=? AND id=?",
      a.workspaceId,
      lid,
    ),
    statement(
      c.env,
      "DELETE FROM webhook_events WHERE workspace_id=? AND page_id=? AND lead_id=?",
      a.workspaceId,
      l.page_id,
      l.lead_id,
    ),
    statement(
      c.env,
      "UPDATE sync_jobs SET status='cancelled',last_error=NULL WHERE workspace_id=? AND page_id=? AND lead_id=?",
      a.workspaceId,
      l.page_id,
      l.lead_id,
    ),
    audit(c.env, a, "lead.deleted", lid),
  ]);
  return c.json({ ok: true, data: { deleted: true } });
});
crmRoutes.get("/forms", async (c) => {
  const a = c.get("auth");
  return c.json({
    ok: true,
    data: await rows(
      c.env,
      `SELECT f.id,f.name,f.page_id,p.name AS page_name,f.status,f.selected,f.questions_json,f.last_sync_at,(SELECT COUNT(*) FROM leads l WHERE l.workspace_id=f.workspace_id AND l.form_id=f.id) AS lead_count FROM instant_forms f JOIN facebook_pages p ON p.workspace_id=f.workspace_id AND p.id=f.page_id WHERE f.workspace_id=? ORDER BY f.name`,
      a.workspaceId,
    ),
  });
});
crmRoutes.patch("/forms/:id", async (c) => {
  requireAdmin(c);
  const a = c.get("auth"),
    b = await body(c);
  keys(b, ["selected"]);
  if (typeof b.selected !== "boolean")
    throw new ApiError(400, "validation", "Invalid selection.");
  const result = await statement(
    c.env,
    "UPDATE instant_forms SET selected=?,updated_at=? WHERE workspace_id=? AND id=?",
    b.selected ? 1 : 0,
    now(),
    a.workspaceId,
    c.req.param("id"),
  ).run();
  if (!result.meta.changes)
    throw new ApiError(404, "not_found", "Form not found.");
  await audit(c.env, a, "form.selection_changed", c.req.param("id")).run();
  return c.json({ ok: true, data: { selected: b.selected } });
});
async function analytics(c: Parameters<typeof requireAdmin>[0]) {
  const a = c.get("auth"),
    p = new URL(c.req.url).searchParams;
  if (!p.get("from"))
    p.set(
      "from",
      new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
    );
  if (!p.get("to")) p.set("to", now().slice(0, 10));
  const f = leadFilter(p, a.workspaceId);
  const [counts, days, forms, campaigns, agents, due] = await Promise.all([
    rows<{ status: string; total: number }>(
      c.env,
      `SELECT l.status,COUNT(*) AS total ${leadJoins} WHERE ${f.where} GROUP BY l.status`,
      ...f.args,
    ),
    rows(
      c.env,
      `SELECT substr(l.submitted_at,1,10) AS day,COUNT(*) AS total ${leadJoins} WHERE ${f.where} GROUP BY day ORDER BY day`,
      ...f.args,
    ),
    rows(
      c.env,
      `SELECT COALESCE(f.name,l.form_id) AS name,COUNT(*) AS total,SUM(l.status='Converted') AS converted ${leadJoins} WHERE ${f.where} GROUP BY l.form_id,f.name`,
      ...f.args,
    ),
    rows(
      c.env,
      `SELECT COALESCE(NULLIF(l.campaign,''),l.source) AS name,COUNT(*) AS total ${leadJoins} WHERE ${f.where} GROUP BY COALESCE(NULLIF(l.campaign,''),l.source)`,
      ...f.args,
    ),
    rows(
      c.env,
      `SELECT COALESCE(u.name,'Unassigned') AS name,COUNT(*) AS total,SUM(l.status='Converted') AS converted ${leadJoins} LEFT JOIN users u ON u.id=l.assigned_to WHERE ${f.where} GROUP BY l.assigned_to,u.name`,
      ...f.args,
    ),
    one<{ total: number }>(
      c.env,
      "SELECT COUNT(*) AS total FROM tasks WHERE workspace_id=? AND completed_at IS NULL AND due_at<=?",
      a.workspaceId,
      now(),
    ),
  ]);
  const map = Object.fromEntries(
      stages.map((s) => [s, counts.find((v) => v.status === s)?.total || 0]),
    ),
    total = counts.reduce((s, v) => s + v.total, 0);
  return {
    total,
    counts: map,
    conversionRate: total ? Math.round((map.Converted / total) * 1000) / 10 : 0,
    days,
    forms,
    campaigns,
    agents,
    followupsDue: due?.total || 0,
    timezone: "UTC",
    from: p.get("from"),
    to: p.get("to"),
  };
}
crmRoutes.get("/dashboard", async (c) =>
  c.json({ ok: true, data: await analytics(c) }),
);
crmRoutes.get("/analytics", async (c) =>
  c.json({ ok: true, data: await analytics(c) }),
);
crmRoutes.get("/tasks", async (c) => {
  const a = c.get("auth"),
    p = new URL(c.req.url).searchParams,
    pg = pagination(p),
    conditions = ["t.workspace_id=?"],
    args: unknown[] = [a.workspaceId];
  if (p.get("state") === "open") conditions.push("t.completed_at IS NULL");
  if (p.get("assignedTo")) {
    conditions.push("t.assigned_to=?");
    args.push(p.get("assignedTo"));
  }
  const where = conditions.join(" AND ");
  const [items, total] = await Promise.all([
    rows(
      c.env,
      `SELECT t.id,t.lead_id,t.title,t.due_at,t.priority,t.completed_at,t.assigned_to,l.name AS lead_name,u.name AS assignee_name FROM tasks t LEFT JOIN leads l ON l.workspace_id=t.workspace_id AND l.id=t.lead_id LEFT JOIN users u ON u.id=t.assigned_to WHERE ${where} ORDER BY t.completed_at IS NOT NULL,t.due_at,t.id LIMIT ? OFFSET ?`,
      ...args,
      pg.pageSize,
      pg.offset,
    ),
    one<{ total: number }>(
      c.env,
      `SELECT COUNT(*) AS total FROM tasks t WHERE ${where}`,
      ...args,
    ),
  ]);
  return c.json({
    ok: true,
    data: {
      items,
      total: total?.total || 0,
      page: pg.page,
      pageSize: pg.pageSize,
    },
  });
});
crmRoutes.post("/tasks", async (c) => {
  const a = c.get("auth"),
    b = await body(c);
  keys(b, ["title", "dueAt", "priority", "leadId", "assignedTo"]);
  const title = text(b.title, "task title", 200),
    due = iso(b.dueAt),
    priority = choice(
      "priority" in b ? b.priority : "Normal",
      ["Low", "Normal", "High"],
      "priority",
    ),
    lid =
      "leadId" in b && b.leadId !== null ? text(b.leadId, "lead", 100) : null,
    assignee =
      "assignedTo" in b && b.assignedTo !== null
        ? text(b.assignedTo, "assignee", 100)
        : a.userId;
  if (a.role === "Agent" && assignee !== a.userId)
    throw new ApiError(
      403,
      "forbidden",
      "Agents may assign tasks only to themselves.",
    );
  if (lid) await ownedLead(c.env, a.workspaceId, lid);
  await member(c.env, a.workspaceId, assignee);
  const tid = id(),
    t = now();
  await c.env.DB.batch([
    statement(
      c.env,
      "INSERT INTO tasks(id,workspace_id,lead_id,title,due_at,priority,assigned_to,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      tid,
      a.workspaceId,
      lid,
      title,
      due,
      priority,
      assignee,
      a.userId,
      t,
      t,
    ),
    ...(lid
      ? [
          statement(
            c.env,
            "INSERT INTO lead_activities(id,workspace_id,lead_id,actor_id,kind,detail,created_at) VALUES(?,?,?,?,?,?,?)",
            id(),
            a.workspaceId,
            lid,
            a.userId,
            "task",
            "Follow-up created",
            t,
          ),
        ]
      : []),
    audit(c.env, a, "task.created", tid),
  ]);
  return c.json({ ok: true, data: { id: tid } }, 201);
});
crmRoutes.patch("/tasks/:id", async (c) => {
  const a = c.get("auth"),
    tid = c.req.param("id"),
    task = await one(
      c.env,
      "SELECT * FROM tasks WHERE workspace_id=? AND id=?",
      a.workspaceId,
      tid,
    );
  if (!task) throw new ApiError(404, "not_found", "Task not found.");
  if (a.role === "Agent" && task.assigned_to !== a.userId)
    throw new ApiError(403, "forbidden", "You may update only your own tasks.");
  const b = await body(c);
  keys(b, ["title", "dueAt", "priority", "completed", "assignedTo"]);
  if (!Object.keys(b).length)
    throw new ApiError(400, "validation", "Provide a change.");
  if ("completed" in b && typeof b.completed !== "boolean")
    throw new ApiError(400, "validation", "Invalid completion state.");
  const assignee =
    "assignedTo" in b
      ? b.assignedTo === null
        ? null
        : text(b.assignedTo, "assignee", 100)
      : task.assigned_to;
  if ("assignedTo" in b) requireAdmin(c);
  await member(c.env, a.workspaceId, assignee as string | null);
  await c.env.DB.batch([
    statement(
      c.env,
      "UPDATE tasks SET title=?,due_at=?,priority=?,assigned_to=?,completed_at=?,updated_at=? WHERE workspace_id=? AND id=?",
      "title" in b ? text(b.title, "task title", 200) : task.title,
      "dueAt" in b ? iso(b.dueAt) : task.due_at,
      "priority" in b
        ? choice(b.priority, ["Low", "Normal", "High"], "priority")
        : task.priority,
      assignee,
      "completed" in b ? (b.completed ? now() : null) : task.completed_at,
      now(),
      a.workspaceId,
      tid,
    ),
    audit(c.env, a, "task.updated", tid),
  ]);
  return c.json({ ok: true, data: { id: tid } });
});
crmRoutes.get("/members", async (c) =>
  c.json({
    ok: true,
    data: await rows(
      c.env,
      "SELECT u.id,u.name,u.email,m.role,u.disabled FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY u.name",
      c.get("auth").workspaceId,
    ),
  }),
);
crmRoutes.post("/members", async (c) => {
  requireOwner(c);
  const a = c.get("auth"),
    b = await body(c);
  keys(b, ["email", "name", "password", "role"]);
  const mail = email(b.email),
    name = text(b.name, "name", 100),
    role = choice(b.role, ["Admin", "Agent"], "role");
  if (await one(c.env, "SELECT 1 FROM users WHERE email=?", mail))
    throw new ApiError(409, "exists", "This email is already registered.");
  const uid = id(),
    t = now(),
    hash = await hashPassword(password(b.password), c.env.SESSION_SECRET);
  await c.env.DB.batch([
    statement(
      c.env,
      "INSERT INTO users(id,email,name,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      uid,
      mail,
      name,
      hash,
      t,
      t,
    ),
    statement(
      c.env,
      "INSERT INTO workspace_members(workspace_id,user_id,role,created_at) VALUES(?,?,?,?)",
      a.workspaceId,
      uid,
      role,
      t,
    ),
    audit(c.env, a, "member.created", uid),
  ]);
  return c.json({ ok: true, data: { id: uid } }, 201);
});
crmRoutes.patch("/members/:id", async (c) => {
  requireOwner(c);
  const a = c.get("auth"),
    uid = c.req.param("id"),
    b = await body(c);
  keys(b, ["role", "disabled"]);
  const m = await one<{ role: string }>(
    c.env,
    "SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?",
    a.workspaceId,
    uid,
  );
  if (!m) throw new ApiError(404, "not_found", "Member not found.");
  if (m.role === "Owner" || uid === a.userId)
    throw new ApiError(
      400,
      "owner_protected",
      "The Owner cannot be disabled or demoted here.",
    );
  if ("disabled" in b && typeof b.disabled !== "boolean")
    throw new ApiError(400, "validation", "Invalid disabled state.");
  await c.env.DB.batch([
    statement(
      c.env,
      "UPDATE workspace_members SET role=? WHERE workspace_id=? AND user_id=?",
      "role" in b ? choice(b.role, ["Admin", "Agent"], "role") : m.role,
      a.workspaceId,
      uid,
    ),
    ...("disabled" in b
      ? [
          statement(
            c.env,
            "UPDATE users SET disabled=?,updated_at=? WHERE id=?",
            b.disabled ? 1 : 0,
            now(),
            uid,
          ),
          statement(
            c.env,
            "DELETE FROM sessions WHERE workspace_id=? AND user_id=?",
            a.workspaceId,
            uid,
          ),
        ]
      : []),
    audit(c.env, a, "member.updated", uid),
  ]);
  return c.json({ ok: true, data: { id: uid } });
});
crmRoutes.get("/workspace", async (c) =>
  c.json({
    ok: true,
    data: await one(
      c.env,
      "SELECT id,name,retention_days FROM workspaces WHERE id=?",
      c.get("auth").workspaceId,
    ),
  }),
);
crmRoutes.patch("/workspace", async (c) => {
  requireOwner(c);
  const a = c.get("auth"),
    b = await body(c);
  keys(b, ["name", "retentionDays"]);
  const w = await one<{ name: string; retention_days: number }>(
    c.env,
    "SELECT name,retention_days FROM workspaces WHERE id=?",
    a.workspaceId,
  );
  const days = "retentionDays" in b ? b.retentionDays : w!.retention_days;
  if (
    typeof days !== "number" ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 3650
  )
    throw new ApiError(400, "validation", "Retention must be 1–3650 days.");
  await c.env.DB.batch([
    statement(
      c.env,
      "UPDATE workspaces SET name=?,retention_days=?,updated_at=? WHERE id=?",
      "name" in b ? text(b.name, "workspace name", 100) : w!.name,
      days,
      now(),
      a.workspaceId,
    ),
    audit(c.env, a, "workspace.updated", a.workspaceId),
  ]);
  return c.json({ ok: true, data: { saved: true } });
});
crmRoutes.get("/notifications", async (c) => {
  const a = c.get("auth"),
    read = await one<{ seen_at: string }>(
      c.env,
      "SELECT seen_at FROM notification_reads WHERE workspace_id=? AND user_id=?",
      a.workspaceId,
      a.userId,
    );
  const [leads, tasks, count] = await Promise.all([
    rows(
      c.env,
      "SELECT id,name,created_at FROM leads WHERE workspace_id=? AND created_at>? ORDER BY created_at DESC LIMIT 20",
      a.workspaceId,
      read?.seen_at || a.createdAt,
    ),
    rows(
      c.env,
      "SELECT id,title,due_at FROM tasks WHERE workspace_id=? AND assigned_to=? AND completed_at IS NULL AND due_at<=? ORDER BY due_at LIMIT 20",
      a.workspaceId,
      a.userId,
      now(),
    ),
    one<{ total: number }>(
      c.env,
      "SELECT COUNT(*) AS total FROM leads WHERE workspace_id=? AND created_at>?",
      a.workspaceId,
      read?.seen_at || a.createdAt,
    ),
  ]);
  return c.json({
    ok: true,
    data: { leads, tasks, newLeadCount: count?.total || 0, checkedAt: now() },
  });
});
crmRoutes.post("/notifications/read", async (c) => {
  const a = c.get("auth");
  await statement(
    c.env,
    "INSERT INTO notification_reads(workspace_id,user_id,seen_at) VALUES(?,?,?) ON CONFLICT(workspace_id,user_id) DO UPDATE SET seen_at=excluded.seen_at",
    a.workspaceId,
    a.userId,
    now(),
  ).run();
  return c.json({ ok: true, data: { read: true } });
});
