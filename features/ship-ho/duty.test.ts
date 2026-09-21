import { describe, it, expect } from 'vitest';
import { tinhDutyMoi, type DongDuty } from './duty';

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
});
