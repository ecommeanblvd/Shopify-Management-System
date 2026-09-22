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

export type KetQuaBody = { ok: true; recordId: string; logUniqueCode: string | null } | { ok: false; status: 400 | 413; error: string };

export function docBodyPack(raw: string): KetQuaBody {
  if (Buffer.byteLength(raw, 'utf8') > GIOI_HAN_BODY) return { ok: false, status: 413, error: 'body quá 4KB' };
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { ok: false, status: 400, error: 'body không phải JSON' }; }
  const o = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
  const recordId = typeof o.record_id === 'string' ? o.record_id.trim() : '';
  if (!recordId) return { ok: false, status: 400, error: 'thiếu record_id' };
  const logUniqueCode = typeof o.log_unique_code === 'string' && o.log_unique_code.trim() ? o.log_unique_code.trim() : null;
  return { ok: true, recordId, logUniqueCode };
}
