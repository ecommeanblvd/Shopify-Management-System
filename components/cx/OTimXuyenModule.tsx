'use client';

import { useRouter } from 'next/navigation';
import { timXuyenModule, type HoSoTim, type KetQuaTimCx } from '@/features/cx/tim-kiem';
import { dungTimDong } from './dung-tim-dong';

const NHAN_MODULE: Record<string, string> = {
  ticket: 'Việc cần làm',
  doi_tra: 'Đổi trả',
  tranh_chap: 'Tranh chấp',
  su_co: 'Sự cố',
  danh_gia: 'Đánh giá',
};

/**
 * Ô tìm xuyên module — bản rẻ của "nhìn một đơn có gì".
 *
 * Đo 28/09: chỉ 15/616 đơn (2,4%) có hồ sơ ở nhiều hơn một module, nên một màn
 * 360° riêng sẽ trống 97,6% số lần mở. Dưới dạng kết quả tìm, một hồ sơ là một
 * dòng — không phải một trang trống bốn khối.
 */
export function OTimXuyenModule() {
  const router = useRouter();
  const o = dungTimDong<HoSoTim>(
    async (q) => (await timXuyenModule(q)).hoSo,
    { toiThieu: 3 },
  );

  // Nhóm theo module, giữ thứ tự khai trong NHAN_MODULE để vị trí không nhảy.
  const nhom = Object.keys(NHAN_MODULE)
    .map((m) => ({ m, ds: o.hienThi.filter((x) => x.module === m) }))
    .filter((x) => x.ds.length > 0);

  return (
    <div className="relative">
      <input
        value={o.tuKhoa}
        onChange={(e) => o.doiTuKhoa(e.target.value)}
        placeholder="Tìm mã đơn hoặc email khách trong mọi hồ sơ CX"
        aria-label="Tìm mã đơn hoặc email khách trong mọi hồ sơ CX"
        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20"
      />

      {!o.duNgan && (
        <div className="absolute inset-x-0 top-11 z-20 max-h-[420px] overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {o.loiGoi ? (
            <p className="px-3 py-3 text-sm text-destructive">{o.loiGoi}</p>
          ) : o.dangTim && o.hienThi.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Đang tìm…</p>
          ) : o.hienThi.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              Không có hồ sơ CX nào khớp “{o.ky}”.
            </p>
          ) : (
            nhom.map(({ m, ds }) => (
              <section key={m}>
                <h3 className="sticky top-0 border-b border-border bg-muted/80 px-3 py-1.5 text-xs uppercase tracking-wider text-muted-foreground backdrop-blur">
                  {NHAN_MODULE[m]} ({ds.length})
                </h3>
                <ul>
                  {ds.map((h) => (
                    <li key={`${h.module}-${h.id}`} className="border-b border-border last:border-b-0">
                      <button
                        type="button"
                        onClick={() => { o.xoa(); router.push(h.href); }}
                        className="w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-muted"
                      >
                        <span className="block truncate">{h.nhan}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[h.ma, h.maDon, h.phu].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export type { KetQuaTimCx };
