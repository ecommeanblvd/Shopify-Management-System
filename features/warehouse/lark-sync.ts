/** Đối soát tồn kho: Lark "WH - Inventory" → SMS warehouse_inventory, ĐI QUA sổ
 *  cái (applyMovement) để giữ qty_reserved (allocator đang giữ) — KHÔNG ghi qty
 *  trực tiếp. Một chiều (Lark = nguồn sự thật cho on_hand). */
import { db, schema } from '@/db/client';
import { listWarehouseStockRecords } from '@/features/lark/client';
import { larkText } from '@/features/lark/parse-pack-row';
import { applyMovement } from './ledger';
import {
  larkNumber,
  larkStockCounts,
  lyDoTuChoiGhi,
  reconcilePlan,
  type CurrentInv,
  type LarkStockRow,
} from './lark-sync-logic';

export interface WarehouseSyncSummary {
  larkRows: number;
  larkSkus: number;
  planned: number;
  added: number;
  adjusted: number;
  zeroed: number;
  cappedByReserved: number;
  errors: string[];
  dryRun: boolean;
  /** Lý do chốt chặn từ chối ghi thật (xem `lyDoTuChoiGhi`); chạy thử cũng báo để biết trước. */
  tuChoi?: string;
  /** 15 dòng lệch lớn nhất — để người xem kế hoạch chạy thử mà không cần mở DB. */
  viDu: Array<{ sku: string; kho: string; truoc: number; sau: number; chamTran: boolean }>;
}

export async function syncWarehouseFromLark(
  opts?: { dryRun?: boolean },
): Promise<WarehouseSyncSummary> {
  const dryRun = opts?.dryRun ?? false;

  // 1) Nạp tồn từ Lark → LarkStockRow[] (mỗi dòng = 1 đơn vị).
  const records = await listWarehouseStockRecords();
  const rows: LarkStockRow[] = records.map((r) => ({
    sku: larkText(r.fields['Lineitem SKU final']),
    warehouseRaw: larkText(r.fields['Warehouse']) ?? '',
    // 'Final stock' là field CÔNG THỨC ({type,value:[n]}) → dùng larkNumber, KHÔNG larkText.
    finalStock: larkNumber(r.fields['Final stock']),
    productTitle: larkText(r.fields['Lineitem Name']),
  }));

  // 2) Nạp tồn hiện tại SMS.
  const invRows = await db
    .select({
      sku: schema.warehouseInventory.sku,
      warehouseCode: schema.warehouseInventory.warehouseCode,
      qtyOnHand: schema.warehouseInventory.qtyOnHand,
      qtyReserved: schema.warehouseInventory.qtyReserved,
    })
    .from(schema.warehouseInventory);
  const current: CurrentInv[] = invRows;

  // 3) Gom + lập kế hoạch đối soát (logic thuần).
  const lark = larkStockCounts(rows);
  const plan = reconcilePlan(lark, current);

  const cappedByReserved = plan.filter((p) => p.cappedByReserved).length;
  const base: WarehouseSyncSummary = {
    larkRows: rows.length,
    larkSkus: lark.size,
    planned: plan.length,
    added: 0,
    adjusted: 0,
    zeroed: 0,
    cappedByReserved,
    errors: [],
    dryRun,
    viDu: [...plan]
      .sort((a, b) => Math.abs(b.deltaOnHand) - Math.abs(a.deltaOnHand)).slice(0, 15)
      .map((p) => ({
        sku: p.sku, kho: p.warehouseCode, truoc: p.targetOnHand - p.deltaOnHand,
        sau: p.targetOnHand, chamTran: p.cappedByReserved,
      })),
  };
  const tuChoi = lyDoTuChoiGhi(rows.length, plan, current);
  if (tuChoi) base.tuChoi = tuChoi;

  if (dryRun) {
    // Ước lượng phân loại mà KHÔNG ghi.
    base.added = plan.filter((p) => p.isNew).length;
    base.zeroed = plan.filter((p) => !p.isNew && p.targetOnHand === 0).length;
    base.adjusted = plan.length - base.added - base.zeroed;
    return base;
  }

  // Chốt chặn: lượt GHI THẬT mà kế hoạch trông như lỗi đọc Lark thì dừng, báo lỗi ra /f/jobs.
  if (tuChoi) return { ...base, errors: [tuChoi] };

  // 4) Ghi qua sổ cái, mỗi item bọc try/catch để 1 dòng lỗi không phá cả lượt.
  const errors: string[] = [];
  let added = 0;
  let adjusted = 0;
  let zeroed = 0;

  await db.transaction(async (tx) => {
    for (const item of plan) {
      try {
        await applyMovement(tx, {
          sku: item.sku,
          warehouseCode: item.warehouseCode,
          deltaOnHand: item.deltaOnHand,
          deltaReserved: 0,
          reason: 'manual_adjust',
          actor: 'system:lark-sync',
          note: 'lark-sync reconcile',
          createIfMissing: item.isNew ? { productTitle: item.productTitle ?? null } : undefined,
        });
        if (item.isNew) added += 1;
        else if (item.targetOnHand === 0) zeroed += 1;
        else adjusted += 1;
      } catch (e) {
        const msg = `${item.sku}@${item.warehouseCode}: ${e instanceof Error ? e.message : String(e)}`;
        errors.push(msg);
        process.stderr.write(`lark-sync: lỗi item ${msg}\n`);
      }
    }
  });

  return { ...base, added, adjusted, zeroed, errors };
}
