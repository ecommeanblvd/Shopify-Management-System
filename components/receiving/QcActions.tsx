import { Button } from '@/components/ui/button';
import { ONhanAnh } from '@/components/ui/o-nhan-anh';
import { qcPassAction, qcFailAction } from '@/features/receiving/qc-actions';

/**
 * Nút Đạt + form Không đạt (lý do BẮT BUỘC, ảnh KHÔNG). Server component — dùng action 'use server'.
 *
 * Ảnh thôi bắt buộc (CEO 01/10/2026): kiểm xong mà chưa kịp chụp thì phải lưu được, ảnh bổ sung
 * sau. `qcFailAction` vốn đã chịu được `failPhoto` rỗng (`file.size > 0`), nên chỉ có thuộc tính
 * `required` ở trình duyệt là chặn — đã bỏ.
 *
 * Ô ảnh dùng `ONhanAnh` để DÁN và KÉO THẢ được. CEO báo 01/10 là ô này vẫn phải bấm chọn tệp:
 * vòng trước em gắn ô dán vào `BangNhanKcs.tsx` — màn 0 dòng không ai dùng — chứ không gắn vào
 * đây và `KhoiLoi.tsx`, hai chỗ kho thật đang bấm. Sửa màn mình đang đọc thay vì màn đang dùng.
 */
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
        <ONhanAnh name="failPhoto" required={false} className="text-xs"
                  goiY="Ảnh không bắt buộc — dán (Ctrl/Cmd+V), kéo thả, hay bấm chọn" />
        <Button type="submit" size="sm" variant="outline" className="h-7 px-3 text-xs">QC Fail</Button>
      </form>
    </div>
  );
}
