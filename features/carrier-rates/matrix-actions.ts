'use server';

import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { ParsedMatrixCsv } from './matrix-csv';
import { splitPackageCells } from './matrix-package-split';
import { requirePerm } from '@/features/receiving/perm';

export interface MatrixCell {
  zoneId: string;
  tierId: string;
  costAmount: string | null;
  updatedAt: Date | null;
}

export interface MatrixSnapshot {
  zones: { id: string; label: string; position: number }[];
  tiers: { id: string; upperKg: string; position: number }[];
  /** Cells loại 'package' (hộp). */
  cells: MatrixCell[];
  /** Cells loại 'pak' (FedEx có; DHL hiện chưa). Rỗng nếu card không có PAK. */
  pakCells: MatrixCell[];
  /** Bộ bậc PAK — subset của `tiers` có giá pak, sắp theo upper_kg. */
  pakTiers: { id: string; upperKg: string; position: number }[];
}

export async function loadMatrix(carrierAccountId: string, rateCardId: string): Promise<MatrixSnapshot> {
  const zones = await db
    .select({
      id: schema.carrierZones.id,
      label: schema.carrierZones.label,
      position: schema.carrierZones.position,
    })
    .from(schema.carrierZones)
    .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId))
    .orderBy(asc(schema.carrierZones.position), asc(schema.carrierZones.label));

  const tiers = await db
    .select({
      id: schema.carrierWeightTiers.id,
      upperKg: schema.carrierWeightTiers.upperKg,
      position: schema.carrierWeightTiers.position,
    })
    .from(schema.carrierWeightTiers)
    .where(eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId))
    .orderBy(asc(sql`(${schema.carrierWeightTiers.upperKg})::numeric`));

  if (zones.length === 0 || tiers.length === 0) {
    return { zones, tiers, cells: [], pakCells: [], pakTiers: [] };
  }

  const cellRows = await db
    .select({
      zoneId: schema.carrierRateCells.carrierZoneId,
      tierId: schema.carrierRateCells.carrierWeightTierId,
      costAmount: schema.carrierRateCells.costAmount,
      updatedAt: schema.carrierRateCells.updatedAt,
      packageType: schema.carrierRateCells.packageType,
    })
    .from(schema.carrierRateCells)
    .where(eq(schema.carrierRateCells.rateCardId, rateCardId));

  const { packageCells, pakCells, pakTierIds } = splitPackageCells(cellRows);
  const pakTiers = tiers.filter((t) => pakTierIds.includes(t.id));

  return { zones, tiers, cells: packageCells, pakCells, pakTiers };
}

/*
 * Ba hàm GHI ở dưới (`setCell`, `clearCell`, `importMatrix`) tự gác `manage_carrier_rates`
 * trong thân hàm. Tới 25/10/2026 cả ba KHÔNG có một dòng kiểm quyền nào.
 *
 * Lý do chung của cả cụm carrier-rates ghi: cổng quyền phải nằm TRONG THÂN HÀM, không ở
 * `page.tsx`. Mỗi export của tệp `'use server'` là một endpoint POST; thân trang chỉ chạy lúc
 * RENDER nên một POST thẳng vào action không kích hoạt nó, và cổng duy nhất của dashboard
 * (`app/(dashboard)/layout.tsx:10-11`) cũng là render. Nên mọi phiên đăng nhập gọi được, kể
 * cả 3 tài khoản vai `viewer`.
 *
 * Vì sao nặng: `carrier_rate_cells` là bảng giá gốc mà route carrier-service đọc TRỰC TIẾP
 * khi khách bấm thanh toán (`app/api/shopify/carrier-service/[storeId]/route.ts:63` →
 * `features/carrier-rates/engine/snapshot-static.ts:149-150`). Sửa một ô là đổi GIÁ SHIP
 * KHÁCH THẤY ở checkout, ngay lượt tiếp theo, không qua bước duyệt/đẩy nào. `importMatrix` còn
 * tạo zone + bậc cân thiếu rồi ghi đè hàng loạt ô, và `clearCell` xoá ô thì cuốn giá về
 * "không có giá".
 *
 * `userId` thôi là THAM SỐ. Trước đây người gọi tự khai danh tính nên kẻ gọi thẳng vừa ghi
 * được vừa ĐỔ TÊN người khác vào `updated_by` của ô giá. Giờ danh tính lấy từ `requirePerm`
 * (userId đã xác thực từ phiên).
 *
 * Khoá `manage_carrier_rates` là ĐÚNG khoá mà trang gọi cụm này đang dùng
 * (`app/(dashboard)/f/carrier-rates/[id]/workspace/page.tsx:52`, `canManage`) — không tự nghĩ
 * ra mức mới. Chú ý: không có chỗ gọi nào của ba hàm này trong toàn mã (đo 25/10/2026), nhưng
 * chúng vẫn là endpoint vì nằm cùng tệp `'use server'` với `loadMatrix` mà client dùng.
 *
 * `loadMatrix` (hàm ĐỌC) cố ý KHÔNG gác: `workspace/page.tsx:11` gọi nó sau cổng
 * `view_carrier_rates` của chính trang, và vai chỉ-xem phải đọc được ma trận.
 */
export async function setCell({
  rateCardId, zoneId, tierId, costAmount, packageType = 'package',
}: { rateCardId: string; zoneId: string; tierId: string; costAmount: string; packageType?: 'pak' | 'package' }): Promise<void> {
  const userId = await requirePerm('manage_carrier_rates');
  const n = Number(costAmount);
  if (!Number.isFinite(n) || n < 0) throw new Error('Cost must be a non-negative number.');

  await db
    .insert(schema.carrierRateCells)
    .values({
      rateCardId,
      carrierZoneId: zoneId,
      carrierWeightTierId: tierId,
      packageType,
      costAmount: n.toFixed(2),
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: [
        schema.carrierRateCells.rateCardId,
        schema.carrierRateCells.carrierZoneId,
        schema.carrierRateCells.carrierWeightTierId,
        schema.carrierRateCells.packageType,
      ],
      set: { costAmount: n.toFixed(2), updatedBy: userId, updatedAt: new Date() },
    });
}

export async function clearCell({
  rateCardId, zoneId, tierId, packageType = 'package',
}: { rateCardId: string; zoneId: string; tierId: string; packageType?: 'pak' | 'package' }): Promise<void> {
  await requirePerm('manage_carrier_rates');
  await db.delete(schema.carrierRateCells).where(and(
    eq(schema.carrierRateCells.rateCardId, rateCardId),
    eq(schema.carrierRateCells.carrierZoneId, zoneId),
    eq(schema.carrierRateCells.carrierWeightTierId, tierId),
    eq(schema.carrierRateCells.packageType, packageType),
  ));
}

/**
 * Imports a parsed CSV into the account, creating missing zones and tiers as
 * needed. Returns counts and warnings. Idempotent on cell upsert.
 *
 * Tự gác `manage_carrier_rates` trong thân hàm (xem khối chú thích ở `setCell`). Câu cũ
 * "Caller has already validated user permission" là SAI: không có chỗ gọi nào trong mã, nên
 * chẳng có "caller" nào kiểm quyền cả — đã sửa.
 */
export async function importMatrix(
  carrierAccountId: string,
  rateCardId: string,
  parsed: ParsedMatrixCsv,
): Promise<{ zonesCreated: number; tiersCreated: number; cellsWritten: number; warnings: string[] }> {
  const userId = await requirePerm('manage_carrier_rates');
  const warnings = [...parsed.warnings];

  // 1. Resolve / create zones by label
  const existingZones = await db
    .select()
    .from(schema.carrierZones)
    .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId));
  const zoneByLabel = new Map(existingZones.map((z) => [z.label, z]));

  let zonesCreated = 0;
  for (const label of parsed.zoneLabels) {
    if (zoneByLabel.has(label)) continue;
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(${schema.carrierZones.position}), -1) + 1` })
      .from(schema.carrierZones)
      .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId));
    const [row] = await db
      .insert(schema.carrierZones)
      .values({ carrierAccountId, label, position: next })
      .returning();
    zoneByLabel.set(label, row);
    zonesCreated += 1;
  }

  // 2. Resolve / create weight tiers by upperKg
  const existingTiers = await db
    .select()
    .from(schema.carrierWeightTiers)
    .where(eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId));
  const tierByUpper = new Map(existingTiers.map((t) => [Number(t.upperKg), t]));

  let tiersCreated = 0;
  for (const row of parsed.rows) {
    if (tierByUpper.has(row.upperKg)) continue;
    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(${schema.carrierWeightTiers.position}), -1) + 1` })
      .from(schema.carrierWeightTiers)
      .where(eq(schema.carrierWeightTiers.carrierAccountId, carrierAccountId));
    const [t] = await db
      .insert(schema.carrierWeightTiers)
      .values({ carrierAccountId, upperKg: row.upperKg.toString(), position: next })
      .returning();
    tierByUpper.set(row.upperKg, t);
    tiersCreated += 1;
  }

  // 3. Upsert cells
  let cellsWritten = 0;
  for (const row of parsed.rows) {
    const tier = tierByUpper.get(row.upperKg);
    if (!tier) continue;
    for (const r of row.rates) {
      const zone = zoneByLabel.get(r.zoneLabel);
      if (!zone) {
        warnings.push(`Zone "${r.zoneLabel}" not resolved — cell skipped`);
        continue;
      }
      await db
        .insert(schema.carrierRateCells)
        .values({
          rateCardId,
          carrierZoneId: zone.id,
          carrierWeightTierId: tier.id,
          packageType: 'package',
          costAmount: r.cost.toFixed(2),
          updatedBy: userId,
        })
        .onConflictDoUpdate({
          target: [
            schema.carrierRateCells.rateCardId,
            schema.carrierRateCells.carrierZoneId,
            schema.carrierRateCells.carrierWeightTierId,
            schema.carrierRateCells.packageType,
          ],
          set: { costAmount: r.cost.toFixed(2), updatedBy: userId, updatedAt: new Date() },
        });
      cellsWritten += 1;
    }
  }

  return { zonesCreated, tiersCreated, cellsWritten, warnings };
}
