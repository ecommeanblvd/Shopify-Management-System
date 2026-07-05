import { describe, it, expect } from 'vitest';
import { sanitizeConfig, DEFAULT_CONFIG, MODULE_KEYS } from './config-schema';

describe('sanitizeConfig', () => {
  it('null/garbage → DEFAULT_CONFIG (2 module đủ thứ tự)', () => {
    expect(sanitizeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(sanitizeConfig('x')).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.modules.map((m) => m.key)).toEqual([...MODULE_KEYS]);
  });
  it('lọc module key lạ + dedup, giữ thứ tự hợp lệ', () => {
    const r = sanitizeConfig({ branding: {}, modules: [
      { key: 'tracking', enabled: true }, { key: 'hack', enabled: true },
      { key: 'tracking', enabled: false }, { key: 'wishlist', enabled: false },
    ] });
    expect(r.modules.map((m) => m.key)).toEqual(['tracking', 'wishlist']);
  });
  it('branding giữ field hợp lệ, bỏ field lạ', () => {
    const r = sanitizeConfig({ branding: { supportEmail: 'a@b.c', evil: 1 }, modules: [] });
    expect(r.branding).toEqual({ supportEmail: 'a@b.c' });
  });
});
