'use server';

import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { updateWhInventoryRecord, uploadWhInventoryMedia } from '@/features/lark/client';
import { getObject } from '@/lib/storage/s3';
import type { LoaiAnhNhan } from './types';

/** Cột đính kèm trên Lark ứng với từng loại file lúc nhận. */
const COT_THEO_LOAI: Record<LoaiAnhNhan, string> = {
  hang_den: 'Ảnh Thực Tế SP',
  bb_ban_giao: 'BB Giao Nhận',
};

function kieuTheoTen(ten: string): string {
  const d = ten.toLowerCase().split('.').pop() ?? '';
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', heic: 'image/heic', pdf: 'application/pdf' } as Record<string, string>)[d]
    ?? 'application/octet-stream';
}

/**
 * Đẩy ảnh hàng đến + biên bản của MỘT phiếu sang các dòng Lark của phiếu đó.
 *
 * Ảnh lưu ở mức PHIẾU nhưng cột Lark nằm ở mức DÒNG, nên cùng một file gắn cho
 * mọi dòng của lô — đúng cách đội kho đang làm (đo 25/09: 102/135 lô dùng chung
 * đúng một file cho mọi dòng). File chỉ TẢI LÊN MỘT LẦN rồi nhớ `file_token`,
 * các dòng sau dùng lại; tải lại từng dòng là đẻ ra hàng loạt bản y hệt nhau
 * trong Drive của đội.
 *
 * Best-effort: Lark hỏng KHÔNG được làm hỏng việc đã ghi xong bên mình.
 */
export async function dongBoAnhLenLark(receiptId: string): Promise<void> {
  try {
    const dong = await db.select().from(schema.goodsReceiptItems)
      .where(and(eq(schema.goodsReceiptItems.receiptId, receiptId),
                 isNotNull(schema.goodsReceiptItems.larkRecordId)));
    if (dong.length === 0) return;   // chưa dòng nào lên Lark thì chưa có gì để gắn

    const anh = await db.select().from(schema.whAnhNhan)
      .where(eq(schema.whAnhNhan.receiptId, receiptId));

    // 1) Bảo đảm mọi file đã có token. Tải hỏng một file thì bỏ qua file đó,
    //    các file còn lại vẫn lên — mất một ảnh còn hơn mất cả lô.
    for (const a of anh.filter((x) => !x.larkFileToken)) {
      try {
        const bytes = await getObject(a.s3Key);
        const ten = a.tenFile ?? a.s3Key.split('/').pop() ?? 'file';
        const token = await uploadWhInventoryMedia(ten, bytes, kieuTheoTen(ten));
        await db.update(schema.whAnhNhan).set({ larkFileToken: token })
          .where(eq(schema.whAnhNhan.id, a.id));
        a.larkFileToken = token;
      } catch (e) {
        console.error(`[kho-nhan] tải ảnh ${a.id} lên Lark lỗi:`, e);
      }
    }

    // 2) Gắn vào từng dòng. Ghi CẢ HAI cột mỗi lượt, kể cả cột rỗng — gỡ hết ảnh
    //    bên mình thì cột bên Lark cũng phải trống theo, nếu không hai bên lệch.
    const fields: Record<string, unknown> = {};
    for (const loai of Object.keys(COT_THEO_LOAI) as LoaiAnhNhan[]) {
      fields[COT_THEO_LOAI[loai]] = anh
        .filter((a) => a.loai === loai && a.larkFileToken)
        .map((a) => ({ file_token: a.larkFileToken! }));
    }

    for (const d of dong) {
      try {
        await updateWhInventoryRecord(d.larkRecordId!, fields);
      } catch (e) {
        console.error(`[kho-nhan] gắn ảnh vào ${d.larkRecordId} lỗi:`, e);
      }
    }
  } catch (e) {
    console.error('[kho-nhan] dongBoAnhLenLark lỗi:', e);
  }
}

/** Phiếu của các chiếc vừa gửi — để đồng bộ ảnh ngay sau khi tạo dòng Lark. */
export async function phieuCuaChiec(itemIds: string[]): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const r = await db.selectDistinct({ receiptId: schema.goodsReceiptItems.receiptId })
    .from(schema.goodsReceiptItems).where(inArray(schema.goodsReceiptItems.id, itemIds));
  return r.map((x) => x.receiptId);
}
