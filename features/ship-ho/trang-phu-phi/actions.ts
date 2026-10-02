'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from '../require-manage';
import { sinhToken } from './link-token';

const DUONG_DAN = '/f/ship-ho/partners';

export interface LinkDangSong {
  brandSlug: string;
  token: string;
  taoLuc: Date;
}

/** Link đang sống của mọi brand. Trang quản trị đọc một lượt rồi tự ghép theo slug. */
export async function docLinkDangSong(): Promise<LinkDangSong[]> {
  return db
    .select({
      brandSlug: schema.brandSurchargeLinks.partnerBrandSlug,
      token: schema.brandSurchargeLinks.token,
      taoLuc: schema.brandSurchargeLinks.createdAt,
    })
    .from(schema.brandSurchargeLinks)
    .where(isNull(schema.brandSurchargeLinks.revokedAt));
}

export async function taoLinkPhuPhi(brandSlug: string): Promise<{ ok: boolean; token?: string; loi?: string }> {
  try {
    const userId = await requireManageShipHo();
    const token = sinhToken();
    /* Thu hồi và tạo mới trong MỘT transaction. Chỉ số unique có điều kiện ở tầng DB từ chối
     * dòng sống thứ hai, nên hai câu phải đi cùng nhau: tách ra thì có một khoảnh khắc brand
     * không còn link nào, hoặc tệ hơn, thu hồi xong mà tạo mới hỏng là brand mất link. */
    await db.transaction(async (tx) => {
      await tx.update(schema.brandSurchargeLinks)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(schema.brandSurchargeLinks.partnerBrandSlug, brandSlug),
          isNull(schema.brandSurchargeLinks.revokedAt),
        ));
      await tx.insert(schema.brandSurchargeLinks)
        .values({ partnerBrandSlug: brandSlug, token, createdBy: userId });
    });
    revalidatePath(DUONG_DAN);
    return { ok: true, token };
  } catch (e) {
    return { ok: false, loi: e instanceof Error ? e.message : 'Không tạo được link.' };
  }
}

export async function thuHoiLinkPhuPhi(brandSlug: string): Promise<{ ok: boolean; loi?: string }> {
  try {
    await requireManageShipHo();
    await db.update(schema.brandSurchargeLinks)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(schema.brandSurchargeLinks.partnerBrandSlug, brandSlug),
        isNull(schema.brandSurchargeLinks.revokedAt),
      ));
    revalidatePath(DUONG_DAN);
    return { ok: true };
  } catch (e) {
    return { ok: false, loi: e instanceof Error ? e.message : 'Không thu hồi được link.' };
  }
}
