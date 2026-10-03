/**
 * Sự kiện cấp brand `statement.issued` / `statement.paid` — BẢN ĐỐI SOÁT cho MMP (phương án B,
 * CEO 21/09/2026): MMP so với bảng kê của mình theo (mã đơn, loại) và báo lệch, KHÔNG render cho
 * brand.
 *
 * TỪ 01/10/2026 ĐI QUA OUTBOX (`statement-outbox.ts`): trước đó hàm này POST thẳng và không ghi
 * một dòng nào, nên một lượt gửi hỏng là không ai còn cách nào biết — xem migration 0189.
 */
import { signMmpPayload } from '@/features/mmp/hmac';
import { THAN_TOI_DA } from './mmp-events';
import type { LoaiBangKe } from './statement-logic';
import type { KhoanPhiMmp } from './bang-ke-khoan-phi';

export interface DongBangKeMmp {
  code: string; mmpRef: string | null; brandReference: string | null; trackingNumber: string | null;
  /**
   * NGÀY HÀNG RỜI KHO, không phải ngày tạo nhãn (CEO 03/10/2026).
   *
   * Brand đối chiếu %xăng dầu theo tuần của ngày này, mà hai mốc lệch nhau tới 3 ngày
   * (AWB 873918787369: tạo nhãn 03/07, hãng lấy hàng 06/07).
   */
  shippedAt: string | null;
  /**
   * Con số `shippedAt` đến từ đâu: `hang` = mốc quét của hãng · `lark` = ngày đội logistics
   * điền. Aramex HN không có API tra cứu nên luôn là `lark` — ngoại lệ KHAI BÁO, để kế toán
   * MMP biết dòng nào có mốc hãng xác nhận và dòng nào không.
   */
  nguonNgayDi?: 'hang' | 'lark';
  amountVnd: number; fedexInvoiceNumber?: string | null; invoiceDate?: string | null;
  /**
   * KHOẢN PHÍ chi tiết (CEO 30/09/2026) — kế toán MMP trước nay chỉ có MỘT con số `amountVnd`
   * nên vẫn phải xin file tay của Đức. Cộng mọi `amountVnd` của `fees` ra đúng `amountVnd` của
   * đơn; có test canh và đã đo 137/137 đơn thật.
   *
   * CHỈ VẾ THU — không giá vốn, không lãi, đúng như file Đức.
   * Khoá bằng `code` (mã ổn định), KHÔNG bằng `label` (chữ hiển thị, đổi được).
   */
  fees?: KhoanPhiMmp[];
  carrier?: string | null; country?: string | null;
  weightKg?: number | null; chargeableWeightKg?: number | null; dimensions?: string | null;
}
export interface BangKeMmp { id: string; type: LoaiBangKe; periodStart: string; periodEnd: string; partnerBrandSlug: string }

export function payloadStatementIssued(st: BangKeMmp, dong: readonly DongBangKeMmp[]): Record<string, unknown> {
  const orders = dong.map((d) => ({
    code: d.code, mmpRef: d.mmpRef ?? d.code, brandReference: d.brandReference, trackingNumber: d.trackingNumber,
    shippedAt: d.shippedAt, amountVnd: Math.round(d.amountVnd),
    ...(d.fees ? { fees: d.fees } : {}),
    ...(d.carrier != null ? { carrier: d.carrier } : {}),
    ...(d.country != null ? { country: d.country } : {}),
    ...(d.weightKg != null ? { weightKg: d.weightKg } : {}),
    ...(d.chargeableWeightKg != null ? { chargeableWeightKg: d.chargeableWeightKg } : {}),
    ...(d.dimensions != null ? { dimensions: d.dimensions } : {}),
    ...(st.type === 'duty' ? { fedexInvoiceNumber: d.fedexInvoiceNumber ?? null, invoiceDate: d.invoiceDate ?? null } : {}),
  }));
  return {
    statementId: st.id, type: st.type, periodStart: st.periodStart, periodEnd: st.periodEnd,
    // Kỳ theo ngày lần push đầu tiên sang MMP (CEO 22/09/2026) — cả hai loại.
    periodBasis: 'first_push_at',
    orders, orderCount: orders.length, totalVnd: orders.reduce((s, o) => s + o.amountVnd, 0),
  };
}

/**
 * POST một sự kiện cấp bảng kê sang MMP. KHÔNG ghi sổ — việc ghi sổ là của
 * `statement-outbox.ts`; hàm này chỉ gửi và kể lại đầy đủ những gì nhận được.
 *
 * `occurredAtIso` do NGƯỜI GỌI truyền, không lấy `new Date()` tại đây: mốc phải GIỮ NGUYÊN qua
 * mọi lần gửi lại, nếu không thì mỗi lượt thử lại là một `occurredAt` khác và MMP thấy hai ảnh
 * chụp khác nhau của cùng một bảng kê — đúng cái câu chặn "đã phát hành, không gửi lại" sinh ra
 * để tránh. Bản cũ lấy `new Date()` ngay trong hàm nên không gửi lại được mà vẫn an toàn.
 *
 * Trả kèm `status` + `than` (thân phản hồi, cắt 500 ký tự) để outbox ghi được LÝ DO, không chỉ
 * ghi "có lỗi" — bài học D-177: mã HTTP nói có lỗi, thân phản hồi nói lỗi gì.
 */
export async function pushStatementEvent(
  event: 'statement.issued' | 'statement.paid', brandSlug: string, data: Record<string, unknown>,
  occurredAtIso: string = new Date().toISOString(),
): Promise<{ ok: boolean; detail: string; status?: number; than?: string }> {
  const url = process.env.MMP_SHIP_HO_WEBHOOK_URL; const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!url || !secret) return { ok: false, detail: 'chưa cấu hình MMP webhook' };
  const rawBody = JSON.stringify({ event, mmpRef: brandSlug, code: brandSlug, origin: 'sms', occurredAt: occurredAtIso, data });
  const ts = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mean-signature': signMmpPayload(secret, ts, rawBody), 'x-mean-timestamp': String(ts) }, body: rawBody, signal: AbortSignal.timeout(10_000) });
    // Đọc thân TRƯỚC khi quyết: MMP viết rõ lý do ngay trong body khi từ chối.
    const than = (await res.text().catch(() => '')).slice(0, THAN_TOI_DA);
    return res.ok
      ? { ok: true, detail: `http ${res.status}`, status: res.status, than }
      : { ok: false, detail: than ? `MMP trả http ${res.status} · ${than}` : `MMP trả http ${res.status}`, status: res.status, than };
  } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : 'fetch failed' }; }
}

/**
 * Payload `statement.issued` cho bảng kê loại `adjustment` (CEO 01/10/2026; MMP đã đồng ý nhận
 * `adjustsStatementId`).
 *
 * `amountVnd` của mỗi dòng là **DELTA**, không phải số tuyệt đối — để `totalVnd` cộng ra đúng
 * số phải thu thêm (dương) hoặc trả lại brand (âm), dùng chung phép cộng với bảng kê thường.
 * Kèm `previousVnd`/`currentVnd`/`adjustmentKind` để brand và MMP đối chiếu được TỪNG dòng:
 * một đơn giảm 100k khác hẳn một đơn bị bỏ hẳn 100k, dù delta bằng nhau.
 *
 * `adjustsStatementId` là thứ giúp MMP biết dòng này SỬA kỳ nào, thay vì coi nó là khoản phát
 * sinh mới của kỳ đang mở — đó là cả lý do trường này tồn tại.
 */
export function payloadStatementAdjustment(
  st: { id: string; periodStart: string; periodEnd: string; partnerBrandSlug: string },
  adjustsStatementId: string,
  dong: readonly { code: string; loai: string; truoc: number; sau: number; delta: number }[],
): Record<string, unknown> {
  const orders = dong.map((d) => ({
    code: d.code, mmpRef: d.code, amountVnd: Math.round(d.delta),
    adjustmentKind: d.loai, previousVnd: Math.round(d.truoc), currentVnd: Math.round(d.sau),
  }));
  return {
    statementId: st.id, type: 'adjustment',
    periodStart: st.periodStart, periodEnd: st.periodEnd,
    adjustsStatementId,
    periodBasis: 'first_push_at',
    orders, orderCount: orders.length, totalVnd: orders.reduce((s, o) => s + o.amountVnd, 0),
  };
}

