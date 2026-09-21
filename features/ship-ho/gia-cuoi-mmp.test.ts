import { describe, it, expect } from 'vitest';
import { batTachDuty, giaCuoiChoMmp } from './gia-cuoi-mmp';

describe('batTachDuty', () => {
  it('"1" → bật; khác → tắt', () => {
    expect(batTachDuty('1')).toBe(true);
    expect(batTachDuty('')).toBe(false);
    expect(batTachDuty(undefined)).toBe(false);
  });
});

describe('giaCuoiChoMmp', () => {
  const i = { cuocVnd: 1_567_050, dutyVnd: 736_241, shippedAt: '2026-07-06' };
  it('công tắc TẮT → finalChargedVnd = cước + duty (nghĩa cũ), KHÔNG có dutyVnd, vẫn có shippedAt', () => {
    expect(giaCuoiChoMmp(i, false)).toEqual({ finalChargedVnd: 2_303_291, shippedAt: '2026-07-06' });
  });
  it('công tắc BẬT → finalChargedVnd = cước, kèm dutyVnd và totalWithDutyVnd', () => {
    expect(giaCuoiChoMmp(i, true)).toEqual({ finalChargedVnd: 1_567_050, dutyVnd: 736_241, totalWithDutyVnd: 2_303_291, shippedAt: '2026-07-06' });
  });
  it('chưa có duty → 0', () => {
    expect(giaCuoiChoMmp({ ...i, dutyVnd: null }, true).dutyVnd).toBe(0);
    expect(giaCuoiChoMmp({ ...i, dutyVnd: null }, false).finalChargedVnd).toBe(1_567_050);
  });
});
