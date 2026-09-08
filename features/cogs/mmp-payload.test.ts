import { describe, it, expect } from 'vitest';
import { docPayloadMmp } from './mmp-payload';

const payloadHopLe = {
  brandSlug: 'denio',
  period: '2026-09',
  lines: [
    { orderNumber: '#MBLVD29521', sku: 'Denio-DN0785-Customize-NPOT-PLA', qty: 1, amount: 1_861_500, currency: 'VND', kind: 'cogs', ref: 'MMP-STMT-2026-09-0001' },
  ],
  offline: [
    { refCode: '#MBLVDPO24', sku: 'Denio-DN0815-M-WCCM-PLA', qty: 1, amount: 1_374_000, currency: 'VND', kind: 'cogs' },
  ],
};

describe('docPayloadMmp', () => {
  it('payload hợp lệ → BangKe với 1 line + 1 offline (đều vào lines vì kind cogs)', () => {
    const r = docPayloadMmp(payloadHopLe);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bangKe).toMatchObject({ brand: 'denio', period: '2026-09', tuNgay: '01/09/2026', denNgay: '30/09/2026', sheet: 'mmp' });
    expect(r.bangKe.lines).toHaveLength(2);
    expect(r.bangKe.returns).toHaveLength(0);
    const line = r.bangKe.lines.find((l) => l.maDon === '#MBLVD29521');
    expect(line).toMatchObject({ sku: 'Denio-DN0785-Customize-NPOT-PLA', sl: 1, tt: 1_861_500, code: 'MMP-STMT-2026-09-0001' });
    const offline = r.bangKe.lines.find((l) => l.maDon === '#MBLVDPO24');
    expect(offline).toMatchObject({ sku: 'Denio-DN0815-M-WCCM-PLA', sl: 1, tt: 1_374_000 });
  });

  it('kind return → đưa vào returns thay vì lines', () => {
    const r = docPayloadMmp({
      brandSlug: 'denio', period: '2026-09',
      lines: [{ orderNumber: '#MBLVD29019', sku: 'Denio-DN0695-XL-CRE', qty: 1, amount: 1_657_500, currency: 'VND', kind: 'return' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bangKe.lines).toHaveLength(0);
    expect(r.bangKe.returns).toHaveLength(1);
    expect(r.bangKe.returns[0]).toMatchObject({ maDon: '#MBLVD29019', tt: 1_657_500 });
  });

  it('offline optional — payload không có offline vẫn hợp lệ', () => {
    const r = docPayloadMmp({
      brandSlug: 'denio', period: '2026-09',
      lines: [{ orderNumber: '#MBLVD29521', sku: 'Denio-DN0785-Customize-NPOT-PLA', qty: 1, amount: 1_861_500, currency: 'VND', kind: 'cogs' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bangKe.lines).toHaveLength(1);
  });

  it('thiếu brandSlug → ok:false', () => {
    const r = docPayloadMmp({ period: '2026-09', lines: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.loi).toMatch(/brandSlug/i);
  });

  it('period sai định dạng → ok:false', () => {
    const r = docPayloadMmp({ brandSlug: 'denio', period: '2026-9', lines: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.loi).toMatch(/period/i);
  });

  it('amount âm → ok:false', () => {
    const r = docPayloadMmp({
      brandSlug: 'denio', period: '2026-09',
      lines: [{ orderNumber: '#MBLVD29521', sku: 'X', qty: 1, amount: -100, currency: 'VND', kind: 'cogs' }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.loi).toMatch(/amount/i);
  });

  it('currency không phải mã 3 ký tự → ok:false', () => {
    const r = docPayloadMmp({
      brandSlug: 'denio', period: '2026-09',
      lines: [{ orderNumber: '#MBLVD29521', sku: 'X', qty: 1, amount: 100, currency: 'VNDONG', kind: 'cogs' }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.loi).toMatch(/currency/i);
  });

  it('json không phải object → ok:false', () => {
    expect(docPayloadMmp(null).ok).toBe(false);
    expect(docPayloadMmp('abc').ok).toBe(false);
    expect(docPayloadMmp([]).ok).toBe(false);
  });

  it('kind không hợp lệ → ok:false', () => {
    const r = docPayloadMmp({
      brandSlug: 'denio', period: '2026-09',
      lines: [{ orderNumber: '#MBLVD29521', sku: 'X', qty: 1, amount: 100, currency: 'VND', kind: 'discount' }],
    });
    expect(r.ok).toBe(false);
  });

  it('offline dòng thiếu refCode → ok:false', () => {
    const r = docPayloadMmp({
      brandSlug: 'denio', period: '2026-09', lines: [],
      offline: [{ sku: 'X', qty: 1, amount: 100, currency: 'VND', kind: 'cogs' }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.loi).toMatch(/refCode/i);
  });
});
