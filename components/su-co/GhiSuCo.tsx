'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { BO_PHAN } from '@/features/to-chuc/bo-phan';
import { GIAI_DOAN, LOAI_CHI_PHI, NGUYEN_NHAN } from '@/features/su-co/phan-loai';
import { ghiSuCo } from '@/features/su-co/actions';
import type { ChiPhiVao } from '@/features/su-co/types';

/** Ngày hôm nay theo định dạng `yyyy-mm-dd` cho input type=date. */
function homNay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Form ghi sự cố mới.
 *
 * Khoản chi phí là DÒNG thêm/bớt được — 100/156 ca thật có hai loại chi phí, nên
 * một ô số tiền duy nhất là sai với đa số ca.
 */
export function GhiSuCo({ onXong }: { onXong: () => void }) {
  const [ngayBao, setNgayBao] = useState(homNay());
  const [nguyenNhan, setNguyenNhan] = useState(NGUYEN_NHAN[0]!.ma);
  const [giaiDoan, setGiaiDoan] = useState<string>('sau_mua');
  const [moTa, setMoTa] = useState('');
  const [boPhanChinh, setBoPhanChinh] = useState('');
  const [maGiamGia, setMaGiamGia] = useState('');
  const [maTicketCs, setMaTicketCs] = useState('');
  const [maDon, setMaDon] = useState('');
  const [chiPhi, setChiPhi] = useState<ChiPhiVao[]>([]);
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function themDong() {
    setChiPhi((cu) => [...cu, { loai: LOAI_CHI_PHI[0]!.ma, soTien: '', tienTe: 'USD', boPhan: null }]);
  }
  function suaDong(i: number, next: Partial<ChiPhiVao>) {
    setChiPhi((cu) => cu.map((c, j) => (j === i ? { ...c, ...next } : c)));
  }

  function gui() {
    start(async () => {
      setLoi(null);
      const r = await ghiSuCo({
        ngayBao, nguyenNhan, giaiDoan: giaiDoan || null,
        moTa: moTa.trim() || null,
        boPhanChinh: boPhanChinh || null,
        maGiamGia: maGiamGia.trim() || null,
        maTicketCs: maTicketCs.trim() || null,
        maDon: maDon.trim() || null,
        chiPhi, anhKeys: [],
      });
      if (!r.ok) { setLoi(r.loi ?? 'Ghi sự cố thất bại.'); return; }
      toast.success(`Đã ghi sự cố ${r.ma}.`, { duration: 3000 });
      onXong();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Ngày báo</span>
          <input
            type="date" value={ngayBao} onChange={(e) => setNgayBao(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Nguyên nhân</span>
          <select
            value={nguyenNhan} onChange={(e) => setNguyenNhan(e.target.value)}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            {NGUYEN_NHAN.map((n) => <option key={n.ma} value={n.ma}>{n.ten}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Giai đoạn</span>
          <select
            value={giaiDoan} onChange={(e) => setGiaiDoan(e.target.value)}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">— chưa rõ —</option>
            {GIAI_DOAN.map((g) => <option key={g.ma} value={g.ma}>{g.ten}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Bộ phận chịu chính</span>
          <select
            value={boPhanChinh} onChange={(e) => setBoPhanChinh(e.target.value)}
            className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">— chưa rõ —</option>
            {BO_PHAN.map((b) => <option key={b.ma} value={b.ma}>{b.ten}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Mã đơn</span>
          <input
            value={maDon} onChange={(e) => setMaDon(e.target.value)}
            placeholder="#MBLVD26597"
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Số ticket Intercom</span>
          <input
            value={maTicketCs} onChange={(e) => setMaTicketCs(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-sm font-medium">Mã giảm giá đã cấp cho khách</span>
          <input
            value={maGiamGia} onChange={(e) => setMaGiamGia(e.target.value)}
            placeholder="Không phải một khoản chi phí — chỉ là mã đã cấp"
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">Diễn biến</span>
        <textarea
          value={moTa} onChange={(e) => setMoTa(e.target.value)} rows={3}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
      </label>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-medium">Khoản chi phí</span>
          <button type="button" onClick={themDong} className="cursor-pointer text-xs underline">
            + thêm khoản
          </button>
        </div>
        {chiPhi.length === 0 ? (
          <p className="rounded-lg border border-border px-3 py-3 text-sm text-muted-foreground">
            Chưa có khoản nào — sự cố không mất tiền thì để trống được.
          </p>
        ) : (
          <ul className="space-y-2">
            {chiPhi.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <select
                  value={c.loai} onChange={(e) => suaDong(i, { loai: e.target.value })}
                  aria-label={`Loại chi phí ${i + 1}`}
                  className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
                >
                  {LOAI_CHI_PHI.map((l) => <option key={l.ma} value={l.ma}>{l.ten}</option>)}
                </select>
                <input
                  value={c.soTien} onChange={(e) => suaDong(i, { soTien: e.target.value })}
                  inputMode="decimal" placeholder="Số tiền" aria-label={`Số tiền ${i + 1}`}
                  className="h-9 w-28 rounded-lg border border-input bg-background px-2.5 text-sm"
                />
                <input
                  value={c.tienTe} onChange={(e) => suaDong(i, { tienTe: e.target.value.toUpperCase() })}
                  maxLength={3} aria-label={`Đơn vị tiền ${i + 1}`}
                  className="h-9 w-16 rounded-lg border border-input bg-background px-2.5 text-sm uppercase"
                />
                <select
                  value={c.boPhan ?? ''} onChange={(e) => suaDong(i, { boPhan: e.target.value || null })}
                  aria-label={`Bộ phận chịu khoản ${i + 1}`}
                  className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
                >
                  <option value="">theo sự cố</option>
                  {BO_PHAN.map((b) => <option key={b.ma} value={b.ma}>{b.ten}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => setChiPhi((cu) => cu.filter((_, j) => j !== i))}
                  className="cursor-pointer text-xs underline"
                >
                  bỏ
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {loi && <p className="text-sm text-red-600 dark:text-red-400">{loi}</p>}

      <div className="flex justify-end">
        <Button type="button" size="lg" onClick={gui} disabled={pending}>
          {pending ? 'Đang ghi…' : 'Ghi sự cố'}
        </Button>
      </div>
    </div>
  );
}
