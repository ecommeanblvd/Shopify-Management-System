import { describe, it, expect } from 'vitest';
import { payloadOrderReceived } from './order-received-payload';

const larkDon = {
  partnerBrandSlug: 'kalisa', brandReference: '#KLS2103',
  recipientName: 'Nguyen Van A', recipientPhone: '0900000000',
  country: 'US', city: 'Austin', postcode: '78701', address1: '1 Main St',
  weightKg: '1.500', chargedVnd: null,
};

describe('payloadOrderReceived', () => {
  it('brandSlug LUÔN có — thiếu nó MMP trả 422', () => {
    expect(payloadOrderReceived(larkDon).brandSlug).toBe('kalisa');
  });

  it('đơn Lark CHƯA báo giá vẫn dựng được payload — giá về sau qua order.reconciled', () => {
    const p = payloadOrderReceived(larkDon);
    expect(p.chargedVnd).toBeNull();
    expect(p.weightKg).toBe(1.5);
    expect(p.service).toBe('express');
    expect(p.createdVia).toBe('sms');
  });

  it('đường Lark ghi mã shop ở brandReference → vẫn ra customerRef cho MMP', () => {
    expect(payloadOrderReceived(larkDon).customerRef).toBe('#KLS2103');
  });

  it('customerRef có sẵn thì THẮNG brandReference (đường tạo tay)', () => {
    expect(payloadOrderReceived({ ...larkDon, customerRef: '#KLS9999' }).customerRef).toBe('#KLS9999');
  });

  it('không có mã shop nào → null, KHÔNG bịa', () => {
    expect(payloadOrderReceived({ partnerBrandSlug: 'tinh', country: 'US' }).customerRef).toBeNull();
  });

  it('kích thước thiếu → null, không thành 0 (0 nghĩa là ĐO ĐƯỢC bằng 0)', () => {
    const p = payloadOrderReceived({ partnerBrandSlug: 'tinh', country: 'US' });
    expect(p.dimLengthCm).toBeNull();
    expect(p.weightKg).toBeNull();
  });

  it('số dạng chuỗi từ CSDL được quy về số', () => {
    const p = payloadOrderReceived({ ...larkDon, dimLengthCm: '30.0', chargedVnd: '1862368.00' });
    expect(p.dimLengthCm).toBe(30);
    expect(p.chargedVnd).toBe(1862368);
  });

  it('địa chỉ giữ đủ khoá kể cả khi rỗng — MMP đọc theo khoá cố định', () => {
    const a = payloadOrderReceived({ partnerBrandSlug: 'tinh', country: 'VN' }).address as Record<string, unknown>;
    expect(Object.keys(a).sort()).toEqual(
      ['address1','address2','city','country','houseNumber','mapsUrl','postcode','province','shortAddress'].sort());
  });
});
