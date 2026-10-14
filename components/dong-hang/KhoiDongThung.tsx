'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ghiDongThung } from '@/features/dong-hang/actions';
import { canhBaoLechCan } from '@/features/dong-hang/dong-thung';
import { tongCanMon, moTaTongCan } from '@/features/dong-hang/can-du-kien';
import { daSuaDim } from '@/features/dong-hang/loc-box';
import { Button } from '@/components/ui/button';
import type { KienDongHang } from '@/features/dong-hang/types';
import type { BoxHien } from '@/features/dong-hang/tron-box';
import { ChonBox } from './ChonBox';

/**
 * Bước ĐÓNG THÙNG: chọn thùng đã dùng rồi cân CẢ KIỆN (CEO 30/09/2026).
 *
 * Luồng CEO mô tả: lúc QC các bạn cân sản phẩm rồi đặt thử vào hộp để chọn loại hộp vừa, và
 * điền cân DỰ KIẾN SAU ĐÓNG cho từng món lên Lark. Tới bước này mới chọn thùng thật và cân cả
 * kiện — việc này trước nay KHÔNG có chỗ nhập ở đâu cả, kể cả Lark.
 *
 * Từng GÕ TỰ DO vì hệ thống chưa có danh mục thùng (đo 30/09: 90 ngày chỉ 3/1.279 kiện có ghi
 * thùng). Danh mục nay dựng được từ kho (`lark_wh_inventory` + `box_dong_goi`, `danhSachBox`
 * ở `features/dong-hang/queries.ts`) nên đổi sang lưới chọn (`ChonBox`) — chọn một box là có
 * sẵn dài-rộng-cao, SỬA ĐƯỢC. Giữ nguyên ba ô dài/rộng/cao và ô hộp ở dạng gõ tay: box lạ
 * (chưa có trong danh mục) KHÔNG được chặn việc đóng hàng (CEO chốt).
 *
 * `dsBox` do trang `/f/dong-hang` tải (`danhSachBox()`) và truyền xuống qua `BangDongHang`.
 * BẮT BUỘC (không có giá trị mặc định) — một bản vá trước từng để prop này tuỳ chọn với
 * `= []`, khối render "bình thường" với lưới rỗng mà không ai nhận ra chẳng có gì nối tới nó.
 * Danh mục rỗng vẫn là một trạng thái THẬT (database mới dựng, hay mọi dòng kho thiếu kích
 * thước) — nhưng phải do nơi gọi TRUYỀN `[]` một cách có ý, để thiếu dây là `tsc` báo lỗi
 * ngay, không phải lặng lẽ "chạy được".
 */
export function KhoiDongThung({ k, dsBox }: { k: KienDongHang; dsBox: BoxHien[] }) {
  const router = useRouter();
  const [hop, setHop] = useState(k.dongThung?.hop ?? k.hop ?? '');
  const [canKg, setCanKg] = useState(k.dongThung?.canKg != null ? String(k.dongThung.canKg) : '');
  const [dai, setDai] = useState(k.dongThung?.dims ? String(k.dongThung.dims.l) : '');
  const [rong, setRong] = useState(k.dongThung?.dims ? String(k.dongThung.dims.w) : '');
  // `dims.h = null` HỢP LỆ (túi không có chiều cao) — `?? ''` để ô Cao trống, không phải
  // literal "null" chui vào ô (bug reopening kiện túi: mất luôn dài+rộng VÀ báo sai "đã sửa").
  const [cao, setCao] = useState(k.dongThung?.dims ? String(k.dongThung.dims.h ?? '') : '');
  // Box đang chọn trong lưới — dùng để biết đang so "đã sửa" với số đo của box nào, và để
  // tô sáng đúng thẻ. Khớp lúc khởi tạo theo `hop` hiện có (ô hộp đã ghi từ trước, nếu trùng
  // mã một box trong danh mục) để dấu "đã sửa" đúng ngay cả khi mở lại kiện đã đóng thùng.
  const [boxDaChon, setBoxDaChon] = useState<BoxHien | null>(
    () => dsBox.find((b) => b.ma === hop) ?? null,
  );
  const [loi, setLoi] = useState<string[]>([]);
  const [dangLuu, batDau] = useTransition();

  // Đổi box là ĐIỀN LẠI cả ba chiều theo box mới và xoá dấu "đã sửa" (CEO chốt) — chọn box
  // khác nghĩa là lấy số của box đó, không phải lấy sang lệch cũ. Túi (`caoCm = null`) để ô
  // Cao CHUỖI RỖNG, không phải '0': '0' là dữ liệu xấu và là tín hiệu SAI cho hạng Pak.
  const chonBox = (b: BoxHien) => {
    setBoxDaChon(b);
    setHop(b.ma); // mã vật tư — KHÔNG phải tên box, vì chữ trong mã quyết định BOX/PAK/BAG.
    setDai(String(b.kichThuoc.daiCm));
    setRong(String(b.kichThuoc.rongCm));
    setCao(b.kichThuoc.caoCm != null ? String(b.kichThuoc.caoCm) : '');
  };
  const daSua = boxDaChon != null && daSuaDim(boxDaChon.kichThuoc, { dai, rong, cao });

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
      if (r.ok) {
        // Cảnh báo Lark (ô người khác gõ, chưa có dòng Lark, Lark sập…) sống lâu hơn toast
        // thường: im lặng ở đây là thao tác đóng thùng ĐÃ LƯU nhưng nhân sự tưởng mọi thứ
        // đã lên Lark, trong khi phí ship của hãng tính thẳng từ ô đó.
        if (r.canhBaoLark) toast.warning(`Đã ghi đóng thùng — ${r.canhBaoLark}`, { duration: 15000 });
        else toast.success('Đã ghi đóng thùng');
        router.refresh();
        return;
      }
      if (r.loi) setLoi(r.loi); else toast.error(r.error ?? 'Không lưu được');
    });
  };

  const o = 'h-9 w-full rounded-lg border border-input bg-background px-2 text-sm';

  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-sm font-semibold">Đóng thùng</h4>
        {k.dongThung && <span className="text-[11px] text-muted-foreground">đã ghi lúc {new Date(k.dongThung.luc).toLocaleString('vi-VN')}</span>}
        {/* Lối ra cho người hít đúng kiện nhưng box trong lưới sai số đo — không có đường này
            thì phải biết URL mới sửa được danh mục (xem QuanLyBox.tsx). */}
        <Link href="/f/dong-hang/box" className="text-[11px] text-muted-foreground underline hover:text-foreground">
          Box sai số đo? Sửa danh mục →
        </Link>
      </div>

      {/* Số dự kiến là THAM CHIẾU, không phải số điền sẵn vào ô cân: nhiều món gộp một thùng
          thì tổng dự kiến (mỗi món tính một hộp) cao hơn cân kiện thật một cách hợp lệ. */}
      <p className="text-[11px] text-muted-foreground">{moTaTongCan(duKien)}</p>

      <div className="space-y-1.5">
        <ChonBox ds={dsBox} chon={boxDaChon?.ma ?? null} onChon={chonBox} />
        {/* Box lạ (chưa có trong danh mục) KHÔNG được chặn việc đóng hàng — luôn có đường gõ
            mã tay. Gõ khác mã box vừa chọn thì bỏ liên kết với box đó (không còn gì để so
            "đã sửa" nữa). */}
        <label className="block text-xs">
          <span className="text-muted-foreground">Thùng đã dùng (mã vật tư)</span>
          <input
            className={o} value={hop}
            onChange={(e) => {
              setHop(e.target.value);
              if (boxDaChon && e.target.value !== boxDaChon.ma) setBoxDaChon(null);
            }}
            placeholder="MEAN-BOX-30x25x20… (gõ tay nếu box chưa có trong lưới)"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs">
          <span className="text-muted-foreground">Cân cả kiện (kg)</span>
          <input className={o} value={canKg} onChange={(e) => setCanKg(e.target.value)} inputMode="decimal" placeholder="1,2" />
        </label>
        <label className="text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            D × R (cm)
            {daSua && <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">đã sửa</span>}
          </span>
          <div className="flex gap-1">
            <input className={o} value={dai} onChange={(e) => setDai(e.target.value)} inputMode="decimal" placeholder="D" />
            <input className={o} value={rong} onChange={(e) => setRong(e.target.value)} inputMode="decimal" placeholder="R" />
          </div>
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">Cao (cm)</span>
          <input className={o} value={cao} onChange={(e) => setCao(e.target.value)} inputMode="decimal" placeholder="C (để trống nếu là túi)" />
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
