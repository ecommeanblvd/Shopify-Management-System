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
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { dayMotSku, storeVanHanh, tinhDeXuat, type KetQuaDay, type TrangDeXuat } from './core';

export type { BienThe, DongDeXuat, KetQuaDay, TrangDeXuat } from './core';

async function nguoiDung(): Promise<{ id: string; admin: boolean }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  const role = await getRole(session.user.id);
  if (role !== 'admin' && !(role && hasPermission(role, 'view_kpi_logistics'))) {
    throw new Error('Không có quyền xem đề xuất cân sản phẩm');
  }
  return { id: session.user.id, admin: role === 'admin' };
}

export async function docDeXuatCan(): Promise<TrangDeXuat> {
  const nd = await nguoiDung();
  return { ...(await tinhDeXuat(await storeVanHanh())), duyetDuoc: nd.admin };
}

/** Duyệt và đẩy cân mới cho các SKU đã chọn. Mỗi SKU một kết quả — một SKU lỗi không chặn SKU khác. */
export async function duyetVaDayCan(chon: Array<{ sku: string; canMoiG: number }>): Promise<KetQuaDay[]> {
  const nd = await nguoiDung();
  if (!nd.admin) throw new Error('Chỉ quản lý mới duyệt đẩy cân lên Shopify');
  const st = await storeVanHanh();
  // Đọc lại đề xuất ở server, KHÔNG tin cân gửi lên — chỉ đẩy đúng mức hệ thống đang đề xuất.
  const trang = await tinhDeXuat(st);
  const ra: KetQuaDay[] = [];

  for (const c of chon) {
    const d = trang.dong.find((x) => x.sku === c.sku && x.canDeXuatG === c.canMoiG);
    if (!d) { ra.push({ sku: c.sku, ok: false, loi: 'Đề xuất đã đổi hoặc không còn — tải lại trang' }); continue; }
    ra.push(await dayMotSku(st, d, nd.id));
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

