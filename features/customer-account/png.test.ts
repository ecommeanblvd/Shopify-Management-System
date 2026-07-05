import { describe, it, expect } from 'vitest';
import { isPngBytes } from './png';

describe('isPngBytes', () => {
  it('magic PNG đúng → true', () => {
    expect(isPngBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]))).toBe(true);
  });
  it('JPEG/rỗng/ngắn → false', () => {
    expect(isPngBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(isPngBytes(new Uint8Array([]))).toBe(false);
    expect(isPngBytes(new Uint8Array([0x89, 0x50]))).toBe(false);
  });
});
