import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { fetchVcbUsd } from '@/lib/fx/vcb';

export interface RefreshVcbResult {
  sell: number;
  fxCostPerDisplay: number;
  updated: number;
}

/**
 * Cập nhật tỉ giá USD→VND theo VCB (giá BÁN — dùng khi mua USD trả NCC) cho các
 * carrier account lưu giá bằng USD (Aramex). `fxCostPerDisplay` = USD/VND = 1/sell
 * (vì display currency = VND). Các account VND-cost (DHL/FedEx) không đụng — fx của
 * họ chỉ ảnh hưởng USD-display, không đổi VND đối chiếu.
 */
export async function refreshVcbFx(): Promise<RefreshVcbResult> {
  const rate = await fetchVcbUsd();
  const fx = 1 / rate.sell; // USD per VND
  const res = await db
    .update(schema.carrierAccounts)
    .set({ fxCostPerDisplay: fx.toFixed(12), fxUpdatedAt: sql`now()` })
    .where(eq(schema.carrierAccounts.costCurrency, 'USD'))
    .returning({ id: schema.carrierAccounts.id });
  return { sell: rate.sell, fxCostPerDisplay: fx, updated: res.length };
}
