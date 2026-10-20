import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { cauDatDanhTinh } from './ghi-voi';
import { MAY } from './tac-nhan';
import type { TacNhan } from './tac-nhan';

/** Dịch câu SQL ra đúng chuỗi + tham số mà `pg` sẽ gửi đi. Không chạm CSDL. */
function dich(t: TacNhan) {
  const q = new PgDialect().sqlToQuery(cauDatDanhTinh(t));
  return { cau: q.sql.replace(/\s+/g, ' ').trim(), tham: q.params };
}

describe('cauDatDanhTinh', () => {
  /**
   * HÀNG RÀO QUAN TRỌNG NHẤT của cả tính năng. `set_config(..., false)` là mức PHIÊN:
   * `db/client.ts` dùng một `Pool`, kết nối được tái dùng, nên danh tính của request trước
   * rò sang request sau — gán sai người còn tệ hơn không gán ai. `true` = `SET LOCAL`, chết
   * theo giao dịch. Ghim cả HAI lời gọi, vì sửa sót một cái cũng đủ rò một nửa.
   */
  it('tham số thứ ba là `true` (SET LOCAL) ở CẢ HAI lời gọi set_config', () => {
    const { cau } = dich({ kieu: 'nguoi', userId: 'u1' });
    expect(cau).toBe(
      "SELECT set_config('app.tac_nhan_id', $1, true), set_config('app.tac_nhan_nhan', $2, true)",
    );
    expect(cau.match(/, true\)/g)).toHaveLength(2);
    expect(cau).not.toContain('false');
  });

  /**
   * `userId` tới từ phiên đăng nhập. Nối nó vào câu `SET` là một lỗ tiêm SQL chạy dưới
   * quyền của chính luồng ghi, nên giá trị phải nằm ở `params`, KHÔNG nằm trong chuỗi câu.
   */
  it('giá trị đi qua tham số, KHÔNG nối vào chuỗi câu', () => {
    const { cau, tham } = dich({ kieu: 'nguoi', userId: "u1'; DROP TABLE shipments; --" });
    expect(tham).toEqual(["u1'; DROP TABLE shipments; --", '']);
    expect(cau).not.toContain('DROP TABLE');
    expect(cau).not.toContain('u1');
  });

  it('người: id là userId, nhãn rỗng (→ NULL qua nullif của trigger)', () => {
    expect(dich({ kieu: 'nguoi', userId: 'u1' }).tham).toEqual(['u1', '']);
  });

  it('máy: id rỗng (→ NULL), nhãn là chuỗi đã khai', () => {
    expect(dich({ kieu: 'may', nhan: MAY.DONG_BO_LARK }).tham).toEqual(['', 'Đồng bộ Lark']);
  });
});
