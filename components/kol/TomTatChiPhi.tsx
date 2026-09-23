'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { quyVeVnd, type DongBaoCao } from '@/features/kol/bao-cao';
import type { TongChiPhi } from '@/features/kol/chi-phi';
import type { TiGiaThang } from '@/features/cogs/tien';

/** 'YYYY-MM' → 'Tháng MM/YYYY'; khoá đặc biệt 'chua_gui' → nhãn tiếng Việt riêng. */
function nhanKhoaThang(khoa: string): string {
  if (khoa === 'chua_gui') return 'Chưa gửi';
  const m = /^(\d{4})-(\d{2})$/.exec(khoa);
  return m ? `Tháng ${m[2]}/${m[1]}` : khoa;
}

/** Tháng dùng để tra tỷ giá cho một khoá: chính khoá đó nếu là tháng thật, ngược lại dùng tháng hiện tại. */
function periodCuaKhoa(khoa: string, thangHienTai: string): string {
  return /^\d{4}-\d{2}$/.test(khoa) ? khoa : thangHienTai;
}

function vnd(n: number): string {
  return n.toLocaleString('vi-VN') + ' ₫';
}

interface HangDaQuy {
  khoa: string;
  nhan: string;
  vnd: number;
  khongDoiDuoc: string[];
  soMonDaTieu: number;
  soMonDangTreo: number;
  soDongThieuGiaVon: number;
}

function quyHang(r: DongBaoCao, nhan: string, period: string, rates: TiGiaThang[]): HangDaQuy {
  const q = quyVeVnd(r.theoTienTe, period, rates);
  return {
    khoa: r.khoa, nhan, vnd: q.vnd, khongDoiDuoc: q.khongDoiDuoc,
    soMonDaTieu: r.soMonDaTieu, soMonDangTreo: r.soMonDangTreo, soDongThieuGiaVon: r.soDongThieuGiaVon,
  };
}

/**
 * Khối tóm tắt chi phí marketing KOL — đặt đầu trang danh sách đơn.
 *
 * Bốn số đầu (`tongTatCa`, do trang gọi truyền vào) chỉ tính hàng ĐÃ GỬI —
 * caller (`app/(dashboard)/f/kol/page.tsx`) đã lọc `guiLuc !== null` trước khi
 * gọi `tongChiPhi`. Cố tình KHÔNG dùng toàn bộ `dongBaoCao`: một dòng mượn
 * thuộc đơn còn nháp/đã chốt (chưa rời kho) vẫn có `soLuongDaTra = 0`, cộng
 * nguyên số lượng vào "đang treo" y hệt một món thật sự đang ở nhà KOL quá
 * hạn — hai tình huống khác hẳn nhau (một cái cần đi đòi, một cái nằm trên kệ
 * kho chờ xuất) mà gộp vào một con số đầu trang thì người đọc không còn cách
 * nào phân biệt. `theoThang`/`theoNguoiNhan` thì NGƯỢC LẠI — nhận trọn
 * `dongBaoCao` không lọc, để khoá 'chua_gui' của `gomTheoThang` còn đường hiện
 * ra ở bảng chi tiết (có nhãn "Chưa gửi" riêng, không lẫn với các tháng thật).
 *
 * Quy VND theo tỷ giá THÁNG HIỆN TẠI cho headline (con số "tại thời điểm xem
 * báo cáo"). Bảng bên dưới cho xem chi tiết theo tháng gửi hoặc theo từng
 * KOL — mỗi dòng đó quy đổi bằng tỷ giá ĐÚNG THÁNG của nó khi có thể (tháng
 * gửi thật), còn lại dùng tháng hiện tại.
 *
 * `soDongThieuGiaVon` LUÔN hiện, kể cả bằng 0 — người đọc phải biết báo cáo
 * đang phủ được bao nhiêu, không được ngầm hiểu "không thấy số nghĩa là không
 * thiếu gì". Thiếu tỷ giá cho một loại tiền thì hiện cảnh báo tên loại tiền đó
 * ra, không lặng lẽ bỏ khỏi tổng.
 */
export function TomTatChiPhi({
  theoThang, theoNguoiNhan, tongTatCa, rates, thangHienTai,
}: {
  theoThang: DongBaoCao[];
  theoNguoiNhan: DongBaoCao[];
  tongTatCa: TongChiPhi;
  rates: TiGiaThang[];
  thangHienTai: string;
}) {
  const [tab, setTab] = useState<'thang' | 'nguoiNhan'>('thang');

  const tongQuy = useMemo(
    () => quyVeVnd(tongTatCa.theoTienTe, thangHienTai, rates),
    [tongTatCa, thangHienTai, rates],
  );

  const hangThang = useMemo(
    () => theoThang.map((r) => quyHang(r, nhanKhoaThang(r.khoa), periodCuaKhoa(r.khoa, thangHienTai), rates)),
    [theoThang, thangHienTai, rates],
  );
  const hangNguoiNhan = useMemo(
    () => theoNguoiNhan.map((r) => quyHang(r, r.khoa, thangHienTai, rates)),
    [theoNguoiNhan, thangHienTai, rates],
  );

  const hang = tab === 'thang' ? hangThang : hangNguoiNhan;
  // Cảnh báo gộp: mọi loại tiền không đổi được ở BẤT KỲ dòng nào của tab đang xem, không chỉ dòng tổng.
  const canhBaoTienTe = useMemo(
    () => [...new Set(hang.flatMap((h) => h.khongDoiDuoc))].sort(),
    [hang],
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Tóm tắt chi phí marketing (KOL / chụp đồ)</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Chi phí đã tiêu (quy VND)</p>
              <p className="text-xl font-semibold tabular-nums">{vnd(tongQuy.vnd)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Số món đã tiêu</p>
              <p className="text-xl font-semibold tabular-nums">{tongTatCa.soMonDaTieu}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Số món đang treo ở KOL</p>
              <p className="text-xl font-semibold tabular-nums">{tongTatCa.soMonDangTreo}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Số dòng chưa có giá vốn</p>
              <p className={`text-xl font-semibold tabular-nums ${tongTatCa.soDongThieuGiaVon > 0 ? 'text-amber-600 dark:text-amber-500' : ''}`}>
                {tongTatCa.soDongThieuGiaVon}
              </p>
            </div>
          </div>
          {tongQuy.khongDoiDuoc.length > 0 && (
            <p className="rounded-md bg-amber-50 p-2 text-xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
              ⚠ Thiếu tỷ giá tháng {thangHienTai} cho: {tongQuy.khongDoiDuoc.join(', ')} — số tiền loại này CHƯA được cộng
              vào tổng quy VND ở trên, không phải bằng 0.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <button
              type="button" onClick={() => setTab('thang')}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-sm ${tab === 'thang' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            >
              Theo tháng
            </button>
            <button
              type="button" onClick={() => setTab('nguoiNhan')}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-sm ${tab === 'nguoiNhan' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            >
              Theo KOL
            </button>
          </div>

          {canhBaoTienTe.length > 0 && (
            <p className="rounded-md bg-amber-50 p-2 text-xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
              ⚠ Một số dòng dưới đây thiếu tỷ giá cho: {canhBaoTienTe.join(', ')} — xem cột &ldquo;Không đổi được&rdquo; ở dòng liên quan.
            </p>
          )}

          {hang.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Chưa có dữ liệu.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr className="[&>th]:py-1.5 [&>th]:font-medium">
                  <th>{tab === 'thang' ? 'Tháng' : 'KOL'}</th>
                  <th className="text-right">Chi phí (VND)</th>
                  <th className="text-right">Đã tiêu</th>
                  <th className="text-right">Đang treo</th>
                  <th className="text-right">Thiếu giá vốn</th>
                  <th>Không đổi được</th>
                </tr>
              </thead>
              <tbody>
                {hang.map((h) => (
                  <tr key={h.khoa} className="border-b last:border-0 [&>td]:py-1.5">
                    <td className="font-medium">{h.nhan}</td>
                    <td className="text-right tabular-nums">{vnd(h.vnd)}</td>
                    <td className="text-right tabular-nums">{h.soMonDaTieu}</td>
                    <td className="text-right tabular-nums">{h.soMonDangTreo}</td>
                    <td className={`text-right tabular-nums ${h.soDongThieuGiaVon > 0 ? 'font-medium text-amber-600 dark:text-amber-500' : ''}`}>
                      {h.soDongThieuGiaVon}
                    </td>
                    <td className="text-xs text-red-600 dark:text-red-400">{h.khongDoiDuoc.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
