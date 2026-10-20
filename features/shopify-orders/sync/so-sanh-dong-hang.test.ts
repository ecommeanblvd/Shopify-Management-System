import { describe, it, expect } from 'vitest';
import { soSanhDongHang, type DongHangDangCo, type DongHangMoi } from './so-sanh-dong-hang';

/** Một dòng hàng như Shopify trả về, đủ mọi cột mà `shopify-mapper.ts` sinh ra. */
function dongMoi(ghiDe: Partial<DongHangMoi> = {}): DongHangMoi {
  return {
    shopifyLineId: 'gid://shopify/LineItem/1',
    shopifyVariantId: 'gid://shopify/ProductVariant/9',
    shopifyProductId: 'gid://shopify/Product/8',
    sku: 'SKU-1',
    vendor: 'MEAN BLVD',
    productTitle: 'Áo dài',
    variantTitle: 'M',
    quantity: 2,
    unitPrice: '120.00',
    discountAlloc: '10.00',
    total: '230.00',
    processingMinDays: 8,
    processingMaxDays: 14,
    estimatedDelivery: '8 - 14 business days',
    eddMin: '8',
    eddMax: '14',
    soDo: [{ nhan: 'Chiều cao', giaTri: '165' }],
    ...ghiDe,
  };
}

/** Cùng dòng đó, nhưng đọc lên từ CSDL: numeric về dạng chuẩn của Postgres. */
function dongDangCo(ghiDe: Partial<DongHangDangCo> = {}): DongHangDangCo {
  const m = dongMoi();
  return { id: 'uuid-1', ...m, ...ghiDe };
}

describe('soSanhDongHang', () => {
  it('đồng bộ lại một đơn KHÔNG ĐỔI GÌ: không chèn, không sửa, không xoá', () => {
    const ke = soSanhDongHang([dongDangCo()], [dongMoi()]);
    expect(ke).toEqual({ chen: [], sua: [], xoa: [] });
  });

  it('numeric của Postgres khác cách gõ của Shopify vẫn là KHÔNG ĐỔI', () => {
    // CSDL trả `numeric(14,2)` dạng chuẩn hoá; Shopify trả nguyên văn chuỗi của nó.
    // So bằng chuỗi ở đây là mỗi lượt đồng bộ sinh một `UPDATE` rỗng cho MỌI dòng hàng.
    const ke = soSanhDongHang(
      [dongDangCo({ unitPrice: '120.00', discountAlloc: '10.00', total: '230.00' })],
      [dongMoi({ unitPrice: '120.0', discountAlloc: '10', total: '230' })],
    );
    expect(ke).toEqual({ chen: [], sua: [], xoa: [] });
  });

  it('dòng mới trong payload thì CHÈN, không đụng dòng đang có', () => {
    const them = dongMoi({ shopifyLineId: 'gid://shopify/LineItem/2', sku: 'SKU-2' });
    const ke = soSanhDongHang([dongDangCo()], [dongMoi(), them]);
    expect(ke.chen).toEqual([them]);
    expect(ke.sua).toEqual([]);
    expect(ke.xoa).toEqual([]);
  });

  it('dòng không còn trong payload thì XOÁ đúng dòng đó', () => {
    const conLai = dongDangCo();
    const biBo = dongDangCo({ id: 'uuid-2', shopifyLineId: 'gid://shopify/LineItem/2' });
    const ke = soSanhDongHang([conLai, biBo], [dongMoi()]);
    expect(ke.xoa).toEqual(['uuid-2']);
    expect(ke.chen).toEqual([]);
    expect(ke.sua).toEqual([]);
  });

  it('đổi số lượng thì SỬA đúng dòng đó, kèm giá trị mới', () => {
    const moi = dongMoi({ quantity: 3, total: '350.00' });
    const ke = soSanhDongHang([dongDangCo()], [moi]);
    expect(ke.sua).toEqual([{ id: 'uuid-1', gia: moi }]);
    expect(ke.chen).toEqual([]);
    expect(ke.xoa).toEqual([]);
  });

  it('xoá trắng một ô chữ (có giá trị → null) vẫn là một thay đổi', () => {
    const moi = dongMoi({ sku: null });
    const ke = soSanhDongHang([dongDangCo()], [moi]);
    expect(ke.sua).toEqual([{ id: 'uuid-1', gia: moi }]);
  });

  it('số đo đổi thì SỬA — jsonb so theo nội dung, không theo tham chiếu', () => {
    const giongNhau = soSanhDongHang(
      [dongDangCo({ soDo: [{ nhan: 'Chiều cao', giaTri: '165' }] })],
      [dongMoi({ soDo: [{ nhan: 'Chiều cao', giaTri: '165' }] })],
    );
    expect(giongNhau.sua).toEqual([]);
    const khac = soSanhDongHang([dongDangCo()], [dongMoi({ soDo: [{ nhan: 'Chiều cao', giaTri: '170' }] })]);
    expect(khac.sua).toHaveLength(1);
  });

  it('đơn mới (chưa có dòng nào) thì chèn hết', () => {
    const ke = soSanhDongHang([], [dongMoi(), dongMoi({ shopifyLineId: 'gid://shopify/LineItem/2' })]);
    expect(ke.chen).toHaveLength(2);
    expect(ke.sua).toEqual([]);
    expect(ke.xoa).toEqual([]);
  });

  it('payload rỗng thì xoá hết dòng đang có', () => {
    const ke = soSanhDongHang([dongDangCo(), dongDangCo({ id: 'uuid-2' })], []);
    expect(ke.xoa).toEqual(['uuid-1', 'uuid-2']);
    expect(ke.chen).toEqual([]);
  });

  it('hai dòng đang có TRÙNG shopify_line_id: giữ một, xoá bản dư', () => {
    // `shopify_order_lines` KHÔNG có ràng buộc unique (kiểm production 20/10/2026), nên
    // kiểu xoá-sạch-rồi-chèn-lại cũ có thể đã để lại bản dư khi hai lượt đồng bộ chạy
    // chồng nhau. Lượt đồng bộ sau phải dọn, không được giữ cả hai mãi mãi.
    const ke = soSanhDongHang([dongDangCo(), dongDangCo({ id: 'uuid-2' })], [dongMoi()]);
    expect(ke.xoa).toEqual(['uuid-2']);
    expect(ke.sua).toEqual([]);
    expect(ke.chen).toEqual([]);
  });

  it('dòng bị Shopify đánh số lại: xoá id cũ, chèn id mới', () => {
    // Shopify đặt lại `line_item.id` khi đơn được sửa — ca này KHÔNG tránh được
    // một cặp xoá+chèn, và đó là sự thật đáng ghi: dòng cũ mất, dòng mới có.
    const moi = dongMoi({ shopifyLineId: 'gid://shopify/LineItem/99' });
    const ke = soSanhDongHang([dongDangCo()], [moi]);
    expect(ke.xoa).toEqual(['uuid-1']);
    expect(ke.chen).toEqual([moi]);
    expect(ke.sua).toEqual([]);
  });

  /**
   * CANH BẪY BẢO TRÌ: thêm một cột dòng hàng mà quên khai trong `coDoi` thì cột đó IM LẶNG
   * không bao giờ đồng bộ lên dòng đang có — `coDoi` không biết nó tồn tại nên luôn trả
   * "không đổi". Biên dịch vẫn sạch. Kiểu cũ (xoá rồi chèn lại) luôn làm mới mọi cột nên
   * che mất hẳn lớp lỗi này; kiểu mới thì không, nên phải có test đứng canh.
   *
   * Lật TỪNG khoá của `dongMoi()` một, mỗi lần phải ra đúng MỘT `sua`. Chuỗi khoá lấy từ
   * chính đối tượng nên cột mới vào `shopify-mapper.ts` là tự có mặt ở đây.
   *
   * `shopifyLineId` bị loại: nó là KHOÁ GHÉP, đổi nó không phải "sửa một ô" mà là
   * "dòng khác" — ca đó do test "Shopify đánh số lại" ở trên phủ.
   *
   * Vòng canh được `coDoi`, còn ba chỗ liệt kê cột còn lại do `tsc` nối thành chuỗi: khai
   * cột trong `coDoi` ⇒ phải có trong `DongHangDangCo` (không thì `cu.X` đỏ) ⇒ câu select
   * của `upsert-order.ts` phải trả về nó (không thì đối số `dangCo` đỏ). Lỗ còn lại: cột
   * mới của mapper mà KHÔNG BẮT BUỘC (`foo?: string`) thì `dongMoi()` không đỏ, nên vòng
   * này không thấy nó. Mapper hôm nay không có cột nào như thế.
   */
  describe('mọi cột của mapper đều được so', () => {
    /** Một giá trị CHẮC CHẮN khác `v`. Ném với kiểu chưa biết: thà test đỏ bắt người thêm
     *  cột phải nghĩ về cách so cột đó, còn hơn lặng lẽ coi nó là "không đổi". */
    function khac(v: unknown): unknown {
      if (v === null) return 'ĐÃ ĐIỀN';
      if (typeof v === 'number') return v + 1;
      if (typeof v === 'string') return `${v}-ĐÃ ĐỔI`;
      if (Array.isArray(v)) return [];
      throw new Error(`khac(): chưa biết lật kiểu ${typeof v} — bổ sung ở đây và trong coDoi()`);
    }

    const khoa = (Object.keys(dongMoi()) as Array<keyof DongHangMoi>)
      .filter((k) => k !== 'shopifyLineId');

    it.each(khoa)('đổi %s thì ra đúng một sua', (k) => {
      const moi = { ...dongMoi(), [k]: khac(dongMoi()[k]) } as DongHangMoi;
      const ke = soSanhDongHang([dongDangCo()], [moi]);
      expect(ke.sua, `cột ${k} không được coDoi() so — thêm nó vào so-sanh-dong-hang.ts`)
        .toEqual([{ id: 'uuid-1', gia: moi }]);
      expect(ke.chen).toEqual([]);
      expect(ke.xoa).toEqual([]);
    });

    it('vòng trên có chạy, và chạy đủ số cột của mapper', () => {
      // Không có khẳng định này thì một `filter` sai biến cả `it.each` ở trên thành 0 test
      // mà bộ test vẫn xanh. 16 = 17 cột của mapper trừ `shopifyLineId`.
      expect(khoa).toHaveLength(16);
    });
  });
});
