import { describe, it, expect } from 'vitest';
import { displayCarrierCost, displayCharged, displayMargin, displayChargedWithDuty, displayMarginWithDuty } from './pnl';

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

describe('displayChargedWithDuty', () => {
  // 3 đơn thực tế (26-INSLG-SV-0107 / 0111 / 0128) — duty tách khỏi cước từ 21/09/2026,
  // actualCarrierCostVnd gồm cả duty (số thật trả FedEx) còn actualChargedVnd chỉ có cước.
  it('0107: gộp cước thu thực + duty = tổng thu đúng', () => {
    expect(displayChargedWithDuty(null, 1_977_886, 825_278)).toEqual({
      vnd: 2_803_164, actual: true, dutyVnd: 825_278,
    });
  });
  it('0111: gộp cước thu thực + duty = tổng thu đúng', () => {
    expect(displayChargedWithDuty(null, 1_764_318, 1_193_506)).toEqual({
      vnd: 2_957_824, actual: true, dutyVnd: 1_193_506,
    });
  });
  it('0128: gộp cước thu thực + duty = tổng thu đúng', () => {
    expect(displayChargedWithDuty(null, 2_362_059, 1_387_049)).toEqual({
      vnd: 3_749_108, actual: true, dutyVnd: 1_387_049,
    });
  });
  it('0113: đơn không có duty → không có dòng phụ, giá thu = cước thực', () => {
    expect(displayChargedWithDuty(null, 1_977_895, null)).toEqual({
      vnd: 1_977_895, actual: true, dutyVnd: null,
    });
  });
  it('đơn chưa đối soát (chỉ có quote) → bỏ qua duty dù có sẵn', () => {
    expect(displayChargedWithDuty(2_012_941, null, 500_000)).toEqual({
      vnd: 2_012_941, actual: false, dutyVnd: null,
    });
  });
  it('có duty nhưng chưa có giá thu thực lẫn quote → null, không gộp duty', () => {
    expect(displayChargedWithDuty(null, null, 500_000)).toEqual({
      vnd: null, actual: false, dutyVnd: null,
    });
  });
});

describe('displayMarginWithDuty', () => {
  it('0107: margin gộp duty khớp margin_vnd đã lưu (170.361)', () => {
    expect(displayMarginWithDuty(null, 1_977_886, 825_278, 1_800_000, 2_632_803)).toEqual({
      vnd: 170_361, estimated: false,
    });
  });
  it('0111: margin gộp duty khớp margin_vnd đã lưu (166.933)', () => {
    expect(displayMarginWithDuty(null, 1_764_318, 1_193_506, 1_800_000, 2_790_891)).toEqual({
      vnd: 166_933, estimated: false,
    });
  });
  it('0128: margin gộp duty khớp margin_vnd đã lưu (214.527)', () => {
    expect(displayMarginWithDuty(null, 2_362_059, 1_387_049, 1_800_000, 3_534_581)).toEqual({
      vnd: 214_527, estimated: false,
    });
  });
  it('0113: đơn không có duty → margin y như displayMargin cũ (166.934)', () => {
    expect(displayMarginWithDuty(null, 1_977_895, null, 1_800_000, 1_810_961)).toEqual({
      vnd: 166_934, estimated: false,
    });
  });
  it('đơn chưa đối soát → duty bị bỏ qua, margin dự tính như cũ', () => {
    expect(displayMarginWithDuty(2_012_941, null, 500_000, 1_800_000, null)).toEqual({
      vnd: 212_941, estimated: true,
    });
  });
  it('có duty nhưng thiếu giá thu thực → duty không được gộp (dùng quote cho vế thu)', () => {
    expect(displayMarginWithDuty(2_012_941, null, 500_000, 1_800_000, 1_950_000)).toEqual({
      vnd: 62_941, estimated: false,
    });
  });
});
