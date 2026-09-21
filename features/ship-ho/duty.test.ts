import { describe, it, expect } from 'vitest';
import { tinhDutyMoi, quyetDinhGhiDuty, type DongDuty } from './duty';

const d = (billNumber: string, dutyVnd: number, issueDate = '2026-08-20'): DongDuty => ({ billNumber, issueDate, dutyVnd });

describe('tinhDutyMoi', () => {
  it('cộng dồn mọi dòng; billNumbers = tất cả hoá đơn', () => {
    const r = tinhDutyMoi([d('736059786', 325_901), d('736060188', 100_000)], []);
    expect(r.tong).toBe(425_901);
    expect(r.moi.map((x) => x.billNumber)).toEqual(['736059786', '736060188']);
    expect(r.billNumbers).toEqual(['736059786', '736060188']);
  });
  it('hoá đơn đã cộng không tính là MỚI nhưng vẫn nằm trong tổng (tổng = sự thật hiện tại)', () => {
    const r = tinhDutyMoi([d('736059786', 325_901), d('736060188', 100_000)], ['736059786']);
    expect(r.tong).toBe(425_901);
    expect(r.moi.map((x) => x.billNumber)).toEqual(['736060188']);
  });
  it('cùng số hoá đơn gửi lại số khác → ghi đè (tổng theo số mới), coi là MỚI để bắn lại MMP', () => {
    const r = tinhDutyMoi([d('736059786', 300_000)], ['736059786']);
    expect(r.tong).toBe(300_000);
    expect(r.moi).toHaveLength(0); // cùng số hoá đơn, đã cộng → không bắn lại; ghi đè chỉ khi tổng đổi (ghiDutyChoDon so tổng)
  });
  it('dòng duty 0 bỏ qua; không dòng nào → tổng 0, không mới', () => {
    expect(tinhDutyMoi([d('x', 0)], [])).toEqual({ tong: 0, moi: [], billNumbers: [] });
  });
  it('billNumber fallback dạng bill:<uuid> (bill không có số FedEx) được xử lý như hoá đơn bình thường', () => {
    const fallback = 'bill:123e4567-e89b-12d3-a456-426614174000';
    const r = tinhDutyMoi([d(fallback, 50_000)], []);
    expect(r.tong).toBe(50_000);
    expect(r.moi.map((x) => x.billNumber)).toEqual([fallback]);
    expect(r.billNumbers).toEqual([fallback]);
  });
});

describe('quyetDinhGhiDuty', () => {
  it('chưa có gì (chưa có dòng, chưa từng ghi) → không ghi', () => {
    const r = quyetDinhGhiDuty(null, [], []);
    expect(r).toEqual({ ghi: false, tong: 0, billNumbers: [], canBan: [], soMoi: 0 });
  });
  it('hoá đơn mới → ghi + canBan = hoá đơn mới', () => {
    const r = quyetDinhGhiDuty(null, [d('736059786', 100_000)], []);
    expect(r.ghi).toBe(true);
    expect(r.tong).toBe(100_000);
    expect(r.canBan.map((x) => x.billNumber)).toEqual(['736059786']);
  });
  it('cùng hoá đơn nhưng FedEx sửa số → tổng đổi, ghi + canBan = dòng cuối (không phải "mới")', () => {
    const r = quyetDinhGhiDuty(325_901, [d('736059786', 300_000)], ['736059786']);
    expect(r.ghi).toBe(true);
    expect(r.tong).toBe(300_000);
    expect(r.canBan).toEqual([d('736059786', 300_000)]);
  });
  it('dòng bị xoá hết khỏi hoá đơn carrier (đã có tổng cũ, giờ không còn dòng nào) → ghi tổng 0, canBan rỗng', () => {
    const r = quyetDinhGhiDuty(100_000, [], ['736059786']);
    expect(r.ghi).toBe(true);
    expect(r.tong).toBe(0);
    expect(r.canBan).toEqual([]);
  });
  it('không đổi (tổng khớp, không hoá đơn mới) → không ghi', () => {
    const r = quyetDinhGhiDuty(100_000, [d('736059786', 100_000)], ['736059786']);
    expect(r.ghi).toBe(false);
    expect(r.tong).toBe(100_000);
    expect(r.canBan).toEqual([]);
  });
  it('billNumber fallback bill:<uuid> được coi như hoá đơn bình thường khi quyết định ghi', () => {
    const fallback = 'bill:123e4567-e89b-12d3-a456-426614174000';
    const r = quyetDinhGhiDuty(null, [d(fallback, 50_000)], []);
    expect(r.ghi).toBe(true);
    expect(r.tong).toBe(50_000);
    expect(r.billNumbers).toEqual([fallback]);
    expect(r.canBan.map((x) => x.billNumber)).toEqual([fallback]);
  });
});
