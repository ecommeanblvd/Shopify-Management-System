import { describe, it, expect } from 'vitest';
import { batTachDuty, giaCuoiChoMmp, giaCuoiVaDelta } from './gia-cuoi-mmp';

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

describe('giaCuoiVaDelta — delta phải khớp ĐÚNG con số gửi MMP', () => {
  const co = { cuocThucVnd: 1_567_050, giaBaoVnd: 1_500_000, dutyVnd: 736_241, shippedAt: '2026-07-06' };

  it('công tắc TẮT: final = cước + duty → delta cũng so trên số ĐÓ (previous + delta = final)', () => {
    const r = giaCuoiVaDelta(co, false)!;
    expect(r.finalChargedVnd).toBe(2_303_291);
    expect(r.deltaVnd).toBe(803_291);
    expect(r.previousChargedVnd! + r.deltaVnd!).toBe(r.finalChargedVnd);
  });

  it('công tắc BẬT: final = cước → delta so trên cước, kèm dutyVnd/totalWithDutyVnd', () => {
    const r = giaCuoiVaDelta(co, true)!;
    expect(r.finalChargedVnd).toBe(1_567_050);
    expect(r.deltaVnd).toBe(67_050);
    expect(r.dutyVnd).toBe(736_241);
    expect(r.totalWithDutyVnd).toBe(2_303_291);
    expect(r.previousChargedVnd! + r.deltaVnd!).toBe(r.finalChargedVnd);
  });

  it('re-quote LỖI (chưa có giá thực): lùi về giá báo và KHÔNG cộng duty — giá báo chưa từng có duty', () => {
    const tat = giaCuoiVaDelta({ ...co, cuocThucVnd: null }, false)!;
    expect(tat.finalChargedVnd).toBe(1_500_000);
    expect(tat.deltaVnd).toBe(0);
    const bat = giaCuoiVaDelta({ ...co, cuocThucVnd: null }, true)!;
    expect(bat.finalChargedVnd).toBe(1_500_000);
    expect(bat.dutyVnd).toBe(0);
    expect(bat.totalWithDutyVnd).toBe(1_500_000);
  });

  it('chưa có giá báo → deltaVnd null, vẫn gửi giá cuối', () => {
    const r = giaCuoiVaDelta({ ...co, giaBaoVnd: null }, true)!;
    expect(r.deltaVnd).toBeNull();
    expect(r.previousChargedVnd).toBeNull();
    expect(r.finalChargedVnd).toBe(1_567_050);
  });

  it('không có giá thực lẫn giá báo → null (không có gì để gửi)', () => {
    expect(giaCuoiVaDelta({ cuocThucVnd: null, giaBaoVnd: null, dutyVnd: 736_241, shippedAt: null }, true)).toBeNull();
  });
});
