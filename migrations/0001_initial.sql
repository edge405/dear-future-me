PRAGMA foreign_keys = ON;

CREATE TABLE journal_drafts (
  id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  entry_date TEXT NOT NULL CHECK(length(entry_date) = 10),
  status TEXT NOT NULL CHECK(status IN ('collecting','preparing','preview_ready','publishing','published','cancelled','failed')),
  revision INTEGER NOT NULL DEFAULT 0,
  preview_revision INTEGER,
  preview_seen_revision INTEGER,
  title TEXT,
  ai_preview TEXT,
  ai_reflection TEXT,
  ai_question TEXT,
  preview_kind TEXT CHECK(preview_kind IN ('original','ai')),
  approved_kind TEXT CHECK(approved_kind IN ('original','ai')),
  ai_consent INTEGER NOT NULL DEFAULT 0 CHECK(ai_consent IN (0,1)),
  ai_attempts INTEGER NOT NULL DEFAULT 0,
  last_content_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX one_daily_draft ON journal_drafts(telegram_user_id, entry_date) WHERE status != 'cancelled';
CREATE INDEX drafts_owner_status ON journal_drafts(telegram_user_id, status, entry_date DESC);

CREATE TABLE journal_draft_messages (
  id INTEGER PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES journal_drafts(id),
  telegram_chat_id TEXT NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  telegram_update_id INTEGER NOT NULL UNIQUE,
  media_group_id TEXT,
  message_type TEXT NOT NULL,
  original_text TEXT,
  original_caption TEXT,
  telegram_created_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  UNIQUE(telegram_chat_id, telegram_message_id)
);
CREATE INDEX messages_draft_order ON journal_draft_messages(draft_id, telegram_message_id);

CREATE TABLE journal_archives (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL UNIQUE REFERENCES journal_drafts(id),
  journal_date TEXT NOT NULL,
  title TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  first_channel_message_id INTEGER,
  original_message_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('publishing','published')),
  created_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX archives_history ON journal_archives(status, journal_date DESC);

CREATE TABLE archive_items (
  id INTEGER PRIMARY KEY,
  archive_id TEXT NOT NULL REFERENCES journal_archives(id),
  sequence INTEGER NOT NULL,
  item_type TEXT NOT NULL CHECK(item_type IN ('heading','story','reflection','copy')),
  source_message_ids TEXT NOT NULL DEFAULT '[]',
  destination_message_ids TEXT NOT NULL DEFAULT '[]',
  payload TEXT,
  copy_status TEXT NOT NULL DEFAULT 'pending' CHECK(copy_status IN ('pending','inflight','done','failed','uncertain')),
  error_code TEXT,
  retry_at INTEGER NOT NULL DEFAULT 0,
  copied_at INTEGER,
  UNIQUE(archive_id, sequence)
);
CREATE INDEX archive_pending ON archive_items(archive_id, sequence, copy_status);

CREATE TABLE processed_updates (
  update_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('processing','done')),
  token TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  processed_at INTEGER NOT NULL
);
CREATE INDEX updates_cleanup ON processed_updates(processed_at);

CREATE TABLE owner_locks (
  owner_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  lease_until INTEGER NOT NULL
);

CREATE TABLE app_settings (
  owner_id TEXT PRIMARY KEY,
  selected_draft_id TEXT REFERENCES journal_drafts(id),
  ai_consent INTEGER NOT NULL DEFAULT 0 CHECK(ai_consent IN (0,1)),
  consent_nonce TEXT,
  consent_expires_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ai_usage (
  owner_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner_id, usage_date)
);

CREATE TABLE reminder_deliveries (
  owner_id TEXT NOT NULL,
  reminder_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('sending','delivered','failed','uncertain')),
  attempted_at INTEGER NOT NULL,
  delivered_at INTEGER,
  destination_message_id INTEGER,
  error_code TEXT,
  PRIMARY KEY(owner_id, reminder_date)
);

CREATE TRIGGER enforce_draft_state BEFORE UPDATE OF status ON journal_drafts
WHEN NEW.status != OLD.status AND NOT (
  (OLD.status = 'collecting' AND NEW.status IN ('preparing','cancelled')) OR
  (OLD.status = 'preparing' AND NEW.status IN ('collecting','preview_ready','failed','cancelled')) OR
  (OLD.status = 'preview_ready' AND NEW.status IN ('collecting','preparing','publishing','cancelled')) OR
  (OLD.status = 'failed' AND NEW.status IN ('collecting','preparing','cancelled')) OR
  (OLD.status = 'publishing' AND NEW.status = 'published')
)
BEGIN SELECT RAISE(ABORT, 'invalid_draft_transition'); END;
