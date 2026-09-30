/**
 * Dựng màn KPI Logistics thành HTML rồi đọc chữ — soi được giao diện mà KHÔNG cần trình duyệt
 * và KHÔNG cần đăng nhập (CEO 30/09/2026).
 *
 * Vì sao có: các màn KPI nằm sau đăng nhập Google, máy không tự mở được, nên mọi thay đổi giao
 * diện trước nay chỉ được kiểm bằng tsc/eslint/test — không thứ nào đọc được thứ người dùng THẤY.
 * Lượt chạy đầu tiên bắt ngay 4 lỗi mà 4.177 test không thấy: sản lượng ship hộ hiện "Chưa chấm
 * được", câu thừa khi hai số bằng nhau, nút "Gửi duyệt" nằm trong khu quản lý, và người được chấm
 * không có chỗ nào để gửi.
 *
 * KHÔNG thay được mắt người: nó đọc CHỮ, không đo bố cục, màu hay khoảng cách. Dùng để bắt lỗi
 * nội dung và lỗi phân vai, rồi vẫn nhờ người mở màn xem bố cục.
 *
 * Chạy:  railway run --service Shopify-Management-System npx tsx scripts/soi-man-kpi.tsx
 * Xem toàn bộ chữ:  DAY_DU=1 railway run … npx tsx scripts/soi-man-kpi.tsx
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { docSoLieuKpi } from '@/features/kpi-logistics/queries';
import { docSoChoDuyet } from '@/features/kpi-logistics/cho-duyet-queries';
import { KpiTab } from '@/components/ship-report/KpiTab';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';

/** Router giả: chỉ để component gọi `useRouter()` dựng được ngoài Next. Không điều hướng gì. */
const routerGia = {
  back: () => {}, forward: () => {}, refresh: () => {}, push: () => {}, replace: () => {}, prefetch: () => {},
} as unknown as Parameters<typeof AppRouterContext.Provider>[0]['value'];

const chu = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function man(ky: string, tu: string, den: string, laAdmin: boolean) {
  const auto = await docSoLieuKpi(tu, den);
  const [nhap] = await db.select().from(schema.kpiLogisticsThang).where(sql`ky = ${ky}`);
  const [chot] = await db.select().from(schema.kpiLogisticsChot).where(sql`ky = ${ky}`);
  const [np] = await db.select().from(schema.kpi12Nop).where(sql`ky = ${ky}`);
  const soChoDuyet = laAdmin ? await docSoChoDuyet() : null;
  const html = renderToStaticMarkup(
    <AppRouterContext.Provider value={routerGia}>
      <KpiTab
        ky={ky} tu={tu} den={den}
        auto={chot ? (chot.soLieu as { auto: typeof auto }).auto : auto}
        nhap={nhap ?? null}
        chot={chot ? { chotAt: chot.chotAt.toISOString(), ghiChu: chot.ghiChu } : null}
        soChoDuyet={soChoDuyet}
        nop12={{
          trangThai: (np?.trangThai as 'dang_lam' | 'cho_duyet' | 'da_duyet') ?? 'dang_lam',
          nopAt: np?.nopAt?.toISOString() ?? null,
          duyetAt: np?.duyetAt?.toISOString() ?? null,
          soDongDangTraLai: 0,
        }}
        suaDuoc={laAdmin} ganLyDoDuoc ghiSuCoDuoc={laAdmin} />
    </AppRouterContext.Provider>,
  );
  return chu(html);
}

/** Thứ PHẢI có / PHẢI KHÔNG có theo vai — sai một dòng là lộ lỗi phân vai. */
const CANH: Array<{ ten: string; tim: string; chiAdmin: boolean }> = [
  { ten: 'Khu vực quản lý', tim: 'Khu vực quản lý', chiAdmin: true },
  { ten: 'ô nhập tay (3B, ghi đè)', tim: 'Nhập phần hệ thống không tự biết', chiAdmin: true },
  { ten: 'dải Chờ quản lý duyệt', tim: 'Chờ quản lý duyệt — các lệnh duyệt', chiAdmin: true },
  { ten: 'danh sách kiện chờ duyệt tay', tim: 'Kiện hệ thống không kiểm được', chiAdmin: true },
];

async function main() {
  let hong = 0;
  for (const [ky, tu, den] of [['2026-08', '2026-08-01', '2026-08-31'], ['2026-09', '2026-09-01', '2026-09-30']] as const) {
    for (const laAdmin of [true, false]) {
      const text = await man(ky, tu, den, laAdmin);
      const vai = laAdmin ? 'ADMIN' : 'ĐỨC  ';
      process.stdout.write(`\n━━ kỳ ${ky} · ${vai}\n`);
      for (const c of CANH) {
        const co = text.includes(c.tim);
        const dung = c.chiAdmin ? co === laAdmin : co;
        if (!dung) hong++;
        process.stdout.write(`   ${dung ? '✓' : '✗ SAI'} ${c.ten}${co ? '' : ' (không có)'}\n`);
      }
      // Câu chữ đã từng viết sai — canh để không quay lại.
      for (const [nhan, cam] of [['ngưỡng 1.1 kiểu cũ', '0 đơn — mỗi đơn'], ['nhãn sai cho dòng chỉ-đếm', '46 đơn Mốc lũy tiến tại đơn thứ 150 Chưa chấm được']] as const) {
        if (text.includes(cam)) { hong++; process.stdout.write(`   ✗ SAI còn câu cũ: ${nhan}\n`); }
      }
      if (process.env.DAY_DU === '1') process.stdout.write(`\n--- TOÀN BỘ CHỮ ---\n${text}\n`);
    }
  }
  process.stdout.write(hong === 0 ? '\nKhông chỗ nào lệch.\n' : `\n${hong} chỗ LỆCH.\n`);
  process.exit(hong === 0 ? 0 : 1);
}

main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`); process.exit(1); });
