/**
 * THUẦN: đọc một dòng bảng Lark "đơn ship hộ" của đội logistics thành dữ liệu hệ thống.
 *
 * Bối cảnh (CEO 11/09/2026): Đức lên đơn cho khách trên bảng Lark, hệ thống là nơi nhập
 * lại sau nên NGÀY GỬI trên hệ thống chính là ngày Đức ngồi nhập, muộn hơn ngày đi hàng
 * thật. Đo 99 đơn khớp nhau: 98 đơn có ngày trên Lark SỚM hơn ngày gửi hệ thống, cá biệt
 * lệch 6 ngày (đi 02/07 nhưng hệ thống ghi 08/07).
 *
 * Khoá ghép là MÃ VẬN ĐƠN, không phải mã đơn: hai bên đánh số độc lập (Lark
 * 26-INSLG-SV-0434…0973, hệ thống 26-INSLG-SV-0001…0104) nên mã đơn không bao giờ khớp,
 * trong khi 99/100 mã vận đơn trùng khít.
 */
export interface DongLarkDon {
  recordId: string;
  /** Mã đơn theo cách đánh số của Lark — lưu để đối chiếu, KHÔNG dùng làm khoá ghép. */
  maLark: string | null;
  trackingNumber: string | null;
  carrierKey: string | null;
  /** Ngày brand yêu cầu gửi — dùng làm ngày gửi vì sát ngày đi hàng thật nhất. */
  ngayGui: string | null;
  brandText: string | null;
  nuoc: string | null;
  thanhPho: string | null;
  maBuuChinh: string | null;
  diaChi: string | null;
  soNha: string | null;
  nguoiNhan: string | null;
  dienThoai: string | null;
  email: string | null;
  canKg: number | null;
  moTaHang: string | null;
  /** Tiền THU brand (đã gồm mọi phụ phí) — cột "Brand | Tổng Thu (đ)". */
  thuBrandVnd: number | null;
  /** Cước mình trả hãng — cột "INS | Giá tổng". */
  vonVnd: number | null;
  trangThaiGiao: string | null;
}

/** Lark trả mỗi ô một kiểu: chuỗi, số, mảng {text}, hoặc {value:[…]}. Rút về chuỗi phẳng. */
export function chuoi(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    const s = v.map((x) => chuoi(x) ?? '').filter(Boolean).join(', ');
    return s || null;
  }
  const o = v as Record<string, unknown>;
  if ('text' in o) return chuoi(o.text);
  if ('value' in o) return chuoi(o.value);
  return null;
}

export function so(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') { const n = Number(v.replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : null; }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.value)) return so(o.value[0]);
    if ('value' in o) return so(o.value);
  }
  return null;
}

/** Ô ngày của Lark là epoch mili giây. Trả ISO yyyy-mm-dd theo giờ VN (+07) — cùng múi
 *  giờ người nhập đang nhìn, nếu quy về UTC sẽ lùi mất một ngày với ô nhập buổi tối. */
export function ngayISO(v: unknown): string | null {
  const n = so(v);
  if (n == null || n <= 0) return null;
  return new Date(n + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Bỏ dấu, gộp khoảng trắng, thường hoá — để so tên brand gõ tay với danh mục hệ thống. */
export function chuanHoaTen(s: string): string {
  return s.normalize('NFD').split('').filter((c) => c.charCodeAt(0) < 0x300 || c.charCodeAt(0) > 0x36f).join('')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Ghép tên brand gõ tay trên Lark với slug trong hệ thống. Lark gõ tự do nên cùng một
 * brand có nhiều biến thể ("TINH Atelier", "TINH ATelier", "TINH Altelier", "tom fried").
 * Ghép theo tên đã bỏ dấu; không chắc thì trả null để bộ đồng bộ BỎ QUA chứ không đoán —
 * gán nhầm brand là gán nhầm công nợ.
 */
export function ghepBrand(
  text: string | null,
  danhSach: ReadonlyArray<{ slug: string; ten: string }>,
): string | null {
  if (!text) return null;
  const k = chuanHoaTen(text);
  if (!k) return null;
  for (const b of danhSach) if (chuanHoaTen(b.ten) === k || chuanHoaTen(b.slug) === k) return b.slug;
  // Biến thể dài hơn/ngắn hơn: "EEGEN STUDIO" ↔ "Eegen", "TINH Altelier" ↔ "Tinh Atelier".
  const ungVien = danhSach.filter((b) => {
    const t = chuanHoaTen(b.ten);
    return t.length >= 4 && (k.startsWith(t) || t.startsWith(k));
  });
  return ungVien.length === 1 ? ungVien[0].slug : null;
}

export const COT = {
  maLark: 'Order Number',
  tracking: 'Tracking Number',
  carrier: 'Couriers',
  ngayGui: 'Ngày tạo Request',
  brand: 'Brands (Requester)',
  nuoc: '(Recipient) Country',
  thanhPho: 'City',
  maBuuChinh: 'Postal / Zip Code',
  duong: 'Street (Name or Number)',
  khu: 'District/Zone/Block (Name or Number)',
  soNha: 'House Number',
  nguoiNhan: '(Recipient) Full Name',
  dienThoai: '(Recipient) Phone No.',
  email: '(Recipient) Email',
  can: 'Weights',
  moTa: 'Mô tả Sản phẩm',
  thuBrand: 'Brand | Tổng Thu (đ)',
  von: 'INS | Giá tổng',
  trangThai: 'LOG-EP-Dispatch Status',
} as const;

const KHOA_CARRIER: Record<string, string> = { fedex: 'fedex', dhl: 'dhl', aramex: 'aramex', ups: 'ups' };

export function docDongLark(recordId: string, f: Record<string, unknown>): DongLarkDon {
  const carrierText = chuoi(f[COT.carrier]);
  const duong = chuoi(f[COT.duong]);
  const khu = chuoi(f[COT.khu]);
  return {
    recordId,
    maLark: chuoi(f[COT.maLark]),
    trackingNumber: chuoi(f[COT.tracking])?.replace(/\s+/g, '') ?? null,
    carrierKey: carrierText ? KHOA_CARRIER[chuanHoaTen(carrierText)] ?? null : null,
    ngayGui: ngayISO(f[COT.ngayGui]),
    brandText: chuoi(f[COT.brand]),
    nuoc: chuoi(f[COT.nuoc]),
    thanhPho: chuoi(f[COT.thanhPho]),
    maBuuChinh: chuoi(f[COT.maBuuChinh]),
    diaChi: [duong, khu].filter(Boolean).join(', ') || null,
    soNha: chuoi(f[COT.soNha]),
    nguoiNhan: chuoi(f[COT.nguoiNhan]),
    dienThoai: chuoi(f[COT.dienThoai]),
    email: chuoi(f[COT.email]),
    canKg: so(f[COT.can]),
    moTaHang: chuoi(f[COT.moTa]),
    thuBrandVnd: so(f[COT.thuBrand]),
    vonVnd: so(f[COT.von]),
    trangThaiGiao: chuoi(f[COT.trangThai]),
  };
}

/** Dòng có đủ dữ liệu để TẠO đơn mới không. Thiếu thì chỉ bỏ qua, không tạo đơn rác. */
export function duDeTao(d: DongLarkDon, brandSlug: string | null): string | null {
  if (!d.trackingNumber) return 'chưa có mã vận đơn';
  if (!brandSlug) return `chưa ghép được brand "${d.brandText ?? ''}"`;
  if (!d.nuoc) return 'thiếu nước nhận';
  if (d.canKg == null || d.canKg <= 0) return 'thiếu cân';
  if (!d.ngayGui) return 'thiếu ngày gửi';
  return null;
}
