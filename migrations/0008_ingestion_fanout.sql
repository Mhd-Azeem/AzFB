ALTER TABLE sync_jobs ADD COLUMN parent_job_id TEXT;
CREATE INDEX jobs_parent ON sync_jobs(workspace_id,parent_job_id);
-- Reclaim interrupted history invocations after switching to single-lead queue tasks.
UPDATE sync_jobs SET status='pending',cursor=NULL,lease_token=NULL,lease_until=NULL,next_run_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE kind='history' AND status='running';
