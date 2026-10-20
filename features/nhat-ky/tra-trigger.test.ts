import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Canh câu SQL của `tra-trigger.ts` bằng cách ĐỌC MÃ, không gọi hàm: `vitest` chạy môi
 * trường `node` và không chạm được CSDL (xem `vitest.config.ts`), nên không có cách nào
 * chạy thật câu đó ở đây. Chứng minh hành vi là việc của
 * `scripts/nhat-ky-kiem-tra-trigger.ts` (tạo trigger mồi trùng tên trong `BEGIN … ROLLBACK`).
 *
 * Test này giữ MỘT điều: điều kiện lọc phải so cả TÊN BẢNG, không chỉ tên trigger. Tên
 * trigger chỉ unique theo từng bảng, nên bỏ `c.relname` ra là màn hình báo "đã bật" cho một
 * bảng chưa bật — mà không có gì ở repo đỏ lên, và cái sai đó chính là cái tính năng nhật ký
 * dựng ra để tránh. Yếu hơn một test hành vi, nhưng nó bắt được đúng lượt sửa dễ xảy ra:
 * ai đó "đơn giản hoá" câu SQL.
 */
const NGUON = readFileSync(new URL('./tra-trigger.ts', import.meta.url), 'utf8');

describe('câu SQL tra pg_trigger', () => {
  it('lọc theo CẶP (tên bảng, tên trigger), không chỉ tên trigger', () => {
    expect(NGUON).toMatch(/\(c\.relname,\s*t\.tgname\)\s+IN\s*\(/);
  });

  it('không còn nhánh nào lọc chỉ bằng t.tgname', () => {
    expect(NGUON).not.toMatch(/\bt\.tgname\s+(IN|=)\s/);
  });

  it('vẫn bỏ trigger nội bộ của Postgres và vẫn ghim schema public', () => {
    expect(NGUON).toContain('NOT t.tgisinternal');
    expect(NGUON).toContain("n.nspname = 'public'");
  });

  /* Khoá map phải là TÊN BẢNG: khoá theo tên trigger là quay về đúng lỗi trên, chỉ dịch
     từ câu SQL sang JavaScript. */
  it('ghép kết quả về từng bảng theo relname', () => {
    expect(NGUON).toMatch(/new Map\(r\.rows\.map\(\(x\) => \[x\.relname,/);
  });
});
