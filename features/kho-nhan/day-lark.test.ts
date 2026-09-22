import { describe, it, expect } from 'vitest';
import { laDry } from './day-lark';

describe('laDry', () => {
  it('chỉ bật chế độ thử khi env đúng chữ dry', () => {
    expect(laDry('dry')).toBe(true);
    expect(laDry('DRY')).toBe(true);
    expect(laDry('1')).toBe(false);
    expect(laDry(undefined)).toBe(false);
    expect(laDry('')).toBe(false);
  });
});
