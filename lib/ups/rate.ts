/**
 * UPS Rating API — báo giá LIVE theo giá hợp đồng của mình.
 *
 * Vì sao cần dù đã có bảng giá nội bộ: số zone của UPS KHÔNG phải một bảng nước→zone thuần.
 * Đo ngày 12/10/2026 trên 56 nước mình thật sự gửi, bảng giá đúng trong 2% ở 51 nước nhưng
 * AU/NZ thấp hơn 48% và SG cao hơn 37% — vì AU/NZ và JP/KR/CN cùng được UPS gọi là "Zone 3"
 * mà giá khác nhau (765.160 vs 397.620 ở 2kg), SG và TH cùng "Zone 1" mà 301.035 vs 411.015.
 * Lượt nhập bảng giá gộp chúng vào một cột. AU là nước đích thứ 4 của mình (362 đơn): bảng
 * báo UPS rẻ nhất 796.642đ cho 3kg trong khi UPS thật thu ~1,61tr, tức chọn sai line ship.
 *
 * Dùng `Shop` (mọi dịch vụ) thay vì `Rate` (một dịch vụ): tài khoản mang tên Worldwide
 * Expedited nhưng hoá đơn tháng 9 cho thấy 30/37 lô đi Express Saver, và hai mức lệch ~4,9%.
 * CEO chốt 12/10/2026: hiện mức RẺ HƠN kèm tên dịch vụ để người chọn line biết chọn đúng mức
 * bên cổng hãng.
 *
 * Tiền trả về là CHƯA VAT — hoá đơn UPS tính 8% trên tổng chịu thuế (xem D-234), nên chỗ gọi
 * phải cộng VAT theo cấu hình tài khoản. Phần thuần (`docPhanHoiShop`, `chonMucReNhat`) tách
 * khỏi phần chạm mạng để test được.
 */
import { headerUps, layTokenUps, upsBase, xoaTokenUps, coKhoaUps } from './client';

/** Mã dịch vụ UPS → tên đọc được. Chỉ liệt kê mức tuyến quốc tế từ VN; mã lạ giữ nguyên số. */
const TEN_DICH_VU: Record<string, string> = {
  '07': 'Worldwide Express',
  '08': 'Worldwide Expedited',
  '11': 'Standard',
  '54': 'Worldwide Express Plus',
  '65': 'Worldwide Express Saver',
  '96': 'Worldwide Express Freight',
};

export const tenDichVuUps = (ma: string): string => TEN_DICH_VU[ma] ?? `Dịch vụ ${ma}`;

/**
 * Mã KHOẢN PHÍ của Rating API → tên đọc được. Khác mã trên hoá đơn (hoá đơn dùng `FSC`, `FIP`,
 * `RES`…; Rating API dùng số). Chốt bằng cách so với chính hoá đơn 100000813108: `375` ra đúng
 * số tiền nhiên liệu, `573` ra đúng 58.750đ phí xử lý quốc tế, `270` ra 95.410đ giao nhà dân.
 * Mã lạ giữ nguyên số — thà hiện `412` còn hơn gán sai tên.
 */
const TEN_KHOAN: Record<string, string> = {
  '110': 'Xác nhận giao hàng',
  '121': 'Ký nhận',
  '190': 'Phụ phí xử lý',
  '270': 'Giao nhà dân',
  '375': 'Nhiên liệu',
  '376': 'Vùng mở rộng',
  '377': 'Vùng sâu vùng xa',
  '434': 'Phụ phí cao điểm',
  '573': 'Phí xử lý quốc tế',
};

export const tenKhoanUps = (ma: string): string => TEN_KHOAN[ma] ?? ma;

/** Một khoản phí UPS trả kèm báo giá (mã của UPS, không phải cột của mình). */
export interface KhoanBaoGiaUps { ma: string; tien: number; phu?: string }

export interface DongBaoGiaUps {
  maDichVu: string;
  tenDichVu: string;
  zone: string | null;
  canTinhCuocKg: number | null;
  /** Cước nền theo giá HỢP ĐỒNG, chưa VAT. */
  base: number;
  /** Tổng theo giá HỢP ĐỒNG, chưa VAT — gồm nền + mọi phụ phí UPS trả về. */
  tong: number;
  khoan: KhoanBaoGiaUps[];
  /**
   * Cước nền theo giá NIÊM YẾT (khối ngoài `NegotiatedRateCharges`).
   *
   * Cần vì ô "Mức giá cơ sở" trên Lark là giá GỐC, không phải giá sau chiết khấu — cùng quy
   * ước với FedEx (D-245). Đo 16/10/2026 trên `1Z2050VDD900243620`: Lark điền 3.028.915 đúng
   * bằng base NIÊM YẾT của mức 65, còn base hợp đồng chỉ 614.760 — lệch gần 5 lần.
   *
   * 0 khi UPS không trả khối niêm yết.
   */
  baseNiemYet: number;
  /** Tổng theo giá NIÊM YẾT. Chiết khấu = `tongNiemYet - tong`; UPS trả CẢ HAI khối trong
   *  CÙNG một phản hồi nên không phải gọi thêm lượt nào, cũng không phải suy bừa. */
  tongNiemYet: number;
  /** Các khoản theo giá NIÊM YẾT — nguồn cho mọi ô phụ phí trên Lark. */
  khoanNiemYet: KhoanBaoGiaUps[];
  /** Tiền tệ UPS trả (tài khoản VN trả VND). */
  tienTe: string;
}

const soTien = (v: unknown): number => {
  const n = Number(typeof v === 'string' || typeof v === 'number' ? v : NaN);
  return Number.isFinite(n) ? n : 0;
};
const dsCua = <T,>(v: T[] | T | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

interface TienUps { MonetaryValue?: string; CurrencyCode?: string }
interface KhoanUps { Code?: string; MonetaryValue?: string; SubType?: string }
interface LoUps {
  Service?: { Code?: string };
  Zone?: string;
  BillingWeight?: { Weight?: string };
  NegotiatedRateCharges?: {
    TotalCharge?: TienUps; BaseServiceCharge?: TienUps;
    ItemizedCharges?: KhoanUps[] | KhoanUps;
  };
  TotalCharges?: TienUps; BaseServiceCharge?: TienUps;
  ItemizedCharges?: KhoanUps[] | KhoanUps;
}

/**
 * THUẦN: đọc phản hồi `Shop` → danh sách mức dịch vụ.
 *
 * `RatedShipment` là MẢNG ở `Shop` nhưng UPS trả OBJECT khi chỉ có một mức — nhận cả hai, vì
 * bản đầu chỉ nhận mảng thì mọi con số ra 0 mà không báo lỗi gì (gặp thật 12/10/2026).
 *
 * Lấy `NegotiatedRateCharges` (giá hợp đồng) làm `base`/`tong`/`khoan`. KHÔNG rơi về giá niêm
 * yết khi thiếu: giá niêm yết cao gấp ~4 lần, hiện nó lên bảng so cước là đẩy UPS xuống cuối
 * một cách sai — thiếu thì bỏ dòng đó và để chỗ gọi báo "không báo giá được".
 *
 * Giá NIÊM YẾT đọc THÊM vào `baseNiemYet`/`tongNiemYet`/`khoanNiemYet`, không thay thế gì.
 * Hai khối nằm sẵn trong cùng một phản hồi; bỏ khối niêm yết đi là tự tay vứt mất cả ô "Mức
 * giá cơ sở" lẫn ô "Chiết khấu" của Lark (xem `baseNiemYet`).
 */
export function docPhanHoiShop(json: unknown): DongBaoGiaUps[] {
  const tho = (json as { RateResponse?: { RatedShipment?: LoUps[] | LoUps } } | null)?.RateResponse?.RatedShipment;
  const out: DongBaoGiaUps[] = [];
  for (const lo of dsCua(tho)) {
    const ng = lo.NegotiatedRateCharges;
    const tong = soTien(ng?.TotalCharge?.MonetaryValue);
    if (!ng || !(tong > 0)) continue;
    const ma = (lo.Service?.Code ?? '').trim();
    out.push({
      maDichVu: ma,
      tenDichVu: tenDichVuUps(ma),
      zone: lo.Zone?.trim() || null,
      canTinhCuocKg: lo.BillingWeight?.Weight != null ? soTien(lo.BillingWeight.Weight) : null,
      base: soTien(ng.BaseServiceCharge?.MonetaryValue),
      tong,
      khoan: dsCua(ng.ItemizedCharges).map((k) => ({
        ma: (k.Code ?? '').trim(),
        tien: soTien(k.MonetaryValue),
        ...(k.SubType ? { phu: k.SubType.trim() } : {}),
      })).filter((k) => k.tien !== 0),
      baseNiemYet: soTien(lo.BaseServiceCharge?.MonetaryValue),
      tongNiemYet: soTien(lo.TotalCharges?.MonetaryValue),
      khoanNiemYet: dsCua(lo.ItemizedCharges).map((k) => ({
        ma: (k.Code ?? '').trim(),
        tien: soTien(k.MonetaryValue),
        ...(k.SubType ? { phu: k.SubType.trim() } : {}),
      })).filter((k) => k.tien !== 0),
      tienTe: (ng.TotalCharge?.CurrencyCode ?? 'VND').trim(),
    });
  }
  return out;
}

/**
 * THUẦN: mức dịch vụ ĐÚNG BẰNG mã của vận đơn, hoặc null khi UPS không trả mức đó.
 *
 * Bẫy đã dính 16/10/2026: Track API trả `service.code` = `566` còn Rating API dùng `65` —
 * HAI HỆ MÃ KHÁC NHAU. Mã khớp được với Rating là `service.levelCode` (`065`), và phải bỏ số
 * 0 đầu. Ghép bằng `code` thì không mức nào khớp, rơi về mức đầu tiên, ra giá của một dịch vụ
 * khác hẳn mà không báo gì.
 */
export function chonMucTheoMa(ds: readonly DongBaoGiaUps[], maDichVu: string | null): DongBaoGiaUps | null {
  if (!maDichVu) return null;
  const chuan = (c: string) => c.trim().replace(/^0+/, '');
  const m = chuan(maDichVu);
  return ds.find((d) => chuan(d.maDichVu) === m) ?? null;
}

/** THUẦN: mức RẺ NHẤT theo tổng hợp đồng. Mảng rỗng → null. */
export function chonMucReNhat(ds: readonly DongBaoGiaUps[]): DongBaoGiaUps | null {
  return ds.reduce<DongBaoGiaUps | null>((re, d) => (re == null || d.tong < re.tong ? d : re), null);
}

export interface VaoBaoGiaUps {
  /** Số tài khoản 6 ký tự (vd `2050VD`) — UPS đòi để trả giá hợp đồng. */
  soTaiKhoan: string;
  nuocDen: string;
  maBuuChinh?: string | null;
  thanhPho?: string | null;
  bangTinh?: string | null;
  canKg: number;
  kichThuocCm?: { dai: number; rong: number; cao: number } | null;
  /** Địa chỉ nhà dân → UPS cộng phụ phí giao nhà dân. */
  nhaDan?: boolean;
  /** Có dùng dịch vụ ký nhận không. Mặc định CÓ — hoá đơn tháng 9 thu 37/37 lô. */
  kyNhan?: boolean;
  /** Điểm gửi — mặc định kho Hà Nội. */
  guiTu?: { thanhPho: string; maBuuChinh: string; nuoc: string };
}

const GUI_TU_MAC_DINH = { thanhPho: 'HANOI', maBuuChinh: '100000', nuoc: 'VN' };

/** THUẦN: dựng thân request `Shop`. Tách ra để test được hình dạng mà không chạm mạng. */
export function thanRequestShop(v: VaoBaoGiaUps): Record<string, unknown> {
  const g = v.guiTu ?? GUI_TU_MAC_DINH;
  const gui = { AddressLine: ['-'], City: g.thanhPho, PostalCode: g.maBuuChinh, CountryCode: g.nuoc };
  const nhan: Record<string, unknown> = {
    AddressLine: ['-'],
    City: v.thanhPho ?? '',
    PostalCode: v.maBuuChinh ?? '',
    CountryCode: v.nuocDen,
  };
  if (v.bangTinh) nhan.StateProvinceCode = v.bangTinh;
  if (v.nhaDan) nhan.ResidentialAddressIndicator = 'Y';
  const kien: Record<string, unknown> = {
    PackagingType: { Code: '02' },
    PackageWeight: { UnitOfMeasurement: { Code: 'KGS' }, Weight: String(v.canKg) },
  };
  if (v.kichThuocCm) {
    kien.Dimensions = {
      UnitOfMeasurement: { Code: 'CM' },
      Length: String(v.kichThuocCm.dai), Width: String(v.kichThuocCm.rong), Height: String(v.kichThuocCm.cao),
    };
  }
  return {
    RateRequest: {
      Request: { RequestOption: 'Shop', TransactionReference: { CustomerContext: 'sms-compare' } },
      Shipment: {
        Shipper: { Name: 'MEAN BLVD', ShipperNumber: v.soTaiKhoan, Address: gui },
        ShipFrom: { Name: 'MEAN BLVD', Address: gui },
        ShipTo: { Name: '-', Address: nhan },
        PaymentDetails: { ShipmentCharge: [{ Type: '01', BillShipper: { AccountNumber: v.soTaiKhoan } }] },
        ShipmentRatingOptions: { NegotiatedRatesIndicator: 'Y' },
        // Ký nhận phải khai ở mức SHIPMENT; khai ở mức Package thì UPS từ chối 111211
        // (thử cả DCISType 1/2/3 ngày 12/10/2026).
        ...(v.kyNhan === false ? {} : { ShipmentServiceOptions: { DeliveryConfirmation: { DCISType: '1' } } }),
        Package: [kien],
      },
    },
  };
}

/** Thời gian chờ tối đa — bảng so cước không được treo vì UPS chậm. */
const HET_HAN_MS = 8_000;

/**
 * Gọi `Shop` → mọi mức dịch vụ theo giá hợp đồng. Chạm mạng.
 *
 * Không ném khi UPS từ chối: trả `{ ok: false, loi }` để chỗ gọi rơi về bảng giá kèm nhãn.
 * Bảng so cước phải mở được kể cả khi UPS chết.
 */
export async function baoGiaUpsShop(
  v: VaoBaoGiaUps,
): Promise<{ ok: true; ds: DongBaoGiaUps[] } | { ok: false; loi: string }> {
  if (!coKhoaUps()) return { ok: false, loi: 'chưa khai UPS_CLIENT_ID/UPS_CLIENT_SECRET' };
  let bearer: string;
  try { bearer = await layTokenUps(); }
  catch (e) { return { ok: false, loi: e instanceof Error ? e.message : String(e) }; }

  try {
    const res = await fetch(`${upsBase()}/api/rating/v2409/Shop`, {
      method: 'POST',
      headers: headerUps(bearer, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(thanRequestShop(v)),
      signal: AbortSignal.timeout(HET_HAN_MS),
    });
    if (res.status === 401) { xoaTokenUps(); return { ok: false, loi: 'ups_unauthorized' }; }
    const txt = await res.text();
    if (!res.ok) {
      // UPS trả mã lỗi có nghĩa (111217 = tuyến không có dịch vụ này) — giữ lại để đọc log.
      const ma = /"code"\s*:\s*"(\d+)"/.exec(txt)?.[1];
      return { ok: false, loi: `ups_rate_http_${res.status}${ma ? `_${ma}` : ''}` };
    }
    const ds = docPhanHoiShop(JSON.parse(txt));
    if (ds.length === 0) return { ok: false, loi: 'ups_khong_co_gia_hop_dong' };
    return { ok: true, ds };
  } catch (e) {
    return { ok: false, loi: e instanceof Error ? e.message : String(e) };
  }
}
