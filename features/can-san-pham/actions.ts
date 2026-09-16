'use server';

/**
 * Trang "Sửa cân sản phẩm": đọc đề xuất, duyệt để đẩy cân mới lên Shopify, hoặc bỏ qua
 * (CEO 16/09/2026). Xem được: ai xem được KPI logistics. Duyệt / bỏ qua: CHỈ admin.
 *
 * Ghi lên Shopify đi qua `runMutation` — cổng ghi duy nhất, đủ bốn chốt: store đang chạy, cờ tính
 * năng bật, đủ quyền, và có ảnh chụp cân CŨ trước khi đổi (để còn đường quay lại).
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { runMutation } from '@/lib/shopify/writer';
import { isFeatureEnabled } from '@/lib/flags/flags';
import { recordAudit } from '@/lib/logging/audit';
import { hashPayload } from '@/lib/snapshots/snapshots';
import { STORE_VAN_HANH } from '@/features/kpi-logistics/pham-vi';
import { productWeightsManifest } from './manifest';
import { tongHopDeXuat, type DeXuatCan, type DonBangChung } from './de-xuat';
import { HE_SO_QUY_DOI } from '@/features/shipments/lech-can';

/** Lý do giải trình cho thấy cân web cần sửa. */
const LY_DO_SUA_CAN = ['can_quy_doi_web', 'rule_thung_brand'];

async function nguoiDung(): Promise<{ id: string; admin: boolean }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  const role = await getRole(session.user.id);
  if (role !== 'admin' && !(role && hasPermission(role, 'view_kpi_logistics'))) {
    throw new Error('Không có quyền xem đề xuất cân sản phẩm');
  }
  return { id: session.user.id, admin: role === 'admin' };
}

export interface BienThe { variantId: string; productId: string; productTitle: string; variantTitle: string | null; canG: number | null }

export interface DongDeXuat extends DeXuatCan {
  bienThe: BienThe[];
  /** Các biến thể trùng SKU mà cân đang khác nhau — người duyệt nên để ý. */
  canLech: boolean;
  lanDayLoi: string | null;
}

export interface TrangDeXuat {
  duyetDuoc: boolean;
  /** Store đã cấp quyền ghi sản phẩm chưa — chưa thì nút đẩy khoá. */
  coQuyenGhi: boolean;
  dong: DongDeXuat[];
  /** Lần đồng bộ cân từ Shopify gần nhất. */
  dongBoLuc: string | null;
}

async function storeVanHanh() {
  const [st] = await db.select().from(schema.stores).where(eq(schema.stores.shopDomain, STORE_VAN_HANH)).limit(1);
  if (!st) throw new Error('Không tìm thấy store MEAN BLVD');
  return st;
}

export async function docDeXuatCan(): Promise<TrangDeXuat> {
  const nd = await nguoiDung();
  const st = await storeVanHanh();

  const { rows } = await db.execute<{ oid: string; don: string; billed: string | null; thung_to: boolean; sku_muc_tieu: string | null; sku: string; sl: number; can_g: string | null }>(sql`
    SELECT o.id AS oid, o.shopify_order_number AS don,
           (SELECT SUM(ch.billing_weight_kg) FROM shipments s JOIN shipment_charges ch ON ch.shipment_id = s.id
             WHERE s.order_id = o.id)::text AS billed,
           EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id AND s.actual_weight_kg IS NOT NULL
                     AND s.dim_length_cm * s.dim_width_cm * s.dim_height_cm / ${HE_SO_QUY_DOI} > 2
                     AND s.dim_length_cm * s.dim_width_cm * s.dim_height_cm / ${HE_SO_QUY_DOI} >= 2 * s.actual_weight_kg) AS thung_to,
           gt.chi_tiet->>'skuCanSua' AS sku_muc_tieu,
           l.sku, l.quantity AS sl,
           (SELECT MAX(v.weight_grams) FROM shopify_variants v WHERE v.store_id = o.store_id AND v.sku = l.sku)::text AS can_g
      FROM am_cuoc_giai_trinh gt
      JOIN shopify_orders o ON o.id = gt.order_id
      JOIN shopify_order_lines l ON l.order_id = o.id
     WHERE gt.ly_do = ANY(${LY_DO_SUA_CAN}) AND o.store_id = ${st.id}
       AND l.sku IS NOT NULL AND l.sku <> ''`);

  const theoDon = new Map<string, DonBangChung>();
  for (const r of rows) {
    if (r.billed == null) continue;
    const d = theoDon.get(r.oid) ?? {
      maDon: r.don, billedKg: Number(r.billed), dong: [], thungQuaTo: r.thung_to,
      skuMucTieu: r.sku_muc_tieu ? r.sku_muc_tieu.split('\n') : null,
    };
    d.dong.push({ sku: r.sku, soLuong: Number(r.sl), canHienTaiG: r.can_g == null ? null : Number(r.can_g) });
    theoDon.set(r.oid, d);
  }
  const deXuat = tongHopDeXuat([...theoDon.values()]);
  const skus = deXuat.map((d) => d.sku);

  const [bienTheRows, quyetDinhRows, dongBo] = await Promise.all([
    skus.length ? db.execute<{ sku: string; vid: string; pid: string; pt: string; vt: string | null; g: string | null }>(sql`
      SELECT sku, shopify_variant_id AS vid, shopify_product_id AS pid, product_title AS pt, variant_title AS vt, weight_grams::text AS g
        FROM shopify_variants WHERE store_id = ${st.id} AND sku = ANY(${skus})`) : { rows: [] },
    skus.length ? db.execute<{ sku: string; can_moi_g: string; quyet_dinh: string; ket_qua: string | null; loi: string | null }>(sql`
      SELECT DISTINCT ON (sku, can_moi_g) sku, can_moi_g::text, quyet_dinh, ket_qua, loi
        FROM can_san_pham_quyet_dinh WHERE store_id = ${st.id} AND sku = ANY(${skus})
       ORDER BY sku, can_moi_g, quyet_at DESC`) : { rows: [] },
    db.execute<{ luc: string | null }>(sql`SELECT MAX(synced_at)::text AS luc FROM shopify_variants WHERE store_id = ${st.id}`),
  ]);

  const dong: DongDeXuat[] = [];
  for (const d of deXuat) {
    const qd = quyetDinhRows.rows.find((q) => q.sku === d.sku && Number(q.can_moi_g) === d.canDeXuatG);
    if (qd?.quyet_dinh === 'bo_qua') continue;
    const bienThe = bienTheRows.rows.filter((b) => b.sku === d.sku).map((b) => ({
      variantId: b.vid, productId: b.pid, productTitle: b.pt, variantTitle: b.vt, canG: b.g == null ? null : Number(b.g),
    }));
    const cacCan = new Set(bienThe.map((b) => b.canG));
    dong.push({ ...d, bienThe, canLech: cacCan.size > 1, lanDayLoi: qd?.ket_qua === 'loi' ? qd.loi : null });
  }

  return {
    duyetDuoc: nd.admin,
    coQuyenGhi: productWeightsManifest.requiredScopes.every((s) => st.scopes.includes(s)),
    dong,
    dongBoLuc: dongBo.rows[0]?.luc ?? null,
  };
}

const MUTATION = `mutation SuaCan($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id }
    userErrors { field message }
  }
}`;

export interface KetQuaDay { sku: string; ok: boolean; loi?: string }

/** Duyệt và đẩy cân mới cho các SKU đã chọn. Mỗi SKU một kết quả — một SKU lỗi không chặn SKU khác. */
export async function duyetVaDayCan(chon: Array<{ sku: string; canMoiG: number }>): Promise<KetQuaDay[]> {
  const nd = await nguoiDung();
  if (!nd.admin) throw new Error('Chỉ quản lý mới duyệt đẩy cân lên Shopify');
  const st = await storeVanHanh();
  // Đọc lại đề xuất ở server, KHÔNG tin cân gửi lên — chỉ đẩy đúng mức hệ thống đang đề xuất.
  const trang = await docDeXuatCan();
  const ra: KetQuaDay[] = [];

  for (const c of chon) {
    const d = trang.dong.find((x) => x.sku === c.sku && x.canDeXuatG === c.canMoiG);
    if (!d) { ra.push({ sku: c.sku, ok: false, loi: 'Đề xuất đã đổi hoặc không còn — tải lại trang' }); continue; }
    if (d.bienThe.length === 0) { ra.push({ sku: c.sku, ok: false, loi: 'Không tìm thấy biến thể trên Shopify cho SKU này' }); continue; }

    const runId = randomUUID();
    const canCu = d.bienThe.map((b) => ({ variantId: b.variantId, sku: d.sku, canG: b.canG }));
    const ghiNhan = async (ketQua: 'ok' | 'loi', loi: string | null) => {
      await db.insert(schema.canSanPhamQuyetDinh).values({
        storeId: st.id, sku: d.sku, canCuG: d.canHienTaiG == null ? null : String(d.canHienTaiG),
        canMoiG: String(d.canDeXuatG), quyetDinh: 'day', ketQua, loi,
        variantIds: d.bienThe.map((b) => b.variantId), quyetBy: nd.id,
      });
      await recordAudit({
        userId: nd.id, storeId: st.id, featureKey: productWeightsManifest.key, action: 'product-weights.push',
        target: d.sku, requestSummary: `${d.canHienTaiG ?? '?'}g → ${d.canDeXuatG}g (${d.bienThe.length} biến thể)`,
        result: ketQua === 'ok' ? 'success' : 'error', errorDetail: loi,
      });
    };

    try {
      // Ảnh chụp cân CŨ trước khi đổi — chốt thứ tư của cổng ghi, và là đường quay lại nếu cần.
      const payload = { runId, canCu, canMoiG: d.canDeXuatG };
      await db.insert(schema.settingsSnapshots).values({
        storeId: st.id, domain: productWeightsManifest.key, payload, payloadHash: hashPayload(payload), capturedBy: nd.id,
      });

      const theoSanPham = new Map<string, string[]>();
      for (const b of d.bienThe) theoSanPham.set(b.productId, [...(theoSanPham.get(b.productId) ?? []), b.variantId]);

      for (const [productId, variantIds] of theoSanPham) {
        const data = await runMutation({
          store: { id: st.id, shopDomain: st.shopDomain, apiVersion: st.apiVersion, status: st.status, maintenanceMode: st.maintenanceMode, scopes: st.scopes },
          featureKey: productWeightsManifest.key,
          requiredScopes: productWeightsManifest.requiredScopes,
          applyRunId: runId, domain: productWeightsManifest.key,
          mutation: MUTATION,
          variables: {
            productId,
            variants: variantIds.map((id) => ({
              id, inventoryItem: { measurement: { weight: { value: d.canDeXuatG / 1000, unit: 'KILOGRAMS' } } },
            })),
          },
          deps: {
            isEnabled: (fk, sid) => isFeatureEnabled(fk, sid),
            isReconciled: async () => true,
            hasSnapshot: async (sid, dom, rid) => {
              const { rows: s } = await db.execute(sql`
                SELECT 1 FROM settings_snapshots WHERE store_id = ${sid} AND domain = ${dom} AND payload->>'runId' = ${rid} LIMIT 1`);
              return s.length > 0;
            },
            manifestHasWriteOps: () => productWeightsManifest.hasWriteOperations,
            graphql: ({ shopDomain, apiVersion, token, mutation, variables }) =>
              graphqlCall({ shopDomain, apiVersion, token, query: mutation, variables }),
            decryptToken: getStoreToken,
          },
        });
        const loiShopify = (data as { productVariantsBulkUpdate?: { userErrors?: Array<{ message: string }> } })
          ?.productVariantsBulkUpdate?.userErrors ?? [];
        if (loiShopify.length) throw new Error(loiShopify.map((e) => e.message).join('; '));
      }

      // Cập nhật bản sao cục bộ ngay, để SKU rời danh sách mà không phải chờ lượt đồng bộ.
      await db.update(schema.shopifyVariants).set({ weightGrams: String(d.canDeXuatG), syncedAt: new Date() })
        .where(and(eq(schema.shopifyVariants.storeId, st.id), eq(schema.shopifyVariants.sku, d.sku)));
      await ghiNhan('ok', null);
      ra.push({ sku: d.sku, ok: true });
    } catch (e) {
      const loi = String((e as Error).message ?? e).slice(0, 500);
      await ghiNhan('loi', loi);
      ra.push({ sku: d.sku, ok: false, loi });
    }
  }
  revalidatePath('/f/can-san-pham');
  return ra;
}

export async function boQuaDeXuat(sku: string, canMoiG: number): Promise<{ ok: true }> {
  const nd = await nguoiDung();
  if (!nd.admin) throw new Error('Chỉ quản lý mới bỏ qua đề xuất');
  const st = await storeVanHanh();
  await db.insert(schema.canSanPhamQuyetDinh).values({
    storeId: st.id, sku, canMoiG: String(canMoiG), quyetDinh: 'bo_qua', quyetBy: nd.id,
  });
  revalidatePath('/f/can-san-pham');
  return { ok: true };
}
