'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { ghiDongThung } from '@/features/dong-hang/actions';
import { canhBaoLechCan } from '@/features/dong-hang/dong-thung';
import { tongCanMon, moTaTongCan } from '@/features/dong-hang/can-du-kien';
import { Button } from '@/components/ui/button';
import type { KienDongHang } from '@/features/dong-hang/types';

/**
 * Bước ĐÓNG THÙNG: chọn thùng đã dùng rồi cân CẢ KIỆN (CEO 30/09/2026).
 *
 * Luồng CEO mô tả: lúc QC các bạn cân sản phẩm rồi đặt thử vào hộp để chọn loại hộp vừa, và
 * điền cân DỰ KIẾN SAU ĐÓNG cho từng món lên Lark. Tới bước này mới chọn thùng thật và cân cả
 * kiện — việc này trước nay KHÔNG có chỗ nhập ở đâu cả, kể cả Lark.
 *
 * Ô thùng để GÕ TỰ DO có chủ ý: hệ thống chưa có danh mục thùng (đo 30/09: 90 ngày chỉ 3/1.279
 * kiện có ghi thùng, và mã thùng là dòng vật tư bên Lark). Bịa ra một danh sách cứng là ép đội
 * kho chọn sai, rồi dữ liệu sai còn khó sửa hơn ô trống. Có danh sách thật thì đổi thành ô chọn.
 */
export function KhoiDongThung({ k }: { k: KienDongHang }) {
  const router = useRouter();
  const [hop, setHop] = useState(k.dongThung?.hop ?? k.hop ?? '');
  const [canKg, setCanKg] = useState(k.dongThung?.canKg != null ? String(k.dongThung.canKg) : '');
  const [dai, setDai] = useState(k.dongThung?.dims ? String(k.dongThung.dims.l) : '');
  const [rong, setRong] = useState(k.dongThung?.dims ? String(k.dongThung.dims.w) : '');
  const [cao, setCao] = useState(k.dongThung?.dims ? String(k.dongThung.dims.h) : '');
  const [loi, setLoi] = useState<string[]>([]);
  const [dangLuu, batDau] = useTransition();

  const duKien = tongCanMon(
    // Dựng lại danh sách món từ con số đã đếm sẵn ở truy vấn: đủ cân thì mỗi món một ô có số,
    // thiếu cân thì đúng bằng số món thiếu — `tongCanMon` chỉ cần biết CÓ thiếu hay không.
    Array.from({ length: k.canMon.soMon }, (_, i) =>
      i < k.canMon.soMon - k.canMon.soMonThieuCan
        ? { weightKg: (k.canMon.tongKg ?? 0) / Math.max(1, k.canMon.soMon - k.canMon.soMonThieuCan) }
        : { weightKg: null }),
  );
  const canSo = Number(canKg.replace(',', '.'));
  const canhBao = Number.isFinite(canSo) && canSo > 0 ? canhBaoLechCan(canSo, duKien.tongKg) : null;

  const luu = () => {
    setLoi([]);
    batDau(async () => {
      const r = await ghiDongThung(k.shipmentId, { hop, canKg, dai, rong, cao });
      if (r.ok) { toast.success('Đã ghi đóng thùng'); router.refresh(); return; }
      if (r.loi) setLoi(r.loi); else toast.error(r.error ?? 'Không lưu được');
    });
  };

  const o = 'h-9 w-full rounded-lg border border-input bg-background px-2 text-sm';

  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-sm font-semibold">Đóng thùng</h4>
        {k.dongThung && <span className="text-[11px] text-muted-foreground">đã ghi lúc {new Date(k.dongThung.luc).toLocaleString('vi-VN')}</span>}
      </div>

      {/* Số dự kiến là THAM CHIẾU, không phải số điền sẵn vào ô cân: nhiều món gộp một thùng
          thì tổng dự kiến (mỗi món tính một hộp) cao hơn cân kiện thật một cách hợp lệ. */}
      <p className="text-[11px] text-muted-foreground">{moTaTongCan(duKien)}</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <label className="col-span-2 text-xs">
          <span className="text-muted-foreground">Thùng đã dùng</span>
          <input className={o} value={hop} onChange={(e) => setHop(e.target.value)} placeholder="MEAN-BOX-30x25x20…" />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Cân cả kiện (kg)</span>
          <input className={o} value={canKg} onChange={(e) => setCanKg(e.target.value)} inputMode="decimal" placeholder="1,2" />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">D × R (cm)</span>
          <div className="flex gap-1">
            <input className={o} value={dai} onChange={(e) => setDai(e.target.value)} inputMode="decimal" placeholder="D" />
            <input className={o} value={rong} onChange={(e) => setRong(e.target.value)} inputMode="decimal" placeholder="R" />
          </div>
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Cao (cm)</span>
          <input className={o} value={cao} onChange={(e) => setCao(e.target.value)} inputMode="decimal" placeholder="C" />
        </label>
      </div>

      {canhBao && (
        /* NHẮC chứ không chặn — lệch lớn có thể hợp lệ, nhưng người đóng phải được thấy. */
        <p className="rounded-lg border border-amber-600/40 bg-amber-600/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">{canhBao}</p>
      )}
      {loi.length > 0 && (
        <ul className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {loi.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}

      <Button type="button" size="sm" onClick={luu} disabled={dangLuu} className="cursor-pointer">
        {dangLuu ? 'Đang lưu…' : k.dongThung ? 'Cập nhật' : 'Ghi đóng thùng'}
      </Button>
    </div>
  );
}
