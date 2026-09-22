import { describe, it, expect } from 'vitest';
import { soatMatDong } from './mat-dong';

const kien = (code: string, daDanhDau = false) => ({ logUniqueCode: code, daDanhDau });

describe('soatMatDong', () => {
  it('dòng Lark không còn → đánh dấu kiện đó', () => {
    const r = soatMatDong(['PK-1', 'PK-2', 'PK-4', 'PK-5'], [kien('PK-1'), kien('PK-2'), kien('PK-3'), kien('PK-4'), kien('PK-5')]);
    expect(r).toEqual({ canDanhDau: ['PK-3'], canGoDanhDau: [], boQua: false, soPhatHien: 1 });
  });

  it('dòng Lark quay lại → gỡ đánh dấu', () => {
    const r = soatMatDong(['PK-1', 'PK-2', 'PK-3'], [kien('PK-1'), kien('PK-2'), kien('PK-3', true)]);
    expect(r.canGoDanhDau).toEqual(['PK-3']);
    expect(r.canDanhDau).toEqual([]);
  });

  it('hàng trăm dòng biến mất cùng lúc → BỎ QUA cả lượt (nghi Lark trả thiếu)', () => {
    const sms = Array.from({ length: 100 }, (_, i) => kien(`PK-${i}`));
    const r = soatMatDong(['PK-1', 'PK-2'], sms);
    expect(r.boQua).toBe(true);
    expect(r.canDanhDau).toEqual([]);
    expect(r.soPhatHien).toBe(98);
  });

  it('vẫn GỠ dấu khi bỏ lượt — dòng quay lại là tin tốt', () => {
    const sms = [...Array.from({ length: 100 }, (_, i) => kien(`PK-${i}`)), kien('PK-cu', true)];
    const r = soatMatDong(['PK-1', 'PK-cu'], sms);
    expect(r.boQua).toBe(true);
    expect(r.canGoDanhDau).toEqual(['PK-cu']);
  });

  it('trần nâng lên thì đánh dấu được cả loạt (script dọn dữ liệu cũ)', () => {
    const sms = Array.from({ length: 100 }, (_, i) => kien(`PK-${i}`));
    const r = soatMatDong(['PK-1'], sms, 1000);
    expect(r.boQua).toBe(false);
    expect(r.canDanhDau).toHaveLength(99);
  });

  it('chưa có kiện nào thì không phải soát', () => {
    expect(soatMatDong([], [])).toEqual({ canDanhDau: [], canGoDanhDau: [], boQua: false, soPhatHien: 0 });
  });

  it('kiện đã đánh dấu mà Lark vẫn không có → để nguyên, không đánh dấu lại', () => {
    const r = soatMatDong(['PK-1'], [kien('PK-1'), kien('PK-2', true)]);
    expect(r.canDanhDau).toEqual([]);
    expect(r.canGoDanhDau).toEqual([]);
  });
});
