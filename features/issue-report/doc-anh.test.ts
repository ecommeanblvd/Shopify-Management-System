import { describe, expect, it } from 'vitest';
import { khongTimThayAnh, laUuidBaoLoi } from './doc-anh';

describe('laUuidBaoLoi', () => {
  it('chặn id không phải UUID trước khi nó tới Postgres', () => {
    // Route ảnh đọc `reporter_id` TRƯỚC khi quyết quyền, nên một id rác đi thẳng vào
    // `eq(id, ...)` làm Postgres ném "invalid input syntax for type uuid" ⇒ 500 thay vì 404.
    for (const x of ['abc', '', '1', "' or 1=1--", 'ZZZZZZZZ-1111-2222-3333-444444444444']) {
      expect(laUuidBaoLoi(x), JSON.stringify(x)).toBe(false);
    }
  });

  it('nhận UUID thật', () => {
    expect(laUuidBaoLoi('5b674e6a-271f-4283-9eb7-ee814b302863')).toBe(true);
  });
});

describe('khongTimThayAnh', () => {
  it('mỗi lượt trả một Response MỚI — thân Response dùng một lần', async () => {
    // Giữ MỘT đối tượng Response ở mức module rồi trả nó nhiều lượt: lượt đầu đúng 404, mọi
    // lượt sau ném 'Body is unusable' ⇒ 500. Nghĩa là người không được xem ảnh bấm link lần
    // thứ hai sẽ nhận 500 — biến một nhánh gác cố ý thành lỗi hệ thống.
    const a = khongTimThayAnh();
    const b = khongTimThayAnh();
    expect(a).not.toBe(b);
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    await expect(a.text()).resolves.toContain('không tìm thấy');
    await expect(b.text()).resolves.toContain('không tìm thấy');
  });
});
