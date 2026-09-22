import { describe, it, expect } from 'vitest';
import { soatMatDong } from './mat-dong';

const kien = (code: string, daDanhDau = false) => ({ logUniqueCode: code, daDanhDau });

describe('soatMatDong', () => {
  it('dòng Lark không còn → đánh dấu kiện đó', () => {
    const r = soatMatDong(['PK-1', 'PK-2', 'PK-4', 'PK-5'], [kien('PK-1'), kien('PK-2'), kien('PK-3'), kien('PK-4'), kien('PK-5')]);
    expect(r).toEqual({ canDanhDau: ['PK-3'], canGoDanhDau: [], boQua: false });
  });

  it('dòng Lark quay lại → gỡ đánh dấu', () => {
    const r = soatMatDong(['PK-1', 'PK-2', 'PK-3'], [kien('PK-1'), kien('PK-2'), kien('PK-3', true)]);
    expect(r.canGoDanhDau).toEqual(['PK-3']);
    expect(r.canDanhDau).toEqual([]);
  });

  it('Lark trả thiếu bất thường → BỎ QUA, không đánh dấu hàng loạt', () => {
    const sms = Array.from({ length: 100 }, (_, i) => kien(`PK-${i}`));
    const r = soatMatDong(['PK-1', 'PK-2'], sms);
    expect(r).toEqual({ canDanhDau: [], canGoDanhDau: [], boQua: true });
  });

  it('đúng ngưỡng 80% thì vẫn soát', () => {
    const sms = Array.from({ length: 10 }, (_, i) => kien(`PK-${i}`));
    const lark = Array.from({ length: 8 }, (_, i) => `PK-${i}`);
    const r = soatMatDong(lark, sms);
    expect(r.boQua).toBe(false);
    expect(r.canDanhDau).toEqual(['PK-8', 'PK-9']);
  });

  it('chưa có kiện nào thì không phải soát', () => {
    expect(soatMatDong([], [])).toEqual({ canDanhDau: [], canGoDanhDau: [], boQua: false });
  });

  it('kiện đã đánh dấu mà Lark vẫn không có → để nguyên, không đánh dấu lại', () => {
    const r = soatMatDong(['PK-1'], [kien('PK-1'), kien('PK-2', true)]);
    expect(r.canDanhDau).toEqual([]);
    expect(r.canGoDanhDau).toEqual([]);
  });
});
