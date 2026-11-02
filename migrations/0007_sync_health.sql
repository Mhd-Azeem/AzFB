CREATE TABLE sync_health (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
 last_scheduler_at TEXT, last_scheduler_completed_at TEXT, last_scheduler_error TEXT,
 app_checked_at TEXT, app_subscription_ok INTEGER, app_error TEXT
);
ALTER TABLE facebook_pages ADD COLUMN subscription_checked_at TEXT;
ALTER TABLE facebook_pages ADD COLUMN subscription_error TEXT;
-- Retry form imports stopped by the previous over-strict answer parser once after upgrade.
-- Keep existing records, checkpoints and tokens intact; do not revive permission failures.
UPDATE sync_jobs SET status='pending',cursor=NULL,attempts=0,next_run_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),last_error=NULL,error_code=NULL WHERE kind='history' AND status='dead' AND error_code='invalid_field_data';

CREATE INDEX jobs_workspace_status_due ON sync_jobs(workspace_id,status,next_run_at);
