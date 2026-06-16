'use client';

import { useState } from 'react';
import { Plus, Upload, Wand2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { parseDhlInvoiceCsv } from '@/features/carrier-rates/ap/dhl-invoice-csv';

interface Props {
  createBillAction: (formData: FormData) => Promise<void>;
  /** Tiền tệ của tài khoản — để cảnh báo nếu file lệch tiền tệ. */
  accountCurrency?: string;
}

const EMPTY = { billNumber: '', amount: '', periodStart: '', periodEnd: '', issueDate: '', dueDate: '', note: '' };

/** Nút "Thêm hoá đơn" → modal upload. Chọn file CSV hoá đơn DHL sẽ TỰ ĐIỀN các
 *  trường (mã, số tiền gồm VAT, kỳ theo shipment, hạn = ngày xuất + 30); người
 *  dùng vẫn sửa được trước khi lưu. File vẫn được đính kèm vào hoá đơn. */
export function AddBillDialog({ createBillAction, accountCurrency }: Props) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ ...EMPTY });
  const [filled, setFilled] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  function reset() { setV({ ...EMPTY }); setFilled(false); setWarn(null); }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setFilled(false); setWarn(null);
    if (!f || !/\.csv$/i.test(f.name)) return; // chỉ tự điền từ CSV DHL
    try {
      const p = parseDhlInvoiceCsv(await f.text());
      if (!p) { setWarn('Không đọc được file CSV này (không đúng định dạng hoá đơn DHL).'); return; }
      setV({
        billNumber: p.billNumber,
        amount: p.amountInclVat ? String(p.amountInclVat) : '',
        periodStart: p.periodStart, periodEnd: p.periodEnd,
        issueDate: p.issueDate, dueDate: p.dueDate, note: p.note,
      });
      setFilled(true);
      if (accountCurrency && p.currency && p.currency !== accountCurrency) {
        setWarn(`File là ${p.currency} nhưng tài khoản là ${accountCurrency} — kiểm tra lại số tiền.`);
      }
    } catch { setWarn('Lỗi đọc file.'); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
        <Plus className="size-4" /> Thêm hoá đơn
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-2xl">
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
                <Wand2 className="size-3.5" /> Đã tự điền từ file DHL — kiểm tra rồi lưu.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Chọn file CSV hoá đơn DHL để tự điền các trường bên dưới (PDF/ảnh thì đính kèm, nhập tay).
              </p>
            )}
            {warn && <p className="text-[11px] text-amber-600 dark:text-amber-400">⚠ {warn}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Mã hoá đơn"><Input name="billNumber" placeholder="INV-..." value={v.billNumber} onChange={set('billNumber')} /></Field>
            <Field label="Số tiền (gồm VAT) *"><Input name="amount" required inputMode="numeric" placeholder="0" value={v.amount} onChange={set('amount')} /></Field>
            <Field label="Kỳ từ *"><Input name="periodStart" type="date" required value={v.periodStart} onChange={set('periodStart')} /></Field>
            <Field label="Kỳ đến *"><Input name="periodEnd" type="date" required value={v.periodEnd} onChange={set('periodEnd')} /></Field>
            <Field label="Ngày xuất"><Input name="issueDate" type="date" value={v.issueDate} onChange={set('issueDate')} /></Field>
            <Field label="Hạn thanh toán"><Input name="dueDate" type="date" value={v.dueDate} onChange={set('dueDate')} /></Field>
            <div className="col-span-2"><Field label="Ghi chú"><Input name="note" placeholder="—" value={v.note} onChange={set('note')} /></Field></div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Huỷ</Button>
            <Button type="submit" size="sm">Lưu hoá đơn</Button>
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
