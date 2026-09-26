'use server';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { applyMovement } from '@/features/warehouse/ledger';
import { recomputeRollup } from '@/features/fulfillment/rollup';
import { putObject, getSignedDownloadUrl } from '@/lib/storage/s3';
import { kiemDongKien } from './logic';

const chuoiSo = (v: number | null) => (v == null ? null : String(v));

export interface DongKienVao {
  orderId: string;
  lineIds: string[];
  canKg: number | null;
  daiCm: number | null;
  rongCm: number | null;
  caoCm: number | null;
  hopRecordId: string | null;
  hopTen: string | null;
}

/**
 * Đóng MỘT kiện từ các chiếc đã sẵn sàng của một đơn.
 *
 * Đi thẳng `in_stock → packed`, nhưng PHẢI đi qua `picked` ở giữa chứ không
 * nhảy cóc: chính bước `picked` mới trừ tồn kho (`applyMovement` reason
 * `pick`). Nhảy thẳng sang `packed` là hàng rời kho mà sổ tồn vẫn đếm nó —
 * allocation sẽ đem chiếc đó cấp cho đơn khác.
 *
 * Toàn bộ nằm trong MỘT transaction: đóng nửa chừng rồi hỏng thì vừa có kiện
 * rỗng vừa có chiếc mất dấu.
 */
export async function dongKien(v: DongKienVao): Promise<{ ok: boolean; kienId?: string; loi?: string }> {
  const actor = await requirePerm('manage_qc');
  const kiem = kiemDongKien(v);
  if (!kiem.ok) return { ok: false, loi: kiem.loi };

  try {
    const kienId = await db.transaction(async (tx) => {
      const [ful] = await tx.select({ id: schema.orderFulfillment.id })
        .from(schema.orderFulfillment)
        .where(eq(schema.orderFulfillment.orderId, v.orderId)).limit(1);
      if (!ful) throw new Error('Đơn chưa có bản ghi fulfillment.');

      // Khoá dòng đơn TRƯỚC khi đụng tồn — cùng thứ tự với allocateLine để hai
      // luồng không chờ vòng nhau.
      const dong = await tx.select().from(schema.orderFulfillmentLines)
        .where(and(
          eq(schema.orderFulfillmentLines.fulfillmentId, ful.id),
          inArray(schema.orderFulfillmentLines.id, v.lineIds),
        ))
        .orderBy(asc(schema.orderFulfillmentLines.id))
        .for('update');
      const dungDuoc = dong.filter((l) => l.status === 'in_stock' && l.shipmentId == null);
      if (dungDuoc.length === 0) throw new Error('Không còn chiếc nào hợp lệ — có thể người khác vừa đóng.');

      const seq = await tx.execute(sql`SELECT nextval('pack_code_seq')::bigint AS seq`);
      const hang = ((seq as unknown as { rows?: { seq: string }[] }).rows ?? (seq as unknown as { seq: string }[]));
      if (!hang[0]) throw new Error('pack_code_seq trả về rỗng.');
      const ma = `PK-${hang[0].seq}`;

      const kho = (await tx.select({ kho: schema.goodsReceiptItems.currentWarehouseCode })
        .from(schema.goodsReceiptItems)
        .where(and(
          inArray(schema.goodsReceiptItems.fulfillmentLineId, dungDuoc.map((l) => l.id)),
          eq(schema.goodsReceiptItems.stockStatus, 'allocated'),
        )).limit(1))[0]?.kho ?? null;

      const [kien] = await tx.insert(schema.shipments).values({
        orderId: v.orderId,
        logUniqueCode: ma,
        dimLengthCm: chuoiSo(v.daiCm), dimWidthCm: chuoiSo(v.rongCm), dimHeightCm: chuoiSo(v.caoCm),
        actualWeightKg: chuoiSo(v.canKg),
        originHub: kho,
        larkHop: v.hopTen?.trim() || null,
        hopLarkRecordId: v.hopRecordId?.trim() || null,
        pieces: dungDuoc.length,
      }).returning({ id: schema.shipments.id });

      for (const l of dungDuoc) {
        // 1) in_stock → picked: món RỜI KHO, trừ cả on_hand lẫn reserved.
        const [mon] = await tx.select({
          id: schema.goodsReceiptItems.id,
          sku: schema.goodsReceiptItems.sku,
          kho: schema.goodsReceiptItems.currentWarehouseCode,
        }).from(schema.goodsReceiptItems)
          .where(and(eq(schema.goodsReceiptItems.fulfillmentLineId, l.id),
                     eq(schema.goodsReceiptItems.stockStatus, 'allocated')))
          .orderBy(asc(schema.goodsReceiptItems.id)).limit(1).for('update');
        if (mon?.sku && mon.kho) {
          await tx.update(schema.goodsReceiptItems)
            .set({ stockStatus: 'picked', updatedAt: sql`now()` })
            .where(eq(schema.goodsReceiptItems.id, mon.id));
          await applyMovement(tx, {
            sku: mon.sku, warehouseCode: mon.kho,
            deltaOnHand: -1, deltaReserved: -1,
            reason: 'pick', refType: 'item', refId: mon.id, actor,
          });
        }

        // 2) picked → packed, gắn vào kiện. Guard trên trạng thái CŨ: hai người
        //    cùng đóng một đơn thì người thua phải hỏng ở đây để rollback lượt
        //    trừ tồn phía trên, không thì tồn bị trừ hai lần.
        const xong = await tx.update(schema.orderFulfillmentLines)
          .set({
            status: 'packed', shipmentId: kien.id,
            pickedAt: sql`now()`, packedAt: sql`now()`, updatedAt: sql`now()`,
          })
          .where(and(eq(schema.orderFulfillmentLines.id, l.id),
                     eq(schema.orderFulfillmentLines.status, 'in_stock')))
          .returning({ id: schema.orderFulfillmentLines.id });
        if (xong.length === 0) throw new Error('Dòng vừa bị người khác thao tác — tải lại và thử lại.');

        await tx.insert(schema.orderFulfillmentEvents).values({
          fulfillmentId: ful.id, lineId: l.id,
          fromStatus: 'in_stock', toStatus: 'packed', actor, note: `Đóng kiện ${ma}`,
        });
      }

      await recomputeRollup(tx, ful.id);
      return kien.id;
    });

    revalidatePath('/f/warehouse/dong-goi');
    return { ok: true, kienId };
  } catch (e) {
    console.error('[dong-goi] dongKien lỗi:', e);
    return { ok: false, loi: e instanceof Error ? e.message : 'Đóng kiện thất bại.' };
  }
}

/** Ảnh kiện đã đóng. Tải file VÀ ghi dòng trong cùng một lượt gọi — như bước nhận. */
export async function themAnhKien(formData: FormData): Promise<{ ok: boolean; loi?: string }> {
  const userId = await requirePerm('manage_qc');
  const kienId = String(formData.get('kienId') ?? '');
  const file = formData.get('file');
  if (!kienId) return { ok: false, loi: 'Thiếu kiện.' };
  if (!(file instanceof File) || file.size === 0) return { ok: false, loi: 'Chưa chọn file.' };
  try {
    const [k] = await db.select({ id: schema.shipments.id })
      .from(schema.shipments).where(eq(schema.shipments.id, kienId)).limit(1);
    if (!k) return { ok: false, loi: 'Không tìm thấy kiện.' };
    const ten = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `packs/${kienId}/${Date.now()}-${ten}`;
    await putObject(key, new Uint8Array(await file.arrayBuffer()), file.type || 'application/octet-stream');
    await db.insert(schema.whAnhKien).values({
      shipmentId: kienId, s3Key: key, tenFile: file.name, nguoiTai: userId,
    });
    revalidatePath('/f/warehouse/dong-goi');
    return { ok: true };
  } catch (e) {
    console.error('[dong-goi] themAnhKien lỗi:', e);
    return { ok: false, loi: 'Tải lên thất bại, thử lại.' };
  }
}

export async function xoaAnhKien(id: string): Promise<{ ok: boolean; loi?: string }> {
  await requirePerm('manage_qc');
  try {
    await db.delete(schema.whAnhKien).where(eq(schema.whAnhKien.id, id));
    revalidatePath('/f/warehouse/dong-goi');
    return { ok: true };
  } catch (e) {
    console.error('[dong-goi] xoaAnhKien lỗi:', e);
    return { ok: false, loi: 'Gỡ ảnh thất bại.' };
  }
}

export interface AnhKien { id: string; tenFile: string | null; url: string | null }

export async function anhCuaKien(kienId: string): Promise<AnhKien[]> {
  await requirePerm('view_receiving');
  const ds = await db.select({
    id: schema.whAnhKien.id, s3Key: schema.whAnhKien.s3Key, tenFile: schema.whAnhKien.tenFile,
  }).from(schema.whAnhKien)
    .where(eq(schema.whAnhKien.shipmentId, kienId))
    .orderBy(asc(schema.whAnhKien.createdAt));
  return Promise.all(ds.map(async (a) => ({
    id: a.id, tenFile: a.tenFile,
    url: await getSignedDownloadUrl(a.s3Key).catch(() => null),
  })));
}
