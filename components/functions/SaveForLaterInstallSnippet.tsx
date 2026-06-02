'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface SaveForLaterInstallSnippetProps {
  shopDomain: string;
  embedUrl: string;
}

export function SaveForLaterInstallSnippet({
  shopDomain, embedUrl,
}: SaveForLaterInstallSnippetProps) {
  const [copied, setCopied] = useState<'snippet' | 'host' | null>(null);

  const snippet = `<script src="${embedUrl}" data-shop="${shopDomain}" defer></script>`;
  const host = `<div data-save-for-later></div>`;

  const copy = (kind: 'snippet' | 'host', text: string): void => {
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
        hint="On any /cart page the script auto-injects a Save for later link on each cart line and renders the saved panel below the form."
      />
      <Block
        label="2. (Optional) Render the saved list anywhere else"
        code={host}
        copied={copied === 'host'}
        onCopy={() => copy('host', host)}
        hint="Drop this div in the cart drawer, account page, or anywhere a non-cart-page render is useful."
      />
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
