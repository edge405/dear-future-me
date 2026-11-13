-- Keep saved entries immutable while allowing another draft on the same day.
DROP INDEX one_daily_draft;
CREATE UNIQUE INDEX one_active_daily_draft ON journal_drafts(telegram_user_id, entry_date)
  WHERE status NOT IN ('published','cancelled');
