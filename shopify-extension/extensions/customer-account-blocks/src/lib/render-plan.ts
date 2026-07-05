export type ModuleKey = 'profile' | 'credit' | 'tracking' | 'wishlist' | 'returns';

export interface ConfigModule {
  key: ModuleKey;
  title: string | null;
  iconUrl: string | null;
}

export interface AccountConfig {
  enabled: boolean;
  branding: {
    logoUrl: string | null;
    heroUrl: string | null;
    supportEmail: string | null;
    announcement: string | null;
  };
  modules: ConfigModule[];
}

/**
 * enabled=false → []; else return modules in the exact order the backend sends
 * (backend already filters to enabled modules).
 */
export function renderPlan(config: AccountConfig): ConfigModule[] {
  return config.enabled ? config.modules : [];
}

/** Fallback EN titles when config.title is null. */
export const DEFAULT_TITLES: Record<ModuleKey, string> = {
  profile: 'Profile',
  credit: 'Store credit & tier',
  tracking: 'Order tracking',
  wishlist: 'Wishlist',
  returns: 'Returns',
};
