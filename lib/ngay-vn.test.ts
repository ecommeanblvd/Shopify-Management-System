import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Canh lỗi "hôm nay theo UTC" trên toàn repo (CEO 29/09/2026).
 *
 * `new Date().toISOString().slice(0, 10)` trả NGÀY UTC. Việt Nam là UTC+7 nên từ
 * 00:00 đến 07:00 giờ VN nó ra NGÀY HÔM QUA. Quét 29/09 thấy 14 chỗ dùng cách
 * này làm "hôm nay" — mặc định ô ngày, mốc thanh toán, ngày hiệu lực bảng giá,
 * ngày biên bản. Dùng `ngayKinhDoanh(new Date())` thay thế.
 *
 * Chỉ soi `components/`, `app/`, `features/`: đó là chỗ con số chạm tới người
 * dùng và dữ liệu. `scripts/` là việc chạy tay một lần, không canh.
 */
const GOC = new URL('../', import.meta.url);
const QUET = ['components/', 'app/', 'features/'];
/** `new Date()` KHÔNG tham số, rồi đọc ra ngày bằng toISOString — đúng cái bẫy. */
const BAY = /new Date\(\s*\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/;

function quet(duong: URL, ra: string[]): void {
  for (const e of readdirSync(duong, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const con = new URL(`${e.name}${e.isDirectory() ? '/' : ''}`, duong);
    if (e.isDirectory()) { quet(con, ra); continue; }
    if (!/\.tsx?$/.test(e.name) || e.name.includes('.test.')) continue;
    const src = readFileSync(con, 'utf8');
    src.split('\n').forEach((dong, i) => {
      if (BAY.test(dong)) ra.push(`${con.pathname.split('/Shopify-Management-System/')[1]}:${i + 1}`);
    });
  }
}

describe('không lấy "hôm nay" bằng giờ UTC', () => {
  it('mọi chỗ cần ngày hôm nay đều phải dùng ngayKinhDoanh', () => {
    const dinh: string[] = [];
    for (const t of QUET) quet(new URL(t, GOC), dinh);
    expect(dinh, `dùng ngày UTC làm hôm nay — đổi sang ngayKinhDoanh(new Date()):\n  ${dinh.join('\n  ')}`).toEqual([]);
  });
});
