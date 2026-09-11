export const SCHEMA_VERSION = 19;

export const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS workspace_meta (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    name            TEXT NOT NULL,
    schema_version  INTEGER NOT NULL DEFAULT 1,
    sync_mode       TEXT NOT NULL DEFAULT 'local',
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS boards (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tabs_config TEXT NOT NULL DEFAULT '["kanban"]',
    archived_at TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ticket_types (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL,
    icon        TEXT,
    is_default  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id          TEXT PRIMARY KEY,
    board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'todo'
                CHECK (status IN ('backlog', 'todo', 'in_progress', 'done')),
    priority    TEXT NOT NULL DEFAULT 'p2'
                CHECK (priority IN ('p1', 'p2', 'p3')),
    ticket_type TEXT NOT NULL DEFAULT 'feature',
    position    REAL NOT NULL DEFAULT 0,
    due_date    TEXT,
    start_date  TEXT,
    labels      TEXT NOT NULL DEFAULT '[]',
    comments    TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    id                INTEGER PRIMARY KEY CHECK (id = 1),
    author_name       TEXT NOT NULL DEFAULT '',
    default_branch    TEXT NOT NULL DEFAULT 'main',
    autosave_seconds  INTEGER NOT NULL DEFAULT 10,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_config (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    remote_url      TEXT NOT NULL DEFAULT '',
    access_token    TEXT NOT NULL DEFAULT '',
    branch          TEXT NOT NULL DEFAULT 'main',
    git_name        TEXT NOT NULL DEFAULT '',
    git_email       TEXT NOT NULL DEFAULT '',
    auto_sync       INTEGER NOT NULL DEFAULT 0,
    auto_sync_interval INTEGER NOT NULL DEFAULT 15,
    last_synced_at  TEXT,
    updated_at      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_board_id ON tickets(board_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_status   ON tickets(status);
  CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
  CREATE INDEX IF NOT EXISTS idx_tickets_ticket_type ON tickets(ticket_type);
  CREATE INDEX IF NOT EXISTS idx_tickets_due_date ON tickets(due_date);
  CREATE INDEX IF NOT EXISTS idx_ticket_types_is_default ON ticket_types(is_default);

  CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    payload     TEXT NOT NULL DEFAULT '{}',
    actor       TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
  CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);

  CREATE TABLE IF NOT EXISTS push_targets (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    endpoint_url        TEXT NOT NULL,
    http_method         TEXT NOT NULL DEFAULT 'POST',
    headers             TEXT NOT NULL DEFAULT '{}',
    body_template       TEXT NOT NULL DEFAULT '',
    body_content_type   TEXT NOT NULL DEFAULT 'application/json',
    field_mapping       TEXT NOT NULL DEFAULT '{}',
    payload_fields      TEXT NOT NULL DEFAULT '[]',
    query_params        TEXT NOT NULL DEFAULT '[]',
    variables           TEXT NOT NULL DEFAULT '[]',
    source_config       TEXT NOT NULL DEFAULT '',
    success_check       TEXT NOT NULL DEFAULT '',
    timeout_ms          INTEGER NOT NULL DEFAULT 30000,
    retry_count         INTEGER NOT NULL DEFAULT 0,
    enabled             INTEGER NOT NULL DEFAULT 1,
    last_push_at        TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS push_records (
    id              TEXT PRIMARY KEY,
    ticket_id       TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    board_id        TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    target_id       TEXT NOT NULL REFERENCES push_targets(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'success', 'failed')),
    request_url     TEXT NOT NULL,
    request_body    TEXT,
    variables_snapshot TEXT,
    response_status INTEGER,
    response_body   TEXT,
    error_message   TEXT,
    duration_ms     INTEGER,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_push_records_ticket  ON push_records(ticket_id);
  CREATE INDEX IF NOT EXISTS idx_push_records_board   ON push_records(board_id);
  CREATE INDEX IF NOT EXISTS idx_push_records_target  ON push_records(target_id);
  CREATE INDEX IF NOT EXISTS idx_push_records_status  ON push_records(status);
`;
