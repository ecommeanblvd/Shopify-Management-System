'use server';

import { inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';

/** Ghi mốc đã in tem để biết món nào chưa dán. */
export async function danhDauDaInTem(dinhDanhs: string[]): Promise<{ da: number }> {
  await requirePerm('manage_qc');
  if (dinhDanhs.length === 0) return { da: 0 };
  const r = await db.update(schema.whNhanKcs)
    .set({ temInLuc: new Date() })
    .where(inArray(schema.whNhanKcs.monDinhDanh, dinhDanhs))
    .returning({ id: schema.whNhanKcs.id });
  return { da: r.length };
}
