import { describe, it, expect } from 'vitest';
import { NGUON_HANG, laNguonHang } from './nguon-hang';

describe('laNguonHang', () => {
  it('năm nguồn hãng đúng spec §3.2', () => {
    expect([...NGUON_HANG].sort()).toEqual(['carrier_bill', 'dhl', 'fedex', 'trackingmore', 'ups']);
    for (const n of NGUON_HANG) expect(laNguonHang(n)).toBe(true);
  });
  it('lark / null / lạ → không phải hãng', () => {
    expect(laNguonHang('lark')).toBe(false);
    expect(laNguonHang(null)).toBe(false);
    expect(laNguonHang(undefined)).toBe(false);
    expect(laNguonHang('manual')).toBe(false);
  });
});
