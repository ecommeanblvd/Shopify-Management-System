/** I/O: đọc catalog store cho recommender + lưu kết quả quiz. */
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { CatalogProduct } from '../recommend';
import type { StyleProfile } from './profile';

export async function getStoreCatalogForQuiz(storeId: string): Promise<CatalogProduct[]> {
  const rows = await db
    .select({
      shopifyProductId: schema.shopifyProducts.shopifyProductId,
      title: schema.shopifyProducts.title,
      handle: schema.shopifyProducts.handle,
      vendor: schema.shopifyProducts.vendor,
      productType: schema.shopifyProducts.productType,
      tags: schema.shopifyProducts.tags,
      imageUrl: schema.shopifyProducts.imageUrl,
      priceMin: schema.shopifyProducts.priceMin,
      currency: schema.shopifyProducts.currency,
      availableForSale: schema.shopifyProducts.availableForSale,
      status: schema.shopifyProducts.status,
      syncedAt: schema.shopifyProducts.syncedAt,
    })
    .from(schema.shopifyProducts)
    .where(and(eq(schema.shopifyProducts.storeId, storeId), eq(schema.shopifyProducts.status, 'ACTIVE')));

  return rows.map((r) => ({
    shopifyProductId: r.shopifyProductId,
    title: r.title ?? '',
    handle: r.handle ?? '',
    vendor: r.vendor,
    productType: r.productType,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    imageUrl: r.imageUrl,
    priceMin: r.priceMin,
    currency: r.currency,
    availableForSale: r.availableForSale ?? false,
    status: r.status ?? 'ACTIVE',
    syncedAt: r.syncedAt ?? new Date(),
  }));
}

export interface SaveQuizInput {
  storeId?: string | null;
  customerId?: string | null;
  sessionKey: string;
  answers: unknown;
  profile: StyleProfile;
  levelReached: number;
}

export async function saveQuizResult(input: SaveQuizInput): Promise<string> {
  const [row] = await db.insert(schema.styleQuizResults).values({
    storeId: input.storeId ?? null,
    customerId: input.customerId ?? null,
    sessionKey: input.sessionKey,
    answers: input.answers as object,
    profile: input.profile as object,
    levelReached: input.levelReached,
  }).returning({ id: schema.styleQuizResults.id });
  return row!.id;
}

/** Kết quả gần nhất theo customer (dùng khi hiển thị lại profile đã lưu). */
export async function getLatestQuizResult(storeId: string, customerId: string) {
  const [row] = await db.select().from(schema.styleQuizResults)
    .where(and(eq(schema.styleQuizResults.storeId, storeId), eq(schema.styleQuizResults.customerId, customerId)))
    .orderBy(desc(schema.styleQuizResults.createdAt)).limit(1);
  return row ?? null;
}
