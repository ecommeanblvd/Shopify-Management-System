import { describe, it, expect } from 'vitest';
import { monConNhanDuoc, type DongMonLark } from './mon-lark-con-nhan';

const d = (p: Partial<DongMonLark> = {}): DongMonLark => ({
  dinhDanh: '#MXHS1560-sku-1', orderNumber: 'MXHS1560', sku: 'Beloved-FW25-S-YBAN-PLA',
  store: '#MXHS', huy: false, coRecordId: true, ...p,
});

describe('monConNhanDuoc', () => {
  it('dòng bình thường, chưa nhận → nhận được', () => {
    expect(monConNhanDuoc(d(), 0, true)).toEqual({ ok: true });
  });

  /* Một dòng món = MỘT CHIẾC (đo 08/10: 211 cặp đơn×SKU trên 211 dòng). */
  it('đã nhận 1 chiếc → hết, không nhận thêm', () => {
    expect(monConNhanDuoc(d(), 1, true)).toEqual({ ok: false, lyDo: 'món này đã nhận rồi' });
    expect(monConNhanDuoc(d(), 5, true).ok).toBe(false);
  });

  /* 77 dòng MTB/MXHS đang mang cờ huỷ. Nhận hàng của đơn đã huỷ là đưa vào kho một chiếc không
     có đơn nào đòi, và không có đường nào rút ra. */
  it('đơn đã huỷ trên Lark → CHẶN', () => {
    expect(monConNhanDuoc(d({ huy: true }), 0, true))
      .toEqual({ ok: false, lyDo: 'đơn/món này đã huỷ trên Lark' });
  });

  /* Danh sách CHO PHÉP: kênh lạ thì chặn, không đoán. */
  it('kênh chưa được mở → CHẶN, kể cả dòng hoàn hảo', () => {
    expect(monConNhanDuoc(d({ store: '#MCN' }), 0, false))
      .toEqual({ ok: false, lyDo: 'kênh này chưa được mở để nhận hàng' });
  });

  it('thiếu SKU → CHẶN, vì `Lineitem SKU final` trống là Định danh cụt', () => {
    expect(monConNhanDuoc(d({ sku: null }), 0, true).ok).toBe(false);
    expect(monConNhanDuoc(d({ sku: '   ' }), 0, true).ok).toBe(false);
  });

  /* Không có record_id thì dòng WH - Inventory không nối được `Import (select order)` — mà
     183 dòng MTB/MXHS đội kho đang có đều là `Retail` CÓ liên kết. */
  it('thiếu record_id → CHẶN ngay ở cửa nhận, không để lộ ra lúc đẩy Lark', () => {
    expect(monConNhanDuoc(d({ coRecordId: false }), 0, true))
      .toEqual({ ok: false, lyDo: 'dòng món chưa có record_id trên Lark' });
  });

  /* Thứ tự kiểm có nghĩa: kênh chưa mở là câu trả lời ĐÚNG hơn "đã nhận rồi" khi cả hai cùng
     sai — người đọc cần biết cái chặn ở ngoài cùng trước. */
  it('nhiều lỗi cùng lúc → báo cái ngoài cùng trước', () => {
    expect(monConNhanDuoc(d({ huy: true, sku: null }), 9, false))
      .toEqual({ ok: false, lyDo: 'kênh này chưa được mở để nhận hàng' });
    expect(monConNhanDuoc(d({ huy: true, sku: null }), 9, true))
      .toEqual({ ok: false, lyDo: 'đơn/món này đã huỷ trên Lark' });
  });
});
