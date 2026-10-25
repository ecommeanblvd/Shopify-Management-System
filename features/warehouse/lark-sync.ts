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
  phanLoaiVeKhong,
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
  /**
   * Câu env cần đặt để ghi ĐÚNG MỘT LƯỢT kế hoạch này. Chỉ có khi đang bị trần chặn.
   *
   * Phải in ra đây, vì nếu không thì người vận hành không có cách nào biết khai số nào —
   * chốt chặn bảo "xem kế hoạch rồi quyết" mà không nói quyết bằng gì.
   */
  cachGhiMotLuot?: string;
  /** 15 dòng lệch lớn nhất — để người xem kế hoạch chạy thử mà không cần mở DB. */
  viDu: Array<{ sku: string; kho: string; truoc: number; sau: number; chamTran: boolean }>;
  /**
   * Nhóm "về 0" tách theo NGUYÊN NHÂN — phần quyết định được việc có nên ghi hay không.
   *
   * `reconcilePlan` coi dòng VẮNG trên Lark là đích 0, nên `zeroed` một mình trộn hai
   * nguyên nhân khác hẳn nhau. Không có phần tách này thì chốt chặn bảo người ta "xem kế
   * hoạch rồi quyết" mà kế hoạch không chứa cái để quyết (đo 25/10/2026: chốt chặn đã từ
   * chối ghi suốt nhiều giờ, 351/882 dòng, không ai biết nguyên nhân nào).
   */
  veKhong: {
    larkNoi0: number;
    larkIm: number;
    khoKhac: number;
    larkImThatSu: number;
    chiecMatLarkNoi0: number;
    chiecMatLarkIm: number;
    /** 10 dòng nghi LỆCH ÁNH XẠ KHO, kèm kho mà Lark đang ghi — soi được ngay từ /f/jobs. */
    viDuKhoKhac: Array<{ sku: string; khoSms: string; smsDangCo: number; larkOKho: string }>;
  };
}

export async function syncWarehouseFromLark(
  opts?: { dryRun?: boolean; veKhongChoPhep?: number | null },
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
    veKhong: (() => {
      const t = phanLoaiVeKhong(lark, plan);
      const khoCua = (sku: string) => [...lark.keys()]
        .filter((k) => k.slice(0, k.lastIndexOf('|')) === sku)
        .map((k) => `${k.slice(k.lastIndexOf('|') + 1)}=${lark.get(k)!.qty}`).join(' ');
      return {
        larkNoi0: t.larkNoi0.length,
        larkIm: t.larkIm.length,
        khoKhac: t.khoKhac.length,
        larkImThatSu: t.larkImThatSu.length,
        chiecMatLarkNoi0: t.chiecMatLarkNoi0,
        chiecMatLarkIm: t.chiecMatLarkIm,
        viDuKhoKhac: t.khoKhac.slice(0, 10).map((p) => ({
          sku: p.sku, khoSms: p.warehouseCode, smsDangCo: -p.deltaOnHand, larkOKho: khoCua(p.sku),
        })),
      };
    })(),
  };
  const tuChoi = lyDoTuChoiGhi(rows.length, plan, current, lark, opts?.veKhongChoPhep);
  if (tuChoi) {
    base.tuChoi = tuChoi;
    const veKhong = plan.filter((p) => !p.isNew && p.targetOnHand === 0).length;
    // Chỉ gợi câu env khi cái chặn là TRẦN; nếu Lark trả 0 dòng thì không có cờ nào nhường.
    if (rows.length > 0) base.cachGhiMotLuot = `WH_TON_KHO_LARK=ghi-mot-luot:${veKhong}`;
  }

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
