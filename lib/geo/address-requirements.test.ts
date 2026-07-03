import { describe, it, expect } from 'vitest';
import { validateAddressExtra, requirementFor, ADDRESS_EXTRA } from './address-requirements';

describe('ADDRESS_EXTRA map', () => {
  it('SA cần short-address-hoặc-maps, không cần house number', () => {
    expect(ADDRESS_EXTRA.SA).toEqual({ shortAddressOrMaps: true });
  });
  it('5 nước GCC còn lại cần house number', () => {
    for (const iso of ['AE', 'QA', 'KW', 'BH', 'OM']) {
      expect(ADDRESS_EXTRA[iso]).toEqual({ houseNumber: true });
    }
  });
  it('requirementFor không phân biệt hoa/thường + khoảng trắng', () => {
    expect(requirementFor(' sa ')).toEqual({ shortAddressOrMaps: true });
    expect(requirementFor('US')).toBeUndefined();
  });
});

describe('validateAddressExtra — Saudi Arabia', () => {
  it('chỉ short address hợp lệ → ok, uppercase', () => {
    const r = validateAddressExtra('SA', { shortAddress: 'rbma4176' });
    expect(r.ok).toBe(true);
    expect(r.normalized.shortAddress).toBe('RBMA4176');
  });
  it('short address sai format → lỗi', () => {
    const r = validateAddressExtra('SA', { shortAddress: 'RB4176' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Short Address/i);
  });
  it('chỉ maps url hợp lệ → ok', () => {
    const r = validateAddressExtra('SA', { mapsUrl: 'https://maps.app.goo.gl/abc' });
    expect(r.ok).toBe(true);
    expect(r.normalized.mapsUrl).toBe('https://maps.app.goo.gl/abc');
  });
  it('maps url không phải http(s) → lỗi', () => {
    const r = validateAddressExtra('SA', { mapsUrl: 'javascript:alert(1)' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Maps|URL/i);
  });
  it('cả hai rỗng → lỗi bắt buộc ít nhất 1', () => {
    const r = validateAddressExtra('SA', {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ít nhất/i);
  });
});

describe('validateAddressExtra — GCC house number', () => {
  it('thiếu house number → lỗi', () => {
    const r = validateAddressExtra('AE', { houseNumber: '   ' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/House Number/i);
  });
  it('có house number → ok, trim', () => {
    const r = validateAddressExtra('QA', { houseNumber: '  12B ' });
    expect(r.ok).toBe(true);
    expect(r.normalized.houseNumber).toBe('12B');
  });
});

describe('validateAddressExtra — ngoài phạm vi', () => {
  it('US luôn ok, không kèm field extra', () => {
    const r = validateAddressExtra('US', { houseNumber: 'x', shortAddress: 'y', mapsUrl: 'z' });
    expect(r.ok).toBe(true);
    expect(r.normalized).toEqual({});
  });
});
