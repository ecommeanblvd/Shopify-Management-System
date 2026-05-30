import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';

const POLL_QUERY = `
  query poll {
    currentBulkOperation {
      id status errorCode objectCount url partialDataUrl
    }
  }
`;

export interface BulkStatus {
  id: string;
  status: 'CREATED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  errorCode: string | null;
  objectCount: string | null;
  url: string | null;
  partialDataUrl: string | null;
}

export async function pollBulkOperation(storeId: string): Promise<BulkStatus | null> {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId));
  if (!store) throw new Error(`store ${storeId} not found`);
  const token = await getStoreToken(storeId);

  const res = await graphqlCall({
    shopDomain: store.shopDomain,
    apiVersion: store.apiVersion,
    token,
    query: POLL_QUERY,
  });
  const body = res as { data?: { currentBulkOperation: BulkStatus | null }; errors?: unknown };
  if (body.errors) throw new Error(`GraphQL error: ${JSON.stringify(body.errors)}`);
  return body.data?.currentBulkOperation ?? null;
}
