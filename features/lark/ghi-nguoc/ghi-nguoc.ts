/**
 * Ghi ngược trạng thái giao, ngày giao, chi phí hãng lên bảng Lark LOG-Export (spec 2026-09-19).
 *
 * Chạy lồng trong cron sync-lark với record đã tải sẵn. Khớp dòng theo "Log Unique code"
 * (= shipments.log_unique_code). Một đường ghi duy nhất: updateLogRecordFields (D-045).
 * Công tắc LARK_GHI_NGUOC: 'dry' tính và ghi nhật ký nhưng không gọi Lark; '1' ghi thật.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { updateLogRecordFields, type LarkRecord } from '../client';
import { larkText } from '../parse-pack-row';
import { laNguonHang } from '../nguon-hang';
import { COT } from './cot';
import { dungPatch, type KienGhiNguoc, type ChargeGhiNguoc } from './dung-patch';

export type CheDoGhiNguoc = 'tat' | 'dry' | 'ghi';

export function cheDoGhiNguoc(env: string | undefined = process.env.LARK_GHI_NGUOC): CheDoGhiNguoc {
  if (env === '1') return 'ghi';
  if (env === 'dry') return 'dry';
  return 'tat';
}

/** THUẦN: record Lark theo Log Unique code. */
export function khopRecordTheoCode(records: readonly LarkRecord[]): Map<string, LarkRecord> {
  const m = new Map<string, LarkRecord>();
  for (const r of records) {
    const code = larkText(r.fields[COT.logUniqueCode]);
    if (code) m.set(code, r);
  }
  return m;
}

export interface TomTatGhiNguoc {
  cheDo: CheDoGhiNguoc; soi: number; khopLark: number;
  /** Kiện có nguồn không phải hãng (trạng thái + Ngày giao thực tế không được ghi) — không loại trừ chi phí/ngày dự kiến. */
  boQuaNguon: number;
  dongGhi: number; oGhi: { trangThai: number; ngay: number; chiPhi: number };
  lech: number; viDuLech: string[]; loi: number; loiMau?: string;
}

/** Chỉ soi kiện tạo nhãn trong 60 ngày — kiện cũ hơn đã xong việc (cùng cửa sổ courier-backfill). */
const SO_NGAY = 60;
const SO_VI_DU_LECH = 5;

type DongKien = {
  code: string;
  deliveryStatus: string | null; deliverySource: string | null;
  deliveredAt: string | Date | null; labelCreatedAt: string | Date | null; shipCountry: string | null;
  totalAmount: string | null; base: string | null; discount: string | null; fuel: string | null; remote: string | null;
  demand: string | null; directSignature: string | null; vat: string | null; gogreen: string | null;
  elevatedRisk: string | null; importHandling: string | null; residential: string | null;
};

const so = (v: string | null): number | null => (v == null ? null : Number(v));

function chargeTu(r: DongKien): ChargeGhiNguoc | null {
  if (r.totalAmount == null) return null;
  return {
    totalAmount: Number(r.totalAmount), base: so(r.base), discount: so(r.discount), fuel: so(r.fuel), remote: so(r.remote),
    demand: so(r.demand), directSignature: so(r.directSignature), vat: so(r.vat), gogreen: so(r.gogreen),
    elevatedRisk: so(r.elevatedRisk), importHandling: so(r.importHandling), residential: so(r.residential),
  };
}

export async function ghiNguocLark(records: readonly LarkRecord[]): Promise<TomTatGhiNguoc> {
  const cheDo = cheDoGhiNguoc();
  const kq: TomTatGhiNguoc = { cheDo, soi: 0, khopLark: 0, boQuaNguon: 0, dongGhi: 0, oGhi: { trangThai: 0, ngay: 0, chiPhi: 0 }, lech: 0, viDuLech: [], loi: 0 };
  if (cheDo === 'tat') return kq;

  const theoCode = khopRecordTheoCode(records);
  // Kiện 60 ngày kèm nước và charge (một dòng shipment_charges mỗi kiện — kiểm 19/09: 1.002 kiện / 1.002 dòng).
  const { rows } = await db.execute<DongKien>(sql`
    SELECT s.log_unique_code AS code, s.delivery_status AS "deliveryStatus", s.delivery_source AS "deliverySource",
           s.delivered_at AS "deliveredAt", s.label_created_at AS "labelCreatedAt", o.ship_country AS "shipCountry",
           c.total_amount AS "totalAmount", c.base, c.discount, c.fuel, c.remote, c.demand,
           c.direct_signature AS "directSignature", c.vat, c.gogreen, c.elevated_risk AS "elevatedRisk",
           c.import_handling AS "importHandling", c.residential
      FROM shipments s
      JOIN shopify_orders o ON o.id = s.order_id
      LEFT JOIN LATERAL (SELECT * FROM shipment_charges x WHERE x.shipment_id = s.id ORDER BY x.imported_at DESC NULLS LAST LIMIT 1) c ON true
     WHERE s.log_unique_code IS NOT NULL
       AND s.label_created_at >= now() - (${SO_NGAY} || ' days')::interval`);

  for (const r of rows) {
    kq.soi++;
    const rec = theoCode.get(r.code);
    if (!rec) continue;
    kq.khopLark++;
    const kien: KienGhiNguoc = {
      deliveryStatus: r.deliveryStatus, deliverySource: r.deliverySource,
      deliveredAt: r.deliveredAt ? new Date(r.deliveredAt) : null,
      labelCreatedAt: r.labelCreatedAt ? new Date(r.labelCreatedAt) : null,
      shipCountry: r.shipCountry,
    };
    const p = dungPatch(kien, chargeTu(r), rec.fields);
    if (p.lech.length) {
      kq.lech += p.lech.length;
      for (const l of p.lech) if (kq.viDuLech.length < SO_VI_DU_LECH) kq.viDuLech.push(`${r.code} · ${l}`);
    }
    if (!laNguonHang(kien.deliverySource)) kq.boQuaNguon++;
    if (Object.keys(p.patch).length === 0) continue;
    kq.oGhi.trangThai += p.nhom.trangThai; kq.oGhi.ngay += p.nhom.ngay; kq.oGhi.chiPhi += p.nhom.chiPhi;
    kq.dongGhi++;
    if (cheDo !== 'ghi') continue;
    try { await updateLogRecordFields(rec.record_id, p.patch); }
    catch (e) { kq.loi++; kq.loiMau ??= `${r.code}: ${(e as Error).message}`.slice(0, 200); }
  }
  return kq;
}
