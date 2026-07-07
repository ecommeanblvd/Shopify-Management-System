/** THUẦN: shape + sanitize config Customer Account (jsonb → typed). */
import { z } from 'zod';

export const MODULE_KEYS = ['tracking', 'wishlist', 'quiz'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

const brandingSchema = z.object({
  logoAssetId: z.string().optional(), heroAssetId: z.string().optional(),
  supportEmail: z.string().optional(), announcement: z.string().optional(),
}).strip();
const moduleSchema = z.object({
  key: z.enum(MODULE_KEYS), enabled: z.boolean(),
  title: z.string().optional(), iconAssetId: z.string().optional(),
}).strip();
const configSchema = z.object({ branding: brandingSchema.default({}), modules: z.array(z.unknown()).default([]) });

export interface CustomerAccountConfig {
  branding: z.infer<typeof brandingSchema>;
  modules: Array<z.infer<typeof moduleSchema>>;
}

export const DEFAULT_CONFIG: CustomerAccountConfig = {
  branding: {},
  modules: MODULE_KEYS.map((key) => ({ key, enabled: true })),
};

export function sanitizeConfig(raw: unknown): CustomerAccountConfig {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) return DEFAULT_CONFIG;
  const seen = new Set<string>();
  const modules: CustomerAccountConfig['modules'] = [];
  for (const m of parsed.data.modules) {
    const pm = moduleSchema.safeParse(m);
    if (!pm.success || seen.has(pm.data.key)) continue;
    seen.add(pm.data.key);
    modules.push(pm.data);
  }
  return { branding: parsed.data.branding, modules };
}
