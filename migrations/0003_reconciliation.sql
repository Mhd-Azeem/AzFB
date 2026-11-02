ALTER TABLE sync_jobs ADD COLUMN since_at TEXT;
ALTER TABLE instant_forms ADD COLUMN reconciled_at TEXT;
CREATE INDEX forms_selected_reconciliation ON instant_forms(selected,reconciled_at,workspace_id);
CREATE INDEX sessions_user ON sessions(user_id,workspace_id);
CREATE INDEX tasks_assigned_due ON tasks(workspace_id,assigned_to,completed_at,due_at);
