import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CANH: Server Component KHÔNG được truyền hàm sang Client Component (CEO 30/09/2026).
 *
 * Lỗi thật: `KpiTab` (server) dựng `<DaiNop12 … sauKhiLuu={() => {}} />` (client). React không
 * chuyển được hàm qua ranh giới RSC nên nó ném lỗi lúc CHẠY và VỠ CẢ TRANG — mã 500, chứ không
 * phải một ô trống.
 *
 * Vì sao phải có test này: khối đó nằm sau điều kiện `!suaDuoc`, tức CHỈ chạy cho người KHÔNG
 * phải quản lý. CEO là admin nên không bao giờ gặp; Đức gặp mỗi lần bấm vào tab. Nó sống sót
 * qua TẤT CẢ các cửa hiện có:
 *   · `tsc` — kiểu `() => void` hoàn toàn hợp lệ
 *   · `eslint` — không luật nào xét ranh giới RSC
 *   · 4.225 test — không test nào dựng KpiTab trong ngữ cảnh RSC
 *   · `next build` — lỗi này là lỗi tuần tự hoá lúc chạy, build không thấy
 *   · `scripts/soi-man-kpi.tsx` — dùng `renderToStaticMarkup`, dựng cả cây như MỘT khối nên
 *     KHÔNG kiểm ranh giới server/client. Nó báo "không chỗ nào lệch" đúng lúc lỗi nằm ở đó.
 *
 * Một prop kiểu hàm mà BẮT BUỘC chính là cái bẫy: người gọi ở server sẽ viết `={() => {}}` cho
 * đủ kiểu. Nên prop kiểu hàm phải TUỲ CHỌN, và component tự có hành vi mặc định.
 */

const GOC = ['app', 'components', 'features'];

/** Một tệp là client component khi có chỉ thị 'use client' ở đầu tệp. */
const laClient = (noiDung: string) => /^\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]use client['"]/.test(noiDung);

function moiTepTsx(thuMuc: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === 'node_modules' || ten.startsWith('.')) continue;
    const duong = join(thuMuc, ten);
    if (statSync(duong).isDirectory()) moiTepTsx(duong, ra);
    else if (ten.endsWith('.tsx') && !ten.includes('.test.')) ra.push(duong);
  }
  return ra;
}

/** `prop={() => …}`, `prop={async (…) => …}`, `prop={function …}` — hàm viết thẳng tại chỗ. */
const HAM_TAI_CHO = /(\w+)=\{\s*(?:\(\s*\)|async\s*\(|function\b|\([^)]*\)\s*=>)/;

describe('ranh giới RSC', () => {
  it('không Server Component nào truyền hàm viết thẳng làm prop', () => {
    const viPham: string[] = [];
    for (const goc of GOC) {
      for (const duong of moiTepTsx(goc)) {
        const noiDung = readFileSync(duong, 'utf8');
        if (laClient(noiDung)) continue;              // client → client là hợp lệ
        noiDung.split('\n').forEach((dong, i) => {
          const m = HAM_TAI_CHO.exec(dong);
          if (m) viPham.push(`${duong}:${i + 1} · prop "${m[1]}" · ${dong.trim().slice(0, 90)}`);
        });
      }
    }
    /* Nếu test này đỏ: đừng thêm ngoại lệ. Hoặc cho prop đó hành vi MẶC ĐỊNH bên trong client
       component rồi bỏ prop đi, hoặc bọc chỗ gọi vào một client component. Truyền hàm qua ranh
       giới RSC không có cách nào làm cho đúng. */
    expect(viPham).toEqual([]);
  });

  it('phép quét thật sự đang soi — có tệp server để soi, không phải rỗng mà xanh', () => {
    // Một test canh mà quét vào khoảng không thì xanh vĩnh viễn và vô dụng.
    const tatCa = GOC.flatMap((g) => moiTepTsx(g));
    const server = tatCa.filter((d) => !laClient(readFileSync(d, 'utf8')));
    expect(tatCa.length).toBeGreaterThan(200);
    expect(server.length).toBeGreaterThan(100);
  });
});
