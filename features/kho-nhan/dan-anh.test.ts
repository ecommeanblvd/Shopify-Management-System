import { describe, it, expect } from 'vitest';
import { chapNhanKieu, tenFileDan } from './dan-anh';

describe('chapNhanKieu', () => {
  it('nhận mọi loại ảnh và PDF', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf']) {
      expect(chapNhanKieu(t)).toBe(true);
    }
  });

  /* Dán từ Zalo/Chrome thường kèm cả text/html trong clipboard; nhận bừa là
   * đẩy một mẩu HTML lên S3 rồi hiện trong danh sách như một "ảnh". */
  it('từ chối text, html và file lạ', () => {
    for (const t of ['text/plain', 'text/html', 'application/zip', '']) {
      expect(chapNhanKieu(t)).toBe(false);
    }
  });
});

describe('tenFileDan', () => {
  const luc = new Date(2026, 8, 25, 9, 5, 3);

  it('tên mang loại, mốc thời gian đến giây và đuôi đúng', () => {
    expect(tenFileDan('hang_den', 'image/png', luc)).toBe('hang_den-20260925-090503-1.png');
  });

  /* Dán liên tiếp trong CÙNG một giây vẫn phải ra tên khác nhau, nếu không
   * danh sách hiện năm dòng trùng tên và không ai biết cái nào là cái nào. */
  it('cùng một giây nhưng khác số thứ tự → khác tên', () => {
    expect(tenFileDan('hang_den', 'image/png', luc, 1))
      .not.toBe(tenFileDan('hang_den', 'image/png', luc, 2));
  });

  it('jpeg ra đuôi jpg, kiểu lạ ra .bin chứ không ném', () => {
    expect(tenFileDan('bb_ban_giao', 'image/jpeg', luc)).toMatch(/\.jpg$/);
    expect(tenFileDan('bb_ban_giao', 'image/tiff', luc)).toMatch(/\.bin$/);
  });
});
