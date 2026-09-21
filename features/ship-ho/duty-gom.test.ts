import { describe, it, expect } from 'vitest';
import { gomDongDutyTheoHoaDon, type DongDuty } from './duty-gom';

const d = (billNumber: string, dutyVnd: number, issueDate = '2026-08-20'): DongDuty => ({ billNumber, issueDate, dutyVnd });

describe('gomDongDutyTheoHoaDon — một hoá đơn = một dòng (khoá idempotent MMP)', () => {
  it('nhiều dòng cùng hoá đơn → cộng dồn thành 1 dòng', () => {
    const r = gomDongDutyTheoHoaDon([d('736059786', 200_000), d('736059786', 125_901)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ billNumber: '736059786', issueDate: '2026-08-20', dutyVnd: 325_901 });
  });

  it('hoá đơn khác nhau giữ riêng, đúng thứ tự xuất hiện', () => {
    const r = gomDongDutyTheoHoaDon([d('736059786', 100_000), d('736060188', 50_000), d('736059786', 25_000)]);
    expect(r.map((x) => x.billNumber)).toEqual(['736059786', '736060188']);
    expect(r.map((x) => x.dutyVnd)).toEqual([125_000, 50_000]);
  });

  it('issueDate lấy SỚM NHẤT trong cùng hoá đơn (mốc xếp kỳ bảng kê duty)', () => {
    const r = gomDongDutyTheoHoaDon([d('736059786', 10, '2026-09-08'), d('736059786', 20, '2026-08-17')]);
    expect(r[0].issueDate).toBe('2026-08-17');
  });

  it('rỗng → rỗng; không sửa mảng gốc', () => {
    expect(gomDongDutyTheoHoaDon([])).toEqual([]);
    const goc = [d('A', 10), d('A', 20)];
    gomDongDutyTheoHoaDon(goc);
    expect(goc.map((x) => x.dutyVnd)).toEqual([10, 20]);
  });
});
