-- Schema initialization for CorelynStudio v2
-- All tables created in a single migration for simplicity.

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

CREATE TABLE IF NOT EXISTS robots (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    rosbridge_url TEXT,
    is_mock INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS program_versions (
    id INTEGER PRIMARY KEY,
    program_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    spec_json TEXT NOT NULL,
    author INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE,
    FOREIGN KEY(author) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS mission_runs (
    id INTEGER PRIMARY KEY,
    program_version_id INTEGER NOT NULL,
    robot_id INTEGER,
    started_by INTEGER,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    result TEXT,
    FOREIGN KEY(program_version_id) REFERENCES program_versions(id) ON DELETE CASCADE,
    FOREIGN KEY(robot_id) REFERENCES robots(id) ON DELETE SET NULL,
    FOREIGN KEY(started_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS node_events (
    id INTEGER PRIMARY KEY,
    mission_run_id INTEGER NOT NULL,
    node_id TEXT NOT NULL,
    status TEXT NOT NULL,
    at TEXT NOT NULL,
    FOREIGN KEY(mission_run_id) REFERENCES mission_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_node_events_mission_run_id ON node_events(mission_run_id);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER,
    action TEXT NOT NULL,
    target TEXT,
    detail_json TEXT,
    at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at);
