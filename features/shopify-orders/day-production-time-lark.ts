/**
 * Điền "Min/Max Production (days)" vào file CX Working (CEO 26/09).
 *
 * CỐ Ý KHÔNG có `'use server'` — việc của script, không phải endpoint.
 *
 * Bảng đích là FILE ĐANG VẬN HÀNH của đội CX, nên:
 *  - chỉ ghi ĐÚNG HAI cột này, không đụng cột nào khác;
 *  - dòng đã đúng sẵn thì BỎ QUA, không ghi đè (chạy lại nhiều lần vô hại);
 *  - không có số thì để trống, không ghi 0 — 0 ngày là một lời nói dối,
 *    khác hẳn "chưa biết".
 *
 * Khoá nối: `Order Number` + `Lineitem SKU`, đúng cách chính bảng đó dựng cột
 * `ID` của nó.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

const DOMAIN = process.env.LARK_DOMAIN || 'https://open.larksuite.com';
const APP = 'EaPswVhWEi8MnckszPAluuq8gZg';
const TBL = 'tblF6nPbhHalo7KI';
const COT_MIN = 'Min Production (days)';
const COT_MAX = 'Max Production (days)';
/** Lark cho 1.000 bản ghi mỗi lượt; 400 để body không phình và dễ lần lỗi. */
const LO = 400;

const chu = (v: unknown): string => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (x as { text?: string })?.text ?? String(x)).join('');
  if (typeof v === 'object') return (v as { text?: string }).text ?? '';
  return String(v);
};
const so = (v: unknown): number | null => {
  const s = chu(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

async function token(): Promise<string> {
  const r = await fetch(`${DOMAIN}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: process.env.LARK_APP_ID, app_secret: process.env.LARK_APP_SECRET }),
  });
  const j = await r.json() as { tenant_access_token?: string };
  if (!j.tenant_access_token) throw new Error('[lark] khong lay duoc token');
  return j.tenant_access_token;
}

export interface KetQuaDay { cxDong: number; daDung: number; ghi: number; khongCoSo: number; khongKhop: number }

export async function dayProductionTime(onTin?: (s: string) => void): Promise<KetQuaDay> {
  const t = await token();
  const H = { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };

  const cx: { record_id: string; fields: Record<string, unknown> }[] = [];
  let page: string | undefined;
  do {
    const u = new URL(`${DOMAIN}/open-apis/bitable/v1/apps/${APP}/tables/${TBL}/records`);
    u.searchParams.set('page_size', '500');
    if (page) u.searchParams.set('page_token', page);
    const j = await (await fetch(u, { headers: H })).json() as {
      code: number; msg: string; data?: { items?: typeof cx; page_token?: string; has_more?: boolean } };
    if (j.code !== 0) throw new Error(`[lark] doc CX loi: ${j.code} ${j.msg}`);
    cx.push(...(j.data?.items ?? []));
    page = j.data?.has_more ? j.data?.page_token : undefined;
  } while (page);

  const r = await db.execute(sql`
    select regexp_replace(o.shopify_order_number,'^#','') don, l.sku,
           l.processing_min_days mn, l.processing_max_days mx
    from shopify_order_lines l join shopify_orders o on o.id = l.order_id
    where l.sku is not null and (l.processing_min_days is not null or l.processing_max_days is not null)`);
  const ben = new Map<string, { mn: number | null; mx: number | null }>();
  for (const x of ((r.rows ?? r) as { don: string; sku: string; mn: number | null; mx: number | null }[])) {
    ben.set(`${x.don}|${x.sku}`, { mn: x.mn, mx: x.mx });
  }

  const ket: KetQuaDay = { cxDong: cx.length, daDung: 0, ghi: 0, khongCoSo: 0, khongKhop: 0 };
  const can: { record_id: string; fields: Record<string, unknown> }[] = [];
  for (const rec of cx) {
    const k = `${chu(rec.fields['Order Number']).replace(/^#/, '')}|${chu(rec.fields['Lineitem SKU'])}`;
    const v = ben.get(k);
    if (!v) { ket.khongKhop += 1; continue; }
    if (v.mn == null && v.mx == null) { ket.khongCoSo += 1; continue; }
    // Đã đúng sẵn thì thôi — chạy lại lần hai không được sinh ra 5.700 lượt ghi vô ích.
    if (so(rec.fields[COT_MIN]) === v.mn && so(rec.fields[COT_MAX]) === v.mx) { ket.daDung += 1; continue; }
    can.push({ record_id: rec.record_id, fields: { [COT_MIN]: v.mn, [COT_MAX]: v.mx } });
  }

  for (let i = 0; i < can.length; i += LO) {
    const lo = can.slice(i, i + LO);
    const j = await (await fetch(`${DOMAIN}/open-apis/bitable/v1/apps/${APP}/tables/${TBL}/records/batch_update`, {
      method: 'POST', headers: H, body: JSON.stringify({ records: lo }),
    })).json() as { code: number; msg: string };
    if (j.code !== 0) throw new Error(`[lark] batch_update loi: ${j.code} ${j.msg}`);
    ket.ghi += lo.length;
    onTin?.(`ghi ${ket.ghi}/${can.length}`);
  }
  return ket;
}
