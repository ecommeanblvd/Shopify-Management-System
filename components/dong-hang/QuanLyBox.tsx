'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { luuBox, anBox } from '@/features/dong-hang/actions';
import { loaiTheoTen, type BoLai, type LoaiBox } from '@/features/dong-hang/danh-muc-box';
import type { BaChieu } from '@/features/dong-hang/kich-thuoc-box';
import type { BoxHien } from '@/features/dong-hang/tron-box';
import { Button } from '@/components/ui/button';

const NHAN_LOAI: Record<LoaiBox, string> = { thung: 'Thùng', tui: 'Túi', khac: 'Khác' };

function chuoiKichThuoc(k: BaChieu): string {
  return k.caoCm != null ? `${k.daiCm}x${k.rongCm}x${k.caoCm}` : `${k.daiCm}x${k.rongCm}`;
}

const oInput = 'h-8 w-full rounded-lg border border-input bg-background px-2 text-xs';

/**
 * Màn quản lý danh mục box (CEO 14/10/2026, spec `2026-10-14-chon-box-dong-hang-design.md`
 * §3 việc 5 / §5 "Danh mục box") — chỗ TỰ sửa danh mục ngay trong SMS, thay vì chờ kho chữa
 * lại bảng Lark.
 *
 * Liệt kê **cả** box đã dùng được (`box` — đã trộn Lark + `box_dong_goi` qua `tronBox`, xem
 * `features/dong-hang/queries.ts`) **lẫn** những dòng kho mà `gomBox` phải loại ra (`boLai`:
 * kích thước không đọc được, hoặc cùng tên mà kích thước xung đột giữa các dòng — tám trong 46
 * dòng kho `VTĐG1` hôm nay (14/10/2026, xem spec §2) rơi vào nhóm này). Thiếu phần `boLai` thì
 * tám dòng đó không bao giờ sửa được: chúng không lên lưới `ChonBox` (không có kích thước để
 * hiện), và cũng không hiện ở đây — biến mất vĩnh viễn khỏi tầm sửa của mọi người.
 *
 * Lưu một box ở đây LUÔN khoá nó lại (`luuBox` đặt `sua_tay = true`) — luật bản-sửa-tay-thắng
 * CEO chốt (spec §3b.3): ai ngồi đây là người vừa cầm cái thùng thật mà đo, nên số của họ
 * THẮNG và KHOÁ; lượt kéo Lark sau đổi gì cũng không đè lại, chỉ hiện ra qua `lech` (`b.lech`)
 * để người xem tự quyết — xem khối cảnh báo trong `DongBox` dưới đây.
 *
 * `box`/`boLai` do nơi gọi truyền vào (tải qua `danhSachBox()` + `gomBox()` trên dòng kho thô —
 * xem `features/dong-hang/queries.ts`), component này chỉ còn việc vẽ và gọi `luuBox`/`anBox`.
 *
 * `coQuyenSua`: trang gọi (`app/(dashboard)/f/dong-hang/box/page.tsx`) chỉ gác
 * `view_fulfillment`, nhẹ hơn mốc `manage_fulfillment` mà `luuBox`/`anBox` đòi — thiếu cờ này,
 * hai nút Lưu/Ẩn vẫn hiện cho người không có quyền, họ điền xong mới biết bị từ chối.
 */
export function QuanLyBox({ box, boLai, coQuyenSua }: { box: BoxHien[]; boLai: BoLai[]; coQuyenSua: boolean }) {
  return (
    <div className="space-y-6">
      {!coQuyenSua && (
        <p className="rounded-lg border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Bạn chỉ xem được danh mục này — sửa box cần quyền quản lý đóng hàng (manage_fulfillment).
        </p>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Box trong danh mục ({box.length})</h3>
        <div className="space-y-2">
          {box.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              Chưa có box nào đọc được từ kho.
            </p>
          )}
          {box.map((b) => <DongBox key={`${b.id ?? 'lark'}-${b.ten}`} b={b} coQuyenSua={coQuyenSua} />)}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Dòng kho chưa dùng được ({boLai.length})</h3>
        <p className="text-xs text-muted-foreground">
          Kích thước không đọc được, hoặc cùng tên mà kích thước xung đột giữa các dòng kho —
          điền tay rồi lưu để box này lên được lưới chọn.
        </p>
        <div className="space-y-2">
          {boLai.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              Không có dòng kho nào bị loại.
            </p>
          )}
          {boLai.map((r) => <DongBoLai key={`${r.ten}-${r.recordIds.join(',')}`} item={r} coQuyenSua={coQuyenSua} />)}
        </div>
      </section>
    </div>
  );
}

/** Một box đã dùng được — sửa tại chỗ, thấy ngay dấu "đã sửa tay" và cảnh báo lệch với Lark. */
function DongBox({ b, coQuyenSua }: { b: BoxHien; coQuyenSua: boolean }) {
  const router = useRouter();
  const [ma, setMa] = useState(b.ma);
  const [loai, setLoai] = useState<LoaiBox>(b.loai);
  const [dai, setDai] = useState(String(b.kichThuoc.daiCm));
  const [rong, setRong] = useState(String(b.kichThuoc.rongCm));
  // `caoCm === null` (túi) → ô Cao để CHUỖI RỖNG, không phải '0' — cùng luật với `KhoiDongThung`.
  const [cao, setCao] = useState(b.kichThuoc.caoCm != null ? String(b.kichThuoc.caoCm) : '');
  const [loi, setLoi] = useState<string[]>([]);
  const [dangLuu, batDauLuu] = useTransition();
  const [dangAn, batDauAn] = useTransition();

  const luu = () => {
    setLoi([]);
    batDauLuu(async () => {
      const r = await luuBox({
        id: b.id ?? undefined,
        ten: b.ten,
        ma,
        loai,
        daiCm: Number(dai.trim().replace(',', '.')),
        rongCm: Number(rong.trim().replace(',', '.')),
        caoCm: cao.trim() === '' ? null : Number(cao.trim().replace(',', '.')),
      });
      if (r.ok) {
        toast.success(`Đã lưu "${b.ten}"`);
        router.refresh();
        return;
      }
      setLoi(r.loi ?? ['Không lưu được']);
    });
  };

  const doiAn = () => {
    const id = b.id;
    if (!id) return; // Chưa có dòng SMS (chỉ mới có ở Lark) — chưa có gì để ẩn, phải Lưu trước.
    batDauAn(async () => {
      const r = await anBox(id, !b.an);
      if (r.ok) {
        toast.success(b.an ? 'Đã hiện lại box' : 'Đã ẩn box khỏi lưới chọn');
        router.refresh();
      } else {
        toast.error('Không đổi được');
      }
    });
  };

  return (
    <div className={`space-y-1.5 rounded-xl border border-border p-3 ${b.an ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{b.ten}</p>
        {b.suaTay && (
          <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            đã sửa tay
          </span>
        )}
        {b.an && (
          <span className="rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">đang ẩn</span>
        )}
      </div>

      {/* `lech` chỉ khác null khi box ĐÃ khoá (sua_tay) mà Lark đang ghi số khác — nói ra bằng
          lời, không phải chỉ một icon cảnh báo, để người đọc biết NGAY số nào khác số nào. */}
      {b.lech && (
        <p className="rounded-lg border border-amber-600/40 bg-amber-600/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
          Lark đang ghi {chuoiKichThuoc(b.lech)} cm, khác ô này ({chuoiKichThuoc({ daiCm: Number(dai) || b.kichThuoc.daiCm, rongCm: Number(rong) || b.kichThuoc.rongCm, caoCm: cao.trim() === '' ? null : Number(cao) })} cm).
        </p>
      )}
      {/* Cùng tinh thần `lech` nhưng cho mã vật tư — một lô re-code mã trên Lark (ví dụ
          INS-BAG-… → MEAN-BOX-…) mà kích thước không đổi sẽ KHÔNG lộ qua `lech`, nên cần tín
          hiệu riêng để không âm thầm dùng mã cũ dù Lark đã đổi. */}
      {b.lechMa && (
        <p className="rounded-lg border border-amber-600/40 bg-amber-600/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
          Lark đang ghi mã &quot;{b.lechMa}&quot;, khác mã đã khoá ở ô bên dưới ({ma || b.ma}).
        </p>
      )}

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        <label className="text-xs">
          <span className="block text-muted-foreground">Mã vật tư</span>
          <input className={oInput} value={ma} onChange={(e) => setMa(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Loại</span>
          <select
            className={`${oInput} cursor-pointer`}
            value={loai}
            onChange={(e) => setLoai(e.target.value as LoaiBox)}
          >
            {(['thung', 'tui', 'khac'] as const).map((l) => <option key={l} value={l}>{NHAN_LOAI[l]}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Dài (cm)</span>
          <input className={oInput} value={dai} onChange={(e) => setDai(e.target.value)} inputMode="decimal" />
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Rộng (cm)</span>
          <input className={oInput} value={rong} onChange={(e) => setRong(e.target.value)} inputMode="decimal" />
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Cao (cm)</span>
          <input
            className={oInput} value={cao} onChange={(e) => setCao(e.target.value)}
            inputMode="decimal" placeholder="để trống nếu là túi"
          />
        </label>
      </div>

      {loi.length > 0 && (
        <ul className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {loi.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="xs" onClick={luu} disabled={dangLuu || !coQuyenSua} className="cursor-pointer">
          {dangLuu ? 'Đang lưu…' : 'Lưu'}
        </Button>
        {b.id && (
          <Button type="button" size="xs" variant="outline" onClick={doiAn} disabled={dangAn || !coQuyenSua} className="cursor-pointer">
            {dangAn ? 'Đang đổi…' : b.an ? 'Hiện lại' : 'Ẩn'}
          </Button>
        )}
        {/* Nút bị tắt mà không nói vì sao thì người bấm tưởng đứng im, bấm lại vài lần. */}
        {!coQuyenSua && <span className="text-[11px] text-muted-foreground">Cần quyền manage_fulfillment để lưu/ẩn</span>}
      </div>
    </div>
  );
}

/**
 * Một dòng kho bị `gomBox` loại ra (`boLai`) — chưa có box nào cho nó, nên không có số đo sẵn
 * để sửa, chỉ có ô trống để điền lần đầu. Lưu xong (`luuBox` không kèm `id`) thì nó biến thành
 * một `DongBox` thật ở lượt tải lại kế tiếp (`router.refresh()`), vì `box_dong_goi.ten` khớp
 * đúng tên dòng kho này.
 */
function DongBoLai({ item, coQuyenSua }: { item: BoLai; coQuyenSua: boolean }) {
  const router = useRouter();
  const [ma, setMa] = useState('');
  const [loai, setLoai] = useState<LoaiBox>(loaiTheoTen(item.ten));
  const [dai, setDai] = useState('');
  const [rong, setRong] = useState('');
  const [cao, setCao] = useState('');
  const [loi, setLoi] = useState<string[]>([]);
  const [dangLuu, batDauLuu] = useTransition();

  const luu = () => {
    setLoi([]);
    batDauLuu(async () => {
      const r = await luuBox({
        ten: item.ten,
        ma,
        loai,
        daiCm: Number(dai.trim().replace(',', '.')),
        rongCm: Number(rong.trim().replace(',', '.')),
        caoCm: cao.trim() === '' ? null : Number(cao.trim().replace(',', '.')),
      });
      if (r.ok) {
        toast.success(`Đã lưu "${item.ten}" vào danh mục`);
        router.refresh();
        return;
      }
      setLoi(r.loi ?? ['Không lưu được']);
    });
  };

  return (
    <div className="space-y-1.5 rounded-xl border border-dashed border-border p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-sm font-medium">{item.ten}</p>
        <span className="text-[11px] text-muted-foreground">
          {item.lyDo} · {item.recordIds.length} dòng kho
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        <label className="text-xs">
          <span className="block text-muted-foreground">Mã vật tư</span>
          <input className={oInput} value={ma} onChange={(e) => setMa(e.target.value)} placeholder="MEAN-BOX-…" />
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Loại</span>
          <select
            className={`${oInput} cursor-pointer`}
            value={loai}
            onChange={(e) => setLoai(e.target.value as LoaiBox)}
          >
            {(['thung', 'tui', 'khac'] as const).map((l) => <option key={l} value={l}>{NHAN_LOAI[l]}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Dài (cm)</span>
          <input className={oInput} value={dai} onChange={(e) => setDai(e.target.value)} inputMode="decimal" />
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Rộng (cm)</span>
          <input className={oInput} value={rong} onChange={(e) => setRong(e.target.value)} inputMode="decimal" />
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Cao (cm)</span>
          <input
            className={oInput} value={cao} onChange={(e) => setCao(e.target.value)}
            inputMode="decimal" placeholder="để trống nếu là túi"
          />
        </label>
      </div>

      {loi.length > 0 && (
        <ul className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {loi.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="xs" onClick={luu} disabled={dangLuu || !coQuyenSua} className="cursor-pointer">
          {dangLuu ? 'Đang lưu…' : 'Lưu vào danh mục'}
        </Button>
        {!coQuyenSua && <span className="text-[11px] text-muted-foreground">Cần quyền manage_fulfillment để lưu</span>}
      </div>
    </div>
  );
}
