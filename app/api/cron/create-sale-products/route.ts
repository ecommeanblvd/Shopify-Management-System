import { NextResponse } from 'next/server';
import { createSaleProducts } from '@/features/warehouse/create-sale';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Auto tạo product "-Sale" MEAN BLVD (brand archived + QC Pass/Lưu kho, loại
 * customize) cho external HTTPS cron.
 *   GET /api/cron/create-sale-products   (Authorization: Bearer CRON_SECRET)
 * Railway cron service dùng `npm run cron:create-sale` (không qua HTTP).
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const summary = await createSaleProducts();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
