import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import type { MonDangMuon } from '@/features/kol/queries';

/**
 * Bảng "Đang mượn" — mọi dòng hàng mượn còn chưa trả đủ, quá hạn xếp trên
 * cùng. Dữ liệu đến từ `dangMuon(homNay)` (đã `ORDER BY han_tra ASC NULLS
 * LAST`), nên hạn trả sớm nhất/quá hạn nhất tự nhiên nằm trên đầu — không cần
 * sắp lại ở tầng hiển thị.
 */
export function BangDangMuon({ mon }: { mon: MonDangMuon[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr className="[&>th]:p-3 [&>th]:font-medium">
              <th>Mã đơn</th>
              <th>Người nhận</th>
              <th>SKU</th>
              <th>Tên hàng</th>
              <th>Kho</th>
              <th className="text-right">Còn nợ</th>
              <th>Hạn trả</th>
              <th>Tình trạng</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mon.length === 0 ? (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">
                Không có món nào đang mượn chưa trả.
              </td></tr>
            ) : mon.map((m) => {
              const quaHan = m.soNgayTre !== null && m.soNgayTre > 0;
              return (
                <tr
                  key={m.dongDonId}
                  className={`border-b [&>td]:p-3 ${quaHan ? 'bg-red-50 dark:bg-red-950/20' : 'hover:bg-muted/40'}`}
                >
                  <td>
                    <Link href={`/f/kol/${m.ma}`} className="font-medium underline-offset-2 hover:underline">
                      {m.ma}
                    </Link>
                  </td>
                  <td>{m.tenNhan}</td>
                  <td className="font-medium">{m.sku}</td>
                  <td className="text-muted-foreground">{m.tenHang ?? '—'}</td>
                  <td>{m.kho}</td>
                  <td className="text-right tabular-nums font-medium">{m.conNo}</td>
                  <td className={quaHan ? 'font-medium text-red-600 dark:text-red-400' : ''}>
                    {m.hanTra ?? '—'}
                  </td>
                  <td>
                    {m.soNgayTre === null ? (
                      <span className="text-muted-foreground">Không có hạn</span>
                    ) : quaHan ? (
                      <span className="font-medium text-red-600 dark:text-red-400">
                        Trễ {m.soNgayTre} ngày
                      </span>
                    ) : m.soNgayTre === 0 ? (
                      <span className="font-medium text-amber-600 dark:text-amber-500">Đúng hạn hôm nay</span>
                    ) : (
                      <span className="text-muted-foreground">Còn {-m.soNgayTre} ngày</span>
                    )}
                  </td>
                  <td>
                    <Link
                      href={`/f/kol/${m.ma}`}
                      className="text-xs text-primary underline-offset-2 hover:underline"
                    >
                      Nhận trả về →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
