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

/** Store để chọn khi ước giá vốn dự tính (id + tên). */
export async function layStores(): Promise<Array<{ id: string; name: string }>> {
  await requireCogs('manage_cogs');
  const { db, schema } = await import('@/db/client');
  const rows = await db.select({ id: schema.stores.id, name: schema.stores.name }).from(schema.stores);
  return rows.map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Ước giá vốn DỰ TÍNH cho SKU chưa có bảng giá (lịch sử bảng kê → MMP VND × CK) và ghi vào sku_costs (nguồn "uoc:%"). */
export async function uocGiaVonDuTinhAction(storeId: string, dryRun: boolean): Promise<{
  skuXet: number; daCoGia: number; uocLichSuSku: number; uocLichSuMaSp: number; uocMmp: number; khong: number;
  khongTheoVendor: Array<{ vendor: string; n: number }>; daGhi: number; dryRun: boolean;
}> {
  const userId = await requireCogs('manage_cogs');
  if (!storeId) throw new Error('Chọn store');
  const { uocGiaVonDuTinhCore } = await import('./gia-du-tinh-core');
  const r = await uocGiaVonDuTinhCore(storeId, { dryRun, userId });
  if (!dryRun) { revalidatePath('/f/orders'); revalidatePath('/f/orders/lai-gop'); revalidatePath('/f/orders/cogs/bang-ke'); }
  const theoVendor = new Map<string, number>(); for (const k of r.khong) theoVendor.set(k.vendor ?? '(trống)', (theoVendor.get(k.vendor ?? '(trống)') ?? 0) + 1);
  return {
    skuXet: r.skuXet, daCoGia: r.daCoGia, uocLichSuSku: r.uocLichSu.filter((u) => u.nguon === 'lich_su_sku').length, uocLichSuMaSp: r.uocLichSu.filter((u) => u.nguon === 'lich_su_ma_sp').length,
    uocMmp: r.uoc.length, khong: r.khong.length, khongTheoVendor: [...theoVendor.entries()].map(([vendor, n]) => ({ vendor, n })).sort((a, b) => b.n - a.n), daGhi: r.daGhi, dryRun,
  };
}

/** Phân bổ PO (hàng MEAN mua đứt, kê #MBLVDPO/#MTB) xuống dòng đơn không có trên bảng kê —
 *  FIFO theo kỳ PO ≤ tháng đặt (CEO 08/09). `dryRun` chỉ tính, không ghi. */
export async function phanBoPOAction(brandSlug: string, dryRun: boolean): Promise<{
  dongXet: number; daPhanBo: number; tongVnd: number;
  theoPO: Array<{ refCode: string; qty: number; vnd: number }>;
  khong: Array<{ maDon: string; sku: string | null; thangDat: string; lyDo: string }>;
  dryRun: boolean;
}> {
  const userId = await requireCogs('manage_cogs');
  if (!brandSlug) throw new Error('Chọn brand');
  const { phanBoPOCore } = await import('./phan-bo-po-core');
  const r = await phanBoPOCore(brandSlug, { dryRun, userId });
  if (!dryRun) { revalidatePath('/f/orders/lai-gop'); revalidatePath('/f/orders/cogs/bang-ke'); }
  return {
    dongXet: r.dongXet, daPhanBo: r.daPhanBo, tongVnd: r.tongVnd, theoPO: r.theoPO,
    khong: r.khong.map((k) => ({ maDon: k.maDon, sku: k.sku, thangDat: k.thangDat, lyDo: k.lyDo })), dryRun,
  };
}
