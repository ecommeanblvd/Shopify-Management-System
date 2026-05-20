import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ConnectStorePage() {
  return (
    <div className="max-w-xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Connect a store</CardTitle>
          <CardDescription>Install the management app into a Shopify store.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/api/auth/shopify/install" method="get" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="shop">Shop domain</Label>
              <Input id="shop" name="shop" placeholder="your-shop.myshopify.com" required pattern="[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com" />
              <p className="text-xs text-[var(--color-muted)]">Format: lowercase letters/numbers/dashes, ending in <span className="font-mono">.myshopify.com</span>.</p>
            </div>
            <Alert>
              <AlertDescription>
                After connecting, run &quot;Test connection&quot; on the dashboard. If the store reports missing scopes, re-install to grant the new permissions.
              </AlertDescription>
            </Alert>
            <Button type="submit" className="w-full">Connect via Shopify OAuth</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
