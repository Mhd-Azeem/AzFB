-- Preserve the original connection and encrypted token context.
CREATE TABLE meta_connections_multi (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 meta_user_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
 token_encrypted TEXT NOT NULL, token_context TEXT NOT NULL DEFAULT 'legacy',
 token_expires_at TEXT, permissions_json TEXT NOT NULL, status TEXT NOT NULL,
 last_error TEXT, connected_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,meta_user_id)
);
INSERT INTO meta_connections_multi(workspace_id,meta_user_id,label,token_encrypted,token_expires_at,permissions_json,status,last_error,connected_by,created_at,updated_at)
 SELECT workspace_id,meta_user_id,'Existing Facebook account',token_encrypted,token_expires_at,permissions_json,status,last_error,connected_by,created_at,updated_at FROM meta_connections;
DROP TABLE meta_connections;
ALTER TABLE meta_connections_multi RENAME TO meta_connections;
CREATE TABLE meta_account_pages (
 workspace_id TEXT NOT NULL, page_id TEXT NOT NULL, meta_user_id TEXT NOT NULL,
 PRIMARY KEY(workspace_id,page_id),
 FOREIGN KEY(workspace_id,page_id) REFERENCES facebook_pages(workspace_id,id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,meta_user_id) REFERENCES meta_connections(workspace_id,meta_user_id) ON DELETE CASCADE
);
INSERT INTO meta_account_pages(workspace_id,page_id,meta_user_id)
 SELECT p.workspace_id,p.id,c.meta_user_id FROM facebook_pages p JOIN meta_connections c ON c.workspace_id=p.workspace_id;
CREATE INDEX meta_account_pages_account ON meta_account_pages(workspace_id,meta_user_id,page_id);
ALTER TABLE oauth_states ADD COLUMN target_user_id TEXT;
