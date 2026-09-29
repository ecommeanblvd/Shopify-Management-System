import { describe, it, expect } from 'vitest';
import { MOC_AP_QUY_CHE, tinhVaoTonDong } from './moc-quy-che';

describe('tinhVaoTonDong — mốc áp quy chế cho Gate Pillar 3', () => {
  it('kiện gửi TRƯỚC mốc là nợ lịch sử, không tính vào tồn đọng', () => {
    // Ba kiện thật đang treo Gate: 06/2025, 03/2026 (tháng nặng nhất, 382 kiện), 07/2026.
    expect(tinhVaoTonDong('2025-06-15', '2026-08-01')).toBe(false);
    expect(tinhVaoTonDong('2026-03-20', '2026-08-01')).toBe(false);
    expect(tinhVaoTonDong('2026-07-31', '2026-08-01')).toBe(false);
  });

  it('kỳ đầu tiên (tháng 8) không có gì để tồn — đó là ý nghĩa của mốc', () => {
    expect(tinhVaoTonDong(MOC_AP_QUY_CHE, '2026-08-01')).toBe(false);
  });

  it('từ kỳ sau, kiện tháng 8 mới bắt đầu tính vào tồn đọng', () => {
    expect(tinhVaoTonDong('2026-08-01', '2026-09-01')).toBe(true);
    expect(tinhVaoTonDong('2026-08-31', '2026-09-01')).toBe(true);
  });

  it('kiện gửi TRONG kỳ đang chấm chưa tính — hoá đơn carrier về trễ, chi trả gối một kỳ', () => {
    expect(tinhVaoTonDong('2026-09-10', '2026-09-01')).toBe(false);
  });

  it('mốc là ngày đầu tháng 8 theo quyết định của CEO', () => {
    expect(MOC_AP_QUY_CHE).toBe('2026-08-01');
  });
});
