/** Đọc dữ liệu cho admin UI Customer Account (stores/config/assets — có DB). */
import { asc, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { sanitizeConfig, DEFAULT_CONFIG, type CustomerAccountConfig } from './config-schema';

export async function listStoresBasic(): Promise<Array<{ id: string; name: string; shopDomain: string }>> {
  return db.select({
    id: schema.stores.id,
    name: schema.stores.name,
    shopDomain: schema.stores.shopDomain,
  }).from(schema.stores).orderBy(asc(schema.stores.name));
}

export async function getAdminConfig(storeId: string): Promise<{ enabled: boolean; config: CustomerAccountConfig }> {
  const [row] = await db.select({
    enabled: schema.customerAccountConfigs.enabled,
    config: schema.customerAccountConfigs.config,
  }).from(schema.customerAccountConfigs)
    .where(eq(schema.customerAccountConfigs.storeId, storeId)).limit(1);
  if (!row) return { enabled: false, config: DEFAULT_CONFIG };
  return { enabled: row.enabled, config: sanitizeConfig(row.config) };
}

export async function listAssets(storeId: string): Promise<Array<{ id: string; kind: string; filename: string }>> {
  return db.select({
    id: schema.customerAccountAssets.id,
    kind: schema.customerAccountAssets.kind,
    filename: schema.customerAccountAssets.filename,
  }).from(schema.customerAccountAssets)
    .where(eq(schema.customerAccountAssets.storeId, storeId))
    .orderBy(desc(schema.customerAccountAssets.createdAt));
}
