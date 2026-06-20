import { createHash } from 'crypto';

export type MmpPushStatus = 'pending' | 'sent' | 'failed';
export interface MmpPushState { status: MmpPushStatus; attempts: number; payloadHash: string | null }

/** sha256 hex của rawBody — phát hiện nội dung đơn đổi. THUẦN. */
export function hashOrderPayload(rawBody: string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

/** Có nên POST: chưa có state, HOẶC chưa sent, HOẶC sent nhưng nội dung đổi (hash khác). */
export function shouldPushOrder(state: MmpPushState | null, currentHash: string): boolean {
  if (!state) return true;
  if (state.status !== 'sent') return true;
  return state.payloadHash !== currentHash;
}
