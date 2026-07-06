import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/** MMP→SMS: nhận đăng ký. Dedupe 1 pending/brand. Trả ref. (Endpoint tự verify HMAC + auth; hàm này KHÔNG requireManage.) */
export async function createPartnerRequest(
  body: { brandSlug: string; contactName?: string; contactEmail?: string; contactPhone?: string; [k: string]: unknown },
): Promise<{ ok: true; ref: string } | { ok: false; code: string; error: string }> {
  if (!body.brandSlug) return { ok: false, code: 'bad_input', error: 'brandSlug required' };
  const [dup] = await db.select({ id: schema.shipHoPartnerRequests.id }).from(schema.shipHoPartnerRequests)
    .where(and(eq(schema.shipHoPartnerRequests.brandSlug, body.brandSlug), eq(schema.shipHoPartnerRequests.status, 'pending'))).limit(1);
  if (dup) return { ok: true, ref: dup.id };
  const [row] = await db.insert(schema.shipHoPartnerRequests).values({
    brandSlug: body.brandSlug,
    contactName: (body.contactName as string) || null,
    contactEmail: (body.contactEmail as string) || null,
    contactPhone: (body.contactPhone as string) || null,
    payload: body,
  }).returning({ id: schema.shipHoPartnerRequests.id });
  return { ok: true, ref: row.id };
}
