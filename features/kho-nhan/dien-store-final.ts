/**
 * Điền cột `Store final` còn TRỐNG trên bảng Lark của kho (CEO 28/09/2026).
 *
 * CỐ Ý KHÔNG có `'use server'` — việc của cron/script, không phải endpoint.
 *
 * Luật suy giá trị nằm ở `storeFinalLark` (đo từ 9.480 dòng Lark). Luật đã có từ
 * 25/09 nhưng CHƯA CÓ GÌ GỌI NÓ, nên 125 dòng vẫn để trống — cùng loại lỗ hổng
 * với `day-production-time-cx` và `generateStatement` (D-135).
 *
 * Ba chốt chặn, vì đây là bảng đội kho đang vận hành:
 *  - CHỈ ghi ô đang TRỐNG; ô Ops đã điền thì không bao giờ đụng (CEO chốt);
 *  - suy không ra thì BỎ QUA, không đoán;
 *  - ô đã có mà LỆCH luật thì chỉ LIỆT KÊ cho người xem, không tự sửa.
 */
import { listAllWhInventoryRecords, updateWhInventoryRecord } from '@/features/lark/client';
import { storeFinalLark } from './cot-lark';

const COT = 'Store final';
const COT_DON = 'Order Number final';
const COT_SKU = 'Lineitem SKU final';

const chu = (v: unknown): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (x as { text?: string })?.text ?? String(x)).join('');
  if (typeof v === 'object') return (v as { text?: string }).text ?? '';
  return String(v);
};

export interface KetQuaDienStoreFinal {
  tongDong: number;
  daCo: number;
  daGhi: number;
  khongSuyDuoc: number;
  /** Ô đã có giá trị nhưng KHÁC luật — người xem tự quyết, máy không sửa. */
  nghiSai: { recordId: string; maDon: string; dangGhi: string; luatNoi: string }[];
}

export async function dienStoreFinal(
  onTin?: (s: string) => void, opts?: { dry?: boolean },
): Promise<KetQuaDienStoreFinal> {
  const dry = opts?.dry ?? false;
  const ds = await listAllWhInventoryRecords();
  const ket: KetQuaDienStoreFinal = { tongDong: ds.length, daCo: 0, daGhi: 0, khongSuyDuoc: 0, nghiSai: [] };

  for (const r of ds) {
    const f = r.fields as Record<string, unknown>;
    const maDon = chu(f[COT_DON]).trim();
    const sku = chu(f[COT_SKU]).trim();
    const dangCo = chu(f[COT]).trim();
    const nen = storeFinalLark(maDon || null, sku || null);

    if (dangCo) {
      ket.daCo += 1;
      if (nen && nen !== dangCo) ket.nghiSai.push({ recordId: r.record_id, maDon, dangGhi: dangCo, luatNoi: nen });
      continue;
    }
    if (!nen) { ket.khongSuyDuoc += 1; continue; }
    if (!dry) await updateWhInventoryRecord(r.record_id, { [COT]: nen });
    ket.daGhi += 1;
    if (ket.daGhi % 25 === 0) onTin?.(`đã ghi ${ket.daGhi}`);
  }
  return ket;
}
