'use server';

import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { recordAudit } from '@/lib/logging/audit';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { getEnv } from '@/lib/env';

/** Tên carrier service đăng ký trên Shopify (khoá để tìm lại khi đăng ký lại). */
const CARRIER_SERVICE_NAME = 'Engine Carrier Rates';

const LIST_QUERY = `query { carrierServices(first: 50) { edges { node { id name callbackUrl active } } } }`;

const CREATE_MUTATION = `
  mutation carrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
    carrierServiceCreate(input: $input) {
      carrierService { id name callbackUrl active }
      userErrors { field message }
    }
  }`;

const UPDATE_MUTATION = `
  mutation carrierServiceUpdate($input: DeliveryCarrierServiceUpdateInput!) {
    carrierServiceUpdate(input: $input) {
      carrierService { id name callbackUrl active }
      userErrors { field message }
    }
  }`;

export interface RegisterCarrierServiceResult {
  carrierServiceId: string;
  callbackUrl: string;
  created: boolean; // true = mới tạo, false = cập nhật cái sẵn có
}

async function requireApplyPermission(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'apply_markets')) throw new Error('forbidden');
  return session.user.id;
}

async function loadStore(storeId: string) {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) throw new Error(`Store ${storeId} not found`);
  return store;
}

interface CarrierServiceNode { id: string; name: string; callbackUrl: string; active: boolean }

function pickUserErrors(payload: unknown, key: string): string {
  const errs = (payload as Record<string, { userErrors?: Array<{ message: string }> }>)?.[key]?.userErrors;
  return errs?.length ? errs.map((e) => e.message).join('; ') : '';
}

/**
 * Đăng ký (hoặc cập nhật) Shopify CarrierService cho store → bật rate
 * carrier-calculated ở checkout, trỏ callback về engine của ta. Idempotent:
 * tìm theo tên, có rồi thì update callbackUrl + active, chưa có thì create.
 * Yêu cầu store Shopify Plus (CarrierService API).
 */
export async function registerCarrierService(storeId: string): Promise<RegisterCarrierServiceResult> {
  const userId = await requireApplyPermission();
  const store = await loadStore(storeId);
  const token = await getStoreToken(store.id);
  const callbackUrl = `${getEnv().SHOPIFY_APP_URL}/api/shopify/carrier-service/${store.id}`;

  const call = (query: string, variables?: Record<string, unknown>) =>
    graphqlCall({ shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, query, variables });

  // 1) Có carrier service cùng tên chưa?
  const listed = await call(LIST_QUERY);
  if ((listed as { errors?: unknown }).errors) {
    throw new Error(`Shopify: ${JSON.stringify((listed as { errors?: unknown }).errors).slice(0, 300)}`);
  }
  const edges = (listed.data as { carrierServices?: { edges?: Array<{ node: CarrierServiceNode }> } })?.carrierServices?.edges ?? [];
  const existing = edges.map((e) => e.node).find((n) => n.name === CARRIER_SERVICE_NAME);

  let carrierServiceId: string;
  let created: boolean;
  if (existing) {
    const res = await call(UPDATE_MUTATION, { input: { id: existing.id, name: CARRIER_SERVICE_NAME, callbackUrl, active: true } });
    const err = pickUserErrors((res.data as Record<string, unknown>), 'carrierServiceUpdate');
    if (err) throw new Error(`carrierServiceUpdate: ${err}`);
    carrierServiceId = existing.id;
    created = false;
  } else {
    const res = await call(CREATE_MUTATION, { input: { name: CARRIER_SERVICE_NAME, callbackUrl, active: true, supportsServiceDiscovery: true } });
    const err = pickUserErrors((res.data as Record<string, unknown>), 'carrierServiceCreate');
    if (err) throw new Error(`carrierServiceCreate: ${err}`);
    const node = (res.data as { carrierServiceCreate?: { carrierService?: CarrierServiceNode } })?.carrierServiceCreate?.carrierService;
    if (!node) throw new Error('carrierServiceCreate: không trả về carrierService (store có phải Shopify Plus?)');
    carrierServiceId = node.id;
    created = true;
  }

  await recordAudit({
    userId,
    storeId: store.id,
    action: created ? 'carrier_service.create' : 'carrier_service.update',
    target: carrierServiceId,
    requestSummary: callbackUrl,
    result: 'success',
  });

  return { carrierServiceId, callbackUrl, created };
}
