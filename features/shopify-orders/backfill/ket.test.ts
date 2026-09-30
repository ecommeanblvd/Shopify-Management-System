import { describe, it, expect } from 'vitest';
import { conSong, chayLaiDuoc, HAN_NHIP_PHUT } from './ket';

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
