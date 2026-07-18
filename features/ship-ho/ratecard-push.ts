/**
 * PUSH rate card mới sang MMP khi loại đối tác (tier/strategic) đổi — MMP nhận
 * event `ratecard.updated` (data = payload y hệt endpoint pull /ratecard) và cập
 * nhật bảng giá hiển thị cho brand NGAY, khỏi chờ nhịp pull.
 *
 * Best-effort (không outbox — outbox hiện gắn với đơn): fail chỉ log; MMP vẫn còn
 * kênh pull chủ động như cũ (D-014).
 */
import { signMmpPayload } from '@/features/mmp/hmac';
import { buildBrandRateCardPayload } from './mmp-ratecard';

export async function pushBrandRateCardToMmp(brandSlug: string): Promise<{ ok: boolean; detail: string }> {
  const url = process.env.MMP_SHIP_HO_WEBHOOK_URL;
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!url || !secret) return { ok: false, detail: 'chưa cấu hình MMP webhook' };

  const built = await buildBrandRateCardPayload(brandSlug);
  if (!built.ok) return { ok: false, detail: `không dựng được ratecard (${built.code})` };

  // mmpRef = brandSlug (KHÔNG null): validator MMP bắt buộc mmpRef là chuỗi —
  // null bị 422 "bad envelope" (probe 17/07). Phần còn lại chờ MMP thêm nhánh
  // xử lý event cấp brand (hiện mọi event bị route vào lookup đơn → 409).
  const envelope = {
    event: 'ratecard.updated',
    mmpRef: brandSlug,
    code: brandSlug,
    occurredAt: new Date().toISOString(),
    data: built.ratecard,
  };
  const rawBody = JSON.stringify(envelope);
  const ts = Math.floor(Date.now() / 1000);
  const signature = signMmpPayload(secret, ts, rawBody);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mean-signature': signature, 'x-mean-timestamp': String(ts) },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok
      ? { ok: true, detail: `đã push version ${built.ratecard.version} (tier ${built.ratecard.tierName})` }
      : { ok: false, detail: `MMP trả http ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'fetch failed' };
  }
}
