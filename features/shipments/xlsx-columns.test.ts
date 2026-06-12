import { describe, it, expect } from 'vitest';
import { resolveColumns, LEGACY_COLUMN_MAP } from './xlsx-columns';

function header2425(): string[] {
  const h: string[] = new Array(80).fill('');
  h[1]='Label Created Date'; h[2]='Base'; h[3]='Couriers'; h[5]='Order Number';
  h[9]='Country (look up)'; h[15]='Select VTĐG1'; h[16]='Weights'; h[18]='Dimension ( điền tay)';
  h[19]='Country'; h[22]='Tracking Number'; h[23]='INS | Chi phí Tổng (đ)'; h[24]='Mức giá cơ sở';
  h[25]='Phụ phí nhiên liệu'; h[26]='EES / Theo nhu cầu'; h[27]='Phí xử lý hàng nhập';
  h[28]='Phí kí nhận trực tiếp'; h[29]='GoGreen Plus-Basic'; h[30]='VAT/Thuế phí khác';
  h[31]='Phụ phí vùng sâu xa'; h[32]='Giá Chiết khấu'; h[43]='Log Unique code';
  h[45]='Couriers (look up)'; h[76]='Phí rủi ro gia tăng';
  return h;
}

describe('resolveColumns', () => {
  it('layout 2024-25: map đúng vị trí', () => {
    const r = resolveColumns(header2425());
    expect(r.ok).toBe(true);
    expect(r.columns.trackingNumber).toBe(22);
    expect(r.columns.carrier).toBe(3);
    expect(r.columns.orderNumber).toBe(5);
    expect(r.columns.totalCost).toBe(23);
    expect(r.columns.base).toBe(24);
    expect(r.columns.discount).toBe(32);
    expect(r.columns.country).toBe(19);
    expect(r.columns.importHandling).toBe(27);
    expect(r.columns.elevatedRisk).toBe(76);
  });
  it('decoy "(look up)" không cướp field chính', () => {
    expect(resolveColumns(header2425()).columns.carrier).toBe(3);
  });
  it('thiếu cột bắt buộc → ok=false + missingRequired', () => {
    const h = header2425(); h[22]='';
    const r = resolveColumns(h);
    expect(r.ok).toBe(false);
    expect(r.missingRequired).toContain('trackingNumber');
  });
  it('cột optional thiếu → -1', () => {
    const h = header2425(); h[76]='';
    const r = resolveColumns(h);
    expect(r.ok).toBe(true);
    expect(r.columns.elevatedRisk).toBe(-1);
  });
  it('LEGACY_COLUMN_MAP có đủ field', () => {
    expect(LEGACY_COLUMN_MAP.trackingNumber).toBe(4);
    expect(LEGACY_COLUMN_MAP.totalCost).toBe(34);
  });
});
