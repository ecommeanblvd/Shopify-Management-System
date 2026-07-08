import { describe, it, expect } from 'vitest';
import { displayCarrierCost, displayMargin } from './pnl';

describe('displayCarrierCost', () => {
  it('ưu tiên cước thực tế khi đã đối soát', () => {
    expect(displayCarrierCost(1_800_000, 1_950_000)).toEqual({ vnd: 1_950_000, actual: true });
  });
  it('dùng dự tính khi chưa có thực tế', () => {
    expect(displayCarrierCost(1_800_000, null)).toEqual({ vnd: 1_800_000, actual: false });
  });
  it('null khi chưa có cước nào (draft chưa snapshot)', () => {
    expect(displayCarrierCost(null, null)).toEqual({ vnd: null, actual: false });
  });
});

describe('displayMargin', () => {
  it('margin dự tính = charged − cước dự tính (chưa đối soát)', () => {
    // Giá thu 2.012.941 − cước gốc dự tính 1.800.000 = 212.941
    expect(displayMargin(2_012_941, 1_800_000, null)).toEqual({ vnd: 212_941, estimated: true });
  });
  it('margin thực tế = charged − cước thực tế (đã đối soát) → estimated=false', () => {
    expect(displayMargin(2_012_941, 1_800_000, 1_950_000)).toEqual({ vnd: 62_941, estimated: false });
  });
  it('margin âm khi cước thực tế vượt giá thu', () => {
    expect(displayMargin(2_000_000, 1_800_000, 2_100_000)).toEqual({ vnd: -100_000, estimated: false });
  });
  it('null khi thiếu giá thu', () => {
    expect(displayMargin(null, 1_800_000, null)).toEqual({ vnd: null, estimated: true });
  });
  it('null khi có giá thu nhưng chưa có cước nào', () => {
    expect(displayMargin(2_012_941, null, null)).toEqual({ vnd: null, estimated: true });
  });
});
