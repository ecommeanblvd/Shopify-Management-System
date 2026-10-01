/**
 * OUTBOX cho sự kiện cấp BẢNG KÊ gửi MMP (CEO 01/10/2026).
 *
 * Trước vòng này, `pushStatementEvent` POST thẳng sang MMP và KHÔNG ghi gì: gửi một chứng từ về
 * tiền cho đối tác mà nếu lượt POST hỏng thì dấu vết duy nhất là một dòng thông báo trên màn
 * hình, rồi mất. Bảng kê vẫn thành `issued` dù MMP không nhận.
 *
 * GHI TRƯỚC, GỬI SAU (write-ahead). Ghi sau khi gửi thì đúng những lượt mình cần nhất — lượt
 * ném lỗi, lượt tiến trình chết giữa đường — là những lượt không có dòng nào để thử lại.
 */
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { pushStatementEvent } from './statement-push';

/** Thử tối đa bao nhiêu lần rồi bỏ cuộc. Cùng mức với outbox cấp đơn. */
export const LAN_THU_TOI_DA = 8;

export type LoaiSuKienKe = 'statement.issued' | 'statement.paid';

/**
 * THUẦN: dòng này còn đáng thử lại không.
 *
 * `delivered` thì KHÔNG — gửi lại một bản đã nhận là làm MMP ghi đè sổ bằng chính nó, vô ích và
 * che mất việc dòng đó đã xong. Hết lượt thử thì cũng không: cron đập mãi vào một lỗi cố định
 * (sai secret, brand lạ) chỉ làm log đầy và che những dòng còn cứu được.
 */
export function conThuLai(trangThai: string, lanThu: number): boolean {
  if (trangThai === 'delivered') return false;
  return lanThu < LAN_THU_TOI_DA;
}

interface HangKe {
  id: string; statementId: string; brandSlug: string; event: string;
  occurredAt: Date; payload: unknown; attempts: number;
}

/** Gửi một dòng outbox rồi ghi kết quả. Không ném ra ngoài trừ lỗi lập trình. */
export async function guiHangKe(r: HangKe): Promise<{ ok: boolean; detail: string }> {
  const kq = await pushStatementEvent(
    r.event as LoaiSuKienKe, r.brandSlug, r.payload as Record<string, unknown>,
    // Mốc của DÒNG, không phải lúc gửi — xem `pushStatementEvent`.
    r.occurredAt.toISOString(),
  );
  await db.update(schema.shipHoStatementEvents).set({
    deliveryStatus: kq.ok ? 'delivered' : 'failed',
    attempts: r.attempts + 1,
    lastAttemptAt: new Date(),
    // Thành công thì XOÁ lỗi cũ: để nguyên là dòng xanh mà mang thông điệp lỗi, người đọc sau
    // không biết tin cái nào.
    lastError: kq.ok ? null : kq.detail,
    lastHttpStatus: kq.status ?? null,
  }).where(eq(schema.shipHoStatementEvents.id, r.id));
  return { ok: kq.ok, detail: kq.detail };
}

/**
 * Ghi (hoặc cập nhật) dòng outbox cho một bảng kê rồi thử gửi ngay.
 *
 * UPSERT theo (statement_id, event): gửi lại là thêm một LẦN THỬ trên đúng dòng cũ, giữ nguyên
 * `occurred_at` của lần đầu — MMP thấy đúng một ảnh chụp của một bảng kê. Payload thì cập nhật
 * theo bản mới nhất: nếu nội dung đã đổi thì cái MMP cần là bản hiện tại, không phải bản cũ.
 */
export async function banSuKienBangKe(
  statementId: string, brandSlug: string, event: LoaiSuKienKe, data: Record<string, unknown>,
): Promise<{ ok: boolean; detail: string }> {
  let row: HangKe | undefined;
  try {
    [row] = await db.insert(schema.shipHoStatementEvents)
      .values({ statementId, brandSlug, event, payload: data, deliveryStatus: 'pending', attempts: 0 })
      .onConflictDoUpdate({
        target: [schema.shipHoStatementEvents.statementId, schema.shipHoStatementEvents.event],
        set: { payload: data, deliveryStatus: 'pending', brandSlug },
      })
      .returning({
        id: schema.shipHoStatementEvents.id, statementId: schema.shipHoStatementEvents.statementId,
        brandSlug: schema.shipHoStatementEvents.brandSlug, event: schema.shipHoStatementEvents.event,
        occurredAt: schema.shipHoStatementEvents.occurredAt, payload: schema.shipHoStatementEvents.payload,
        attempts: schema.shipHoStatementEvents.attempts,
      });
  } catch (e) {
    console.error('[statement-outbox] ghi sổ thất bại — KHÔNG gửi', event, statementId, e);
    // Không gửi khi chưa ghi được sổ: gửi mà không có dòng nào là quay lại đúng cảnh cũ.
    return { ok: false, detail: 'không ghi được sổ gửi, chưa gửi MMP' };
  }
  if (!row) return { ok: false, detail: 'không ghi được sổ gửi, chưa gửi MMP' };
  return guiHangKe(row);
}

export interface KetQuaThuLaiKe { thu: number; xong: number; hong: number; hetLuot: number }

/**
 * Thử lại các dòng chưa gửi được. Gọi trong cron `retry-ship-ho-events`.
 *
 * Quét cả `pending` lẫn `failed`: `pending` là dòng vừa ghi mà lượt gửi ngay chưa chạy xong
 * (hoặc tiến trình chết), `failed` là dòng đã nhận lỗi. Bỏ `delivered`.
 */
export async function thuLaiSuKienBangKe(): Promise<KetQuaThuLaiKe> {
  const rows = await db.select({
    id: schema.shipHoStatementEvents.id, statementId: schema.shipHoStatementEvents.statementId,
    brandSlug: schema.shipHoStatementEvents.brandSlug, event: schema.shipHoStatementEvents.event,
    occurredAt: schema.shipHoStatementEvents.occurredAt, payload: schema.shipHoStatementEvents.payload,
    attempts: schema.shipHoStatementEvents.attempts,
    deliveryStatus: schema.shipHoStatementEvents.deliveryStatus,
  }).from(schema.shipHoStatementEvents)
    .where(and(
      inArray(schema.shipHoStatementEvents.deliveryStatus, ['pending', 'failed']),
      lte(schema.shipHoStatementEvents.attempts, LAN_THU_TOI_DA - 1),
    ))
    .orderBy(schema.shipHoStatementEvents.occurredAt)
    .limit(100);

  const ra: KetQuaThuLaiKe = { thu: 0, xong: 0, hong: 0, hetLuot: 0 };
  for (const r of rows) {
    if (!conThuLai(r.deliveryStatus, r.attempts)) { ra.hetLuot++; continue; }
    ra.thu++;
    const kq = await guiHangKe(r);
    if (kq.ok) ra.xong++;
    else ra.hong++;
  }
  // Đếm riêng số dòng ĐÃ HẾT LƯỢT trong sổ — chúng không bao giờ tự đi nữa, phải có người xem.
  const [het] = await db.select({ n: sql<number>`count(*)::int` })
    .from(schema.shipHoStatementEvents)
    .where(and(
      inArray(schema.shipHoStatementEvents.deliveryStatus, ['pending', 'failed']),
      sql`${schema.shipHoStatementEvents.attempts} >= ${LAN_THU_TOI_DA}`,
    ));
  ra.hetLuot += het?.n ?? 0;
  return ra;
}
