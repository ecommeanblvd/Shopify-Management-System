'use server';

import { and, asc, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { putObject, getSignedDownloadUrl } from '@/lib/storage/s3';
import { dongBoAnhLenLark } from './anh-lark';
import type { AnhNhan, LoaiAnhNhan } from './types';

const HOP_LE: LoaiAnhNhan[] = ['hang_den', 'bb_ban_giao'];

/**
 * Tải MỘT ảnh/biên bản cho phiếu nhận.
 *
 * Không dùng `uploadReceiptImage` sẵn có: hàm đó chỉ trả key rồi để caller tự
 * lưu, nên ảnh tải xong mà trang tắt giữa chừng là file nằm lại S3 không ai
 * biết. Ở đây tải và ghi dòng trong CÙNG một lượt gọi.
 */
export async function themAnhNhan(formData: FormData): Promise<{ ok: boolean; loi?: string }> {
  const userId = await requirePerm('manage_qc');
  const receiptId = String(formData.get('receiptId') ?? '');
  const loai = String(formData.get('loai') ?? '') as LoaiAnhNhan;
  const file = formData.get('file');

  if (!receiptId) return { ok: false, loi: 'Thiếu phiếu nhận.' };
  if (!HOP_LE.includes(loai)) return { ok: false, loi: `Loại ảnh "${loai}" không hợp lệ.` };
  if (!(file instanceof File) || file.size === 0) return { ok: false, loi: 'Chưa chọn file.' };

  try {
    // Phiếu phải CÓ THẬT trước khi tốn băng thông tải file lên S3.
    const [p] = await db.select({ id: schema.goodsReceipts.id })
      .from(schema.goodsReceipts).where(eq(schema.goodsReceipts.id, receiptId)).limit(1);
    if (!p) return { ok: false, loi: 'Không tìm thấy phiếu nhận.' };

    const ten = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `receipts/${receiptId}/${loai}/${Date.now()}-${ten}`;
    await putObject(key, new Uint8Array(await file.arrayBuffer()), file.type || 'application/octet-stream');
    await db.insert(schema.whAnhNhan).values({
      receiptId, loai, s3Key: key, tenFile: file.name, nguoiTai: userId,
    });
    // Lô đã gửi Lark rồi thì đẩy luôn; chưa gửi thì hàm này thoát ngay, và lúc
    // bấm "Bắt đầu QC" sẽ gắn một thể.
    await dongBoAnhLenLark(receiptId);
    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true };
  } catch (e) {
    console.error('[kho-nhan] themAnhNhan lỗi:', e);
    return { ok: false, loi: 'Tải lên thất bại, thử lại.' };
  }
}

/** Gỡ MỘT ảnh. File trên S3 để nguyên — xoá dòng là đủ để nó biến khỏi phiếu,
 *  còn file thì giữ làm dấu vết, tốn vài KB. */
export async function xoaAnhNhan(id: string): Promise<{ ok: boolean; loi?: string }> {
  await requirePerm('manage_qc');
  try {
    // Nhớ phiếu TRƯỚC khi xoá — xoá rồi thì không còn đường lần ra lô nào.
    const [a] = await db.select({ receiptId: schema.whAnhNhan.receiptId })
      .from(schema.whAnhNhan).where(eq(schema.whAnhNhan.id, id)).limit(1);
    await db.delete(schema.whAnhNhan).where(eq(schema.whAnhNhan.id, id));
    if (a) await dongBoAnhLenLark(a.receiptId);
    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true };
  } catch (e) {
    console.error('[kho-nhan] xoaAnhNhan lỗi:', e);
    return { ok: false, loi: 'Gỡ ảnh thất bại.' };
  }
}

/** Ảnh của nhiều phiếu, kèm link xem tạm thời. */
export async function anhCuaPhieu(receiptIds: string[]): Promise<AnhNhan[]> {
  await requirePerm('view_receiving');
  if (receiptIds.length === 0) return [];
  const ds = await db.select({
    id: schema.whAnhNhan.id,
    receiptId: schema.whAnhNhan.receiptId,
    loai: schema.whAnhNhan.loai,
    s3Key: schema.whAnhNhan.s3Key,
    tenFile: schema.whAnhNhan.tenFile,
  })
    .from(schema.whAnhNhan)
    .where(inArray(schema.whAnhNhan.receiptId, receiptIds))
    .orderBy(asc(schema.whAnhNhan.createdAt));

  return Promise.all(ds.map(async (a) => ({
    ...a,
    loai: a.loai as LoaiAnhNhan,
    // Link ký hạn ngắn — bucket không mở công khai.
    url: await getSignedDownloadUrl(a.s3Key).catch(() => null),
  })));
}

/** Phiếu nào ĐÃ có đủ cả hai loại — dùng để nhắc kho chỗ nào còn thiếu. */
export async function phieuDuAnh(receiptIds: string[]): Promise<Record<string, boolean>> {
  await requirePerm('view_receiving');
  const out: Record<string, boolean> = {};
  if (receiptIds.length === 0) return out;
  const ds = await db.selectDistinct({
    receiptId: schema.whAnhNhan.receiptId, loai: schema.whAnhNhan.loai,
  }).from(schema.whAnhNhan).where(and(inArray(schema.whAnhNhan.receiptId, receiptIds)));
  const gom = new Map<string, Set<string>>();
  for (const d of ds) {
    const s = gom.get(d.receiptId) ?? new Set<string>();
    s.add(d.loai); gom.set(d.receiptId, s);
  }
  for (const id of receiptIds) {
    const s = gom.get(id);
    out[id] = !!s && HOP_LE.every((l) => s.has(l));
  }
  return out;
}
