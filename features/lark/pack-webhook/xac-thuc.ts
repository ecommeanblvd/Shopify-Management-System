/** THUẦN: xác thực + đọc body cho webhook /api/lark/pack (Lark Automation → SMS). */
import { timingSafeEqual } from 'node:crypto';

export const GIOI_HAN_BODY = 4096;

export type KetQuaSecret = { ok: true } | { ok: false; status: 401 | 503; error: string };

export function kiemTraSecret(header: string | null, env: string | undefined): KetQuaSecret {
  if (!env) return { ok: false, status: 503, error: 'chưa cấu hình LARK_PACK_WEBHOOK_SECRET' };
  const a = Buffer.from(header ?? '', 'utf8'), b = Buffer.from(env, 'utf8');
  // timingSafeEqual ném lỗi khi khác độ dài → so độ dài trước, vẫn trả 401.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, status: 401, error: 'sai secret' };
  return { ok: true };
}

/** Dòng Lark cần xử lý, nhận diện bằng một trong ba cách Lark có thể gửi được. */
export type CachNhanDien =
  | { kieu: 'record'; giaTri: string }
  | { kieu: 'log_code'; giaTri: string }
  | { kieu: 'don'; giaTri: string };

export type KetQuaBody = { ok: true; nhanDien: CachNhanDien } | { ok: false; status: 400 | 413; error: string };

/**
 * THUẦN: giá trị có phải placeholder Lark CHƯA thay biến không ("{{record_id}}").
 *
 * Gặp thật 22/09/2026: rule gửi đúng chuỗi "{{record_id}}" vì ô body gõ tay chứ không chèn
 * biến từ menu. Nhận ra để báo lỗi rõ ràng, thay vì lặng lẽ "không tìm thấy record".
 */
export function laBienChuaThay(v: string): boolean {
  return v.includes('{{') || v.includes('}}');
}

/**
 * Đọc body: ưu tiên record_id, nhưng chấp nhận cả log_unique_code và order_number — Lark
 * Automation không phải lúc nào cũng chèn được record_id, còn mã đơn thì chắc chắn có.
 */
export function docBodyPack(raw: string): KetQuaBody {
  if (Buffer.byteLength(raw, 'utf8') > GIOI_HAN_BODY) return { ok: false, status: 413, error: 'body quá 4KB' };
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { ok: false, status: 400, error: 'body không phải JSON' }; }
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  const doc = (k: string): string => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  const recordId = doc('record_id'), logCode = doc('log_unique_code'), don = doc('order_number');

  const coBien = [recordId, logCode, don].some((v) => v && laBienChuaThay(v));
  const dung = [recordId, logCode, don].filter((v) => v && !laBienChuaThay(v));
  if (dung.length === 0) {
    return coBien
      ? { ok: false, status: 400, error: 'rule Lark gửi nguyên chữ {{...}} — phải chèn biến từ menu, không gõ tay' }
      : { ok: false, status: 400, error: 'cần record_id, log_unique_code hoặc order_number' };
  }
  if (recordId && !laBienChuaThay(recordId)) return { ok: true, nhanDien: { kieu: 'record', giaTri: recordId } };
  if (logCode && !laBienChuaThay(logCode)) return { ok: true, nhanDien: { kieu: 'log_code', giaTri: logCode } };
  return { ok: true, nhanDien: { kieu: 'don', giaTri: don } };
}
