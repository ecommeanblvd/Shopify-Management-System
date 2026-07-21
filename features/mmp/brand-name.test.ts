import { describe, it, expect } from 'vitest';
import { normalizeBrandDisplayName } from './brand-name';

describe('normalizeBrandDisplayName', () => {
  it('viết hoa toàn bộ → chỉ chữ đầu mỗi từ', () => {
    expect(normalizeBrandDisplayName('TOM FRIED')).toBe('Tom Fried');
    expect(normalizeBrandDisplayName('LEKIEU')).toBe('Lekieu');
    expect(normalizeBrandDisplayName('BEL ANGE')).toBe('Bel Ange');
    expect(normalizeBrandDisplayName('BELOVED')).toBe('Beloved');
  });
  it('unicode: À TOUS → À Tous; giữ nguyên tên đã chuẩn', () => {
    expect(normalizeBrandDisplayName('À TOUS')).toBe('À Tous');
    expect(normalizeBrandDisplayName('Angeletta')).toBe('Angeletta');
    expect(normalizeBrandDisplayName('Bong Design House')).toBe('Bong Design House');
  });
  it('từ bắt đầu bằng số: viết hoa chữ CÁI đầu tiên (21SIX → 21Six)', () => {
    expect(normalizeBrandDisplayName('21SIX')).toBe('21Six');
    expect(normalizeBrandDisplayName('21six')).toBe('21Six');
  });
  it('trim + gộp khoảng trắng thừa', () => {
    expect(normalizeBrandDisplayName('  TINH   ATELIER ')).toBe('Tinh Atelier');
  });
});
