/**
 * THUẦN: luật của bước đóng hàng (spec 26/09).
 */

export interface VatTuDongGoi {
  recordId: string;
  dinhDanh: string;
  /** 'VTĐG1' | 'VTĐG2' — nhóm vật tư bên Lark. */
  loai: string | null;
  warehouse: string | null;
}

export interface DauVaoDongKien {
  lineIds: string[];
  canKg: number | null;
  daiCm: number | null;
  rongCm: number | null;
  caoCm: number | null;
}

/**
 * Kiểm đầu vào trước khi đóng kiện.
 *
 * Cân nặng BẮT BUỘC: kiện không cân thì không so được cước, và đây đúng là lý
 * do bước đóng hàng tồn tại. Kích thước để trống được — hộp đã mang sẵn kích
 * thước trong mã (`MEAN-BOX-42x30x10-…`), kho chỉ gõ khi đóng khác chuẩn.
 */
export function kiemDongKien(d: DauVaoDongKien): { ok: true } | { ok: false; loi: string } {
  if (d.lineIds.length === 0) return { ok: false, loi: 'Chưa chọn chiếc nào cho kiện.' };
  if (d.canKg == null) return { ok: false, loi: 'Chưa cân kiện — cân nặng là bắt buộc.' };
  if (!(d.canKg > 0)) return { ok: false, loi: 'Cân nặng phải lớn hơn 0.' };
  // 200kg: một kiện hàng may mặc nặng hơn thế gần như chắc chắn là gõ nhầm
  // đơn vị (gram thành kg), và con số đó đi thẳng vào báo giá cước.
  if (d.canKg > 200) return { ok: false, loi: 'Cân nặng trên 200kg — kiểm lại đơn vị.' };
  for (const [ten, v] of [['Dài', d.daiCm], ['Rộng', d.rongCm], ['Cao', d.caoCm]] as const) {
    if (v == null) continue;
    if (!(v > 0)) return { ok: false, loi: `${ten} phải lớn hơn 0.` };
    if (v > 300) return { ok: false, loi: `${ten} trên 300cm — kiểm lại đơn vị.` };
  }
  return { ok: true };
}

/**
 * Vật tư đóng gói dùng được cho MỘT kho.
 *
 * Lọc theo kho vì hộp là hàng tồn có vị trí thật: gợi ý hộp đang nằm ở Sài Gòn
 * cho người đóng ở Hà Nội là chỉ vào thứ họ không cầm được.
 */
export function vatTuTheoKho(
  ds: readonly VatTuDongGoi[], khoLark: string | null,
): VatTuDongGoi[] {
  const loc = khoLark ? ds.filter((v) => v.warehouse === khoLark) : ds;
  // Kho đó chưa nhập vật tư nào thì thà đưa cả danh sách còn hơn ô rỗng —
  // người đóng vẫn chọn được, chỉ là phải tự biết mình đang cầm hộp nào.
  return (loc.length > 0 ? [...loc] : [...ds]).sort((a, b) => a.dinhDanh.localeCompare(b.dinhDanh));
}

/** Mã kiện đọc được cho người. Thiếu mã thì rơi về id ngắn, không trả rỗng. */
export function maKien(logUniqueCode: string | null, id: string): string {
  return logUniqueCode?.trim() || `#${id.slice(0, 8)}`;
}
