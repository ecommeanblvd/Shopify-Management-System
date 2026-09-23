import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import type { DonTomTat } from '@/features/kol/queries';
import type { TrangThaiDon, MucDich } from '@/features/kol/types';

export const NHAN_TRANG_THAI: Record<TrangThaiDon, string> = {
  nhap: 'Nháp',
  da_chot: 'Đã chốt',
  da_gui: 'Đã gửi',
  huy: 'Đã huỷ',
};

const MAU_TRANG_THAI: Record<TrangThaiDon, string> = {
  nhap: 'bg-muted text-muted-foreground',
  da_chot: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  da_gui: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  huy: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export const NHAN_MUC_DICH: Record<MucDich, string> = {
  kol: 'KOL',
  chup_do: 'Chụp đồ',
  khac: 'Khác',
};

interface NguoiNhanOption { id: string; ten: string; ngungDung: boolean }

export function BangDonKol({
  dons, nguoiNhanOptions, trangThai, nguoiNhanId,
}: {
  dons: DonTomTat[];
  nguoiNhanOptions: NguoiNhanOption[];
  trangThai?: string;
  nguoiNhanId?: string;
}) {
  return (
    <div className="space-y-4">
      <form action="/f/kol" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Trạng thái</span>
          <select
            name="trangThai"
            defaultValue={trangThai ?? ''}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Tất cả</option>
            {(Object.keys(NHAN_TRANG_THAI) as TrangThaiDon[]).map((tt) => (
              <option key={tt} value={tt}>{NHAN_TRANG_THAI[tt]}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Người nhận</span>
          <select
            name="nguoiNhanId"
            defaultValue={nguoiNhanId ?? ''}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Tất cả</option>
            {nguoiNhanOptions.map((n) => (
              <option key={n.id} value={n.id}>{n.ten}{n.ngungDung ? ' (ngừng dùng)' : ''}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-9 cursor-pointer rounded-md border border-input bg-background px-3 text-sm hover:bg-muted"
        >
          Lọc
        </button>
        {(trangThai || nguoiNhanId) && (
          <Link href="/f/kol" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            Xoá lọc
          </Link>
        )}
      </form>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr className="[&>th]:p-3 [&>th]:font-medium">
                <th>Mã đơn</th>
                <th>Người nhận</th>
                <th>Mục đích</th>
                <th>Nơi gửi</th>
                <th className="text-right">Số món</th>
                <th>Trạng thái</th>
                <th>Vận chuyển</th>
                <th>Ngày gửi</th>
              </tr>
            </thead>
            <tbody>
              {dons.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">
                  {(trangThai || nguoiNhanId) ? 'Không có đơn nào khớp bộ lọc.' : 'Chưa có đơn KOL nào.'}
                </td></tr>
              ) : dons.map((d) => (
                <tr key={d.id} className="border-b hover:bg-muted/40 [&>td]:p-3">
                  <td>
                    <Link href={`/f/kol/${d.ma}`} className="font-medium underline-offset-2 hover:underline">
                      {d.ma}
                    </Link>
                  </td>
                  <td>{d.tenNhan}</td>
                  <td>{NHAN_MUC_DICH[d.mucDich]}</td>
                  <td>{d.quocGia === 'VN' ? 'Nội địa' : 'Quốc tế'}</td>
                  <td className="text-right tabular-nums">{d.soDong}</td>
                  <td>
                    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${MAU_TRANG_THAI[d.trangThai]}`}>
                      {NHAN_TRANG_THAI[d.trangThai]}
                    </span>
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {d.hangVanChuyen ? <>{d.hangVanChuyen}<br />{d.maVanDon}</> : '—'}
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {d.guiLuc ? new Date(d.guiLuc).toLocaleDateString('vi-VN') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
