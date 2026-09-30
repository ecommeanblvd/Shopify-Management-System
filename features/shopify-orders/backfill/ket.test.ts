import { describe, it, expect } from 'vitest';
import { conSong, chayLaiDuoc, denLucDapNhip, HAN_NHIP_PHUT, NHIP_DAP_GIAY } from './ket';

const BAY_GIO = new Date('2026-09-30T05:00:00Z');
const truoc = (phut: number) => new Date(BAY_GIO.getTime() - phut * 60_000);

describe('conSong', () => {
  it('đang chạy và nhịp mới → sống', () => {
    expect(conSong('running', truoc(1), truoc(60), BAY_GIO)).toBe(true);
  });

  it('ca thật MEAN BLVD: đang chạy nhưng nhịp cũ 2,5 tháng → CHẾT', () => {
    expect(conSong('running', new Date('2026-07-15T04:50:21Z'), new Date('2026-07-15T04:12:21Z'), BAY_GIO)).toBe(false);
  });

  it('vừa khởi động chưa kịp bump nhịp → lấy mốc bắt đầu', () => {
    expect(conSong('running', null, truoc(1), BAY_GIO)).toBe(true);
    expect(conSong('running', null, truoc(HAN_NHIP_PHUT + 1), BAY_GIO)).toBe(false);
  });

  it('trạng thái khác running thì không bao giờ là sống', () => {
    for (const tt of ['done', 'failed', 'idle', null, undefined]) {
      expect(conSong(tt, truoc(1), truoc(1), BAY_GIO)).toBe(false);
    }
  });
});

describe('chayLaiDuoc', () => {
  it('XONG rồi thì thôi — không đốt hạn mức API để nạp lại thứ đã có', () => {
    expect(chayLaiDuoc('done', null, null, BAY_GIO)).toBe(false);
  });

  it('đang chạy THẬT thì không chen ngang', () => {
    expect(chayLaiDuoc('running', truoc(2), truoc(10), BAY_GIO)).toBe(false);
  });

  it('kẹt như MEAN BLVD thì PHẢI cho chạy lại — đây là cả lý do có tệp này', () => {
    expect(chayLaiDuoc('running', new Date('2026-07-15T04:50:21Z'), null, BAY_GIO)).toBe(true);
  });

  it('chưa chạy lần nào, hoặc hỏng, thì chạy được', () => {
    expect(chayLaiDuoc('idle', null, null, BAY_GIO)).toBe(true);
    expect(chayLaiDuoc('failed', null, null, BAY_GIO)).toBe(true);
    expect(chayLaiDuoc(null, null, null, BAY_GIO)).toBe(true);
  });
});

describe('denLucDapNhip — nhịp phải đập theo THỜI GIAN, không theo batch (đo 30/09/2026)', () => {
  /* Đo lượt nạp thật của MEAN BLVD: nhịp chỉ đập MỘT LẦN mỗi batch ~100 đơn, và ở tốc độ
     ~21 đơn/phút thì một batch mất ~5 phút. Doc-comment cũ của `HAN_NHIP_PHUT` viết "bump nhịp
     mỗi vài giây" — SAI. Hạn 30 phút vì vậy chỉ dư 6 lần; một store chậm hơn 6 lần sẽ bị
     `conSong` kết luận oan là xác chết, rồi `chayLaiDuoc` cho chạy lượt thứ hai song song. */
  it('chưa tới hạn thì KHÔNG đập — không đốt thêm lượt ghi CSDL', () => {
    const t = 1_000_000;
    expect(denLucDapNhip(t, t + 29_999)).toBe(false);
  });

  it('tới hạn thì đập', () => {
    const t = 1_000_000;
    expect(denLucDapNhip(t, t + NHIP_DAP_GIAY * 1000)).toBe(true);
    expect(denLucDapNhip(t, t + 120_000)).toBe(true);
  });

  it('hạn đập phải NHỎ HƠN HẲN hạn kết luận chết — nếu không thì luật tự cắn nhau', () => {
    // Đây là ràng buộc thật sự quan trọng: nhịp đập dày hơn hạn chết ít nhất 10 lần thì một
    // lượt còn sống không bao giờ bị nhận là xác chết, kể cả khi CSDL chậm vài nhịp.
    expect(NHIP_DAP_GIAY * 10).toBeLessThanOrEqual(HAN_NHIP_PHUT * 60);
  });
});
