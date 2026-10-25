import { describe, expect, it } from 'vitest';
import { docCheDoTonKho, soVeKhongChoPhep } from './che-do-ton-kho';

describe('docCheDoTonKho', () => {
  it('chỉ đúng "ghi-that" mới ghi thật', () => {
    expect(docCheDoTonKho('ghi-that')).toBe('ghi');
    expect(docCheDoTonKho(' GHI-THAT ')).toBe('ghi');
  });
  it('trống / sai / gần đúng → chạy thử', () => {
    for (const v of [undefined, '', '1', 'true', 'ghi', 'ghi-that-toan-bo', 'dry']) {
      expect(docCheDoTonKho(v)).toBe('dry');
    }
  });
});

/**
 * Cờ MỘT LƯỢT: `ghi-mot-luot:<n>` — n là số dòng sẽ-về-0 lấy từ kế hoạch người vận hành
 * ĐÃ ĐỌC. Thiết kế để **tự hết hạn**, không phải bật/tắt: sau lượt sync thành công thì số
 * dòng về 0 còn gần 0, nên cùng giá trị cờ đó không còn khớp ⇒ tự vô hiệu. Cờ bật/tắt
 * thường rất dễ bị để quên ở trạng thái bật, mà đây là ghi hàng loạt vào tồn kho.
 */
describe('soVeKhongChoPhep — cờ một lượt phải khai đúng số dòng về 0', () => {
  it('đọc được số từ "ghi-mot-luot:351"', () => {
    expect(soVeKhongChoPhep('ghi-mot-luot:351')).toBe(351);
    expect(soVeKhongChoPhep('  GHI-MOT-LUOT:351  ')).toBe(351);
  });

  it('cờ một lượt cũng là chế độ GHI', () => {
    expect(docCheDoTonKho('ghi-mot-luot:351')).toBe('ghi');
  });

  it('ghi-that thường thì không có hạn mức về 0', () => {
    expect(soVeKhongChoPhep('ghi-that')).toBeNull();
    expect(docCheDoTonKho('ghi-that')).toBe('ghi');
  });

  /* FAIL-CLOSED: dạng đúng mà số sai thì KHÔNG được rơi về "ghi tự do" — phải là chạy thử.
   * Nếu không, một lỗi gõ (`ghi-mot-luot:` thiếu số) sẽ thành lượt ghi không hạn mức. */
  it('dạng đúng mà số không hợp lệ → CHẠY THỬ, không phải ghi', () => {
    for (const v of ['ghi-mot-luot:', 'ghi-mot-luot:abc', 'ghi-mot-luot:-1', 'ghi-mot-luot:1.5', 'ghi-mot-luot']) {
      expect(docCheDoTonKho(v)).toBe('dry');
      expect(soVeKhongChoPhep(v)).toBeNull();
    }
  });

  it('cho phép 0 — nghĩa là "chỉ ghi khi KHÔNG dòng nào về 0"', () => {
    expect(soVeKhongChoPhep('ghi-mot-luot:0')).toBe(0);
    expect(docCheDoTonKho('ghi-mot-luot:0')).toBe('ghi');
  });

  it('trống / lạ → chạy thử, không hạn mức', () => {
    for (const v of [undefined, '', 'ghi', 'true']) {
      expect(docCheDoTonKho(v)).toBe('dry');
      expect(soVeKhongChoPhep(v)).toBeNull();
    }
  });
});
