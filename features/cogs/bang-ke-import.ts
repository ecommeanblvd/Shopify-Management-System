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
import { duocGhiDe } from './uu-tien-nguon';

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
    // Sheet không public: Google redirect về trang đăng nhập/thông báo lỗi
    // (200 OK, content-type text/html) thay vì trả file xlsx — XLSX.read sẽ
    // đọc nhầm HTML đó và nổ lỗi khó hiểu ở bước sau. Chặn sớm bằng content-type.
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('spreadsheet') && !contentType.includes('officedocument') && contentType.includes('text/html')) {
      throw new Error('Google không trả file xlsx — sheet phải ở chế độ "ai có link đều xem được"');
    }
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
  // So sau khi bỏ gạch nối/khoảng trắng/hoa thường: sheet "Calista de Minh Thanh" ↔ display "Calista-de-minh-thanh" / slug "calista-de-minh-thanh".
  const chuan = (x: string) => x.toLowerCase().replace(/[^a-z0-9\u00C0-\u1EF9]/g, '');
  const t = chuan(tenTrenSheet);
  return t === chuan(b.slug) || t === chuan(b.ten ?? '') ? null : `Sheet ghi Brand: ${tenTrenSheet}, đang nhập cho ${b.ten ?? b.slug}`;
}

interface KyDaGhep { bk: BangKe; ghep: KetQuaGhep; ghepReturn: KetQuaGhep }

/** tra-đơn + ghép line cho mọi kỳ của một `BangKe[]` đã đọc (xlsx hoặc payload MMP). */
async function ghepTatCa(bangKe: BangKe[]): Promise<KyDaGhep[]> {
  const maDons = [...new Set(bangKe.flatMap((b) => [...b.lines, ...b.returns].map((d) => chuanHoaMaDon(d.maDon))))];
  const don = await traDon(maDons);
  return bangKe.map((bk) => ({ bk, ghep: ghepBangKe(bk.lines, don), ghepReturn: ghepBangKe(bk.returns, don) }));
}

/** Tải + đọc workbook xlsx, kiểm brand khớp tiêu đề sheet. KHÔNG ghép — dùng chung cho xem trước và áp dụng. */
async function docVaKiemBrand(input: { brandSlug: string; url?: string; buffer?: Uint8Array }): Promise<{ brand: string; boQua: string[]; bangKe: BangKe[]; loi?: string }> {
  const sheets = await taiWorkbook(input);
  const { bangKe, boQua } = docWorkbook(sheets);
  if (bangKe.length === 0) return { brand: '', boQua, bangKe: [], loi: 'Không có tab bảng kê thực nhận nào' };
  const loi = await kiemBrand(input.brandSlug, bangKe[0].brand);
  if (loi) return { brand: bangKe[0].brand, boQua, bangKe: [], loi };
  return { brand: bangKe[0].brand, boQua, bangKe };
}

export interface XemTruocKy {
  period: string; sheet: string; tongDong: number; khopSku: number; khopMaGoc: number; donMotLine: number; offline: number;
  khongKhop: Array<{ maDon: string; sku: string; tt: number; lyDo: string }>; returns: number; tongTT: number; tongReturn: number;
  lechCongThuc: number; du: Array<{ maDon: string; sku: string; slSheet: number; quantity: number }>; canhBao: string[];
  currency: 'VND' | 'USD'; tiGia: number | null;
}
export interface XemTruoc { brand: string; boQua: string[]; ky: XemTruocKy[]; loi?: string }

export async function xemTruocBangKe(input: { brandSlug: string; url?: string; buffer?: Uint8Array }): Promise<XemTruoc> {
  const r = await docVaKiemBrand(input);
  if (r.loi) return { brand: r.brand, boQua: r.boQua, ky: [], loi: r.loi };
  const ky = await ghepTatCa(r.bangKe);
  return {
    brand: r.brand, boQua: r.boQua,
    ky: ky.map(({ bk, ghep, ghepReturn }) => ({
      period: bk.period, sheet: bk.sheet, tongDong: bk.lines.length + bk.returns.length,
      khopSku: ghep.theoLine.filter((t) => t.cachKhop === 'sku').reduce((s, t) => s + t.dong.length, 0),
      khopMaGoc: ghep.theoLine.filter((t) => t.cachKhop === 'ma_goc').reduce((s, t) => s + t.dong.length, 0),
      donMotLine: ghep.theoLine.filter((t) => t.cachKhop === 'don_mot_line').reduce((s, t) => s + t.dong.length, 0),
      offline: ghep.offline.length + ghepReturn.offline.length,
      khongKhop: [...ghep.khongKhop, ...ghepReturn.khongKhop].map((k) => ({ maDon: k.dong.maDon, sku: k.dong.sku, tt: k.dong.tt, lyDo: k.lyDo })),
      returns: bk.returns.length, tongTT: bk.lines.reduce((s, d) => s + d.tt, 0), tongReturn: bk.returns.reduce((s, d) => s + d.tt, 0),
      lechCongThuc: [...bk.lines, ...bk.returns].filter((d) => !kiemCongThuc(d)).length,
      du: ghep.theoLine.filter((t) => t.du).map((t) => ({ maDon: t.dong[0].maDon, sku: t.line.sku ?? '', slSheet: t.slSheet, quantity: t.line.quantity })),
      canhBao: bk.canhBao, currency: bk.currency ?? 'VND', tiGia: bk.tiGia ?? null,
    })),
  };
}

export interface ApDungKhongKhop { period: string; maDon: string; sku: string; tt: number; lyDo: string }

/**
 * Ghép + ghi một `BangKe[]` ĐÃ ĐỌC (xlsx qua `docWorkbook`, hoặc payload MMP qua `docPayloadMmp`) vào
 * `order_line_cogs`/`brand_cogs_offline`, theo đúng luật ghép (spec §4) và transaction-mỗi-kỳ (spec §6).
 * Dùng chung cho `apDungBangKe` (xlsx, `source: 'brand_statement'`) và webhook MMP (`source: 'mmp'`) —
 * tách riêng để hai nguồn không đụng dữ liệu của nhau (xem ghi chú xoá theo `source` bên dưới).
 */
export async function apDungBangKeDaDoc(input: {
  brandSlug: string; bangKe: BangKe[]; periods: string[]; userId: string | null; tenFile: string;
  source: 'brand_statement' | 'mmp'; currency?: string;
}): Promise<{
  daGhi: Array<{ period: string; lines: number; offline: number; returns: number }>;
  khongKhop: ApDungKhongKhop[];
  loi?: string;
}> {
  const ky = await ghepTatCa(input.bangKe);
  const daGhi: Array<{ period: string; lines: number; offline: number; returns: number }> = [];
  const khongKhop: ApDungKhongKhop[] = [];
  // Thứ tự ưu tiên nguồn (uu-tien-nguon.ts, spec §7 refined): `mmp` kế nhiệm
  // `brand_statement` — dòng `mmp` luôn được ghi đè lên dòng đang có bất kỳ
  // nguồn nào (kể cả `brand_statement`), nên KHÔNG cần setWhere. Ngược lại,
  // dòng `brand_statement` không được ghi đè dòng đang là `mmp` (chỉ
  // `duocGhiDe('mmp', 'brand_statement')` = false) — setWhere chặn đúng
  // trường hợp đó, để sheet import lại một kỳ cũ không xoá mất số đã lên MMP.
  const setWhereUuTien = duocGhiDe('mmp', input.source) ? undefined : sql`${schema.orderLineCogs.source} <> 'mmp'`;
  // Nhiều kỳ ghi TUẦN TỰ, mỗi kỳ một transaction riêng — nếu một kỳ sau lỗi
  // (DB tạm ngắt, deadlock, v.v.) các kỳ TRƯỚC đã commit không được coi là mất
  // trắng: trả về `daGhi` (những kỳ đã ghi) kèm `loi` thay vì throw, để người
  // dùng biết chính xác đã ghi tới đâu thay vì tưởng nhầm cả lô đều thất bại.
  for (const { bk, ghep, ghepReturn } of ky) {
    if (!input.periods.includes(bk.period)) continue;
    khongKhop.push(...[...ghep.khongKhop, ...ghepReturn.khongKhop].map((k) => ({ period: bk.period, maDon: k.dong.maDon, sku: k.dong.sku, tt: k.dong.tt, lyDo: k.lyDo })));
    const ref = `${input.brandSlug} ${bk.period}`;
    // Sheet USD đã đổi sang VND khi đọc (bk.currency='VND', bk.tiGia); chỉ còn USD khi thiếu dòng TỔNG ₫.
    const currency = bk.currency ?? input.currency ?? 'VND';
    try {
      await db.transaction(async (tx) => {
        // Xoá đúng NGUỒN đang ghi (order_line_cogs.source, brand_cogs_offline.source — migration 0129)
        // — MMP đẩy lại kỳ này không được xoá dòng nhập từ bảng kê xlsx và ngược lại.
        await tx.delete(schema.orderLineCogs).where(and(eq(schema.orderLineCogs.source, input.source), eq(schema.orderLineCogs.brandSlug, input.brandSlug), eq(schema.orderLineCogs.period, bk.period)));
        await tx.delete(schema.brandCogsOffline).where(and(eq(schema.brandCogsOffline.source, input.source), eq(schema.brandCogsOffline.brandSlug, input.brandSlug), eq(schema.brandCogsOffline.period, bk.period)));
        const ghiLine = async (g: KetQuaGhep, kind: 'cogs' | 'return') => {
          for (const t of g.theoLine) {
            const amount = String(kind === 'return' ? -t.amount : t.amount);
            const detail = { dong: t.dong, cachKhop: t.cachKhop, slSheet: t.slSheet, du: t.du, lechCongThuc: t.dong.filter((d) => !kiemCongThuc(d)).length, tenFile: input.tenFile };
            if (input.source === 'mmp') {
              // MMP là nguồn KẾ NHIỆM sheet: trước khi ghi dòng MMP của line này, xoá
              // dòng `brand_statement` CŨ của ĐÚNG line (order_id, shopify_line_id,
              // kind) ở BẤT KỲ kỳ nào — MMP có thể ghi nhận line vào kỳ khác kỳ sheet
              // đã ghi trước đó (ví dụ sheet ghi theo tháng đặt, MMP ghi theo tháng
              // thực nhận từ brand); index duy nhất chỉ bắt trùng CÙNG kỳ nên không tự
              // dọn được trường hợp khác kỳ này — không xoá thì line tồn tại 2 dòng
              // COGS ở 2 kỳ khác nhau, báo cáo cộng trùng giá vốn.
              await tx.delete(schema.orderLineCogs).where(and(
                eq(schema.orderLineCogs.orderId, t.line.orderId),
                eq(schema.orderLineCogs.shopifyLineId, t.line.shopifyLineId),
                eq(schema.orderLineCogs.kind, kind),
                eq(schema.orderLineCogs.source, 'brand_statement'),
              ));
            }
            await tx.insert(schema.orderLineCogs).values({
              orderId: t.line.orderId, shopifyLineId: t.line.shopifyLineId, storeId: t.line.storeId, kind, period: bk.period,
              amount, currency, source: input.source, brandSlug: input.brandSlug, statementRef: ref,
              detail, importedBy: input.userId,
            }).onConflictDoUpdate({
              // Trùng (order_id, shopify_line_id, kind, period) — CHƯA có `source` trong
              // index này (spec §7 refined: một line/kind/kỳ chỉ có MỘT dòng, nguồn nào
              // thắng theo `uu-tien-nguon.ts` thì đứng). `setWhereUuTien` chặn đúng
              // trường hợp `brand_statement` cố đè dòng đang là `mmp`.
              target: [schema.orderLineCogs.orderId, schema.orderLineCogs.shopifyLineId, schema.orderLineCogs.kind, schema.orderLineCogs.period],
              set: { amount, currency, source: input.source, brandSlug: input.brandSlug, statementRef: ref, detail, importedBy: input.userId, importedAt: sql`now()` },
              setWhere: setWhereUuTien,
            });
          }
          for (const o of g.offline) {
            await tx.insert(schema.brandCogsOffline).values({ brandSlug: input.brandSlug, period: bk.period, kind, refCode: o.maDon, sku: o.sku, qty: Math.round(o.sl), amount: String(kind === 'return' ? -o.tt : o.tt), currency, source: input.source, statementRef: ref });
          }
        };
        await ghiLine(ghep, 'cogs'); await ghiLine(ghepReturn, 'return');
      });
    } catch (e) {
      const loi = e instanceof Error ? e.message : 'Lỗi không rõ';
      return { daGhi, khongKhop, loi: `Kỳ ${bk.period}: ${loi}` };
    }
    daGhi.push({ period: bk.period, lines: ghep.theoLine.length, offline: ghep.offline.length + ghepReturn.offline.length, returns: ghepReturn.theoLine.length });
    try { await recordAudit({ userId: input.userId, action: 'cogs_import', target: ref, requestSummary: `${input.tenFile}: ${ghep.theoLine.length} line, ${ghep.offline.length} offline, ${ghep.khongKhop.length} không khớp`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  }
  return { daGhi, khongKhop };
}

export async function apDungBangKe(input: { brandSlug: string; url?: string; buffer?: Uint8Array; periods: string[]; userId: string; tenFile: string }): Promise<{
  daGhi: Array<{ period: string; lines: number; offline: number; returns: number }>;
  loi?: string;
}> {
  const r = await docVaKiemBrand(input);
  if (r.loi) throw new Error(r.loi);
  const res = await apDungBangKeDaDoc({ brandSlug: input.brandSlug, bangKe: r.bangKe, periods: input.periods, userId: input.userId, tenFile: input.tenFile, source: 'brand_statement' });
  return { daGhi: res.daGhi, loi: res.loi };
}
