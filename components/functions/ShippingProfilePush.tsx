'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { ProfileInfo, ProfilePushResult } from '@/features/settings-sync/shipping-profiles-actions';

interface Props {
  storeId: string;
  storeName: string;
  onList: (storeId: string) => Promise<ProfileInfo[]>;
  onPreview: (storeId: string, profileIds: string[]) => Promise<ProfilePushResult[]>;
  onApply: (storeId: string, profileIds: string[]) => Promise<ProfilePushResult[]>;
}

/** Đẩy bảng giá ship lên các delivery profile được CHỌN (giá giống nhau).
 *  Profile không chọn không bị đụng. Có dry-run trước khi ghi thật. */
export function ShippingProfilePush({ storeId, storeName, onList, onPreview, onApply }: Props) {
  const [profiles, setProfiles] = useState<ProfileInfo[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ProfilePushResult[] | null>(null);
  const [applied, setApplied] = useState<ProfilePushResult[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function loadProfiles() {
    setBusy(true); setErr(null);
    try {
      const p = await onList(storeId);
      setProfiles(p);
      setSelected(new Set(p.map((x) => x.profileId))); // mặc định chọn tất cả
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  }

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  return (
    <Dialog onOpenChange={(o) => { if (o && !profiles) loadProfiles(); else if (!o) { setPreview(null); setApplied(null); setConfirm(false); } }}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/60 bg-amber-500/5 px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-500/10">
        ⚡ Đẩy giá ship lên Shopify
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Đẩy bảng giá ship lên profile — {storeName}</DialogTitle>
        </DialogHeader>

        {err && <div className="rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400">{err}</div>}

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Chọn delivery profile để đẩy cùng một bảng giá. Profile không chọn giữ nguyên.</p>

          {busy && !profiles ? <p className="text-sm text-muted-foreground">Đang tải profile…</p> : (
            <div className="space-y-1.5">
              {(profiles ?? []).map((p) => (
                <label key={p.profileId} className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm">
                  <input type="checkbox" checked={selected.has(p.profileId)} onChange={() => toggle(p.profileId)} />
                  <span className="font-medium">{p.name}</span>
                  {p.isDefault && <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">DEFAULT</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{p.zoneCount} zone hiện tại</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || selected.size === 0}
              onClick={async () => { setBusy(true); setErr(null); setApplied(null); try { setPreview(await onPreview(storeId, [...selected])); } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); } }}
              className="rounded border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50">
              {busy ? 'Đang chạy…' : 'Dry-run (xem trước)'}
            </button>
          </div>

          {preview && (
            <div className="space-y-1 rounded border border-border p-3 text-sm">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Sẽ thay đổi:</div>
              {preview.map((r) => (
                <div key={r.profileId}>• <strong>{r.name}</strong>: tạo {r.zonesToCreate} zone, xoá {r.zonesToDelete}{r.rateOps ? `, ${r.rateOps} rate` : ''}</div>
              ))}
              {!confirm ? (
                <button type="button" onClick={() => setConfirm(true)}
                  className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Apply lên {selected.size} profile</button>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-amber-700 dark:text-amber-400">⚠ Ghi thật lên Shopify. Xác nhận?</span>
                  <button type="button" disabled={busy}
                    onClick={async () => { setBusy(true); setErr(null); try { setApplied(await onApply(storeId, [...selected])); } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); setConfirm(false); } }}
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? 'Đang apply…' : 'Xác nhận apply'}</button>
                  <button type="button" onClick={() => setConfirm(false)} className="rounded border px-3 py-2 text-sm">Huỷ</button>
                </div>
              )}
            </div>
          )}

          {applied && (
            <div className="space-y-1 rounded border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
              <div className="font-medium text-emerald-700 dark:text-emerald-400">✓ Đã apply</div>
              {applied.map((r) => (
                <div key={r.profileId}>• {r.name}: {r.error ? <span className="text-red-600 dark:text-red-400">LỖI {r.error}</span> : `OK (tạo ${r.zonesToCreate}, xoá ${r.zonesToDelete})`}</div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
