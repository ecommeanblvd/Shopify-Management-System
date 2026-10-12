/**
 * Quote MỘT đơn hàng qua TẤT CẢ carrier đang bật → bảng so sánh để logistic
 * staff chọn carrier phù hợp nhất. Khác resolveShippingEstimate (chỉ quote
 * carrier khách đã trả) — đây liệt kê hết + xếp theo cước.
 *
 * So sánh theo `carrierCostDisplay` (cước gốc pre-markup, all-in fuel+VAT, ở
 * displayCurrency — tất cả account hiện để VND nên so trực tiếp được).
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote, isApplicable, type QuoteBreakdown, type CarrierAccountSnapshot } from '../engine/quote';
import { loadAccountSnapshot } from '../engine/load';
import { baoGiaUpsShop, chonMucReNhat, tenKhoanUps } from '@/lib/ups/rate';

export interface OrderCarrierQuoteInput {
  country: string;
  weightKg: number;
  postcode?: string | null;
  city?: string | null;
  dimensions?: { lengthCm: number; widthCm: number; heightCm: number } | null;
  effectiveDate?: Date;
  /** null → suy theo nước (Direct Signature các nước hỗ trợ). */
  signatureOptIn?: boolean | null;
  /** Địa chỉ nhà dân → cộng phụ phí giao nhà dân (FedEx/UPS US-CA…). Caller suy
   *  từ phân loại FedEx Address Validation của đơn (xem residential-from-class). */
  isResidential?: boolean;
  /** Lô có dùng dịch vụ ký nhận không. Bỏ trống = có (hàng ta tự vận hành luôn
   *  gửi kèm). Ship hộ truyền theo lựa chọn của brand. */
  directSignature?: boolean;
}

export interface CarrierQuoteRow {
  carrierKey: string;
  carrierName: string;
  accountId: string;
  ok: boolean;
  error?: string;
  costCurrency?: string;
  displayCurrency?: string;
  carrierCostDisplay?: number;
  /** Cước gốc chuẩn hoá về VND — KHOÁ so sánh (account display USD/VND khác nhau). */
  vndCost?: number;
  breakdown?: QuoteBreakdown;
  zone?: string;
  tierUpperKg?: number;
  /** Ghi chú chẩn đoán của engine (vùng sâu khớp theo gì, cân quy đổi, vượt bậc…).
   *  Bảng so sánh hiện ở phần chi tiết để staff hiểu vì sao ra con số đó. */
  notes?: string[];
  /** Tạm ngưng CHỌN từ ngày này (ISO). null = chọn được. Vẫn báo giá. */
  suspendedAt?: string | null;
  suspendReason?: string | null;
  /**
   * Con số này từ đâu. `live` = hỏi thẳng API của hãng (hiện chỉ UPS); `bang` = bảng giá nội
   * bộ. Vắng = hãng không có đường live, bảng giá là nguồn duy nhất nên không cần nói.
   */
  nguonGia?: 'live' | 'bang';
  /** Mức dịch vụ của giá live (vd "Worldwide Express Saver") — người chọn line phải chọn đúng
   *  mức này bên cổng hãng, không thì giá thật khác giá đã so. */
  dichVu?: string;
  /** Câu cảnh báo khi phải rơi về bảng giá. Vắng = số đáng tin. */
  canhBaoGia?: string;
}

/** Cước VND của account: costCurrency=VND → carrierCost; else display=VND →
 *  carrierCostDisplay. So sánh chéo carrier phải cùng VND (FedEx/DHL display USD,
 *  UPS/SF/Aramex display VND). */
function toVnd(costCcy: string, dispCcy: string, cost: number, display: number): number {
  if (costCcy === 'VND') return cost;
  if (dispCcy === 'VND') return display;
  return display; // fallback best-effort
}

export interface AccountSnap {
  carrierKey: string; carrierName: string; accountId: string; snap: CarrierAccountSnapshot;
  suspendedAt?: Date | null; suspendReason?: string | null;
}

/** THUẦN: cho danh sách snapshot + input → hàng so sánh, xếp cước tăng dần
 *  (quote lỗi xuống cuối). Test được không cần DB. */
export function rankCarrierQuotes(entries: AccountSnap[], input: OrderCarrierQuoteInput): CarrierQuoteRow[] {
  // Mặc định KHÔNG opt-in ký nhận: optIn mở van cho MỌI addon when_billed của
  // account — gồm 5 phụ phí THEO-CA của Aramex (quá cân/ngoại cỡ/pallet… tổng
  // $766) → giá so sánh bung nổ (bug 09/07, giống trang compare). Caller muốn
  // tính phí ký nhận thì truyền signatureOptIn=true tường minh.
  const sig = input.signatureOptIn ?? false;
  const rows: CarrierQuoteRow[] = entries.map((e) => {
    const q = quote(e.snap, {
      weightKg: input.weightKg,
      destinationCountry: input.country,
      destinationPostcode: input.postcode ?? undefined,
      destinationCity: input.city ?? undefined,
      dimensions: input.dimensions ?? undefined,
      effectiveDate: input.effectiveDate,
      isResidential: input.isResidential ?? false,
      ...(input.directSignature === undefined ? {} : { directSignature: input.directSignature }),
      signatureOptIn: sig,
    });
    const common = {
      carrierKey: e.carrierKey, carrierName: e.carrierName, accountId: e.accountId,
      costCurrency: e.snap.costCurrency, displayCurrency: e.snap.displayCurrency,
      suspendedAt: e.suspendedAt ? e.suspendedAt.toISOString() : null,
      suspendReason: e.suspendReason ?? null,
    };
    if (q.ok) {
      const vndCost = toVnd(e.snap.costCurrency, e.snap.displayCurrency, q.breakdown.carrierCost, q.breakdown.carrierCostDisplay);
      return { ...common, ok: true, carrierCostDisplay: q.breakdown.carrierCostDisplay, vndCost, breakdown: q.breakdown, zone: q.zone, tierUpperKg: q.tier.upperKg, notes: q.notes };
    }
    return { ...common, ok: false, error: q.code };
  });
  return xepTheoCuoc(rows);
}

/** Xếp: hãng báo giá được lên trước, rồi cước tăng dần. Tách ra vì áp giá live xong phải xếp lại. */
export function xepTheoCuoc(rows: CarrierQuoteRow[]): CarrierQuoteRow[] {
  return [...rows].sort((x, y) => (x.ok ? 0 : 1) - (y.ok ? 0 : 1)
    || (x.vndCost ?? Infinity) - (y.vndCost ?? Infinity));
}

export interface GiaLive {
  vndCost: number; displayCost: number;
  dichVu: string; zone: string | null; notes: string[];
}

/**
 * THUẦN: thay số của những account có giá LIVE, rồi xếp lại.
 *
 * Account có `loi` thì GIỮ số bảng giá và gắn nhãn cảnh báo (CEO chốt 12/10/2026) — bảng so
 * cước luôn có một con số để so, nhưng người đọc phải thấy nó là số bảng.
 *
 * Account không nằm trong `live` thì không đụng tới, và KHÔNG gắn `nguonGia`: hãng đó không có
 * đường live nên bảng giá là nguồn duy nhất, nói ra chỉ thêm nhiễu.
 */
export function apDungGiaLive(
  rows: CarrierQuoteRow[],
  live: ReadonlyMap<string, GiaLive | { loi: string }>,
): CarrierQuoteRow[] {
  return xepTheoCuoc(rows.map((r) => {
    const g = live.get(r.accountId);
    if (!g) return r;
    if ('loi' in g) {
      return { ...r, nguonGia: 'bang' as const, canhBaoGia: `giá bảng, có thể lệch — không gọi được giá live (${g.loi})` };
    }
    return {
      ...r, ok: true as const, error: undefined,
      nguonGia: 'live' as const, dichVu: g.dichVu,
      vndCost: g.vndCost, carrierCostDisplay: g.displayCost,
      zone: g.zone ?? r.zone, notes: [...(r.notes ?? []), ...g.notes],
    };
  }));
}

/** %VAT đang hiệu lực của account — cùng cách engine cộng (`vat_percent`, đúng cửa sổ ngày). */
function phanTramVat(snap: CarrierAccountSnapshot, ngay: Date): number {
  return snap.surcharges
    .filter((x) => isApplicable(x, ngay) && x.kind === 'vat_percent')
    .reduce((a, x) => a + x.value, 0);
}

/** Bộ nhớ đệm giá live — một tuyến/cân/kích thước hỏi lại trong 10 phút thì dùng lại. */
const CACHE_LIVE_MS = 10 * 60 * 1000;
const cacheLive = new Map<string, { gia: GiaLive | { loi: string }; luc: number }>();

/**
 * Giá LIVE của UPS cho một đơn. Trả `{ loi }` khi không hỏi được — chỗ gọi rơi về bảng giá.
 *
 * Vì sao chỉ UPS: bảng giá UPS sai ở 4 tuyến vì số zone của UPS không phải bảng nước→zone
 * thuần (xem `lib/ups/rate.ts`). FedEx/DHL/Aramex đo trên cùng 56 nước thì bảng khớp, nên
 * chưa cần gọi mạng cho chúng.
 */
async function giaLiveUps(
  snap: CarrierAccountSnapshot, input: OrderCarrierQuoteInput, ngay: Date,
): Promise<GiaLive | { loi: string }> {
  const soTaiKhoan = process.env.UPS_ACCOUNT_NUMBER;
  if (!soTaiKhoan) return { loi: 'chưa khai UPS_ACCOUNT_NUMBER' };
  const kt = input.dimensions
    ? { dai: input.dimensions.lengthCm, rong: input.dimensions.widthCm, cao: input.dimensions.heightCm }
    : null;
  const khoa = JSON.stringify([
    snap.id, input.country, input.postcode ?? '', input.city ?? '', input.weightKg, kt,
    input.isResidential ?? false, input.directSignature !== false,
  ]);
  const hit = cacheLive.get(khoa);
  if (hit && Date.now() - hit.luc < CACHE_LIVE_MS) return hit.gia;

  const r = await baoGiaUpsShop({
    soTaiKhoan, nuocDen: input.country, maBuuChinh: input.postcode, thanhPho: input.city,
    canKg: input.weightKg, kichThuocCm: kt,
    nhaDan: input.isResidential ?? false, kyNhan: input.directSignature !== false,
  });
  let gia: GiaLive | { loi: string };
  if (!r.ok) {
    gia = { loi: r.loi };
  } else {
    const re = chonMucReNhat(r.ds);
    if (!re) {
      gia = { loi: 'ups_khong_co_muc_nao' };
    } else {
      // UPS trả tiền CHƯA VAT (hoá đơn tính 8% trên tổng chịu thuế — xem D-234); engine thì
      // tính VAT vào `carrierCost`, nên phải cộng vào mới so được cùng thước với FedEx/DHL.
      const vat = phanTramVat(snap, ngay);
      /* UPS trả tiền CHƯA VAT ở MỌI mức. Quy cả danh sách về CÙNG thước (đã VAT) trước khi
       * hiện: bản đầu in mức đã chọn kèm VAT nhưng các mức khác chưa VAT, nên ghi chú đọc ra
       * như thể mức rẻ hơn đã bị bỏ qua (AU: chọn 1.614.929 mà note ghi còn mức 1.560.870). */
      const coVat = (x: number) => Math.round(x * (1 + vat / 100));
      const vnd = coVat(re.tong);
      gia = {
        vndCost: vnd,
        displayCost: Math.round((vnd / snap.fxCostPerDisplay) * 100) / 100,
        dichVu: re.tenDichVu, zone: re.zone,
        notes: [
          `giá live UPS · ${re.tenDichVu}${vat > 0 ? ` · đã gồm VAT ${vat}%` : ''}`,
          `nền ${Math.round(re.base).toLocaleString('vi-VN')}đ`
            + re.khoan.map((k) => ` · ${k.phu ? k.phu : tenKhoanUps(k.ma)} ${Math.round(k.tien).toLocaleString('vi-VN')}đ`).join(''),
          r.ds.length > 1
            ? `mức khác (đã gồm VAT): ${r.ds.filter((d) => d !== re).sort((a, b) => a.tong - b.tong).map((d) => `${d.tenDichVu} ${coVat(d.tong).toLocaleString('vi-VN')}đ`).join(' · ')}`
            : 'UPS chỉ có một mức cho tuyến này',
        ],
      };
    }
  }
  cacheLive.set(khoa, { gia, luc: Date.now() });
  return gia;
}

/** Load mọi carrier account đang bật + snapshot rồi rank. */
export async function quoteOrderAcrossCarriers(input: OrderCarrierQuoteInput): Promise<CarrierQuoteRow[]> {
  const accounts = await db
    .select({
      id: schema.carrierAccounts.id, name: schema.carrierAccounts.name, carrierKey: schema.carriers.key,
      suspendedAt: schema.carrierAccounts.suspendedAt, suspendReason: schema.carrierAccounts.suspendReason,
    })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.enabled, true));

  const entries: AccountSnap[] = [];
  for (const a of accounts) {
    const snap = await loadAccountSnapshot(a.id, new Date(), {
      remoteCountry: input.country,
      remotePostcodes: [input.postcode],
    });
    if (snap) entries.push({ carrierKey: a.carrierKey ?? '?', carrierName: a.name, accountId: a.id, snap, suspendedAt: a.suspendedAt, suspendReason: a.suspendReason });
  }
  const rows = rankCarrierQuotes(entries, input);

  /* Giá live cho UPS. Chạy sau khi xếp theo bảng giá rồi THAY SỐ và xếp lại — làm vậy để khi
   * UPS không trả lời thì bảng vẫn còn nguyên thứ tự cũ, không trống một hãng. */
  const ups = entries.filter((e) => e.carrierKey === 'ups');
  if (ups.length === 0) return rows;
  const ngay = input.effectiveDate ?? new Date();
  const live = new Map<string, GiaLive | { loi: string }>();
  await Promise.all(ups.map(async (e) => {
    try { live.set(e.accountId, await giaLiveUps(e.snap, input, ngay)); }
    catch (err) {
      console.error('[compare] giá live UPS hỏng:', err);
      live.set(e.accountId, { loi: err instanceof Error ? err.message : String(err) });
    }
  }));
  return apDungGiaLive(rows, live);
}
