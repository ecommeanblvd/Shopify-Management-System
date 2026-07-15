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

// <FILTER> is replaced with a Shopify search clause, e.g. `(query: "created_at:<=2024-...")`,
// or left empty ('') to pull the store's entire order history.
const ORDERS_QUERY = `
{
  orders<FILTER> {
    edges { node {
      id name createdAt processedAt updatedAt cancelledAt
      displayFinancialStatus displayFulfillmentStatus currencyCode
      subtotalLineItemsQuantity
      totalDiscountsSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount currencyCode } }
      totalPriceSet { shopMoney { amount currencyCode } }
      shippingAddress { countryCodeV2 city zip address1 address2 provinceCode name company }
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
      shippingLines { edges { node { id title code discountedPriceSet { shopMoney { amount currencyCode } } } } }
    } }
  }
}`;

/**
 * Submit a bulk order export.
 *
 * @param filterClause a Shopify `orders` search string (e.g. `created_at:<=2024-01-01T00:00:00Z`),
 *   or '' to export the store's entire order history. Passing a `created_at:<=<oldest synced>`
 *   clause is how the backfill skips orders it already has (Shopify filters server-side, so those
 *   rows are never streamed back).
 */
export async function submitBackfillBulkQuery(storeId: string, filterClause: string): Promise<string> {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) throw new Error(`store ${storeId} not found`);
  const token = await getStoreToken(storeId);

  const filter = filterClause ? `(query: ${JSON.stringify(filterClause)})` : '';
  const query = ORDERS_QUERY.replace('<FILTER>', filter);
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
