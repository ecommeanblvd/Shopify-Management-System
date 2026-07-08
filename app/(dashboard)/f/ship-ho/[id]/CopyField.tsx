'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

/**
 * 1 trường thông tin + nút copy — để staff copy từng field dán thẳng vào form
 * booking của carrier (FedEx/DHL). `value` là chuỗi copy vào clipboard;
 * `display` (tuỳ chọn) là chuỗi hiển thị nếu khác value.
 */
export function CopyField({ label, value, display, mono }: {
  label: string;
  value: string | null | undefined;
  display?: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const has = value != null && String(value).trim() !== '';

  const copy = async () => {
    if (!has) return;
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard bị chặn → im lặng */ }
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`truncate text-sm font-medium ${mono ? 'font-mono tabular-nums' : ''} ${!has ? 'text-muted-foreground' : ''}`} title={has ? (display ?? String(value)) : undefined}>
          {has ? (display ?? String(value)) : '—'}
        </div>
      </div>
      {has && (
        <button type="button" onClick={copy} title={copied ? 'Đã copy' : `Copy ${label}`} aria-label={`Copy ${label}`}
          className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
          {copied ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-3.5" />}
        </button>
      )}
    </div>
  );
}
