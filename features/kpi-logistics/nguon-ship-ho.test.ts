import { describe, it, expect } from 'vitest';
import { soNgayShipHo } from './nguon-ship-ho';
import { loaiTruKhoiKpi } from '@/features/shipments/ly-do-cham';

describe('soNgayShipHo', () => {
  it('đếm từ ĐẦU ngày gửi tới mốc giao', () => {
    expect(soNgayShipHo('2026-08-01', '2026-08-06T09:00:00Z')).toBe(5.4);
  });

  it('kẹp về 0 khi giao ngay trong ngày gửi, không ra số âm vì lệch múi giờ', () => {
    expect(soNgayShipHo('2026-08-01', '2026-07-31T20:00:00Z')).toBe(0);
  });

  it('bỏ phần giờ của ngày gửi để hai nguồn dùng cùng một mốc', () => {
    expect(soNgayShipHo('2026-08-01T23:00:00Z', '2026-08-03T00:00:00Z')).toBe(2);
  });
});

describe('kiện ship hộ dùng chung luật lý do chậm với kiện Shopify', () => {
  // Luật: lý do ngoài tầm kiểm soát chỉ gỡ được kiện ĐANG TRỄ; kiện bị khoá trễ thì không gỡ.
  const loai = (lyDo: string | null, soNgay: number, sla: number, buocTre = false) =>
    !buocTre && loaiTruKhoiKpi(lyDo) && soNgay > sla;

  it('kiện trễ có lý do ngoài tầm kiểm soát thì được gỡ khỏi mẫu số', () => {
    expect(loai('khach_khong_lien_he', 9, 5)).toBe(true);
  });

  it('kiện ĐẠT có lý do vẫn ở lại mẫu số — gỡ kiện tốt là tự hạ điểm', () => {
    expect(loai('khach_khong_lien_he', 4, 5)).toBe(false);
  });

  it('kiện bị khoá trễ vì sự cố nội bộ thì lý do không gỡ được', () => {
    expect(loai('khach_khong_lien_he', 9, 5, true)).toBe(false);
  });

  it('lý do thuộc nhóm mình chịu trách nhiệm thì không gỡ dù trễ', () => {
    expect(loai('thong_quan_thieu_ct_xuat', 9, 5)).toBe(false);
  });
});
