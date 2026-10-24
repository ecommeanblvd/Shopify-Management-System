import { describe, it, expect } from 'vitest';
import { nhanTacNhan, MAY } from './tac-nhan';

describe('nhanTacNhan', () => {
  it('người thì nhãn rỗng — màn hình tự tra tên theo userId', () => {
    expect(nhanTacNhan({ kieu: 'nguoi', userId: 'u1' })).toBe('');
  });

  it('máy thì nhãn là chính chuỗi đã khai', () => {
    expect(nhanTacNhan({ kieu: 'may', nhan: MAY.DONG_BO_LARK })).toBe('Đồng bộ Lark');
  });
});

describe('MAY', () => {
  /**
   * Nhãn của bộ đồng bộ Shopify. Ghim nguyên văn: đây là chữ hiện trên màn "Lịch sử" cho
   * mọi dòng `shopify_orders` / `shopify_order_lines` mà `upsertOrder` ghi, và là điều kiện
   * tiên quyết để bật trigger cho hai bảng đó mà không nhầm với lỗi quên bọc.
   */
  it('có nhãn riêng cho bộ đồng bộ Shopify', () => {
    expect(MAY.DONG_BO_SHOPIFY).toBe('Đồng bộ Shopify');
    expect(nhanTacNhan({ kieu: 'may', nhan: MAY.DONG_BO_SHOPIFY })).toBe('Đồng bộ Shopify');
  });

  it('nhãn máy KHÔNG được trùng nhau giữa các nguồn', () => {
    const ds = Object.values(MAY);
    expect(new Set(ds).size).toBe(ds.length);
  });

  /**
   * Nhãn rỗng là NULL với trigger (`nullif(current_setting(...), '')` trong
   * `nhat_ky_ghi()`), nên một nguồn máy khai nhãn rỗng sẽ hiện "Chưa gắn danh tính" —
   * lẫn đúng vào nhóm lỗi quên bọc mà Task 7 phải đếm. Chặn ngay ở đây.
   */
  it('không nhãn máy nào được rỗng hay chỉ có khoảng trắng', () => {
    for (const [ten, nhan] of Object.entries(MAY)) {
      expect(nhan.trim(), `MAY.${ten}`).not.toBe('');
    }
  });
});
