import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { baoLoiTheoSo, demTrangThaiTrongPhamVi } from '@/features/issue-report/queries';
import { docThamSoBaoLoi } from '@/features/issue-report/doc-tham-so';
import { dungDuLieuModal } from '@/features/issue-report/dong-modal';
import { moduleXemDuoc } from '@/features/issue-report/pham-vi';
import { DANH_SACH_MODULE, TRANG_THAI, nhanModule } from '@/features/issue-report/phan-loai';
import { BangLichSuBaoLoi } from '@/components/issue-report/BangLichSuBaoLoi';
import { MoSanBaoLoi } from '@/components/issue-report/MoSanBaoLoi';

export const dynamic = 'force-dynamic';

/**
 * Trang xem rộng lịch sử báo lỗi.
 *
 * CỐ Ý KHÔNG có mục trong `NAV` — xem chú thích của `/f/nhat-ky` trong `lib/nav.ts`: CEO đã bỏ
 * đúng hình đó ngày 20/10/2026. Lối vào là liên kết "Xem đầy đủ" trong panel Báo lỗi, và link
 * người này gửi người kia (`?bl=<số>`).
 */
export default async function TrangBaoLoi({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const roleKey = await getRole(session.user.id);
  if (!hasPermission(roleKey, 'view_bao_loi')) redirect('/');
  const userId = session.user.id;

  const sp = await searchParams;
  const ts = docThamSoBaoLoi(new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v] as [string, string]] : [])),
  ));

  const [dem, pv] = await Promise.all([
    demTrangThaiTrongPhamVi({ roleKey, userId }),
    Promise.resolve(moduleXemDuoc(roleKey)),
  ]);

  /* `?bl=` tra riêng: báo lỗi được trỏ tới có thể không nằm trong 20 dòng đầu của danh sách.
   * Ngoài phạm vi ⇒ `baoLoiTheoSo` trả null ⇒ hiện "không tìm thấy". ĐỪNG nói "không có quyền":
   * câu đó xác nhận báo lỗi đó tồn tại. */
  const mot = ts.so == null ? null : await baoLoiTheoSo({ so: ts.so, roleKey, userId });
  const duMot = mot ? await dungDuLieuModal([mot], { roleKey, userId }) : null;

  const moduleThayDuoc = pv.tatCa
    ? DANH_SACH_MODULE
    : DANH_SACH_MODULE.filter((m) => pv.module.has(m.ma));

  const lien = (them: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const hien: Record<string, string | null> = {
      trangThai: ts.trangThai, module: ts.module, ...them,
    };
    for (const [k, v] of Object.entries(hien)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/f/bao-loi?${s}` : '/f/bao-loi';
  };

  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-xl font-semibold">Lịch sử báo lỗi</h1>
        <p className="text-sm text-muted-foreground">
          {pv.tatCa
            ? 'Báo lỗi của mọi bộ phận.'
            : 'Báo lỗi của những màn bạn mở được, cộng báo lỗi do chính bạn gửi.'}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-6" aria-label="Tóm tắt">
        {TRANG_THAI.map((t) => (
          <Link key={t.ma} href={lien({ trangThai: ts.trangThai === t.ma ? null : t.ma })}
            className={`rounded-lg border border-border p-3 ${ts.trangThai === t.ma ? 'bg-accent' : ''}`}>
            <div className="text-2xl font-semibold">{dem[t.ma] ?? 0}</div>
            <div className="text-xs text-muted-foreground">{t.nhan}</div>
          </Link>
        ))}
      </section>

      {moduleThayDuoc.length > 1 && (
        <form method="get" className="flex flex-wrap items-end gap-2">
          {ts.trangThai && <input type="hidden" name="trangThai" value={ts.trangThai} />}
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Module</span>
            <select name="module" defaultValue={ts.module ?? ''}
              className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm">
              <option value="">Tất cả module bạn thấy được</option>
              {moduleThayDuoc.map((m) => (
                <option key={m.ma} value={m.ma}>{nhanModule(m.ma)}</option>
              ))}
            </select>
          </label>
          <button type="submit"
            className="h-9 cursor-pointer rounded-lg border border-input px-3 text-sm hover:bg-accent">
            Lọc
          </button>
          {(ts.module || ts.trangThai) && (
            <Link href="/f/bao-loi" className="h-9 px-1 pt-2 text-xs underline">Bỏ lọc</Link>
          )}
        </form>
      )}

      {ts.so != null && mot == null && (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          Không tìm thấy báo lỗi BL-{ts.so}.
        </p>
      )}

      <BangLichSuBaoLoi module={ts.module ?? undefined} trangThai={ts.trangThai ?? undefined}
        hienNhanModule />

      {duMot && duMot.dong[0] && (
        <MoSanBaoLoi baoLoi={duMot.dong[0]} suKien={duMot.suKien[duMot.dong[0].id] ?? []}
          tenNguoi={duMot.tenNguoi} />
      )}
    </div>
  );
}
