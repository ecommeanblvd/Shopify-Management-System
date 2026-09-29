import { describe, expect, it } from 'vitest';
import { donDaDu, khoa, monPoConNhan, type DongPo } from './po-con-nhan';

const d = (p: Partial<DongPo>): DongPo => ({
  recordId: 'r', orderNumber: '#MBLVDPO21', sku: 'A-M', soLuong: 1, baoDon: true, ...p,
});
const nhan = (o: Record<string, number>) => new Map(Object.entries(o));

describe('monPoConNhan', () => {
  it('CHỈ dòng đã tick "Báo đơn" mới được nhập', () => {
    const ds = [d({ recordId: '1' }), d({ recordId: '2', sku: 'B-M', baoDon: false })];
    expect(monPoConNhan(ds, nhan({})).map((x) => x.sku)).toEqual(['A-M']);
  });

  it('gộp nhiều dòng cùng (đơn, SKU) — bảng PO mỗi chiếc một dòng', () => {
    const ds = [d({ recordId: '1' }), d({ recordId: '2' }), d({ recordId: '3' })];
    expect(monPoConNhan(ds, nhan({}))[0]).toMatchObject({ dat: 3, daNhan: 0, con: 3 });
  });

  it('trừ đúng số đã nhận', () => {
    const ds = [d({ recordId: '1', soLuong: 5 })];
    expect(monPoConNhan(ds, nhan({ '#MBLVDPO21|A-M': 2 }))[0]).toMatchObject({ dat: 5, daNhan: 2, con: 3 });
  });

  it('món đã nhận đủ thì biến mất', () => {
    const ds = [d({ recordId: '1', soLuong: 2 })];
    expect(monPoConNhan(ds, nhan({ '#MBLVDPO21|A-M': 2 }))).toEqual([]);
  });

  it('ĐƠN đã nhập đủ thì KHÔNG cho chọn món nào nữa (CEO 29/09/2026)', () => {
    const ds = [d({ recordId: '1', sku: 'A-M', soLuong: 2 }), d({ recordId: '2', sku: 'A-S', soLuong: 2 })];
    expect(monPoConNhan(ds, nhan({ '#MBLVDPO21|A-M': 2, '#MBLVDPO21|A-S': 2 }))).toEqual([]);
  });

  it('nhận THỪA món này KHÔNG bù cho món kia — PO lệch size vẫn còn mở', () => {
    const ds = [d({ recordId: '1', sku: 'A-M', soLuong: 2 }), d({ recordId: '2', sku: 'A-S', soLuong: 2 })];
    // nhận 4 chiếc size M (thừa 2) nhưng size S chưa về chiếc nào
    const r = monPoConNhan(ds, nhan({ '#MBLVDPO21|A-M': 4 }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ sku: 'A-S', con: 2 });
    expect(donDaDu(ds, nhan({ '#MBLVDPO21|A-M': 4 })).size).toBe(0);
  });

  it('hai PO độc lập nhau: đơn này đủ không ảnh hưởng đơn kia', () => {
    const ds = [d({ recordId: '1', orderNumber: '#PO1' }), d({ recordId: '2', orderNumber: '#PO2' })];
    const r = monPoConNhan(ds, nhan({ '#PO1|A-M': 1 }));
    expect(r.map((x) => x.orderNumber)).toEqual(['#PO2']);
  });

  it('dòng thiếu mã đơn hoặc SKU thì bỏ qua — không đối chiếu được', () => {
    expect(monPoConNhan([d({ orderNumber: null }), d({ sku: null })], nhan({}))).toEqual([]);
  });

  it('khoảng trắng thừa vẫn khớp đúng', () => {
    const ds = [d({ orderNumber: ' #MBLVDPO21 ', sku: ' A-M ', soLuong: 2 })];
    expect(monPoConNhan(ds, nhan({ '#MBLVDPO21|A-M': 1 }))[0]).toMatchObject({ con: 1 });
  });

  it('khoa() chuẩn hoá hai đầu', () => {
    expect(khoa(' #PO1 ', ' S1 ')).toBe('#PO1|S1');
    expect(khoa(null, null)).toBe('|');
  });
});
