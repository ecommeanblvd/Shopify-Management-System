'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

interface Props {
  billId: string;
  outstanding: number;
  currency: string;
  addPaymentAction: (formData: FormData) => Promise<void>;
}

/** Modal to record a (partial) payment against a bill, with a proof file. */
export function AddPaymentDialog({ billId, outstanding, currency, addPaymentAction }: Props) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted whitespace-nowrap">
        <Plus className="size-3.5" /> Thanh toán
      </DialogTrigger>
      <DialogContent className="w-[92vw] max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Ghi nhận thanh toán</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => { await addPaymentAction(fd); setOpen(false); }}
          className="space-y-3"
        >
          <input type="hidden" name="billId" value={billId} />
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Số tiền * <span className="normal-case text-muted-foreground">(còn nợ: {Math.round(outstanding).toLocaleString('vi-VN')} {currency})</span>
            </Label>
            <Input name="amount" required inputMode="numeric" defaultValue={outstanding > 0 ? String(Math.round(outstanding)) : ''} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Ngày trả *</Label>
              <Input name="paidAt" type="date" required defaultValue={today} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Hình thức</Label>
              <Input name="method" placeholder="Chuyển khoản…" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Bằng chứng (file)</Label>
            <Input name="proof" type="file" accept=".pdf,.png,.jpg,.jpeg" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Ghi chú</Label>
            <Input name="note" placeholder="—" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Huỷ</Button>
            <Button type="submit" size="sm">Lưu</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
