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
import { chonVariantId, laSkuSale, phanLoFifo, type DongResale, type LoNhap, type TonHienTai } from './resale-ton-kho-logic';

/**
 * Store lấy `shopifyVariantId`: storefront CHÍNH của MEAN.
 *
 * Phải là store này, không phải store riêng của brand: danh mục MMP là danh mục sản phẩm MEAN
 * đang bán, và MMP yêu cầu rõ "tra theo store meanblvd". Mã của một store khác là biến thể
 * KHÁC trên Shopify, gửi sang là ghép sai sản phẩm.
 */
export const STORE_LAY_VARIANT = 'meanblvd';

/** Trần của MMP: 8 MB mỗi request, tối đa 20.000 dòng. */
export const TRAN_DONG = 20_000;
export const TRAN_BYTE = 8 * 1024 * 1024;

export interface AnhChupResale {
  snapshotId: string;
  guiLuc: string;
  items: Array<{
    sku: string;
    /** Chỉ có khi SKU ra ĐÚNG MỘT biến thể trên store `meanblvd` — xem `chonVariantId`. */
    shopifyVariantId?: string;
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
  thongKe: {
    dongTon: number; loNhap: number; dongResale: number; chiec: number;
    theoLoai: Record<string, number>;
    /** Số dòng mang được `shopifyVariantId` — MMP ghép theo mã này trước sku. */
    dongCoVariantId: number;
    skuNhapNhang: number;
    /** Dòng bị LOẠI vì SKU mang đuôi `-sale` — hợp đồng cấm gửi. Báo ra để không lặng lẽ. */
    dongSaleBoRa: number;
    chiecSaleBoRa: number;
  };
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

  // Mã biến thể LẤY THẲNG từ Shopify (bảng `shopify_variants`, store `meanblvd`) — MMP yêu
  // cầu 26/10/2026 vì danh mục của họ còn nhiều SKU dạng cũ của brand nên ghép theo sku hụt
  // 53%. Chỉ gửi khi SKU ra ĐÚNG MỘT biến thể; xem `chonVariantId`.
  const [storeMb] = await db.select({ id: schema.stores.id }).from(schema.stores)
    .where(eq(schema.stores.name, STORE_LAY_VARIANT)).limit(1);
  const maTheoSku = new Map<string, string[]>();
  if (storeMb) {
    const bt = await db.select({ sku: schema.shopifyVariants.sku, vid: schema.shopifyVariants.shopifyVariantId })
      .from(schema.shopifyVariants).where(eq(schema.shopifyVariants.storeId, storeMb.id));
    for (const r of bt) {
      if (!r.sku) continue;
      const k = r.sku.trim();
      const da = maTheoSku.get(k);
      if (da) da.push(r.vid); else maTheoSku.set(k, [r.vid]);
    }
  }

  const tatCa: DongResale[] = phanLoFifo(ton, loNhap);
  // LOẠI SKU đuôi `-sale`: hợp đồng ghi rõ "gửi ảnh chụp tồn theo SKU gốc, KHÔNG gửi SKU
  // -sale; MMP tự ghép sang bản sale". Lượt gửi 26/10/2026 đã LỌT 7 dòng loại này — đó là
  // bản bán lại do người dựng tay trên Shopify từ 2024, và kho ghi tồn ngay dưới SKU `-Sale`
  // đó (16 dòng, KHÔNG dòng nào có SKU gốc tương ứng trong `warehouse_inventory`). Gửi lên
  // là MMP thấy hai mặt hàng cho cùng một chiếc.
  const dongSale = tatCa.filter((d) => laSkuSale(d.sku));
  let dong: DongResale[] = tatCa.filter((d) => !laSkuSale(d.sku));
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
      items: dong.map((d) => {
        const vid = chonVariantId(maTheoSku.get(d.sku));
        return {
          sku: d.sku,
          ...(vid ? { shopifyVariantId: vid } : {}),
          soLuong: d.soLuong, ngayNhapKho: d.ngayNhapKho, kho: d.kho, loaiTon: d.loaiTon,
        };
      }),
    },
    thongKe: {
      dongTon: ton.length,
      loNhap: loNhap.length,
      dongResale: dong.length,
      chiec: dong.reduce((s, d) => s + d.soLuong, 0),
      theoLoai,
      dongCoVariantId: dong.filter((d) => chonVariantId(maTheoSku.get(d.sku)) != null).length,
      skuNhapNhang: [...new Set(dong.map((d) => d.sku))]
        .filter((s) => (maTheoSku.get(s) ?? []).length > 1).length,
      dongSaleBoRa: dongSale.length,
      chiecSaleBoRa: dongSale.reduce((s, d) => s + d.soLuong, 0),
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

/** Khoá job trong `job_runs` — cũng là khoá để tra lần gửi thành công trước. */
export const JOB_KEY_RESALE = 'gui-ton-kho-resale-mmp';

export interface TomTatGuiHangNgay {
  boQua?: string;
  dong?: number;
  chiec?: number;
  /**
   * Số dòng SKU `-sale` đã LOẠI. Phải có trong tóm tắt, vì nếu không thì không cách nào
   * biết từ `job_runs` là lượt đó có chạy phần loại hay không — 26/10/2026 đúng chuyện đó
   * xảy ra: lượt cron 05:23 báo 520 dòng, và chỉ sau khi đo tay mới biết 520 = 513 + 7, tức
   * nó chạy ảnh deploy CŨ và đã ghi đè bản đã sửa bên MMP.
   */
  dongSaleBoRa?: number;
  dongLanTruoc?: number | null;
  snapshotId?: string;
  http?: number;
  than?: string;
  errors?: string[];
}

/**
 * Việc chạy trong cron: MỖI NGÀY gửi một ảnh chụp, lỗi thì giờ sau tự thử lại.
 *
 * Đặt trong `sync-lark` NGAY SAU job đồng bộ tồn, để ảnh chụp dựng từ tồn vừa khớp trong
 * cùng tiến trình. Cadence "mỗi ngày" do `nenGuiHomNay` quyết, không do lịch cron — xem
 * chú thích của hàm đó.
 */
export async function chayGuiResaleHangNgay(): Promise<TomTatGuiHangNgay> {
  const url = process.env.MMP_RESALE_TON_KHO_URL
    ?? 'https://portal.meanblvd.com/api/integration/resale/ton-kho';

  // Lần gửi THÀNH CÔNG gần nhất: cho cả chốt mỗi-ngày và mốc so số dòng.
  const truoc = await db.execute(sql`
    select finished_at, summary from job_runs
    where job_key = ${JOB_KEY_RESALE} and status = 'ok' and (summary ->> 'dong') is not null
    order by started_at desc limit 1`);
  const hang = ((truoc as unknown as { rows?: Array<Record<string, unknown>> }).rows
    ?? (truoc as unknown as Array<Record<string, unknown>>))?.[0];
  const lanCuoi = hang?.finished_at ? new Date(String(hang.finished_at)) : null;
  const dongLanTruoc = hang?.summary
    ? Number((hang.summary as Record<string, unknown>).dong ?? NaN)
    : NaN;
  const mocSo = Number.isFinite(dongLanTruoc) ? dongLanTruoc : null;

  const { nenGuiHomNay, lyDoKhongGui } = await import('./resale-ton-kho-logic');
  if (!nenGuiHomNay(lanCuoi, new Date())) {
    return { boQua: `hôm nay đã gửi thành công lúc ${lanCuoi?.toISOString()}`, dongLanTruoc: mocSo };
  }

  const { anh, thongKe } = await dungAnhChupResale();
  const chan = lyDoKhongGui(anh.items.length, mocSo);
  if (chan) {
    // Trả qua `errors` để lượt chạy đỏ trên /f/jobs — người xem rồi quyết, thay vì tự gửi.
    return {
      dong: anh.items.length, chiec: thongKe.chiec, dongSaleBoRa: thongKe.dongSaleBoRa,
      dongLanTruoc: mocSo, errors: [chan],
    };
  }

  const r = await guiAnhChupResale(anh, url);
  return {
    dong: anh.items.length,
    chiec: thongKe.chiec,
    dongSaleBoRa: thongKe.dongSaleBoRa,
    dongLanTruoc: mocSo,
    snapshotId: anh.snapshotId,
    http: r.http,
    than: r.than,
    ...(r.ok ? {} : { errors: [r.loi ?? `http ${r.http}: ${r.than ?? ''}`] }),
  };
}
