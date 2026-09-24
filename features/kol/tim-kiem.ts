'use server';

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { cacDangIdShopify } from '@/features/receiving/ma-tem';
import { requireXemKol } from './perm';
import { dienGiaiQuetTaoDon, ghepTenBienThe } from './quet';
import { boDauTiengViet } from './bo-dau';
import { traGiaVonNhieuSku } from './gia-von-nhieu';
import { ngayKinhDoanh } from '@/lib/timezone';
import { WAREHOUSE_PRIORITY } from '@/features/warehouse/allocation-logic';
import type { KetQuaBienThe, KetQuaQuet } from './types';

/** Tối đa số dòng trả về cho một lượt gõ tìm — 120.817 biến thể KHÔNG được tải hết ra trình duyệt. */
const GIOI_HAN_KET_QUA = 20;

/** Gõ dưới 2 ký tự thì không tìm: vừa vô nghĩa (quá nhiều khớp) vừa là lượt quét toàn bảng đắt nhất. */
const DO_DAI_TU_KHOA_TOI_THIEU = 2;


/**
 * Tìm biến thể theo SKU / tên sản phẩm / tên biến thể, KHÔNG PHÂN BIỆT DẤU.
 *
 * Khớp trên cột sinh `shopify_variants.tim_kiem` (migration 0163) — đã gộp ba
 * trường, hạ chữ thường và bỏ dấu sẵn, có GIN trigram. Từ khoá phải đi qua
 * ĐÚNG cùng phép biến đổi (`boDauTiengViet`), nếu không gõ "áo dài" sẽ không
 * bao giờ khớp nổi "ao dai" đã lưu; có test đối chiếu hai bên.
 *
 * Vì sao không bỏ dấu ngay trong WHERE: bảng có 120.528 biến thể, đo thật
 * 24/09 thì `translate()` trong WHERE buộc quét toàn bảng mất 4.322ms mỗi lượt
 * gõ. Qua cột sinh + index còn 73ms.
 *
 * Trả kèm TỒN TÁCH THEO KHO và GIÁ VỐN — bản thiết kế 24/09 hiện cả hai ngay
 * trong ô tìm để người chọn biết kho nào có hàng trước khi chọn dòng. Hai thứ
 * đó tra riêng cho ĐÚNG số SKU đã lọc (tối đa 20), không join vào lượt quét.
 */
export async function timKiemBienThe(tuKhoa: string): Promise<KetQuaBienThe[]> {
  await requireXemKol();
  const q = tuKhoa.trim();
  if (q.length < DO_DAI_TU_KHOA_TOI_THIEU) return [];
  const like = `%${boDauTiengViet(q)}%`;

  const rows = await db
    .select({
      sku: schema.shopifyVariants.sku,
      tenSanPham: schema.shopifyVariants.productTitle,
      tenBienThe: schema.shopifyVariants.variantTitle,
    })
    .from(schema.shopifyVariants)
    .where(and(
      isNotNull(schema.shopifyVariants.sku),
      sql`${schema.shopifyVariants}.tim_kiem LIKE ${like}`,
    ))
    .orderBy(schema.shopifyVariants.productTitle)
    .limit(GIOI_HAN_KET_QUA);

  const skus = [...new Set(rows.map((r) => r.sku!).filter(Boolean))];
  if (skus.length === 0) return [];

  const [tonRows, gia] = await Promise.all([
    db.select({
      sku: schema.warehouseInventory.sku,
      kho: schema.warehouseInventory.warehouseCode,
      ton: sql<number>`coalesce(sum(${schema.warehouseInventory.qtyOnHand} - ${schema.warehouseInventory.qtyReserved}), 0)::int`,
    })
      .from(schema.warehouseInventory)
      .where(inArray(schema.warehouseInventory.sku, skus))
      .groupBy(schema.warehouseInventory.sku, schema.warehouseInventory.warehouseCode),
    // ĐÚNG luật với lúc ghi đơn: quy SKU về một cửa hàng rồi mới tra, và chọn
    // bản ghi hiệu lực theo NGÀY KINH DOANH. Xem `gia-von-nhieu.ts`.
    traGiaVonNhieuSku(skus, ngayKinhDoanh(new Date())!),
  ]);

  const theoKho = new Map<string, Map<string, number>>();
  for (const t of tonRows) {
    if (!t.sku) continue;
    const m = theoKho.get(t.sku) ?? new Map<string, number>();
    m.set(t.kho, (m.get(t.kho) ?? 0) + t.ton);
    theoKho.set(t.sku, m);
  }
  return rows.map((r) => {
    const m = theoKho.get(r.sku!) ?? new Map<string, number>();
    // Liệt kê ĐỦ mọi kho kể cả kho 0 tồn — người chọn cần thấy "kho kia cũng
    // hết" chứ không phải một danh sách khuyết khiến tưởng chưa tra.
    const tonTheoKho = WAREHOUSE_PRIORITY.map((kho) => ({ kho, ton: m.get(kho) ?? 0 }));
    const g = gia.get(r.sku!);
    return {
      sku: r.sku!,
      tenHang: ghepTenBienThe(r.tenSanPham, r.tenBienThe),
      ton: tonTheoKho.reduce((a, x) => a + x.ton, 0),
      tonTheoKho,
      giaVon: g?.gia ?? null,
      giaVonTienTe: g?.tienTe ?? null,
    };
  });
}

/**
 * Bù đủ TỒN THEO KHO + GIÁ VỐN cho một SKU đã biết tên — dùng cho hai nhánh
 * QUÉT (tem `V:` và tem `L:`), để kết quả quét và kết quả gõ tìm có CÙNG một
 * hình dạng. Thiếu cái này thì quét xong ô sản phẩm mất phần tồn/giá vốn mà
 * gõ tay lại có, và không ai biết vì sao.
 */
async function boSungTonVaGia(sku: string, tenHang: string): Promise<KetQuaBienThe> {
  const [tonRows, gia] = await Promise.all([
    db.select({
      kho: schema.warehouseInventory.warehouseCode,
      ton: sql<number>`coalesce(sum(${schema.warehouseInventory.qtyOnHand} - ${schema.warehouseInventory.qtyReserved}), 0)::int`,
    })
      .from(schema.warehouseInventory)
      .where(eq(schema.warehouseInventory.sku, sku))
      .groupBy(schema.warehouseInventory.warehouseCode),
    traGiaVonNhieuSku([sku], ngayKinhDoanh(new Date())!),
  ]);
  const m = new Map(tonRows.map((t) => [t.kho, t.ton]));
  const tonTheoKho = WAREHOUSE_PRIORITY.map((kho) => ({ kho, ton: m.get(kho) ?? 0 }));
  const g = gia.get(sku);
  return {
    sku,
    tenHang,
    ton: tonTheoKho.reduce((a, x) => a + x.ton, 0),
    tonTheoKho,
    giaVon: g?.gia ?? null,
    giaVonTienTe: g?.tienTe ?? null,
  };
}

/** Tra một biến thể theo `shopify_variant_id` (tem `V:`) — DB lưu GID đầy đủ, tem chỉ mang số trần. */
async function bienTheTheoShopifyVariantId(shopifyVariantId: string): Promise<KetQuaBienThe | null> {
  const [row] = await db.select({
    sku: schema.shopifyVariants.sku,
    tenSanPham: schema.shopifyVariants.productTitle,
    tenBienThe: schema.shopifyVariants.variantTitle,
  }).from(schema.shopifyVariants)
    .where(inArray(schema.shopifyVariants.shopifyVariantId, cacDangIdShopify(shopifyVariantId, 'ProductVariant')))
    .limit(1);
  if (!row?.sku) return null;
  return boSungTonVaGia(row.sku, ghepTenBienThe(row.tenSanPham, row.tenBienThe));
}

/**
 * Tra biến thể của MỘT dòng đơn Shopify (tem `L:`) — `shopify_order_lines` đã
 * ghi phẳng sẵn sku/tên/biến thể ngay trên dòng, không cần nối sang
 * `shopify_variants`.
 */
async function bienTheTheoDongDon(shopifyLineId: string): Promise<KetQuaBienThe | null> {
  const [row] = await db.select({
    sku: schema.shopifyOrderLines.sku,
    tenSanPham: schema.shopifyOrderLines.productTitle,
    tenBienThe: schema.shopifyOrderLines.variantTitle,
  }).from(schema.shopifyOrderLines)
    .where(inArray(schema.shopifyOrderLines.shopifyLineId, cacDangIdShopify(shopifyLineId, 'LineItem')))
    .limit(1);
  if (!row?.sku) return null;
  return boSungTonVaGia(row.sku, ghepTenBienThe(row.tenSanPham, row.tenBienThe));
}

/**
 * Diễn giải MỘT chuỗi vừa quét (máy quét tay hoặc camera) khi đang tạo đơn
 * KOL. Chỉ ĐỌC — gác bằng `requireXemKol` giống `goiYGiaVon`/`traTonKhaDung`.
 */
export async function giaiMaQuetTaoDon(raw: string): Promise<KetQuaQuet> {
  await requireXemKol();
  const giai = dienGiaiQuetTaoDon(raw);

  if (giai.ket === 'khong_nhan_dang') {
    return { ok: false, raw, loi: `Không nhận diện được mã "${raw}" — có thể là mã vạch của brand, hệ thống này không lưu mã đó.` };
  }
  if (giai.ket === 'khong_ap_dung') {
    return {
      ok: false,
      raw,
      loi: giai.loLoai === 'mon'
        ? `"${raw}" là tem MÓN (kho nhận hàng) — không dùng được khi tạo đơn KOL.`
        : `"${raw}" là mã ĐƠN Shopify — không dùng được khi tạo đơn KOL.`,
    };
  }
  if (giai.ket === 'bien_the') {
    const bt = await bienTheTheoShopifyVariantId(giai.shopifyVariantId);
    return bt ? { ok: true, bienThe: bt } : { ok: false, raw, loi: 'Không tìm thấy biến thể này trong hệ thống (có thể chưa đồng bộ từ Shopify).' };
  }
  const bt = await bienTheTheoDongDon(giai.shopifyLineId);
  return bt ? { ok: true, bienThe: bt } : { ok: false, raw, loi: 'Không tìm thấy dòng đơn này trong hệ thống.' };
}
