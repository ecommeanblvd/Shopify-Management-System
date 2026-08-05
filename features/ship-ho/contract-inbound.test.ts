import { describe, it, expect } from 'vitest';
import { parseMmpContract, MAX_CONTRACT_HTML_BYTES } from './contract-inbound';

const OK = {
  brandSlug: 'tinh',
  brandName: 'Tinh Atelier',
  contractType: 'fulfillment',
  title: 'Hợp đồng dịch vụ Fulfillment',
  version: '9f2ab31c7d04',
  generatedAt: '2026-08-05T04:00:00.000Z',
  html: '<html><body>Hợp đồng…</body></html>',
};

describe('parseMmpContract — payload thật MMP gửi 05/08', () => {
  it('payload chuẩn → normalize đủ field + filename có version', () => {
    const r = parseMmpContract(OK);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.brandSlug).toBe('tinh');
    expect(r.value.contractType).toBe('fulfillment');
    expect(r.value.version).toBe('9f2ab31c7d04');
    expect(r.value.generatedAt.toISOString()).toBe('2026-08-05T04:00:00.000Z');
    // Tên file bỏ dấu tiếng Việt + kèm version để phân biệt các bản
    expect(r.value.filename).toBe('hop-dong-dich-vu-fulfillment-9f2ab31c7d04.html');
  });

  it('thiếu brandSlug / contractType / version / html → lỗi rõ ràng', () => {
    for (const k of ['brandSlug', 'contractType', 'version', 'html'] as const) {
      const r = parseMmpContract({ ...OK, [k]: '' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain(k);
    }
  });

  it('html chỉ có khoảng trắng → từ chối', () => {
    expect(parseMmpContract({ ...OK, html: '   \n ' }).ok).toBe(false);
  });

  it('html vượt 5MB → từ chối (chặn payload rác)', () => {
    const big = 'x'.repeat(MAX_CONTRACT_HTML_BYTES + 1);
    const r = parseMmpContract({ ...OK, html: big });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('quá lớn');
  });

  it('generatedAt rác/thiếu → fallback thời điểm nhận, KHÔNG chặn hợp đồng', () => {
    const r = parseMmpContract({ ...OK, generatedAt: 'hôm qua' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.generatedAt.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('title trống → dựng từ contractType (không để bản ghi vô danh)', () => {
    const r = parseMmpContract({ ...OK, title: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe('Hợp đồng fulfillment');
  });

  it('payload không phải object → lỗi', () => {
    expect(parseMmpContract(null).ok).toBe(false);
    expect(parseMmpContract('x').ok).toBe(false);
  });

  it('trim khoảng trắng thừa ở slug/version', () => {
    const r = parseMmpContract({ ...OK, brandSlug: '  tinh ', version: ' v1 ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.brandSlug).toBe('tinh');
    expect(r.value.version).toBe('v1');
  });
});
