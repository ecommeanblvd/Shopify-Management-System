'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { soIdShopify } from '@/features/receiving/ma-tem';
import type { DangKiem } from '@/features/kho-nhan/types';
import { Button } from '@/components/ui/button';
import { guiLenLark } from '@/features/kho-nhan/day-wh-lark';
import { xoaChiec, huyNhapChuaGui } from '@/features/kho-nhan/nhan-actions';
import { OTimMonChoVe } from './OTimMonChoVe';
import { ModalQc } from './ModalQc';

/**
 * Báo việc đã xong là tin THOÁNG QUA: hiện vài giây rồi tự tắt, không chiếm chỗ
 * trên màn (CEO 25/09). Xoá nhiều chiếc thì sonner xếp chồng và gộp lại, chứ
 * không đẩy bảng tụt dần xuống như khi in ra thành dòng.
 *
 * Báo LỖI sống lâu hơn hẳn: lỡ mất một tin vui thì không sao, lỡ mất một dòng
 * "chiếc này chưa có trên bảng Lark" là kho tưởng đã xong việc.
 */
const GIAY_VUI = 3000;
const GIAY_LOI = 10000;

function gio(d: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(d));
}

/** Màn nhận & kiểm: tìm món chờ về ở trên, danh sách đang kiểm ở dưới. */
export function BangDangKiem({ dangKiem, coStorage }: { dangKiem: DangKiem[]; coStorage: boolean }) {
  const router = useRouter();
  const [chon, setChon] = useState<DangKiem | null>(null);
  const [pending, start] = useTransition();
  /** Chiếc đang xoá — theo TỪNG DÒNG, để nút của đúng dòng đó báo "Đang xoá…"
   *  thay vì khoá cả bảng mà không nói đang bận vì cái gì. */
  const [dangXoa, setDangXoa] = useState<string | null>(null);
  /** Đã xoá xong ở máy chủ — ẩn ngay, không đợi trang vẽ lại. Xoá một chiếc mất
   *  2–3 giây vì phải gọi Lark hai lượt (đọc đối chiếu rồi mới xoá, hàng rào
   *  CEO chốt 24/09); chỗ chờ đó không được im lặng. */
  const [daXoa, setDaXoa] = useState<string[]>([]);

  const lamMoi = () => router.refresh();

  const hienThi = dangKiem.filter((c) => !daXoa.includes(c.id));
  const chuaGui = hienThi.filter((c) => !c.larkRecordId);

  const gui = () =>
    start(async () => {
      try {
        const r = await guiLenLark(chuaGui.map((c) => c.id));
        if (r.daGui > 0) toast.success(`${r.daGui} chiếc đã vào hàng chờ QC.`, { duration: GIAY_VUI });
        if (r.boQua.length) {
          toast.error(`${r.boQua.length} chiếc chưa vào được — ` +
            r.boQua.map((b) => `${b.unitCode}: ${b.lyDo}`).join(' · '), { duration: GIAY_LOI });
        }
        lamMoi();
      } catch (e) {
        console.error('[kho-nhan] chuyển sang chờ QC lỗi:', e);
        toast.error('Không gọi được máy chủ. Thử lại, nếu vẫn lỗi thì báo kỹ thuật.', { duration: GIAY_LOI });
      }
    });

  /* KHÔNG dùng useTransition ở đây: `pending` dùng chung sẽ khoá mọi nút trên
   * bảng, trong khi việc đang chạy chỉ thuộc về một dòng. */
  const xoa = async (c: DangKiem) => {
    setDangXoa(c.id);
    try {
      const r = await xoaChiec(c.id);
      if (!r.ok) { toast.error(r.loi ?? 'Xoá thất bại.', { duration: GIAY_LOI }); return; }
      setDaXoa((d) => [...d, c.id]);
      toast.success(`Đã xoá ${c.unitCode} khỏi danh sách.`, { duration: GIAY_VUI });
    } catch (e) {
      // `finally` mà không `catch` thì lỗi máy chủ trôi đi im lặng, người dùng
      // chỉ thấy nút hết quay mà dòng vẫn còn — đã mắc đúng kiểu này ở ô tìm.
      console.error('[kho-nhan] xoá chiếc lỗi:', e);
      toast.error('Không gọi được máy chủ. Thử lại, nếu vẫn lỗi thì báo kỹ thuật.', { duration: GIAY_LOI });
    } finally {
      setDangXoa(null);
    }
  };

  const huyHet = () =>
    start(async () => {
      const r = await huyNhapChuaGui();
      if (!r.ok) { toast.error(r.loi ?? 'Huỷ nhập thất bại.', { duration: GIAY_LOI }); return; }
      toast.success(`Đã huỷ ${r.soXoa} chiếc chưa vào QC.`, { duration: GIAY_VUI });
      lamMoi();
    });

  return (
    <div className="space-y-6 pb-24">
      <OTimMonChoVe onDaNhan={lamMoi} />

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            Đang kiểm{' '}
            <span className="font-normal text-muted-foreground">({hienThi.length} chiếc)</span>
          </h2>
        </div>
        {hienThi.length === 0 ? (
          <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Chưa có chiếc nào chờ kiểm. Tìm món ở ô trên để ghi nhận hàng vừa về.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Mã chiếc</th>
                  <th className="px-3 py-2 text-left font-medium">Sản phẩm</th>
                  <th className="px-3 py-2 text-left font-medium">ID biến thể</th>
                  <th className="px-3 py-2 text-left font-medium">Mã đơn</th>
                  <th className="px-3 py-2 text-left font-medium">Nhận lúc</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {hienThi.map((c) => (
                  <tr
                    key={c.id}
                    className={`border-b border-border last:border-b-0 ${
                      dangXoa === c.id ? 'opacity-50' : ''
                    }`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{c.unitCode}</td>
                    <td className="max-w-[420px] px-3 py-2">
                      <span className="block truncate">{c.tenSanPham ?? c.sku}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{c.sku}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {soIdShopify(c.shopifyVariantId ?? '') ?? (
                        <span className="text-muted-foreground">chưa tra được</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{c.maDon ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{gio(c.taoLuc)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        {/* Chỉ kiểm được SAU khi chiếc đã vào hàng chờ QC (CEO
                            24/09): các bộ phận khác phải thấy trạng thái "Chờ
                            QC" trước đã. */}
                        {c.larkRecordId && (
                          <Button
                            type="button" size="sm" disabled={dangXoa === c.id}
                            onClick={() => setChon(c)}
                          >Kiểm</Button>
                        )}
                        {/* MỘT nút, MỘT nhát: `xoaChiec` tự lo thứ tự Lark →
                            bên mình. Việc đồng bộ Lark là đường ống tạm của
                            giai đoạn chạy song song hai hệ thống, người dùng
                            không cần biết (CEO 25/09). */}
                        <Button
                          type="button" variant="outline" size="sm"
                          disabled={dangXoa === c.id}
                          onClick={() => void xoa(c)}
                        >
                          {dangXoa === c.id ? 'Đang xoá…' : 'Xoá'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {chuaGui.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 print:hidden">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card px-4 py-2.5 shadow-lg">
            <span className="text-sm text-muted-foreground">
              {chuaGui.length} chiếc chờ bắt đầu QC
            </span>
            <Button type="button" variant="outline" size="lg" onClick={huyHet} disabled={pending}>
              Huỷ nhập
            </Button>
            <Button type="button" size="lg" onClick={gui} disabled={pending}>
              {pending ? 'Đang chuyển…' : 'Bắt đầu QC'}
            </Button>
          </div>
        </div>
      )}

      <ModalQc
        chiec={chon}
        coStorage={coStorage}
        onDong={() => setChon(null)}
        onXong={() => { setChon(null); lamMoi(); }}
      />
    </div>
  );
}
