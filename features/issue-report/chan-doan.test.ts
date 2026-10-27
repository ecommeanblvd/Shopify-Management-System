import { describe, expect, it } from 'vitest';
import { GIOI_HAN_DONG, TRUY_VAN_CHO_PHEP, docYeuCauChanDoan } from './chan-doan';

const doc = (s: string) => docYeuCauChanDoan(new URLSearchParams(s));

describe('docYeuCauChanDoan — DANH SÁCH TRẮNG, không có đường rơi về "chạy hết"', () => {
  it('thiếu q thì TỪ CHỐI và nói ra các tên hợp lệ', () => {
    const k = doc('');
    expect(k.ok).toBe(false);
    if (!k.ok) for (const t of TRUY_VAN_CHO_PHEP) expect(k.loi).toContain(t);
  });

  /* Ghim CÂU THÔNG BÁO, không chỉ việc từ chối: `laTen('')` cũng từ chối chuỗi rỗng, nên nếu
   * chỉ ghim `ok === false` thì bỏ hẳn chốt `!q` vẫn xanh (đã chạy đột biến 27/10/2026: 0 đỏ).
   * Mà câu thông báo chính là thứ tác vụ hằng đêm đọc để biết nó gọi sai cái gì — "thiếu q"
   * và "q không hợp lệ: <giá trị>" dẫn nó đi hai đường sửa khác nhau. */
  it('thiếu q nói "thiếu q", KHÁC với q lạ — con bot đọc câu này để tự sửa', () => {
    const trong = doc('');
    const la = doc('q=job_runs');
    expect(trong.ok || la.ok).toBe(false);
    if (!trong.ok) expect(trong.loi).toContain('thiếu q');
    if (!la.ok) {
      expect(la.loi).toContain('không hợp lệ');
      expect(la.loi).toContain('job_runs');
    }
  });

  it('q lạ thì TỪ CHỐI — kể cả tên trông giống', () => {
    for (const q of ['job_runs', 'JOB-RUNS', 'kien ', 'kien-mac', 'select', '*', 'job-runs;--']) {
      expect(doc(`q=${encodeURIComponent(q)}`).ok, `q=${q}`).toBe(false);
    }
  });

  it('job-runs ĐÒI key — thiếu là từ chối, không âm thầm lấy mọi khoá', () => {
    expect(doc('q=job-runs').ok).toBe(false);
    expect(doc('q=job-runs&key=  ').ok).toBe(false);
    expect(doc('q=job-runs&key=dien-bu-gia-uoc-tinh').ok).toBe(true);
  });

  it('kien ĐÒI ma — thiếu là từ chối, không trả cả bảng kiện', () => {
    expect(doc('q=kien').ok).toBe(false);
    expect(doc('q=kien&ma=PK-22436').ok).toBe(true);
  });

  it('hai truy vấn không tham số thì chạy được ngay', () => {
    expect(doc('q=job-chua-chay').ok).toBe(true);
    expect(doc('q=kien-mac-gia').ok).toBe(true);
  });

  it('limit xấu thì KẸP về trần, không từ chối và KHÔNG vượt trần', () => {
    for (const v of ['', '0', '-5', '2.5', 'abc', '999999', String(GIOI_HAN_DONG + 1)]) {
      const k = doc(`q=kien-mac-gia&limit=${v}`);
      expect(k.ok, `limit=${v}`).toBe(true);
      if (k.ok) expect(k.yc.limit, `limit=${v}`).toBe(GIOI_HAN_DONG);
    }
  });

  it('limit hợp lệ thì giữ nguyên', () => {
    const k = doc('q=kien-mac-gia&limit=5');
    expect(k.ok && k.yc.limit).toBe(5);
  });

  it('cắt khoảng trắng hai đầu của key và ma', () => {
    const k = doc('q=kien&ma=%20PK-22436%20');
    expect(k.ok && k.yc.ma).toBe('PK-22436');
  });
});
