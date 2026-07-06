import { describe, it, expect } from 'vitest';
import { mergeCompareCountries, CHEAP_LINE_COUNTRIES } from './top-countries';

describe('mergeCompareCountries', () => {
  it('loại nước trong exclude dù orders cao nhất', () => {
    const grouped = [
      { code: 'VN', orders: 1000 },
      { code: 'US', orders: 50 },
    ];
    const result = mergeCompareCountries(grouped, { limit: 12, exclude: ['VN'], forceInclude: [] });
    expect(result.some((r) => r.code === 'VN')).toBe(false);
    expect(result.map((r) => r.code)).toEqual(['US']);
  });

  it('forceInclude nước KHÔNG có trong grouped → thêm với orders=0', () => {
    const grouped = [{ code: 'US', orders: 50 }];
    const result = mergeCompareCountries(grouped, { limit: 12, exclude: [], forceInclude: ['TH'] });
    const th = result.find((r) => r.code === 'TH');
    expect(th).toEqual({ code: 'TH', orders: 0 });
  });

  it('forceInclude nước ĐÃ trong top → không nhân đôi, giữ orders thật', () => {
    const grouped = [
      { code: 'US', orders: 50 },
      { code: 'TH', orders: 30 },
    ];
    const result = mergeCompareCountries(grouped, { limit: 12, exclude: [], forceInclude: ['TH'] });
    const thEntries = result.filter((r) => r.code === 'TH');
    expect(thEntries).toHaveLength(1);
    expect(thEntries[0]).toEqual({ code: 'TH', orders: 30 });
  });

  it('forceInclude nước có trong grouped nhưng ngoài top limit → thêm với orders thật', () => {
    const grouped = [
      { code: 'US', orders: 100 },
      { code: 'GB', orders: 90 },
      { code: 'TH', orders: 5 }, // ngoài top limit=2
    ];
    const result = mergeCompareCountries(grouped, { limit: 2, exclude: [], forceInclude: ['TH'] });
    expect(result.map((r) => r.code)).toEqual(['US', 'GB', 'TH']);
    expect(result.find((r) => r.code === 'TH')).toEqual({ code: 'TH', orders: 5 });
  });

  it('respect limit cho phần top; forceInclude thêm NGOÀI limit', () => {
    const grouped = [
      { code: 'US', orders: 100 },
      { code: 'GB', orders: 90 },
      { code: 'DE', orders: 80 },
    ];
    const result = mergeCompareCountries(grouped, { limit: 2, exclude: [], forceInclude: ['JP'] });
    expect(result.map((r) => r.code)).toEqual(['US', 'GB', 'JP']);
    expect(result.find((r) => r.code === 'DE')).toBeUndefined();
  });

  it('exclude thắng forceInclude nếu 1 nước ở cả hai', () => {
    const grouped = [{ code: 'US', orders: 100 }];
    const result = mergeCompareCountries(grouped, { limit: 12, exclude: ['TH'], forceInclude: ['TH'] });
    expect(result.some((r) => r.code === 'TH')).toBe(false);
  });

  it('kịch bản thật: bỏ VN + luôn kèm cụm nước line rẻ', () => {
    const grouped = [
      { code: 'VN', orders: 5000 },
      { code: 'US', orders: 200 },
      { code: 'AU', orders: 150 },
      { code: 'JP', orders: 10 },
    ];
    const result = mergeCompareCountries(grouped, {
      limit: 12,
      exclude: ['VN'],
      forceInclude: CHEAP_LINE_COUNTRIES,
    });
    expect(result.some((r) => r.code === 'VN')).toBe(false);
    for (const code of CHEAP_LINE_COUNTRIES) {
      expect(result.some((r) => r.code === code)).toBe(true);
    }
    expect(result.find((r) => r.code === 'JP')).toEqual({ code: 'JP', orders: 10 });
    expect(result.find((r) => r.code === 'TH')).toEqual({ code: 'TH', orders: 0 });
  });
});
