import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { readShipping, readCheckout } from '@/features/settings-viewer/queries';
import { settingsViewerManifest } from '@/features/settings-viewer/manifest';
import { recordAccess } from '@/lib/logging/access';
import { captureSnapshot } from '@/lib/snapshots/snapshots';
import { SettingsViewer } from '@/features/settings-viewer/ui/SettingsViewer';
import type { ConnectorStore } from '@/lib/shopify/connector';

export const dynamic = 'force-dynamic';

interface StoreSettings {
  storeName: string;
  shipping: unknown;
  checkoutStatus: 'available' | 'needs_migration';
}

export default async function SettingsViewerPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return <p>Please sign in.</p>;

  const [roleRow] = await db.select().from(schema.roles).where(eq(schema.roles.userId, session.user.id)).limit(1);
  if (!roleRow) return <p>Your account has no assigned role. Contact an administrator.</p>;
  // All three roles include the 'view' permission, so a row existing is sufficient.

  const stores = await db.select().from(schema.stores);
  const results: StoreSettings[] = [];

  for (const store of stores) {
    const connectorStore: ConnectorStore = {
      id: store.id, shopDomain: store.shopDomain, apiVersion: store.apiVersion,
      status: store.status, maintenanceMode: store.maintenanceMode, scopes: store.scopes,
    };
    await recordAccess({ userId: session.user.id, storeId: store.id, featureKey: settingsViewerManifest.key });

    let shipping: unknown = null;
    let checkoutStatus: 'available' | 'needs_migration' = 'needs_migration';
    try {
      shipping = await readShipping(connectorStore);
      await captureSnapshot({ storeId: store.id, domain: 'shipping', payload: shipping, capturedBy: session.user.id });
    } catch (err) {
      shipping = { error: 'Failed to load shipping settings', detail: err instanceof Error ? err.message : String(err) };
    }
    try {
      const checkout = await readCheckout(connectorStore);
      checkoutStatus = checkout.status;
      // payload column is NOT NULL — skip snapshot when the store has no checkout
      // branding to capture (Checkout Extensibility migration pending).
      if (checkout.data !== null && checkout.data !== undefined) {
        await captureSnapshot({ storeId: store.id, domain: 'checkout', payload: checkout.data, capturedBy: session.user.id });
      }
    } catch {
      // Read-only viewer: a checkout fetch failure should not blank the shipping panel.
      checkoutStatus = 'needs_migration';
    }
    results.push({ storeName: store.name, shipping, checkoutStatus });
  }

  return <SettingsViewer stores={results} />;
}
