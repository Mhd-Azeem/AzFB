-- Service-level signed-event inbox, before Page identities are resolved to
-- workspaces. Never exposed through customer APIs. Acknowledgement needs one
-- durable insert; bounded dispatch creates workspace-owned events and jobs.
CREATE TABLE webhook_inbox (id TEXT PRIMARY KEY, events_json TEXT NOT NULL, offset INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', lease_until TEXT, lease_token TEXT, received_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX inbox_pending ON webhook_inbox(status,updated_at);
