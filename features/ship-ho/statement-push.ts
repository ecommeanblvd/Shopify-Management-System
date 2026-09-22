/**
 * Sự kiện cấp brand `statement.issued` / `statement.paid` — BẢN ĐỐI SOÁT cho MMP (phương án B,
 * CEO 21/09/2026): MMP so với bảng kê của mình theo (mã đơn, loại) và báo lệch, KHÔNG render cho
 * brand. Không qua outbox (outbox gắn đơn) — best-effort như ratecard-push; kết quả ghi log.
 */
import { signMmpPayload } from '@/features/mmp/hmac';
import type { LoaiBangKe } from './statement-logic';

export interface DongBangKeMmp {
  code: string; mmpRef: string | null; brandReference: string | null; trackingNumber: string | null;
  shippedAt: string | null; amountVnd: number; fedexInvoiceNumber?: string | null; invoiceDate?: string | null;
}
export interface BangKeMmp { id: string; type: LoaiBangKe; periodStart: string; periodEnd: string; partnerBrandSlug: string }

export function payloadStatementIssued(st: BangKeMmp, dong: readonly DongBangKeMmp[]): Record<string, unknown> {
  const orders = dong.map((d) => ({
    code: d.code, mmpRef: d.mmpRef ?? d.code, brandReference: d.brandReference, trackingNumber: d.trackingNumber,
    shippedAt: d.shippedAt, amountVnd: Math.round(d.amountVnd),
    ...(st.type === 'duty' ? { fedexInvoiceNumber: d.fedexInvoiceNumber ?? null, invoiceDate: d.invoiceDate ?? null } : {}),
  }));
  return {
    statementId: st.id, type: st.type, periodStart: st.periodStart, periodEnd: st.periodEnd,
    // Kỳ theo ngày lần push đầu tiên sang MMP (CEO 22/09/2026) — cả hai loại.
    periodBasis: 'first_push_at',
    orders, orderCount: orders.length, totalVnd: orders.reduce((s, o) => s + o.amountVnd, 0),
  };
}

export async function pushStatementEvent(event: 'statement.issued' | 'statement.paid', brandSlug: string, data: Record<string, unknown>): Promise<{ ok: boolean; detail: string }> {
  const url = process.env.MMP_SHIP_HO_WEBHOOK_URL; const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!url || !secret) return { ok: false, detail: 'chưa cấu hình MMP webhook' };
  const rawBody = JSON.stringify({ event, mmpRef: brandSlug, code: brandSlug, origin: 'sms', occurredAt: new Date().toISOString(), data });
  const ts = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mean-signature': signMmpPayload(secret, ts, rawBody), 'x-mean-timestamp': String(ts) }, body: rawBody, signal: AbortSignal.timeout(10_000) });
    return res.ok ? { ok: true, detail: `http ${res.status}` } : { ok: false, detail: `MMP trả http ${res.status}` };
  } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : 'fetch failed' }; }
}
