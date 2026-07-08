/** THUẦN(ish): đọc config/asset per-store cho extension (data-path, có DB). */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { sanitizeConfig, type CustomerAccountConfig } from './config-schema';

const assetUrl = (id: string | undefined) => (id ? `/api/customer-account/assets/${id}` : null);

export async function getPublicConfig(storeId: string) {
  const [row] = await db.select().from(schema.customerAccountConfigs)
    .where(eq(schema.customerAccountConfigs.storeId, storeId)).limit(1);
  if (!row || !row.enabled) return { enabled: false as const, branding: {}, modules: [] };
  const cfg: CustomerAccountConfig = sanitizeConfig(row.config);
  const modules = cfg.modules.filter((m) => m.enabled).map((m) => ({
    key: m.key as string, title: m.title ?? null, iconUrl: assetUrl(m.iconAssetId),
  }));

  // Style Quiz tách thành function riêng — bật/tắt qua store_function_settings.
  // Inject module 'quiz' cho extension khi function được bật cho store này.
  const [quiz] = await db.select({ enabled: schema.storeFunctionSettings.enabled })
    .from(schema.storeFunctionSettings)
    .where(and(
      eq(schema.storeFunctionSettings.storeId, storeId),
      eq(schema.storeFunctionSettings.functionKey, 'style-quiz'),
    )).limit(1);
  if (quiz?.enabled) modules.push({ key: 'quiz', title: 'Style Quiz', iconUrl: null });

  return {
    enabled: true as const,
    branding: {
      logoUrl: assetUrl(cfg.branding.logoAssetId), heroUrl: assetUrl(cfg.branding.heroAssetId),
      supportEmail: cfg.branding.supportEmail ?? null, announcement: cfg.branding.announcement ?? null,
    },
    modules,
  };
}

export async function getAsset(assetId: string) {
  const [row] = await db.select({ fileKey: schema.customerAccountAssets.fileKey, contentType: schema.customerAccountAssets.contentType })
    .from(schema.customerAccountAssets).where(eq(schema.customerAccountAssets.id, assetId)).limit(1);
  return row ?? null;
}
