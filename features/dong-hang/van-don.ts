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
  // Thiếu CHIỀU CAO không phải là thiếu kích thước: kho có bốn cỡ túi chỉ ghi hai số
  // (28x42, 38x52, 25x35, 35x45) và `kiemNhapDongThung` cho lưu đúng như vậy từ 14/10/2026.
  // Cao rỗng chính là tín hiệu `inferPackagingFromDims` dùng để chọn hạng Pak thay vì Package.
  // Đòi đủ ba chiều ở đây là CHẶN mọi kiện đóng bằng túi ngay trước lúc lên vận đơn, với câu
  // "phải cân lại" vô nghĩa — người ta cân rồi, cái túi không có chiều thứ ba để mà đo.
  if (!chon || chon.dai == null || chon.rong == null) thieu.push('kích thước');
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

/**
 * Mô tả hàng để gõ vào ô "Description of goods" bên cổng hãng (bộ bàn giao thiết kế
 * 13/10/2026, mục "3 · Hàng hoá").
 *
 * Bỏ TỪ ĐẦU (tên riêng của mẫu — "Uri", "Theas"…) và bỏ phần biến thể sau ` · ` (màu/size),
 * rồi thêm tiền tố "Woman's": hãng và hải quan cần loại hàng, không cần tên mẫu nội bộ —
 * "Uri Turtle Neck Bodysuit · Beige / S" → "Woman's Turtle Neck Bodysuit". Tiền tố cố định vì
 * MEAN BLVD chỉ bán hàng nữ (vision công ty); ngày có dòng hàng khác thì ĐÂY là chỗ sửa.
 *
 * Tên chỉ có MỘT từ thì giữ nguyên từ đó: bỏ đi là còn lại chuỗi rỗng — một ô mô tả trống
 * còn tệ hơn một mô tả mang tên riêng.
 */
export function moTaHaiQuan(tenSanPham: string): string {
  const ten = tenSanPham.split(' · ')[0].trim().replace(/\s+/g, ' ');
  if (ten === '') return '';
  const tu = ten.split(' ');
  const con = tu.length > 1 ? tu.slice(1).join(' ') : ten;
  return `Woman's ${con}`;
}

export interface O {
  /** Nhãn ĐẦY ĐỦ — duy nhất trong khối, nên vừa làm khoá vừa là nhãn trong văn bản copy. */
  nhan: string;
  /** Nhãn ngắn để VẼ khi ngữ cảnh đã rõ (trong khối theo món, số thứ tự món đã nằm ở viền). */
  nhanNgan?: string;
  giaTri: string | null;
  /** Câu giải thích hiện cạnh ô — vì sao giá trị là thế này, hoặc vì sao nó trống. */
  vi?: string;
  /** Ô tham khảo, KHÔNG vào văn bản "copy cả khối" (dán sang form hãng là rác). */
  chiDeXem?: boolean;
  /** Vẽ bằng phông đơn cách: SKU phải đọc được từng ký tự khi so với cổng hãng. */
  donCach?: boolean;
}

/**
 * Cách VẼ thân khối theo bộ bàn giao: hàng nhãn–giá trị, ô vuông, gom theo món, hay khối
 * CHỈ-ĐỌC (viền gạch nối, không có nút copy — mọi ô đều phải gõ tay bên cổng hãng).
 *
 * Khai ra đây chứ không để `.tsx` tự suy từ dữ liệu ("khối không còn ô nào copy được thì vẽ
 * gạch nối"): suy như thế thì khối Kiện hàng của một kiện chưa cân cũng rơi vào nhánh gạch
 * nối mà chẳng ai chủ ý.
 */
export type HinhKhoi = 'dong' | 'o-vuong' | 'mon' | 'chi-doc';

/** Sắc màu riêng của khối — thiết kế tách bạch bốn mục bằng bốn sắc để không copy lẫn ô. */
export type MauKhoi = 'lam' | 'hoPhach' | 'luc' | 'tim';

/** Một món trong khối Hàng hoá. `o` là CHÍNH các ô của `Khoi.o` (cùng tham chiếu), gom lại
 *  để vẽ thành một hộp có số thứ tự — không nhân bản dữ liệu thành hai nguồn. */
export interface NhomMon {
  thuTu: number;
  o: O[];
}

export interface Khoi {
  ten: string;
  /** Số hiện trong huy hiệu của thiết kế (1→4), cũng là thứ tự người lên vận đơn điền form. */
  so: number;
  hinh: HinhKhoi;
  mau: MauKhoi;
  o: O[];
  /** Chỉ khối `hinh === 'mon'`: cùng các ô của `o`, gom theo món. */
  mon?: NhomMon[];
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
    ten: 'Người nhận', so: 1, hinh: 'dong', mau: 'lam',
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

  /* Thứ tự năm ô đầu theo đúng hàng ô vuông của thiết kế (Cân · Dài · Rộng · Cao · Số kiện).
   * "Loại hộp" xếp SAU chúng chứ không bị bỏ: bộ bàn giao đề nghị gỡ ô này (hộp đã chọn ở
   * bước trước), nhưng nó vẫn là một ô người lên vận đơn đang dùng nên gỡ đi là mất thông tin
   * — xếp cuối hàng là đủ để nó không chen vào năm ô chính. */
  const kienHang: Khoi = {
    ten: 'Kiện hàng', so: 2, hinh: 'o-vuong', mau: 'hoPhach',
    o: [
      { nhan: 'Cân thực (kg)', giaTri: so(can.canKg), vi: can.nhan },
      { nhan: 'Dài (cm)', giaTri: so(can.dai) },
      { nhan: 'Rộng (cm)', giaTri: so(can.rong) },
      { nhan: 'Cao (cm)', giaTri: so(can.cao) },
      {
        nhan: 'Số kiện',
        giaTri: vao.soKien ? `${vao.soKien.n}/${vao.soKien.tong}` : null,
        ...(vao.soKien ? {} : { vi: 'kiện chưa có mã Lark nên không biết thứ tự' }),
      },
      { nhan: 'Loại hộp', giaTri: can.hop },
      {
        nhan: 'Cân quy đổi', giaTri: so(qd.quyDoi), chiDeXem: true,
        vi: qd.tinhCuoc != null
          ? `tự tính từ kích thước, hãng tính cước theo ${qd.tinhCuoc} kg`
          : 'chưa đủ số để tính',
      },
    ],
    chanCopy: can.thieu.length > 0,
    lyDoChan: can.thieu.length > 0
      ? `Thiếu ${can.thieu.join(' và ')} — phải cân lại trước khi lên vận đơn`
      : null,
    canhBao: null,
  };

  /* Năm ô mỗi món. Thiết kế mới tách "Mô tả" (dòng gõ vào form hãng) khỏi "Material" (chất
   * liệu) thay vì ghép `tên — chất liệu` làm một dòng như trước — hai ô khác nhau của form
   * hãng thì phải copy được riêng.
   *
   * "Tên đầy đủ" là ô THÊM so với bộ bàn giao, cố ý: `moTaHaiQuan` bỏ tên riêng và bỏ biến
   * thể màu/size, nên nếu chỉ có ô "Mô tả" thì người lên vận đơn không còn thấy mình đang gửi
   * MẪU NÀO, MÀU/SIZE NÀO — mà đó chính là thứ họ đối chiếu với hàng trong hộp. */
  const nhomMon: NhomMon[] = vao.mon.map((m, i) => ({
    thuTu: i + 1,
    o: [
      { nhan: `Món ${i + 1} — mô tả`, nhanNgan: 'Mô tả', giaTri: moTaHaiQuan(m.tenSanPham) || null },
      { nhan: `Món ${i + 1} — tên đầy đủ`, nhanNgan: 'Tên đầy đủ', giaTri: m.tenSanPham },
      { nhan: `Món ${i + 1} — material`, nhanNgan: 'Material', giaTri: m.chatLieu },
      { nhan: `Món ${i + 1} — SKU`, nhanNgan: 'SKU', giaTri: m.sku, donCach: true },
      { nhan: `Món ${i + 1} — số lượng`, nhanNgan: 'Số lượng', giaTri: String(m.soLuong) },
    ],
  }));

  const hangHoa: Khoi = {
    ten: 'Hàng hoá', so: 3, hinh: 'mon', mau: 'luc',
    o: nhomMon.flatMap((n) => n.o),
    mon: nhomMon,
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
    ten: 'Khai hải quan', so: 4, hinh: 'chi-doc', mau: 'tim',
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

/**
 * Khoá của một ô trong MỘT phiên hộp thoại — dấu "đã copy" treo vào khoá này.
 *
 * Ghép tên khối vào vì nhãn ô chỉ duy nhất TRONG khối: hai khối khác nhau vẫn có thể có ô
 * cùng tên trong tương lai, và khi đó một cú copy sẽ đánh dấu cả ô bên kia.
 */
export function khoaO(tenKhoi: string, nhan: string): string {
  return `${tenKhoi}\u0000${nhan}`;
}

/** Ô copy được = không phải ô tham khảo VÀ có giá trị thật. Ô trống không bấm được (thiết kế:
 *  ô trống hiện `—`, mờ, không phải nút) nên cũng không được tính vào tiến độ. */
export function coTheCopy(o: O): boolean {
  return o.chiDeXem !== true && o.giaTri != null && o.giaTri.trim() !== '';
}

/** Các ô người dùng bấm copy được trong khối. */
export function oCopyDuoc(k: Khoi): O[] {
  return k.o.filter(coTheCopy);
}

/** Các ô CHỈ-ĐỌC của khối (cân quy đổi, khoản phải gõ tay) — vẽ khác, không đếm vào tiến độ. */
export function oChiDoc(k: Khoi): O[] {
  return k.o.filter((o) => o.chiDeXem === true);
}

/**
 * Tiến độ copy: đếm trên ô CÓ GIÁ TRỊ và copy được, không đếm ô trống.
 *
 * Nếu đếm cả ô trống thì thanh tiến độ không bao giờ đầy (địa chỉ nào cũng thiếu vài ô như
 * Công ty / Địa chỉ 2) và người dùng mất luôn cách biết mình đã copy hết hay chưa.
 */
export function tienDo(khoi: Khoi[], daCopy: ReadonlySet<string>): {
  xong: number; tong: number; phanTram: number;
} {
  const ds = khoi.flatMap((k) => oCopyDuoc(k).map((o) => khoaO(k.ten, o.nhan)));
  const xong = ds.filter((kh) => daCopy.has(kh)).length;
  return { xong, tong: ds.length, phanTram: ds.length === 0 ? 0 : Math.round((xong / ds.length) * 100) };
}

/** Tiến độ của MỘT khối — con số "{đã copy}/{có số}" cạnh tên mục trong thiết kế. */
export function tienDoKhoi(k: Khoi, daCopy: ReadonlySet<string>): { xong: number; tong: number } {
  const ds = oCopyDuoc(k).map((o) => khoaO(k.ten, o.nhan));
  return { xong: ds.filter((kh) => daCopy.has(kh)).length, tong: ds.length };
}

/**
 * Nút "Copy cả mục": văn bản `Nhãn: giá trị` từng dòng, kèm danh sách khoá để đánh dấu.
 *
 * CHỈ ô có giá trị (khác bản trước — bản trước còn ghi `Nhãn: —` cho ô trống): dán một dòng
 * `Công ty: —` sang form hãng là gõ đúng hai ký tự rác vào ô của hãng.
 */
export function copyCaMuc(k: Khoi): { text: string; khoa: string[] } {
  const ds = oCopyDuoc(k);
  return {
    text: ds.map((o) => `${o.nhan}: ${o.giaTri}`).join('\n'),
    khoa: ds.map((o) => khoaO(k.ten, o.nhan)),
  };
}

/** Câu toast sau khi copy một ô — cắt giá trị dài để toast không dài quá một dòng. */
export function cauDaCopy(o: O): string {
  const v = o.giaTri ?? '';
  return `${o.nhan}: ${v.length > 60 ? `${v.slice(0, 60)}…` : v}`;
}
