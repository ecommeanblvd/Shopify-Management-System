'use client';

import { useState, useTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { taoLinkPhuPhi, thuHoiLinkPhuPhi } from '@/features/ship-ho/trang-phu-phi/actions';
import { duongDanLink } from '@/features/ship-ho/trang-phu-phi/link-token';

interface DongBrand {
  brandSlug: string;
  tenBrand: string;
  token: string | null;
  taoLuc: string | null;
}

export function KhoiLinkPhuPhi({ dong, canManage }: { dong: DongBrand[]; canManage: boolean }) {
  const [pending, start] = useTransition();
  /* `dangChay` theo từng brand chứ không dùng chung `pending`: một `useTransition` cho cả bảng
   * thì bấm một dòng là KHOÁ hết mọi dòng, và không ai biết dòng nào đang chạy. */
  const [dangChay, setDangChay] = useState<string | null>(null);
  const [daChep, setDaChep] = useState<string | null>(null);
  const [loi, setLoi] = useState<string | null>(null);

  const tao = (slug: string) =>
    start(async () => {
      setLoi(null); setDangChay(slug);
      const r = await taoLinkPhuPhi(slug);
      if (!r.ok) setLoi(r.loi ?? 'Không tạo được link.');
      setDangChay(null);
    });

  const thuHoi = (slug: string) =>
    start(async () => {
      setLoi(null); setDangChay(slug);
      const r = await thuHoiLinkPhuPhi(slug);
      if (!r.ok) setLoi(r.loi ?? 'Không thu hồi được link.');
      setDangChay(null);
    });

  const chep = async (slug: string, token: string) => {
    try {
      await navigator.clipboard.writeText(duongDanLink(window.location.origin, token));
      setDaChep(slug);
      setTimeout(() => setDaChep((x) => (x === slug ? null : x)), 2000);
    } catch {
      // Trình duyệt chặn clipboard (http, hoặc người dùng từ chối) — nói ra, đừng im lặng.
      setLoi('Trình duyệt không cho chép. Chọn link rồi chép tay.');
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Link xem phụ phí cho brand</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Mỗi brand một link riêng, dẫn nguồn phụ phí của những hãng brand đó đã đi. Tạo link mới
            sẽ tự thu hồi link cũ — link cũ ngừng mở được ngay.
          </p>
        </div>
        {loi && <p className="text-sm text-red-600">{loi}</p>}
        <ul className="divide-y divide-border">
          {dong.map((d) => {
            const ban = pending && dangChay === d.brandSlug;
            return (
              <li key={d.brandSlug} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-40 font-medium">{d.tenBrand}</span>
                {d.token ? (
                  <>
                    <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                      /pp/{d.token}
                    </code>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      tạo {d.taoLuc}
                    </span>
                    <Button
                      variant="outline" size="sm" className="cursor-pointer"
                      onClick={() => chep(d.brandSlug, d.token!)}
                    >
                      {daChep === d.brandSlug ? 'Đã chép' : 'Chép link'}
                    </Button>
                    {canManage && (
                      <Button
                        variant="outline" size="sm" className="cursor-pointer"
                        disabled={ban} onClick={() => thuHoi(d.brandSlug)}
                      >
                        {ban ? 'Đang chạy…' : 'Thu hồi'}
                      </Button>
                    )}
                    {canManage && (
                      <Button
                        variant="outline" size="sm" className="cursor-pointer"
                        disabled={ban} onClick={() => tao(d.brandSlug)}
                      >
                        {ban ? 'Đang chạy…' : 'Đổi link'}
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-muted-foreground">Chưa có link</span>
                    {canManage && (
                      <Button
                        size="sm" className="cursor-pointer"
                        disabled={ban} onClick={() => tao(d.brandSlug)}
                      >
                        {ban ? 'Đang tạo…' : 'Tạo link'}
                      </Button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
