/** THUẦN(ish): đọc config/asset per-store cho extension (data-path, có DB). */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { sanitizeConfig, type CustomerAccountConfig } from './config-schema';

const assetUrl = (id: string | undefined) => (id ? `/api/customer-account/assets/${id}` : null);

export async function getPublicConfig(storeId: string) {
  const [row] = await db.select().from(schema.customerAccountConfigs)
    .where(eq(schema.customerAccountConfigs.storeId, storeId)).limit(1);
  if (!row || !row.enabled) return { enabled: false as const, branding: {}, modules: [] };
  const cfg: CustomerAccountConfig = sanitizeConfig(row.config);
  return {
    enabled: true as const,
    branding: {
      logoUrl: assetUrl(cfg.branding.logoAssetId), heroUrl: assetUrl(cfg.branding.heroAssetId),
      supportEmail: cfg.branding.supportEmail ?? null, announcement: cfg.branding.announcement ?? null,
    },
    modules: cfg.modules.filter((m) => m.enabled).map((m) => ({
      key: m.key, title: m.title ?? null, iconUrl: assetUrl(m.iconAssetId),
    })),
  };
}

export async function getAsset(assetId: string) {
  const [row] = await db.select({ fileKey: schema.customerAccountAssets.fileKey, contentType: schema.customerAccountAssets.contentType })
    .from(schema.customerAccountAssets).where(eq(schema.customerAccountAssets.id, assetId)).limit(1);
  return row ?? null;
}
