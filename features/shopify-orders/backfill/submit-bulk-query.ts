import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';

const BULK_MUTATION = `
  mutation backfill($q: String!) {
    bulkOperationRunQuery(query: $q) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

const ORDERS_QUERY = `
{
  orders(query: "created_at:>=<SINCE>") {
    edges { node {
      id name createdAt processedAt cancelledAt
      displayFinancialStatus displayFulfillmentStatus currencyCode
      subtotalLineItemsQuantity
      totalDiscountsSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount currencyCode } }
      totalPriceSet { shopMoney { amount currencyCode } }
      shippingAddress { countryCodeV2 }
      totalWeight
      lineItems { edges { node {
        id sku vendor title variantTitle quantity
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
      } } }
      refunds {
        id createdAt note
        totalRefundedSet { shopMoney { amount currencyCode } }
      }
      fulfillments { trackingInfo { number company } }
      shippingLines { title code }
    } }
  }
}`;

export async function submitBackfillBulkQuery(storeId: string, sinceIso: string): Promise<string> {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) throw new Error(`store ${storeId} not found`);
  const token = await getStoreToken(storeId);

  const query = ORDERS_QUERY.replace('<SINCE>', sinceIso);
  const res = await graphqlCall({
    shopDomain: store.shopDomain,
    apiVersion: store.apiVersion,
    token,
    query: BULK_MUTATION,
    variables: { q: query },
  });

  const body = res as {
    data?: { bulkOperationRunQuery?: { bulkOperation?: { id: string }; userErrors: Array<{ message: string }> } };
    errors?: unknown;
  };
  if (body.errors) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  const r = body.data?.bulkOperationRunQuery;
  if (!r) throw new Error('No response from bulkOperationRunQuery');
  if (r.userErrors.length > 0) throw new Error(r.userErrors[0].message);
  if (!r.bulkOperation) throw new Error('No bulkOperation returned');
  return r.bulkOperation.id;
}
