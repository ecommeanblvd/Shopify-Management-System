import { describe, it, expect } from 'vitest';
import { serialNgay, tuSerial } from './sheets';

describe('serial ngày của Google Sheets', () => {
  /* Mốc neo đã biết — dùng để tự kiểm phép quy đổi TRƯỚC khi ghi lên sheet thật. Chính phép
     assert này đã chặn một lượt ghi sai ngày hôm 02/10/2026 và làm lộ ra chuyện sheet đặt
     locale en_US (đọc "03/07" thành 7 tháng 3). */
  it('mốc neo 45292 = 01/01/2024', () => {
    expect(tuSerial(45292)).toBe('2024-01-01');
    expect(serialNgay('2024-01-01')).toBe(45292);
  });
  it('đi về được cả hai chiều', () => {
    for (const d of ['2026-07-03', '2026-07-06', '2026-12-31']) expect(tuSerial(serialNgay(d))).toBe(d);
  });
});
