import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { canDienBu, MOC_DIEN_BU } from './dien-bu';

describe('canDienBu', () => {
  const goc = {
    trackingNumber: 'T', larkRecordId: 'rec', daGhiGiaLuc: null,
    taoLuc: new Date(MOC_DIEN_BU.getTime() + 86_400_000),
    // Dấu "nhân sự nhập mã qua hệ thống" — xem DAU_NHAP_QUA_HE_THONG.
    trackingNhapLuc: new Date(MOC_DIEN_BU.getTime() + 86_400_000),
  };

  it('có tracking + có record Lark + chưa ghi giá + nhập qua hệ thống + tạo sau mốc → cần', () => {
    expect(canDienBu(goc)).toBe(true);
  });
  it('chưa có tracking → chưa tới lượt', () => {
    expect(canDienBu({ ...goc, trackingNumber: null })).toBe(false);
  });
  it('chưa có record Lark → chưa ghi được', () => {
    expect(canDienBu({ ...goc, larkRecordId: null })).toBe(false);
  });
  it('đã ghi rồi → thôi', () => {
    expect(canDienBu({ ...goc, daGhiGiaLuc: new Date() })).toBe(false);
  });

  /* ───── PHẠM VI: chỉ mã nhân sự nhập QUA HỆ THỐNG (CEO 14/10/2026) ─────
   *
   * Vì sao phải có điều kiện này dù đã có `MOC_DIEN_BU`: mốc lọc theo `created_at` của
   * KIỆN, không nói gì về việc mã vận đơn tới từ đâu. `shipments.tracking_number` có BA
   * đường ghi (action nhập tracking · đồng bộ Lark · nhập hoá đơn/XLSX), nên một kiện do
   * đồng bộ Lark tạo HÔM NAY và mang tracking do chính lượt đồng bộ đó ghi vẫn thoả đủ
   * mọi điều kiện cũ ⇒ cron bốc nó và đổ giá ước tính lên dòng Lark của một kiện mà
   * KHÔNG ai ở đây từng chạm vào. Đó đúng là thứ CEO loại khỏi phạm vi.
   */
  it('tracking ĐỒNG BỘ TỪ LARK (không có dấu nhập) → KHÔNG lọt vào phạm vi', () => {
    // Kiện tạo hôm nay, sau mốc, thoả MỌI điều kiện khác — chỉ thiếu dấu nhập.
    const tuLark = { ...goc, trackingNhapLuc: null };
    expect(canDienBu(tuLark)).toBe(false);
    // Và chứng minh đúng DẤU là thứ quyết định: thêm dấu vào thì lọt.
    expect(canDienBu({ ...tuLark, trackingNhapLuc: new Date() })).toBe(true);
  });
  it('kiện tạo sau mốc + tracking từ Lark + mọi điều kiện khác đạt → vẫn KHÔNG', () => {
    expect(canDienBu({
      trackingNumber: '1Z999AA10123456784', larkRecordId: 'recABC', daGhiGiaLuc: null,
      taoLuc: new Date('2026-10-14T00:00:00.000Z'), trackingNhapLuc: null,
    })).toBe(false);
  });

  /* C3: ba điều kiện kia đúng với 4.276 kiện trải 4 tháng lịch sử (đo thật, sớm nhất
   * 10/06/2026). Không có mốc thì lượt cron đầu tiên đổ giá ước tính hôm nay lên 4 tháng dòng
   * Lark cũ và lấp vĩnh viễn mọi ô trống còn lại — "kiện lỡ nhịp" là kiện VỪA dán mã qua luồng
   * mới, không phải toàn bộ lịch sử. Mốc GIỮ LẠI làm khoá thứ hai sau dấu nhập: dấu là cột
   * trống, một câu UPDATE backfill là mất tác dụng, còn mốc thì không backfill được. */
  it('kiện tạo TRƯỚC mốc (lịch sử) → KHÔNG đụng, dù thoả mọi điều kiện khác', () => {
    expect(canDienBu({ ...goc, taoLuc: new Date(MOC_DIEN_BU.getTime() - 1) })).toBe(false);
    expect(canDienBu({ ...goc, taoLuc: new Date('2026-06-10T00:00:00.000Z') })).toBe(false);
  });
  it('kiện tạo ĐÚNG mốc → nằm trong phạm vi', () => {
    expect(canDienBu({ ...goc, taoLuc: new Date(MOC_DIEN_BU.getTime()) })).toBe(true);
  });
  /* Không biết kiện thuộc thời nào thì không ghi — cùng hướng với mọi lựa chọn khác ở đây. */
  it('không đọc được ngày tạo → KHÔNG đụng', () => {
    expect(canDienBu({ ...goc, taoLuc: null })).toBe(false);
  });
});

/**
 * Dấu `tracking_nhap_luc` chỉ có nghĩa khi CHỈ MỘT đường ghi nó: `luuTrackingChoKien`.
 *
 * Vì sao khoá bằng test chứ không bằng bình luận: một ngày nào đó ai thêm `trackingNhapLuc`
 * vào `patch-kien.ts` (đồng bộ Lark) hay `import-actions.ts` (nhập hoá đơn/XLSX) cho "đủ dữ
 * liệu" là PHẠM VI mà CEO chốt tan ngay — và tan ÂM THẦM: không test nào đỏ, không ai thấy
 * gì, chỉ có giá ước tính bắt đầu chảy lên những dòng Lark không ai yêu cầu. Luật "chỉ điền ô
 * trống" không cứu được chuyện đó vì Lark không có undo.
 *
 * Cũng chặn luôn ca BACKFILL bằng script: `scripts/` nằm trong phạm vi quét.
 */
describe('dấu tracking_nhap_luc chỉ có MỘT đường ghi', () => {
  function moiFileTs(thuMuc: string): string[] {
    const ra: string[] = [];
    for (const ten of readdirSync(thuMuc)) {
      if (ten === 'node_modules') continue;
      const p = join(thuMuc, ten);
      if (statSync(p).isDirectory()) { ra.push(...moiFileTs(p)); continue; }
      if (p.endsWith('.ts') && !p.endsWith('.test.ts')) ra.push(p);
    }
    return ra;
  }

  it('chỉ features/dong-hang/actions.ts ghi trackingNhapLuc / tracking_nhap_luc', () => {
    const pham: string[] = [];
    for (const p of [...moiFileTs('features'), ...moiFileTs('app'), ...moiFileTs('scripts')]) {
      const s = readFileSync(p, 'utf8');
      // `trackingNhapLuc: <giá trị>` = gán trong payload drizzle; `tracking_nhap_luc` trong
      // SQL thô. KHÔNG tính hai thứ vô hại: ĐỌC cột (`: schema.shipments.trackingNhapLuc`,
      // vd `select` của dien-bu.ts) và KHAI KIỂU (`: Date | null` trong interface/tham số).
      // Khoảng trắng nằm TRONG lookahead, không trước nó: `\s*(?!…)` thì `\s*` lùi về 0 ký
      // tự rồi lookahead soi đúng dấu cách ⇒ luôn đúng, test mất tác dụng âm thầm.
      const ghi = /(^|[^.\w])trackingNhapLuc\s*:(?!\s*(?:schema\.|Date\b))/m.test(s)
        // Dạng gán rời `p.trackingNhapLuc = …` — đúng lối `patch-kien.ts` đang ghi
        // `p.trackingNumber = row.trackingNumber`, tức đường dễ lọt nhất. `[^=]` để không
        // bắt phép SO SÁNH `=== / ==` (phép `!=` vốn đã không khớp).
        || /\.trackingNhapLuc\s*=[^=]/.test(s)
        || /\btracking_nhap_luc\b\s*=/.test(s)
        || /set\s+tracking_nhap_luc\b/i.test(s);
      if (ghi) pham.push(p);
    }
    expect(pham).toEqual(['features/dong-hang/actions.ts']);
  });

  /* Giữ db/schema.ts là nơi DUY NHẤT khai cột, và khoá tên cột SQL đúng từng chữ: migration
   * 0205 áp tay bằng tên này, lệch một chữ là drizzle gửi câu SQL tới một cột không tồn tại
   * và cả thao tác nhập mã vận đơn đổ lỗi trên production. */
  it('db/schema.ts khai cột đúng tên tracking_nhap_luc', () => {
    expect(readFileSync('db/schema.ts', 'utf8'))
      .toContain("trackingNhapLuc: timestamp('tracking_nhap_luc')");
  });
  it('migration 0205 thêm cột đúng tên, và idempotent (ADD COLUMN IF NOT EXISTS)', () => {
    const sql = readFileSync('db/migrations/0205_tracking-nhap-luc.sql', 'utf8');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS tracking_nhap_luc timestamp/);
  });
});
