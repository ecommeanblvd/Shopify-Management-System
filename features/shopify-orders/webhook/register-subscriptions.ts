/**
 * Subscribe a freshly-connected store to all four order-related webhook
 * topics. Idempotent — Shopify returns a `userErrors` entry with "has already
 * been taken" when the subscription exists; we treat that as success so this
 * function can be re-run from the admin sync-health page without side-effects.
 *
 * We bypass `lib/shopify/writer.ts` here because that path is heavily gated
 * for settings-sync apply runs (requires applyRunId, feature flag, snapshot,
 * reconciliation). Webhook registration during the OAuth callback has none
 * of that context — it's a one-off platform action with the freshly-issued
 * access token. Calling Shopify's Admin GraphQL directly keeps the OAuth
 * callback flow simple and reusable.
 */

import { SUPPORTED_TOPICS, slugFromTopic, type ShopifyWebhookTopic } from './dispatch';

const REGISTER_MUTATION = `
  mutation register($topic: WebhookSubscriptionTopic!, $url: URL!) {
    webhookSubscriptionCreate(
      topic: $topic,
      webhookSubscription: { callbackUrl: $url, format: JSON }
    ) {
      userErrors { field message }
      webhookSubscription { id }
    }
  }
`;

const TOPIC_TO_GRAPHQL: Record<ShopifyWebhookTopic, string> = {
  'orders/create': 'ORDERS_CREATE',
  'orders/updated': 'ORDERS_UPDATED',
  'orders/cancelled': 'ORDERS_CANCELLED',
  'refunds/create': 'REFUNDS_CREATE',
};

export interface RegisterOrderWebhooksArgs {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}

const ALREADY_EXISTS = /already (exists|been taken)/i;

export async function registerOrderWebhooks(args: RegisterOrderWebhooksArgs): Promise<void> {
  const baseUrl = process.env.SHOPIFY_APP_URL;
  if (!baseUrl) throw new Error('SHOPIFY_APP_URL not configured');

  for (const topic of SUPPORTED_TOPICS) {
    const url = `${baseUrl}/api/webhooks/shopify/${slugFromTopic(topic)}`;
    const res = await fetch(
      `https://${args.shopDomain}/admin/api/${args.apiVersion}/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': args.accessToken,
        },
        body: JSON.stringify({
          query: REGISTER_MUTATION,
          variables: { topic: TOPIC_TO_GRAPHQL[topic], url },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`webhookSubscriptionCreate ${topic}: HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      data?: { webhookSubscriptionCreate?: { userErrors?: Array<{ message: string }> } };
      errors?: unknown;
    };
    const userErrors = body.data?.webhookSubscriptionCreate?.userErrors ?? [];
    for (const e of userErrors) {
      if (ALREADY_EXISTS.test(e.message)) continue;
      throw new Error(`webhookSubscriptionCreate ${topic}: ${e.message}`);
    }
  }
}
