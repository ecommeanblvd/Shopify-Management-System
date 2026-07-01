import { describe, expect, it } from 'vitest';
import { orderContentFingerprint, detectEdit, type FingerprintInput } from './order-fingerprint';

const baseInput: FingerprintInput = {
  shipName: 'Nguyen A', shipAddress1: '12 Le Loi', shipAddress2: null,
  shipCity: 'HCM', shipPostcode: '700000', shipCountry: 'VN',
  lines: [{ sku: 'AAA', quantity: 1 }, { sku: 'BBB', quantity: 2 }],
};

describe('orderContentFingerprint', () => {
  it('đổi thứ tự line → hash GIỐNG', () => {
    const a = orderContentFingerprint(baseInput);
    const b = orderContentFingerprint({ ...baseInput, lines: [{ sku: 'BBB', quantity: 2 }, { sku: 'AAA', quantity: 1 }] });
    expect(a).toBe(b);
  });
  it('đổi qty → hash KHÁC', () => {
    const b = orderContentFingerprint({ ...baseInput, lines: [{ sku: 'AAA', quantity: 3 }, { sku: 'BBB', quantity: 2 }] });
    expect(b).not.toBe(orderContentFingerprint(baseInput));
  });
  it('đổi địa chỉ → hash KHÁC', () => {
    expect(orderContentFingerprint({ ...baseInput, shipAddress1: '99 Nguyen Hue' })).not.toBe(orderContentFingerprint(baseInput));
  });
  it('chuẩn hoá hoa/thường + khoảng trắng địa chỉ → GIỐNG', () => {
    expect(orderContentFingerprint({ ...baseInput, shipCity: '  hcm  ' })).toBe(orderContentFingerprint(baseInput));
  });
  it('thêm line → hash KHÁC', () => {
    expect(orderContentFingerprint({ ...baseInput, lines: [...baseInput.lines, { sku: 'CCC', quantity: 1 }] })).not.toBe(orderContentFingerprint(baseInput));
  });
  it('hex sha256 (64 ký tự)', () => {
    expect(orderContentFingerprint(baseInput)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('detectEdit', () => {
  const now = new Date('2026-07-01T10:00:00Z');
  const old = new Date('2026-06-01T00:00:00Z');

  it('chưa baseline (prevFingerprint null) → không set cờ', () => {
    expect(detectEdit({ prevFingerprint: null, nextFingerprint: 'x', isFulfilled: true, now, prevEditedAt: null, prevEditedAfterFulfilledAt: null }))
      .toEqual({ editedAt: null, editedAfterFulfilledAt: null });
  });
  it('không đổi (prev==next) → giữ cờ cũ', () => {
    expect(detectEdit({ prevFingerprint: 'x', nextFingerprint: 'x', isFulfilled: true, now, prevEditedAt: old, prevEditedAfterFulfilledAt: null }))
      .toEqual({ editedAt: old, editedAfterFulfilledAt: null });
  });
  it('đổi, chưa fulfilled → chỉ editedAt', () => {
    expect(detectEdit({ prevFingerprint: 'x', nextFingerprint: 'y', isFulfilled: false, now, prevEditedAt: null, prevEditedAfterFulfilledAt: null }))
      .toEqual({ editedAt: now, editedAfterFulfilledAt: null });
  });
  it('đổi, đã fulfilled → cả hai cờ', () => {
    expect(detectEdit({ prevFingerprint: 'x', nextFingerprint: 'y', isFulfilled: true, now, prevEditedAt: null, prevEditedAfterFulfilledAt: null }))
      .toEqual({ editedAt: now, editedAfterFulfilledAt: now });
  });
  it('sửa lần sau lúc chưa fulfilled KHÔNG xoá cờ afterFulfilled cũ', () => {
    expect(detectEdit({ prevFingerprint: 'x', nextFingerprint: 'y', isFulfilled: false, now, prevEditedAt: old, prevEditedAfterFulfilledAt: old }))
      .toEqual({ editedAt: now, editedAfterFulfilledAt: old });
  });
});
