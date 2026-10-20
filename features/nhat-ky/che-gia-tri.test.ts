import { describe, expect, it } from 'vitest';
import { CAU_HINH } from './cot-theo-doi';
import { DO_NHAY, QUYEN_DO_NHAY, cheNeuCan } from './che-gia-tri';
import { NHAN_COT, nhanCot } from './nhan-cot';

describe('cheNeuCan', () => {
  it('cột nhạy cảm bị che khi thiếu quyền, và NÓI RÕ là bị che', () => {
    const r = cheNeuCan('shopify_orders', 'cost_override', '120000', []);
    expect(r).toEqual({ gia: null, biChe: true });
  });

  it('cột nhạy cảm hiện đủ khi có quyền', () => {
    expect(cheNeuCan('shopify_orders', 'cost_override', '120000', ['view_cogs']))
      .toEqual({ gia: '120000', biChe: false });
  });

  it('cột của bảng đang sống hiện đủ khi có quyền của màn hình gốc', () => {
    expect(cheNeuCan('goods_receipt_items', 'qc_result', 'pass', ['view_fulfillment']))
      .toEqual({ gia: 'pass', biChe: false });
  });

  it('giá vốn từng chiếc gác đúng quyền màn kho, không gác bằng quyền giá vốn mức đơn', () => {
    expect(cheNeuCan('goods_receipt_items', 'dom_price', '450000', ['view_fulfillment']).biChe).toBe(false);
    expect(cheNeuCan('goods_receipt_items', 'global_price', '19.5', ['view_fulfillment']).biChe).toBe(false);
    // Thiếu quyền màn kho thì che, dù có quyền giá vốn mức đơn.
    expect(cheNeuCan('goods_receipt_items', 'dom_price', '450000', ['view_cogs']).biChe).toBe(true);
    expect(cheNeuCan('goods_receipt_items', 'dom_price', '450000', []).biChe).toBe(true);
  });

  // Review Focus #2 — mặc định AN TOÀN, không mặc định lộ.
  it('cột CHƯA khai độ nhạy thì bị CHE, không phải hiện', () => {
    const r = cheNeuCan('shopify_orders', 'cot_moi_chua_ai_khai', 'x', []);
    expect(r.biChe).toBe(true);
  });

  it('cột chưa khai vẫn che kể cả khi người dùng có nhiều quyền', () => {
    expect(cheNeuCan('shopify_orders', 'cot_moi_chua_ai_khai', 'x', ['view_cogs', 'view_orders']).biChe).toBe(true);
  });

  it('NULL vẫn là NULL khi không bị che — không nhập nhằng với ô bị che', () => {
    expect(cheNeuCan('goods_receipt_items', 'qc_fail_reason', null, ['view_fulfillment']))
      .toEqual({ gia: null, biChe: false });
  });

  // C1 của lượt soát cuối: luật mặc-định-che phải áp ở MỨC BẢNG nữa, không chỉ bên trong
  // bảng đã khai. Bản cũ chỉ che cột chưa khai của bảng CÓ MẶT, nên 7/10 bảng của
  // `CAU_HINH` mở sạch — gồm chính bảng đang có trigger sống.
  it('bảng CHƯA khai trong DO_NHAY thì bị che toàn bộ', () => {
    expect(cheNeuCan('bang_chua_ai_khai', 'cot_vo_hai', 'x', [])).toEqual({ gia: null, biChe: true });
  });

  it('bảng chưa khai vẫn che dù người xem có mọi quyền của DO_NHAY', () => {
    expect(cheNeuCan('bang_chua_ai_khai', 'cot_vo_hai', 'x', QUYEN_DO_NHAY).biChe).toBe(true);
  });

  it('giá vốn dòng đơn đòi đúng quyền giá vốn, quyền xem đơn là KHÔNG đủ', () => {
    expect(cheNeuCan('shopify_order_lines', 'cost_override', '9.5', ['view_orders']).biChe).toBe(true);
    expect(cheNeuCan('shopify_order_lines', 'cost_override', '9.5', ['view_cogs']).biChe).toBe(false);
  });

  it('bảng kê cước ship hộ đòi quyền xem ship hộ', () => {
    expect(cheNeuCan('ship_ho_orders', 'quote_breakdown', '{"fuel":12}', []).biChe).toBe(true);
    expect(cheNeuCan('ship_ho_orders', 'quote_breakdown', '{"fuel":12}', ['view_ship_ho']).biChe).toBe(false);
  });

  it('thông tin cá nhân người nhận ship hộ KHÔNG khai nên bị che với mọi quyền', () => {
    expect(cheNeuCan('ship_ho_orders', 'recipient_email', 'a@b.com', ['view_ship_ho', 'manage_ship_ho']).biChe).toBe(true);
  });

  // `__proto__`/`constructor` tới từ cột `bang`/`truong` của CSDL. Tra bằng kế thừa
  // prototype sẽ trả về hàm của Object và biến "chưa khai" thành "đã khai" — hướng sai.
  it('tên bảng/cột trùng thuộc tính của Object vẫn bị che', () => {
    expect(cheNeuCan('constructor', 'constructor', 'x', []).biChe).toBe(true);
    expect(cheNeuCan('shopify_orders', 'constructor', 'x', []).biChe).toBe(true);
  });
});

describe('DO_NHAY', () => {
  it('khai ba bảng spec §7 nêu, cộng hai bảng đang có trigger sống', () => {
    expect(Object.keys(DO_NHAY).sort()).toEqual([
      'goods_receipt_items', 'goods_receipts',
      'ship_ho_orders', 'shopify_order_lines', 'shopify_orders',
    ]);
  });

  /**
   * Bảng của `CAU_HINH` mà chưa khai ở `DO_NHAY` thì nhật ký của nó hiện `•••` sạch — đó
   * là CHỦ Ý (mặc định an toàn), nhưng phải là chủ ý NÓI RA. Test này không bắt lỗi; nó
   * ghim danh sách để ngày ai đó bật trigger cho một trong năm bảng này thì thấy ngay là
   * phải khai độ nhạy trước, chứ không mở màn hình ra rồi mới hỏi vì sao trống.
   */
  it('ghim đúng những bảng cố ý CHƯA khai — bật trigger cho chúng thì phải khai trước', () => {
    const chuaKhai = CAU_HINH.map((c) => c.bang).filter((b) => !Object.hasOwn(DO_NHAY, b));
    expect(chuaKhai.sort()).toEqual([
      'inventory_movements', 'order_fulfillment', 'order_fulfillment_lines',
      'shipments', 'warehouse_inventory',
    ]);
  });

  // Chiều quan trọng: cột ĐƯỢC THEO DÕI của bảng đã có mặt trong `DO_NHAY` thì phải
  // được khai, nếu không nó hiện `•••` cho cả admin và không ai sửa được mặc định đó
  // ngoài việc đọc tệp này. (Chiều ngược lại không kiểm: khai sẵn một cột chưa theo dõi
  // là chủ ý — xem `shopify_orders.cost_override`.)
  it('mọi cột được theo dõi của bảng có mặt trong DO_NHAY đều đã khai độ nhạy', () => {
    for (const ch of CAU_HINH) {
      if (ch.cheDo !== 'cho-phep') continue;
      const khai = DO_NHAY[ch.bang];
      if (!khai) continue;
      for (const cot of ch.cot) expect(Object.keys(khai)).toContain(cot);
    }
  });

  /**
   * Hai bảng chế độ `tru` chạy thật thì danh sách cột nằm ở CSDL, `vitest` không chạm
   * được. Thay cho nó: mọi cột đã có NHÃN tiếng Việt (tức cột người ta chắc chắn sẽ đọc
   * trên màn hình) phải có khai độ nhạy — thiếu một dòng là cột đó hiện `•••` cho cả CEO.
   */
  it('cột đã có nhãn của hai bảng đang sống đều đã khai độ nhạy', () => {
    for (const bang of ['goods_receipts', 'goods_receipt_items']) {
      const khai = Object.keys(DO_NHAY[bang]);
      for (const cot of Object.keys(NHAN_COT[bang])) expect(khai).toContain(cot);
    }
  });

  it('QUYEN_DO_NHAY gom đủ quyền đang dùng, không trùng', () => {
    const dung = new Set(Object.values(DO_NHAY).flatMap((b) => Object.values(b)));
    expect(new Set(QUYEN_DO_NHAY)).toEqual(dung);
    expect(QUYEN_DO_NHAY.length).toBe(dung.size);
  });
});

describe('nhanCot', () => {
  it('nhãn cột là tiếng Việt người dùng đang thấy trên màn hình', () => {
    expect(nhanCot('goods_receipt_items', 'qc_result')).toBe('Kết quả QC');
  });

  it('cột chưa có nhãn thì hiện TÊN CỘT, không để trống', () => {
    expect(nhanCot('goods_receipt_items', 'cot_la')).toBe('cot_la');
  });

  it('bảng chưa có nhãn nào thì cũng hiện tên cột', () => {
    expect(nhanCot('bang_la', 'cot_la')).toBe('cot_la');
  });

  it('tên cột trùng thuộc tính của Object không trả về hàm của Object', () => {
    expect(nhanCot('goods_receipt_items', 'constructor')).toBe('constructor');
    expect(nhanCot('constructor', 'qc_result')).toBe('qc_result');
  });
});
