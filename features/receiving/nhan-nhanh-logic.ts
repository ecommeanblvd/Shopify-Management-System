/**
 * THUẦN: luật của màn "Nhập kho nhanh" (spec §3, §3.1, §4). Không đụng DB.
 */

export interface DemDong {
  /** qty của order_fulfillment_lines. */
  mongDoi: number;
  /** Số món đã tạo (đã in tem) nối dòng này. */
  daIn: number;
  /** Số món đã quét xác nhận. */
  daXacNhan: number;
}

/**
 * Bấm "In N tem": in theo đơn tối đa = phần còn thiếu (mongDoi − daIn); phần dư
 * đi đường "Nhận ngoài kế hoạch" — KHÔNG tự nâng số lượng đơn (spec §3.1).
 */
export function soTemDuocIn(dem: DemDong, yeuCau: number): { theoDon: number; ngoaiKeHoach: number } {
  const n = Math.max(0, Math.floor(yeuCau));
  const conThieu = Math.max(0, dem.mongDoi - dem.daIn);
  const theoDon = Math.min(n, conThieu);
  return { theoDon, ngoaiKeHoach: n - theoDon };
}

export type LyDoTuChoi = 'khong_ton_tai' | 'da_xac_nhan' | 'khac_phieu' | 'khong_phai_tem_mon';

/** Quét tem món trong phiếu đang mở: chỉ 'khop' mới được ghi; còn lại báo đỏ + rung, KHÔNG ghi. */
export function phanLoaiQuet(
  mon: { receiptId: string; confirmedAt: Date | null } | null,
  receiptId: string,
): LyDoTuChoi | 'khop' {
  if (!mon) return 'khong_ton_tai';
  if (mon.receiptId !== receiptId) return 'khac_phieu';
  if (mon.confirmedAt) return 'da_xac_nhan';
  return 'khop';
}

export function duChiec(dem: DemDong): boolean {
  return dem.mongDoi > 0 && dem.daXacNhan >= dem.mongDoi;
}

function soDon(orderNumber: string | null): string {
  const bare = (orderNumber ?? '').trim().replace(/^#/, '');
  return bare ? `#${bare}` : '#?';
}

/** `#TA2331 · Áo X · XL · 1/2 · TINH` — phần trống bỏ, không để " ·  · ". */
export function chuTemMon(i: {
  orderNumber: string | null; productTitle: string | null; variantTitle: string | null;
  thuTu: number; tong: number; brand: string | null;
}): string {
  return [soDon(i.orderNumber), i.productTitle?.trim(), i.variantTitle?.trim(), `${i.thuTu}/${i.tong}`, i.brand?.trim()]
    .filter((p): p is string => !!p)
    .join(' · ');
}

/** `#TA2331 · dòng 2 · Áo X · XL × 2` — tem brand in lên kiện. */
export function chuTemDong(i: {
  orderNumber: string | null; thuTuDong: number; productTitle: string | null; variantTitle: string | null; qty: number;
}): string {
  const ten = [i.productTitle?.trim(), i.variantTitle?.trim()].filter((p): p is string => !!p).join(' · ');
  return [soDon(i.orderNumber), `dòng ${i.thuTuDong}`, ten ? `${ten} × ${i.qty}` : `× ${i.qty}`].join(' · ');
}
