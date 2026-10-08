import { describe, expect, it } from 'vitest';
import { ghiLenSheet } from './dong-sheet-loc';

describe('ghiLenSheet', () => {
  it('đơn có thu thì ghi', () => {
    expect(ghiLenSheet({ tongThu: 2_498_968 })).toBe(true);
  });

  /* #KLS2053 lần gửi sai địa chỉ: giữ 0đ trong bảng kê, KHÔNG hiện trên sheet brand đọc. */
  it('đơn miễn thu (0đ) thì không ghi', () => {
    expect(ghiLenSheet({ tongThu: 0 })).toBe(false);
  });

  /* Số lẻ dưới 1đ do làm tròn vẫn là "không thu" — đừng để một dòng 0,4đ lọt lên bảng brand. */
  it('số lẻ làm tròn về 0 cũng không ghi', () => {
    expect(ghiLenSheet({ tongThu: 0.4 })).toBe(false);
    expect(ghiLenSheet({ tongThu: -0.2 })).toBe(false);
  });

  /* Hoàn tiền/âm thì VẪN ghi: đó là tiền brand được trừ, giấu đi là giấu một khoản có lợi
     cho họ — khác hẳn dòng 0đ vốn không nói lên điều gì. */
  it('dòng ÂM vẫn ghi', () => {
    expect(ghiLenSheet({ tongThu: -500_000 })).toBe(true);
  });
});
