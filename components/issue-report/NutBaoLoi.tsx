'use client';

import { useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { Bug } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import { guiBaoLoi } from '@/features/issue-report/actions';
import { MUC_DO, moduleTuDuongDan } from '@/features/issue-report/phan-loai';

/**
 * Nút "Báo lỗi" ở header — MỘT chỗ cho mọi module, cùng nguyên tắc với `NutNhatKy`
 * (CEO 20/10/2026: cùng một vị trí, không tách sang trang khác). Module do server suy từ
 * đường dẫn lúc gửi; ở đây chỉ hiện nhãn để người báo biết mình đang báo cho phần nào.
 * Là panel trượt để người dùng không mất bộ lọc / vị trí cuộn của màn đang xem.
 */
export function NutBaoLoi() {
  const pathname = usePathname();
  const [mo, setMo] = useState(false);
  const [tieuDe, setTieuDe] = useState('');
  const [moTa, setMoTa] = useState('');
  const [mucDo, setMucDo] = useState('trung_binh');
  const [dangGui, batDauGui] = useTransition();
  const mod = moduleTuDuongDan(pathname);

  function gui() {
    batDauGui(async () => {
      try {
        // Lấy cả query string (bộ lọc đang áp) — thứ giúp tái hiện lỗi — nhưng server vẫn
        // suy module từ phần path.
        const duongDan = `${window.location.pathname}${window.location.search}`;
        const kq = await guiBaoLoi({ duongDan, tieuDe, moTa, mucDo });
        if (!kq.ok) { toast.error(kq.loi ?? 'Không gửi được.'); return; }
        toast.success(`Đã ghi nhận ${kq.ma}. Cảm ơn bạn!`);
        setTieuDe(''); setMoTa(''); setMucDo('trung_binh'); setMo(false);
      } catch (e) {
        console.error('[issue-report] gửi lỗi:', e);
        toast.error('Không gửi được. Thử lại sau.');
      }
    });
  }

  return (
    <Sheet open={mo} onOpenChange={setMo}>
      <SheetTrigger render={<Button type="button" variant="outline" size="sm" className="h-9 gap-2" />}>
        <Bug className="size-4" />
        Báo lỗi
      </SheetTrigger>
      <SheetContent side="right" className="gap-0 data-[side=right]:sm:max-w-md">
        <SheetHeader className="pr-12">
          <SheetTitle>Báo lỗi — {mod.nhan}</SheetTitle>
          <SheetDescription>
            Mô tả bạn đang làm gì và thấy gì. Hệ thống tự ghi lại trang đang xem và tài khoản
            của bạn.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="grid gap-1.5">
            <Label htmlFor="bl-tieu-de">Tiêu đề</Label>
            <Input id="bl-tieu-de" value={tieuDe} maxLength={120}
              onChange={(e) => setTieuDe(e.target.value)} placeholder="Vd: Lọc theo ngày không ra đơn" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bl-mo-ta">Chuyện gì xảy ra?</Label>
            <Textarea id="bl-mo-ta" value={moTa} maxLength={4000} rows={6}
              onChange={(e) => setMoTa(e.target.value)}
              placeholder="Các bước đã làm → kết quả thấy → kết quả mong đợi" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bl-muc-do">Mức độ</Label>
            <select id="bl-muc-do" value={mucDo} onChange={(e) => setMucDo(e.target.value)}
              className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm">
              {MUC_DO.map((m) => <option key={m.ma} value={m.ma}>{m.nhan}</option>)}
            </select>
          </div>
          <Button type="button" onClick={gui} disabled={dangGui}>
            {dangGui ? 'Đang gửi…' : 'Gửi báo lỗi'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
