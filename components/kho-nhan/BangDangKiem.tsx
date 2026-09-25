'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { soIdShopify } from '@/features/receiving/ma-tem';
import type { DangKiem } from '@/features/kho-nhan/types';
import { Button } from '@/components/ui/button';
import { guiLenLark, goKhoiLark } from '@/features/kho-nhan/day-wh-lark';
import { goChiecNhanNham, huyNhapChuaGui } from '@/features/kho-nhan/nhan-actions';
import { OTimMonChoVe } from './OTimMonChoVe';
import { ModalQc } from './ModalQc';

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
  const [ketQuaGui, setKetQuaGui] = useState<string | null>(null);
  const [loiGui, setLoiGui] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const lamMoi = () => router.refresh();

  const chuaGui = dangKiem.filter((c) => !c.larkRecordId);

  const gui = () =>
    start(async () => {
      setKetQuaGui(null); setLoiGui(null);
      try {
        const r = await guiLenLark(chuaGui.map((c) => c.id));
        setKetQuaGui(`${r.daGui} chiếc đã vào hàng chờ QC.`);
        if (r.boQua.length) {
          setLoiGui(`${r.boQua.length} chiếc chưa vào được — ` +
            r.boQua.map((b) => `${b.unitCode}: ${b.lyDo}`).join(' · '));
        }
        lamMoi();
      } catch (e) {
        console.error('[kho-nhan] chuyển sang chờ QC lỗi:', e);
        setLoiGui('Không gọi được máy chủ. Thử lại, nếu vẫn lỗi thì báo kỹ thuật.');
      }
    });

  const goNham = (c: DangKiem) =>
    start(async () => {
      setKetQuaGui(null); setLoiGui(null);
      const r = await goChiecNhanNham(c.id);
      if (!r.ok) { setLoiGui(r.loi ?? 'Gỡ thất bại.'); return; }
      setKetQuaGui(`Đã gỡ ${c.unitCode} khỏi danh sách.`);
      lamMoi();
    });

  const huyHet = () =>
    start(async () => {
      setKetQuaGui(null); setLoiGui(null);
      const r = await huyNhapChuaGui();
      if (!r.ok) { setLoiGui(r.loi ?? 'Huỷ nhập thất bại.'); return; }
      setKetQuaGui(`Đã huỷ ${r.soXoa} chiếc chưa vào QC.`);
      lamMoi();
    });

  const go = (c: DangKiem) =>
    start(async () => {
      setKetQuaGui(null); setLoiGui(null);
      const r = await goKhoiLark(c.id);
      if (!r.ok) { setLoiGui(r.loi ?? 'Gỡ thất bại.'); return; }
      setKetQuaGui(`Đã gỡ ${c.unitCode} khỏi danh sách.`);
      lamMoi();
    });

  return (
    <div className="space-y-6 pb-24">
      <OTimMonChoVe onDaNhan={lamMoi} />

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            Đang kiểm{' '}
            <span className="font-normal text-muted-foreground">({dangKiem.length} chiếc)</span>
          </h2>
        </div>
        {ketQuaGui && <p className="text-sm text-emerald-600 dark:text-emerald-400">{ketQuaGui}</p>}
        {loiGui && <p className="text-sm text-amber-600 dark:text-amber-400">{loiGui}</p>}

        {dangKiem.length === 0 ? (
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
                {dangKiem.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-b-0">
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
                          <Button type="button" size="sm" onClick={() => setChon(c)}>Kiểm</Button>
                        )}
                        {/* MỘT nhãn cho cả hai trạng thái: việc đồng bộ Lark là
                            đường ống tạm thời của giai đoạn chạy song song hai
                            hệ thống, người dùng không cần biết (CEO 25/09).
                            Chiếc đã vào chờ QC thì `go` xoá dòng Lark TRƯỚC rồi
                            mới gỡ bên mình — ngược lại là Lark còn dòng mà bên
                            mình mất dấu. */}
                        <Button
                          type="button" variant="outline" size="sm" disabled={pending}
                          onClick={() => (c.larkRecordId ? go(c) : goNham(c))}
                        >
                          Gỡ
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
