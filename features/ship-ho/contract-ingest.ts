'use server';

import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { putObject, isStorageConfigured } from '@/lib/storage/s3';
import { parseMmpContract } from './contract-inbound';

export type IngestResult =
  | { ok: true; id: string; action: 'created' | 'updated' }
  | { ok: false; code: 'bad_input' | 'brand_not_approved' | 'storage_unconfigured' | 'error'; error: string };

/**
 * MMP đẩy hợp đồng sang (JSON + HTML) → lưu file HTML lên R2 + bản ghi trong
 * ship_ho_partner_contracts. IDEMPOTENT theo (brandSlug, version): MMP push lại
 * cùng version chỉ cập nhật nội dung/tiêu đề, KHÔNG tạo bản trùng; version mới
 * = một bản mới nằm cạnh bản cũ (giữ lịch sử — D-023).
 */
export async function ingestMmpContract(raw: unknown): Promise<IngestResult> {
  const parsed = parseMmpContract(raw);
  if (!parsed.ok) return { ok: false, code: 'bad_input', error: parsed.error };
  const c = parsed.value;

  if (!isStorageConfigured()) {
    return { ok: false, code: 'storage_unconfigured', error: 'Chưa cấu hình lưu trữ file (R2/S3)' };
  }

  // Chỉ nhận hợp đồng của brand ĐÃ là đối tác ship hộ — tránh rác từ slug lạ.
  const [partner] = await db.select({ slug: schema.shipHoPartners.brandSlug })
    .from(schema.shipHoPartners)
    .where(eq(schema.shipHoPartners.brandSlug, c.brandSlug)).limit(1);
  if (!partner) return { ok: false, code: 'brand_not_approved', error: `brand '${c.brandSlug}' chưa là đối tác ship hộ` };

  const bytes = new TextEncoder().encode(c.html);
  const fileKey = `ship-ho-contracts/${c.brandSlug}/mmp-${c.version}-${randomUUID()}.html`;
  await putObject(fileKey, bytes, 'text/html; charset=utf-8');

  const [existing] = await db.select({ id: schema.shipHoPartnerContracts.id })
    .from(schema.shipHoPartnerContracts)
    .where(and(
      eq(schema.shipHoPartnerContracts.partnerBrandSlug, c.brandSlug),
      eq(schema.shipHoPartnerContracts.version, c.version),
    )).limit(1);

  if (existing) {
    await db.update(schema.shipHoPartnerContracts).set({
      title: c.title, contractType: c.contractType, generatedAt: c.generatedAt,
      fileKey, filename: c.filename, contentType: 'text/html; charset=utf-8', byteSize: bytes.length,
      source: 'mmp_push',
    }).where(eq(schema.shipHoPartnerContracts.id, existing.id));
    return { ok: true, id: existing.id, action: 'updated' };
  }

  const [row] = await db.insert(schema.shipHoPartnerContracts).values({
    partnerBrandSlug: c.brandSlug,
    title: c.title,
    contractType: c.contractType,
    version: c.version,
    generatedAt: c.generatedAt,
    fileKey,
    filename: c.filename,
    contentType: 'text/html; charset=utf-8',
    byteSize: bytes.length,
    source: 'mmp_push',
    uploadedBy: 'mmp',
  }).returning({ id: schema.shipHoPartnerContracts.id });

  return { ok: true, id: row.id, action: 'created' };
}
