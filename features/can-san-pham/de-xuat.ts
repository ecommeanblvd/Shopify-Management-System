/**
 * THUẦN: đề xuất cân mới cho từng SKU từ các đơn âm cước vì CÂN WEB THẤP (CEO 16/09/2026).
 *
 * Vì sao cân: checkout cộng thẳng cân từng biến thể trên Shopify để báo cước
 * (`app/api/shopify/carrier-service`), không tính thùng. Hãng thì tính theo max(cân thực, cân quy
 * đổi thùng). Nên cân biến thể phải là cân KHI ĐÃ ĐÓNG GÓI — một chiếc váy 0,8kg đi thùng
 * 39×28×9 bị tính 2kg thì web phải khai 2kg, nếu không đơn nào cũng âm.
 *
 * Cách chia: cân hãng tính của cả kiện trừ phần của các món KHÔNG cần sửa, phần còn lại chia cho
 * các món cần sửa theo tỉ lệ cân hiện tại của chúng (món nặng gánh nhiều hơn). Nhiều đơn cùng
 * một SKU thì lấy mức CAO NHẤT — mục tiêu là chặn âm cước, và người duyệt xem được từng đơn làm
 * bằng chứng trước khi đẩy.
 */

/** Làm tròn LÊN tới bội số này (gram) — cân web lẻ tới 100g là đủ. */
export const BUOC_LAM_TRON_G = 100;

export interface DongHang { sku: string; soLuong: number; canHienTaiG: number | null }

export interface DonBangChung {
  maDon: string;
  /** Tổng cân hãng tính của mọi kiện trong đơn (kg). */
  billedKg: number;
  dong: DongHang[];
  /** SKU người giải trình ghi là cần sửa; trống = mọi món trong đơn. */
  skuMucTieu?: string[] | null;
  /**
   * Kiện có cân quy đổi gấp đôi cân thực trở lên (và trên 2kg): thùng nhiều khả năng QUÁ TO so
   * với món bên trong. Khi đó đẩy cân web lên chỉ chuyển cái sai của khâu đóng gói sang khách.
   */
  thungQuaTo?: boolean;
  /**
   * Món sai cân và cân đúng do NGƯỜI GIẢI TRÌNH chỉ định (gram). Trang Sửa cân CHỈ dùng số này —
   * CEO 16/09/2026: "không thể tù mù được". Đơn chưa chỉ định thì không sinh đề xuất nào.
   */
  canChiDinh?: ReadonlyArray<{ sku: string; canMoiG: number }> | null;
}

/** Nhận diện thùng quá to từ số đo kiện. */
export function laThungQuaTo(thucKg: number | null, quyDoiKg: number | null): boolean {
  return thucKg != null && quyDoiKg != null && quyDoiKg > 2 && quyDoiKg >= 2 * thucKg;
}

export interface BangChungSku { maDon: string; billedKg: number; deXuatG: number; thungQuaTo: boolean }

export interface DeXuatCan {
  sku: string;
  canHienTaiG: number | null;
  canDeXuatG: number;
  bangChung: BangChungSku[];
  /** Đơn đẩy mức đề xuất lên cao nhất có dấu hiệu thùng quá to — duyệt phải xem lại. */
  nghiThungTo: boolean;
}

const lamTronLen = (g: number) => Math.ceil(g / BUOC_LAM_TRON_G - 1e-9) * BUOC_LAM_TRON_G;

/** Cân đề xuất cho các món mục tiêu trong MỘT đơn; rỗng khi đơn này không cho thấy cần tăng. */
export function deXuatTuMotDon(don: DonBangChung): Map<string, number> {
  const ra = new Map<string, number>();
  const muc = new Set((don.skuMucTieu ?? []).map((s) => s.trim()).filter(Boolean));
  const coTrongDon = don.dong.some((d) => muc.has(d.sku));
  const laMucTieu = (d: DongHang) => (muc.size === 0 || !coTrongDon ? true : muc.has(d.sku));

  const mucTieu = don.dong.filter((d) => laMucTieu(d) && d.soLuong > 0);
  if (mucTieu.length === 0) return ra;
  const ngoaiG = don.dong.filter((d) => !laMucTieu(d)).reduce((s, d) => s + d.soLuong * (d.canHienTaiG ?? 0), 0);
  const mucTieuG = mucTieu.reduce((s, d) => s + d.soLuong * (d.canHienTaiG ?? 0), 0);
  const chiaDuocG = don.billedKg * 1000 - ngoaiG;
  if (chiaDuocG <= mucTieuG + 1e-6) return ra;

  const tongSoLuong = mucTieu.reduce((s, d) => s + d.soLuong, 0);
  for (const d of mucTieu) {
    // Chưa biết cân hiện tại thì chia đều theo số lượng — không có gì để lấy tỉ lệ.
    const tiLe = mucTieuG > 0 ? (d.soLuong * (d.canHienTaiG ?? 0)) / mucTieuG : d.soLuong / tongSoLuong;
    const moiMonG = lamTronLen((chiaDuocG * tiLe) / d.soLuong);
    ra.set(d.sku, Math.max(ra.get(d.sku) ?? 0, moiMonG));
  }
  return ra;
}

/**
 * Gộp nhiều đơn → mỗi SKU một đề xuất; chỉ giữ SKU mà cân đề xuất CAO HƠN cân hiện tại.
 * Chỉ lấy món được CHỈ ĐỊNH trong giải trình. `deXuatTuMotDon` (chia theo tỉ lệ) giờ chỉ dùng để
 * điền sẵn gợi ý trong form, không bao giờ tự đẩy lên Shopify.
 */
export function tongHopDeXuat(dsDon: readonly DonBangChung[]): DeXuatCan[] {
  const theoSku = new Map<string, DeXuatCan>();
  for (const don of dsDon) {
    const chiDinh = new Map((don.canChiDinh ?? []).map((c) => [c.sku, c.canMoiG]));
    for (const [sku, g] of chiDinh) {
      const hienTai = don.dong.find((d) => d.sku === sku)?.canHienTaiG ?? null;
      const cu = theoSku.get(sku) ?? { sku, canHienTaiG: hienTai, canDeXuatG: 0, bangChung: [], nghiThungTo: false };
      const thungQuaTo = don.thungQuaTo === true;
      cu.bangChung.push({ maDon: don.maDon, billedKg: don.billedKg, deXuatG: g, thungQuaTo });
      if (g > cu.canDeXuatG) { cu.canDeXuatG = g; cu.nghiThungTo = thungQuaTo; }
      else if (g === cu.canDeXuatG) cu.nghiThungTo = cu.nghiThungTo || thungQuaTo;
      theoSku.set(sku, cu);
    }
  }
  return [...theoSku.values()]
    .filter((d) => d.canHienTaiG == null || d.canDeXuatG > d.canHienTaiG)
    .sort((a, b) => (b.canDeXuatG - (b.canHienTaiG ?? 0)) - (a.canDeXuatG - (a.canHienTaiG ?? 0)));
}
