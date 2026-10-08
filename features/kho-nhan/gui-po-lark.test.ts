import { describe, it, expect } from 'vitest';
import { quyetDinhGui, duocXoaRecord } from './gui-po-lark';
import { COT_SELECT_ORDER, COT_ORDER_FINAL, COT_SKU_FINAL } from './wh-lark-payload';

describe('quyetDinhGui', () => {
  it('có mã đơn Shopify → đường ĐƠN', () => {
    expect(quyetDinhGui({ maDon: '#MBLVD30711', poOrderNumber: null, monOrderNumber: null, monRecordId: null, sku: 'A-1' }))
      .toEqual({ ok: true, kieu: 'don', maDon: '#MBLVD30711', sku: 'A-1' });
  });

  /* Chính ca Bảo báo 09/10/2026. Hàng PO cố ý để `order_id` NULL (xem `ghiNhanChiecPo`), nên
     bản cũ đòi mã đơn Shopify làm mọi món PO rơi vào "thiếu mã đơn hoặc SKU". */
  it('không có mã đơn nhưng có mã PO → đường PO, KHÔNG còn bị bỏ qua', () => {
    expect(quyetDinhGui({ maDon: null, poOrderNumber: '#MBLVDPO52', monOrderNumber: null, monRecordId: null, sku: 'A-1' }))
      .toEqual({ ok: true, kieu: 'po', maDon: '#MBLVDPO52', sku: 'A-1' });
  });

  it('thiếu SKU → từ chối, vì `Lineitem SKU final` trống là Định danh cụt', () => {
    expect(quyetDinhGui({ maDon: '#MBLVD1', poOrderNumber: null, monOrderNumber: null, monRecordId: null, sku: null }))
      .toEqual({ ok: false, lyDo: 'thiếu SKU' });
    expect(quyetDinhGui({ maDon: '#MBLVD1', poOrderNumber: null, monOrderNumber: null, monRecordId: null, sku: '   ' }))
      .toEqual({ ok: false, lyDo: 'thiếu SKU' });
  });

  it('không có mã nào → từ chối, và nói rõ thiếu CẢ HAI', () => {
    expect(quyetDinhGui({ maDon: null, poOrderNumber: null, monOrderNumber: null, monRecordId: null, sku: 'A-1' }))
      .toEqual({ ok: false, lyDo: 'thiếu mã đơn, mã PO và món Lark' });
  });

  /* Đoán hộ ở đây là ghi một dòng sai nguồn lên bảng vận hành rồi không truy lại được. */
  it('nhiều nguồn cùng lúc → TỪ CHỐI, không tự chọn bên nào', () => {
    expect(quyetDinhGui({ maDon: '#MBLVD1', poOrderNumber: '#MBLVDPO52', monOrderNumber: null, monRecordId: null, sku: 'A-1' }))
      .toEqual({ ok: false, lyDo: 'chiếc này mang nhiều nguồn cùng lúc — cần người kiểm tay' });
  });
});

const lienKet = (ids: string[]) => ({ [COT_SELECT_ORDER]: [{ record_ids: ids }] });

describe('duocXoaRecord — đường ĐƠN', () => {
  it('còn liên kết món → cho xoá', () => {
    expect(duocXoaRecord(lienKet(['recX']), { kieu: 'don' })).toEqual({ ok: true });
  });

  /* Mất liên kết = có người đã đụng vào dòng đó. Giữ nguyên luật cũ, không nới. */
  it('mất liên kết món → CHẶN', () => {
    expect(duocXoaRecord(lienKet([]), { kieu: 'don' })).toEqual({
      ok: false, loi: 'Record trên Lark không còn liên kết món — KHÔNG xoá, cần người kiểm tay.',
    });
    expect(duocXoaRecord({}, { kieu: 'don' }).ok).toBe(false);
    expect(duocXoaRecord(null, { kieu: 'don' }).ok).toBe(false);
  });
});

describe('duocXoaRecord — đường PO', () => {
  const po = { kieu: 'po' as const, maDon: '#MBLVDPO52', sku: 'Lamai-LM-26V086-L-NLAT-PLA' };

  /* Dòng PO KHÔNG có liên kết đơn và đó là trạng thái đúng — dùng nguyên hàng rào liên kết thì
     mọi dòng PO đều bị từ chối xoá, kho nhận nhầm một chiếc là mắc kẹt. */
  it('không có liên kết đơn vẫn cho xoá, miễn mã đơn + SKU khớp', () => {
    expect(duocXoaRecord(
      { [COT_ORDER_FINAL]: '#MBLVDPO52', [COT_SKU_FINAL]: 'Lamai-LM-26V086-L-NLAT-PLA' }, po,
    )).toEqual({ ok: true });
  });

  it('bỏ qua khác biệt dấu `#` — hai bảng không nhất quán dấu này', () => {
    expect(duocXoaRecord(
      { [COT_ORDER_FINAL]: 'MBLVDPO52', [COT_SKU_FINAL]: 'Lamai-LM-26V086-L-NLAT-PLA' }, po,
    )).toEqual({ ok: true });
  });

  it('ô TEXT nhiều đoạn (Lark trả mảng) vẫn đọc ra chữ', () => {
    expect(duocXoaRecord({
      [COT_ORDER_FINAL]: [{ text: '#MBLVDPO52' }],
      [COT_SKU_FINAL]: [{ text: 'Lamai-LM-26V086-L-NLAT-PLA' }],
    }, po)).toEqual({ ok: true });
  });

  /* Hàng rào thật: xoá dòng của chiếc KHÁC là mất một bản ghi vận hành không ai dựng lại được. */
  it('SKU lệch → CHẶN, và nói rõ dòng Lark đang là gì', () => {
    const r = duocXoaRecord(
      { [COT_ORDER_FINAL]: '#MBLVDPO52', [COT_SKU_FINAL]: 'SKU-KHAC' }, po);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.loi).toContain('SKU-KHAC');
  });

  it('mã đơn lệch → CHẶN', () => {
    expect(duocXoaRecord(
      { [COT_ORDER_FINAL]: '#MBLVDPO51', [COT_SKU_FINAL]: 'Lamai-LM-26V086-L-NLAT-PLA' }, po,
    ).ok).toBe(false);
  });

  it('dòng Lark trống mã đơn hoặc SKU → CHẶN, không coi "trống khớp trống"', () => {
    expect(duocXoaRecord({ [COT_ORDER_FINAL]: '', [COT_SKU_FINAL]: '' }, po).ok).toBe(false);
    expect(duocXoaRecord({}, po).ok).toBe(false);
    expect(duocXoaRecord(null, po).ok).toBe(false);
  });
});

/* Kênh KHÔNG-Shopify (CEO 08/10/2026): đơn TQ `#MTB`/`#MXHS` nằm ở bảng món, không ở
   `shopify_orders`. Payload giống y đường đơn — chỉ khác nguồn của mã đơn và của liên kết. */
describe('quyetDinhGui — kênh món Lark', () => {
  const mon = (p: Partial<Parameters<typeof quyetDinhGui>[0]> = {}) => quyetDinhGui({
    maDon: null, poOrderNumber: null,
    monOrderNumber: '#MXHS1560', monRecordId: 'reczz28KpiFLcTyn', sku: 'Beloved-FW25-S', ...p,
  });

  it('chỉ có món Lark → đường `mon`, mang theo record_id để nối liên kết', () => {
    expect(mon()).toEqual({
      ok: true, kieu: 'mon', maDon: '#MXHS1560', sku: 'Beloved-FW25-S',
      monRecordId: 'reczz28KpiFLcTyn',
    });
  });

  /* 183 dòng MTB/MXHS đội kho đang có trên bảng vận hành đều là `Retail` CÓ liên kết. Rơi về
     payload không liên kết là dòng trông y hệt dòng PO và mất đường truy về món. */
  it('món Lark mà thiếu record_id → TỪ CHỐI, không rơi về payload không liên kết', () => {
    expect(mon({ monRecordId: null })).toEqual({
      ok: false, lyDo: 'món Lark chưa có record_id — không nối được liên kết đơn',
    });
    expect(mon({ monRecordId: '  ' }).ok).toBe(false);
  });

  it('mã đơn Shopify thắng, món Lark không được xét cùng lúc', () => {
    expect(mon({ maDon: '#MBLVD30711' })).toEqual({
      ok: false, lyDo: 'chiếc này mang nhiều nguồn cùng lúc — cần người kiểm tay',
    });
    expect(mon({ poOrderNumber: '#MBLVDPO52' }).ok).toBe(false);
  });

  it('không nguồn nào → câu lỗi kể đủ ba nguồn', () => {
    expect(mon({ monOrderNumber: null, monRecordId: null })).toEqual({
      ok: false, lyDo: 'thiếu mã đơn, mã PO và món Lark',
    });
  });

  /* Dòng WH của kênh Lark CÓ liên kết đơn, nên hàng rào xoá là hàng rào liên kết — giống đường
     đơn, KHÔNG giống đường PO. */
  it('hàng rào xoá của kênh Lark dùng luật liên kết như đường đơn', () => {
    expect(duocXoaRecord(lienKet(['recX']), { kieu: 'don' })).toEqual({ ok: true });
    expect(duocXoaRecord(lienKet([]), { kieu: 'don' }).ok).toBe(false);
  });
});
