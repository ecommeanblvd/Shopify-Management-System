'use client';

import { useState } from 'react';
import { Plus, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

interface Props {
  createBillAction: (formData: FormData) => Promise<void>;
}

/** Nút "Thêm hoá đơn" → modal upload. Khi có parser, chọn file sẽ tự điền các
 *  trường (mã, số tiền, kỳ, breakdown); người dùng vẫn sửa được trước khi lưu. */
export function AddBillDialog({ createBillAction }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90">
        <Plus className="size-4" /> Thêm hoá đơn
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">Thêm hoá đơn carrier</DialogTitle>
        </DialogHeader>
        <form action={async (fd) => { await createBillAction(fd); setOpen(false); }} className="space-y-4">
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 space-y-2">
            <Label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Upload className="size-3.5" /> File hoá đơn (PDF / Excel)
            </Label>
            <Input name="file" type="file" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg" />
            <p className="text-[11px] text-muted-foreground">
              Sau khi upload, các trường bên dưới sẽ tự điền từ nội dung hoá đơn (đang hoàn thiện parser) — bạn vẫn chỉnh sửa được trước khi lưu.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Mã hoá đơn"><Input name="billNumber" placeholder="INV-..." /></Field>
            <Field label="Số tiền *"><Input name="amount" required inputMode="numeric" placeholder="0" /></Field>
            <Field label="Kỳ từ *"><Input name="periodStart" type="date" required /></Field>
            <Field label="Kỳ đến *"><Input name="periodEnd" type="date" required /></Field>
            <Field label="Ngày xuất"><Input name="issueDate" type="date" /></Field>
            <Field label="Hạn thanh toán"><Input name="dueDate" type="date" /></Field>
            <div className="col-span-2"><Field label="Ghi chú"><Input name="note" placeholder="—" /></Field></div>
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
