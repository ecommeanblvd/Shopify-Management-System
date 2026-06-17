import { describe, it, expect } from 'vitest';
import { classifyCharge, chargeColumnLabel, feeColumnRank } from './charge-classify';

describe('classifyCharge', () => {
  it('ẩn thuế & duty nhập khẩu', () => {
    for (const l of ['DUTY TAX PAID', 'IMPORT EXPORT DUTIES', 'IMPORT EXPORT TAXES',
      'ADDITIONAL DUTY', 'IMPORT PENALTY', 'REGULATORY CHARGES']) {
      expect(classifyCharge(l)).toBe('hide');
    }
  });

  it('giữ cột cước lõi + phụ phí có nghĩa (gồm non-conveyable/restricted/residential)', () => {
    for (const l of ['Weight charge', 'FUEL SURCHARGE', 'GOGREEN PLUS - CARBON REDUCED',
      'DIRECT SIGNATURE', 'DEMAND SURCHARGE', 'REMOTE AREA DELIVERY',
      'ADDRESS CORRECTION', 'ELEVATED RISK',
      'NON-CONVEYABLE PIECE - IRREGULAR', 'NON CONVEYABLE PIECE',
      'NON-CONVEYABLE PIECE - WEIGHT', 'RESIDENTIAL ADDRESS', 'RESTRICTED DESTINATION']) {
      expect(classifyCharge(l)).toBe('keep');
    }
  });

  it('gộp các khoản hiếm gặp vào "Khác"', () => {
    for (const l of ['OVERSIZE PIECE', 'ADULT SIGNATURE']) {
      expect(classifyCharge(l)).toBe('other');
    }
  });

  it('"...- WEIGHT" của non-conveyable KHÔNG bị nhầm thành cước cân lõi', () => {
    expect(classifyCharge('NON-CONVEYABLE PIECE - WEIGHT')).toBe('keep'); // non-conveyable
    expect(classifyCharge('Weight charge')).toBe('keep'); // cước cân thật vẫn keep
  });

  it('ADULT SIGNATURE không bị nhầm thành DIRECT SIGNATURE', () => {
    expect(classifyCharge('ADULT SIGNATURE')).toBe('other');
    expect(classifyCharge('DIRECT SIGNATURE')).toBe('keep');
  });

  it('chargeColumnLabel gom biến thể non-conveyable/restricted/residential về 1 cột', () => {
    expect(chargeColumnLabel('NON-CONVEYABLE PIECE - IRREGULAR')).toBe('Non-Conveyable');
    expect(chargeColumnLabel('NON CONVEYABLE PIECE')).toBe('Non-Conveyable');
    expect(chargeColumnLabel('RESTRICTED DESTINATION')).toBe('Restricted');
    expect(chargeColumnLabel('RESIDENTIAL ADDRESS')).toBe('Residential');
    expect(chargeColumnLabel('FUEL SURCHARGE')).toBe('FUEL SURCHARGE'); // khác giữ nguyên
  });

  it('feeColumnRank xếp Weight trước Fuel trước phần còn lại', () => {
    expect(feeColumnRank('Weight charge')).toBeLessThan(feeColumnRank('FUEL SURCHARGE'));
    expect(feeColumnRank('FUEL SURCHARGE')).toBeLessThan(feeColumnRank('DEMAND SURCHARGE'));
    expect(feeColumnRank('Non-Conveyable')).toBeGreaterThan(feeColumnRank('ELEVATED RISK'));
    expect(feeColumnRank('Khác')).toBe(50);
  });
});
