import { describe, it, expect } from 'vitest';
import { returnConNhanDuoc, TRANG_THAI_CHO_NHAN, type DongReturn } from './return-con-nhan';

const d = (p: Partial<DongReturn> = {}): DongReturn => ({
  recordId: 'recvq3XyakVcS7', orderNumber: '#MBLVD29442', sku: 'KAL-25T1C2-PURPLE-M',
  soLuong: 1, whTiepNhanQc: null, logStatus: 'Return-Processing',
  shopDomain: 'meanblvd.myshopify.com', ...p,
});

describe('TRANG_THAI_CHO_NHAN', () => {
  it('đúng hai trạng thái: hàng ĐANG trên đường về', () => {
    expect([...TRANG_THAI_CHO_NHAN].sort()).toEqual(['Pakago Received', 'Return-Processing']);
  });

  /* CEO 08/10/2026 bác bản đầu: `Warehouse Received` là trạng thái LOG đặt KHI KHO ĐÃ NHẬN —
     toàn bộ 244 dòng đã có hồ sơ WH đều mang nó (243/244). Bày nó ở ô tìm là để kho bấm nhận
     một món đang nằm trên kệ, sinh ra một chiếc ẢO thứ hai trong tồn. */
  it('KHÔNG gồm `Warehouse Received` — hàng đó đã về kho rồi, chỉ thiếu hồ sơ', () => {
    expect(TRANG_THAI_CHO_NHAN.has('Warehouse Received')).toBe(false);
  });

  /* Hàng còn ở hải quan thì chưa tới kho; sẽ hiện khi LOG đổi trạng thái. Hàng mất thì không bao
     giờ về. 324 dòng trống trạng thái là dòng cũ từ trước khi có cột đó. */
  it('KHÔNG gồm hàng kẹt hải quan, hàng mất, hay dòng trống trạng thái', () => {
    for (const x of ['A31- Held by Customs', 'H11 Form Processing', 'Waiting for Payment',
      'Package Lost', 'On Delivery', 'Delivery Completed', 'Warehouse Received']) {
      expect(TRANG_THAI_CHO_NHAN.has(x)).toBe(false);
    }
  });
});

describe('returnConNhanDuoc', () => {
  it('dòng ở cửa, SMS chưa nhận → nhận được', () => {
    expect(returnConNhanDuoc(d(), 0, true)).toEqual({ ok: true, con: 1 });
  });

  /* 40 dòng mang `Warehouse Received` mà bên WH - Inventory không có dòng nào khớp là việc ĐỐI
     SOÁT, không phải việc nhận hàng: hàng đã về rồi, chỉ thiếu hồ sơ. Cần người xác định hàng
     trên kệ (ghi bù) hay mất thật — lẫn vào ô tìm là chỗ sinh tồn ảo. */
  it('`Warehouse Received` mà chưa có dòng WH → CHẶN, đây là việc đối soát', () => {
    const r = returnConNhanDuoc(d({ logStatus: 'Warehouse Received', whTiepNhanQc: null }), 0, true);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.lyDo).toContain('Warehouse Received');
  });

  /* Đội kho đã có dòng WH rồi: nhận thêm là hai dòng cho một món, mà bốn cột lookup bên
     `LOG - Import` gộp cả hai nên số hiện ra không nói được dòng nào là dòng nào. */
  it('đội kho đã có dòng WH → CHẶN, kể cả trạng thái đúng cửa', () => {
    expect(returnConNhanDuoc(d({ whTiepNhanQc: 'QC Pass' }), 0, true))
      .toEqual({ ok: false, lyDo: 'đội kho đã có dòng WH cho món này' });
    expect(returnConNhanDuoc(d({ whTiepNhanQc: 'QC Failed' }), 0, true).ok).toBe(false);
  });

  it('trạng thái ngoài cửa → CHẶN, và nói rõ trạng thái đang là gì', () => {
    const r = returnConNhanDuoc(d({ logStatus: 'Package Lost' }), 0, true);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.lyDo).toContain('Package Lost');
    const t = returnConNhanDuoc(d({ logStatus: null }), 0, true);
    expect(t.ok === false && t.lyDo).toContain('trống');
  });

  it('SMS đã nhận đủ số lượng → hết', () => {
    expect(returnConNhanDuoc(d({ soLuong: 1 }), 1, true).ok).toBe(false);
    expect(returnConNhanDuoc(d({ soLuong: 2 }), 1, true)).toEqual({ ok: true, con: 1 });
    expect(returnConNhanDuoc(d({ soLuong: 2 }), 2, true).ok).toBe(false);
  });

  it('thiếu mã đơn hoặc SKU → CHẶN, vì hai cột đó là khoá khớp sang bảng vận hành', () => {
    expect(returnConNhanDuoc(d({ orderNumber: null }), 0, true).ok).toBe(false);
    expect(returnConNhanDuoc(d({ sku: null }), 0, true).ok).toBe(false);
    expect(returnConNhanDuoc(d({ sku: '  ' }), 0, true).ok).toBe(false);
  });

  /* `Return Status` không xuất hiện trong luật — hàng bị từ chối hoàn tiền vẫn về kho thật
     (1 dòng `Rejected` nằm trong 244 dòng kho đã nhận). Bài test này canh việc đó không bị
     "sửa thêm cho chắc" về sau. */
  it('luật KHÔNG đọc tới trạng thái hoàn tiền của CX', () => {
    const nguon = returnConNhanDuoc.toString();
    expect(nguon).not.toMatch(/returnStatus|Approved|Refunded|Rejected/);
  });
});

/* Phạm vi store của ĐỒ RETURN khác phạm vi nhận hàng từ brand — hai câu hỏi khác nhau.
   Bảo 09/10/2026: "Hàng của Tinh về không nhập vào kho của WH. Nhận và auto gửi về GA" — Tinh
   NẰM TRONG `STORE_NHAN_HANG` mà vẫn phải đứng ngoài danh sách này. Và `happy-clothing-global`
   vốn đã ngoài `STORE_NHAN_HANG` từ 29/09, nhưng nguồn đồ return ban đầu KHÔNG biết luật đó nên
   đang mời kho nhận `#HC1317`. */
describe('returnConNhanDuoc — phạm vi store', () => {
  it('store không có đồ return vào kho WH → CHẶN, dù mọi điều kiện khác đều đúng', () => {
    const r = returnConNhanDuoc(d({ shopDomain: 'tinhatelier.myshopify.com' }), 0, false);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.lyDo).toContain('không vào kho WH');
    expect(r.ok === false && r.lyDo).toContain('tinhatelier');
  });

  /* Chặn store đứng TRƯỚC mọi điều kiện khác: dòng của store ngoài phạm vi thì thiếu khoá hay
     sai trạng thái đều không còn là câu trả lời đúng cho người đọc. */
  it('báo lý do store trước, kể cả khi dòng còn lỗi khác', () => {
    const r = returnConNhanDuoc(
      d({ shopDomain: 'happy-clothing-global.myshopify.com', sku: null, logStatus: null }), 9, false);
    expect(r.ok === false && r.lyDo).toContain('không vào kho WH');
  });

  it('không tra được store → CHẶN, không coi là được phép', () => {
    const r = returnConNhanDuoc(d({ shopDomain: null }), 0, false);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.lyDo).toContain('không tra được store');
  });
});
