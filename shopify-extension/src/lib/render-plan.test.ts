import { describe, it, expect } from 'vitest';
import { renderPlan, DEFAULT_TITLES, type AccountConfig } from './render-plan';
const cfg = (over: Partial<AccountConfig> = {}): AccountConfig => ({
  enabled: true, branding: { logoUrl: null, heroUrl: null, supportEmail: null, announcement: null },
  modules: [{ key: 'tracking', title: null, iconUrl: null }, { key: 'wishlist', title: 'Saved', iconUrl: null }], ...over,
});
describe('renderPlan', () => {
  it('enabled=false → rỗng', () => { expect(renderPlan(cfg({ enabled: false }))).toEqual([]); });
  it('giữ đúng thứ tự module backend trả', () => {
    expect(renderPlan(cfg()).map((m) => m.key)).toEqual(['tracking', 'wishlist']);
  });
  it('DEFAULT_TITLES đủ 5 key', () => {
    for (const k of ['profile', 'credit', 'tracking', 'wishlist', 'returns'] as const) expect(DEFAULT_TITLES[k].length).toBeGreaterThan(0);
  });
});
