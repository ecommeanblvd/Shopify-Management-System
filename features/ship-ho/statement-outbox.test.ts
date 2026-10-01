import { describe, it, expect } from 'vitest';
import { conThuLai, LAN_THU_TOI_DA } from './statement-outbox';

describe('conThuLai', () => {
  /* Gửi lại một bản MMP ĐÃ NHẬN là làm họ ghi đè sổ bằng chính nó — vô ích, và che mất việc
     dòng đó đã xong. */
  it('đã gửi xong → KHÔNG thử lại, kể cả khi mới thử một lần', () => {
    expect(conThuLai('delivered', 0)).toBe(false);
    expect(conThuLai('delivered', 1)).toBe(false);
  });

  it('chưa gửi / đã hỏng mà còn lượt → thử lại', () => {
    expect(conThuLai('pending', 0)).toBe(true);
    expect(conThuLai('failed', 1)).toBe(true);
    expect(conThuLai('failed', LAN_THU_TOI_DA - 1)).toBe(true);
  });

  /* Cron đập mãi vào một lỗi cố định (sai secret, brand lạ) chỉ làm log đầy và che những dòng
     còn cứu được. Hết lượt thì phải có NGƯỜI xem, nên `thuLaiSuKienBangKe` đếm riêng số đó. */
  it('hết lượt thử → dừng, không đập mãi vào một lỗi cố định', () => {
    expect(conThuLai('failed', LAN_THU_TOI_DA)).toBe(false);
    expect(conThuLai('pending', LAN_THU_TOI_DA + 3)).toBe(false);
  });

  it('trần lượt thử bằng mức của outbox cấp đơn', () => {
    expect(LAN_THU_TOI_DA).toBe(8);
  });
});
