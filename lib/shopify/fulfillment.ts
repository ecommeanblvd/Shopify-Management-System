import { graphqlCall } from './client';
import type { FulfillmentOrderNode, FulfillmentInputGroup } from '@/features/packing/shopify-push';

export interface ShopifyStoreRef { shopDomain: string; apiVersion: string; token: string; }

const FULFILLMENT_ORDERS_QUERY = `
  query OrderFulfillmentOrders($id: ID!) {
    order(id: $id) {
      fulfillmentOrders(first: 20) {
        nodes {
          id
          status
          lineItems(first: 100) {
            nodes { id remainingQuantity lineItem { id } }
          }
        }
      }
    }
  }
`;

/** Open fulfillment orders for an order, normalized to the pure-logic shape. */
export async function getOrderFulfillmentOrders(args: { store: ShopifyStoreRef; orderGid: string }): Promise<FulfillmentOrderNode[]> {
  const res = await graphqlCall({
    shopDomain: args.store.shopDomain, apiVersion: args.store.apiVersion, token: args.store.token,
    query: FULFILLMENT_ORDERS_QUERY, variables: { id: args.orderGid },
  });
  if (res.errors) throw new Error(`Shopify query error: ${JSON.stringify(res.errors)}`);
  const data = res.data as { order?: { fulfillmentOrders?: { nodes?: Array<{ id: string; status: string; lineItems: { nodes: Array<{ id: string; remainingQuantity: number; lineItem: { id: string } }> } }> } } };
  const nodes = data.order?.fulfillmentOrders?.nodes ?? [];
  return nodes
    .filter((fo) => fo.status === 'OPEN' || fo.status === 'IN_PROGRESS')
    .map((fo) => ({ id: fo.id, lineItems: fo.lineItems.nodes }));
}

const FULFILLMENT_CREATE_MUTATION = `
  mutation FulfillmentCreate($fulfillment: FulfillmentV2Input!) {
    fulfillmentCreateV2(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

/** Create a Shopify fulfillment for the given line groups + tracking. */
export async function createFulfillment(args: {
  store: ShopifyStoreRef;
  lineItemsByFulfillmentOrder: FulfillmentInputGroup[];
  trackingCompany: string;
  trackingNumber: string;
  notifyCustomer: boolean;
}): Promise<string> {
  const res = await graphqlCall({
    shopDomain: args.store.shopDomain, apiVersion: args.store.apiVersion, token: args.store.token,
    query: FULFILLMENT_CREATE_MUTATION,
    variables: {
      fulfillment: {
        notifyCustomer: args.notifyCustomer,
        trackingInfo: { company: args.trackingCompany, number: args.trackingNumber },
        lineItemsByFulfillmentOrder: args.lineItemsByFulfillmentOrder,
      },
    },
  });
  if (res.errors) throw new Error(`Shopify mutation error: ${JSON.stringify(res.errors)}`);
  const out = (res.data as { fulfillmentCreateV2?: { fulfillment?: { id: string }; userErrors?: Array<{ field: string[]; message: string }> } }).fulfillmentCreateV2;
  if (out?.userErrors && out.userErrors.length > 0) {
    throw new Error(`Fulfillment userErrors: ${out.userErrors.map((e) => e.message).join('; ')}`);
  }
  const id = out?.fulfillment?.id;
  if (!id) throw new Error('Shopify did not return a fulfillment id');
  return id;
}
