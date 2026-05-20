import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface StoreSettings {
  storeName: string;
  shipping: unknown;
  checkoutStatus: 'available' | 'needs_migration';
}

export function SettingsViewer({ stores }: { stores: StoreSettings[] }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings Viewer</h1>
      {stores.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">No stores connected yet.</p>
      ) : stores.map((s) => (
        <Card key={s.storeName}>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{s.storeName}</CardTitle>
            <Badge variant={s.checkoutStatus === 'available' ? 'default' : 'secondary'}>
              checkout: {s.checkoutStatus === 'available' ? 'ready' : 'needs migration'}
            </Badge>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="shipping">
              <TabsList>
                <TabsTrigger value="shipping">Shipping</TabsTrigger>
                <TabsTrigger value="checkout">Checkout branding</TabsTrigger>
              </TabsList>
              <TabsContent value="shipping">
                <pre className="text-xs font-mono p-3 rounded-md bg-[var(--color-muted-surface)] overflow-auto max-h-96">{JSON.stringify(s.shipping, null, 2)}</pre>
              </TabsContent>
              <TabsContent value="checkout">
                {s.checkoutStatus === 'available'
                  ? <p className="text-sm">Checkout branding is available on this store.</p>
                  : <Alert><AlertDescription>This store has not migrated to Checkout Extensibility. Migrate it in the Shopify admin to manage branding here.</AlertDescription></Alert>}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
