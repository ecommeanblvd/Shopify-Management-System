import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapShopifyOrder } from './shopify-mapper';
import type { ShopifyOrderPayload } from '../shopify-types';
import { soSanhDongHang, type DongHangDangCo, type DongHangMoi } from './so-sanh-dong-hang';

/**
 * Dòng hàng mẫu dựng từ MAPPER THẬT, không phải literal viết tay.
 *
 * VÌ SAO quan trọng: vòng test "mọi cột của mapper đều được so" ở dưới lấy danh sách cột
 * từ `Object.keys(dongMoi())`. Một literal viết tay ở đây sẽ là chỗ THỨ TƯ phải nhớ sửa
 * khi mapper thêm cột — tức là vòng test đó tự nhận một danh sách cột đã lạc hậu rồi
 * tuyên bố "không sót cột". Lấy từ `mapShopifyOrder` thì cột mới TỰ có mặt.
 *
 * Dùng chính payload mẫu mà `shopify-mapper.test.ts` dùng, không dựng payload riêng.
 */
function fixture(name: string): ShopifyOrderPayload {
  return JSON.parse(
    readFileSync(join(__dirname, '..', '__fixtures__', `${name}.json`), 'utf8'),
  ) as ShopifyOrderPayload;
}

const DONG_MAU: DongHangMoi = mapShopifyOrder(fixture('order-multi-line'), 'store-1').lines[0]!;

/** Một dòng hàng như Shopify trả về, qua đúng phép ánh xạ của `shopify-mapper.ts`. */
function dongMoi(ghiDe: Partial<DongHangMoi> = {}): DongHangMoi {
  return { ...DONG_MAU, ...ghiDe };
}

/** Cùng dòng đó, nhưng đọc lên từ CSDL: numeric về dạng chuẩn của Postgres. */
function dongDangCo(ghiDe: Partial<DongHangDangCo> = {}): DongHangDangCo {
  return { id: 'uuid-1', ...DONG_MAU, ...ghiDe };
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
   * Lật TỪNG khoá một, mỗi lần phải ra đúng MỘT `sua`. Danh sách khoá lấy từ
   * `Object.keys(dongMoi())`, mà `dongMoi()` là đầu ra của `mapShopifyOrder` THẬT — nên
   * cột mới của mapper tự có mặt ở đây, không ai phải nhớ khai thêm vào test.
   *
   * Đây là test LÚC CHẠY, không dựa vào `tsc`: chạy riêng `vitest` cũng đỏ. (Bản vòng sửa 1
   * lấy khoá từ một literal viết tay trong tệp này — tức là tự nhận một danh sách cột có
   * thể đã lạc hậu rồi tuyên bố "không sót cột". Vòng soát 2 bắt đúng.)
   *
   * `shopifyLineId` bị loại: nó là KHOÁ GHÉP, đổi nó không phải "sửa một ô" mà là
   * "dòng khác" — ca đó do test "Shopify đánh số lại" ở trên phủ.
   *
   * Vòng này canh `coDoi`. Ba chỗ liệt kê cột còn lại được `tsc` nối thành chuỗi: khai cột
   * trong `coDoi` ⇒ phải có trong `DongHangDangCo` (không thì `cu.X` đỏ) ⇒ câu select của
   * `upsert-order.ts` phải trả về nó (không thì đối số `dangCo` đỏ).
   *
   * LỖ CÒN LẠI, hẹp hơn hẳn bản trước: một cột mà mapper chỉ sinh ra với payload KHÁC
   * (cột tuỳ chọn mà `order-multi-line.json` không điền) thì vẫn không có mặt trong
   * `Object.keys`. Bịt bằng cách điền cột đó vào payload mẫu, không phải bằng cách thêm
   * tay vào test.
   */
  describe('mọi cột của mapper đều được so', () => {
    /** Một giá trị CHẮC CHẮN khác `v`. Ném với kiểu chưa biết: thà test đỏ bắt người thêm
     *  cột phải nghĩ về cách so cột đó, còn hơn lặng lẽ coi nó là "không đổi". */
    function khac(v: unknown): unknown {
      if (v === null) return 'ĐÃ ĐIỀN';
      if (typeof v === 'number') return v + 1;
      if (typeof v === 'string') return `${v}-ĐÃ ĐỔI`;
      // Mảng RỖNG phải lật thành mảng CÓ phần tử: trả `[]` cho một cột đang rỗng là
      // "lật" mà không đổi gì, và test sẽ đỏ vì lý do sai (`soDo` của payload mẫu rỗng).
      if (Array.isArray(v)) return v.length === 0 ? [{ nhan: 'ĐÃ ĐIỀN', giaTri: '1' }] : [];
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
      // Hai việc, và cả hai đều cố ý:
      //  1. Không có khẳng định này thì một `filter` sai biến cả `it.each` ở trên thành
      //     0 test mà bộ test vẫn xanh.
      //  2. Con số 16 (= 17 cột của mapper trừ `shopifyLineId`) là CHỐT CHẶN CÓ CHỦ Ý,
      //     không phải con số tình cờ: mapper thêm cột thì test này đỏ TRƯỚC, buộc người
      //     sửa đọc tới đây và đi khai cột đó trong `coDoi`. Sửa số mà không khai cột thì
      //     `it.each` ở trên đỏ ngay sau. Đổi số là một hành động có ý thức, không phải
      //     một việc dọn dẹp.
      expect(khoa).toHaveLength(16);
    });
  });
});

/**
 * I4 của lượt soát cuối: `bangJson` so bằng `JSON.stringify` nên nó phụ thuộc THỨ TỰ KHOÁ,
 * mà thứ tự khoá của một giá trị đọc lên từ `jsonb` do Postgres quyết (độ dài khoá, rồi
 * bytewise) — không phải do payload Shopify.
 */
describe('bangJson so SÂU, không phụ thuộc thứ tự khoá jsonb', () => {
  const voi = (soDo: unknown) => ({ ...dongDangCo(), soDo });
  /**
   * Phía payload cũng nhận hình dáng TỰ DO trong vài test dưới đây.
   * `DongHangMoi.soDo` khai `{nhan, giaTri}[]` (mapper hôm nay sinh đúng thế), nhưng cột
   * CSDL là `jsonb` không ràng buộc và `bangJson` là hàm so JSON chung — nó phải đúng cho
   * cả object lồng và khoá thiếu, tức những hình dáng mà kiểu của mapper không nói ra được.
   */
  const moiVoi = (soDo: unknown) => ({ ...dongMoi(), soDo }) as unknown as DongHangMoi;

  it('cùng nội dung, khoá đảo thứ tự ⇒ KHÔNG đổi', () => {
    // `jsonb` trả về `{nhan, giaTri}` (nhan ngắn hơn); mapper dựng object literal của nó.
    const dangCo = voi([{ giaTri: 'Đỏ', nhan: 'Màu' }]);
    const moi = { ...dongMoi(), soDo: [{ nhan: 'Màu', giaTri: 'Đỏ' }] };
    expect(soSanhDongHang([dangCo], [moi]).sua).toEqual([]);
  });

  /**
   * Ca VỠ của bản cũ: `ghiChu` và `giaTri` CÙNG 6 ký tự, nên `jsonb` sắp bytewise
   * (`ghiChu` trước `giaTri`) khác thứ tự object literal — `JSON.stringify` ra hai chuỗi
   * khác nhau và mọi dòng hàng báo "đã đổi" ở mọi lượt đồng bộ.
   */
  it('khoá CÙNG ĐỘ DÀI đảo thứ tự vẫn KHÔNG đổi — ca mà so chuỗi làm vỡ', () => {
    const dangCo = voi([{ nhan: 'Màu', ghiChu: 'x', giaTri: 'Đỏ' }]);
    const moi = { ...dongMoi(), soDo: [{ nhan: 'Màu', giaTri: 'Đỏ', ghiChu: 'x' }] };
    expect(soSanhDongHang([dangCo], [moi]).sua).toEqual([]);
  });

  it('object lồng nhau cũng so sâu', () => {
    const dangCo = voi([{ nhan: 'A', giaTri: { b: 1, a: 2 } }]);
    expect(soSanhDongHang([dangCo], [moiVoi([{ giaTri: { a: 2, b: 1 }, nhan: 'A' }])]).sua).toEqual([]);
  });

  it('object lồng KHÁC một giá trị thì vẫn ra sua', () => {
    const dangCo = voi([{ nhan: 'A', giaTri: { a: 2, b: 1 } }]);
    expect(soSanhDongHang([dangCo], [moiVoi([{ nhan: 'A', giaTri: { a: 2, b: 9 } }])]).sua).toHaveLength(1);
  });

  it('nội dung KHÁC thì vẫn ra sua — so sâu không được nuốt thay đổi thật', () => {
    const dangCo = voi([{ nhan: 'Màu', giaTri: 'Đỏ' }]);
    const moi = { ...dongMoi(), soDo: [{ nhan: 'Màu', giaTri: 'Xanh' }] };
    expect(soSanhDongHang([dangCo], [moi]).sua).toHaveLength(1);
  });

  it('thiếu/thừa một khoá là đổi', () => {
    const dangCo = voi([{ nhan: 'Màu', giaTri: 'Đỏ' }]);
    expect(soSanhDongHang([dangCo], [moiVoi([{ nhan: 'Màu' }])]).sua).toHaveLength(1);
    expect(soSanhDongHang([voi([{ nhan: 'Màu' }])], [moiVoi([{ nhan: 'Màu', giaTri: 'Đỏ' }])]).sua)
      .toHaveLength(1);
  });

  it('object KHÔNG bằng chuỗi, mảng KHÔNG bằng object', () => {
    expect(soSanhDongHang([voi([{ nhan: 'A', giaTri: { x: 1 } }])],
      [moiVoi([{ nhan: 'A', giaTri: 'x' }])]).sua).toHaveLength(1);
    expect(soSanhDongHang([voi({ nhan: 'A' })], [moiVoi([{ nhan: 'A' }])]).sua).toHaveLength(1);
  });

  // Thứ tự PHẦN TỬ MẢNG là nội dung: đảo hai ô khách nhập là một thay đổi thật.
  it('đảo thứ tự PHẦN TỬ của mảng LÀ đổi', () => {
    const dangCo = voi([{ nhan: 'A', giaTri: '1' }, { nhan: 'B', giaTri: '2' }]);
    const moi = { ...dongMoi(), soDo: [{ nhan: 'B', giaTri: '2' }, { nhan: 'A', giaTri: '1' }] };
    expect(soSanhDongHang([dangCo], [moi]).sua).toHaveLength(1);
  });

  /** `null` (dòng cũ, có trước khi cột tồn tại) KHÁC mảng rỗng (khách không nhập ô nào) —
   *  giữ nguyên nếp của bản cũ. Hệ quả đúng chiều: dòng `null` được ghi lại MỘT lần rồi
   *  thôi, không phải mỗi lượt đồng bộ. */
  it('null KHÁC mảng rỗng — ghi lại một lần rồi im, không lặp mỗi lượt', () => {
    expect(soSanhDongHang([voi(null)], [{ ...dongMoi(), soDo: [] }]).sua).toHaveLength(1);
    expect(soSanhDongHang([voi([])], [{ ...dongMoi(), soDo: [] }]).sua).toEqual([]);
  });

  it('số và chuỗi KHÔNG lẫn nhau', () => {
    expect(soSanhDongHang([voi([{ nhan: 'A', giaTri: 1 }])],
      [moiVoi([{ nhan: 'A', giaTri: '1' }])]).sua).toHaveLength(1);
  });
});
