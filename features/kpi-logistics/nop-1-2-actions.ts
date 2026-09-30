'use server';

/**
 * Gửi / duyệt / trả lại lý do giao chậm của một kỳ (CEO 30/09/2026). Luật ở `nop-1-2.ts`.
 *
 * Quyền: gửi = người làm đối soát (`manage_shipping_invoices`); duyệt và trả lại = CHỈ quản lý.
 * Người bị chấm không tự duyệt phần mình, cùng tinh thần với ô "thuộc về" ở tiêu chí 1.1.
 */
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { laKyHopLe } from './chot-ky';
import { nopDuoc, duyetDuocKy, traLaiDuoc, type TrangThaiNop } from './nop-1-2';

type Nguon = 'shopify' | 'ship_ho';

async function nguoiLam(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  const role = await getRole(session.user.id);
  if (role !== 'admin' && !(role && hasPermission(role, 'manage_shipping_invoices'))) {
    throw new Error('Không có quyền gửi lý do giao chậm');
  }
  return session.user.id;
}

async function quanLy(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  if ((await getRole(session.user.id)) !== 'admin') throw new Error('Chỉ quản lý được duyệt lý do giao chậm');
  return session.user.id;
}

export interface TrangThaiKy12 {
  ky: string;
  trangThai: TrangThaiNop;
  nopAt: string | null;
  duyetAt: string | null;
  ghiChu: string | null;
  /** Dòng quản lý đã trả lại mà người làm chưa sửa. */
  soDongDangTraLai: number;
}

/** Biên kỳ YYYY-MM → [đầu, cuối] để đếm dòng bị trả trong đúng kỳ đó. */
function bienKy(ky: string): [string, string] {
  const [y, m] = ky.split('-').map(Number);
  return [`${ky}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)];
}

async function demTraLai(ky: string): Promise<number> {
  const [tu, den] = bienKy(ky);
  const { rows } = await db.execute<{ n: string }>(sql`
    SELECT (
      (SELECT COUNT(*) FROM shipments
        WHERE ly_do_tra_lai IS NOT NULL
          AND label_created_at >= ${`${tu} 00:00:00`}::timestamp AND label_created_at <= ${`${den} 23:59:59`}::timestamp)
      +
      (SELECT COUNT(*) FROM ship_ho_orders
        WHERE ly_do_tra_lai IS NOT NULL
          AND shipped_at >= ${tu}::date AND shipped_at <= ${den}::date)
    )::text AS n`);
  return Number(rows[0]?.n ?? 0);
}

/** Trạng thái nộp của một kỳ; kỳ chưa có dòng nào thì coi là ĐANG LÀM. */
export async function docTrangThaiKy12(ky: string): Promise<TrangThaiKy12> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  if (!laKyHopLe(ky)) throw new Error('Kỳ phải dạng YYYY-MM');
  const [row] = await db.select().from(schema.kpi12Nop).where(sql`ky = ${ky}`);
  return {
    ky,
    trangThai: (row?.trangThai as TrangThaiNop) ?? 'dang_lam',
    nopAt: row?.nopAt?.toISOString() ?? null,
    duyetAt: row?.duyetAt?.toISOString() ?? null,
    ghiChu: row?.ghiChu ?? null,
    soDongDangTraLai: await demTraLai(ky),
  };
}

async function datTrangThai(ky: string, gia: Record<string, unknown>): Promise<void> {
  await db.insert(schema.kpi12Nop)
    .values({ ky, ...gia } as typeof schema.kpi12Nop.$inferInsert)
    .onConflictDoUpdate({ target: schema.kpi12Nop.ky, set: { ...gia, updatedAt: new Date() } });
}

/** GỬI cả kỳ cho quản lý duyệt. Gửi lại sau khi sửa dòng bị trả cũng dùng hàm này. */
export async function nopKy12(ky: string): Promise<{ ok: true }> {
  const userId = await nguoiLam();
  if (!laKyHopLe(ky)) throw new Error('Kỳ phải dạng YYYY-MM');
  const tt = await docTrangThaiKy12(ky);
  if (!nopDuoc(tt.trangThai)) throw new Error('Kỳ này đã duyệt xong, không gửi lại được');
  // Gửi lại = coi như đã sửa xong mọi dòng bị trả: xoá dấu trả lại để kỳ sạch trước mặt quản lý.
  const [tu, den] = bienKy(ky);
  await db.execute(sql`UPDATE shipments SET ly_do_tra_lai = NULL, ly_do_tra_lai_at = NULL
     WHERE ly_do_tra_lai IS NOT NULL
       AND label_created_at >= ${`${tu} 00:00:00`}::timestamp AND label_created_at <= ${`${den} 23:59:59`}::timestamp`);
  await db.execute(sql`UPDATE ship_ho_orders SET ly_do_tra_lai = NULL, ly_do_tra_lai_at = NULL
     WHERE ly_do_tra_lai IS NOT NULL AND shipped_at >= ${tu}::date AND shipped_at <= ${den}::date`);
  await datTrangThai(ky, { trangThai: 'cho_duyet', nopBoi: userId, nopAt: new Date(), duyetBoi: null, duyetAt: null });
  revalidatePath('/f/ship-report');
  return { ok: true };
}

/** DUYỆT cả kỳ — chốt lý do, khoá hết. */
export async function duyetKy12(ky: string, ghiChu?: string | null): Promise<{ ok: true }> {
  const userId = await quanLy();
  if (!laKyHopLe(ky)) throw new Error('Kỳ phải dạng YYYY-MM');
  const tt = await docTrangThaiKy12(ky);
  if (!duyetDuocKy(tt.trangThai, tt.soDongDangTraLai)) {
    throw new Error(tt.soDongDangTraLai > 0
      ? `Còn ${tt.soDongDangTraLai} dòng đang trả lại chưa sửa — duyệt lúc này là chốt luôn cái vừa nói là sai`
      : 'Kỳ này chưa được gửi đi duyệt');
  }
  await datTrangThai(ky, { trangThai: 'da_duyet', duyetBoi: userId, duyetAt: new Date(), ghiChu: ghiChu?.trim() || null });
  revalidatePath('/f/ship-report');
  return { ok: true };
}

/** MỞ LẠI kỳ đã duyệt để sửa. Chỉ quản lý. */
export async function moLaiKy12(ky: string): Promise<{ ok: true }> {
  await quanLy();
  if (!laKyHopLe(ky)) throw new Error('Kỳ phải dạng YYYY-MM');
  await datTrangThai(ky, { trangThai: 'dang_lam', duyetBoi: null, duyetAt: null, nopAt: null });
  revalidatePath('/f/ship-report');
  return { ok: true };
}

/** TRẢ LẠI một dòng để người làm sửa, kèm ghi chú nói sai ở đâu. */
export async function traLaiDong12(input: { ky: string; nguon: Nguon; id: string; ghiChu: string }): Promise<{ ok: true }> {
  await quanLy();
  if (!laKyHopLe(input.ky)) throw new Error('Kỳ phải dạng YYYY-MM');
  const ghiChu = input.ghiChu?.trim();
  // Bắt buộc ghi chú: trả lại mà không nói sai ở đâu thì người sửa chỉ đoán lại từ đầu.
  if (!ghiChu) throw new Error('Ghi rõ dòng này sai ở đâu để người làm biết sửa gì');
  const tt = await docTrangThaiKy12(input.ky);
  if (!traLaiDuoc(tt.trangThai)) throw new Error('Chỉ trả lại được khi kỳ đang chờ duyệt');
  const gia = { lyDoTraLai: ghiChu, lyDoTraLaiAt: new Date() };
  if (input.nguon === 'ship_ho') {
    await db.update(schema.shipHoOrders).set(gia).where(sql`id = ${input.id}`);
  } else {
    await db.update(schema.shipments).set(gia).where(sql`id = ${input.id}`);
  }
  revalidatePath('/f/ship-report');
  return { ok: true };
}
