import type { TgMessage } from './types.ts';
import type { DraftMessage } from '../database/types.ts';

export function messageType(m: TgMessage): string | null {
  if (m.has_protected_content) return null;
  for (const type of ['photo','video','voice','audio','document','animation','video_note','sticker'] as const) {
    if (m[type] !== undefined) return type;
  }
  return m.text !== undefined ? 'text' : null;
}

export function copyBatches(messages: DraftMessage[]): number[][] {
  const sorted = [...messages].sort((a, b) => a.telegram_message_id - b.telegram_message_id);
  const batches: number[][] = [];
  let batch: number[] = [];
  for (let i = 0; i < sorted.length;) {
    const first = sorted[i];
    const group = [first];
    i++;
    if (first.media_group_id) {
      while (i < sorted.length && sorted[i].media_group_id === first.media_group_id) group.push(sorted[i++]);
    }
    if (batch.length + group.length > 100) { if (batch.length) batches.push(batch); batch = []; }
    for (const m of group) {
      if (batch.length === 100) { batches.push(batch); batch = []; }
      batch.push(m.telegram_message_id);
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}
