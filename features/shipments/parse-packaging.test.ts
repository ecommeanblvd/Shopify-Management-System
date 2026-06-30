import { describe, it, expect } from 'vitest';
import { parsePackagingType, inferPackagingFromDims } from './parse-packaging';

describe('parsePackagingType', () => {
  it('returns null for blank / nullish input', () => {
    expect(parsePackagingType(null)).toBeNull();
    expect(parsePackagingType(undefined)).toBeNull();
    expect(parsePackagingType('')).toBeNull();
  });

  it("detects BOX from real operator inventory codes", () => {
    expect(parsePackagingType('MEAN-BOX-42x30x10-CAR-02-VTĐG1-WH-25611')).toBe('box');
    expect(parsePackagingType('mean_box_40x31x2_VTDG1')).toBe('box');
    expect(parsePackagingType('Stock BOX 32x23x16')).toBe('box');
  });

  it('detects PAK as bag (operator spec: PAK → PAK rate / bag)', () => {
    expect(parsePackagingType('MEAN-PAK-VTĐG1-WH-25611')).toBe('bag');
    expect(parsePackagingType('mean_pak_envelope_v2')).toBe('bag');
  });

  it('detects BAG explicitly', () => {
    expect(parsePackagingType('MEAN-BAG-soft-pouch-2025')).toBe('bag');
    expect(parsePackagingType('bag-poly-mailer-28x40')).toBe('bag');
  });

  it('BOX wins when both BOX and BAG appear (rigid always Package)', () => {
    // Defensive: ops code that namedrops both should bill as Package.
    expect(parsePackagingType('BOX-with-inner-bag-liner')).toBe('box');
  });

  it('returns null when no packaging keyword matches', () => {
    expect(parsePackagingType('MEAN-CUSTOM-25611')).toBeNull();
    expect(parsePackagingType('PACKAGING-V2')).toBeNull();
    expect(parsePackagingType('some random code')).toBeNull();
  });

  it('does NOT match keyword fragments (must be word-bounded)', () => {
    // "BOXING" should NOT trigger 'box'. Word-boundary regex enforces this.
    expect(parsePackagingType('BOXING-CHAMP-CODE')).toBeNull();
    // "PAKISTAN" should NOT trigger 'bag'.
    expect(parsePackagingType('PAKISTAN-RELABEL-V2')).toBeNull();
  });
});

describe('inferPackagingFromDims', () => {
  it('2 chiều (không có cao) → bag (Pak)', () => {
    expect(inferPackagingFromDims(38, 52, null)).toBe('bag');
    expect(inferPackagingFromDims(28, 42, 0)).toBe('bag');
  });
  it('3 chiều có độ dày đáng kể → box', () => {
    expect(inferPackagingFromDims(42, 30, 10)).toBe('box');
    expect(inferPackagingFromDims(40, 25, 25)).toBe('box');
    expect(inferPackagingFromDims(30, 25, 9)).toBe('box');
  });
  it('3 chiều nhưng MỎNG (≤4cm) → bag (bao dẹp, vd 43x20x2)', () => {
    expect(inferPackagingFromDims(43, 20, 2)).toBe('bag');
    expect(inferPackagingFromDims(40, 30, 2)).toBe('bag');
    // chiều mỏng ở vị trí khác (thứ tự nhập tuỳ ý) vẫn ra bag
    expect(inferPackagingFromDims(2, 43, 20)).toBe('bag');
    expect(inferPackagingFromDims(43, 2, 20)).toBe('bag');
  });
  it('thiếu L hoặc W → null (để engine fallback theo cân)', () => {
    expect(inferPackagingFromDims(null, 52, null)).toBeNull();
    expect(inferPackagingFromDims(38, 0, 10)).toBeNull();
    expect(inferPackagingFromDims(null, null, null)).toBeNull();
  });
});
