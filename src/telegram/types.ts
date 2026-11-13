export interface TgMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string; username?: string };
  from?: { id: number; is_bot?: boolean };
  text?: string;
  caption?: string;
  media_group_id?: string;
  photo?: unknown[];
  video?: unknown;
  voice?: unknown;
  audio?: unknown;
  document?: unknown;
  animation?: unknown;
  video_note?: unknown;
  sticker?: unknown;
  has_protected_content?: boolean;
}
export interface TgCallback {
  id: string;
  from: { id: number; is_bot?: boolean };
  message?: TgMessage;
  data?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallback;
  channel_post?: TgMessage;
  my_chat_member?: unknown;
}
export type Keyboard = { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] };
export interface TextEntity { type: 'bold'; offset: number; length: number }
