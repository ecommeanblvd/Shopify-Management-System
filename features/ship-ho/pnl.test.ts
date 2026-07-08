import { describe, it, expect } from 'vitest';
import { displayCarrierCost, displayCharged, displayMargin } from './pnl';

describe('displayCarrierCost', () => {
  it('ưu tiên cước thực khi đã đối soát', () => {
    expect(displayCarrierCost(1_800_000, 1_950_000)).toEqual({ vnd: 1_950_000, actual: true });
  });
  it('dùng dự tính khi chưa có thực tế', () => {
    expect(displayCarrierCost(1_800_000, null)).toEqual({ vnd: 1_800_000, actual: false });
  });
  it('null khi chưa có cước nào (draft chưa snapshot)', () => {
    expect(displayCarrierCost(null, null)).toEqual({ vnd: null, actual: false });
  });
});

describe('displayCharged', () => {
  it('ưu tiên giá thu thực (re-bill) khi có', () => {
    expect(displayCharged(2_012_941, 2_150_000)).toEqual({ vnd: 2_150_000, actual: true });
  });
  it('dùng quote khi chưa re-bill', () => {
    expect(displayCharged(2_012_941, null)).toEqual({ vnd: 2_012_941, actual: false });
  });
});

describe('displayMargin', () => {
  it('margin dự tính = quote thu − quote cước (chưa đối soát)', () => {
    expect(displayMargin(2_012_941, null, 1_800_000, null)).toEqual({ vnd: 212_941, estimated: true });
  });
  it('margin thực = giá thu thực − cước thực (đã đối soát)', () => {
    // re-bill cân thực: thu 2.150.000, cước bill 1.950.000 → 200.000
    expect(displayMargin(2_012_941, 2_150_000, 1_800_000, 1_950_000)).toEqual({ vnd: 200_000, estimated: false });
  });
  it('đối soát cước nhưng thiếu giá thu thực → dùng quote cho vế thu, vẫn actual', () => {
    expect(displayMargin(2_012_941, null, 1_800_000, 1_950_000)).toEqual({ vnd: 62_941, estimated: false });
  });
  it('margin âm khi cước thực vượt giá thu', () => {
    expect(displayMargin(2_000_000, 2_000_000, 1_800_000, 2_100_000)).toEqual({ vnd: -100_000, estimated: false });
  });
  it('null khi thiếu giá thu', () => {
    expect(displayMargin(null, null, 1_800_000, null)).toEqual({ vnd: null, estimated: true });
  });
  it('null khi chưa có cước nào', () => {
    expect(displayMargin(2_012_941, null, null, null)).toEqual({ vnd: null, estimated: true });
  });
});
