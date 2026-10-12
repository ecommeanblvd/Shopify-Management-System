/**
 * Cron điền bù giá ước tính lên Lark (Task 7).
 *
 * Kiện đã dán mã vận đơn + đã có dòng Lark tương ứng nhưng CHƯA ghi được giá
 * ước tính ở lượt đầu (Rate API hỏng, Lark tạm lỗi…) thì thử lại ở đây —
 * `canDienBu`/`layKienCanDienBu` (features/dong-hang/dien-bu.ts) chọn đúng
 * những kiện đó.
 *
 * Gọi THẲNG `ghiGiaUocTinhLenLark` — hàm thường dựng riêng (KHÔNG cổng
 * quyền) để action nhập tracking (Task 5) và cron này dùng CHUNG một đường
 * ghi Lark. Tự nhân bản logic ghi ở đây là đúng thứ D-045 cấm (bài học cột
 * `Couriers` ghi sai qua hai đường).
 *
 * CHẠY TUẦN TỰ, không `Promise.all`: mỗi kiện là một lượt gọi API giá của hãng
 * cộng hai lượt Lark — bắn song song hàng loạt là dội cả hai bên cùng lúc.
 * `SO_KIEN_MOI_LUOT` giới hạn quy mô mỗi lượt vì cùng lý do, và `MOC_DIEN_BU`
 * giữ cron khỏi 4 tháng kiện lịch sử (xem features/dong-hang/dien-bu.ts).
 *
 * Vùng chạy: route này nằm trong service Next.js chính
 * (`ShopifyManagementSystem` trong .railway/railway.ts), đã đặt sẵn
 * `asia-southeast1-eqsg3a` cùng vùng DB Singapore (D-051) — không cần khai
 * thêm service/region riêng.
 *
 * Authentication
 * --------------
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://<railway-url>/api/cron/dien-bu-gia-uoc-tinh
 */
import { NextResponse } from 'next/server';
import { canDienBu, layKienCanDienBu } from '@/features/dong-hang/dien-bu';
import { ghiGiaUocTinhLenLark } from '@/features/dong-hang/ghi-gia-uoc-tinh-len-lark';

import { chayJobApi } from '@/features/jobs/api-run';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface KetQuaDienBu {
  tongSoXetDuyet: number;
  ghiDuoc: number;
  boQua: number;
  canhBaos: string[];
}

async function dienBuGiaUocTinh(): Promise<KetQuaDienBu> {
  const kiens = await layKienCanDienBu();
  let ghiDuoc = 0;
  let boQua = 0;
  const canhBaos: string[] = [];

  for (const k of kiens) {
    // Phòng dữ liệu đổi giữa lúc đọc danh sách (SQL) và lúc xử lý tới dòng
    // này — xử lý tuần tự nên có thể có khoảng cách thời gian đáng kể.
    if (!canDienBu(k)) { boQua++; continue; }
    try {
      const r = await ghiGiaUocTinhLenLark(k.id);
      if (r.giaDaGhi) ghiDuoc++; else boQua++;
      if (r.canhBao) canhBaos.push(`${k.id}: ${r.canhBao}`);
    } catch (e) {
      // ghiGiaUocTinhLenLark đã tự bọc try/catch nên nhánh này hiếm khi tới,
      // nhưng một kiện hỏng bất ngờ KHÔNG được chặn các kiện sau trong lượt.
      boQua++;
      canhBaos.push(`${k.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { tongSoXetDuyet: kiens.length, ghiDuoc, boQua, canhBaos: canhBaos.slice(0, 20) };
}

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 });
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${expected}`) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  try {
    /* `kiemTra`: tác vụ chạy xong KHÔNG có nghĩa là làm được việc. Thiếu nó thì một lượt mà
     * 20/20 kiện thất bại vẫn ghi `ok` và trang giám sát báo xanh — đúng cách phụ phí xăng
     * dầu UPS đứng im 11 tuần. Xét hỏng khi có kiện xét duyệt mà KHÔNG kiện nào ghi được. */
    const summary = await chayJobApi('dien-bu-gia-uoc-tinh', dienBuGiaUocTinh, (s) => (
      s.tongSoXetDuyet > 0 && s.ghiDuoc === 0
        ? `0/${s.tongSoXetDuyet} kiện ghi được giá lên Lark${s.canhBaos.length > 0 ? ` — ${s.canhBaos[0]}` : ''}`
        : null
    ));
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
