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

/**
 * THUẦN: mô tả một lượt gọi BỊ TỪ CHỐI, để ghi vào nhật ký. Không I/O.
 *
 * Vì sao cần (08/10/2026): route kiểm secret rồi trả lỗi TRƯỚC khi mở nhật ký, nên một cú gọi
 * sai secret không để lại dấu nào. Hệ quả thật: Lark Automation chạy đều và báo Success suốt
 * 16 ngày (ảnh Activity Log 08/10: 10 lượt trong một buổi, lượt nào cũng xanh), trong khi SMS
 * có ĐÚNG 0 dòng nhật ký — và không ai kết luận được vì sao, vì "không có dữ liệu" trông y hệt
 * "không ai gọi". Em đã kết luận sai một lần từ chính chỗ mù này.
 *
 * KHÔNG BAO GIỜ ghi giá trị secret. Chỉ ghi ĐỘ DÀI header: lệch độ dài là nguyên nhân phổ biến
 * nhất (thừa khoảng trắng, thiếu ký tự khi dán) và biết độ dài là đủ để chẩn đoán, trong khi
 * giá trị thì rò ra nhật ký mà nhật ký thì nhiều người đọc được.
 */
export interface MoTaTuChoi {
  tuChoi: 'secret' | 'body' | 'qua-lon';
  /** Có gửi header secret không. */
  coHeader: boolean;
  /** ĐỘ DÀI header, không phải giá trị. 0 = không gửi. */
  doDaiHeader: number;
  /** Độ dài secret đang cấu hình — để so với `doDaiHeader` mà không lộ giá trị nào. */
  doDaiCanCo: number;
  contentLength: number;
  /** Ai gọi — đủ để biết có phải Lark không. Cắt ngắn, không giữ nguyên chuỗi dài. */
  userAgent: string;
  loi: string;
}

export function moTaTuChoi(d: {
  tuChoi: MoTaTuChoi['tuChoi'];
  header: string | null;
  secret: string | undefined;
  contentLength: string | null;
  userAgent: string | null;
  loi: string;
}): MoTaTuChoi {
  return {
    tuChoi: d.tuChoi,
    coHeader: d.header != null && d.header !== '',
    doDaiHeader: (d.header ?? '').length,
    doDaiCanCo: (d.secret ?? '').length,
    contentLength: Number(d.contentLength ?? 0) || 0,
    userAgent: (d.userAgent ?? '').slice(0, 80),
    loi: d.loi,
  };
}

/**
 * THUẦN: có nên ghi lượt từ chối này vào nhật ký không.
 *
 * Endpoint không đòi đăng nhập, chỉ chắn bằng secret — ai biết đường dẫn cũng gọi được. Ghi mọi
 * lượt từ chối là mở đường cho một vòng lặp bên ngoài làm phình bảng `job_runs`. Chặn trần: quá
 * `TRAN_TU_CHOI` dòng trong cửa sổ gần đây thì thôi ghi, vì lúc đó nhật ký đã đủ để chẩn đoán
 * rồi — thêm dòng thứ 21 không nói thêm điều gì.
 */
export const TRAN_TU_CHOI = 20;
export const CUA_SO_TU_CHOI_PHUT = 10;

export function nenGhiTuChoi(soDongGanDay: number): boolean {
  return soDongGanDay < TRAN_TU_CHOI;
}
