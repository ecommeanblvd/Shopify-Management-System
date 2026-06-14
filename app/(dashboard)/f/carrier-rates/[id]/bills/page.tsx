import { redirect } from 'next/navigation';

/** Công nợ đã gộp vào trang carrier account (AP-first). Giữ route này để link cũ
 *  không chết — chuyển hướng về hub. (Các route file/proof dưới /bills vẫn dùng.) */
export default async function BillsRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/f/carrier-rates/${id}`);
}
