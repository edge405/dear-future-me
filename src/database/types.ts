export type DraftStatus = 'collecting' | 'preparing' | 'preview_ready' | 'publishing' | 'published' | 'cancelled' | 'failed';
export interface Draft {
  id: string; telegram_user_id: string; entry_date: string; status: DraftStatus;
  revision: number; preview_revision: number | null; preview_seen_revision: number | null; title: string | null;
  ai_preview: string | null; ai_reflection: string | null; ai_question: string | null;
  preview_kind: 'original' | 'ai' | null; approved_kind: 'original' | 'ai' | null;
  ai_consent: number; ai_attempts: number; last_content_at: number; created_at: number; updated_at: number;
}
export interface DraftMessage {
  id: number; draft_id: string; telegram_chat_id: string; telegram_message_id: number;
  telegram_update_id: number; media_group_id: string | null; message_type: string;
  original_text: string | null; original_caption: string | null; validation_error: string | null; telegram_created_at: number; received_at: number;
}
export interface Settings {
  owner_id: string; selected_draft_id: string | null; ai_consent: number;
  consent_nonce: string | null; consent_expires_at: number | null;
}
export interface Archive {
  id: string; draft_id: string; journal_date: string; title: string; channel_id: string;
  first_channel_message_id: number | null; status: 'publishing' | 'published'; original_message_count: number;
}
export interface ArchiveItem {
  id: number; archive_id: string; sequence: number; item_type: 'heading' | 'story' | 'reflection' | 'copy';
  source_message_ids: string; destination_message_ids: string; payload: string | null;
  copy_status: 'pending' | 'inflight' | 'done' | 'failed' | 'uncertain'; retry_at: number; error_code: string | null;
}
