/**
 * THUẦN: luật của bước LÊN VẬN ĐƠN trên màn Đóng hàng. Không I/O.
 *
 * Spec: docs/superpowers/specs/2026-10-12-len-van-don-dong-hang-design.md
 *
 * Vì sao luật nằm hết ở đây: bộ test của repo không bắt `.tsx`, nên luật đặt trong component
 * là luật không ai canh. Hộp thoại chỉ việc vẽ những gì module này trả ra.
 */

import { canQuyDoi } from './logic';

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

export interface O {
  nhan: string;
  giaTri: string | null;
  /** Câu giải thích hiện cạnh ô — vì sao giá trị là thế này, hoặc vì sao nó trống. */
  vi?: string;
  /** Ô tham khảo, KHÔNG vào văn bản "copy cả khối" (dán sang form hãng là rác). */
  chiDeXem?: boolean;
}

export interface Khoi {
  ten: string;
  o: O[];
  chanCopy: boolean;
  lyDoChan: string | null;
  canhBao: { muc: 'do' | 'vang' | 'khong'; cau: string | null; batXacNhan: boolean } | null;
}

export interface MonHang {
  /** `product_title` (+ `variant_title` khi có) của dòng đơn. */
  tenSanPham: string;
  sku: string | null;
  soLuong: number;
  /** Metafield `custom.materials_v2` qua `locThuocTinh`; null khi Shopify không trả được. */
  chatLieu: string | null;
}

export interface VaoKhoiVanDon {
  diaChi: DiaChiDon;
  /** null = không gọi được Shopify → ô SĐT/email nói rõ thay vì để trống im lặng. */
  tuShopify: { phone: string | null; email: string | null } | null;
  can: CanKienVao;
  mon: MonHang[];
  /** `n/N` của kiện trong đơn; null khi kiện chưa có mã Lark. */
  soKien: { n: number; tong: number } | null;
}

const KHONG_LAY_DUOC = 'không lấy được từ Shopify — thử lại';
const GO_TAY = 'gõ tay bên cổng hãng';
const so = (n: number | null): string | null => (n == null ? null : String(n));

/** Bốn khối của hộp thoại Lên vận đơn, theo đúng thứ tự người lên vận đơn điền form. */
export function dungKhoiVanDon(vao: VaoKhoiVanDon): Khoi[] {
  const d = vao.diaChi;
  const zip = chonZip(d);
  const can = nguonCanKien(vao.can);
  const qd = canQuyDoi(can.canKg, can.dai != null && can.rong != null ? { l: can.dai, w: can.rong, h: can.cao } : null);

  const nguoiNhan: Khoi = {
    ten: 'Người nhận',
    o: [
      { nhan: 'Tên', giaTri: d.shipName },
      { nhan: 'Công ty', giaTri: d.shipCompany },
      { nhan: 'Địa chỉ 1', giaTri: d.shipAddress1 },
      { nhan: 'Địa chỉ 2', giaTri: d.shipAddress2 },
      { nhan: 'Thành phố', giaTri: d.shipCity },
      // Mã bang Shopify mang tiền tố nước ("US-FL") — form hãng chỉ nhận phần sau.
      { nhan: 'Bang / Tỉnh', giaTri: d.shipProvinceCode ? (d.shipProvinceCode.split('-').pop() ?? null) : null },
      { nhan: 'ZIP', giaTri: zip.zip, vi: zip.vi },
      { nhan: 'Nước', giaTri: d.shipCountry },
      { nhan: 'SĐT', giaTri: vao.tuShopify?.phone ?? null, ...(vao.tuShopify ? {} : { vi: KHONG_LAY_DUOC }) },
      { nhan: 'Email', giaTri: vao.tuShopify?.email ?? null, ...(vao.tuShopify ? {} : { vi: KHONG_LAY_DUOC }) },
    ],
    chanCopy: d.addrVerifiedAt == null,
    lyDoChan: d.addrVerifiedAt == null ? 'Địa chỉ chưa verify — bấm "Verify ngay" trước khi copy' : null,
    canhBao: canhBaoDiaChi(d),
  };

  const kienHang: Khoi = {
    ten: 'Kiện hàng',
    o: [
      { nhan: 'Cân thực (kg)', giaTri: so(can.canKg), vi: can.nhan },
      { nhan: 'Dài (cm)', giaTri: so(can.dai) },
      { nhan: 'Rộng (cm)', giaTri: so(can.rong) },
      { nhan: 'Cao (cm)', giaTri: so(can.cao) },
      { nhan: 'Loại hộp', giaTri: can.hop },
      {
        nhan: 'Số kiện',
        giaTri: vao.soKien ? `${vao.soKien.n}/${vao.soKien.tong}` : null,
        ...(vao.soKien ? {} : { vi: 'kiện chưa có mã Lark nên không biết thứ tự' }),
      },
      {
        nhan: 'Cân quy đổi', giaTri: so(qd.quyDoi), chiDeXem: true,
        vi: qd.tinhCuoc != null ? `hãng tính cước theo ${qd.tinhCuoc} kg` : 'chưa đủ số để tính',
      },
    ],
    chanCopy: can.thieu.length > 0,
    lyDoChan: can.thieu.length > 0
      ? `Thiếu ${can.thieu.join(' và ')} — phải cân lại trước khi lên vận đơn`
      : null,
    canhBao: null,
  };

  const hangHoa: Khoi = {
    ten: 'Hàng hoá',
    o: vao.mon.flatMap((m, i) => [
      { nhan: `Món ${i + 1} — mô tả`, giaTri: moTaHangHoa(m.tenSanPham, m.chatLieu) },
      { nhan: `Món ${i + 1} — SKU`, giaTri: m.sku },
      { nhan: `Món ${i + 1} — số lượng`, giaTri: String(m.soLuong) },
    ]),
    chanCopy: false,
    lyDoChan: null,
    canhBao: (vao.soKien?.tong ?? 1) > 1
      ? {
          muc: 'vang', batXacNhan: false,
          cau: `Đơn này có ${vao.soKien!.tong} kiện — tự chọn món nào thuộc kiện này.`,
        }
      : null,
  };

  /* Năm ô này có đúng một điểm chung đáng kể với người dùng: ô nào cũng phải GÕ TAY bên cổng
   * hãng. "Loại dịch vụ" không phải khoản hải quan, nhưng gom cùng chỗ thì người lên vận đơn
   * quét một lượt là biết còn gì phải tự điền (CEO chốt 12/10/2026). */
  const haiQuan: Khoi = {
    ten: 'Khai hải quan',
    o: [
      { nhan: 'Giá trị khai', giaTri: null, vi: GO_TAY },
      { nhan: 'Đơn vị tiền', giaTri: null, vi: GO_TAY },
      { nhan: 'HS code', giaTri: null, vi: GO_TAY },
      { nhan: 'Nước xuất xứ', giaTri: null, vi: GO_TAY },
      { nhan: 'Loại dịch vụ', giaTri: null, vi: GO_TAY },
    ],
    chanCopy: false, lyDoChan: null, canhBao: null,
  };

  return [nguoiNhan, kienHang, hangHoa, haiQuan];
}

/** Văn bản cho nút "copy cả khối". Bỏ ô chỉ-để-xem; ô trống hiện `—`. */
export function vanBanKhoi(k: Khoi): string {
  return k.o.filter((x) => !x.chiDeXem).map((x) => `${x.nhan}: ${x.giaTri ?? '—'}`).join('\n');
}
