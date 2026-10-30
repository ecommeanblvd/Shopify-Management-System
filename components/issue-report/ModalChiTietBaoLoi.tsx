'use client';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import type { AnhBaoLoi } from '@/features/issue-report/anh';
import { maBaoLoi, nhanModule, nhanMucDo, nhanTrangThai } from '@/features/issue-report/phan-loai';
import {
  CAU_DUONG_TU_DONG, cauChuaXuLy, laLienKetAnToan, nhanNguoiBao, nhanNguoiSuKien,
} from '@/features/issue-report/trinh-bay';

const GIO = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short',
});

/** Đúng những trường modal cần — không nhận cả dòng CSDL để không kéo cột mới ra client. */
export interface DongBaoLoi {
  id: string;
  so: number;
  module: string;
  pagePath: string;
  title: string;
  description: string;
  mucDo: string;
  trangThai: string;
  anh: AnhBaoLoi[];
  ghiChuXuLy: string | null;
  prUrl: string | null;
  xuLyLanCuoi: string | null;
  createdAt: string;
  tenNguoiBao: string | null;
  emailNguoiBao: string | null;
}

export interface DongSuKien {
  id: string;
  luc: string;
  nguoi: string;
  tuTrangThai: string | null;
  denTrangThai: string | null;
  ghiChu: string | null;
  prUrl: string | null;
}

const gio = (s: string | null) => (s ? GIO.format(new Date(s)) : '—');

/**
 * Modal chi tiết báo lỗi cho NHÂN SỰ — chỉ đọc, không có nút đổi trạng thái.
 *
 * `xemAnh` là boolean TÍNH SẴN ở server, không gọi `xemDuocAnh` tại đây: hàm đó đọc cache quyền
 * ở tiến trình server, component client không với tới được.
 *
 * KHÔNG thêm `relative` vào `DialogContent` (bản gốc là `fixed top-1/2 left-1/2 -translate-*`,
 * twMerge sẽ đè mất `fixed`), và bề rộng phải khai bằng `sm:max-w-*` — `max-w-*` là class chết,
 * `components/ui/dialog-max-w.test.ts` chặn việc đó.
 */
export function ModalChiTietBaoLoi({
  baoLoi, suKien, xemAnh, tenNguoi, mo, onMoChange,
}: {
  baoLoi: DongBaoLoi | null;
  suKien: DongSuKien[];
  xemAnh: boolean;
  /** email → tên, để dòng thời gian hiện tên thay vì email đồng nghiệp. */
  tenNguoi: Record<string, string>;
  mo: boolean;
  onMoChange: (v: boolean) => void;
}) {
  const ten = new Map(Object.entries(tenNguoi));
  return (
    <Dialog open={mo && baoLoi !== null} onOpenChange={onMoChange}>
      <DialogContent className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        {baoLoi && (
          <>
            <div className="border-b border-border px-5 py-4">
              <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
                <span className="font-mono text-xs text-muted-foreground">{maBaoLoi(baoLoi.so)}</span>
                <span className="font-medium">{baoLoi.title}</span>
              </DialogTitle>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{nhanModule(baoLoi.module)}</Badge>
                <Badge variant={baoLoi.mucDo === 'cao' || baoLoi.mucDo === 'chan_cong_viec' ? 'destructive' : 'secondary'}>
                  {nhanMucDo(baoLoi.mucDo)}
                </Badge>
                <Badge variant="outline">{nhanTrangThai(baoLoi.trangThai)}</Badge>
              </div>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lỗi ở đâu</h3>
                <p className="whitespace-pre-wrap text-sm">{baoLoi.description}</p>
                {baoLoi.anh.length > 0 && (xemAnh ? (
                  <div className="flex flex-wrap gap-2">
                    {baoLoi.anh.map((a, i) => (
                      <a key={a.key} href={`/f/bao-loi/${baoLoi.id}/anh/${i + 1}`}
                        target="_blank" rel="noreferrer noopener">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/f/bao-loi/${baoLoi.id}/anh/${i + 1}`} alt={a.ten} loading="lazy"
                          className="h-24 w-auto rounded border border-border object-cover" />
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                    Báo lỗi này có {baoLoi.anh.length} ảnh. Chỉ người báo và quản lý xem được.
                  </p>
                ))}
                <p className="text-xs text-muted-foreground">
                  {nhanNguoiBao({ ten: baoLoi.tenNguoiBao, email: baoLoi.emailNguoiBao })}
                  {' · '}{gio(baoLoi.createdAt)}{' · '}
                  <span className="font-mono">{baoLoi.pagePath}</span>
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Đã xử lý thế nào{baoLoi.xuLyLanCuoi ? ` · ${gio(baoLoi.xuLyLanCuoi)}` : ''}
                </h3>
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                  {baoLoi.ghiChuXuLy
                    ? <p className="whitespace-pre-wrap">{baoLoi.ghiChuXuLy}</p>
                    : <p className="text-muted-foreground">{cauChuaXuLy(baoLoi.trangThai)}</p>}
                  {laLienKetAnToan(baoLoi.prUrl) && (
                    <a href={baoLoi.prUrl!} target="_blank" rel="noreferrer noopener"
                      className="mt-2 inline-block text-xs underline">Xem bản vá</a>
                  )}
                </div>
              </section>

              {suKien.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Dòng thời gian ({suKien.length})
                  </h3>
                  <ol className="space-y-2 border-l border-border pl-3">
                    {suKien.map((e) => (
                      <li key={e.id} className="text-xs">
                        <span className="text-muted-foreground">
                          {gio(e.luc)} · {nhanNguoiSuKien(e.nguoi, ten)}
                        </span>
                        <div>
                          {e.tuTrangThai && e.denTrangThai && e.tuTrangThai !== e.denTrangThai
                            ? <>{nhanTrangThai(e.tuTrangThai)} → <b>{nhanTrangThai(e.denTrangThai)}</b></>
                            : e.denTrangThai ? <b>{nhanTrangThai(e.denTrangThai)}</b> : null}
                          {e.ghiChu && <p className="whitespace-pre-wrap text-muted-foreground">{e.ghiChu}</p>}
                          {laLienKetAnToan(e.prUrl) && (
                            <a href={e.prUrl!} target="_blank" rel="noreferrer noopener"
                              className="underline">Xem bản vá</a>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                  <p className="text-xs text-muted-foreground">{CAU_DUONG_TU_DONG}</p>
                </section>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
