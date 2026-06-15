'use client';

import { useState, useTransition } from 'react';
import { Power, Pause, Archive, Check, Loader2 } from 'lucide-react';
import type { BrandStatus } from '@/features/mmp/brand-actions';

const META: Record<BrandStatus, { label: string; cls: string }> = {
  active: { label: 'Đang hợp tác', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  deactive: { label: 'Tạm dừng', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  archived: { label: 'Đã ngừng hợp tác', cls: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400' },
};

const CONFIRM: Record<BrandStatus, string> = {
  active: 'Kích hoạt lại brand này? (sản phẩm giữ nguyên, bạn tự duyệt lại)',
  deactive: 'Tạm dừng brand này? Toàn bộ sản phẩm đang ACTIVE sẽ chuyển về DRAFT.',
  archived: 'Ngừng hợp tác hẳn? TOÀN BỘ sản phẩm của brand sẽ chuyển về ARCHIVED.',
};

interface Props {
  status: BrandStatus;
  canManage: boolean;
  setStatusAction: (status: BrandStatus) => Promise<void>;
}

export function BrandStatusControl({ status, canManage, setStatusAction }: Props) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const cur = META[status];

  const change = (s: BrandStatus) => {
    if (!window.confirm(CONFIRM[s])) return;
    setOpen(false);
    start(async () => { await setStatusAction(s); });
  };

  if (!canManage) {
    return <span className={'rounded px-2 py-0.5 text-xs font-medium ' + cur.cls}>{cur.label}</span>;
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ' + cur.cls}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Power className="size-3.5" />}
        {cur.label} ▾
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-56 rounded-lg border border-border bg-popover shadow-lg p-1 text-sm">
          <Item icon={<Power className="size-4 text-emerald-600" />} label="Đang hợp tác" desc="Kích hoạt brand" active={status === 'active'} onClick={() => change('active')} />
          <Item icon={<Pause className="size-4 text-amber-600" />} label="Tạm dừng" desc="Sp active → draft" active={status === 'deactive'} onClick={() => change('deactive')} />
          <Item icon={<Archive className="size-4 text-zinc-500" />} label="Ngừng hợp tác" desc="Toàn bộ sp → archived" active={status === 'archived'} onClick={() => change('archived')} />
        </div>
      )}
    </div>
  );
}

function Item({ icon, label, desc, active, onClick }: { icon: React.ReactNode; label: string; desc: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left hover:bg-muted">
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{desc}</span>
      </span>
      {active && <Check className="size-4 text-foreground" />}
    </button>
  );
}
