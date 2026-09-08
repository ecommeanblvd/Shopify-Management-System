'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { fetchVcbUsd } from '@/lib/fx/vcb';
import { thangKinhDoanh } from '@/lib/timezone';
import { requireCogs } from './perm';
import { xemTruocBangKe, apDungBangKe, type XemTruoc } from './bang-ke-import';
import { docTien } from './tien';

async function nguon(fd: FormData): Promise<{ url?: string; buffer?: Uint8Array; tenFile: string }> {
  const f = fd.get('file');
  if (f instanceof File && f.size > 0) return { buffer: new Uint8Array(await f.arrayBuffer()), tenFile: f.name };
  const url = String(fd.get('url') ?? '').trim();
  if (!url) throw new Error('Cần link Google Sheet hoặc file');
  return { url, tenFile: url };
}

export async function layBrands(): Promise<Array<{ slug: string; displayName: string }>> {
  await requireCogs('view_cogs');
  const rows = await db
    .select({ slug: schema.mmpBrands.slug, displayName: schema.mmpBrands.displayName })
    .from(schema.mmpBrands)
    .orderBy(schema.mmpBrands.displayName);
  return rows.map((r) => ({ slug: r.slug, displayName: r.displayName ?? r.slug }));
}

export async function xemTruocAction(fd: FormData): Promise<XemTruoc> {
  await requireCogs('manage_cogs');
  const n = await nguon(fd);
  return xemTruocBangKe({ brandSlug: String(fd.get('brandSlug')), url: n.url, buffer: n.buffer });
}

export async function apDungAction(fd: FormData): Promise<{
  daGhi: Array<{ period: string; lines: number; offline: number; returns: number }>;
  loi?: string;
}> {
  const userId = await requireCogs('manage_cogs');
  const n = await nguon(fd);
  const periods = fd.getAll('periods').map(String);
  if (periods.length === 0) throw new Error('Chọn ít nhất một kỳ');
  const r = await apDungBangKe({
    brandSlug: String(fd.get('brandSlug')), url: n.url, buffer: n.buffer, periods, userId, tenFile: n.tenFile,
  });
  revalidatePath('/f/orders/lai-gop');
  revalidatePath('/f/orders/cogs/bang-ke');
  return r;
}

export async function luuTiGiaAction(fd: FormData): Promise<void> {
  await requireCogs('manage_cogs');
  const period = String(fd.get('period'));
  // Dùng docTien: người Việt gõ 26.500 (chấm nghìn) — Number() sẽ hiểu là 26,5.
  const rate = docTien(String(fd.get('rate') ?? ''));
  if (!/^\d{4}-\d{2}$/.test(period) || rate == null || rate <= 0) throw new Error('Kỳ hoặc tỉ giá không hợp lệ');
  await db
    .insert(schema.fxMonthRates)
    .values({ fromCurrency: 'USD', toCurrency: 'VND', period, rate: String(rate), source: 'manual' })
    .onConflictDoUpdate({
      target: [schema.fxMonthRates.fromCurrency, schema.fxMonthRates.toCurrency, schema.fxMonthRates.period],
      set: { rate: String(rate), source: 'manual', updatedAt: sql`now()` },
    });
  revalidatePath('/f/orders/lai-gop');
}

export async function layTiGiaVcbAction(period: string): Promise<{ rate: number }> {
  await requireCogs('manage_cogs');
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('Kỳ không hợp lệ');
  // Tỉ giá VCB đọc trực tiếp trang VCB HÔM NAY — chỉ đúng cho tháng hiện tại.
  // Tháng đã qua phải nhập tay theo tỉ giá của đúng kỳ đó (tra lịch sử VCB),
  // không được lấy tỉ giá HÔM NAY gán ngược cho tháng cũ.
  const thangHienTai = thangKinhDoanh(new Date());
  if (period !== thangHienTai) throw new Error('Chỉ lấy tỉ giá VCB cho tháng hiện tại; tháng đã qua nhập tay theo tỉ giá kỳ đó');
  const r = await fetchVcbUsd();
  await db
    .insert(schema.fxMonthRates)
    .values({ fromCurrency: 'USD', toCurrency: 'VND', period, rate: String(r.sell), source: 'vcb' })
    .onConflictDoUpdate({
      target: [schema.fxMonthRates.fromCurrency, schema.fxMonthRates.toCurrency, schema.fxMonthRates.period],
      set: { rate: String(r.sell), source: 'vcb', updatedAt: sql`now()` },
    });
  revalidatePath('/f/orders/lai-gop');
  return { rate: r.sell };
}
