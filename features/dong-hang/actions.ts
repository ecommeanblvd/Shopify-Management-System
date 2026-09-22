'use server';

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { quoteOrderAcrossCarriers } from '@/features/carrier-rates/compare/quote-order-carriers';
import { laNhaDan } from '@/features/carrier-rates/residential-from-class';
import { assignOrderCarrier } from '@/features/shopify-orders/carrier-select-actions';
import { xepQuote } from './logic';
import type { BaoGiaKien } from './types';

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, BaoGiaKien>();

/** Báo giá MỘT kiện qua mọi hãng theo cân thực + kích thước kiện (không phải cân đơn). Cache 10 phút. */
export async function baoGiaKien(shipmentId: string): Promise<BaoGiaKien> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { rows: [], reNhatKey: null, error: 'Chưa đăng nhập', luc: new Date().toISOString() };
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'view_fulfillment')) return { rows: [], reNhatKey: null, error: 'Không có quyền', luc: new Date().toISOString() };

  const [k] = await db.select({
    weightKg: schema.shipments.actualWeightKg, l: schema.shipments.dimLengthCm, w: schema.shipments.dimWidthCm, h: schema.shipments.dimHeightCm,
    labelCreatedAt: schema.shipments.labelCreatedAt, createdAt: schema.shipments.createdAt,
    country: schema.shopifyOrders.shipCountry, postcode: schema.shopifyOrders.shipPostcode, city: schema.shopifyOrders.shipCity, addrClass: schema.shopifyOrders.addrClass,
  }).from(schema.shipments).innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .where(eq(schema.shipments.id, shipmentId)).limit(1);
  const luc = new Date().toISOString();
  if (!k) return { rows: [], reNhatKey: null, error: 'Không tìm thấy kiện', luc };
  const weightKg = k.weightKg != null ? Number(k.weightKg) : null;
  if (!k.country || !weightKg) return { rows: [], reNhatKey: null, error: 'Kiện thiếu nước hoặc cân — chưa so cước được', luc };
  const dims = k.l != null && k.w != null && k.h != null ? { lengthCm: Number(k.l), widthCm: Number(k.w), heightCm: Number(k.h) } : null;

  const key = `${shipmentId}|${weightKg}|${dims ? `${dims.lengthCm}x${dims.widthCm}x${dims.heightCm}` : ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - new Date(hit.luc).getTime() < CACHE_MS) return hit;

  const rows = await quoteOrderAcrossCarriers({
    country: k.country, weightKg, postcode: k.postcode, city: k.city, dimensions: dims,
    effectiveDate: k.labelCreatedAt ?? k.createdAt,
    isResidential: laNhaDan(k.addrClass, k.country),
  });
  const xep = xepQuote(rows);
  const kq: BaoGiaKien = { rows: xep.rows, reNhatKey: xep.reNhatKey, luc };
  // Không để Map phình vô hạn: quá 1.000 khoá thì xoá hết (cache chỉ là tiện, không phải nguồn sự thật).
  if (cache.size > 1000) cache.clear();
  cache.set(key, kq);
  return kq;
}

/** Chọn hãng cho ĐƠN (áp cho mọi kiện của đơn — Lark ghi mọi dòng của đơn). Cần manage_fulfillment. */
export async function chonHangChoDon(orderId: string, carrierKey: string): Promise<Awaited<ReturnType<typeof assignOrderCarrier>>> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { ok: false, error: 'Chưa đăng nhập' };
  const role = await getRole(session.user.id);
  if (!hasPermission(role, 'manage_fulfillment')) return { ok: false, error: 'Không có quyền chọn hãng' };
  const r = await assignOrderCarrier(orderId, carrierKey);
  revalidatePath('/f/dong-hang');
  return r;
}
