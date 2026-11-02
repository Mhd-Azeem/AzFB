ALTER TABLE sessions ADD COLUMN family_id TEXT NOT NULL DEFAULT '';
UPDATE sessions SET family_id=id_hash WHERE family_id='';
CREATE INDEX sessions_family ON sessions(workspace_id,family_id);
CREATE TABLE oauth_states_v2 (state_hash TEXT PRIMARY KEY, session_family TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
INSERT INTO oauth_states_v2(state_hash,session_family,workspace_id,expires_at) SELECT o.state_hash,s.family_id,o.workspace_id,o.expires_at FROM oauth_states o JOIN sessions s ON s.id_hash=o.session_hash;
DROP TABLE oauth_states;
ALTER TABLE oauth_states_v2 RENAME TO oauth_states;
