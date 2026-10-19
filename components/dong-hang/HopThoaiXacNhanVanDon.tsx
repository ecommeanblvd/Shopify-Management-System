'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, CircleAlert, CircleSlash, TriangleAlert } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, KhaiChuaLuu,
} from '@/components/ui/dialog';
import { luuTrackingChoKien, phanTichTruocKhiGhi } from '@/features/dong-hang/actions';
import {
  cauTomTat, moTaODich, moTaOTracking, nhanLarkDangCo, nhomXemTruoc, soInDam, tenNguon,
  tongUocTinh, vnd,
  type KetQuaPhanTichVanDon,
} from '@/features/dong-hang/xem-truoc-van-don';
import type { DongXemTruoc } from '@/features/lark/ghi-nguoc/patch-gia-uoc-tinh';

/**
 * HỘP THOẠI THỨ HAI của luồng "Lên vận đơn" (CEO 14/10/2026): nhân sự điền mã vận đơn vừa tạo
 * ở cổng hãng → hệ thống PHÂN TÍCH các giá liên quan → **chỉ sau khi họ xác nhận** mới ghi.
 *
 * Vì sao phải chẻ hai bước thay vì ghi một mạch như trước: Lark KHÔNG CÓ UNDO. Luật ghi chỉ
 * cho điền ô TRỐNG, nên ghi sai một ô là người phải vào Lark xoá tay từng ô và họ không còn
 * bản gốc. Con mắt người là lá chắn cuối, và lá chắn chỉ chặn được cái nó ĐƯỢC THẤY — nên
 * bước phân tích phải kể đủ: ô nào sẽ ghi số gì, ô nào Lark đã có số (bao nhiêu), ô nào nguồn
 * không có.
 *
 * HUỶ Ở BƯỚC XEM = KHÔNG GHI GÌ: không lưu `tracking_number`, không chạm Lark, không đóng dấu
 * `gia_uoc_tinh_ghi_luc`. Cả việc đó nằm ở `phanTichTruocKhiGhi` (actions.ts) — hộp thoại này
 * chỉ vẽ, và chỉ `luuTrackingChoKien` mới ghi.
 *
 * Mọi câu chữ giải thích đến từ `features/dong-hang/xem-truoc-van-don.ts` (thuần, có test):
 * bộ test của repo không bắt `.tsx`, nên một câu "ô này sẽ ghi" viết ở đây là câu không ai
 * canh — mà đây đúng là chỗ không được sai.
 */

const VIEN_NUT = 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Một dòng của bảng xem trước: tên ô Lark + số HÃNG BÁO + (số Lark đang giữ) + câu vì sao.
 *
 * Số in đậm LUÔN là số nguồn báo giá trả về (`soInDam`), KHÔNG bao giờ là số Lark đang giữ.
 * Bản trước đổi nghĩa cột số theo trạng thái ô — xem `soInDam` ở
 * `features/dong-hang/xem-truoc-van-don.ts` để biết nó đã sai thế nào (CEO 15/10/2026).
 */
function DongO({ d, mau }: { d: DongXemTruoc; mau: 'luc' | 'hoPhach' | 'xam' }) {
  const vien = mau === 'luc'
    ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/25'
    : mau === 'hoPhach'
      ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900/60 dark:bg-amber-950/25'
      : 'border-border bg-muted/40';
  const nhanLark = nhanLarkDangCo(d);
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-lg border px-2.5 py-1.5 ${vien}`}>
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium break-words">{d.cot}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">{moTaODich(d)}</p>
      </div>
      <div className="shrink-0 text-right">
        <span className="block text-[13px] font-semibold tabular-nums">{soInDam(d)}</span>
        {nhanLark && (
          <span className="mt-0.5 block text-[10.5px] whitespace-nowrap text-amber-800 tabular-nums dark:text-amber-300">
            {nhanLark}
          </span>
        )}
      </div>
    </div>
  );
}

function Nhom({
  ten, icon, dong, mau,
}: { ten: string; icon: React.ReactNode; dong: DongXemTruoc[]; mau: 'luc' | 'hoPhach' | 'xam' }) {
  if (dong.length === 0) return null;
  return (
    <section className="space-y-1.5">
      <h4 className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
        {icon} {ten} ({dong.length})
      </h4>
      <div className="space-y-1.5">
        {dong.map((d) => <DongO key={d.cot} d={d} mau={mau} />)}
      </div>
    </section>
  );
}

/**
 * Hộp thoại ĐƯỢC ĐIỀU KHIỂN từ ngoài (`mo`/`doiMo`) để nút "Tạo vận đơn thành công" của hộp
 * thoại thứ nhất mở được nó sau khi tự đóng.
 */
export function HopThoaiXacNhanVanDon({
  shipmentId, maKien, mo, doiMo,
}: {
  shipmentId: string; maKien: string | null; mo: boolean; doiMo: (v: boolean) => void;
}) {
  const [raw, setRaw] = useState('');
  const [kq, setKq] = useState<KetQuaPhanTichVanDon | null>(null);
  const [loi, setLoi] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dong = () => {
    // Huỷ là về trạng thái sạch: KHÔNG ghi gì cả, và lượt mở sau không thấy bảng cũ của một
    // mã đã bỏ (bảng cũ còn đó là mời người ta bấm xác nhận cho mã sai).
    doiMo(false);
    setRaw(''); setKq(null); setLoi(null);
  };

  /* BƯỚC 1 — phân tích. Gọi action trong HÀM XỬ LÝ SỰ KIỆN (submit form), không trong
   * `useEffect`: dự án bật `react-hooks/set-state-in-effect`, và lượt này gọi API báo giá của
   * hãng nên nó phải xảy ra vì người dùng BẤM. */
  const phanTich = () => {
    if (pending || raw.trim() === '') return;
    start(async () => {
      setLoi(null);
      let r: Awaited<ReturnType<typeof phanTichTruocKhiGhi>>;
      try {
        r = await phanTichTruocKhiGhi(shipmentId, raw);
      } catch (e) {
        setLoi(`Không phân tích được — lượt gọi hỏng giữa đường (${e instanceof Error ? e.message : String(e)}). Chưa ghi gì cả, thử lại được.`);
        return;
      }
      if (!r.ok) { setLoi(r.loi); return; }
      setKq(r);
    });
  };

  /* BƯỚC 2 — XÁC NHẬN, đây mới là lượt GHI: lưu mã vào CSDL rồi ghi giá lên Lark. */
  const xacNhan = () => {
    if (pending || !kq) return;
    start(async () => {
      /* MỌI đường đều phải dẫn tới một toast. Không có try/catch này thì một promise bị
       * reject (transport đứt giữa lượt gọi hãng, hạn chờ FedEx, action ném) lặng lẽ chết
       * trong `start(async …)`: KHÔNG toast nào cả, dù mã vận đơn có thể ĐÃ lưu xong — nhân
       * sự chỉ thấy nút trở lại bình thường và không biết thao tác đã vào hay chưa. */
      let r: Awaited<ReturnType<typeof luuTrackingChoKien>>;
      try {
        r = await luuTrackingChoKien(shipmentId, kq.tracking);
      } catch (e) {
        toast.error(
          `Không rõ mã đã lưu hay chưa — lượt gọi hỏng giữa đường (${e instanceof Error ? e.message : String(e)}). Tải lại trang để xem dòng kiện trước khi dán lại.`,
          { duration: 15000 },
        );
        return;
      }
      if (!r.ok) { setLoi(r.loi); return; }
      /* Báo kết quả bằng TOAST (`sonner`), KHÔNG vẽ tại chỗ: lưu xong thì
       * `luuTrackingChoKien` `revalidatePath` ngay trong CÙNG lượt gọi, mà các tab mặc định
       * (`cho_chon_line` — tab mở màn chính, xem `queries.ts`) lọc `trackingNumber IS NULL`,
       * nên chính DÒNG KIỆN này rụng khỏi kết quả truy vấn kế tiếp, mang theo cả hộp thoại
       * đang mở. Toast sống ở cây riêng (`<Toaster/>` cấp layout) nên sống sót qua cú rụng đó.
       *
       * Cảnh báo = giá chưa ghi được lên Lark; để sống lâu hơn hẳn toast thường (3s) vì một
       * toast cảnh báo chớp tắt nhanh cũng là nuốt mất, chỉ chậm hơn im lặng. */
      if (r.canhBao) toast.warning(`Đã lưu mã ${r.tracking} — ${r.canhBao}`, { duration: 15000 });
      else toast.success(`Đã lưu mã ${r.tracking}.`, { duration: 3000 });
      dong();
    });
  };

  const nhom = kq?.xem ? nhomXemTruoc(kq.xem) : null;
  const tong = kq?.xem ? tongUocTinh(kq.xem) : null;

  return (
    <Dialog open={mo} onOpenChange={(o) => { if (!o) dong(); else doiMo(true); }}>
      <DialogContent
        showCloseButton={false}
        className="top-8 flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        {/* Đã dán mã hoặc đã phân tích xong mà bấm ra ngoài → hỏi lại, đừng để mất công gõ. */}
        <KhaiChuaLuu co={raw.trim() !== '' || kq !== null} />
        <DialogHeader className="shrink-0 gap-0.5 border-b border-border px-5 pt-4 pb-3.5">
          <DialogTitle className="text-[15px] font-semibold">
            Mã vận đơn{maKien ? ` · ${maKien}` : ''}
          </DialogTitle>
          <DialogDescription className="text-[11.5px]">
            Điền mã vừa tạo ở cổng hãng. Hệ thống phân tích giá trước — chưa ghi gì lên Lark cho
            tới khi bạn bấm xác nhận.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pt-4 pb-5">
          <form
            onSubmit={(e) => { e.preventDefault(); phanTich(); }}
            className="flex items-center gap-2"
          >
            <input
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setKq(null); setLoi(null); }}
              disabled={pending}
              placeholder="Dán mã hoặc link vận đơn"
              aria-label="Mã vận đơn"
              autoFocus
              className="h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="submit" disabled={pending || raw.trim() === ''}
              className={`shrink-0 rounded-lg border border-border px-3 py-2 text-[13px] font-medium transition hover:bg-muted ${VIEN_NUT} focus-visible:ring-ring/60`}
            >
              {pending && !kq ? 'Đang phân tích…' : 'Phân tích'}
            </button>
          </form>

          {loi && <p className="text-[12.5px] text-destructive">{loi}</p>}

          {kq && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                <p className="text-[12.5px]">
                  Mã: <span className="font-mono font-semibold">{kq.tracking}</span>
                  {' · '}nguồn giá: {tenNguon(kq.nguon)}
                </p>
                {tong != null && (
                  <p className="text-[12.5px]">Tổng ước tính: <span className="font-semibold">{vnd(tong)}</span></p>
                )}
                {kq.xem && <p className="text-[11.5px] text-muted-foreground">{cauTomTat(kq.xem)}</p>}
              </div>

              {kq.canhBao.map((c) => (
                <p key={c} className="flex items-start gap-1.5 rounded-lg bg-amber-100/70 px-2.5 py-2 text-[11.5px] text-amber-900 dark:bg-amber-900/25 dark:text-amber-200">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <span>{c}</span>
                </p>
              ))}

              {kq.lyDoTrong && (
                <p className="rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-[11.5px]">
                  Chưa có bảng giá để xem: {kq.lyDoTrong}. Bấm xác nhận vẫn lưu được mã vận đơn
                  vào SMS.
                </p>
              )}

              {kq.xem && (
                <div className="rounded-lg border border-border px-2.5 py-2 text-[12px]">
                  <p className="font-medium break-words">{kq.xem.oTracking.cot}</p>
                  <p className="text-[11px] text-muted-foreground">{moTaOTracking(kq.xem.oTracking)}</p>
                </div>
              )}

              {nhom && (
                <>
                  <Nhom ten="Sẽ ghi lên Lark" mau="luc" dong={nhom.seGhi}
                    icon={<Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />} />
                  <Nhom ten="Lark đã có số — không ghi đè" mau="hoPhach" dong={nhom.daCo}
                    icon={<CircleAlert className="size-3.5 text-amber-700 dark:text-amber-400" />} />
                  <Nhom ten="Nguồn không có số — ô sẽ trống" mau="xam" dong={nhom.khongCo}
                    icon={<CircleSlash className="size-3.5" />} />
                </>
              )}
            </div>
          )}
        </div>

        {/* Thanh nút NỔI: dính đáy, để nút xác nhận luôn trong tầm tay dù bảng dài phải cuộn. */}
        <div className="sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-popover/95 px-5 py-3 backdrop-blur">
          <button
            type="button" onClick={dong} disabled={pending}
            className={`rounded-lg border border-border px-3.5 py-2 text-[13px] font-medium transition hover:bg-muted ${VIEN_NUT} focus-visible:ring-ring/60`}
          >
            Đóng/Huỷ
          </button>
          <button
            type="button" onClick={xacNhan} disabled={pending || !kq}
            title={kq ? undefined : 'Phân tích mã vận đơn trước đã'}
            className={`rounded-lg border border-emerald-300 bg-emerald-100 px-3.5 py-2 text-[13px] font-semibold text-emerald-900 transition hover:bg-emerald-200 ${VIEN_NUT} focus-visible:ring-emerald-400/60 dark:border-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-100 dark:hover:bg-emerald-900/70`}
          >
            {pending && kq ? 'Đang ghi…' : 'Xác nhận & ghi lên Lark'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Nút mở hộp thoại trên từ CHÍNH DÒNG KIỆN — chỗ nhân sự quay lại ngay sau khi tạo nhãn ở
 * cổng hãng.
 *
 * Thay cho ô nhập dán-là-lưu trước đây: để lại một ô ghi ngay tại dòng là để lại một đường
 * ghi lên Lark KHÔNG qua bước xem trước, đúng thứ CEO yêu cầu bỏ. Ô nhập không mất, nó dọn
 * vào trong hộp thoại cùng với bảng phân tích.
 */
export function NutNhapTracking({ shipmentId, maKien }: { shipmentId: string; maKien: string | null }) {
  const [mo, setMo] = useState(false);
  return (
    <>
      <button
        type="button" onClick={() => setMo(true)}
        className={`w-full rounded-lg border border-border px-3 py-2 text-[13px] font-medium whitespace-nowrap transition hover:border-foreground/40 hover:bg-muted ${VIEN_NUT} focus-visible:ring-ring/60`}
      >
        Nhập mã vận đơn
      </button>
      <HopThoaiXacNhanVanDon shipmentId={shipmentId} maKien={maKien} mo={mo} doiMo={setMo} />
    </>
  );
}
