'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { docLichSuBaoLoi, type LichSuBaoLoi } from '@/features/issue-report/actions';
import { maBaoLoi, nhanModule, nhanTrangThai } from '@/features/issue-report/phan-loai';
import { nhanNguoiBao } from '@/features/issue-report/trinh-bay';
import { ModalChiTietBaoLoi } from './ModalChiTietBaoLoi';

const GIO = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short',
});

/** Trạng thái coi là ĐÃ ĐÓNG — để nhân sự phân biệt "xong rồi" với "vẫn đang treo". */
const DA_XONG = new Set(['da_xong', 'tu_choi']);

/**
 * Danh sách báo lỗi + modal chi tiết. Dùng cho CẢ tab trong panel và trang rộng `/f/bao-loi`.
 *
 * Tải qua server action thay vì nhận props từ server component: tab trong panel chỉ mở khi người
 * dùng bấm, nên nạp sẵn ở mọi lượt dựng trang là tốn một truy vấn cho việc chưa chắc ai xem.
 */
export function BangLichSuBaoLoi({ module, trangThai, gioiHan, hienNhanModule }: {
  /** Lọc theo một module; để trống là xem mọi module trong phạm vi. */
  module?: string;
  /** Lọc theo trạng thái; để trống là mọi trạng thái. */
  trangThai?: string;
  /** Trần số dòng. Mặc định 20 cho panel; trang rộng truyền cao hơn. */
  gioiHan?: number;
  /** Hiện thêm chip module trên mỗi dòng — trang rộng cần, tab trong panel thì không. */
  hienNhanModule?: boolean;
}) {
  const [kq, setKq] = useState<LichSuBaoLoi | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [mo, setMo] = useState<string | null>(null);
  const [dangTai, batDau] = useTransition();

  useEffect(() => {
    batDau(async () => {
      const r = await docLichSuBaoLoi({ module, trangThai, gioiHan });
      if (r.ok) { setKq(r.kq); setLoi(null); } else { setKq(null); setLoi(r.loi); }
    });
    // `batDau` từ useTransition ổn định giữa các lượt dựng; chỉ `module` mới đáng nạp lại.
  }, [module, trangThai, gioiHan]);

  if (loi) return <p className="px-1 py-3 text-sm text-muted-foreground">{loi}</p>;
  if (!kq) return <p className="px-1 py-3 text-sm text-muted-foreground">{dangTai ? 'Đang tải…' : ''}</p>;

  const dongMo = kq.dong.find((d) => d.id === mo) ?? null;

  return (
    <div className="space-y-2">
      {!kq.trongPhamVi && (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Màn này thuộc nhóm chỉ quản lý xem được. Bạn vẫn thấy báo lỗi do chính bạn gửi.
        </p>
      )}

      {kq.dong.length === 0 ? (
        <p className="px-1 py-3 text-sm text-muted-foreground">Chưa có báo lỗi nào ở đây.</p>
      ) : (
        <ul className="divide-y divide-border">
          {kq.dong.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => setMo(d.id)}
                className="w-full cursor-pointer px-1 py-2.5 text-left hover:bg-accent/50">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{maBaoLoi(d.so)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.title}</span>
                  <Badge variant={DA_XONG.has(d.trangThai) ? 'secondary' : 'outline'}>
                    {nhanTrangThai(d.trangThai)}
                  </Badge>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {hienNhanModule && <span>{nhanModule(d.module)} ·</span>}
                  <span>{nhanNguoiBao({ ten: d.tenNguoiBao, email: d.emailNguoiBao })}</span>
                  <span>· {GIO.format(new Date(d.createdAt))}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {kq.dong.length > 0 && kq.dong.length === (gioiHan ?? 20) && (
        <p className="px-1 pt-1 text-xs text-muted-foreground">
          Đang xem {kq.dong.length} báo lỗi gần nhất. Có thể còn cũ hơn — lọc theo trạng thái
          hoặc module để thu hẹp.
        </p>
      )}

      {!hienNhanModule && (
        <Link href="/f/bao-loi" className="inline-block px-1 pt-1 text-xs underline">
          Xem đầy đủ
        </Link>
      )}

      <ModalChiTietBaoLoi
        baoLoi={dongMo}
        suKien={dongMo ? (kq.suKien[dongMo.id] ?? []) : []}
        tenNguoi={kq.tenNguoi}
        mo={mo !== null}
        onMoChange={(v) => { if (!v) setMo(null); }}
      />
    </div>
  );
}
