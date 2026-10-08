import { describe, it, expect } from 'vitest';
import { moTaTuChoi, nenGhiTuChoi, TRAN_TU_CHOI } from './xac-thuc';

describe('moTaTuChoi', () => {
  /* Nhật ký nhiều người đọc được. Độ dài đủ để chẩn đoán (lệch độ dài là nguyên nhân phổ biến
     nhất: thừa khoảng trắng, thiếu ký tự khi dán), còn giá trị thì không được rò ra. */
  it('KHÔNG BAO GIỜ giữ giá trị secret, chỉ giữ độ dài', () => {
    const m = moTaTuChoi({
      tuChoi: 'secret', header: 'bi-mat-that-cua-lark', secret: 'bi-mat-tren-railway',
      contentLength: '42', userAgent: 'Lark-Automation/1.0', loi: 'sai secret',
    });
    expect(JSON.stringify(m)).not.toContain('bi-mat-that-cua-lark');
    expect(JSON.stringify(m)).not.toContain('bi-mat-tren-railway');
    expect(m.doDaiHeader).toBe(20);
    expect(m.doDaiCanCo).toBe(19);
  });

  /* Hai ca trông giống nhau trên màn hình nhưng cần hai cách sửa khác hẳn: automation KHÔNG gửi
     header (phải thêm vào rule), và gửi header SAI (phải sửa giá trị). */
  it('phân biệt "không gửi header" với "gửi header sai"', () => {
    const khong = moTaTuChoi({
      tuChoi: 'secret', header: null, secret: 'abc', contentLength: null, userAgent: null,
      loi: 'sai secret',
    });
    expect(khong.coHeader).toBe(false);
    expect(khong.doDaiHeader).toBe(0);

    const sai = moTaTuChoi({
      tuChoi: 'secret', header: 'xyz', secret: 'abc', contentLength: null, userAgent: null,
      loi: 'sai secret',
    });
    expect(sai.coHeader).toBe(true);
    expect(sai.doDaiHeader).toBe(3);
  });

  it('cắt user agent, không giữ chuỗi dài vô hạn', () => {
    const m = moTaTuChoi({
      tuChoi: 'body', header: null, secret: undefined, contentLength: null,
      userAgent: 'x'.repeat(500), loi: 'body không phải JSON',
    });
    expect(m.userAgent).toHaveLength(80);
  });

  it('content-length thiếu hoặc rác → 0, không phải NaN', () => {
    expect(moTaTuChoi({ tuChoi: 'body', header: null, secret: undefined, contentLength: null,
      userAgent: null, loi: '' }).contentLength).toBe(0);
    expect(moTaTuChoi({ tuChoi: 'body', header: null, secret: undefined, contentLength: 'abc',
      userAgent: null, loi: '' }).contentLength).toBe(0);
  });
});

describe('nenGhiTuChoi', () => {
  /* Endpoint chỉ chắn bằng secret, ai biết đường dẫn cũng gọi được — ghi mọi lượt từ chối là mở
     đường cho một vòng lặp bên ngoài làm phình `job_runs`. */
  it('ghi tới trần rồi thôi', () => {
    expect(nenGhiTuChoi(0)).toBe(true);
    expect(nenGhiTuChoi(TRAN_TU_CHOI - 1)).toBe(true);
    expect(nenGhiTuChoi(TRAN_TU_CHOI)).toBe(false);
    expect(nenGhiTuChoi(TRAN_TU_CHOI + 500)).toBe(false);
  });
});
