import type { DraftStatus } from '../database/types.ts';
export const transitions: Record<DraftStatus, DraftStatus[]> = {
  collecting: ['preparing', 'cancelled'], preparing: ['collecting', 'preview_ready', 'failed', 'cancelled'],
  preview_ready: ['collecting', 'preparing', 'publishing', 'cancelled'],
  failed: ['collecting', 'preparing', 'cancelled'], publishing: ['published'], published: [], cancelled: []
};
export const canTransition = (from: DraftStatus, to: DraftStatus): boolean => transitions[from].includes(to);
