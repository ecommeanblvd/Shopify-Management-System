import { describe, it, expect } from 'vitest';
import { nextInternalCode, internalCodePrefix, planCodeAdoption } from './internal-code';

describe('nextInternalCode', () => {
  const now = new Date('2026-07-20T12:00:00Z');
  it('chưa có mã năm nay → 0001', () => {
    expect(nextInternalCode(now, null)).toBe('26-INSMS-SV-0001');
  });
  it('tăng từ mã lớn nhất, pad 4 số', () => {
    expect(nextInternalCode(now, '26-INSMS-SV-0009')).toBe('26-INSMS-SV-0010');
    expect(nextInternalCode(now, '26-INSMS-SV-0999')).toBe('26-INSMS-SV-1000');
  });
  it('mã năm cũ không tính (reset theo năm)', () => {
    expect(nextInternalCode(now, '25-INSMS-SV-0500')).toBe('26-INSMS-SV-0001');
  });
  it('prefix INSMS khác INSLG của MMP — không đụng khoá', () => {
    expect(internalCodePrefix(now)).toBe('26-INSMS-SV-');
    expect(internalCodePrefix(now)).not.toContain('INSLG');
  });
});

describe('planCodeAdoption', () => {
  it('mã cũ (reference khách) chuyển vào customerRef trống; code+mmpRef = mã MMP', () => {
    expect(planCodeAdoption({ code: '#KLS1996', customerRef: null }, '26-INSLG-SV-0013')).toEqual({
      code: '26-INSLG-SV-0013', mmpRef: '26-INSLG-SV-0013', customerRef: '#KLS1996',
    });
  });
  it('customerRef đã có → giữ nguyên, không ghi đè', () => {
    expect(planCodeAdoption({ code: '26-INSMS-SV-0001', customerRef: '#KLS2001' }, '26-INSLG-SV-0014'))
      .toEqual({ code: '26-INSLG-SV-0014', mmpRef: '26-INSLG-SV-0014', customerRef: '#KLS2001' });
  });
  it('response không có code / trùng code hiện tại / rỗng → null', () => {
    expect(planCodeAdoption({ code: 'A', customerRef: null }, undefined)).toBeNull();
    expect(planCodeAdoption({ code: 'A', customerRef: null }, '  ')).toBeNull();
    expect(planCodeAdoption({ code: 'A', customerRef: null }, 'A')).toBeNull();
  });
});
