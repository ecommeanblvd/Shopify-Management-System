/**
 * Dựng và GỬI ảnh chụp tồn kho resale sang MMP.
 *
 * Hợp đồng: `docs/mmp/resale-ton-kho.md`. Logic thuần ở `resale-ton-kho-logic.ts`.
 *
 * Tệp này CỐ Ý KHÔNG có `'use server'`: nó gọi ra ĐỐI TÁC, chỉ được chạy từ script/cron có
 * chủ đích, không bao giờ là endpoint cho trình duyệt.
 */
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { signMmpPayload } from '@/features/mmp/hmac';
import { mapWarehouseCode } from '@/features/warehouse/item-import-logic';
import { phanLoFifo, type DongResale, type LoNhap, type TonHienTai } from './resale-ton-kho-logic';

/** Trần của MMP: 8 MB mỗi request, tối đa 20.000 dòng. */
export const TRAN_DONG = 20_000;
export const TRAN_BYTE = 8 * 1024 * 1024;

export interface AnhChupResale {
  snapshotId: string;
  guiLuc: string;
  items: Array<{
    sku: string;
    soLuong: number;
    ngayNhapKho: string;
    kho?: string;
    /** Trường THÊM ngoài hợp đồng gốc — CEO 26/10/2026 yêu cầu MMP thấy rõ loại hàng tồn.
     *  Hợp đồng chưa có chỗ cho nó (chỉ có sku/shopifyVariantId/soLuong/ngayNhapKho/kho),
     *  nên MMP phải nhận và hiện cột này mới dùng được; gửi thử một ảnh nhỏ để biết họ có
     *  từ chối trường lạ không. */
    loaiTon: string;
  }>;
}

/** Đọc hai nguồn rồi dựng ảnh chụp. CHỈ ĐỌC CSDL, không gọi ra ngoài. */
export async function dungAnhChupResale(opts?: { gioiHan?: number }): Promise<{
  anh: AnhChupResale;
  thongKe: { dongTon: number; loNhap: number; dongResale: number; chiec: number; theoLoai: Record<string, number> };
}> {
  const tonRows = await db.select({
    sku: schema.warehouseInventory.sku,
    kho: schema.warehouseInventory.warehouseCode,
    qtyOnHand: schema.warehouseInventory.qtyOnHand,
    qtyReserved: schema.warehouseInventory.qtyReserved,
  }).from(schema.warehouseInventory).where(sql`${schema.warehouseInventory.qtyOnHand} > 0`);
  const ton: TonHienTai[] = tonRows;

  // Sổ nhập: chỉ dòng ĐÃ LƯU KHO, có đủ sku và ngày. `wh_action` là chữ người gõ trên Lark
  // nên so bằng hằng, không regex.
  const loRows = await db.select({
    sku: schema.larkWhInventory.sku,
    khoRaw: schema.larkWhInventory.warehouse,
    ngay: schema.larkWhInventory.ngayImport,
    soLuong: schema.larkWhInventory.soLuong,
    loaiTon: schema.larkWhInventory.inventoryType,
  }).from(schema.larkWhInventory).where(and(
    eq(schema.larkWhInventory.whAction, 'Lưu kho'),
    isNotNull(schema.larkWhInventory.sku),
    ne(schema.larkWhInventory.sku, ''),
    isNotNull(schema.larkWhInventory.ngayImport),
    isNotNull(schema.larkWhInventory.inventoryType),
  ));

  const loNhap: LoNhap[] = loRows.flatMap((r) => {
    const sl = r.soLuong ?? 0;
    if (sl <= 0) return [];
    return [{
      sku: r.sku!.trim(),
      kho: mapWarehouseCode(r.khoRaw ?? ''),
      ngayNhapKho: String(r.ngay),
      soLuong: sl,
      loaiTon: r.loaiTon!,
    }];
  });

  let dong: DongResale[] = phanLoFifo(ton, loNhap);
  // Giới hạn dùng cho lượt GỬI THỬ mà hợp đồng yêu cầu. Cắt theo thứ tự đã dựng, không
  // xáo — để lượt thử lặp lại được.
  if (opts?.gioiHan != null && opts.gioiHan > 0) dong = dong.slice(0, opts.gioiHan);

  const theoLoai: Record<string, number> = {};
  for (const d of dong) theoLoai[d.loaiTon] = (theoLoai[d.loaiTon] ?? 0) + d.soLuong;

  const luc = new Date();
  return {
    anh: {
      // `guiLuc` KHÔNG được sớm hơn giờ MMP quá 5 phút, nên lấy đúng lúc dựng.
      snapshotId: `resale-${luc.toISOString()}`,
      guiLuc: luc.toISOString(),
      // `shopifyVariantId` CỐ Ý BỎ TRỐNG: hợp đồng cho phép, và MMP ghép theo ID TRƯỚC khi
      // ghép theo sku — gửi một ID đoán sai là ghép vào SẢN PHẨM KHÁC. Để trống thì MMP
      // ghép theo sku, đường đã được hợp đồng bảo đảm.
      items: dong.map((d) => ({
        sku: d.sku, soLuong: d.soLuong, ngayNhapKho: d.ngayNhapKho, kho: d.kho, loaiTon: d.loaiTon,
      })),
    },
    thongKe: {
      dongTon: ton.length,
      loNhap: loNhap.length,
      dongResale: dong.length,
      chiec: dong.reduce((s, d) => s + d.soLuong, 0),
      theoLoai,
    },
  };
}

export interface KetQuaGui {
  ok: boolean;
  http?: number;
  than?: string;
  loi?: string;
}

/**
 * POST ảnh chụp sang MMP. Ký HMAC trên ĐÚNG chuỗi byte đã gửi.
 *
 * `MMP_WEBHOOK_SECRET` — cùng secret với webhook `ship-ho/order-updates` đang chạy
 * (`features/ship-ho/statement-push.ts:80` ký bằng đúng biến này). Chưa cấu hình thì
 * KHÔNG gửi gì.
 */
export async function guiAnhChupResale(anh: AnhChupResale, url: string): Promise<KetQuaGui> {
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!secret) return { ok: false, loi: 'chưa cấu hình MMP_WEBHOOK_SECRET — KHÔNG gửi' };
  if (anh.items.length > TRAN_DONG) return { ok: false, loi: `${anh.items.length} dòng > trần ${TRAN_DONG}` };

  // Ký trên rawBody rồi gửi ĐÚNG chuỗi đó. Không được stringify lại sau khi ký.
  const rawBody = JSON.stringify(anh);
  const byte = Buffer.byteLength(rawBody, 'utf8');
  if (byte > TRAN_BYTE) return { ok: false, loi: `thân ${byte} byte > trần ${TRAN_BYTE}` };

  const ts = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mean-signature': signMmpPayload(secret, ts, rawBody),
        'x-mean-timestamp': String(ts),
      },
      body: rawBody,
      signal: AbortSignal.timeout(30_000),
    });
    const than = await res.text();
    return { ok: res.ok, http: res.status, than: than.slice(0, 2000) };
  } catch (e) {
    return { ok: false, loi: e instanceof Error ? e.message : String(e) };
  }
}
