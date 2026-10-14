import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { danhMucBoxQuanLy } from '@/features/dong-hang/queries';
import { QuanLyBox } from '@/components/dong-hang/QuanLyBox';

export const dynamic = 'force-dynamic';

/**
 * Trang quản lý danh mục box (CEO 14/10/2026, spec §3 việc 5 / §5 "Danh mục box") — nơi tự
 * sửa danh mục ngay trong SMS, ra khỏi lưới `ChonBox` ở khối Đóng thùng. Cùng mốc quyền gác
 * như `/f/dong-hang` (`view_fulfillment` — xem `app/(dashboard)/f/dong-hang/page.tsx`): đọc
 * danh mục box không nhạy hơn đọc kiện hàng; bấm Lưu/Ẩn vẫn gác riêng `manage_fulfillment`
 * ở `luuBox`/`anBox` (`features/dong-hang/actions.ts`), đúng mức màn đóng hàng.
 *
 * Không tự chạy một SELECT riêng cho `box` và một SELECT khác cho `boLai` — cả hai đọc kho
 * (`lark_wh_inventory`) y hệt nhau, nên lấy cùng lúc từ `danhMucBoxQuanLy()`
 * (`features/dong-hang/queries.ts`), hàm dùng chung một lượt đọc kho với `danhSachBox()`.
 */
export default async function QuanLyBoxPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_fulfillment')) redirect('/');

  const { box, boLai } = await danhMucBoxQuanLy();

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Danh mục box</h1>
          <p className="text-sm text-muted-foreground">
            Sửa tại đây KHOÁ số đo lại (bản sửa tay thắng) — Lark đổi gì sau đó chỉ hiện cảnh
            báo lệch, không ghi đè.
          </p>
        </div>
        <Link href="/f/dong-hang" className="text-xs text-muted-foreground underline hover:text-foreground">
          ← về Đóng hàng
        </Link>
      </div>
      <QuanLyBox box={box} boLai={boLai} />
    </div>
  );
}
