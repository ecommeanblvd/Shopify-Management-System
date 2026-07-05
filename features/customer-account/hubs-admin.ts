import { asc } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { HubRow } from './hubs-shared';

export type { HubRow } from './hubs-shared';

/**
 * Server-only DB reads for the return hubs admin page. This module imports
 * `@/db/client`, so it must ONLY be imported by server components/pages —
 * never by a client component. The mutating actions live in
 * `hubs-actions.ts` and client-safe types in `hubs-shared.ts`.
 */

/** Đọc mọi hub (kể cả inactive), sắp xếp theo label. Dùng lại ở Task 8 khi duyệt đổi/trả. */
export async function listHubs(): Promise<HubRow[]> {
  return db.select({
    id: schema.returnHubs.id,
    label: schema.returnHubs.label,
    recipientName: schema.returnHubs.recipientName,
    addressLine1: schema.returnHubs.addressLine1,
    addressLine2: schema.returnHubs.addressLine2,
    city: schema.returnHubs.city,
    state: schema.returnHubs.state,
    postalCode: schema.returnHubs.postalCode,
    country: schema.returnHubs.country,
    phone: schema.returnHubs.phone,
    active: schema.returnHubs.active,
  }).from(schema.returnHubs)
    .orderBy(asc(schema.returnHubs.label));
}
