/**
 * Phát hiện đơn Shopify bị chỉnh sửa NỘI DUNG (địa chỉ giao + line items) —
 * THUẦN, không I/O. Hash các field quan trọng cho fulfill; so hash cũ/mới ở
 * `upsertOrder` để bật cờ `edited` (và cảnh báo nếu sửa sau khi đã lên vận đơn).
 */
import { createHash } from 'node:crypto';

export interface FingerprintInput {
  shipName: string | null;
  shipAddress1: string | null;
  shipAddress2: string | null;
  shipCity: string | null;
  shipPostcode: string | null;
  shipCountry: string | null;
  lines: Array<{ sku: string | null; quantity: number }>;
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Hash sha256 (hex) của địa chỉ giao + line items. Line SẮP XẾP theo sku nên
 * đổi thứ tự không đổi hash; đổi qty/sku/địa chỉ thì đổi hash.
 */
export function orderContentFingerprint(i: FingerprintInput): string {
  const addr = [i.shipName, i.shipAddress1, i.shipAddress2, i.shipCity, i.shipPostcode, i.shipCountry]
    .map(norm).join('|');
  const lines = [...i.lines]
    .map((l) => `${norm(l.sku)}:${l.quantity}`)
    .sort()
    .join(',');
  return createHash('sha256').update(`${addr}#${lines}`).digest('hex');
}

export interface EditFlags {
  editedAt: Date | null;
  editedAfterFulfilledAt: Date | null;
}

/**
 * So fingerprint cũ/mới → cờ sửa. Cờ chỉ TIẾN (không xoá cờ cũ). Chưa có baseline
 * (`prevFingerprint == null`, đơn mới hoặc trước khi tính năng bật) → không set.
 */
export function detectEdit(args: {
  prevFingerprint: string | null;
  nextFingerprint: string;
  isFulfilled: boolean;
  now: Date;
  prevEditedAt: Date | null;
  prevEditedAfterFulfilledAt: Date | null;
}): EditFlags {
  const { prevFingerprint, nextFingerprint, isFulfilled, now, prevEditedAt, prevEditedAfterFulfilledAt } = args;
  if (prevFingerprint === null || prevFingerprint === nextFingerprint) {
    return { editedAt: prevEditedAt, editedAfterFulfilledAt: prevEditedAfterFulfilledAt };
  }
  return {
    editedAt: now,
    editedAfterFulfilledAt: isFulfilled ? now : prevEditedAfterFulfilledAt,
  };
}
