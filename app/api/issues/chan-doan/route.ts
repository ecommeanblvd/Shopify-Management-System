/**
 * CHỈ-ĐỌC cho tác vụ xử lý báo lỗi hằng đêm (xem `features/issue-report/chan-doan.ts` để biết
 * vì sao có và ranh giới tới đâu).
 *
 * Đặt dưới `/api/issues/` CÓ CHỦ Ý: môi trường cloud của routine tự gắn `Authorization` cho
 * mọi request tới `/api/issues…`, nên con bot không phải (và không được) tự xử lý token.
 *
 * Chỉ GET. Chỉ các câu khai sẵn trong `TRUY_VAN_CHO_PHEP`. Không SQL tự do, không ghi, không
 * trả tên/email/điện thoại/địa chỉ/mã bưu chính của khách.
 *
 *   curl "$BASE/api/issues/chan-doan?q=job-chua-chay"
 *   curl "$BASE/api/issues/chan-doan?q=job-runs&key=dien-bu-gia-uoc-tinh&limit=5"
 *   curl "$BASE/api/issues/chan-doan?q=kien&ma=PK-22436"
 *   curl "$BASE/api/issues/chan-doan?q=kien-mac-gia"
 *   curl "$BASE/api/issues/chan-doan?q=lech-hang"
 */
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { kiemTokenIssue } from '@/features/issue-report/api-auth';
import { docYeuCauChanDoan, type YeuCauChanDoan } from '@/features/issue-report/chan-doan';
import { JOB_REGISTRY } from '@/features/jobs/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/* Alias ĐẶT TRONG NGOẶC KÉP có chủ ý: Postgres hạ chữ thường mọi alias không trích dẫn, nên
 * `as maNhapLuc` trả về khoá `manhapluc`. Tài liệu và prompt của tác vụ hằng đêm ghi tên kiểu
 * camelCase, nên bỏ ngoặc kép là làm con bot đọc sai tên trường — đo thật 27/10/2026 ngay ở
 * lượt kiểm sống đầu tiên. */
type Dong = Record<string, unknown>;
const dong = (r: unknown): Dong[] => (r as { rows?: Dong[] }).rows ?? (r as Dong[]) ?? [];

async function chay(yc: YeuCauChanDoan): Promise<{ mota: string; data: unknown }> {
  if (yc.ten === 'job-runs') {
    const r = await db.execute(sql`
      select started_at::text as "batDau", finished_at::text as "ketThuc", status,
             summary::text as "tomTat", left(coalesce(error,''), 500) as loi
      from job_runs where job_key = ${yc.key}
      order by started_at desc limit ${yc.limit}`);
    return { mota: `lượt chạy gần nhất của tác vụ '${yc.key}'`, data: dong(r) };
  }

  if (yc.ten === 'job-chua-chay') {
    /* Câu đáng giá nhất ở đây: khoá CÓ trong sổ đăng ký mà `job_runs` chưa bao giờ có dòng.
     * Đó đúng là hình dạng của BL-2 — route có, mã có, không ai gọi — và nó im lặng vì không
     * có gì để so sánh. Đối chiếu sổ đăng ký (mã) với sổ chạy thật (CSDL). */
    const r = await db.execute(sql`select distinct job_key from job_runs`);
    const daChay = new Set(dong(r).map((x) => String(x.job_key)));
    const chuaChay = JOB_REGISTRY
      .filter((j) => !daChay.has(j.key))
      .map((j) => ({ key: j.key, ten: j.ten, chuKyPhut: j.chuKyPhut, hauQua: j.hauQua }));
    return {
      mota: `${chuaChay.length}/${JOB_REGISTRY.length} khoá trong sổ đăng ký CHƯA BAO GIỜ chạy`,
      data: chuaChay,
    };
  }

  if (yc.ten === 'kien') {
    // KHÔNG trả mã bưu chính / thành phố / tên / địa chỉ — chỉ nói CÓ hay KHÔNG. Nước đến thì
    // trả thật, vì chính nó là đầu vào của nhánh `!k.country` trong `layGiaUocTinh`.
    const r = await db.execute(sql`
      select s.log_unique_code as "maLog", s.tracking_number as "maVanDon", s.carrier_key as hang,
             s.actual_weight_kg as "canThat", s.sms_weight_kg as "canSms",
             s.dim_length_cm as dai, s.dim_width_cm as rong, s.dim_height_cm as cao,
             s.origin_hub as "khoDi", s.lark_record_id as "dongLark",
             s.label_created_at::text as "nhanTaoLuc", s.created_at::text as "taoLuc",
             s.tracking_nhap_luc::text as "maNhapLuc",
             s.gia_uoc_tinh_ghi_luc::text as "giaGhiLuc",
             o.ship_country as "nuocDen",
             (o.ship_postcode is not null) as "coMaBuuChinh",
             (o.ship_city is not null) as "coThanhPho",
             o.addr_class as "loaiDiaChi", o.selected_carrier_key as "hangDaChon",
             o.shopify_order_number as "soDon",
             o.fulfillment_status as "trangThaiGiao",
             (o.cancelled_at_shopify is not null) as "daHuy"
      from shipments s join shopify_orders o on o.id = s.order_id
      where upper(s.log_unique_code) = upper(${yc.ma})
         or upper(s.tracking_number) = upper(${yc.ma})
      limit ${yc.limit}`);
    return { mota: `kiện theo mã '${yc.ma}' (không có dữ liệu cá nhân của khách)`, data: dong(r) };
  }

  if (yc.ten === 'lech-hang') {
    /* Hai nguồn trong CÙNG MỘT DÒNG đá nhau: `carrier_key` (người nhập chọn hãng) và hãng của
     * `carrier_account_id` (dính theo luồng báo giá). Không có cảnh báo nào nổi lên vì mỗi bên
     * đều tự nhất quán — đúng hình dạng của 311 chiếc kẹt và của BL-2.
     *
     * Đo 28/10/2026: 2 đơn. Hậu quả KHÔNG phải một thứ: đơn `SF…` dưới tài khoản FedEx thì
     * mỗi giờ tốn một lượt gọi FedEx vô ích và không bao giờ có ngày lấy hàng; và ảnh giá của
     * nó được tính trên bảng giá hãng SAI (SF 1.050.300 vs FedEx 1.579.244 cho cùng kiện).
     * Sửa bằng `scripts/du-lieu/sua-tai-khoan-hang-lech.ts` — từng đơn, có người xác nhận. */
    const r = await db.execute(sql`
      select o.code as "maDon", o.carrier_key as "hangTheoKey", c.key as "hangTheoTaiKhoan",
             ca.name as "tenTaiKhoan", o.tracking_number as "maVanDon",
             o.shipped_at::text as "ngayGui", o.picked_up_at::text as "ngayLayHang",
             o.carrier_cost_vnd::text as "giaVon", o.charged_vnd::text as "thuBrand",
             (o.statement_id is not null) as "daLenBangKe"
      from ship_ho_orders o
      join carrier_accounts ca on ca.id = o.carrier_account_id
      join carriers c on c.id = ca.carrier_id
      where o.carrier_key is not null and o.carrier_key <> c.key
      order by o.code limit ${yc.limit}`);
    return { mota: 'đơn ship hộ có carrier_key đá nhau với hãng của tài khoản đang gắn', data: dong(r) };
  }

  // kien-mac-gia — đúng năm điều kiện của `canDienBu`, xem features/dong-hang/dien-bu.ts
  const r = await db.execute(sql`
    select log_unique_code as "maLog", tracking_number as "maVanDon", carrier_key as hang,
           created_at::text as "taoLuc", tracking_nhap_luc::text as "maNhapLuc"
    from shipments
    where tracking_number is not null and lark_record_id is not null
      and gia_uoc_tinh_ghi_luc is null and tracking_nhap_luc is not null
      and created_at >= '2026-10-12'::timestamptz
    order by created_at limit ${yc.limit}`);
  return { mota: 'kiện đã nhập mã qua hệ thống mà CHƯA ghi được giá lên Lark', data: dong(r) };
}

export async function GET(request: Request): Promise<Response> {
  const tu = kiemTokenIssue(request);
  if (tu) return tu;

  const k = docYeuCauChanDoan(new URL(request.url).searchParams);
  if (!k.ok) return NextResponse.json({ ok: false, error: k.loi }, { status: 400 });

  try {
    const { mota, data } = await chay(k.yc);
    return NextResponse.json({ ok: true, q: k.yc.ten, mota, soDong: Array.isArray(data) ? data.length : 1, data });
  } catch (e) {
    console.error('[issue-report] chan-doan lỗi:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 },
    );
  }
}
