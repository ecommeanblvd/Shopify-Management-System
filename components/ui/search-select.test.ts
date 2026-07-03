import { describe, it, expect } from 'vitest';
import { filterOptions, type SelectOption } from './search-select';

const OPTS: SelectOption[] = [
  { value: 'US', label: 'United States (US)' },
  { value: 'GB', label: 'United Kingdom (GB)' },
  { value: 'AE', label: 'United Arab Emirates (AE)' },
  { value: 'VN', label: 'Việt Nam (VN)' },
];

describe('filterOptions', () => {
  it('query rỗng → trả toàn bộ', () => {
    expect(filterOptions(OPTS, '')).toEqual(OPTS);
    expect(filterOptions(OPTS, '   ')).toEqual(OPTS);
  });
  it('lọc substring, không phân biệt hoa thường', () => {
    const r = filterOptions(OPTS, 'united');
    expect(r.map((o) => o.value)).toEqual(['US', 'GB', 'AE']);
  });
  it('prefix match ưu tiên trước substring', () => {
    // 'viet' chỉ khớp VN; 'v' prefix VN nhưng cũng substring trong không cái nào khác
    expect(filterOptions(OPTS, 'viet').map((o) => o.value)).toEqual(['VN']);
  });
  it('ưu tiên prefix: query "un" → tất cả United* (prefix) trước', () => {
    const r = filterOptions(OPTS, 'un');
    expect(r.map((o) => o.value)).toEqual(['US', 'GB', 'AE']);
  });
  it('không khớp → rỗng', () => {
    expect(filterOptions(OPTS, 'zzz')).toEqual([]);
  });
});
