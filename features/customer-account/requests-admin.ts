import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getSignedDownloadUrl } from '@/lib/storage/s3';
import type { AdminRequestRow } from './requests-shared';

export type { AdminRequestRow } from './requests-shared';
export { REQUEST_STATUSES, REQUEST_KINDS } from './requests-shared';

/**
 * Server-only DB reads for the order-journey requests admin queue. This module
 * imports `@/db/client`, so it must ONLY be imported by server components/pages
 * — never by a client component. The mutating actions live in
 * `requests-actions.ts` and client-safe constants/types in `requests-shared.ts`.
 */

/** Đọc queue cancel/claim cho admin: join tên store + label hub, mới nhất trước.
 *  Ảnh claim (photoKeys) được ký thành URL tạm (5 phút) — bỏ qua từng key lỗi. */
export async function listAdminRequests(
  filter: { storeId?: string; kind?: string; status?: string } = {},
): Promise<AdminRequestRow[]> {
  const conds = [];
  if (filter.storeId) conds.push(eq(schema.customerOrderRequests.storeId, filter.storeId));
  if (filter.kind) conds.push(eq(schema.customerOrderRequests.kind, filter.kind));
  if (filter.status) conds.push(eq(schema.customerOrderRequests.status, filter.status));

  const rows = await db.select({
    id: schema.customerOrderRequests.id,
    storeName: schema.stores.name,
    orderNumber: schema.customerOrderRequests.orderNumber,
    kind: schema.customerOrderRequests.kind,
    status: schema.customerOrderRequests.status,
    shopifyCustomerId: schema.customerOrderRequests.shopifyCustomerId,
    reasonCodes: schema.customerOrderRequests.reasonCodes,
    description: schema.customerOrderRequests.description,
    photoKeys: schema.customerOrderRequests.photoKeys,
    fault: schema.customerOrderRequests.fault,
    returnHubId: schema.customerOrderRequests.returnHubId,
    returnHubLabel: schema.returnHubs.label,
    returnShippingPayer: schema.customerOrderRequests.returnShippingPayer,
    returnTrackingNumber: schema.customerOrderRequests.returnTrackingNumber,
    returnCarrier: schema.customerOrderRequests.returnCarrier,
    refundAmount: schema.customerOrderRequests.refundAmount,
    currency: schema.customerOrderRequests.currency,
    refundPercent: schema.customerOrderRequests.refundPercent,
    adminNote: schema.customerOrderRequests.adminNote,
    rejectedReason: schema.customerOrderRequests.rejectedReason,
    createdAt: schema.customerOrderRequests.createdAt,
  }).from(schema.customerOrderRequests)
    .innerJoin(schema.stores, eq(schema.customerOrderRequests.storeId, schema.stores.id))
    .leftJoin(schema.returnHubs, eq(schema.customerOrderRequests.returnHubId, schema.returnHubs.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.customerOrderRequests.createdAt));

  return Promise.all(rows.map(async (r) => {
    const photoUrls: string[] = [];
    for (const key of r.photoKeys ?? []) {
      try {
        photoUrls.push(await getSignedDownloadUrl(key));
      } catch {
        // bỏ qua key lỗi (file bị xóa, storage tạm thời lỗi, v.v.)
      }
    }
    return { ...r, photoUrls };
  }));
}
