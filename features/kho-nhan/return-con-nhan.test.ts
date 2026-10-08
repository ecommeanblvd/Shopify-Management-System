import { describe, it, expect } from 'vitest';
import { returnConNhanDuoc, TRANG_THAI_CHO_NHAN, type DongReturn } from './return-con-nhan';

const d = (p: Partial<DongReturn> = {}): DongReturn => ({
  recordId: 'recvq3XyakVcS7', orderNumber: '#MBLVD29442', sku: 'KAL-25T1C2-PURPLE-M',
  soLuong: 1, whTiepNhanQc: null, logStatus: 'Warehouse Received', ...p,
});

describe('TRANG_THAI_CHO_NHAN', () => {
  it('đúng ba trạng thái CEO chốt 08/10/2026', () => {
    expect([...TRANG_THAI_CHO_NHAN].sort())
      .toEqual(['Pakago Received', 'Return-Processing', 'Warehouse Received']);
  });

  /* Hàng còn ở hải quan thì chưa tới kho; sẽ hiện khi LOG đổi trạng thái. Hàng mất thì không bao
     giờ về. 324 dòng trống trạng thái là dòng cũ từ trước khi có cột đó. */
  it('KHÔNG gồm hàng kẹt hải quan, hàng mất, hay dòng trống trạng thái', () => {
    for (const x of ['A31- Held by Customs', 'H11 Form Processing', 'Waiting for Payment',
      'Package Lost', 'On Delivery', 'Delivery Completed']) {
      expect(TRANG_THAI_CHO_NHAN.has(x)).toBe(false);
    }
  });
});

describe('returnConNhanDuoc', () => {
  it('dòng ở cửa, SMS chưa nhận → nhận được', () => {
    expect(returnConNhanDuoc(d(), 0)).toEqual({ ok: true, con: 1 });
  });

  /* 40 dòng mang `Warehouse Received` mà bên WH - Inventory KHÔNG có dòng nào khớp — LOG bảo đã
     tới kho còn hệ thống kho chưa có hồ sơ. Đó là tập cần nhận nhất, không được loại ra. */
  it('`Warehouse Received` mà chưa có dòng WH → VẪN nhận được', () => {
    expect(returnConNhanDuoc(d({ logStatus: 'Warehouse Received', whTiepNhanQc: null }), 0).ok)
      .toBe(true);
  });

  /* Đội kho đã có dòng WH rồi: nhận thêm là hai dòng cho một món, mà bốn cột lookup bên
     `LOG - Import` gộp cả hai nên số hiện ra không nói được dòng nào là dòng nào. */
  it('đội kho đã có dòng WH → CHẶN, kể cả trạng thái đúng cửa', () => {
    expect(returnConNhanDuoc(d({ whTiepNhanQc: 'QC Pass' }), 0))
      .toEqual({ ok: false, lyDo: 'đội kho đã có dòng WH cho món này' });
    expect(returnConNhanDuoc(d({ whTiepNhanQc: 'QC Failed' }), 0).ok).toBe(false);
  });

  it('trạng thái ngoài cửa → CHẶN, và nói rõ trạng thái đang là gì', () => {
    const r = returnConNhanDuoc(d({ logStatus: 'Package Lost' }), 0);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.lyDo).toContain('Package Lost');
    const t = returnConNhanDuoc(d({ logStatus: null }), 0);
    expect(t.ok === false && t.lyDo).toContain('trống');
  });

  it('SMS đã nhận đủ số lượng → hết', () => {
    expect(returnConNhanDuoc(d({ soLuong: 1 }), 1).ok).toBe(false);
    expect(returnConNhanDuoc(d({ soLuong: 2 }), 1)).toEqual({ ok: true, con: 1 });
    expect(returnConNhanDuoc(d({ soLuong: 2 }), 2).ok).toBe(false);
  });

  it('thiếu mã đơn hoặc SKU → CHẶN, vì hai cột đó là khoá khớp sang bảng vận hành', () => {
    expect(returnConNhanDuoc(d({ orderNumber: null }), 0).ok).toBe(false);
    expect(returnConNhanDuoc(d({ sku: null }), 0).ok).toBe(false);
    expect(returnConNhanDuoc(d({ sku: '  ' }), 0).ok).toBe(false);
  });

  /* `Return Status` không xuất hiện trong luật — hàng bị từ chối hoàn tiền vẫn về kho thật
     (1 dòng `Rejected` nằm trong 244 dòng kho đã nhận). Bài test này canh việc đó không bị
     "sửa thêm cho chắc" về sau. */
  it('luật KHÔNG đọc tới trạng thái hoàn tiền của CX', () => {
    const nguon = returnConNhanDuoc.toString();
    expect(nguon).not.toMatch(/returnStatus|Approved|Refunded|Rejected/);
  });
});
