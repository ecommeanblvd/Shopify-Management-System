import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  danhSachBaoLoi, demTheoTrangThai, lanXuLyGanNhat, suKienCuaCacBaoLoi,
} from '@/features/issue-report/queries';
import {
  TRANG_THAI, maBaoLoi, nhanModule, nhanMucDo, nhanTrangThai, trangThaiHopLe,
} from '@/features/issue-report/phan-loai';
import type { AnhBaoLoi } from '@/features/issue-report/anh';
import { DoiTrangThai } from './DoiTrangThai';

export const dynamic = 'force-dynamic';

const GIO = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short',
});

export default async function IssuesPage({ searchParams }: {
  searchParams: Promise<{ trangThai?: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_users')) redirect('/');

  const { trangThai } = await searchParams;
  const loc = trangThai && trangThaiHopLe(trangThai) ? trangThai : undefined;
  const [rows, dem, lanCuoi] = await Promise.all([
    danhSachBaoLoi({ trangThai: loc ? [loc] : undefined, gioiHan: 200 }),
    demTheoTrangThai(),
    lanXuLyGanNhat(),
  ]);
  const suKien = await suKienCuaCacBaoLoi(rows.map((r) => r.id));
  const canNguoi = dem['can_nguoi'] ?? 0;

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Báo lỗi</h1>
        <p className="text-sm text-muted-foreground">
          Lỗi người dùng báo từ các module. Tác vụ tự động hằng đêm đọc mục &quot;Mới&quot;, sửa, mở PR
          và ghi kết quả vào cột &quot;Xử lý&quot;. Mục <b>Cần người quyết</b> là việc cần anh.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Tóm tắt">
        {[
          { ma: 'moi', nhan: 'Mới, chưa xử lý' },
          { ma: 'dang_xu_ly', nhan: 'Đang xử lý' },
          { ma: 'cho_duyet', nhan: 'Chờ duyệt PR' },
          { ma: 'can_nguoi', nhan: 'Cần người quyết' },
        ].map((o) => (
          <Link key={o.ma} href={`/admin/issues?trangThai=${o.ma}`}
            className={`rounded-lg border p-3 ${(dem[o.ma] ?? 0) > 0 && (o.ma === 'can_nguoi' || o.ma === 'cho_duyet') ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20' : ''}`}>
            <div className="text-2xl font-semibold">{dem[o.ma] ?? 0}</div>
            <div className="text-xs text-muted-foreground">{o.nhan}</div>
          </Link>
        ))}
        <div className="rounded-lg border p-3">
          <div className="text-sm font-medium">{lanCuoi ? GIO.format(lanCuoi) : 'Chưa chạy'}</div>
          <div className="text-xs text-muted-foreground">Lần xử lý tự động gần nhất (chạy mỗi đêm ~1:41)</div>
        </div>
      </section>

      <nav className="flex flex-wrap gap-2 text-sm">
        <Link href="/admin/issues" className={`rounded-md border px-3 py-1 ${!loc ? 'bg-accent' : ''}`}>
          Tất cả
        </Link>
        {TRANG_THAI.map((t) => (
          <Link key={t.ma} href={`/admin/issues?trangThai=${t.ma}`}
            className={`rounded-md border px-3 py-1 ${loc === t.ma ? 'bg-accent' : ''} ${t.ma === 'can_nguoi' && canNguoi ? 'border-amber-500' : ''}`}>
            {t.nhan} · {dem[t.ma] ?? 0}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa có báo lỗi nào ở mục này.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-2 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{maBaoLoi(r.so)}</span>
                  <span className="font-medium">{r.title}</span>
                  <Badge variant="outline">{nhanModule(r.module)}</Badge>
                  <Badge variant={r.mucDo === 'cao' || r.mucDo === 'chan_cong_viec' ? 'destructive' : 'secondary'}>
                    {nhanMucDo(r.mucDo)}
                  </Badge>
                  <span className="ml-auto flex items-center gap-2">
                    <Badge variant="outline">{nhanTrangThai(r.trangThai)}</Badge>
                    <DoiTrangThai id={r.id} hienTai={r.trangThai} />
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{r.description}</p>
                {(r.anh as AnhBaoLoi[]).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {(r.anh as AnhBaoLoi[]).map((a, i) => (
                      <a key={a.key} href={`/admin/issues/${r.id}/anh/${i + 1}`} target="_blank" rel="noreferrer noopener">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/admin/issues/${r.id}/anh/${i + 1}`} alt={a.ten} loading="lazy"
                          className="h-24 w-auto rounded border object-cover" />
                      </a>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {r.reporterEmail ?? 'ẩn danh'} · {GIO.format(r.createdAt)} ·{' '}
                  <Link href={r.pagePath} className="underline">{r.pagePath}</Link>
                </p>
                {(r.ghiChuXuLy || r.prUrl) && (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">
                      Xử lý{r.xuLyLanCuoi ? ` · ${GIO.format(r.xuLyLanCuoi)}` : ''}
                    </div>
                    {r.ghiChuXuLy && <p className="whitespace-pre-wrap">{r.ghiChuXuLy}</p>}
                    {r.prUrl && /^https:\/\//.test(r.prUrl) && (
                      <a href={r.prUrl} target="_blank" rel="noreferrer noopener" className="underline">
                        Xem PR
                      </a>
                    )}
                  </div>
                )}
                {(suKien.get(r.id)?.length ?? 0) > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Dòng thời gian ({suKien.get(r.id)!.length})
                    </summary>
                    <ol className="mt-2 space-y-2 border-l pl-3">
                      {suKien.get(r.id)!.map((e) => (
                        <li key={e.id} className="text-xs">
                          <span className="text-muted-foreground">{GIO.format(e.luc)} · {e.nguoi}</span>
                          <div>
                            {e.tuTrangThai && e.denTrangThai && e.tuTrangThai !== e.denTrangThai
                              ? <>{nhanTrangThai(e.tuTrangThai)} → <b>{nhanTrangThai(e.denTrangThai)}</b></>
                              : e.denTrangThai ? <b>{nhanTrangThai(e.denTrangThai)}</b> : null}
                            {e.ghiChu && <p className="whitespace-pre-wrap text-muted-foreground">{e.ghiChu}</p>}
                            {e.prUrl && /^https:\/\//.test(e.prUrl) && (
                              <a href={e.prUrl} target="_blank" rel="noreferrer noopener" className="underline">Xem PR</a>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
