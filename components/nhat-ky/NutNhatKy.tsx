'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger,
} from '@/components/ui/sheet';
import { nhatKyChoPanel, type KetQuaPanel } from '@/features/nhat-ky/doc-panel';
import { BangNhatKy } from './BangNhatKy';

/**
 * Nút "Nhật ký" + panel trượt — LỐI VÀO DUY NHẤT để soi nhật ký của bảng đang xem.
 *
 * CEO (20/10/2026): *"anh muốn trong từng module sẽ đều có 1 tab nhật kí hoặc button nhật
 * ở cùng 1 vị trí để xem lại của đúng bảng đó chứ không tách thành 1 phần riêng, vì người
 * dùng đang xem bảng nào sẽ soi luôn log của bảng đó thay vì chuyển sang module khác"*.
 *
 * Nên là PANEL TRƯỢT, không phải điều hướng sang trang khác: "thay vì chuyển sang module
 * khác" chính là yêu cầu. Người đang lọc dở một danh sách, cuộn tới giữa bảng, bấm xem log
 * rồi đóng lại phải thấy màn hình y như lúc chưa bấm — một cú `router.push` làm mất hết bộ
 * lọc, vị trí cuộn và cả focus, nên lần sau họ sẽ không bấm nữa.
 *
 * Component KHÔNG nhận `className` hay prop vị trí: nút phải ở CÙNG MỘT CHỖ trên cả 5
 * module (yêu cầu cốt lõi của CEO), và cách duy nhất giữ được điều đó qua nhiều lượt sửa
 * là trang không có cách nào chỉnh dáng nút. Vị trí do khuôn header quyết: tiêu đề bên
 * trái, nút canh phải thẳng hàng với `<h1>`.
 */
export function NutNhatKy({ bang }: {
  /**
   * Tên bảng THẬT mà module này đang hiện. Nhận một hoặc nhiều: vài module soi hai bảng
   * (Kho hàng = phiếu + từng chiếc, Quản lí đơn = đơn + dòng hàng), và người đứng ở màn đó
   * không nghĩ theo "hai bảng" — họ hỏi "ai sửa gì ở đây".
   */
  bang: string | readonly string[];
}) {
  const [mo, setMo] = useState(false);
  const danhSach = typeof bang === 'string' ? [bang] : bang;

  return (
    <Sheet open={mo} onOpenChange={setMo}>
      <SheetTrigger
        render={<Button type="button" variant="outline" size="sm" className="h-9 gap-2" />}
      >
        <History className="size-4" />
        Nhật ký
      </SheetTrigger>
      {/* Cùng biến thể `data-[side=right]:sm:max-w-*` của `SheetContent` để `twMerge` thay
          được giá trị mặc định (`sm:max-w-sm`): bảng nhật ký có 4 cột, hẹp hơn thì cột
          "Trước → Sau" bị bóp còn vài ký tự. */}
      <SheetContent side="right" className="w-[96vw] gap-0 overflow-hidden data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="pr-12">
          <SheetTitle>Nhật ký thay đổi</SheetTitle>
          <SheetDescription>
            Ai sửa ô nào ở màn này, từ giá trị nào sang giá trị nào. Mới nhất trước. Giá trị
            nhạy cảm bị che theo quyền của bạn, và ô bị che nói rõ là bị che.
          </SheetDescription>
        </SheetHeader>
        {/* `mo &&` để câu truy vấn chỉ chạy khi panel thật sự mở — và để mỗi lượt mở đọc
            lại: nhật ký là thứ người ta mở ĐỂ xem vừa có gì mới, giữ kết quả cũ trong state
            là bày một ảnh chụp quá khứ mà không nói là ảnh chụp. */}
        {mo && <NoiDung bang={danhSach} />}
      </SheetContent>
    </Sheet>
  );
}

type Trang = { pha: 'dangTai' } | { pha: 'loi' } | { pha: 'xong'; kq: KetQuaPanel };

function NoiDung({ bang }: { bang: readonly string[] }) {
  const [trang, setTrang] = useState<Trang>({ pha: 'dangTai' });
  // Khoá theo tên bảng, không theo chính mảng: mảng literal ở `page.tsx` là một tham chiếu
  // mới mỗi lượt render nên để nó vào deps là đọc lại vô hạn.
  const khoa = bang.join(',');

  /* Không `setTrang({ pha: 'dangTai' })` ở đầu effect (và `react-hooks/set-state-in-effect`
     chặn đúng việc đó): `NutNhatKy` chỉ dựng `NoiDung` khi panel mở, nên mỗi lượt mở là
     một lượt mount mới và state đã khởi tạo sẵn ở 'dangTai'. */
  useEffect(() => {
    let huy = false;
    void (async () => {
      try {
        const kq = await nhatKyChoPanel(khoa.split(','));
        if (!huy) setTrang({ pha: 'xong', kq });
      } catch (e) {
        console.error('[nhat-ky] đọc panel lỗi:', e);
        if (!huy) setTrang({ pha: 'loi' });
      }
    })();
    return () => { huy = true; };
  }, [khoa]);

  if (trang.pha === 'dangTai') {
    return <p className="px-4 py-6 text-sm text-muted-foreground">Đang đọc nhật ký…</p>;
  }
  if (trang.pha === 'loi') {
    return (
      <p className="px-4 py-6 text-sm text-destructive">
        Không đọc được nhật ký. Thử mở lại; nếu vẫn lỗi thì báo kỹ thuật.
      </p>
    );
  }

  const { kq } = trang;
  if (kq.thieuQuyen) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        Vai trò của bạn chưa có quyền xem nhật ký thay đổi.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-y border-border px-4 py-2 text-xs text-muted-foreground">
        {kq.khoi.length} khối thay đổi · gom theo người — lúc — bản ghi
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <BangNhatKy khoi={kq.khoi} trong={kq.cauTrong} />
      </div>
      <XemDayDu bang={kq.bang} />
    </div>
  );
}

/**
 * Liên kết sang `/f/nhat-ky` — trang đó THÔI là một module trong menu (CEO 20/10/2026),
 * nhưng vẫn giữ route: panel không có ô lọc theo người / theo trường / theo khoảng ngày, và
 * một đường dẫn mang sẵn bộ lọc là cách duy nhất gửi được bằng chứng cho người khác.
 *
 * Một liên kết cho MỖI bảng vì trang đó xem một bảng một lúc (`nhatKyCuaBang` bắt buộc có
 * `bang`), nên gộp hai bảng vào một liên kết là một trong hai bảng im lặng bị bỏ.
 */
function XemDayDu({ bang }: { bang: KetQuaPanel['bang'] }) {
  if (bang.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-3 text-sm">
      <span className="text-muted-foreground">Xem đầy đủ &amp; lọc sâu:</span>
      {bang.map((b) => (
        <Link
          key={b.bang}
          href={`/f/nhat-ky?bang=${encodeURIComponent(b.bang)}`}
          className="underline underline-offset-2 hover:text-foreground"
        >
          {b.nhan}
        </Link>
      ))}
    </div>
  );
}
