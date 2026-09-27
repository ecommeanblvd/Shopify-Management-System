import { Headset } from 'lucide-react';
import { nguoiHienTai } from '@/features/cx-ticket/nguoi';
import { danhSachTicket, demTheoTrangThai } from '@/features/cx-ticket/queries';
import { NHOM, boPhanHopLe } from '@/features/cx-ticket/phan-loai';
import { TRANG_THAI_TICKET } from '@/features/cx-ticket/trang-thai';
import { BangTicket } from '@/components/cx-ticket/BangTicket';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ tt?: string; nhom?: string; bp?: string; toi?: string }>;
}

export default async function CxTicketPage({ searchParams }: Props) {
  // Quyền đã chặn ở layout; gọi lại ở đây để lấy bộ phận + toàn quyền của người xem.
  const nguoi = await nguoiHienTai();
  const sp = await searchParams;

  // Lọc giá trị lạ từ URL ngay tại cửa: truyền thẳng xuống truy vấn thì người ta
  // gõ ?tt=xyz là danh sách rỗng mà không ai hiểu vì sao.
  const tt = (TRANG_THAI_TICKET as readonly string[]).includes(sp.tt ?? '') ? sp.tt! : '';
  const nhom = NHOM.some((n) => n.ma === sp.nhom) ? sp.nhom! : '';
  const bp = sp.bp && boPhanHopLe(sp.bp) ? sp.bp : '';
  const cuaToi = sp.toi === '1';

  const [ticket, dem] = await Promise.all([
    danhSachTicket({
      trangThai: tt || undefined,
      nhom: nhom || undefined,
      boPhan: bp || undefined,
      cuaToi,
    }),
    demTheoTrangThai(),
  ]);

  return (
    <div className="space-y-6 px-6 py-8 md:px-10 md:py-10">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          <Headset className="size-3.5" />
          CX
        </div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Việc cần làm</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Vấn đề của khách cần bộ phận khác xử lý. Mỗi bộ phận ghi cập nhật và
          trạng thái phần mình, nên nhìn được ngay bộ phận nào đang tắc. Bộ phận
          chưa có tài khoản thì CX ghi hộ — hệ thống đánh dấu là ghi hộ.
        </p>
      </header>

      <BangTicket
        ticket={ticket}
        dem={dem}
        boPhanMinh={nguoi.boPhan}
        toanQuyen={nguoi.toanQuyen}
        locTrangThai={tt}
        locNhom={nhom}
        locBoPhan={bp}
        locCuaToi={cuaToi}
      />
    </div>
  );
}
