'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  uploadPartnerContract, getContractDownloadUrl, deletePartnerContract,
  type PartnerContract,
} from '@/features/ship-ho/contract-actions';
import { contractStatus, validateContractFile, type ContractState } from '@/features/ship-ho/contract-status';
import { contractTypeLabel } from '@/features/ship-ho/contract-inbound';

const STATE_STYLE: Record<ContractState, string> = {
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  expiring_soon: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  expired: 'bg-red-500/15 text-red-700 dark:text-red-400',
  no_expiry: 'bg-muted text-muted-foreground',
  not_yet: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
};

const mb = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const vnDate = (s: string | null) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('vi-VN') : '—');

export function ContractsView({ brandSlug, contracts, canManage }: {
  brandSlug: string;
  contracts: PartnerContract[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const submit = (formEl: HTMLFormElement) => {
    const fd = new FormData(formEl);
    const file = fd.get('file');
    if (!(file instanceof File) || !file.size) { setErr('Chưa chọn file'); return; }
    const invalid = validateContractFile({ name: file.name, type: file.type, size: file.size });
    if (invalid) { setErr(invalid); return; }
    fd.set('brandSlug', brandSlug);
    start(async () => {
      setErr(null);
      const r = await uploadPartnerContract(fd);
      if (!r.ok) { setErr(r.error ?? 'Lỗi upload'); return; }
      setOpen(false);
      formEl.reset();
      router.refresh();
    });
  };

  const download = (id: string) => {
    setBusyId(id);
    start(async () => {
      const r = await getContractDownloadUrl(id);
      setBusyId(null);
      if (!r.ok || !r.url) { setErr(r.error ?? 'Không tạo được link tải'); return; }
      window.open(r.url, '_blank', 'noopener,noreferrer');
    });
  };

  const remove = (id: string, title: string) => {
    if (!window.confirm(`Xoá hợp đồng "${title}"? Bản ghi sẽ biến mất khỏi danh sách.`)) return;
    setBusyId(id);
    start(async () => {
      const r = await deletePartnerContract(id);
      setBusyId(null);
      if (!r.ok) { setErr(r.error ?? 'Lỗi xoá'); return; }
      router.refresh();
    });
  };

  const input = 'w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Hợp đồng ship hộ / fulfillment MMP soạn với đối tác. Giữ đủ bản gốc, phụ lục và gia hạn — bản mới không xoá bản cũ.
        </p>
        {canManage && <Button size="sm" onClick={() => { setOpen(true); setErr(null); }}>＋ Thêm hợp đồng</Button>}
      </div>

      {err && !open && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

      {contracts.length === 0 ? (
        <div className="rounded border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Chưa có hợp đồng nào cho đối tác này.
          {canManage && <> Bấm “＋ Thêm hợp đồng” để tải file MMP gửi sang.</>}
        </div>
      ) : (
        <div className="border rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="[&>th]:p-2 [&>th]:text-left [&>th]:whitespace-nowrap">
                <th>Hợp đồng</th>
                <th>Ngày ký</th>
                <th>Hết hạn</th>
                <th>Hiệu lực</th>
                <th>File</th>
                <th className="text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => {
                const st = contractStatus(c);
                return (
                  <tr key={c.id} className="border-b [&>td]:p-2 align-top">
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{c.title}</span>
                        {c.source === 'mmp_push' && (
                          <span className="rounded bg-sky-500/15 px-1.5 py-px text-[10px] font-medium text-sky-700 dark:text-sky-400"
                            title="MMP tự đẩy sang qua API">MMP gửi</span>
                        )}
                        {c.contractType && (
                          <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{contractTypeLabel(c.contractType)}</span>
                        )}
                      </div>
                      {c.note && <div className="text-xs text-muted-foreground">{c.note}</div>}
                      <div className="text-[11px] text-muted-foreground">
                        Tải lên {new Date(c.uploadedAt).toLocaleDateString('vi-VN')}
                        {c.version && <> · bản <code className="font-mono">{c.version}</code></>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">{vnDate(c.signedAt)}</td>
                    <td className="whitespace-nowrap">{vnDate(c.expiresAt)}</td>
                    <td>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATE_STYLE[st.state]}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      <div className="max-w-[220px] truncate" title={c.filename}>{c.filename}</div>
                      <div>{mb(c.byteSize)}</div>
                    </td>
                    <td className="text-right whitespace-nowrap space-x-2">
                      <button type="button" disabled={pending && busyId === c.id} onClick={() => download(c.id)}
                        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium transition hover:bg-muted disabled:opacity-50">
                        {pending && busyId === c.id ? '…' : '⤓ Tải'}
                      </button>
                      {canManage && (
                        <button type="button" disabled={pending && busyId === c.id} onClick={() => remove(c.id, c.title)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400">
                          Xoá
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Thêm hợp đồng">
          <div className="absolute inset-0 bg-black/50" onClick={() => !pending && setOpen(false)} />
          <form
            className="relative w-full max-w-md space-y-3 rounded-lg border border-border bg-background p-5 shadow-xl"
            onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget); }}
          >
            <div>
              <div className="text-base font-semibold">Thêm hợp đồng · {brandSlug}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">PDF, Word hoặc ảnh scan, tối đa 25 MB.</p>
            </div>
            <label className="block text-xs text-muted-foreground">Tên hợp đồng
              <input name="title" className={`${input} mt-1`} placeholder="VD: Hợp đồng fulfillment 2026 (bản gốc)" />
            </label>
            <label className="block text-xs text-muted-foreground">File hợp đồng *
              <input name="file" type="file" required accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                className={`${input} mt-1 file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs`} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-muted-foreground">Ngày ký
                <input name="signedAt" type="date" className={`${input} mt-1`} />
              </label>
              <label className="block text-xs text-muted-foreground">Ngày hết hạn
                <input name="expiresAt" type="date" className={`${input} mt-1`} />
              </label>
            </div>
            <label className="block text-xs text-muted-foreground">Ghi chú
              <input name="note" className={`${input} mt-1`} placeholder="VD: phụ lục điều chỉnh giá tháng 8" />
            </label>
            {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={pending} onClick={() => setOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50">
                Hủy
              </button>
              <button type="submit" disabled={pending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
                {pending ? 'Đang tải lên…' : 'Lưu hợp đồng'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
