'use client';

import { useState, useTransition } from 'react';
import { utils, writeFile } from 'xlsx';
import { generateStatement, setStatementStatus } from '@/features/ship-ho/statement-actions';
import { fetchStatementForExport } from '@/features/ship-ho/statement-export-action';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const vnd = (v: string | number | null) => (v == null ? '—' : Number(v).toLocaleString('vi-VN') + ' ₫');

interface Statement {
  id: string; partnerBrandSlug: string; brandName: string | null;
  periodStart: string; periodEnd: string; orderCount: number; totalChargedVnd: string;
  status: string; issuedAt: Date | null; paidAt: Date | null;
}
interface Ar { partnerBrandSlug: string; brandName: string | null; outstandingVnd: string }
interface Margin { partnerBrandSlug: string; brandName: string | null; orderCount: number; totalMarginVnd: string }
interface PartnerOpt { slug: string; name: string }

export function StatementsManager({ statements, ar, margin, partners, canManage }: {
  statements: Statement[]; ar: Ar[]; margin: Margin[]; partners: PartnerOpt[]; canManage: boolean;
}) {
  const [pending, start] = useTransition();
  const [partner, setPartner] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const gen = (dryRun: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await generateStatement(partner, from, to, { dryRun });
      if (!r.ok) { setMsg(r.error ?? 'Lỗi'); return; }
      setMsg(`${dryRun ? 'Xem trước' : 'Đã tạo bảng kê'}: ${r.orderCount} đơn · ${Number(r.totalChargedVnd).toLocaleString('vi-VN')} ₫`);
    });

  const mark = (id: string, status: 'issued' | 'paid') =>
    start(async () => { await setStatementStatus(id, status); });

  const exportXlsx = (id: string, label: string) =>
    start(async () => {
      const data = await fetchStatementForExport(id);
      if (!data) return;
      const rows = data.orders.map((o) => ({
        'Mã đơn': o.code, 'Nước': o.country,
        'Giá thu (VND)': o.chargedVnd == null ? '' : Number(o.chargedVnd),
        'Cước thực (VND)': o.actualCarrierCostVnd == null ? '' : Number(o.actualCarrierCostVnd),
        'Margin (VND)': o.marginVnd == null ? '' : Number(o.marginVnd),
      }));
      const ws = utils.json_to_sheet(rows);
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, 'Bảng kê');
      writeFile(wb, `bang-ke-${label}.xlsx`);
    });

  return (
    <div className="space-y-6">
      {canManage && (
        <Card><CardContent className="p-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">Partner
            <select className="block border rounded px-2 py-1 mt-1" value={partner} onChange={(e) => setPartner(e.target.value)}>
              <option value="">— chọn —</option>
              {partners.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
            </select>
          </label>
          <label className="text-sm">Từ<input type="date" className="block border rounded px-2 py-1 mt-1" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-sm">Đến<input type="date" className="block border rounded px-2 py-1 mt-1" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <Button variant="outline" onClick={() => gen(true)} disabled={pending || !partner || !from || !to}>Xem trước</Button>
          <Button onClick={() => gen(false)} disabled={pending || !partner || !from || !to}>Tạo bảng kê</Button>
          {msg && <span className="text-sm">{msg}</span>}
        </CardContent></Card>
      )}

      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Công nợ (đã gửi chưa thu)</div>
        <Card><CardContent className="p-0">
          <table className="w-full text-sm"><tbody>
            {ar.length === 0 ? <tr><td className="p-3 text-muted-foreground">Không có công nợ.</td></tr>
              : ar.map((a) => <tr key={a.partnerBrandSlug} className="border-b [&>td]:p-3"><td>{a.brandName ?? a.partnerBrandSlug}</td><td className="text-right font-medium">{vnd(a.outstandingVnd)}</td></tr>)}
          </tbody></table>
        </CardContent></Card>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Margin theo partner</div>
        <Card><CardContent className="p-0">
          <table className="w-full text-sm"><tbody>
            {margin.map((m) => <tr key={m.partnerBrandSlug} className="border-b [&>td]:p-3"><td>{m.brandName ?? m.partnerBrandSlug}</td><td className="text-muted-foreground">{m.orderCount} đơn</td><td className="text-right font-medium">{vnd(m.totalMarginVnd)}</td></tr>)}
            {margin.length === 0 && <tr><td className="p-3 text-muted-foreground">Chưa có đơn đối soát.</td></tr>}
          </tbody></table>
        </CardContent></Card>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Bảng kê</div>
        <Card><CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-muted-foreground"><tr className="[&>th]:text-left [&>th]:p-3"><th>Partner</th><th>Kỳ</th><th>Đơn</th><th>Tổng thu</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.id} className="border-b [&>td]:p-3">
                  <td>{s.brandName ?? s.partnerBrandSlug}</td>
                  <td>{s.periodStart} → {s.periodEnd}</td>
                  <td>{s.orderCount}</td>
                  <td className="font-medium">{vnd(s.totalChargedVnd)}</td>
                  <td>{s.status === 'draft' ? 'Nháp' : s.status === 'issued' ? 'Đã gửi' : 'Đã thu'}</td>
                  <td className="text-right space-x-1">
                    <Button variant="outline" size="sm" onClick={() => exportXlsx(s.id, `${s.partnerBrandSlug}-${s.periodStart}`)} disabled={pending}>Xuất</Button>
                    {canManage && s.status === 'draft' && <Button variant="outline" size="sm" onClick={() => mark(s.id, 'issued')} disabled={pending}>Gửi</Button>}
                    {canManage && s.status === 'issued' && <Button size="sm" onClick={() => mark(s.id, 'paid')} disabled={pending}>Đã thu</Button>}
                  </td>
                </tr>
              ))}
              {statements.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Chưa có bảng kê.</td></tr>}
            </tbody>
          </table>
        </CardContent></Card>
      </div>
    </div>
  );
}
