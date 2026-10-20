import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { demChuaGanDanhTinh, nhatKyCuaBang } from '@/features/nhat-ky/queries';
import { trangThaiGhiCua } from '@/features/nhat-ky/tra-trigger';
import { cauKhiTrong } from '@/features/nhat-ky/trang-thai-ghi';
import { BangNhatKy } from '@/components/nhat-ky/BangNhatKy';
import {
  CAC_BANG, docBang, docChu, docNgay, homNayVn, nguoiTrongKhoi, nhanBang, truongTrongKhoi,
} from '@/components/nhat-ky/bo-loc';

export const dynamic = 'force-dynamic';

type SP = { bang?: string; nguoi?: string; truong?: string; tu?: string; den?: string };

const NHAN_O = 'text-xs uppercase tracking-wider text-muted-foreground';
const O = 'h-9 rounded-md border border-border bg-background px-2 text-sm';

/**
 * Nhật ký thay đổi của CẢ MỘT BẢNG (spec §6b) — trả lời "hôm nay ai sửa gì trong kho".
 *
 * Gác quyền ngay tại trang dù `nhatKyCuaBang` cũng gác: hàng rào ở tầng truy vấn NÉM lỗi
 * (đúng cho một action), còn một trang thì phải hiện được câu "không có quyền" thay vì
 * trang lỗi của Next.
 */
export default async function NhatKyPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_nhat_ky')) {
    return <div className="px-6 py-16 text-center text-sm text-muted-foreground">Không có quyền.</div>;
  }

  const sp = await searchParams;
  const bang = docBang(sp.bang);
  const nguoi = docChu(sp.nguoi);
  const truong = docChu(sp.truong);
  const tuNgay = docNgay(sp.tu, 'dau');
  const denNgay = docNgay(sp.den, 'cuoi');

  /*
   * Hai lượt đọc, và chỉ khi đang lọc theo người/trường.
   *
   * `khoiKhoangNgay` (chỉ lọc bảng + ngày) là nguồn dựng DANH SÁCH CHỌN cho hai ô đó. Nếu
   * dựng danh sách từ chính kết quả đã lọc thì lọc xong ô chọn chỉ còn một mục — không
   * ai bỏ lọc hay đổi sang người khác được nữa, phải sửa URL bằng tay.
   *
   * Không lọc người/trường thì hai danh sách dùng chính kết quả đang hiện, nên ca thường
   * gặp vẫn chỉ MỘT lượt đọc.
   */
  const khoiKhoangNgay = await nhatKyCuaBang(bang, { tuNgay, denNgay });
  const khoi = (nguoi || truong)
    ? await nhatKyCuaBang(bang, { tacNhanId: nguoi, truong, tuNgay, denNgay })
    : khoiKhoangNgay;

  const cacNguoi = nguoiTrongKhoi(khoiKhoangNgay);
  const cacTruong = truongTrongKhoi(khoiKhoangNgay);
  const no = await demChuaGanDanhTinh();
  const dangLoc = Boolean(nguoi || truong || tuNgay || denNgay);
  const homNay = homNayVn();

  /* Bảng này CÓ đang ghi nhật ký không — tra `pg_trigger`, không đoán.
     Câu cũ ở đây là "trigger của bảng CÓ THỂ chưa được bật": chữ "có thể" làm người đọc
     không phân biệt được "không ai sửa gì" với "chưa bật nên không ghi gì" — hai kết luận
     ngược hẳn nhau, và đúng kiểu hỏng mà cả tính năng nhật ký dựng ra để tránh. */
  const trangThaiGhi = await trangThaiGhiCua([bang]);
  const chuaBat = trangThaiGhi.every((t) => !t.daGhi);

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nhật ký thay đổi</h1>
        <p className="text-sm text-muted-foreground">
          Ai sửa ô nào, từ giá trị nào sang giá trị nào. Thay đổi cùng người — cùng lúc — cùng
          bản ghi gom thành một khối. Giá trị nhạy cảm bị che theo quyền của bạn, và ô bị che
          nói rõ là bị che.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          {/* Lọc bằng form GET: bộ lọc nằm trên URL nên F5 / chia sẻ link không mất lọc,
              và trang không phải tải thêm JS cho một bảng chỉ-đọc. */}
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className={NHAN_O}>Bảng</span>
              <select name="bang" defaultValue={bang} className={O} aria-label="Lọc theo bảng">
                {CAC_BANG.map((b) => <option key={b} value={b}>{nhanBang(b)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={NHAN_O}>Người sửa</span>
              <select name="nguoi" defaultValue={nguoi ?? ''} className={O} aria-label="Lọc theo người sửa">
                <option value="">Tất cả</option>
                {cacNguoi.map((n) => <option key={n.gia} value={n.gia}>{n.nhan}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={NHAN_O}>Trường</span>
              <select name="truong" defaultValue={truong ?? ''} className={O} aria-label="Lọc theo trường">
                <option value="">Tất cả</option>
                {cacTruong.map((t) => <option key={t.gia} value={t.gia}>{t.nhan}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={NHAN_O}>Từ ngày</span>
              {/* `max` là hôm nay: nhật ký chỉ ghi việc đã xảy ra, chọn ngày mai luôn ra rỗng. */}
              <input type="date" name="tu" defaultValue={sp.tu ?? ''} max={homNay} className={O} aria-label="Từ ngày" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={NHAN_O}>Đến ngày</span>
              <input type="date" name="den" defaultValue={sp.den ?? ''} max={homNay} className={O} aria-label="Đến ngày" />
            </label>
            <button
              type="submit"
              className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm font-medium transition hover:bg-muted"
            >
              Lọc
            </button>
            {dangLoc && (
              <Link
                href={`/f/nhat-ky?bang=${encodeURIComponent(bang)}`}
                className="h-9 px-1 text-sm leading-9 text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Xoá lọc
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      <KhoiNo no={no} />

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">{nhanBang(bang)} — {khoi.length} khối thay đổi</h2>
            <span className="text-xs text-muted-foreground">
              Mới nhất trước, mỗi lượt đọc tối đa 500 dòng thô.
            </span>
          </div>
          <BangNhatKy
            khoi={khoi}
            /* Bảng CHƯA BẬT thì nói là chưa bật, kể cả khi đang lọc: "không khớp bộ lọc"
               ngụ ý rằng có dữ liệu mà bộ lọc loại ra, trong khi thật ra không có dòng
               nào để lọc. */
            trong={dangLoc && !chuaBat
              ? 'Không có thay đổi nào khớp bộ lọc.'
              : cauKhiTrong(trangThaiGhi)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Số dòng CHƯA GẮN DANH TÍNH, theo bảng.
 *
 * Để ngay trên màn hình chứ không trong một tệp kế hoạch: mỗi dòng ở đây là một thay đổi
 * mà không ai biết ai làm (lệnh ghi không đi qua `ghiVoi()` — cron cũ, script, `psql` gõ
 * tay). Con số CHỈ đếm cái đang có; cố ý không có mục tiêu hay ngưỡng nào gõ cứng.
 */
function KhoiNo({ no }: { no: Array<{ bang: string; soDong: number }> }) {
  if (no.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Mọi dòng nhật ký hiện có đều đã gắn danh tính người hoặc nhãn máy.
      </p>
    );
  }
  const tong = no.reduce((s, r) => s + r.soDong, 0);
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-400">
          Chưa gắn danh tính — {tong} dòng
        </h2>
        <p className="text-xs text-muted-foreground">
          Những thay đổi này không biết ai làm: lệnh ghi không đi qua lớp gắn danh tính (cron
          cũ, script chạy tay, hoặc sửa thẳng bằng <code>psql</code>). Con số còn &gt; 0 là còn
          đường ghi chưa được vá.
        </p>
        <ul className="divide-y divide-border/60 text-sm">
          {no.map((r) => (
            <li key={r.bang} className="flex items-baseline justify-between gap-3 py-1.5">
              <span>{nhanBang(r.bang)}</span>
              <span className="tabular-nums font-medium">{r.soDong.toLocaleString('vi-VN')}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
