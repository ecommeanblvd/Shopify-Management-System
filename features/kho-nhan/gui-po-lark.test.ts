import { describe, it, expect } from 'vitest';
import { quyetDinhGui, duocXoaRecord } from './gui-po-lark';
import { COT_SELECT_ORDER, COT_ORDER_FINAL, COT_SKU_FINAL } from './wh-lark-payload';

describe('quyetDinhGui', () => {
  it('có mã đơn Shopify → đường ĐƠN', () => {
    expect(quyetDinhGui({ maDon: '#MBLVD30711', poOrderNumber: null, sku: 'A-1' }))
      .toEqual({ ok: true, kieu: 'don', maDon: '#MBLVD30711', sku: 'A-1' });
  });

  /* Chính ca Bảo báo 09/10/2026. Hàng PO cố ý để `order_id` NULL (xem `ghiNhanChiecPo`), nên
     bản cũ đòi mã đơn Shopify làm mọi món PO rơi vào "thiếu mã đơn hoặc SKU". */
  it('không có mã đơn nhưng có mã PO → đường PO, KHÔNG còn bị bỏ qua', () => {
    expect(quyetDinhGui({ maDon: null, poOrderNumber: '#MBLVDPO52', sku: 'A-1' }))
      .toEqual({ ok: true, kieu: 'po', maDon: '#MBLVDPO52', sku: 'A-1' });
  });

  it('thiếu SKU → từ chối, vì `Lineitem SKU final` trống là Định danh cụt', () => {
    expect(quyetDinhGui({ maDon: '#MBLVD1', poOrderNumber: null, sku: null }))
      .toEqual({ ok: false, lyDo: 'thiếu SKU' });
    expect(quyetDinhGui({ maDon: '#MBLVD1', poOrderNumber: null, sku: '   ' }))
      .toEqual({ ok: false, lyDo: 'thiếu SKU' });
  });

  it('không có mã nào → từ chối, và nói rõ thiếu CẢ HAI', () => {
    expect(quyetDinhGui({ maDon: null, poOrderNumber: null, sku: 'A-1' }))
      .toEqual({ ok: false, lyDo: 'thiếu mã đơn và mã PO' });
  });

  /* Đoán hộ ở đây là ghi một dòng sai nguồn lên bảng vận hành rồi không truy lại được. */
  it('vừa có mã đơn vừa có mã PO → TỪ CHỐI, không tự chọn bên nào', () => {
    expect(quyetDinhGui({ maDon: '#MBLVD1', poOrderNumber: '#MBLVDPO52', sku: 'A-1' }))
      .toEqual({ ok: false, lyDo: 'vừa có mã đơn vừa có mã PO — cần người kiểm tay' });
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
