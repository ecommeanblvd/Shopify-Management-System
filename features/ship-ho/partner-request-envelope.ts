/** THUẦN: envelope callback partner-request SMS→MMP. Tách khỏi
 *  partner-request-actions.ts ('use server') vì file 'use server' chỉ được
 *  export async function — hàm này là sync. */
export function buildPartnerCallbackEnvelope(
  req: { brandSlug: string; id: string }, event: string, note: string | null, occurredAtIso: string,
) {
  return { event, brandSlug: req.brandSlug, ref: req.id, occurredAt: occurredAtIso, data: { note } };
}
