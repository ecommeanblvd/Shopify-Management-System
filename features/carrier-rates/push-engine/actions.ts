'use server';

import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { recordAudit } from '@/lib/logging/audit';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { registerCarrierService } from '@/features/carrier-rates/carrier-service-actions';
import { buildParticipant, isVnZone } from './plan';
import { engineParticipantIdsToReplace } from './participant-ids';

export interface PushCarrierInput {
  storeId: string;
  carriers: string[];      // ['fedex','dhl'] | ['fedex'] | ['dhl'] — chỉ để ghi audit; khách thấy 2 mức dịch vụ, không thấy hãng (D-071)
  dryRun: boolean;
}
export interface PushCarrierResult {
  storeName: string;
  carriers: string[];
  zonesTargeted: number;   // zone quốc tế sẽ/đã đẩy
  zonesSkippedVn: number;
  applied: boolean;
}

async function requirePerm() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'apply_markets')) throw new Error('forbidden');
  return session.user.id;
}

const ZONE_Q = `query($id:ID!,$after:String){deliveryProfile(id:$id){profileLocationGroups{locationGroup{id} locationGroupZones(first:3,after:$after){pageInfo{hasNextPage endCursor} edges{node{zone{id name countries{code{countryCode restOfWorld}}} methodDefinitions(first:250){edges{node{id rateProvider{__typename}}}}}}}}}}`;
const MUT = `mutation($id:ID!,$p:DeliveryProfileInput!){deliveryProfileUpdate(id:$id,profile:$p){userErrors{field message}}}`;

/**
 * Đẩy giá carrier engine lên 1 store (né bug VN-origin bằng cách attach
 * DeliveryParticipant qua API). Participant bật đúng hai mức "Standard Shipping"
 * / "Express Shipping" (D-071). Bỏ qua zone VN (free). dryRun = chỉ đếm.
 */
export async function pushCarrierRates(input: PushCarrierInput): Promise<PushCarrierResult> {
  const userId = await requirePerm();
  if (!input.carriers.length) throw new Error('Chưa chọn carrier nào.');

  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, input.storeId)).limit(1);
  if (!store) throw new Error('Store không tồn tại.');

  const token = await getStoreToken(store.id);
  const call = (query: string, variables?: Record<string, unknown>) =>
    graphqlCall({ shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, query, variables });

  // Đăng ký carrier service (chỉ khi apply) → id để tham chiếu participant.
  let carrierServiceId = '';
  if (!input.dryRun) ({ carrierServiceId } = await registerCarrierService(store.id));

  // Danh sách profile của store.
  const pRes = await call(`query{deliveryProfiles(first:20){edges{node{id}}}}`);
  const profileIds: string[] = ((pRes.data as { deliveryProfiles?: { edges?: Array<{ node: { id: string } }> } })?.deliveryProfiles?.edges ?? []).map((e) => e.node.id);

  let zonesTargeted = 0, zonesSkippedVn = 0;

  for (const profileId of profileIds) {
    let cursor: string | null = null, more = true;
    while (more) {
      const q = await call(ZONE_Q, { id: profileId, after: cursor });
      const lg = (q.data as { deliveryProfile?: { profileLocationGroups?: Array<{ locationGroup: { id: string }; locationGroupZones: { pageInfo: { hasNextPage: boolean; endCursor: string }; edges: Array<{ node: { zone: { id: string; name: string; countries: Array<{ code: { countryCode?: string; restOfWorld?: boolean } }> }; methodDefinitions: { edges: Array<{ node: { id: string; rateProvider?: { __typename?: string } } }> } } }> } }> } })?.deliveryProfile?.profileLocationGroups?.[0];
      const lgId = lg?.locationGroup?.id;
      const conn = lg?.locationGroupZones;
      for (const e of (conn?.edges ?? [])) {
        const z = e.node;
        const countries = z.zone.countries.map((c) => c.code);
        if (isVnZone(countries)) { zonesSkippedVn++; continue; }
        zonesTargeted++;
        if (input.dryRun || !lgId) continue;

        // Chỉ xoá participant carrier-calculated cũ (engine) → giữ NGUYÊN flat
        // manual rate ("Standard shipping"/"Express shipping"). rateProvider là
        // union: __typename === 'DeliveryParticipant' = carrier-calc, còn
        // 'DeliveryRateDefinition' = flat manual (không đụng).
        const oldIds = engineParticipantIdsToReplace(z.methodDefinitions.edges);
        const participant = buildParticipant(carrierServiceId);
        const e1 = await call(MUT, { id: profileId, p: { methodDefinitionsToDelete: oldIds, locationGroupsToUpdate: [{ id: lgId, zonesToUpdate: [{ id: z.zone.id, methodDefinitionsToCreate: [{ name: 'Engine Carrier Rates', active: true, participant }] }] }] } });
        const er1 = (e1.data as { deliveryProfileUpdate?: { userErrors?: Array<{ message: string }> } })?.deliveryProfileUpdate?.userErrors;
        if (er1?.length) throw new Error(`${z.zone.name}: ${er1.map((x) => x.message).join('; ')}`);
      }
      more = conn?.pageInfo?.hasNextPage ?? false;
      cursor = conn?.pageInfo?.endCursor ?? null;
    }
  }

  if (!input.dryRun) {
    await recordAudit({ userId, storeId: store.id, action: 'carrier_rates.push', target: input.carriers.join('+'), requestSummary: `zones=${zonesTargeted}`, result: 'success' });
  }
  return { storeName: store.name, carriers: input.carriers, zonesTargeted, zonesSkippedVn, applied: !input.dryRun };
}

/** Danh sách store cho UI chọn. */
export async function listStoresForPush(): Promise<{ id: string; name: string }[]> {
  await requirePerm();
  return (await db.select({ id: schema.stores.id, name: schema.stores.name }).from(schema.stores)).map((s) => ({ id: s.id, name: s.name }));
}
