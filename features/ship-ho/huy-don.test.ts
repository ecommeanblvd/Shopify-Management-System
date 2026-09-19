import { describe, it, expect } from 'vitest';
import { payloadHuyKhongGuiHang, SU_KIEN_HUY } from './huy-don';

describe('payloadHuyKhongGuiHang', () => {
  it('không thu phí, có lý do máy đọc được và bằng chứng hãng', () => {
    const p = payloadHuyKhongGuiHang('OC · Label created · 2026-07-03');
    expect(p.reason).toBe('khong_gui_hang');
    expect(p.chargedVnd).toBe(0);
    expect(p.evidence).toContain('Label created');
  });
  it('thiếu bằng chứng thì không có field evidence', () => {
    expect('evidence' in payloadHuyKhongGuiHang(null)).toBe(false);
  });
  it('tên sự kiện đúng hợp đồng webhook', () => expect(SU_KIEN_HUY).toBe('order.cancelled'));
});
