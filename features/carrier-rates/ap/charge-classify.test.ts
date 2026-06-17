import { describe, it, expect } from 'vitest';
import { classifyCharge, feeColumnRank } from './charge-classify';

describe('classifyCharge', () => {
  it('ẩn thuế & duty nhập khẩu', () => {
    for (const l of ['DUTY TAX PAID', 'IMPORT EXPORT DUTIES', 'IMPORT EXPORT TAXES',
      'ADDITIONAL DUTY', 'IMPORT PENALTY', 'REGULATORY CHARGES']) {
      expect(classifyCharge(l)).toBe('hide');
    }
  });

  it('giữ cột cước lõi + phụ phí có nghĩa', () => {
    for (const l of ['Weight charge', 'FUEL SURCHARGE', 'GOGREEN PLUS - CARBON REDUCED',
      'DIRECT SIGNATURE', 'DEMAND SURCHARGE', 'REMOTE AREA DELIVERY',
      'ADDRESS CORRECTION', 'ELEVATED RISK']) {
      expect(classifyCharge(l)).toBe('keep');
    }
  });

  it('gộp các khoản hiếm gặp vào "Khác"', () => {
    for (const l of ['NON-CONVEYABLE PIECE - IRREGULAR', 'NON CONVEYABLE PIECE',
      'RESIDENTIAL ADDRESS', 'RESTRICTED DESTINATION', 'ADULT SIGNATURE']) {
      expect(classifyCharge(l)).toBe('other');
    }
  });

  it('ADULT SIGNATURE không bị nhầm thành DIRECT SIGNATURE', () => {
    expect(classifyCharge('ADULT SIGNATURE')).toBe('other');
    expect(classifyCharge('DIRECT SIGNATURE')).toBe('keep');
  });

  it('feeColumnRank xếp Weight trước Fuel trước phần còn lại', () => {
    expect(feeColumnRank('Weight charge')).toBeLessThan(feeColumnRank('FUEL SURCHARGE'));
    expect(feeColumnRank('FUEL SURCHARGE')).toBeLessThan(feeColumnRank('DEMAND SURCHARGE'));
    expect(feeColumnRank('Khác')).toBe(50);
  });
});
