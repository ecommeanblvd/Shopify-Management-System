import { describe, expect, it } from 'vitest';
import { gomKhoi, type DongTho } from './gom-dong';

describe('gomKhoi', () => {
  it('thay đổi cùng người, cùng lúc, cùng bản ghi gom thành MỘT khối', () => {
    const k = gomKhoi([
      { bang: 'goods_receipt_items', banGhiId: 'r1', thaoTac: 'sua', truong: 'qc_result', truoc: 'pending', sau: 'pass', tacNhanId: 'u1', tacNhanNhan: null, luc: new Date('2026-10-20T03:00:00Z') },
      { bang: 'goods_receipt_items', banGhiId: 'r1', thaoTac: 'sua', truong: 'qc_checked_by', truoc: null, sau: 'u1', tacNhanId: 'u1', tacNhanNhan: null, luc: new Date('2026-10-20T03:00:00Z') },
    ], []);
    expect(k).toHaveLength(1);
    expect(k[0].dong).toHaveLength(2);
  });

  it('cùng lúc nhưng KHÁC người thì KHÔNG gom', () => {
    const k = gomKhoi([
      { bang: 'g', banGhiId: 'r1', thaoTac: 'sua', truong: 'a', truoc: null, sau: '1', tacNhanId: 'u1', tacNhanNhan: null, luc: new Date('2026-10-20T03:00:00Z') },
      { bang: 'g', banGhiId: 'r1', thaoTac: 'sua', truong: 'b', truoc: null, sau: '2', tacNhanId: 'u2', tacNhanNhan: null, luc: new Date('2026-10-20T03:00:00Z') },
    ], []);
    expect(k).toHaveLength(2);
  });

  it('không có danh tính thì nhãn là "Chưa gắn danh tính", KHÔNG để trống', () => {
    const k = gomKhoi([{ bang: 'g', banGhiId: 'r1', thaoTac: 'sua', truong: 'a', truoc: null, sau: '1', tacNhanId: null, tacNhanNhan: null, luc: new Date() }], []);
    expect(k[0].tacNhanNhan).toBe('Chưa gắn danh tính');
  });

  it('tác nhân máy giữ nguyên nhãn của nó', () => {
    const k = gomKhoi([{ bang: 'g', banGhiId: 'r1', thaoTac: 'sua', truong: 'a', truoc: null, sau: '1', tacNhanId: null, tacNhanNhan: 'Đồng bộ Lark', luc: new Date() }], []);
    expect(k[0].tacNhanNhan).toBe('Đồng bộ Lark');
  });

  it('khối mới nhất đứng trước', () => {
    const k = gomKhoi([
      { bang: 'g', banGhiId: 'r1', thaoTac: 'sua', truong: 'a', truoc: null, sau: '1', tacNhanId: 'u1', tacNhanNhan: null, luc: new Date('2026-10-19T00:00:00Z') },
      { bang: 'g', banGhiId: 'r1', thaoTac: 'sua', truong: 'b', truoc: null, sau: '2', tacNhanId: 'u1', tacNhanNhan: null, luc: new Date('2026-10-20T00:00:00Z') },
    ], []);
    expect(k[0].luc.toISOString()).toBe('2026-10-20T00:00:00.000Z');
  });

  // Tab Lịch sử của một lô nhập kho cuốn cả dòng con (spec §6): hai bản ghi KHÁC nhau
  // thì phải là hai khối, không thì màn hình không chỉ ra được chiếc nào bị sửa.
  it('cùng người cùng lúc nhưng KHÁC bản ghi thì KHÔNG gom', () => {
    const luc = new Date('2026-10-20T03:00:00Z');
    const k = gomKhoi([
      { bang: 'goods_receipt_items', banGhiId: 'chiec-1', thaoTac: 'sua', truong: 'qc_result', truoc: 'pending', sau: 'pass', tacNhanId: 'u1', tacNhanNhan: null, luc },
      { bang: 'goods_receipt_items', banGhiId: 'chiec-2', thaoTac: 'sua', truong: 'qc_result', truoc: 'pending', sau: 'fail', tacNhanId: 'u1', tacNhanNhan: null, luc },
    ], []);
    expect(k).toHaveLength(2);
    expect(k.map((x) => x.banGhiId).sort()).toEqual(['chiec-1', 'chiec-2']);
  });

  it('nhãn trường là tiếng Việt, không phải tên cột', () => {
    // Quyền của màn kho phải truyền vào: `DO_NHAY` che mặc định, nên `[]` ra `•••` và test
    // sẽ kiểm nhãn trên một dòng đã bị che — tức không kiểm gì cả.
    const k = gomKhoi([{ bang: 'goods_receipt_items', banGhiId: 'r1', thaoTac: 'sua', truong: 'qc_result', truoc: 'pending', sau: 'pass', tacNhanId: 'u1', tacNhanNhan: null, luc: new Date() }], ['view_fulfillment']);
    expect(k[0].dong[0]).toEqual({ truong: 'qc_result', nhan: 'Kết quả QC', truoc: 'pending', sau: 'pass', biChe: false });
  });

  // Ruling 1 của kế hoạch: che thì che CẢ HAI đầu, một cờ cho cả dòng.
  it('cột nhạy cảm thiếu quyền thì CẢ truoc và sau bị che', () => {
    const r: DongTho = { bang: 'shopify_order_lines', banGhiId: 'd1', thaoTac: 'sua', truong: 'cost_override', truoc: '9.5', sau: '12', tacNhanId: 'u1', tacNhanNhan: null, luc: new Date() };
    expect(gomKhoi([r], [])[0].dong[0]).toEqual({ truong: 'cost_override', nhan: 'Giá vốn nhập tay', truoc: null, sau: null, biChe: true });
    expect(gomKhoi([r], ['view_cogs'])[0].dong[0]).toEqual({ truong: 'cost_override', nhan: 'Giá vốn nhập tay', truoc: '9.5', sau: '12', biChe: false });
  });

  it('người đủ quyền ở cột này vẫn bị che ở cột khác trong cùng một khối', () => {
    const luc = new Date('2026-10-20T03:00:00Z');
    const k = gomKhoi([
      { bang: 'shopify_order_lines', banGhiId: 'd1', thaoTac: 'sua', truong: 'quantity', truoc: '1', sau: '2', tacNhanId: 'u1', tacNhanNhan: null, luc },
      { bang: 'shopify_order_lines', banGhiId: 'd1', thaoTac: 'sua', truong: 'cost_override', truoc: '9.5', sau: '12', tacNhanId: 'u1', tacNhanNhan: null, luc },
    ], ['view_orders']);
    expect(k).toHaveLength(1);
    expect(k[0].dong.map((d) => d.biChe)).toEqual([false, true]);
    expect(k[0].dong[1].sau).toBeNull();
  });

  it('người đã xoá / tra không ra tên thì hiện id, vẫn KHÔNG để trống', () => {
    const k = gomKhoi([{ bang: 'g', banGhiId: 'r1', thaoTac: 'sua', truong: 'a', truoc: null, sau: '1', tacNhanId: 'u-mat-tich', tacNhanNhan: null, luc: new Date() }], []);
    expect(k[0].tacNhanNhan).toBe('u-mat-tich');
    expect(k[0].tacNhanId).toBe('u-mat-tich');
  });

  it('danh sách rỗng trả về rỗng', () => {
    expect(gomKhoi([], [])).toEqual([]);
  });
});

/**
 * I1 của lượt soát cuối: `thao_tac` được trigger ghi từ migration 0210 nhưng không ai đọc,
 * nên một lượt XOÁ một bản ghi hiện ra y hệt một người xoá trắng từng ô.
 */
describe('gomKhoi · thaoTac', () => {
  const luc = new Date('2026-10-20T03:00:00Z');
  const d = (truong: string, thaoTac: string): DongTho => ({
    bang: 'goods_receipt_items', banGhiId: 'chiec-1', thaoTac, truong,
    truoc: 'a', sau: 'b', tacNhanId: 'u1', tacNhanNhan: null, luc,
  });

  it('xoá một bản ghi: cả khối mang nhãn xoa, không phải sua', () => {
    const k = gomKhoi([d('qc_result', 'xoa'), d('location', 'xoa')], ['view_fulfillment']);
    expect(k).toHaveLength(1);
    expect(k[0].thaoTac).toBe('xoa');
  });

  it('bản ghi mới: nhãn them', () => {
    expect(gomKhoi([d('sku', 'them')], ['view_fulfillment'])[0].thaoTac).toBe('them');
  });

  // Mọi dòng của MỘT giao dịch mang cùng `luc` nên xoá-rồi-chèn-lại cùng bản ghi vào CÙNG
  // khối. Chọn bừa một nhãn là nói sai về bằng chứng.
  it('khối lẫn xoá và thêm ra tron, không lấy nhãn của dòng đầu', () => {
    expect(gomKhoi([d('sku', 'xoa'), d('sku', 'them')], ['view_fulfillment'])[0].thaoTac).toBe('tron');
  });

  // `thao_tac` là `text NOT NULL` không có CHECK, nên một đường ghi khác nhét được chuỗi lạ.
  it('hằng lạ ra "la", KHÔNG im lặng coi là sua', () => {
    expect(gomKhoi([d('sku', 'UPDATE')], ['view_fulfillment'])[0].thaoTac).toBe('la');
  });
});
