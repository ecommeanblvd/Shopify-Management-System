/*
 * Tài khoản carrier. Tệp này CỐ Ý KHÔNG có `'use server'` nữa (bỏ 25/10/2026): tới
 * 24/10/2026 cả 6 export là endpoint POST công khai không kiểm quyền, mà cửa vào trang chỉ
 * đòi `view_carrier_rates` (`[id]/page.tsx:47`) — vai `viewer` CÓ.
 *
 * `deleteAccount` cascade 10 bảng con. Đo thật 24/10/2026: 4/5 account bị khoá ngoại chặn
 * (FedEx có 2.914 `shipment_charges`), nhưng account "SF Express — VN Export" không có chứng
 * từ nào nên xoá được ngay — mất 11 zone, 39 bậc cân, 429 ô giá, 17 phụ phí. `updateAccount`
 * đổi `fxCostPerDisplay` tức đổi MỌI giá quy đổi của account.
 *
 * An toàn khi bỏ directive: không component client nào import tệp này theo GIÁ TRỊ (soát
 * 25/10/2026 — 11 `page.tsx` là server component; `features/ship-ho/*` và
 * `features/geo/carrier-geo.ts` là module thường). Action thật nằm ở `[id]/page.tsx` và
 * `new/page.tsx`, mỗi cái có mã riêng. Vẫn gác quyền trong từng hàm ghi vì chính các action
 * lồng ở hai trang đó cũng không kiểm gì.
 *
 * `listAccounts` / `listCarriers` / `getAccount` cố ý KHÔNG gác: `listAccounts` được 5 chỗ
 * nội bộ gọi (`ship-ho/brand-estimate`, `mmp-ratecard`, `quote-lines-actions`,
 * `offer-ratecard-actions`, `geo/carrier-geo`), gác thêm là chặn nhầm.
 */

import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';

export interface CreateAccountInput {
  carrierId: string;
  name: string;
  costCurrency: string;
  displayCurrency: string;
  fxCostPerDisplay: string; // numeric string, e.g. '26000.0000'
  notes?: string;
  weightUnit?: 'kg' | 'lb';
}

export async function listCarriers() {
  return db.select().from(schema.carriers).orderBy(schema.carriers.name);
}

export async function listAccounts() {
  return db
    .select({
      id: schema.carrierAccounts.id,
      name: schema.carrierAccounts.name,
      weightUnit: schema.carrierAccounts.weightUnit,
      costCurrency: schema.carrierAccounts.costCurrency,
      displayCurrency: schema.carrierAccounts.displayCurrency,
      fxCostPerDisplay: schema.carrierAccounts.fxCostPerDisplay,
      fxUpdatedAt: schema.carrierAccounts.fxUpdatedAt,
      enabled: schema.carrierAccounts.enabled,
      notes: schema.carrierAccounts.notes,
      createdAt: schema.carrierAccounts.createdAt,
      carrierKey: schema.carriers.key,
      carrierName: schema.carriers.name,
    })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .orderBy(schema.carrierAccounts.createdAt);
}

export async function getAccount(id: string) {
  const [row] = await db
    .select({
      id: schema.carrierAccounts.id,
      carrierId: schema.carrierAccounts.carrierId,
      name: schema.carrierAccounts.name,
      weightUnit: schema.carrierAccounts.weightUnit,
      costCurrency: schema.carrierAccounts.costCurrency,
      displayCurrency: schema.carrierAccounts.displayCurrency,
      fxCostPerDisplay: schema.carrierAccounts.fxCostPerDisplay,
      fxUpdatedAt: schema.carrierAccounts.fxUpdatedAt,
      enabled: schema.carrierAccounts.enabled,
      notes: schema.carrierAccounts.notes,
      createdAt: schema.carrierAccounts.createdAt,
      carrierKey: schema.carriers.key,
      carrierName: schema.carriers.name,
    })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.id, id))
    .limit(1);
  return row ?? null;
}

export async function createAccount(input: CreateAccountInput): Promise<string> {
  const userId = await requirePerm('manage_carrier_rates');
  const trimmedName = input.name.trim();
  if (!trimmedName) throw new Error('Account name is required.');
  if (!/^[A-Z]{3}$/.test(input.costCurrency)) throw new Error('Cost currency must be a 3-letter ISO code.');
  if (!/^[A-Z]{3}$/.test(input.displayCurrency)) throw new Error('Display currency must be a 3-letter ISO code.');
  const fx = Number(input.fxCostPerDisplay);
  if (!Number.isFinite(fx) || fx <= 0) throw new Error('FX rate must be a positive number.');

  const [carrier] = await db.select().from(schema.carriers).where(eq(schema.carriers.id, input.carrierId)).limit(1);
  if (!carrier) throw new Error('Unknown carrier.');

  const [row] = await db
    .insert(schema.carrierAccounts)
    .values({
      carrierId: input.carrierId,
      name: trimmedName,
      weightUnit: input.weightUnit ?? 'kg',
      costCurrency: input.costCurrency,
      displayCurrency: input.displayCurrency,
      fxCostPerDisplay: input.fxCostPerDisplay,
      notes: input.notes?.trim() || null,
      createdBy: userId,
    })
    .returning({ id: schema.carrierAccounts.id });
  return row!.id;
}

export interface UpdateAccountInput {
  id: string;
  name?: string;
  fxCostPerDisplay?: string;
  enabled?: boolean;
  notes?: string;
}

export async function updateAccount(input: UpdateAccountInput): Promise<void> {
  await requirePerm('manage_carrier_rates');
  const patch: Partial<typeof schema.carrierAccounts.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const t = input.name.trim();
    if (!t) throw new Error('Name cannot be empty.');
    patch.name = t;
  }
  if (input.fxCostPerDisplay !== undefined) {
    const fx = Number(input.fxCostPerDisplay);
    if (!Number.isFinite(fx) || fx <= 0) throw new Error('FX rate must be a positive number.');
    patch.fxCostPerDisplay = input.fxCostPerDisplay;
    patch.fxUpdatedAt = new Date();
  }
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.notes !== undefined) patch.notes = input.notes.trim() || null;

  await db.update(schema.carrierAccounts).set(patch).where(eq(schema.carrierAccounts.id, input.id));
}

export async function deleteAccount(id: string): Promise<void> {
  await requirePerm('manage_carrier_rates');
  // ON DELETE CASCADE on zones / tiers / cells / surcharges / postcodes / quote logs / links
  await db.delete(schema.carrierAccounts).where(eq(schema.carrierAccounts.id, id));
}
