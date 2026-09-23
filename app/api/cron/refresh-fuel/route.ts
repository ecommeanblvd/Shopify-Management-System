/**
 * HTTP endpoint làm mới phụ phí xăng dầu cho MỌI hãng có auto-fetch.
 *
 * ĐÂY LÀ ĐƯỜNG CHẠY THẬT hằng ngày: `.github/workflows/refresh-fuel.yml` gọi
 * endpoint này lúc 01:20 UTC. Railway cron service chạy
 * `scripts/cron/refresh-fedex-fuel.ts` là đường dự phòng. Cả hai đi CHUNG một
 * bộ chạy `features/carrier-rates/fuel-fetcher/refresh-all.ts` — trước
 * 23/09/2026 route này giữ danh sách hãng riêng ['fedex','dhl'] nên UPS và
 * SF Express không bao giờ được gọi, đứng im 11 tuần mà vẫn báo `ok: true`.
 *
 * Authentication
 * --------------
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://<your-railway-url>/api/cron/refresh-fuel
 *
 * Response shape
 * --------------
 *   200 { ok: true,  ran, results: [...] }
 *   500 { ok: false, error: "<gọi tên hãng hỏng/quá hạn>", ran, results: [...] }
 *
 * `ok: false` + 500 là CÓ CHỦ Ý: workflow phải đỏ khi một hãng hỏng. Trước đây
 * route luôn trả `ok: true` kể cả khi mọi hãng đều lỗi, nên không gì báo động.
 */

import { NextResponse } from 'next/server';
import {
  chayRefreshFuel,
  loiRefreshFuel,
  type KetQuaRefreshFuel,
} from '@/features/carrier-rates/fuel-fetcher/refresh-all';

import { chayJobApi } from '@/features/jobs/api-run';
// Don't pre-render or cache.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured on this deployment.' },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Cron không phải người dùng — để `updatedBy` nguyên.
  const kq: KetQuaRefreshFuel = await chayJobApi(
    'refresh-fuel',
    () => chayRefreshFuel({ triggeredBy: null }),
    (summary) => loiRefreshFuel(summary),
  );

  const loi = loiRefreshFuel(kq);
  const body = {
    ok: loi == null,
    ran: kq.tong,
    results: kq.ketQua,
    ...(loi ? { error: loi } : {}),
  };
  return NextResponse.json(body, { status: loi == null ? 200 : 500 });
}
