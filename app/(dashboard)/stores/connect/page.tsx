import Link from 'next/link';
import { ChevronLeft, Store, ShieldCheck, Plug } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export default function ConnectStorePage() {
  return (
    <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Dashboard
      </Link>

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Plug className="size-3.5" />
          Store connection
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Connect a Shopify store</h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          We&rsquo;ll redirect to Shopify so you can install the management app under the store&rsquo;s admin and grant the scopes Settings Sync and Markets need.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-6">
        {/* Form */}
        <Card>
          <CardContent className="p-6 md:p-8 space-y-6">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Store className="size-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold">Shop domain</h2>
                <p className="text-xs text-muted-foreground">The {`{handle}`}.myshopify.com URL of the store.</p>
              </div>
            </div>
            <form action="/api/auth/shopify/install" method="get" className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="shop" className="text-xs uppercase tracking-wider text-muted-foreground">Shop domain</Label>
                <Input
                  id="shop"
                  name="shop"
                  placeholder="your-shop.myshopify.com"
                  required
                  pattern="[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase letters, numbers, or dashes — ending in{' '}
                  <span className="font-mono">.myshopify.com</span>.
                </p>
              </div>
              <Button type="submit" size="lg" className="w-full gap-2">
                <Plug className="size-4" />
                Continue to Shopify
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* What happens next */}
        <Card>
          <CardContent className="p-6 md:p-8 space-y-4">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-xl bg-secondary text-secondary-foreground flex items-center justify-center">
                <ShieldCheck className="size-4" />
              </div>
              <h2 className="text-base font-semibold">What happens next</h2>
            </div>
            <ol className="space-y-3 text-sm">
              <Step n={1} title="Shopify OAuth consent" body="The store owner reviews the requested scopes and approves." />
              <Step n={2} title="Token stored encrypted" body="Access token is encrypted at rest before we ever persist it." />
              <Step n={3} title="Health check" body="We immediately validate the connection and surface missing scopes on the dashboard." />
            </ol>
            <p className="text-xs text-muted-foreground pt-2 border-t border-border">
              Need to grant more scopes later? Re-install with the same form — Shopify prompts the owner to approve the additions.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="size-6 rounded-full bg-muted text-muted-foreground text-xs font-medium flex items-center justify-center shrink-0">
        {n}
      </span>
      <div>
        <div className="font-medium leading-tight">{title}</div>
        <div className="text-xs text-muted-foreground leading-tight mt-0.5">{body}</div>
      </div>
    </li>
  );
}
