import { describe, it, expect } from 'vitest';
import { xuLyQuet, xenKeHaiNguon, type MonDeQuet } from './quet';
import { maTemChoMon, bienTheChoMon } from './noi-mon-dong-don';

/**
 * Id phía DỮ LIỆU phải là GID ĐẦY ĐỦ, y như DB lưu — đo 23/09/2026:
 * `lark_mon_don.shopify_line_id` 6225/6225 là gid, 0 số trần; `shopify_order_lines` cũng vậy.
 * Bộ test cũ dùng '111'/'222' cả hai phía nên TỰ NHẤT QUÁN và không chứng minh được gì: nó để
 * lọt đúng cái bug làm cả luồng quét không dùng được (review cuối 23/09/2026 Critical 1). Tem
 * thì chỉ mang SỐ TRẦN, nên mọi test ở đây đặt gid một bên và số trần bên kia.
 */
const LINE_GID = 'gid://shopify/LineItem/14593977155752';
const LINE_SO = '14593977155752';
const LINE_GID_2 = 'gid://shopify/LineItem/17999132033319';
const LINE_SO_2 = '17999132033319';
const VAR_GID = 'gid://shopify/ProductVariant/45163940544678';
const VAR_SO = '45163940544678';

const m = (dinhDanh: string, o: Partial<MonDeQuet> = {}): MonDeQuet =>
  ({ dinhDanh, sku: null, shopifyLineId: null, shopifyVariantId: null, daXuLy: false, ...o });

describe('xuLyQuet', () => {
  it('quét mã đơn → mở đơn', () => {
    expect(xuLyQuet('O:999', [])).toEqual({ loai: 'mo_don', shopifyOrderId: '999' });
  });

  it('TEM DO CHÍNH HỆ IN RA, dán lên món của đơn ĐANG MỞ → chọn đúng món đó', () => {
    // Đi trọn vòng: in tem từ id gid trong DB rồi quét lại chính chuỗi ấy.
    const maTem = maTemChoMon({ shopifyLineId: LINE_GID });
    expect(maTem).toBe(`L:${LINE_SO}`);
    const ds = [m('dd1', { shopifyLineId: LINE_GID_2 }), m('dd2', { shopifyLineId: LINE_GID })];
    expect(xuLyQuet(maTem!, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd2' });
  });

  it('quét tem món của đơn ĐANG MỞ (id trong DB là gid) → chọn đúng món', () => {
    const ds = [m('dd1', { shopifyLineId: LINE_GID }), m('dd2', { shopifyLineId: LINE_GID_2 })];
    expect(xuLyQuet(`L:${LINE_SO_2}`, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd2' });
  });

  it('quét tem món KHÔNG thuộc đơn đang mở → báo đơn khác, không tự nhảy', () => {
    expect(xuLyQuet('L:999', [m('dd1', { shopifyLineId: LINE_GID })]))
      .toEqual({ loai: 'don_khac', shopifyOrderId: '' });
  });

  it('id trong DB là số trần (dữ liệu cũ/demo) vẫn khớp — rút số không phá dạng đã đúng', () => {
    expect(xuLyQuet(`L:${LINE_SO}`, [m('dd1', { shopifyLineId: LINE_SO })]))
      .toEqual({ loai: 'chon_mon', dinhDanh: 'dd1' });
  });

  it('gid khác loại tài nguyên nhưng trùng số → KHÔNG được nhận nhầm là dòng đơn', () => {
    // Tem tự khai loại: 'L:gid://shopify/ProductVariant/…' là mã tự mâu thuẫn → không hiểu.
    expect(xuLyQuet(`L:${VAR_GID}`, [m('dd1', { shopifyLineId: LINE_GID })]))
      .toEqual({ loai: 'khong_hieu', raw: `L:${VAR_GID}` });
  });

  it('quét mã hàng khi đang mở đơn (variant trong DB là gid) → chọn món khớp', () => {
    expect(xuLyQuet(`V:${VAR_SO}`, [m('dd1', { shopifyVariantId: VAR_GID })]))
      .toEqual({ loai: 'chon_mon', dinhDanh: 'dd1' });
  });

  it('quét mã hàng khi chưa mở đơn → đi tìm đơn đang chờ', () => {
    expect(xuLyQuet(`V:${VAR_SO}`, [])).toEqual({ loai: 'tim_bien_the', shopifyVariantId: VAR_SO });
  });

  it('món không có id nào (chưa nối được) → không khớp bừa vào tem nào', () => {
    expect(xuLyQuet(`L:${LINE_SO}`, [m('dd1')])).toEqual({ loai: 'don_khac', shopifyOrderId: '' });
    expect(xuLyQuet(`V:${VAR_SO}`, [m('dd1')])).toEqual({ loai: 'tim_bien_the', shopifyVariantId: VAR_SO });
  });

  it('mã vendor (số trần) → không hiểu, KHÔNG đoán', () => {
    expect(xuLyQuet('8938505974194', [])).toEqual({ loai: 'khong_hieu', raw: '8938505974194' });
  });
  it('SKU trần (chuỗi không tiền tố) → không hiểu, KHÔNG đoán', () => {
    expect(xuLyQuet('SKU-ABC-XL', [])).toEqual({ loai: 'khong_hieu', raw: 'SKU-ABC-XL' });
  });
  it('chuỗi chỉ toàn khoảng trắng → không hiểu, KHÔNG đoán', () => {
    expect(xuLyQuet('  ', [])).toEqual({ loai: 'khong_hieu', raw: '  ' });
  });
  it('quét mã kho cũ → không hiểu ở màn này (màn phiếu cũ mới dùng WH-)', () => {
    expect(xuLyQuet('WH-00009890', [])).toEqual({ loai: 'khong_hieu', raw: 'WH-00009890' });
  });

  describe('mua nhiều cái cùng biến thể — quét lại không được dính mãi vào món đầu', () => {
    it('hai món cùng biến thể, cả hai đều CHƯA xử lý → chọn món đầu tiên', () => {
      const ds = [
        m('dd1', { shopifyVariantId: VAR_GID, daXuLy: false }),
        m('dd2', { shopifyVariantId: VAR_GID, daXuLy: false }),
      ];
      expect(xuLyQuet(`V:${VAR_SO}`, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd1' });
    });
    it('món đầu ĐÃ xử lý, món sau chưa → chọn món CHƯA xử lý (không dính mãi vào món đầu)', () => {
      const ds = [
        m('dd1', { shopifyVariantId: VAR_GID, daXuLy: true }),
        m('dd2', { shopifyVariantId: VAR_GID, daXuLy: false }),
      ];
      expect(xuLyQuet(`V:${VAR_SO}`, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd2' });
    });
    it('cả hai món ĐỀU đã xử lý → vẫn nhận ra món (khớp đầu tiên), không báo "không hiểu"', () => {
      const ds = [
        m('dd1', { shopifyVariantId: VAR_GID, daXuLy: true }),
        m('dd2', { shopifyVariantId: VAR_GID, daXuLy: true }),
      ];
      expect(xuLyQuet(`V:${VAR_SO}`, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd1' });
    });
    /**
     * Hình dạng THẬT đã làm hỏng vòng trước (đơn TA1962, review N1): một đơn có hai món CÙNG SKU
     * CÙNG TÊN, một món đã nối được dòng đơn (đeo tem `L:`), món kia chưa (đeo tem `V:`). Nếu
     * tầng biến thể-theo-SKU rò sang món đã có dòng đơn thì CẢ HAI cùng mang một biến thể, quét
     * `V:` trả về món đeo tem `L:` — kho cân kiện này mà ghi vào dòng kia, màn hình không lộ gì
     * vì hai dòng hiển thị y hệt nhau. Không bộ test nào trước đây dựng hình dạng này.
     */
    it('món ĐÃ có dòng đơn nằm cạnh anh em CÙNG SKU chưa nối → quét V: phải chọn món CHƯA nối', () => {
      // Dựng đúng như `timMonCuaDon` dựng: biến thể theo dòng đơn hiện 0/15828 dòng có giá trị.
      const coDongDon = {
        shopifyLineId: LINE_GID, bienTheTheoDongDon: null, bienTheTheoSku: VAR_GID,
      };
      const chuaNoi = {
        shopifyLineId: null, bienTheTheoDongDon: null, bienTheTheoSku: VAR_GID,
      };
      // Món đã có dòng đơn KHÔNG được mượn biến thể suy từ SKU…
      expect(bienTheChoMon(coDongDon)).toBeNull();
      expect(maTemChoMon({ shopifyLineId: coDongDon.shopifyLineId, shopifyVariantId: bienTheChoMon(coDongDon) }))
        .toBe(`L:${LINE_SO}`);
      // …còn món chưa nối thì phải có, nếu không nó vĩnh viễn không tem.
      expect(bienTheChoMon(chuaNoi)).toBe(VAR_GID);
      expect(maTemChoMon({ shopifyLineId: null, shopifyVariantId: bienTheChoMon(chuaNoi) }))
        .toBe(`V:${VAR_SO}`);

      const ds = [
        m('da_noi', { shopifyLineId: LINE_GID, shopifyVariantId: bienTheChoMon(coDongDon) }),
        m('chua_noi', { shopifyLineId: null, shopifyVariantId: bienTheChoMon(chuaNoi) }),
      ];
      // Quét tem V: → đúng món chưa nối, KHÔNG BAO GIỜ là món đang đeo tem L:.
      expect(xuLyQuet(`V:${VAR_SO}`, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'chua_noi' });
      // Quét tem L: → đúng món đã nối.
      expect(xuLyQuet(`L:${LINE_SO}`, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'da_noi' });
    });

    it('biến thể ĐÃ có từ dòng đơn (sau backfill) thì dùng nó, không rơi xuống tầng SKU', () => {
      expect(bienTheChoMon({ shopifyLineId: LINE_GID, bienTheTheoDongDon: VAR_GID, bienTheTheoSku: 'khac' }))
        .toBe(VAR_GID);
      expect(bienTheChoMon({ shopifyLineId: null, bienTheTheoDongDon: VAR_GID, bienTheTheoSku: 'khac' }))
        .toBe(VAR_GID);
    });

    it('hai món cùng biến thể nhưng KHÁC dòng đơn → tem L: chọn đúng dòng, không nhầm sang cái kia', () => {
      const ds = [
        m('dd1', { shopifyLineId: LINE_GID, shopifyVariantId: VAR_GID }),
        m('dd2', { shopifyLineId: LINE_GID_2, shopifyVariantId: VAR_GID }),
      ];
      expect(xuLyQuet(`L:${LINE_SO_2}`, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd2' });
      expect(xuLyQuet(`L:${LINE_SO}`, ds)).toEqual({ loai: 'chon_mon', dinhDanh: 'dd1' });
    });
  });
});

describe('xenKeHaiNguon — không nguồn nào được bỏ đói', () => {
  const khoa = (x: string) => x;

  it('nguồn 1 dài hơn hạn mức KHÔNG được nuốt sạch chỗ của nguồn 2', () => {
    // Hình dạng thật: quét V:44089420153000 có nguồn 1 trả 38 đơn, nguồn 2 chỉ có MOS10024 —
    // đơn DUY NHẤT thật sự đang đeo cái tem vừa quét. Nối đuôi rồi cắt 20 là mất hẳn nó.
    const n1 = Array.from({ length: 38 }, (_, i) => `SHOP${i}`);
    const n2 = ['MOS10024'];
    const noiDuoi = [...n1, ...n2].slice(0, 20);
    expect(noiDuoi).not.toContain('MOS10024'); // cách CŨ: mất
    const xen = xenKeHaiNguon(n1, n2, khoa, 2);
    expect(xen.slice(0, 20)).toContain('MOS10024'); // cách MỚI: còn
    expect(xen[0]).toBe('MOS10024'); // và đứng ngay đầu
  });

  it('nguồn 2 dài cũng KHÔNG được bỏ đói nguồn 1', () => {
    const n1 = ['SHOP-A', 'SHOP-B'];
    const n2 = Array.from({ length: 50 }, (_, i) => `LARK${i}`);
    const top20 = xenKeHaiNguon(n1, n2, khoa, 2).slice(0, 20);
    expect(top20).toContain('SHOP-A');
    expect(top20).toContain('SHOP-B');
  });

  it('nhịp 1:2 — cứ hai dòng nguồn 2 thì một dòng nguồn 1', () => {
    const xen = xenKeHaiNguon(['a1', 'a2', 'a3'], ['b1', 'b2', 'b3', 'b4'], khoa, 2);
    expect(xen).toEqual(['b1', 'b2', 'a1', 'b3', 'b4', 'a2', 'a3']);
  });

  it('bỏ trùng theo khoá, giữ lần gặp ĐẦU tiên (mỗi vòng nguồn 2 đi trước)', () => {
    // Vòng 1: n2 'X' vào; n1 'X' trùng nên bỏ. Vòng 2: n2 'Z' vào; n1 'Y' vào.
    const xen = xenKeHaiNguon(['X', 'Y'], ['X', 'Z'], khoa, 1);
    expect(xen).toEqual(['X', 'Z', 'Y']);
    expect(new Set(xen).size).toBe(xen.length);
  });

  it('một nguồn rỗng thì nguồn kia ra đủ, đúng thứ tự', () => {
    expect(xenKeHaiNguon(['a', 'b'], [], khoa, 2)).toEqual(['a', 'b']);
    expect(xenKeHaiNguon([], ['x', 'y'], khoa, 2)).toEqual(['x', 'y']);
    expect(xenKeHaiNguon([], [], khoa, 2)).toEqual([]);
  });

  it('khoá ghép là VĂN BẢN THƯỜNG, không byte NUL — và không đụng nhau', () => {
    // Giá trị chứa dấu phân cách "ngây thơ" (dấu cách, gạch) vẫn phải phân biệt được.
    type D = { don: string; sku: string };
    const k = (d: D) => JSON.stringify([d.don, d.sku]);
    const ds = xenKeHaiNguon<D>(
      [{ don: 'A B', sku: 'C' }, { don: 'A', sku: 'B C' }],
      [],
      k,
    );
    expect(ds).toHaveLength(2);
    expect(ds.map(k).every((x) => !x.includes('\u0000'))).toBe(true);
  });
});
