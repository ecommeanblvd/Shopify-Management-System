'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { signMmpPayload } from '@/features/mmp/hmac';
import { markupFloorError } from './partners-markup';
import { requireManageShipHo } from './require-manage';
import { buildPartnerCallbackEnvelope } from './partner-request-envelope';

/** Best-effort gửi callback; cập nhật callback_sent_at/error. Không throw. */
async function sendPartnerCallback(reqRow: { id: string; brandSlug: string }, event: string, note: string | null): Promise<void> {
  try {
    const url = process.env.MMP_SHIP_HO_WEBHOOK_URL;
    const secret = process.env.MMP_OUTBOUND_SECRET;
    const envelope = buildPartnerCallbackEnvelope(reqRow, event, note, new Date().toISOString());
    if (!url || !secret) {
      await db.update(schema.shipHoPartnerRequests).set({ callbackError: 'not configured' }).where(eq(schema.shipHoPartnerRequests.id, reqRow.id));
      return;
    }
    const rawBody = JSON.stringify(envelope);
    const ts = Math.floor(Date.now() / 1000);
    const signature = signMmpPayload(secret, ts, rawBody);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-mean-signature': signature, 'x-mean-timestamp': String(ts) }, body: rawBody, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`http ${res.status}`);
      await db.update(schema.shipHoPartnerRequests).set({ callbackSentAt: new Date(), callbackError: null }).where(eq(schema.shipHoPartnerRequests.id, reqRow.id));
    } catch (e) {
      await db.update(schema.shipHoPartnerRequests).set({ callbackError: e instanceof Error ? e.message : 'fetch failed' }).where(eq(schema.shipHoPartnerRequests.id, reqRow.id));
    }
  } catch (e) {
    console.warn('sendPartnerCallback failed:', e);
  }
}

/** MEAN duyệt: markup ≥30, upsert partner self_service_enabled=true, set approved, callback. */
export async function approvePartnerRequest(id: string, markupPercent: string, note?: string): Promise<{ ok: boolean; error?: string }> {
  let reviewer: string;
  try { reviewer = await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const floorErr = markupFloorError(markupPercent);
  if (floorErr) return { ok: false, error: floorErr };
  const [req] = await db.select().from(schema.shipHoPartnerRequests).where(eq(schema.shipHoPartnerRequests.id, id)).limit(1);
  if (!req) return { ok: false, error: 'Không tìm thấy request' };

  const [existing] = await db.select({ id: schema.shipHoPartners.id }).from(schema.shipHoPartners).where(eq(schema.shipHoPartners.brandSlug, req.brandSlug)).limit(1);
  if (existing) {
    await db.update(schema.shipHoPartners).set({ markupPercent, status: 'active', selfServiceEnabled: true }).where(eq(schema.shipHoPartners.brandSlug, req.brandSlug));
  } else {
    await db.insert(schema.shipHoPartners).values({ brandSlug: req.brandSlug, markupPercent, selfServiceEnabled: true, status: 'active' });
  }
  await db.update(schema.shipHoPartnerRequests).set({ status: 'approved', reviewedBy: reviewer, reviewedAt: new Date(), reviewNote: note || null }).where(eq(schema.shipHoPartnerRequests.id, id));
  await sendPartnerCallback({ id: req.id, brandSlug: req.brandSlug }, 'partner.request.approved', note || null);
  revalidatePath('/f/ship-ho/partner-requests');
  return { ok: true };
}

/** MEAN từ chối. */
export async function rejectPartnerRequest(id: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  let reviewer: string;
  try { reviewer = await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const [req] = await db.select().from(schema.shipHoPartnerRequests).where(eq(schema.shipHoPartnerRequests.id, id)).limit(1);
  if (!req) return { ok: false, error: 'Không tìm thấy request' };
  await db.update(schema.shipHoPartnerRequests).set({ status: 'rejected', reviewedBy: reviewer, reviewedAt: new Date(), reviewNote: reason }).where(eq(schema.shipHoPartnerRequests.id, id));
  await sendPartnerCallback({ id: req.id, brandSlug: req.brandSlug }, 'partner.request.rejected', reason);
  revalidatePath('/f/ship-ho/partner-requests');
  return { ok: true };
}

/** Gửi lại callback (khi lỗi). Dùng trạng thái hiện tại của request. */
export async function resendPartnerCallback(id: string): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const [req] = await db.select().from(schema.shipHoPartnerRequests).where(eq(schema.shipHoPartnerRequests.id, id)).limit(1);
  if (!req) return { ok: false, error: 'Không tìm thấy request' };
  if (req.status === 'pending') return { ok: false, error: 'Request chưa duyệt/từ chối' };
  const event = req.status === 'approved' ? 'partner.request.approved' : 'partner.request.rejected';
  await sendPartnerCallback({ id: req.id, brandSlug: req.brandSlug }, event, req.reviewNote ?? null);
  revalidatePath('/f/ship-ho/partner-requests');
  return { ok: true };
}
