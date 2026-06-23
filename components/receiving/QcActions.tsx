import { Button } from '@/components/ui/button';
import { qcPassAction, qcFailAction } from '@/features/receiving/qc-actions';

/** Nút Đạt + form Không đạt (lý do + ảnh, bắt buộc). Server component — dùng action 'use server'. */
export function QcActions({ itemId }: { itemId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={qcPassAction}>
        <input type="hidden" name="itemId" value={itemId} />
        <Button type="submit" size="sm" className="h-7 px-3 text-xs">QC Pass</Button>
      </form>
      <form action={qcFailAction} className="flex items-center gap-2" encType="multipart/form-data">
        <input type="hidden" name="itemId" value={itemId} />
        <input name="reason" placeholder="Lý do fail" required className="border border-input bg-input/30 rounded-md px-2 py-1 text-xs" />
        <input type="file" name="failPhoto" accept="image/*" required className="text-xs" />
        <Button type="submit" size="sm" variant="outline" className="h-7 px-3 text-xs">QC Fail</Button>
      </form>
    </div>
  );
}
