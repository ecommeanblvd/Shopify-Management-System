'use server';

import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';

export interface MarketCarrierLink {
  id: string;
  marketHandle: string;
  carrierAccountId: string;
  serviceLabel: string;
  position: number;
  enabled: boolean;
  // Joined for display
  carrierAccountName: string;
  carrierKey: string | null;
  costCurrency: string;
  displayCurrency: string;
}

/** List every link configured for a given market, ordered by position. */
export async function listLinksForMarket(marketHandle: string): Promise<MarketCarrierLink[]> {
  return db
    .select({
      id: schema.marketCarrierLinks.id,
      marketHandle: schema.marketCarrierLinks.marketHandle,
      carrierAccountId: schema.marketCarrierLinks.carrierAccountId,
      serviceLabel: schema.marketCarrierLinks.serviceLabel,
      position: schema.marketCarrierLinks.position,
      enabled: schema.marketCarrierLinks.enabled,
      carrierAccountName: schema.carrierAccounts.name,
      carrierKey: schema.carriers.key,
      costCurrency: schema.carrierAccounts.costCurrency,
      displayCurrency: schema.carrierAccounts.displayCurrency,
    })
    .from(schema.marketCarrierLinks)
    .innerJoin(
      schema.carrierAccounts,
      eq(schema.carrierAccounts.id, schema.marketCarrierLinks.carrierAccountId),
    )
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.marketCarrierLinks.marketHandle, marketHandle))
    .orderBy(asc(schema.marketCarrierLinks.position));
}

/** Reverse lookup — every market this carrier_account currently serves. */
export async function listMarketsForCarrier(carrierAccountId: string): Promise<MarketCarrierLink[]> {
  return db
    .select({
      id: schema.marketCarrierLinks.id,
      marketHandle: schema.marketCarrierLinks.marketHandle,
      carrierAccountId: schema.marketCarrierLinks.carrierAccountId,
      serviceLabel: schema.marketCarrierLinks.serviceLabel,
      position: schema.marketCarrierLinks.position,
      enabled: schema.marketCarrierLinks.enabled,
      carrierAccountName: schema.carrierAccounts.name,
      carrierKey: schema.carriers.key,
      costCurrency: schema.carrierAccounts.costCurrency,
      displayCurrency: schema.carrierAccounts.displayCurrency,
    })
    .from(schema.marketCarrierLinks)
    .innerJoin(
      schema.carrierAccounts,
      eq(schema.carrierAccounts.id, schema.marketCarrierLinks.carrierAccountId),
    )
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.marketCarrierLinks.carrierAccountId, carrierAccountId))
    .orderBy(asc(schema.marketCarrierLinks.marketHandle));
}

export interface CreateLinkInput {
  marketHandle: string;
  carrierAccountId: string;
  serviceLabel: string;
}

/*
 * `createLink`, `updateLink`, `deleteLink` tự gác `manage_carrier_rates` trong thân hàm. Tới
 * 25/10/2026 cả ba KHÔNG kiểm quyền; ba action nội tuyến của trang gọi chúng
 * (`app/(dashboard)/f/markets/[handle]/page.tsx:62`, `:75`, `:85`) có kiểm, nhưng đó chỉ là
 * một đường vào — tệp này là `'use server'` nên mỗi export tự nó là một endpoint POST.
 *
 * Cổng quyền phải nằm TRONG THÂN HÀM, không ở `page.tsx`. Mỗi export của tệp `'use server'` là
 * một endpoint POST; thân trang chỉ chạy lúc RENDER nên một POST thẳng không kích hoạt nó, và
 * cổng duy nhất của dashboard (`app/(dashboard)/layout.tsx:10-11`) cũng là render. Nên mọi
 * phiên đăng nhập gọi được, kể cả 3 tài khoản vai `viewer`.
 *
 * Hậu quả: `market_carrier_links` quyết định account carrier nào phục vụ market nào. Đó là
 * nguồn mà `commitPushPlan` (`push/commit.ts`) và route carrier-service dùng để chọn bảng giá
 * hiển thị cho khách; link thêm/xoá/tắt là đổi tập carrier và giá ship ở checkout của market.
 *
 * Khoá `manage_carrier_rates` là ĐÚNG khoá mà trang đang dùng cho nhóm link
 * (`markets/[handle]/page.tsx:67`, `:80`, `:90`) — nhóm link ở trang đó KHÔNG dùng
 * `manage_markets_template` như phần xoá template (`:57`), nên không đổi mức ở đây.
 *
 * `userId` thôi là THAM SỐ (`createLink`, `updateLink`): trước đây người gọi tự khai nên có
 * thể đổ tên người khác vào `updated_by`; giờ lấy từ `requirePerm`.
 *
 * Ba hàm ĐỌC (`listLinksForMarket`, `listMarketsForCarrier`, `listLinkableCarrierAccounts`) cố
 * ý KHÔNG gác.
 */
export async function createLink(input: CreateLinkInput): Promise<string> {
  const userId = await requirePerm('manage_carrier_rates');
  const label = input.serviceLabel.trim();
  if (!label) throw new Error('Service label is required.');

  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${schema.marketCarrierLinks.position}), -1) + 1` })
    .from(schema.marketCarrierLinks)
    .where(eq(schema.marketCarrierLinks.marketHandle, input.marketHandle));

  try {
    const [row] = await db
      .insert(schema.marketCarrierLinks)
      .values({
        marketHandle: input.marketHandle,
        carrierAccountId: input.carrierAccountId,
        serviceLabel: label,
        position: next,
        updatedBy: userId,
      })
      .returning({ id: schema.marketCarrierLinks.id });
    return row!.id;
  } catch (err) {
    // Friendly message for the uniqueIndex collision
    if (err instanceof Error && /unique/i.test(err.message)) {
      throw new Error('This carrier account is already linked to this market.');
    }
    throw err;
  }
}

export async function deleteLink(id: string): Promise<void> {
  await requirePerm('manage_carrier_rates');
  await db.delete(schema.marketCarrierLinks).where(eq(schema.marketCarrierLinks.id, id));
}

export interface UpdateLinkInput {
  id: string;
  serviceLabel?: string;
  enabled?: boolean;
}

export async function updateLink(input: UpdateLinkInput): Promise<void> {
  const userId = await requirePerm('manage_carrier_rates');
  const patch: Partial<typeof schema.marketCarrierLinks.$inferInsert> = {
    updatedBy: userId,
    updatedAt: new Date(),
  };
  if (input.serviceLabel !== undefined) {
    const label = input.serviceLabel.trim();
    if (!label) throw new Error('Service label cannot be empty.');
    patch.serviceLabel = label;
  }
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  await db
    .update(schema.marketCarrierLinks)
    .set(patch)
    .where(eq(schema.marketCarrierLinks.id, input.id));
}

/** Carrier accounts available to link from the market UI. */
export async function listLinkableCarrierAccounts(): Promise<{
  id: string;
  name: string;
  carrierKey: string | null;
}[]> {
  return db
    .select({
      id: schema.carrierAccounts.id,
      name: schema.carrierAccounts.name,
      carrierKey: schema.carriers.key,
    })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.enabled, true))
    .orderBy(asc(schema.carrierAccounts.name));
}
