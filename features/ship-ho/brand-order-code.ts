import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

/** THUẦN: format mã đơn brand (tạm dùng dãy số; backfill format chính thức sau). */
export function formatBrandOrderCode(seq: number): string {
  return `SH${seq}`;
}

/** I/O: lấy số tiếp theo từ sequence Postgres → { code, seq }. */
export async function nextBrandOrderCode(): Promise<{ code: string; seq: number }> {
  const res = await db.execute(sql`SELECT nextval('ship_ho_mmp_order_seq') AS seq`);
  const row = (res.rows ?? (res as unknown as Array<{ seq: unknown }>))[0] as
    | { seq: unknown }
    | undefined;
  const seq = Number(row?.seq);
  return { code: formatBrandOrderCode(seq), seq };
}
