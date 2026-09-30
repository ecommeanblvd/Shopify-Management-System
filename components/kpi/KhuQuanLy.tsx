'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { NutDuyetLyDo } from '@/components/shipments/NutDuyetLyDo';
import { DaiNop12 } from './DaiNop12';
import { layLyDo } from '@/features/shipments/ly-do-cham';
import type { TrangThaiNop } from '@/features/kpi-logistics/nop-1-2';
import type { KienChoDuyet } from '@/features/kpi-logistics/cho-duyet-queries';

/**
 * KHU VỰC QUẢN LÝ — mọi lệnh duyệt gom về cuối màn KPI (CEO 30/09/2026).
 *
 * Vì sao: các nút duyệt vốn nằm rải trong bảng chi tiết, phải bấm vào tiêu chí 1.2 mới thấy. CEO
 * mở màn hai lần vẫn không tìm ra chúng — nút có ở đó không đồng nghĩa với người thấy được nó.
 *
 * Cả khối chỉ dựng cho quản lý (trang không truyền props này cho người khác), nên người bị chấm
 * không nhìn thấy các lệnh duyệt về chính mình.
 */
export function KhuQuanLy({ ky, nop12, kienChoDuyet, monCanChoDuyet, ganLyDoDuoc, children }: {
  ky: string;
  nop12: { trangThai: TrangThaiNop; nopAt: string | null; duyetAt: string | null; soDongDangTraLai: number } | null;
  kienChoDuyet: KienChoDuyet[];
  monCanChoDuyet: number;
  /** Quản lý cũng gán được lý do, nên dải nộp cần biết để hiện nút gửi. */
  ganLyDoDuoc: boolean;
  /** Ô nhập tay của kỳ (3B, ghi đè, Gate) và nút chốt kỳ — trang cha dựng sẵn. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const lamMoi = () => router.refresh();

  return (
    <Card className="border-dashed">
      <CardContent className="space-y-4 p-4">
        <div>
          <h2 className="text-sm font-semibold">Khu vực quản lý</h2>
          <p className="text-[11px] text-muted-foreground">
            Mọi lệnh duyệt của kỳ nằm ở đây. Người được chấm KPI không nhìn thấy khối này.
          </p>
        </div>

        {/* 1 — duyệt lý do giao chậm của cả kỳ, và trạng thái nộp. */}
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">1 · Lý do giao chậm (tiêu chí 1.2)</h3>
          {nop12
            ? <DaiNop12 ky={ky} trangThai={nop12.trangThai} nopAt={nop12.nopAt} duyetAt={nop12.duyetAt}
                soDongDangTraLai={nop12.soDongDangTraLai} ganLyDoDuoc={ganLyDoDuoc} laQuanLy sauKhiLuu={lamMoi} />
            : <p className="text-xs text-muted-foreground">Chưa có dữ liệu nộp cho kỳ này.</p>}
          <p className="text-[11px] text-muted-foreground">
            Trả lại từng dòng thì làm ở bảng chi tiết tiêu chí 1.2 phía trên — ở đó mới thấy được dòng nào sai.
          </p>
        </section>

        {/* 2 — duyệt tay đúng chỗ máy mù. Liệt kê thẳng ở đây để không phải đi tìm. */}
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            2 · Kiện hệ thống không kiểm được ({kienChoDuyet.length})
          </h3>
          {kienChoDuyet.length === 0 ? (
            <p className="text-xs text-muted-foreground">Không kiện nào đang chờ. Kiện hãng đã tra và không thấy dấu hiệu thì KHÔNG duyệt tay được — bằng chứng ngược thì người không nói khác.</p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-lg border border-border">
              {kienChoDuyet.map((k) => (
                <li key={`${k.nguon}-${k.id}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-xs">
                  <span className="font-medium">{k.maDon ?? '—'}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{k.tracking ?? '—'}</span>
                  <span className="text-muted-foreground">{k.nuoc ?? '?'} · {(k.hang ?? '?').toUpperCase()}</span>
                  <span>{layLyDo(k.lyDo)?.ten ?? k.lyDo}</span>
                  {k.bangChung && <span className="w-full text-[10px] text-muted-foreground">{k.bangChung}</span>}
                  <span className="ml-auto">
                    <NutDuyetLyDo shipmentId={k.id} nguon={k.nguon} daDuyet={null} sauKhiLuu={lamMoi} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 3 — cân sản phẩm nằm ở trang khác, nên chỉ dẫn đường. */}
        <section className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">3 · Cân sản phẩm chờ đẩy lên Shopify</h3>
          {monCanChoDuyet === 0 ? (
            <p className="text-xs text-muted-foreground">Không món nào đang chờ.</p>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-xs">
              <span><b>{monCanChoDuyet}</b> món chờ duyệt. Chưa duyệt thì lỗi cân quy đổi web còn tái diễn ở các kỳ sau.</span>
              <Link href="/f/can-san-pham" className="cursor-pointer rounded border border-border px-2 py-0.5 transition-colors hover:bg-muted">
                Mở trang Sửa cân sản phẩm
              </Link>
            </p>
          )}
        </section>

        {/* 4 — chấm tay của kỳ và chốt kỳ, do trang cha dựng. */}
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">4 · Chấm tay và chốt kỳ</h3>
          {children}
        </section>
      </CardContent>
    </Card>
  );
}
