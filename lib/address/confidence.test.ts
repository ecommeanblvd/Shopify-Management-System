import { describe, expect, it } from 'vitest';
import { CONFIDENCE_MAP } from './confidence';

describe('CONFIDENCE_MAP', () => {
  it('có đủ 4 mức addr_confidence', () => {
    expect(Object.keys(CONFIDENCE_MAP).sort()).toEqual(
      ['census_verified', 'undeliverable', 'verified', 'zip_only'],
    );
  });

  it('chỉ undeliverable bật viền đỏ', () => {
    expect(CONFIDENCE_MAP.undeliverable.border).toBe(true);
    expect(CONFIDENCE_MAP.verified.border).toBe(false);
    expect(CONFIDENCE_MAP.census_verified.border).toBe(false);
    expect(CONFIDENCE_MAP.zip_only.border).toBe(false);
  });

  it('mọi mức có nhãn + class màu', () => {
    for (const b of Object.values(CONFIDENCE_MAP)) {
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.cls).toContain('bg-');
    }
  });
});
