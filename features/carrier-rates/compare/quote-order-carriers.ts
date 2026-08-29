/**
 * Quote MỘT đơn hàng qua TẤT CẢ carrier đang bật → bảng so sánh để logistic
 * staff chọn carrier phù hợp nhất. Khác resolveShippingEstimate (chỉ quote
 * carrier khách đã trả) — đây liệt kê hết + xếp theo cước.
 *
 * So sánh theo `carrierCostDisplay` (cước gốc pre-markup, all-in fuel+VAT, ở
 * displayCurrency — tất cả account hiện để VND nên so trực tiếp được).
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote, type QuoteBreakdown, type CarrierAccountSnapshot } from '../engine/quote';
import { loadAccountSnapshot } from '../engine/load';

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
  /** Tạm ngưng CHỌN từ ngày này (ISO). null = chọn được. Vẫn báo giá. */
  suspendedAt?: string | null;
  suspendReason?: string | null;
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
      return { ...common, ok: true, carrierCostDisplay: q.breakdown.carrierCostDisplay, vndCost, breakdown: q.breakdown, zone: q.zone, tierUpperKg: q.tier.upperKg };
    }
    return { ...common, ok: false, error: q.code };
  });
  rows.sort((x, y) => (x.ok ? 0 : 1) - (y.ok ? 0 : 1)
    || (x.vndCost ?? Infinity) - (y.vndCost ?? Infinity));
  return rows;
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
  return rankCarrierQuotes(entries, input);
}
