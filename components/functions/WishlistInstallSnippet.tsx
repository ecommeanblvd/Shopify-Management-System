'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';

interface WishlistInstallSnippetProps {
  shopDomain: string;
  embedUrl: string;
}

/** Operator-facing install card. Shows the exact script tag to paste
 *  into the theme's `<head>` (or push via the Asset API) and a
 *  one-click copy button. */
export function WishlistInstallSnippet({ shopDomain, embedUrl }: WishlistInstallSnippetProps) {
  const [copied, setCopied] = useState<'snippet' | 'trigger' | 'page' | null>(null);

  const snippet = `<script src="${embedUrl}" data-shop="${shopDomain}" defer></script>`;
  const trigger = `<a href="#" data-wishlist-trigger>Wishlist</a>`;
  const page = `<div id="wishlist-page"></div>`;

  const copy = (kind: 'snippet' | 'trigger' | 'page', text: string): void => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div className="space-y-4">
      <Block
        label="1. Paste in theme.liquid &lt;head&gt;"
        code={snippet}
        copied={copied === 'snippet'}
        onCopy={() => copy('snippet', snippet)}
      />
      <Block
        label="2. (Optional) Open-drawer link anywhere in the theme"
        code={trigger}
        copied={copied === 'trigger'}
        onCopy={() => copy('trigger', trigger)}
        hint="The script automatically updates the link with a count badge."
      />
      <Block
        label="3. (Optional) Inline wishlist page"
        code={page}
        copied={copied === 'page'}
        onCopy={() => copy('page', page)}
        hint="Create a Shopify page /pages/wishlist with this single div to render the full list inline instead of in the drawer."
      />
      <p className="text-[11px] text-muted-foreground">
        Need to push this automatically? Use Shopify Admin &rarr; Apps &rarr;
        Theme code, or the Asset API.{' '}
        <a
          href="https://shopify.dev/docs/api/admin-rest/latest/resources/asset"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 underline"
        >
          Shopify Asset docs
          <ExternalLink className="size-3" />
        </a>
      </p>
    </div>
  );
}

function Block({
  label, code, copied, onCopy, hint,
}: {
  label: string; code: string; copied: boolean; onCopy: () => void; hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-xs uppercase tracking-wider text-muted-foreground">{label}</h4>
        <button
          type="button"
          onClick={onCopy}
          className="text-[11px] inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="text-[11px] font-mono bg-muted/40 rounded-md px-3 py-2.5 overflow-x-auto whitespace-pre-wrap break-all border border-border/50">
{code}
      </pre>
      {hint && <p className="text-[11px] text-muted-foreground mt-1.5">{hint}</p>}
    </div>
  );
}
