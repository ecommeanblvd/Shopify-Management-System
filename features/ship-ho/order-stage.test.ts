import { describe, it, expect } from 'vitest';
import { deriveShipHoStage } from './order-stage';

const base = { status: 'draft', trackingNumber: null, deliveryStatus: null, reconcileStatus: null, marginVnd: null };

describe('deriveShipHoStage — hành trình', () => {
  it('draft chưa có gì → Mới nhận (muted)', () => {
    expect(deriveShipHoStage(base)).toEqual({ label: 'Mới nhận', tone: 'muted', warnings: [] });
  });
  it('quoted → Đã báo giá', () => {
    expect(deriveShipHoStage({ ...base, status: 'quoted' }).label).toBe('Đã báo giá');
  });
  it('có tracking → Đang vận chuyển (kể cả status còn draft)', () => {
    const s = deriveShipHoStage({ ...base, trackingNumber: '7712345', deliveryStatus: 'in_transit' });
    expect(s).toEqual({ label: 'Đang vận chuyển', tone: 'info', warnings: [] });
  });
  it('out_for_delivery → Đang giao', () => {
    expect(deriveShipHoStage({ ...base, trackingNumber: 'x', deliveryStatus: 'out_for_delivery' }).label).toBe('Đang giao');
  });
  it('deliveryStatus delivered → Đã giao (ok) dù status chưa update', () => {
    expect(deriveShipHoStage({ ...base, status: 'shipped', trackingNumber: 'x', deliveryStatus: 'delivered' }))
      .toEqual({ label: 'Đã giao', tone: 'ok', warnings: [] });
  });
  it('billed / settled → nhãn tài chính, ưu tiên hơn vận chuyển', () => {
    expect(deriveShipHoStage({ ...base, status: 'billed', trackingNumber: 'x', deliveryStatus: 'delivered' }).label).toBe('Đã lên bảng kê');
    expect(deriveShipHoStage({ ...base, status: 'settled' })).toEqual({ label: 'Đã thanh toán', tone: 'ok', warnings: [] });
  });
  it('shipped nhưng chưa gắn tracking → cảnh báo màu warn', () => {
    expect(deriveShipHoStage({ ...base, status: 'shipped' })).toEqual({ label: 'Đã gửi (chưa có tracking)', tone: 'warn', warnings: [] });
  });
});

describe('deriveShipHoStage — cảnh báo vấn đề', () => {
  it('exception → stage Sự cố (bad) + warning', () => {
    const s = deriveShipHoStage({ ...base, trackingNumber: 'x', deliveryStatus: 'exception' });
    expect(s.label).toBe('Sự cố vận chuyển');
    expect(s.tone).toBe('bad');
    expect(s.warnings).toEqual(['Sự cố giao hàng']);
  });
  it('margin âm sau đối soát → warning kể cả khi đã giao', () => {
    const s = deriveShipHoStage({ ...base, status: 'delivered', reconcileStatus: 'reconciled', marginVnd: -50_000 });
    expect(s.label).toBe('Đã giao');
    expect(s.warnings).toEqual(['Margin âm (bill > giá thu)']);
  });
  it('margin âm nhưng CHƯA đối soát → không cảnh báo (số dự tính chưa chốt)', () => {
    expect(deriveShipHoStage({ ...base, marginVnd: -1 }).warnings).toEqual([]);
  });
  it('exception + margin âm → gom đủ 2 warning', () => {
    const s = deriveShipHoStage({ ...base, trackingNumber: 'x', deliveryStatus: 'exception', reconcileStatus: 'reconciled', marginVnd: -1 });
    expect(s.warnings).toHaveLength(2);
  });
});
