import { describe, it, expect } from 'vitest';
import { markupFloorError } from './partners-markup';
import { MIN_MARKUP_PERCENT } from './offer-pricing';

describe('markupFloorError', () => {
  it('undefined (update không đổi markup) → null', () => {
    expect(markupFloorError(undefined)).toBeNull();
  });
  it('< 30 → có lỗi', () => {
    expect(markupFloorError('29.9')).toMatch(/30/);
  });
  it('= 30 → null', () => {
    expect(markupFloorError(String(MIN_MARKUP_PERCENT))).toBeNull();
  });
  it('không phải số → có lỗi', () => {
    expect(markupFloorError('abc')).toMatch(/hợp lệ|30/);
  });
});
