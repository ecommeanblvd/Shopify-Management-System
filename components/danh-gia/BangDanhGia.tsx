'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  TRANG, TRANG_THAI, nhanKenh, nhanTrang, nhanTrangThai,
} from '@/features/danh-gia/phan-loai';
import type { DongDanhGiaUI } from '@/features/danh-gia/types';
import type { TongHopDanhGia } from '@/features/danh-gia/queries';
import { GhiDanhGia } from './GhiDanhGia';
import { ModalDanhGia } from './ModalDanhGia';

interface Props {
  danhGia: DongDanhGiaUI[];
  tongHop: TongHopDanhGia;
  brands: string[];
  coQuyenGhi: boolean;
  loc: { soSao: string; trang: string; trangThai: string; vendor: string; canChua: boolean };
}

/** Sao hiển thị bằng ký tự, không dùng ảnh — đọc được cả khi copy ra text. */
function Sao({ n }: { n: number }) {
  return (
    <span
      className={n <= 2 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}
      title={`${n} sao`}
    >
      {'★'.repeat(n)}
      <span className="text-muted-foreground">{'☆'.repeat(5 - n)}</span>
    </span>
  );
}

export function BangDanhGia({ danhGia, tongHop, brands, coQuyenGhi, loc }: Props) {
  const router = useRouter();
  const [moGhi, setMoGhi] = useState(false);
  const [xem, setXem] = useState<string | null>(null);
  const [, start] = useTransition();

  function doiLoc(next: Partial<typeof loc>) {
    const v = { ...loc, ...next };
    const q = new URLSearchParams();
    if (v.soSao) q.set('sao', v.soSao);
    if (v.trang) q.set('trang', v.trang);
    if (v.trangThai) q.set('tt', v.trangThai);
    if (v.vendor) q.set('brand', v.vendor);
    if (v.canChua) q.set('cc', '1');
    const s = q.toString();
    start(() => router.push(`/f/cx/danh-gia${s ? `?${s}` : ''}`));
  }

  const maxSao = Math.max(1, ...tongHop.theoSao.map((x) => x.soCa));

  return (
    <div className="space-y-6">
      {/* Tổng hợp. CỐ Ý không có số sao trung bình — phân bố hai cực làm nó vô nghĩa. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-border p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Cần chữa</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-red-600 dark:text-red-400">
            {tongHop.soCanChua}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            đánh giá 1–2 sao chưa trả lời hoặc lưu trữ
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Tổng {tongHop.soCa} đánh giá. Không hiện số sao trung bình: phân bố chia
            hai cực nên trung bình không mô tả gì thật.
          </p>
        </section>

        <section className="rounded-lg border border-border p-4">
          <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Phân bố theo số sao
          </h3>
          <ul className="space-y-1.5">
            {tongHop.theoSao.map((x) => (
              <li key={x.soSao} className="flex items-center gap-2 text-sm">
                <span className="w-16 shrink-0"><Sao n={x.soSao} /></span>
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className={`block h-full rounded-full ${x.soSao <= 2 ? 'bg-red-500/60' : 'bg-amber-500/60'}`}
                    style={{ width: `${Math.round((x.soCa / maxSao) * 100)}%` }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">
                  {x.soCa}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-border">
          <h3 className="border-b border-border px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground">
            1 sao theo brand
          </h3>
          {tongHop.theoBrand.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Chưa có đánh giá nào.</p>
          ) : (
            <ul className="divide-y divide-border">
              {tongHop.theoBrand.slice(0, 7).map((b) => (
                <li key={b.brand} className="flex items-baseline justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate text-sm">
                    {b.brand === '(chưa rõ brand)'
                      ? <span className="text-muted-foreground">chưa rõ brand</span>
                      : b.brand}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums">
                    <span className={b.soMotSao > 0 ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'}>
                      {b.soMotSao} ca 1 sao
                    </span>
                    <span className="text-muted-foreground"> / {b.soCa}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Danh sách đánh giá</h2>
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-sm">
            <input
              type="checkbox" checked={loc.canChua}
              onChange={(e) => doiLoc({ canChua: e.target.checked })}
            />
            Chỉ ca cần chữa
          </label>
          <select
            value={loc.soSao} onChange={(e) => doiLoc({ soSao: e.target.value })}
            aria-label="Lọc theo số sao"
            className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">Mọi số sao</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={String(n)}>{n} sao</option>)}
          </select>
          <select
            value={loc.trang} onChange={(e) => doiLoc({ trang: e.target.value })}
            aria-label="Lọc theo trang đánh giá"
            className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">Mọi trang</option>
            {TRANG.map((t) => <option key={t.ma} value={t.ma}>{t.ten}</option>)}
          </select>
          <select
            value={loc.trangThai} onChange={(e) => doiLoc({ trangThai: e.target.value })}
            aria-label="Lọc theo trạng thái"
            className="h-9 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">Mọi trạng thái</option>
            {TRANG_THAI.map((t) => <option key={t.ma} value={t.ma}>{t.ten}</option>)}
          </select>
          {brands.length > 0 && (
            <select
              value={loc.vendor} onChange={(e) => doiLoc({ vendor: e.target.value })}
              aria-label="Lọc theo brand"
              className="h-9 max-w-44 cursor-pointer rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="">Mọi brand</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          {coQuyenGhi && (
            <Button type="button" size="sm" onClick={() => setMoGhi(true)}>Ghi đánh giá</Button>
          )}
        </div>

        {danhGia.length === 0 ? (
          <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">
            Không có đánh giá nào khớp bộ lọc.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Ngày</th>
                  <th className="px-3 py-2 font-medium">Sao</th>
                  <th className="px-3 py-2 font-medium">Nội dung</th>
                  <th className="px-3 py-2 font-medium">Brand</th>
                  <th className="px-3 py-2 font-medium">Trang</th>
                  <th className="px-3 py-2 font-medium">Kênh</th>
                  <th className="px-3 py-2 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {danhGia.map((d) => (
                  <tr
                    key={d.id} onClick={() => setXem(d.id)}
                    className="cursor-pointer border-t border-border hover:bg-muted/50"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{d.ngay}</td>
                    <td className="whitespace-nowrap px-3 py-2"><Sao n={d.soSao} /></td>
                    <td className="max-w-[360px] px-3 py-2">
                      <span className="block truncate">{d.noiDung ?? '—'}</span>
                      {(d.maDon || d.quocGia) && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {d.maDon}
                          {d.maDon && d.quocGia && ' · '}
                          {d.quocGia}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[140px] px-3 py-2 text-xs">
                      {d.vendor ?? <span className="text-muted-foreground">chưa rõ</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{nhanTrang(d.trang)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{nhanKenh(d.kenhLienHe)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{nhanTrangThai(d.trangThai)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={moGhi} onOpenChange={setMoGhi}>
        <DialogContent className="max-h-[92vh] w-full overflow-y-auto sm:max-w-[720px]">
          <DialogTitle className="text-base font-semibold">Ghi đánh giá</DialogTitle>
          <GhiDanhGia onXong={() => { setMoGhi(false); router.refresh(); }} />
        </DialogContent>
      </Dialog>

      <ModalDanhGia
        id={xem} danhGia={danhGia.find((x) => x.id === xem) ?? null}
        coQuyenGhi={coQuyenGhi}
        onDong={() => setXem(null)} onDoi={() => router.refresh()}
      />
    </div>
  );
}
