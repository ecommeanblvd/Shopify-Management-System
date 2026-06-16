'use client';

import { useState } from 'react';
import { Plus, Upload, Wand2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { parseDhlInvoiceCsv, dhlShipmentToBillLine, type DhlShipment } from '@/features/carrier-rates/ap/dhl-invoice-csv';

interface Props {
  createBillAction: (formData: FormData) => Promise<void>;
  /** Tiền tệ của tài khoản — để cảnh báo nếu file lệch tiền tệ. */
  accountCurrency?: string;
}

const EMPTY = { billNumber: '', amount: '', periodStart: '', periodEnd: '', issueDate: '', dueDate: '', note: '' };
const fmt = (n: number) => Math.round(n).toLocaleString('vi-VN');

/** Nút "Thêm hoá đơn" → modal upload. Chọn file CSV hoá đơn DHL sẽ TỰ ĐIỀN các
 *  trường tổng + HIỆN BẢNG breakdown từng shipment theo billed của DHL; lưu kèm
 *  các dòng đó. Người dùng vẫn sửa được trước khi lưu; file vẫn được đính kèm. */
export function AddBillDialog({ createBillAction, accountCurrency }: Props) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ ...EMPTY });
  const [shipments, setShipments] = useState<DhlShipment[]>([]);
  const [filled, setFilled] = useState(false);
  const [manual, setManual] = useState(false); // hiện ô nhập tay (PDF/ảnh/tự gõ)
  const [warn, setWarn] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  function reset() { setV({ ...EMPTY }); setShipments([]); setFilled(false); setManual(false); setWarn(null); }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setFilled(false); setWarn(null); setShipments([]);
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) { setManual(true); return; } // PDF/ảnh → nhập tay
    try {
      const p = parseDhlInvoiceCsv(await f.text());
      if (!p) { setWarn('Không đọc được file CSV này (không đúng định dạng hoá đơn DHL).'); return; }
      setV({
        billNumber: p.billNumber,
        amount: p.amountInclVat ? String(p.amountInclVat) : '',
        periodStart: p.periodStart, periodEnd: p.periodEnd,
        issueDate: p.issueDate, dueDate: p.dueDate, note: p.note,
      });
      setShipments(p.shipments);
      setFilled(true); setManual(false);
      if (accountCurrency && p.currency && p.currency !== accountCurrency) {
        setWarn(`File là ${p.currency} nhưng tài khoản là ${accountCurrency} — kiểm tra lại số tiền.`);
      }
    } catch { setWarn('Lỗi đọc file.'); }
  }

  const grandTotal = shipments.reduce((a, s) => a + s.totalInclVat, 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
        <Plus className="size-4" /> Thêm hoá đơn
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[88vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Thêm hoá đơn carrier</DialogTitle>
        </DialogHeader>
        <form action={async (fd) => { await createBillAction(fd); setOpen(false); reset(); }} className="space-y-4">
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 space-y-2">
            <Label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Upload className="size-3.5" /> File hoá đơn (CSV DHL / PDF / Excel)
            </Label>
            <Input name="file" type="file" accept=".csv,.pdf,.xlsx,.xls,.png,.jpg,.jpeg" onChange={onFile} />
            {filled ? (
              <p className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                <Wand2 className="size-3.5" /> Đã tự điền + đọc {shipments.length} shipment từ file DHL — kiểm tra rồi lưu.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Chọn file CSV hoá đơn DHL — tự điền hết, chỉ cần kiểm tra ngày rồi lưu.
              </p>
            )}
            {warn && <p className="text-[11px] text-amber-600 dark:text-amber-400">⚠ {warn}</p>}
            {!filled && !manual && (
              <button type="button" onClick={() => setManual(true)}
                className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
                hoặc nhập tay (không có file CSV)
              </button>
            )}
          </div>

          {filled ? (
            /* Chế độ CSV: tự điền hết, chỉ cho sửa NGÀY. Mã/số tiền/ghi chú đọc-only (gửi ngầm). */
            <div className="space-y-3">
              <input type="hidden" name="billNumber" value={v.billNumber} />
              <input type="hidden" name="amount" value={v.amount} />
              <input type="hidden" name="note" value={v.note} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
                <span><span className="text-muted-foreground">Mã:</span> <b>{v.billNumber || '—'}</b></span>
                <span><span className="text-muted-foreground">Số tiền:</span> <b>{v.amount ? fmt(Number(v.amount)) : '—'}</b></span>
                {v.note && <span className="text-muted-foreground">· {v.note}</span>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Kỳ từ *"><Input name="periodStart" type="date" required value={v.periodStart} onChange={set('periodStart')} /></Field>
                <Field label="Kỳ đến *"><Input name="periodEnd" type="date" required value={v.periodEnd} onChange={set('periodEnd')} /></Field>
                <Field label="Ngày xuất"><Input name="issueDate" type="date" value={v.issueDate} onChange={set('issueDate')} /></Field>
                <Field label="Hạn thanh toán"><Input name="dueDate" type="date" value={v.dueDate} onChange={set('dueDate')} /></Field>
              </div>
            </div>
          ) : manual ? (
            /* Chế độ nhập tay (PDF/ảnh/không file): đủ ô. */
            <div className="grid grid-cols-2 gap-4">
              <Field label="Mã hoá đơn"><Input name="billNumber" placeholder="INV-..." value={v.billNumber} onChange={set('billNumber')} /></Field>
              <Field label="Số tiền (gồm VAT) *"><Input name="amount" required inputMode="numeric" placeholder="0" value={v.amount} onChange={set('amount')} /></Field>
              <Field label="Kỳ từ *"><Input name="periodStart" type="date" required value={v.periodStart} onChange={set('periodStart')} /></Field>
              <Field label="Kỳ đến *"><Input name="periodEnd" type="date" required value={v.periodEnd} onChange={set('periodEnd')} /></Field>
              <Field label="Ngày xuất"><Input name="issueDate" type="date" value={v.issueDate} onChange={set('issueDate')} /></Field>
              <Field label="Hạn thanh toán"><Input name="dueDate" type="date" value={v.dueDate} onChange={set('dueDate')} /></Field>
              <div className="col-span-2"><Field label="Ghi chú"><Input name="note" placeholder="—" value={v.note} onChange={set('note')} /></Field></div>
            </div>
          ) : null}

          {shipments.length > 0 && (
            <div className="space-y-2">
              <input type="hidden" name="linesJson" value={JSON.stringify(shipments.map(dhlShipmentToBillLine))} />
              <div className="flex items-center justify-between">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Chi tiết billed theo DHL ({shipments.length} shipment)</Label>
                <span className="text-[11px] text-muted-foreground">Tổng: <b>{fmt(grandTotal)}</b></span>
              </div>
              <div className="space-y-3 rounded-lg border border-border p-3">
                {shipments.map((s, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="font-medium">{s.orderRef || '(không ref)'}</span>
                      <span className="text-muted-foreground">· {s.shipmentNumber}</span>
                      {s.product && <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{s.product}</span>}
                      {s.weightKg > 0 && <span className="text-muted-foreground">· {s.weightKg} kg</span>}
                      <span className="ml-auto font-semibold">{fmt(s.totalInclVat)}</span>
                    </div>
                    <table className="w-full text-[11px]">
                      <thead className="text-muted-foreground">
                        <tr className="text-left">
                          <th className="font-normal py-0.5">Khoản</th>
                          <th className="font-normal text-right">Charge</th>
                          <th className="font-normal text-right">VAT</th>
                          <th className="font-normal text-right">Tổng</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.charges.map((c, j) => (
                          <tr key={j} className="border-t border-border/50">
                            <td className="py-0.5">{c.name || c.code}{c.code && c.name ? ` (${c.code})` : ''}</td>
                            <td className="text-right tabular-nums">{fmt(c.charge)}</td>
                            <td className="text-right tabular-nums text-muted-foreground">{fmt(c.tax)}</td>
                            <td className="text-right tabular-nums">{fmt(c.total)}</td>
                          </tr>
                        ))}
                        {s.charges.length === 0 && (
                          <tr><td colSpan={4} className="py-0.5 text-muted-foreground">(không có breakdown trong file)</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">Các dòng này sẽ được lưu kèm hoá đơn (xem ở phần breakdown của bill).</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Huỷ</Button>
            {(filled || manual) && <Button type="submit" size="sm">Lưu hoá đơn</Button>}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
