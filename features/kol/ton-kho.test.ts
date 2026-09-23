import { describe, it, expect } from 'vitest';
import { draftGiuCho, draftTraCho, draftXuat, draftNhapLai } from './ton-kho';

const d = { id: '11111111-1111-1111-1111-111111111111', sku: 'A-1', kho: 'GVM', soLuong: 3 };

describe('draft tồn kho cho đơn KOL', () => {
  it('giữ chỗ chỉ tăng reserved, KHÔNG đụng on_hand', () => {
    expect(draftGiuCho(d, 'u1')).toEqual({
      sku: 'A-1', warehouseCode: 'GVM', deltaOnHand: 0, deltaReserved: 3,
      reason: 'auto_allocate', refType: 'kol_dong_don', refId: d.id, actor: 'u1',
    });
  });
  it('trả chỗ khi huỷ đơn đã chốt', () => {
    expect(draftTraCho(d, 'u1')).toMatchObject({ deltaOnHand: 0, deltaReserved: -3, reason: 'release_allocation' });
  });
  it('xuất kho trừ CẢ on_hand lẫn reserved — chỗ đã giữ nay thành hàng đi thật', () => {
    expect(draftXuat(d, 'u1')).toMatchObject({ deltaOnHand: -3, deltaReserved: -3, reason: 'pick' });
  });
  it('nhập lại kho chỉ cộng on_hand, theo số lượng trả chứ không theo số lượng gửi', () => {
    expect(draftNhapLai(d, 2, 'u1')).toMatchObject({ deltaOnHand: 2, deltaReserved: 0, reason: 'receipt_return' });
  });
  it('mọi draft đều gắn refType/refId để báo cáo lọc được hàng đã xuất cho KOL', () => {
    for (const m of [draftGiuCho(d, 'u1'), draftTraCho(d, 'u1'), draftXuat(d, 'u1'), draftNhapLai(d, 1, 'u1')]) {
      expect(m.refType).toBe('kol_dong_don');
      expect(m.refId).toBe(d.id);
    }
  });
});
