import { describe, it, expect } from 'vitest';
import { parsePackagingType } from './parse-packaging';

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
