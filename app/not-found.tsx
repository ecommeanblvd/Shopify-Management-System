import Link from 'next/link';
import { Duong404 } from '@/components/Duong404';

/**
 * Trang cho MỌI đường dẫn không khớp route nào (CEO 30/09/2026).
 *
 * Trước nay dự án không có file này, nên người dùng nhận đúng trang 404 trắng mặc định của Next:
 * "This page could not be found." Nó không nói đường dẫn nào sai, không có đường về, và — nặng
 * nhất — KHÔNG ĐỂ LẠI DẤU VẾT NÀO. Đức báo "page not found" ở KPI Logistics, em kiểm hết phía
 * máy chủ (quyền thông, mọi route sống, không chỗ nào ném 404) mà qua hai vòng hỏi–đáp vẫn không
 * biết anh ấy vào đường dẫn nào. Một lỗi không để lại dấu thì mỗi lần gặp lại là điều tra từ đầu.
 *
 * Nên trang này làm ba việc: nói rõ ĐƯỜNG DẪN NÀO sai, cho đường đi tiếp, và GHI LẠI.
 *
 * Nằm ở gốc `app/` nên nó ở NGOÀI layout (dashboard) — không có thanh điều hướng, vì vậy phải tự
 * mang theo các lối đi chính. Danh sách để ngắn: đây là trang lỡ đường, không phải trang chủ.
 */
export const metadata = { title: 'Không tìm thấy trang' };

const LOI_DI = [
  { href: '/', nhan: 'Dashboard' },
  { href: '/f/ship-report?tab=kpi', nhan: 'KPI Logistics' },
  { href: '/f/fulfillment', nhan: 'Quản lí đơn' },
  { href: '/f/orders', nhan: 'Orders' },
];

export default function KhongTimThayTrang() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lỗi 404</p>
      <h1 className="mt-1 text-2xl font-semibold">Không có trang nào ở đường dẫn này</h1>

      <p className="mt-4 text-sm text-muted-foreground">Đường dẫn vừa mở:</p>
      <Duong404 />

      <p className="mt-4 text-sm text-muted-foreground">
        Thường là do gõ thiếu một chữ, hoặc một dấu trang (bookmark) cũ từ lúc trang còn nằm ở chỗ
        khác. Chọn một lối đi dưới đây, hoặc mở lại từ thanh điều hướng bên trái của Dashboard.
      </p>

      <nav className="mt-4 flex flex-wrap gap-2">
        {LOI_DI.map((l) => (
          <Link key={l.href} href={l.href}
            className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted">
            {l.nhan}
          </Link>
        ))}
      </nav>

      {/* Nói thẳng là đã ghi lại: người báo lỗi biết mình không cần chép tay đường dẫn nữa. */}
      <p className="mt-6 text-xs text-muted-foreground">
        Đường dẫn này đã được ghi vào nhật ký hệ thống, không cần chụp màn hình gửi lại.
      </p>
    </main>
  );
}
