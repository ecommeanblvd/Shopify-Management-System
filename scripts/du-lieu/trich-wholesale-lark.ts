/**
 * Trích sheet Lark wiki "Tổng hợp đơn WholeSale" ra JSON — nguồn duy nhất cho hai file đối soát
 * WholeSale (TINH và Mirer).
 *
 * Bố cục sheet: dòng nhãn brand ("MIRER", "TINH ATELIER") chen giữa các khối dòng, tiêu đề ở
 * dòng 2. Bản đọc đầu bắt đầu từ `raw[2:]` nên ĂN MẤT dòng nhãn "MIRER" và bỏ cả khối Mirer.
 * Ở đây brand hiện tại được giữ theo dòng nhãn gần nhất, và cột "Brand" của từng dòng dùng để
 * ĐỐI CHỨNG — lệch là dừng.
 *
 * NGÀY REQUEST có hai kiểu lẫn nhau trong cùng cột:
 *   · 14 ô là CHỮ "dd/mm/yyyy" (thành phần đầu chạy 16–30 nên chắc chắn là ngày).
 *   · 6 ô là SỐ SERIAL, và serial bị ĐẢO ngày↔tháng. Đảo không phải lỗi quy đổi — sai gốc
 *     serial thì ngày DỊCH chứ không đảo; serial đã sinh ra từ một chuỗi ngày đọc sai khuôn
 *     ngay ở sheet nguồn (gõ "06/03/2026" vào ô locale m/d → 3 tháng 6 → serial 46176).
 *     Bảng ship hộ Lark làm chứng độc lập cho 4/6 ô và CẢ 4 ĐỀU ĐẢO — xem `NHAN_CHUNG`.
 *
 *   railway run --service Shopify-Management-System npx tsx scripts/du-lieu/trich-wholesale-lark.ts
 */
import { writeFileSync } from 'node:fs';

const DOMAIN = process.env.LARK_DOMAIN || 'https://open.larksuite.com';
const NODE = 'QUzLwtUfXiSVK1k1mHXli4C6gPc';
const SHEET = 'WihWN3';
const RA = 'scripts/du-lieu/wholesale-lark.json';
const MA_DON = /^\d{2}-INSLG-SV-\d{4}$/;

/** Dòng nhãn brand → slug hệ thống. */
const NHAN_BRAND: Record<string, string> = { MIRER: 'mirer', 'TINH ATELIER': 'tinh' };
/** Cột "Brand" của từng dòng → slug, để đối chứng với dòng nhãn. */
const COT_BRAND: Record<string, string> = { Mirer: 'mirer', 'TINH Atelier': 'tinh' };

/** Ô serial có nhân chứng độc lập từ bảng ship hộ Lark — canh luật đảo ngày↔tháng. */
const NHAN_CHUNG: Record<string, string> = {
  '26-INSLG-SV-0463': '2026-03-06',
  '26-INSLG-SV-0467': '2026-03-05',
  '26-INSLG-SV-0443': '2026-04-07',
  '26-INSLG-SV-0442': '2026-02-09',
};

/** Gốc serial của Lark Sheets trùng Excel: 1899-12-30. */
const GOC = Date.UTC(1899, 11, 30);
const tuSerial = (n: number) => new Date(GOC + Math.round(n) * 86_400_000).toISOString().slice(0, 10);
/** Đảo ngày↔tháng; null khi đảo ra tháng >12 (serial đó vốn đã đúng). */
function daoNgayThang(iso: string): string | null {
  const [y, m, d] = iso.split('-');
  return Number(d) >= 1 && Number(d) <= 12 ? `${y}-${d}-${m}` : null;
}

function env(t: string): string { const v = process.env[t]; if (!v) throw new Error(`thiếu biến ${t}`); return v; }

async function token(): Promise<string> {
  const r = await fetch(`${DOMAIN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env('LARK_APP_ID'), app_secret: env('LARK_APP_SECRET') }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await r.json()) as { code: number; msg: string; tenant_access_token?: string };
  if (j.code !== 0 || !j.tenant_access_token) throw new Error(`token fail ${j.code} ${j.msg}`);
  return j.tenant_access_token;
}

async function goi(tk: string, duong: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${DOMAIN}${duong}`, {
    headers: { Authorization: `Bearer ${tk}` }, signal: AbortSignal.timeout(60_000),
  });
  const j = (await r.json()) as { code: number; msg: string; data?: Record<string, unknown> };
  if (j.code !== 0) throw new Error(`${duong} → code=${j.code} msg=${j.msg}`);
  return j.data ?? {};
}

/** Ô Lark có thể là chuỗi, số, hoặc mảng {text} — rút về chuỗi phẳng. */
function phang(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => phang(x && typeof x === 'object' && 'text' in (x as object) ? (x as { text: unknown }).text : x)).join('');
  if (typeof v === 'object') return phang((v as { text?: unknown }).text);
  return String(v);
}

/** Số tiền: ô trống / "None" → 0. */
function so(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = phang(v).replace(/[^\d.,-]/g, '').replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const chu = (v: unknown) => { const s = phang(v).trim(); return s === 'None' ? '' : s; };

export interface DonWholeSale {
  ma: string; ngay: string; nguonNgay: string; suyLuanNgay?: true;
  lineShip: string; tracking: string; ref: string; trangThaiXk: string; loaiHinh: string;
  phapNhan: string; aiTra: string; nhan: string; nuoc: string; kl: number; kien: string;
  toKhai: number; uyQuyen: number; stationary: number; cuoc: number; pctFuel: number;
  fuel: number; vatKhac: number; daTra: number; canThu: number; ghiChu: string;
}

/* Chỉ số cột (0-based) trên sheet — đọc từ dòng tiêu đề ngày 19/10/2026. */
const C = {
  ma: 0, ngay: 1, brand: 2, lineShip: 4, tracking: 5, ref: 6, trangThaiXk: 7, loaiHinh: 8,
  phapNhan: 9, aiTra: 10, nhan: 11, nuoc: 14, kl: 15, kien: 16,
  toKhai: 17, uyQuyen: 18, stationary: 19, cuoc: 20, pctFuel: 21, fuel: 22, vatKhac: 23,
  daTra: 24, canThu: 25, ghiChu: 26,
} as const;

function ngayCuaDong(ma: string, o: unknown): { ngay: string; nguon: string; suyLuan?: true } | string {
  if (typeof o === 'number' && o > 40_000 && o < 60_000) {
    const thang = tuSerial(o);
    const dao = daoNgayThang(thang);
    if (dao == null) return { ngay: thang, nguon: `serial ${o} (đảo ra tháng >12 nên giữ nguyên)` };
    const chung = NHAN_CHUNG[ma];
    if (chung && chung !== dao) return `đảo ra ${dao} nhưng bảng ship hộ nói ${chung}`;
    return chung
      ? { ngay: dao, nguon: `serial ${o} đảo ngày↔tháng, khớp bảng ship hộ` }
      : { ngay: dao, nguon: `serial ${o} đảo ngày↔tháng, KHÔNG có nhân chứng`, suyLuan: true };
  }
  const s = chu(o);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    return { ngay: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, nguon: `chữ "${s}" (dd/mm/yyyy)` };
  }
  return `ô ngày không đọc được: ${JSON.stringify(o)}`;
}

async function main(): Promise<void> {
  const tk = await token();
  const node = (await goi(tk, `/open-apis/wiki/v2/spaces/get_node?token=${NODE}`)).node as { obj_token: string; title: string };
  const d = await goi(tk, `/open-apis/sheets/v2/spreadsheets/${node.obj_token}/values/${SHEET}!A1:AD80?valueRenderOption=UnformattedValue`);
  const hang = (d.valueRange as { values: unknown[][] }).values ?? [];
  console.log(`wiki "${node.title}" · sheet ${SHEET} · ${hang.length} dòng thô`);

  const ra: Record<string, DonWholeSale[]> = {};
  const loi: string[] = [];
  let brand: string | null = null;

  for (const [i, r] of hang.entries()) {
    const o1 = chu(r[C.ma]);
    const nhan = NHAN_BRAND[o1.toUpperCase()];
    if (nhan) { brand = nhan; continue; }
    if (!MA_DON.test(o1)) continue;
    if (brand == null) { loi.push(`dòng ${i + 1} (${o1}): chưa gặp dòng nhãn brand nào`); continue; }

    /* Cột "Brand" của dòng phải khớp dòng nhãn — nếu ai chèn/xoá dòng nhãn thì cả khối sẽ bị
     * gán sai brand, tức gán sai công nợ. Thà dừng. */
    const theoCot = COT_BRAND[chu(r[C.brand])];
    if (theoCot && theoCot !== brand) {
      loi.push(`dòng ${i + 1} (${o1}): nhãn khối nói "${brand}" nhưng cột Brand nói "${chu(r[C.brand])}"`);
      continue;
    }

    const ng = ngayCuaDong(o1, r[C.ngay]);
    if (typeof ng === 'string') { loi.push(`dòng ${i + 1} (${o1}): ${ng}`); continue; }

    (ra[brand] ??= []).push({
      ma: o1, ngay: ng.ngay, nguonNgay: ng.nguon, ...(ng.suyLuan ? { suyLuanNgay: true as const } : {}),
      lineShip: chu(r[C.lineShip]), tracking: chu(r[C.tracking]), ref: chu(r[C.ref]),
      trangThaiXk: chu(r[C.trangThaiXk]), loaiHinh: chu(r[C.loaiHinh]), phapNhan: chu(r[C.phapNhan]),
      aiTra: chu(r[C.aiTra]), nhan: chu(r[C.nhan]), nuoc: chu(r[C.nuoc]),
      kl: so(r[C.kl]), kien: chu(r[C.kien]),
      toKhai: so(r[C.toKhai]), uyQuyen: so(r[C.uyQuyen]), stationary: so(r[C.stationary]),
      cuoc: so(r[C.cuoc]), pctFuel: so(r[C.pctFuel]), fuel: so(r[C.fuel]), vatKhac: so(r[C.vatKhac]),
      daTra: so(r[C.daTra]), canThu: so(r[C.canThu]), ghiChu: chu(r[C.ghiChu]),
    });
  }

  if (loi.length > 0) {
    console.error(`\n✗ DỪNG — ${loi.length} chỗ không đọc được, không ghi file:\n  ${loi.join('\n  ')}`);
    process.exit(1);
  }

  for (const ds of Object.values(ra)) ds.sort((a, b) => (a.ngay + a.ma).localeCompare(b.ngay + b.ma));
  writeFileSync(RA, `${JSON.stringify({ chot: new Date().toISOString().slice(0, 10), brand: ra }, null, 1)}\n`);

  console.log(`${RA}:`);
  for (const [b, ds] of Object.entries(ra)) {
    const tong = ds.reduce((a, x) => a + x.canThu, 0);
    console.log(`  ${b.padEnd(6)} ${String(ds.length).padStart(2)} đơn · tổng cần thu ${Math.round(tong).toLocaleString('vi-VN')} đ`);
    for (const x of ds) console.log(`     ${x.ma}  ${x.ngay}  ${x.suyLuanNgay ? '⚠ SUY LUẬN ' : ''}${String(Math.round(x.canThu)).padStart(9)}  ${x.nuoc}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
