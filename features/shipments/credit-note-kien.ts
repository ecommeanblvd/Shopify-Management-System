'use server';

/**
 * Nối CHỨNG TỪ ĐIỀU CHỈNH với KIỆN, cho cột "Kiện liên quan" (CEO 30/09/2026).
 *
 * Cột đó trước nay đếm `credit_note_lines` — bảng RỖNG HOÀN TOÀN nên nó hiện "—" cho mọi dòng và
 * sẽ hiện "—" mãi mãi. Mã vận đơn chỉ nằm trong ô văn bản tự do `noi_dung`.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { maVanDonTrongChungTu, noiChungTuVoiKien, type KienNoiDuoc, type NoiChungTu } from './credit-note-tracking';

export interface KienCuaChungTu extends NoiChungTu { creditNoteId: string }

/** Nối một lô chứng từ với kiện. Đọc kiện MỘT LẦN cho cả lô, không hỏi từng tờ. */
export async function kienCuaChungTu(
  chungTu: ReadonlyArray<{ id: string; noiDung: string | null; maThamChieu: unknown }>,
): Promise<KienCuaChungTu[]> {
  const moiMa = [...new Set(chungTu.flatMap((c) => maVanDonTrongChungTu(c.noiDung)))];
  const theoMa = new Map<string, KienNoiDuoc>();
  if (moiMa.length > 0) {
    // Tìm ở CẢ HAI luồng: kiện của store và đơn ship hộ đều có thể được hãng trả lại tiền.
    const { rows } = await db.execute<{ tk: string; don: string | null; nguon: string }>(sql`
      SELECT s.tracking_number AS tk, o.shopify_order_number AS don, 'shopify'::text AS nguon
        FROM shipments s LEFT JOIN shopify_orders o ON o.id = s.order_id
       WHERE s.tracking_number IN ${moiMa}
      UNION ALL
      SELECT h.tracking_number, h.code, 'ship_ho'::text
        FROM ship_ho_orders h WHERE h.tracking_number IN ${moiMa};`);
    for (const r of rows) {
      if (!theoMa.has(r.tk)) {
        theoMa.set(r.tk, { tracking: r.tk, maDon: r.don, nguon: r.nguon === 'ship_ho' ? 'ship_ho' : 'shopify' });
      }
    }
  }
  return chungTu.map((c) => ({
    creditNoteId: c.id,
    ...noiChungTuVoiKien(c.noiDung, Array.isArray(c.maThamChieu) ? (c.maThamChieu as string[]) : [], (ma) => theoMa.get(ma) ?? null),
  }));
}
