'use server';

import { randomUUID } from 'crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { putObject, getSignedDownloadUrl, isStorageConfigured } from '@/lib/storage/s3';
import { requireManageShipHo } from './require-manage';
import { validateContractFile } from './contract-status';

export interface PartnerContract {
  id: string;
  title: string;
  filename: string;
  contentType: string;
  byteSize: number;
  signedAt: string | null;
  expiresAt: string | null;
  note: string | null;
  uploadedAt: string;
  /** 'mmp_push' = MMP đẩy sang qua API; 'upload' = ops tải file lên. */
  source: string;
  contractType: string | null;
  version: string | null;
}

/** Xem hợp đồng = quyền XEM ship hộ (ops cần tra cứu); sửa/xoá mới cần manage. */
async function requireViewShipHo(): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Not authenticated.');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_ship_ho')) throw new Error('Forbidden');
}

/** Danh sách hợp đồng của 1 đối tác — mới nhất trước. */
export async function listPartnerContracts(brandSlug: string): Promise<PartnerContract[]> {
  await requireViewShipHo();
  const rows = await db.select({
    id: schema.shipHoPartnerContracts.id,
    title: schema.shipHoPartnerContracts.title,
    filename: schema.shipHoPartnerContracts.filename,
    contentType: schema.shipHoPartnerContracts.contentType,
    byteSize: schema.shipHoPartnerContracts.byteSize,
    signedAt: schema.shipHoPartnerContracts.signedAt,
    expiresAt: schema.shipHoPartnerContracts.expiresAt,
    note: schema.shipHoPartnerContracts.note,
    uploadedAt: schema.shipHoPartnerContracts.uploadedAt,
    source: schema.shipHoPartnerContracts.source,
    contractType: schema.shipHoPartnerContracts.contractType,
    version: schema.shipHoPartnerContracts.version,
  })
    .from(schema.shipHoPartnerContracts)
    .where(eq(schema.shipHoPartnerContracts.partnerBrandSlug, brandSlug))
    .orderBy(desc(schema.shipHoPartnerContracts.uploadedAt));
  return rows.map((r) => ({ ...r, uploadedAt: r.uploadedAt.toISOString() }));
}

/** Đếm hợp đồng theo brand — cho badge ở bảng đối tác (1 query, không N+1). */
export async function countContractsByPartner(): Promise<Record<string, number>> {
  await requireViewShipHo();
  const rows = await db.select({ slug: schema.shipHoPartnerContracts.partnerBrandSlug })
    .from(schema.shipHoPartnerContracts);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.slug] = (out[r.slug] ?? 0) + 1;
  return out;
}

const dateOrNull = (v: FormDataEntryValue | null): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/**
 * Upload 1 hợp đồng cho đối tác. File lên R2 (key có UUID — không lộ tên gốc,
 * không đụng file cũ), metadata vào DB. KHÔNG ghi đè bản cũ: mỗi lần upload là
 * một bản mới trong lịch sử (phụ lục / gia hạn).
 */
export async function uploadPartnerContract(form: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const userId = await requireManageShipHo();
    if (!isStorageConfigured()) return { ok: false, error: 'Chưa cấu hình lưu trữ file (R2/S3)' };

    const brandSlug = String(form.get('brandSlug') ?? '').trim();
    if (!brandSlug) return { ok: false, error: 'Thiếu đối tác' };
    const [partner] = await db.select({ slug: schema.shipHoPartners.brandSlug })
      .from(schema.shipHoPartners).where(eq(schema.shipHoPartners.brandSlug, brandSlug)).limit(1);
    if (!partner) return { ok: false, error: 'Không tìm thấy đối tác' };

    const file = form.get('file');
    if (!(file instanceof File)) return { ok: false, error: 'Chưa chọn file' };
    const invalid = validateContractFile({ name: file.name, type: file.type, size: file.size });
    if (invalid) return { ok: false, error: invalid };

    const title = String(form.get('title') ?? '').trim() || file.name;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const fileKey = `ship-ho-contracts/${brandSlug}/${randomUUID()}.${ext}`;
    await putObject(fileKey, bytes, file.type || 'application/octet-stream');

    await db.insert(schema.shipHoPartnerContracts).values({
      partnerBrandSlug: brandSlug,
      title,
      fileKey,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      byteSize: bytes.length,
      signedAt: dateOrNull(form.get('signedAt')),
      expiresAt: dateOrNull(form.get('expiresAt')),
      note: String(form.get('note') ?? '').trim() || null,
      uploadedBy: userId,
    });

    revalidatePath(`/f/ship-ho/partners/${brandSlug}/contracts`);
    revalidatePath('/f/ship-ho/partners');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Lỗi upload' };
  }
}

/** Link tải hợp đồng — signed URL 5 phút (file KHÔNG public trên R2). */
export async function getContractDownloadUrl(id: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    await requireViewShipHo();
    const [row] = await db.select({ fileKey: schema.shipHoPartnerContracts.fileKey })
      .from(schema.shipHoPartnerContracts).where(eq(schema.shipHoPartnerContracts.id, id)).limit(1);
    if (!row) return { ok: false, error: 'Không tìm thấy hợp đồng' };
    return { ok: true, url: await getSignedDownloadUrl(row.fileKey, 300) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Lỗi tạo link tải' };
  }
}

/** Xoá 1 bản hợp đồng (nhầm file/nhầm đối tác). Chỉ xoá bản ghi — object R2 giữ
 *  lại: rẻ, và tránh mất file khi lỡ tay (dọn R2 định kỳ nếu cần). */
export async function deletePartnerContract(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireManageShipHo();
    const [row] = await db.select({ slug: schema.shipHoPartnerContracts.partnerBrandSlug })
      .from(schema.shipHoPartnerContracts).where(eq(schema.shipHoPartnerContracts.id, id)).limit(1);
    if (!row) return { ok: false, error: 'Không tìm thấy hợp đồng' };
    await db.delete(schema.shipHoPartnerContracts).where(eq(schema.shipHoPartnerContracts.id, id));
    revalidatePath(`/f/ship-ho/partners/${row.slug}/contracts`);
    revalidatePath('/f/ship-ho/partners');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Lỗi xoá' };
  }
}
