/**
 * Lấy NGÀY REQUEST đúng của các đơn WholeSale từ sheet Lark wiki "Tổng hợp đơn WholeSale".
 *
 * Vì sao cần (19/10/2026): bản đọc sheet lần đầu lấy ô ngày ở dạng chuỗi đã định dạng, và 6 ô
 * trong số đó Lark trả về SỐ SERIAL — bản đọc đó biến chúng thành chuỗi vô nghĩa kiểu
 * "2026-07-04 (serial)" (ngày/tháng bị đảo). Bốn ô nằm trong file Mirer, hai ô trong file TINH.
 * Bảng ship hộ Lark xác nhận hai trong số đó (0463 → 06/03, 0467 → 05/03), nhưng 0369/0370
 * không có dòng ship hộ nên chỉ sheet này mới trả lời được.
 *
 * Đọc `UnformattedValue` cho thấy cột này có HAI kiểu ô lẫn nhau: 14 ô là CHỮ "dd/mm/yyyy"
 * (thành phần đầu chạy 16–30 nên chắc chắn là ngày), 6 ô là SỐ SERIAL thật.
 *
 * Sáu ô serial còn bị ĐẢO NGÀY↔THÁNG, và đó không phải lỗi quy đổi: sai gốc serial thì ngày bị
 * DỊCH, không bị đảo. Serial đã được tạo từ một chuỗi ngày bị đọc sai khuôn ngay ở sheet nguồn —
 * ai đó gõ "06/03/2026" vào ô có locale m/d nên nó thành 3 tháng 6 (serial 46176). Bảng ship hộ
 * Lark làm chứng độc lập cho 4 trong 6 ô, và cả 4 đều đảo:
 *
 *   0463 serial→03/06  ship hộ 06/03 · 0467 serial→03/05  ship hộ 05/03
 *   0443 serial→04/07  ship hộ 07/04 · 0442 serial→02/09  ship hộ 09/02
 *
 * Nên ô serial được quy đổi rồi ĐẢO LẠI. Hai ô không có nhân chứng (0369, 0370 — Mirer, không
 * có dòng ship hộ) được đánh dấu `suyLuan: true`: thứ tự mã cũng ủng hộ (0369/0370 nằm giữa
 * 0325 ngày 19/12/2025 và 0411 ngày 28/01/2026, nên 07/01/2026 vào đúng chỗ còn 01/07/2026 thì
 * nhảy sau cả 0566 tháng 4) — nhưng suy luận vẫn là suy luận, phải để Đức xác nhận.
 *
 *   railway run --service Shopify-Management-System npx tsx scripts/du-lieu/lay-ngay-wholesale-lark.ts
 */
import { writeFileSync } from 'node:fs';

const DOMAIN = process.env.LARK_DOMAIN || 'https://open.larksuite.com';
const NODE = 'QUzLwtUfXiSVK1k1mHXli4C6gPc';
const SHEET = 'WihWN3';
const RA = 'scripts/du-lieu/ngay-wholesale-lark.json';
const MA_DON = /^\d{2}-INSLG-SV-\d{4}$/;
/** Ô serial có nhân chứng độc lập từ bảng ship hộ Lark — dùng để canh luật đảo. */
const NHAN_CHUNG: Record<string, string> = {
  '26-INSLG-SV-0463': '2026-03-06',
  '26-INSLG-SV-0467': '2026-03-05',
  '26-INSLG-SV-0443': '2026-04-07',
  '26-INSLG-SV-0442': '2026-02-09',
};

/** Gốc serial của Lark Sheets trùng Excel: 1899-12-30. */
const GOC = Date.UTC(1899, 11, 30);
const tuSerial = (n: number) => new Date(GOC + Math.round(n) * 86_400_000).toISOString().slice(0, 10);
/** Đảo ngày↔tháng. Trả null khi đảo ra tháng không hợp lệ (>12) — khi đó serial vốn đã đúng. */
function daoNgayThang(iso: string): string | null {
  const [y, m, d] = iso.split('-');
  return Number(d) >= 1 && Number(d) <= 12 ? `${y}-${d}-${m}` : null;
}

function env(ten: string): string {
  const v = process.env[ten];
  if (!v) throw new Error(`thiếu biến ${ten}`);
  return v;
}

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

async function main(): Promise<void> {
  const tk = await token();
  const node = (await goi(tk, `/open-apis/wiki/v2/spaces/get_node?token=${NODE}`)).node as { obj_token: string; title: string };
  console.log(`wiki "${node.title}" → obj_token ${node.obj_token}`);

  const d = await goi(tk, `/open-apis/sheets/v2/spreadsheets/${node.obj_token}/values/${SHEET}!A1:B200?valueRenderOption=UnformattedValue`);
  const hang = ((d.valueRange as { values: unknown[][] }).values ?? []);

  const ra: Record<string, { ngay: string; nguon: string; suyLuan?: true }> = {};
  const la: string[] = [];
  for (const r of hang) {
    const ma = String((Array.isArray(r[0]) ? (r[0][0] as { text?: string })?.text : r[0]) ?? '').trim();
    if (!MA_DON.test(ma)) continue;
    const o = r[1];
    if (typeof o === 'number' && o > 40_000 && o < 60_000) {
      const thang = tuSerial(o);
      const dao = daoNgayThang(thang);
      if (dao == null) { ra[ma] = { ngay: thang, nguon: `serial ${o} (đảo ra tháng >12 nên giữ nguyên)` }; continue; }
      const chung = NHAN_CHUNG[ma];
      if (chung && chung !== dao) { la.push(`${ma}: đảo ra ${dao} nhưng bảng ship hộ nói ${chung}`); continue; }
      ra[ma] = chung
        ? { ngay: dao, nguon: `serial ${o} đảo ngày↔tháng, khớp bảng ship hộ` }
        : { ngay: dao, nguon: `serial ${o} đảo ngày↔tháng, KHÔNG có nhân chứng`, suyLuan: true };
      continue;
    }
    const s = String((Array.isArray(o) ? (o[0] as { text?: string })?.text : o) ?? '').trim();
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
      ra[ma] = { ngay: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, nguon: `chữ "${s}" (dd/mm/yyyy)` };
      continue;
    }
    la.push(`${ma}: ${JSON.stringify(o)}`);
  }

  const sapXep = Object.fromEntries(Object.entries(ra).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(RA, `${JSON.stringify(sapXep, null, 1)}\n`);
  console.log(`${RA}: ${Object.keys(sapXep).length} mã`);
  for (const [k, v] of Object.entries(sapXep)) console.log(`  ${k}  ${v.ngay}  ${v.suyLuan ? '⚠ SUY LUẬN — ' : ''}${v.nguon}`);
  if (la.length > 0) {
    console.error(`\n✗ KHÔNG ĐỌC ĐƯỢC / KHÔNG KHỚP NHÂN CHỨNG (${la.length}):\n  ${la.join('\n  ')}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
