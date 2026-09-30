import { describe, it, expect } from 'vitest';
import { dongBiKhoa, nopDuoc, duyetDuocKy, traLaiDuoc, moTaTrangThai } from './nop-1-2';

describe('dongBiKhoa', () => {
  it('đang làm thì mở hết — Đức chọn thoải mái', () => {
    expect(dongBiKhoa('dang_lam', false)).toBe(false);
    expect(dongBiKhoa('dang_lam', true)).toBe(false);
  });

  it('đã gửi đi duyệt thì KHOÁ, trừ dòng bị trả lại', () => {
    expect(dongBiKhoa('cho_duyet', false)).toBe(true);
    expect(dongBiKhoa('cho_duyet', true)).toBe(false);
  });

  it('đã duyệt thì khoá TẤT, kể cả dòng từng bị trả — duyệt là chốt', () => {
    expect(dongBiKhoa('da_duyet', false)).toBe(true);
    expect(dongBiKhoa('da_duyet', true)).toBe(true);
  });
});

describe('duyetDuocKy', () => {
  it('còn dòng đang trả về thì KHÔNG duyệt được — duyệt lúc đó là chốt luôn cái mình vừa nói sai', () => {
    expect(duyetDuocKy('cho_duyet', 3)).toBe(false);
    expect(duyetDuocKy('cho_duyet', 0)).toBe(true);
  });

  it('kỳ chưa nộp hoặc đã duyệt thì không duyệt (lại) được', () => {
    expect(duyetDuocKy('dang_lam', 0)).toBe(false);
    expect(duyetDuocKy('da_duyet', 0)).toBe(false);
  });
});

describe('nopDuoc / traLaiDuoc', () => {
  it('gửi được khi đang làm, và gửi LẠI được sau khi sửa dòng bị trả', () => {
    expect(nopDuoc('dang_lam')).toBe(true);
    expect(nopDuoc('cho_duyet')).toBe(true);
    expect(nopDuoc('da_duyet')).toBe(false);
  });

  it('chỉ trả lại được khi kỳ đang chờ duyệt', () => {
    expect(traLaiDuoc('cho_duyet')).toBe(true);
    expect(traLaiDuoc('dang_lam')).toBe(false);
    expect(traLaiDuoc('da_duyet')).toBe(false);
  });
});

describe('moTaTrangThai — nói luôn ai phải làm gì tiếp', () => {
  it('có dòng bị trả thì nói rõ số dòng', () => {
    expect(moTaTrangThai('cho_duyet', 3)).toContain('trả lại 3 dòng');
  });
  it('không dòng nào bị trả thì nói đang khoá', () => {
    expect(moTaTrangThai('cho_duyet', 0)).toContain('đang khoá');
  });
  it('ba trạng thái đều có câu riêng', () => {
    const ds = [moTaTrangThai('dang_lam', 0), moTaTrangThai('cho_duyet', 0), moTaTrangThai('da_duyet', 0)];
    expect(new Set(ds).size).toBe(3);
  });
});
