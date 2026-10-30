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
import { FileDrop } from '@/components/ui/file-drop';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BangLichSuBaoLoi } from './BangLichSuBaoLoi';
import { guiBaoLoi } from '@/features/issue-report/actions';
import { ANH_BYTE_TOI_DA, ANH_TOI_DA } from '@/features/issue-report/anh';
import { DANH_SACH_MODULE, MUC_DO, moduleTuDuongDan } from '@/features/issue-report/phan-loai';

/**
 * Nút "Báo lỗi" ở header — MỘT chỗ cho mọi module, cùng nguyên tắc với `NutNhatKy`
 * (CEO 20/10/2026: cùng một vị trí, không tách sang trang khác). Module do server suy từ
 * đường dẫn lúc gửi; ở đây chỉ hiện nhãn để người báo biết mình đang báo cho phần nào.
 * Là panel trượt để người dùng không mất bộ lọc / vị trí cuộn của màn đang xem.
 *
 * Từ 30/10/2026 có TAB THỨ HAI "Lịch sử": báo lỗi của màn đang đứng, trong phạm vi người đọc
 * (`features/issue-report/pham-vi.ts`). Cùng khuôn với panel Nhật ký — CEO 20/10/2026: *"người
 * dùng đang xem bảng nào sẽ soi luôn log của bảng đó thay vì chuyển sang module khác"*.
 *
 * `coLichSu` là prop DỮ LIỆU, không phải prop dáng: quyền phải tính ở server (`hasPermission`
 * đọc cache quyền của tiến trình) nên `Topbar` truyền xuống. Component vẫn KHÔNG nhận
 * `className` hay prop vị trí — nút phải ở cùng một chỗ trên mọi module.
 */
export function NutBaoLoi({ coLichSu = false }: { coLichSu?: boolean }) {
  const pathname = usePathname();
  const [mo, setMo] = useState(false);
  const [tieuDe, setTieuDe] = useState('');
  const [moTa, setMoTa] = useState('');
  const [mucDo, setMucDo] = useState('trung_binh');
  // null = chưa tự chọn → theo module của trang đang xem (và đổi theo khi người dùng chuyển
  // trang); đã chọn tay thì giữ lựa chọn của họ cho tới khi gửi xong.
  const [moduleChon, setModuleChon] = useState<string | null>(null);
  const [anh, setAnh] = useState<File[]>([]);
  const [dangGui, batDauGui] = useTransition();
  const mod = moduleTuDuongDan(pathname);
  const moduleHienTai = moduleChon ?? mod.ma;

  function themAnh(fs: File[]) {
    const anhThoi = fs.filter((f) => f.type.startsWith('image/'));
    if (anhThoi.length < fs.length) toast.error('Chỉ nhận tệp ảnh.');
    const quaLon = anhThoi.find((f) => f.size > ANH_BYTE_TOI_DA);
    if (quaLon) { toast.error(`Ảnh "${quaLon.name}" quá ${ANH_BYTE_TOI_DA / 1024 / 1024}MB.`); return; }
    setAnh((cu) => {
      const moi = [...cu, ...anhThoi].slice(0, ANH_TOI_DA);
      if (cu.length + anhThoi.length > ANH_TOI_DA) toast.error(`Tối đa ${ANH_TOI_DA} ảnh.`);
      return moi;
    });
  }

  function gui() {
    batDauGui(async () => {
      try {
        // Lấy cả query string (bộ lọc đang áp) — thứ giúp tái hiện lỗi — nhưng server vẫn
        // suy module từ phần path.
        const duongDan = `${window.location.pathname}${window.location.search}`;
        const fd = new FormData();
        fd.set('duongDan', duongDan); fd.set('tieuDe', tieuDe); fd.set('moTa', moTa); fd.set('mucDo', mucDo); fd.set('module', moduleHienTai);
        for (const f of anh) fd.append('anh', f);
        const kq = await guiBaoLoi(fd);
        if (!kq.ok) { toast.error(kq.loi ?? 'Không gửi được.'); return; }
        toast.success(`Đã ghi nhận ${kq.ma}. Cảm ơn bạn!`);
        if (kq.canhBao) toast.warning(kq.canhBao);
        setTieuDe(''); setMoTa(''); setMucDo('trung_binh'); setAnh([]); setModuleChon(null); setMo(false);
      } catch (e) {
        console.error('[issue-report] gửi lỗi:', e);
        toast.error('Không gửi được. Thử lại sau.');
      }
    });
  }

  const than = (
    <Sheet open={mo} onOpenChange={setMo}>
      <SheetTrigger render={<Button type="button" variant="outline" size="sm" className="h-9 gap-2" />}>
        <Bug className="size-4" />
        Báo lỗi
      </SheetTrigger>
      <SheetContent side="right" className="gap-0 data-[side=right]:sm:max-w-md">
        <SheetHeader className="pr-12">
          <SheetTitle>Báo lỗi</SheetTitle>
          <SheetDescription>
            Mô tả bạn đang làm gì và thấy gì. Hệ thống tự ghi lại trang đang xem và tài khoản
            của bạn.
          </SheetDescription>
        </SheetHeader>
        {coLichSu && (
          <TabsList className="mx-4 mb-2">
            <TabsTrigger value="gui">Báo lỗi</TabsTrigger>
            <TabsTrigger value="lich-su">Lịch sử</TabsTrigger>
          </TabsList>
        )}
        <KhungGui coLichSu={coLichSu}>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="grid gap-1.5">
            <Label htmlFor="bl-module">Lỗi xảy ra ở module nào?</Label>
            <select id="bl-module" value={moduleHienTai} onChange={(e) => setModuleChon(e.target.value)}
              className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm">
              {DANH_SACH_MODULE.map((m) => (
                <option key={m.ma} value={m.ma}>
                  {m.nhan}{m.ma === mod.ma ? ' (đang xem)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bl-tieu-de">Tiêu đề</Label>
            <Input id="bl-tieu-de" value={tieuDe} maxLength={120}
              onChange={(e) => setTieuDe(e.target.value)} placeholder="Vd: Lọc theo ngày không ra đơn" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bl-mo-ta">Chuyện gì xảy ra?</Label>
            <Textarea id="bl-mo-ta" value={moTa} maxLength={4000} rows={6}
              onChange={(e) => setMoTa(e.target.value)}
              onPaste={(e) => {
                const fs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
                if (fs.length) { e.preventDefault(); themAnh(fs); }
              }}
              placeholder="Các bước đã làm → kết quả thấy → kết quả mong đợi" />
          </div>
          <div className="grid gap-1.5">
            <Label>Ảnh chụp màn hình (không bắt buộc)</Label>
            <FileDrop accept="image/png,image/jpeg,image/webp,image/gif" disabled={anh.length >= ANH_TOI_DA}
              onFiles={themAnh} tieuDe="Kéo thả ảnh, bấm để chọn, hoặc dán (Ctrl+V) vào ô mô tả"
              goiY={`Tối đa ${ANH_TOI_DA} ảnh, mỗi ảnh ≤ ${ANH_BYTE_TOI_DA / 1024 / 1024}MB. Che thông tin nhạy cảm trước khi gửi.`} />
            {anh.length > 0 && (
              <ul className="grid gap-1 text-xs">
                {anh.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded border px-2 py-1">
                    <span className="truncate">{f.name} · {Math.ceil(f.size / 1024)}KB</span>
                    <button type="button" className="ml-2 text-muted-foreground hover:text-foreground"
                      onClick={() => setAnh((cu) => cu.filter((_, j) => j !== i))}>Bỏ</button>
                  </li>
                ))}
              </ul>
            )}
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
        </KhungGui>
        {coLichSu && (
          <TabsContent value="lich-su" className="overflow-y-auto px-4 pb-4">
            {/* Lọc theo module của TRANG ĐANG ĐỨNG, không theo ô chọn module trong form:
                người dùng đổi ô chọn là để gửi lỗi cho module khác, không phải để đổi cái
                họ đang soi. */}
            <BangLichSuBaoLoi module={mod.ma} />
          </TabsContent>
        )}
      </SheetContent>
    </Sheet>
  );
  return coLichSu ? <Tabs defaultValue="gui">{than}</Tabs> : than;
}

/** Thân form: bọc trong `TabsContent` khi có tab, trả thẳng khi không — để panel của người
 *  chưa có quyền xem lịch sử giữ nguyên hình dạng cũ, không có thanh tab trống một mục. */
function KhungGui({ coLichSu, children }: { coLichSu: boolean; children: React.ReactNode }) {
  if (!coLichSu) return <>{children}</>;
  return <TabsContent value="gui" className="overflow-y-auto">{children}</TabsContent>;
}
