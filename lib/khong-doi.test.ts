import { describe, it, expect } from 'vitest';
import { coThayDoi, locViecGhi } from './khong-doi';

describe('coThayDoi', () => {
  it('chưa có dòng → phải ghi', () => {
    expect(coThayDoi(null, { trackingNumber: 'X' })).toBe(true);
  });

  it('mọi trường giống nhau → KHÔNG ghi', () => {
    expect(coThayDoi({ trackingNumber: 'X', carrierKey: 'fedex' }, { trackingNumber: 'X', carrierKey: 'fedex' })).toBe(false);
  });

  it('một trường khác → phải ghi', () => {
    expect(coThayDoi({ trackingNumber: 'X' }, { trackingNumber: 'Y' })).toBe(true);
  });

  it('updatedAt KHÔNG tính là thay đổi — nếu tính thì mọi dòng đều "đổi"', () => {
    expect(coThayDoi(
      { trackingNumber: 'X', updatedAt: new Date('2020-01-01') },
      { trackingNumber: 'X', updatedAt: new Date() },
    )).toBe(false);
  });

  it('numeric của Postgres "1.600" bằng "1.6" ta dựng — không được coi là đổi', () => {
    expect(coThayDoi({ actualWeightKg: '1.600' }, { actualWeightKg: '1.6' })).toBe(false);
    expect(coThayDoi({ dimLengthCm: '30.000' }, { dimLengthCm: '30' })).toBe(false);
  });

  it('cân đổi thật thì vẫn bắt được', () => {
    expect(coThayDoi({ actualWeightKg: '1.600' }, { actualWeightKg: '1.7' })).toBe(true);
  });

  it('ngày so theo thời điểm, không so cách viết', () => {
    expect(coThayDoi({ labelCreatedAt: '2026-05-14T00:00:00.000Z' }, { labelCreatedAt: new Date('2026-05-14T00:00:00Z') })).toBe(false);
  });

  it('null ↔ có giá trị là đổi', () => {
    expect(coThayDoi({ carrierKey: null }, { carrierKey: 'dhl' })).toBe(true);
  });

  it('bản vá chỉ có updatedAt → không có gì để ghi', () => {
    expect(coThayDoi({ a: 1 }, { updatedAt: new Date() })).toBe(false);
  });

  it('trường mới chưa có trong dòng hiện tại → phải ghi', () => {
    expect(coThayDoi({ trackingNumber: 'X' }, { trackingNumber: 'X', carrierKey: 'fedex' })).toBe(true);
  });
});

describe('locViecGhi', () => {
  it('chỉ giữ việc thật sự đổi và đếm đúng số bỏ qua', () => {
    const viec = [
      { id: 'a', cu: { v: 1 }, moi: { v: 1 } },
      { id: 'b', cu: { v: 1 }, moi: { v: 2 } },
      { id: 'c', cu: null, moi: { v: 3 } },
    ];
    const r = locViecGhi(viec, (x) => x.cu, (x) => x.moi);
    expect(r.canGhi.map((x) => x.id)).toEqual(['b', 'c']);
    expect(r.boQua).toBe(1);
  });
});
