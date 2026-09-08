/**
 * Bộ nhập bảng kê brand (server): tải Google Sheet/file → đọc (Task 3) → ghép line (Task 4) →
 * xem trước hoặc áp dụng theo kỳ vào order_line_cogs / brand_cogs_offline (spec §5-6).
 */
import * as XLSX from 'xlsx';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { recordAudit } from '@/lib/logging/audit';
import { docWorkbook, kiemCongThuc, type BangKe, type O } from './doc-bang-ke';
import { ghepBangKe, chuanHoaMaDon, type DonTraCuu, type KetQuaGhep } from './ghep-line';

export function sheetIdTuUrl(url: string): string | null { return /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(url)?.[1] ?? null; }
export function urlXuatXlsx(sheetId: string): string { return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`; }

/** Tải workbook (link Google hoặc file) → mảng ô mọi sheet KHÔNG ẩn. */
export async function taiWorkbook(input: { url?: string; buffer?: Uint8Array }): Promise<Array<{ name: string; rows: O[][] }>> {
  let buf = input.buffer;
  if (!buf) {
    const id = input.url ? sheetIdTuUrl(input.url) : null;
    if (!id) throw new Error('Link không phải Google Sheet');
    const res = await fetch(urlXuatXlsx(id), { signal: AbortSignal.timeout(60_000), redirect: 'follow' });
    if (!res.ok) throw new Error(`Google trả ${res.status} — sheet phải ở chế độ "ai có link đều xem được"`);
    buf = new Uint8Array(await res.arrayBuffer());
  }
  const wb = XLSX.read(buf, { type: 'array' });
  const an = new Set((wb.Workbook?.Sheets ?? []).filter((s) => s.Hidden && s.Hidden > 0).map((s) => s.name));
  return wb.SheetNames.filter((n) => !an.has(n)).map((name) => ({
    name, rows: XLSX.utils.sheet_to_json<O[]>(wb.Sheets[name], { header: 1, raw: false, defval: null }),
  }));
}

async function traDon(maDons: string[]): Promise<Map<string, DonTraCuu>> {
  if (maDons.length === 0) return new Map();
  const rows = await db.select({
    orderId: schema.shopifyOrders.id, storeId: schema.shopifyOrders.storeId, so: schema.shopifyOrders.shopifyOrderNumber,
    shopifyLineId: schema.shopifyOrderLines.shopifyLineId, sku: schema.shopifyOrderLines.sku, quantity: schema.shopifyOrderLines.quantity, variantTitle: schema.shopifyOrderLines.variantTitle,
  }).from(schema.shopifyOrders)
    .innerJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.orderId, schema.shopifyOrders.id))
    .where(inArray(sql`upper(replace(${schema.shopifyOrders.shopifyOrderNumber}, '#', ''))`, maDons));
  const m = new Map<string, DonTraCuu>();
  for (const r of rows) {
    const k = chuanHoaMaDon(r.so);
    const d = m.get(k) ?? { orderId: r.orderId, storeId: r.storeId, maDon: k, lines: [] };
    d.lines.push({ orderId: r.orderId, storeId: r.storeId, shopifyLineId: r.shopifyLineId, sku: r.sku, quantity: r.quantity, variantTitle: r.variantTitle });
    m.set(k, d);
  }
  return m;
}

async function kiemBrand(brandSlug: string, tenTrenSheet: string): Promise<string | null> {
  const [b] = await db.select({ slug: schema.mmpBrands.slug, ten: schema.mmpBrands.displayName }).from(schema.mmpBrands).where(eq(schema.mmpBrands.slug, brandSlug)).limit(1);
  if (!b) return `Không có brand "${brandSlug}" trong hệ thống`;
  const t = tenTrenSheet.toLowerCase();
  return t === b.slug.toLowerCase() || t === (b.ten ?? '').toLowerCase() ? null : `Sheet ghi Brand: ${tenTrenSheet}, đang nhập cho ${b.ten ?? b.slug}`;
}

interface KyDaGhep { bk: BangKe; ghep: KetQuaGhep; ghepReturn: KetQuaGhep }
async function docVaGhep(input: { brandSlug: string; url?: string; buffer?: Uint8Array }): Promise<{ brand: string; boQua: string[]; ky: KyDaGhep[]; loi?: string }> {
  const sheets = await taiWorkbook(input);
  const { bangKe, boQua } = docWorkbook(sheets);
  if (bangKe.length === 0) return { brand: '', boQua, ky: [], loi: 'Không có tab bảng kê thực nhận nào' };
  const loi = await kiemBrand(input.brandSlug, bangKe[0].brand);
  if (loi) return { brand: bangKe[0].brand, boQua, ky: [], loi };
  const maDons = [...new Set(bangKe.flatMap((b) => [...b.lines, ...b.returns].map((d) => chuanHoaMaDon(d.maDon))))];
  const don = await traDon(maDons);
  return { brand: bangKe[0].brand, boQua, ky: bangKe.map((bk) => ({ bk, ghep: ghepBangKe(bk.lines, don), ghepReturn: ghepBangKe(bk.returns, don) })) };
}

export interface XemTruocKy {
  period: string; sheet: string; tongDong: number; khopSku: number; khopMaGoc: number; donMotLine: number; offline: number;
  khongKhop: Array<{ maDon: string; sku: string; tt: number; lyDo: string }>; returns: number; tongTT: number; tongReturn: number;
  lechCongThuc: number; du: Array<{ maDon: string; sku: string; slSheet: number; quantity: number }>; canhBao: string[];
}
export interface XemTruoc { brand: string; boQua: string[]; ky: XemTruocKy[]; loi?: string }

export async function xemTruocBangKe(input: { brandSlug: string; url?: string; buffer?: Uint8Array }): Promise<XemTruoc> {
  const r = await docVaGhep(input);
  return {
    brand: r.brand, boQua: r.boQua, loi: r.loi,
    ky: r.ky.map(({ bk, ghep, ghepReturn }) => ({
      period: bk.period, sheet: bk.sheet, tongDong: bk.lines.length,
      khopSku: ghep.theoLine.filter((t) => t.cachKhop === 'sku').reduce((s, t) => s + t.dong.length, 0),
      khopMaGoc: ghep.theoLine.filter((t) => t.cachKhop === 'ma_goc').reduce((s, t) => s + t.dong.length, 0),
      donMotLine: ghep.theoLine.filter((t) => t.cachKhop === 'don_mot_line').reduce((s, t) => s + t.dong.length, 0),
      offline: ghep.offline.length + ghepReturn.offline.length,
      khongKhop: [...ghep.khongKhop, ...ghepReturn.khongKhop].map((k) => ({ maDon: k.dong.maDon, sku: k.dong.sku, tt: k.dong.tt, lyDo: k.lyDo })),
      returns: bk.returns.length, tongTT: bk.lines.reduce((s, d) => s + d.tt, 0), tongReturn: bk.returns.reduce((s, d) => s + d.tt, 0),
      lechCongThuc: [...bk.lines, ...bk.returns].filter((d) => !kiemCongThuc(d)).length,
      du: ghep.theoLine.filter((t) => t.du).map((t) => ({ maDon: t.dong[0].maDon, sku: t.line.sku ?? '', slSheet: t.slSheet, quantity: t.line.quantity })),
      canhBao: bk.canhBao,
    })),
  };
}

export async function apDungBangKe(input: { brandSlug: string; url?: string; buffer?: Uint8Array; periods: string[]; userId: string; tenFile: string }) {
  const r = await docVaGhep(input);
  if (r.loi) throw new Error(r.loi);
  const daGhi: Array<{ period: string; lines: number; offline: number; returns: number }> = [];
  for (const { bk, ghep, ghepReturn } of r.ky) {
    if (!input.periods.includes(bk.period)) continue;
    const ref = `${input.brandSlug} ${bk.period}`;
    await db.transaction(async (tx) => {
      await tx.delete(schema.orderLineCogs).where(and(eq(schema.orderLineCogs.source, 'brand_statement'), eq(schema.orderLineCogs.brandSlug, input.brandSlug), eq(schema.orderLineCogs.period, bk.period)));
      await tx.delete(schema.brandCogsOffline).where(and(eq(schema.brandCogsOffline.brandSlug, input.brandSlug), eq(schema.brandCogsOffline.period, bk.period)));
      const ghiLine = async (g: KetQuaGhep, kind: 'cogs' | 'return') => {
        for (const t of g.theoLine) {
          await tx.insert(schema.orderLineCogs).values({
            orderId: t.line.orderId, shopifyLineId: t.line.shopifyLineId, storeId: t.line.storeId, kind, period: bk.period,
            amount: String(kind === 'return' ? -t.amount : t.amount), currency: 'VND', source: 'brand_statement', brandSlug: input.brandSlug, statementRef: ref,
            detail: { dong: t.dong, cachKhop: t.cachKhop, slSheet: t.slSheet, du: t.du, lechCongThuc: t.dong.filter((d) => !kiemCongThuc(d)).length, tenFile: input.tenFile },
            importedBy: input.userId,
          });
        }
        for (const o of g.offline) {
          await tx.insert(schema.brandCogsOffline).values({ brandSlug: input.brandSlug, period: bk.period, kind, refCode: o.maDon, sku: o.sku, qty: Math.round(o.sl), amount: String(kind === 'return' ? -o.tt : o.tt), currency: 'VND', statementRef: ref });
        }
      };
      await ghiLine(ghep, 'cogs'); await ghiLine(ghepReturn, 'return');
    });
    daGhi.push({ period: bk.period, lines: ghep.theoLine.length, offline: ghep.offline.length + ghepReturn.offline.length, returns: ghepReturn.theoLine.length });
    try { await recordAudit({ userId: input.userId, action: 'cogs_import', target: ref, requestSummary: `${input.tenFile}: ${ghep.theoLine.length} line, ${ghep.offline.length} offline, ${ghep.khongKhop.length} không khớp`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  }
  return { daGhi };
}
