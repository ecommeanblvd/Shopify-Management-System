'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { uploadReceiptImage } from '@/features/receiving/actions';
import { kiemViec } from './luat';
import { dayMotDong } from './day-lark';

/**
 * Kho lưu việc nhận + kiểm MỘT món. Ghi vào SMS trước rồi mới đẩy Lark: Lark hỏng thì việc
 * vẫn còn, cron đẩy lại sau (spec §5).
 */
export async function ghiNhanKcs(formData: FormData): Promise<{ ok: boolean; loi?: string; larkRecordId?: string; dry?: boolean; tao?: boolean }> {
  const userId = await requirePerm('manage_qc');

  const monDinhDanh = String(formData.get('monDinhDanh') ?? '');
  // Một món một dòng: nhập lại là SỬA dòng cũ, không đẻ dòng hai (khớp cách Lark làm).
  const [cu] = await db.select({ id: schema.whNhanKcs.id, anhKey: schema.whNhanKcs.anhKey })
    .from(schema.whNhanKcs).where(eq(schema.whNhanKcs.monDinhDanh, monDinhDanh)).limit(1);

  const anh = formData.get('anh');
  // Sửa lại một món đã ghi hỏng (vd gõ nhầm cân) thì GIỮ ảnh cũ — bắt chụp lại là hành người.
  let anhKey: string | null = cu?.anhKey ?? null;
  if (anh instanceof File && anh.size > 0) {
    const fd = new FormData();
    fd.set('file', anh);
    fd.set('scope', monDinhDanh || 'kho');
    anhKey = await uploadReceiptImage(fd);
  }

  const soRaw = formData.get('canKg');
  const v = kiemViec({
    monDinhDanh,
    monRecordId: String(formData.get('monRecordId') ?? '') || null,
    orderNumber: String(formData.get('orderNumber') ?? ''),
    sku: String(formData.get('sku') ?? '') || null,
    soLuong: Number(formData.get('soLuong') ?? 0),
    canKg: soRaw != null && String(soRaw).trim() !== '' ? Number(soRaw) : null,
    qcCheck: String(formData.get('qcCheck') ?? '') as never,
    whAction: String(formData.get('whAction') ?? '') as never,
    lyDoFail: String(formData.get('lyDoFail') ?? '') || null,
    warehouse: String(formData.get('warehouse') ?? '') as never,
    coAnh: !!anhKey,
  });
  if (!v.ok) return { ok: false, loi: v.loi };

  const giaTri = {
    monDinhDanh: v.viec.monDinhDanh, monRecordId: v.viec.monRecordId, orderNumber: v.viec.orderNumber,
    sku: v.viec.sku, soLuong: v.viec.soLuong, canKg: v.viec.canKg != null ? String(v.viec.canKg) : null,
    qcCheck: v.viec.qcCheck, whAction: v.viec.whAction, lyDoFail: v.viec.lyDoFail,
    anhKey, warehouse: v.viec.warehouse, nguoiLam: userId, luc: new Date(),
    trangThaiDay: 'cho' as const, loi: null,
  };
  const id = cu
    ? (await db.update(schema.whNhanKcs).set(giaTri).where(eq(schema.whNhanKcs.id, cu.id)).returning({ id: schema.whNhanKcs.id }))[0].id
    : (await db.insert(schema.whNhanKcs).values(giaTri).returning({ id: schema.whNhanKcs.id }))[0].id;

  const day = await dayMotDong(id);
  revalidatePath('/f/warehouse/nhan-kcs');
  if (!day.ok) return { ok: true, loi: `Đã lưu ở SMS nhưng chưa ghi được lên Lark: ${day.loi}` };
  const [sau] = await db.select({ larkRecordId: schema.whNhanKcs.larkRecordId })
    .from(schema.whNhanKcs).where(eq(schema.whNhanKcs.id, id)).limit(1);
  // tao/dry lấy từ chính lượt đẩy: dòng SMS đã có hay chưa KHÔNG nói lên dòng trên Lark có
  // sẵn hay không (kho đã có 8.858 dòng có kết quả mà SMS chưa từng thấy).
  return { ok: true, larkRecordId: sau?.larkRecordId ?? undefined, dry: day.dry, tao: day.tao };
}

/** Bấm thử lại một dòng đang lỗi. */
export async function dayLaiDongLoi(id: string): Promise<{ ok: boolean; loi?: string }> {
  await requirePerm('manage_qc');
  const r = await dayMotDong(id);
  revalidatePath('/f/warehouse/nhan-kcs');
  return r;
}
