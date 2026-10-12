/**
 * THUẦN: luật của bước LÊN VẬN ĐƠN trên màn Đóng hàng. Không I/O.
 *
 * Spec: docs/superpowers/specs/2026-10-12-len-van-don-dong-hang-design.md
 *
 * Vì sao luật nằm hết ở đây: bộ test của repo không bắt `.tsx`, nên luật đặt trong component
 * là luật không ai canh. Hộp thoại chỉ việc vẽ những gì module này trả ra.
 */

export interface DiaChiDon {
  shipName: string | null; shipCompany: string | null;
  shipAddress1: string | null; shipAddress2: string | null;
  shipCity: string | null; shipProvinceCode: string | null;
  shipPostcode: string | null; shipCountry: string | null;
  addrIssue: string | null; addrStandardized: string | null;
  addrDeliverable: boolean | null;
  /** ISO, null = CHƯA verify lần nào → chặn copy khối Người nhận. */
  addrVerifiedAt: string | null;
}

/** Bỏ mọi ký tự không phải chữ rồi viết thường — để so cờ bất kể cách viết của hãng
 *  (`SuiteRequiredButMissing` và `SUITE.NUMBER.REQUIRED` cùng về `suite…`). */
const chuanCo = (v: string | null): string => (v ?? '').toLowerCase().replace(/[^a-z]/g, '');
/** Viết hoa, bỏ khoảng trắng — để so hai mã bưu chính. */
const chuanZip = (v: string): string => v.toUpperCase().replace(/\s+/g, '');

/**
 * ZIP nên dán sang form hãng.
 *
 * `addr_standardized` KHÔNG phải địa chỉ chuẩn hoá đầy đủ — nó chỉ có city/state/ZIP+4
 * ("1395 Silver Moon Drive, Tallahassee 32312" → "TALLAHASSEE, FL, 32312-3934"). Nên việc duy
 * nhất quyết được ở đây là dán ZIP nào, không có chuyện dán đường của hãng thay đường của khách.
 *
 * Ba điều kiện mới dùng ZIP của hãng: nó NỐI TIẾP mã khách gõ (không phải mã của nơi khác), nó
 * DÀI HƠN (có thêm phần +4 mới đáng dán), và cờ KHÔNG phải họ nội suy.
 */
export function chonZip(
  d: Pick<DiaChiDon, 'shipPostcode' | 'addrStandardized' | 'addrIssue'>,
): { zip: string | null; nguon: 'zip4' | 'khach'; vi: string } {
  const goc = (d.shipPostcode ?? '').trim();
  if (goc === '') return { zip: null, nguon: 'khach', vi: 'Đơn không có mã bưu chính' };
  if (chuanCo(d.addrIssue).includes('interpolated')) {
    return {
      zip: goc, nguon: 'khach',
      vi: 'Bỏ ZIP 9 số: hãng nội suy phần +4 từ dải số nhà quanh đó, không tra được chính địa chỉ này',
    };
  }
  const doan = (d.addrStandardized ?? '').split(',').pop()?.trim() ?? '';
  if (doan === '') return { zip: goc, nguon: 'khach', vi: 'Hãng không trả ZIP mở rộng' };
  const a = chuanZip(doan); const b = chuanZip(goc);
  if (a.startsWith(b) && a.length > b.length) {
    return { zip: doan, nguon: 'zip4', vi: 'ZIP 9 số hãng trả — dán số này giảm phí sửa địa chỉ' };
  }
  return { zip: goc, nguon: 'khach', vi: 'ZIP hãng trả không mở rộng mã của khách' };
}

/**
 * Băng cảnh báo địa chỉ.
 *
 * Họ cờ "thiếu/sai số căn hộ" (238 đơn, bốn cách viết, đều chứa chữ `suite`) phải BẮT XÁC NHẬN
 * chứ không chỉ nhắc: đó đúng loại lỗi dẫn tới phí sửa địa chỉ và vụ hoàn hàng ~10tr, và KPI
 * nhân hệ số nghiêm trọng ×2 cho `sai_dia_chi_giao` (D-073, D-076).
 */
export function canhBaoDiaChi(
  d: Pick<DiaChiDon, 'addrIssue'>,
): { muc: 'do' | 'vang' | 'khong'; cau: string | null; batXacNhan: boolean } {
  const c = chuanCo(d.addrIssue);
  if (c === '') return { muc: 'khong', cau: null, batXacNhan: false };
  if (c.includes('suite')) {
    return {
      muc: 'do', batXacNhan: true,
      cau: 'Địa chỉ thiếu hoặc sai số căn hộ — hãng sẽ thu phí sửa địa chỉ hoặc trả hàng về.',
    };
  }
  return {
    muc: 'vang', batXacNhan: false,
    cau: `Hãng đánh dấu địa chỉ: ${d.addrIssue} — kiểm lại trước khi lên vận đơn.`,
  };
}

export interface CanKienVao {
  /** Bước ĐÓNG THÙNG của SMS (`sms_*`, migration 0187) — cột SMS sở hữu. */
  sms: { hop: string | null; canKg: number | null; dai: number | null; rong: number | null; cao: number | null; luc: string } | null;
  /** Số Lark ghi (`actual_weight_kg`, `dim_*`) — đường lùi khi SMS chưa đóng thùng. */
  lark: { hop: string | null; canKg: number | null; dai: number | null; rong: number | null; cao: number | null } | null;
}

/**
 * Cân + kích thước nên dán, kèm nguồn.
 *
 * SMS THẮNG Lark: bước Đóng thùng là lần cân cuối và là cột SMS sở hữu (đồng bộ Lark không
 * đụng). Hai số có thể khác nhau nên LUÔN nói ra đang lấy từ đâu.
 *
 * KHÔNG BAO GIỜ rơi về cân dự kiến của các món: nó cộng cân từng món đã tính một hộp mỗi món,
 * nên nhiều món gộp một thùng thì nó CAO HƠN cân kiện thật — xem `NHAN_DU_KIEN` trong
 * `can-du-kien.ts`. Thiếu thì nói thiếu, không điền số gần đúng.
 */
export function nguonCanKien(v: CanKienVao): {
  canKg: number | null; dai: number | null; rong: number | null; cao: number | null;
  hop: string | null; nguon: 'sms' | 'lark' | null; nhan: string; thieu: string[];
} {
  const nguon: 'sms' | 'lark' | null = v.sms ? 'sms' : v.lark ? 'lark' : null;
  const chon = v.sms ?? v.lark;
  const nhan = nguon === 'sms'
    ? 'cân + kích thước từ bước Đóng thùng của SMS'
    : nguon === 'lark'
      ? 'cân + kích thước Lark ghi (SMS chưa đóng thùng)'
      : 'chưa có cân và kích thước';
  const thieu: string[] = [];
  if (!chon || chon.canKg == null || !(chon.canKg > 0)) thieu.push('cân');
  if (!chon || chon.dai == null || chon.rong == null || chon.cao == null) thieu.push('kích thước');
  return {
    canKg: chon?.canKg ?? null, dai: chon?.dai ?? null, rong: chon?.rong ?? null,
    cao: chon?.cao ?? null, hop: chon?.hop ?? null, nguon, nhan, thieu,
  };
}

/** Ô "Description of goods" của form hãng: `<tên> — <chất liệu>`; thiếu chất liệu thì chỉ tên. */
export function moTaHangHoa(tenSanPham: string, chatLieu: string | null): string {
  const t = tenSanPham.trim();
  const c = (chatLieu ?? '').trim();
  return c === '' ? t : `${t} — ${c}`;
}
