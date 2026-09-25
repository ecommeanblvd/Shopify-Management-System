import { describe, it, expect } from 'vitest';
import { tachTheoNgay, gomTheoPhieu } from './tach-ngay';

const luc = (s: string) => ({ taoLuc: new Date(s) });

describe('tachTheoNgay', () => {
  it('tách đúng hai nhóm theo ngày nghiệp vụ', () => {
    const r = tachTheoNgay(
      [luc('2026-09-25T03:00:00Z'), luc('2026-09-24T03:00:00Z')],
      '2026-09-25',
    );
    expect(r.homNay).toHaveLength(1);
    expect(r.truoc).toHaveLength(1);
  });

  /* 22:00 giờ Việt Nam ngày 25 = 15:00Z ngày 25 — cùng ngày cả hai cách tính,
   * nên phép này chưa bắt được gì. Mốc THẬT SỰ nguy hiểm là ca tiếp theo. */
  it('hàng nhận 7 giờ sáng giờ VN (00:00Z) vẫn là HÔM NAY', () => {
    const r = tachTheoNgay([luc('2026-09-25T00:00:00Z')], '2026-09-25');
    expect(r.homNay).toHaveLength(1);
  });

  /* Đây là chỗ tính theo UTC sẽ SAI: 01:00 giờ VN ngày 25 là 18:00Z ngày 24.
   * Theo UTC nó rơi vào hôm trước và biến mất khỏi việc của hôm nay. */
  it('hàng nhận 1 giờ sáng giờ VN (18:00Z hôm trước) vẫn là HÔM NAY', () => {
    const r = tachTheoNgay([luc('2026-09-24T18:00:00Z')], '2026-09-25');
    expect(r.homNay).toHaveLength(1);
    expect(r.truoc).toHaveLength(0);
  });

  /* Và chiều ngược lại: 23:30 giờ VN ngày 24 (16:30Z ngày 24) là HÔM TRƯỚC. */
  it('hàng nhận 23:30 giờ VN hôm trước KHÔNG lọt vào hôm nay', () => {
    const r = tachTheoNgay([luc('2026-09-24T16:30:00Z')], '2026-09-25');
    expect(r.truoc).toHaveLength(1);
    expect(r.homNay).toHaveLength(0);
  });

  it('giữ nguyên thứ tự trong từng nhóm', () => {
    const a = luc('2026-09-25T02:00:00Z'); const b = luc('2026-09-25T01:00:00Z');
    expect(tachTheoNgay([a, b], '2026-09-25').homNay).toEqual([a, b]);
  });

  it('danh sách rỗng → hai nhóm rỗng', () => {
    expect(tachTheoNgay([], '2026-09-25')).toEqual({ homNay: [], truoc: [] });
  });
});

describe('gomTheoPhieu', () => {
  const c = (receiptId: string, vendor: string | null, ma: string) => ({ receiptId, vendor, ma });

  it('gom đúng theo phiếu, giữ thứ tự phiếu xuất hiện lần đầu', () => {
    const r = gomTheoPhieu([
      c('p1', 'TomFried', 'a'), c('p2', 'Keira', 'b'), c('p1', 'TomFried', 'c'),
    ]);
    expect(r.map((g) => g.receiptId)).toEqual(['p1', 'p2']);
    expect(r[0]!.chiec.map((x) => x.ma)).toEqual(['a', 'c']);
  });

  /* Hai brand khác nhau PHẢI là hai khối riêng: ảnh hàng đến và biên bản của
   * brand này không được treo nhầm sang lô của brand kia. */
  it('hai brand trong cùng ngày tách thành hai phiếu', () => {
    expect(gomTheoPhieu([c('p1', 'A', 'x'), c('p2', 'B', 'y')])).toHaveLength(2);
  });

  it('danh sách rỗng → không nhóm nào', () => {
    expect(gomTheoPhieu([])).toEqual([]);
  });
});
