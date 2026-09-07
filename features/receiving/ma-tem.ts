/**
 * THUẦN: đọc chuỗi trong QR trên tem → loại tem + khoá.
 *
 * Hai tầng mã (spec §2.2): tem MÓN `WH-00009890` (kho in lúc nhận) và tem DÒNG ĐƠN
 * `L:<shopifyLineId>` (brand in lên kiện). Mỗi tem chỉ mang MỘT khoá; Product /
 * Variant / Order tra từ DB. Không nhận chuỗi trần (không tiền tố) — quét nhầm mã
 * vạch SKU của brand phải ra null chứ không đoán.
 */
export type MaTem =
  | { loai: 'mon'; unitCode: string }
  | { loai: 'dong'; shopifyLineId: string };

const MON = /^WH-(\d{8})$/i;
const DONG = /^L:(\d{6,20})$/i;

export function docMaTem(raw: string): MaTem | null {
  const s = raw.replace(/\s+/g, '');
  if (!s) return null;
  const m = MON.exec(s);
  if (m) return { loai: 'mon', unitCode: `WH-${m[1]}` };
  const d = DONG.exec(s);
  if (d) return { loai: 'dong', shopifyLineId: d[1] };
  return null;
}

/** Chuỗi in vào QR tem dòng đơn (brand in lên kiện). */
export function maTemDong(shopifyLineId: string): string {
  return `L:${shopifyLineId}`;
}
