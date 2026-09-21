'use client';

import { useState, useTransition } from 'react';
import { utils, writeFile } from 'xlsx';
import { generateStatement, setStatementStatus, recomputeDraftStatement } from '@/features/ship-ho/statement-actions';
import { fetchStatementForExport, isDutyStatementExport } from '@/features/ship-ho/statement-export-action';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const vnd = (v: string | number | null) => (v == null ? '—' : Number(v).toLocaleString('vi-VN') + ' ₫');

interface Statement {
  id: string; partnerBrandSlug: string; brandName: string | null; type: 'freight' | 'duty';
  periodStart: string; periodEnd: string; orderCount: number; totalChargedVnd: string;
  status: string; issuedAt: Date | null; paidAt: Date | null;
}
interface Ar { partnerBrandSlug: string; brandName: string | null; type: 'freight' | 'duty'; outstandingVnd: string }
interface Margin { partnerBrandSlug: string; brandName: string | null; orderCount: number; totalMarginVnd: string }
interface PartnerOpt { slug: string; name: string }

export function StatementsManager({ statements, ar, margin, partners, canManage }: {
  statements: Statement[]; ar: Ar[]; margin: Margin[]; partners: PartnerOpt[]; canManage: boolean;
}) {
  const [pending, start] = useTransition();
  const [partner, setPartner] = useState('');
  const [loai, setLoai] = useState<'freight' | 'duty'>('freight');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const gen = (dryRun: boolean) =>
    start(async () => {
      setMsg(null);
      const r = await generateStatement(partner, loai, from, to, { dryRun });
      if (!r.ok) { setMsg(r.error ?? 'Lỗi'); return; }
      setMsg(`${dryRun ? 'Xem trước' : 'Đã tạo bảng kê'}: ${r.orderCount} đơn · ${Number(r.totalChargedVnd).toLocaleString('vi-VN')} ₫${loai === 'freight' ? ` · ${r.choHoaDon} đơn chờ hoá đơn` : ''}`);
    });

  const mark = (id: string, status: 'issued' | 'paid') =>
    start(async () => {
      setMsg(null);
      const r = await setStatementStatus(id, status);
      if (!r.ok) setMsg(r.error ?? 'Lỗi cập nhật trạng thái');
    });

  const tinhLai = (id: string) =>
    start(async () => {
      setMsg(null);
      const r = await recomputeDraftStatement(id);
      if (!r.ok) { setMsg(r.error ?? 'Lỗi tính lại'); return; }
      setMsg(`Đã tính lại: ${r.orderCount} đơn · ${(r.truoc ?? 0).toLocaleString('vi-VN')} → ${r.totalChargedVnd.toLocaleString('vi-VN')} ₫ (đơn đã có bill thu theo giá thực)`);
    });

  const exportXlsx = (id: string, label: string) =>
    start(async () => {
      const data = await fetchStatementForExport(id);
      if (!data) return;
      const wb = utils.book_new();
      // isDutyStatementExport narrows on `data` itself (TS can't narrow via the
      // nested `data.statement.type` discriminant alone) — see statement-export-action.ts.
      if (isDutyStatementExport(data)) {
        const rows = data.orders.map((o) => ({
          'Mã đơn brand': o.brandReference ?? '', 'Mã hệ thống': o.code, 'Mã vận đơn': o.trackingNumber ?? '', 'Ngày gửi': o.shippedAt ?? '',
          'Số hoá đơn FedEx': o.billNumber ?? '', 'Ngày hoá đơn': o.issueDate ?? '', 'Thuế/phí NK thu hộ (VND)': o.giaThuVnd,
        }));
        utils.book_append_sheet(wb, utils.json_to_sheet(rows), 'Thuế-phí thu hộ');
      } else {
        const rows = data.orders.map((o) => ({
          'Mã đơn brand': o.brandReference ?? '', 'Mã hệ thống': o.code, 'Mã vận đơn': o.trackingNumber ?? '', 'Ngày gửi': o.shippedAt ?? '', 'Nước': o.country,
          'Cước thu (VND)': o.giaThuVnd ?? '', 'Giá báo (VND)': o.chargedVnd == null ? '' : Number(o.chargedVnd),
        }));
        utils.book_append_sheet(wb, utils.json_to_sheet(rows), 'Cước');
        if (data.choHoaDon.length) {
          utils.book_append_sheet(wb, utils.json_to_sheet(data.choHoaDon.map((o) => ({
            'Mã đơn brand': o.brandReference ?? '', 'Mã hệ thống': o.code, 'Ngày gửi': o.shippedAt ?? '', 'Giá báo tham khảo (VND)': o.chargedVnd == null ? '' : Number(o.chargedVnd), 'Ghi chú': 'Chờ hoá đơn FedEx — thu ở kỳ sau',
          }))), 'Chờ hoá đơn');
        }
      }
      writeFile(wb, `bang-ke-${data.statement.type === 'duty' ? 'thue-phi' : 'cuoc'}-${label}.xlsx`);
    });

  const arGrouped = (() => {
    const m = new Map<string, { brandName: string | null; freight: number; duty: number }>();
    for (const a of ar) {
      const cur = m.get(a.partnerBrandSlug) ?? { brandName: a.brandName, freight: 0, duty: 0 };
      if (a.type === 'duty') cur.duty += Number(a.outstandingVnd); else cur.freight += Number(a.outstandingVnd);
      m.set(a.partnerBrandSlug, cur);
    }
    return Array.from(m, ([partnerBrandSlug, v]) => ({ partnerBrandSlug, ...v, total: v.freight + v.duty }));
  })();

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
          <label className="text-sm">Loại
            <select className="block border rounded px-2 py-1 mt-1" value={loai} onChange={(e) => setLoai(e.target.value as 'freight' | 'duty')}>
              <option value="freight">Cước vận chuyển (kỳ theo ngày gửi)</option>
              <option value="duty">Thuế/phí nhập khẩu thu hộ (kỳ theo ngày hoá đơn FedEx)</option>
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
            {arGrouped.length === 0 ? <tr><td className="p-3 text-muted-foreground">Không có công nợ.</td></tr>
              : arGrouped.map((a) => (
                <tr key={a.partnerBrandSlug} className="border-b [&>td]:p-3">
                  <td>{a.brandName ?? a.partnerBrandSlug}</td>
                  <td className="text-right font-medium">{vnd(a.total)} <span className="text-muted-foreground font-normal">(cước {vnd(a.freight)} · thuế-phí {vnd(a.duty)})</span></td>
                </tr>
              ))}
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
            <thead className="border-b text-muted-foreground"><tr className="[&>th]:text-left [&>th]:p-3"><th>Partner</th><th>Loại</th><th>Kỳ</th><th>Đơn</th><th title="Chỉ đơn đã chốt đối soát (CEO 21/09)">Tổng thu</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.id} className="border-b [&>td]:p-3">
                  <td>{s.brandName ?? s.partnerBrandSlug}</td>
                  <td>{s.type === 'duty' ? 'Thuế-phí' : 'Cước'}</td>
                  <td title={s.type === 'duty' ? 'Kỳ theo ngày hoá đơn FedEx' : 'Kỳ theo ngày gửi'}>{s.periodStart} → {s.periodEnd}</td>
                  <td>{s.orderCount}</td>
                  <td className="font-medium">{vnd(s.totalChargedVnd)}</td>
                  <td>{s.status === 'draft' ? 'Nháp' : s.status === 'issued' ? 'Đã gửi' : 'Đã thu'}</td>
                  <td className="text-right space-x-1">
                    <Button variant="outline" size="sm" onClick={() => exportXlsx(s.id, `${s.partnerBrandSlug}-${s.periodStart}`)} disabled={pending}>Xuất</Button>
                    {canManage && s.status === 'draft' && <Button variant="outline" size="sm" title="Cập nhật tổng theo giá thực của các đơn đã có bill (bill về sau khi tạo kê)" onClick={() => tinhLai(s.id)} disabled={pending}>Tính lại</Button>}
                    {canManage && s.status === 'draft' && <Button variant="outline" size="sm" onClick={() => mark(s.id, 'issued')} disabled={pending}>Gửi</Button>}
                    {canManage && s.status === 'issued' && <Button size="sm" onClick={() => mark(s.id, 'paid')} disabled={pending}>Đã thu</Button>}
                  </td>
                </tr>
              ))}
              {statements.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Chưa có bảng kê.</td></tr>}
            </tbody>
          </table>
        </CardContent></Card>
      </div>
    </div>
  );
}
