/**
 * Xuất DỮ LIỆU THÔ của mảng ship để người kiểm bằng tay: từng đơn, từng kiện, từng mục chi phí,
 * kèm SỐ HOÁ ĐƠN của hãng. Chỉ đọc.
 *
 *   npx dotenv -- npx tsx scripts/du-lieu/xuat-chi-tiet-ship.ts --json <đường dẫn>
 *   npx dotenv -- npx tsx scripts/du-lieu/xuat-chi-tiet-ship.ts --tu 2026-04-01 --den 2026-11-01 --json ra.json
 *
 * Rồi dựng sổ Excel: `python3 scripts/du-lieu/dung-so-chi-tiet-ship.py ra.json so.xlsx`
 *
 * ## Khác gì `doi-soat-lai-ship.ts`
 *
 * Tệp kia trả KẾT LUẬN (lãi/lỗ, bao nhiêu đơn lỗ). Tệp này trả **mọi dòng, không loại gì**, kể
 * cả đơn chưa có hoá đơn — để đối chiếu tay với hoá đơn giấy. Cùng luật thu/chi, nhưng **hai số
 * tổng KHÔNG bằng nhau, và đó là cố ý**:
 *
 * - Tệp này để MỖI ĐƠN MỘT DÒNG, **không gộp** đơn đi ghép chung kiện — vì gộp thì không còn
 *   dòng nào ứng với một mã đơn để anh soi. Hệ quả: đơn đi ghép không có cước nên bị loại, còn
 *   đơn chủ gánh nguyên cước của cả hai.
 * - Tệp này chỉ lấy kiện TRONG cửa sổ; tệp kia lấy mọi kiện của đơn (xem lỗ hổng 1 ở tệp đó).
 *
 * Đo T4..T10/2026: lệch **6.060.052 đ trên 7 đơn**, bóc đủ ở sheet *Khớp hai số* của sổ Excel —
 * truyền thêm `--ketLuan <json của doi-soat-lai-ship>` cho `dung-so-chi-tiet-ship.py` thì nó tự
 * dựng sheet đó. Chỗ nào lệch mà KHÔNG nằm trong hai nguyên nhân trên là có lỗi thật.
 *
 * ## Một kiện có thể nằm trên NHIỀU hoá đơn
 *
 * Hãng tách cước và thuế nhập khẩu thành hai tờ (đo thật: `1Z2050VDD919649050` có 1 tờ UPS cước
 * + 2 tờ FedEx của lượt gửi trước). Nên số hoá đơn trả về là **danh sách**, không phải một ô.
 *
 * ## Chi phí lấy từ `shipment_charges`, KHÔNG từ `carrier_bill_lines`
 *
 * `shipment_charges` là bảng đã chuẩn hoá mà cả engine đối soát dùng; `carrier_bill_lines` là
 * dòng thô theo tờ hoá đơn. Lấy hai nguồn khác nhau cho cùng một con số là tự tạo ra lệch. Dòng
 * hoá đơn chỉ dùng để lấy **số tờ và ngày tờ**, cộng cước HÀNG HOÀN (`return_of_order_id`) —
 * khoản này không có trong `shipment_charges`.
 */
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

type Kien = Record<string, unknown>;

const doc = (argv: readonly string[], ten: string): string | null => {
  const i = argv.indexOf(`--${ten}`);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};

async function main(): Promise<void> {
  const tu = doc(process.argv, 'tu') ?? '2026-04-01';
  const den = doc(process.argv, 'den') ?? '2026-11-01';
  const duong = doc(process.argv, 'json');
  if (!duong) { console.log('Thiếu --json <đường dẫn>'); process.exit(1); }

  /* Gộp dòng hoá đơn về KIỆN trước khi join, nếu không thì kiện nằm trên 2 tờ sẽ nhân đôi dòng
   * kiện và mọi khoản chi phí bị cộng hai lần. */
  const kien = (await db.execute<Kien>(sql`
    with hd as (
      select bl.shipment_id as sid,
             string_agg(distinct b.bill_number, ' + ' order by b.bill_number) as "soHoaDon",
             min(b.issue_date)::text as "ngayHoaDonSom",
             max(b.issue_date)::text as "ngayHoaDonMuon",
             count(*)::int as "soDongHoaDon",
             sum(bl.total::float8) as "tongDongHoaDon",
             sum(bl.duty::float8) as "thueNhapKhauTrenTo",
             min(bl.ship_date)::text as "ngayGuiTheoHoaDon",
             min(bl.weight_kg::float8) as "canTrenHoaDon",
             max(b.fx_rate::float8) as "tyGiaHoaDon"
        from carrier_bill_lines bl
        join carrier_bills b on b.id = bl.bill_id
       where bl.shipment_id is not null
       group by 1
    )
    select o.shopify_order_number as "maDon", st.shop_domain as "store",
           s.log_unique_code as "maLog", s.tracking_number as "maVanDon",
           s.label_created_at::text as "ngayTaoNhan",
           to_char(s.label_created_at at time zone 'UTC' at time zone 'Asia/Bangkok', 'YYYY-MM') as thang,
           o.ship_country as "nuoc", o.ship_city as "thanhPho", o.addr_class as "loaiDiaChi",
           s.carrier_key as "hangTheoKien", ca.name as "taiKhoanHang",
           s.actual_weight_kg::float8 as "canThat", s.sms_weight_kg::float8 as "canSms",
           sc.billing_weight_kg::float8 as "canTinhPhi",
           s.dim_length_cm::float8 as dai, s.dim_width_cm::float8 as rong, s.dim_height_cm::float8 as cao,
           s.packaging_type as "loaiBaoBi",
           o.total_shipping::float8 as "thuKhachNguyenTe", o.currency as "donViTien",
           o.shipping_discount::float8 as "giamShipChoKhach",
           st.fx_cost_per_order_currency::float8 as "tyGiaStore",
           s.brand_charge_vnd::float8 as "thuBrand",
           hd."soHoaDon", hd."ngayHoaDonSom", hd."ngayHoaDonMuon", hd."soDongHoaDon",
           hd."tongDongHoaDon", hd."thueNhapKhauTrenTo", hd."ngayGuiTheoHoaDon",
           hd."canTrenHoaDon", hd."tyGiaHoaDon",
           sc.base::float8 as "cuocGoc", sc.discount::float8 as "giamGia",
           sc.fuel::float8 as "xangDau", sc.remote::float8 as "vungSau",
           sc.demand::float8 as "phuPhiMuaCao", sc.direct_signature::float8 as "kyNhanTrucTiep",
           sc.residential::float8 as "nhaDan", sc.residential_class as "hangDiaChi",
           sc.address_correction::float8 as "suaDiaChi", sc.import_handling::float8 as "xuLyNhapKhau",
           sc.elevated_risk::float8 as "nguyCoCao", sc.gogreen::float8 as "gogreen",
           sc.non_conveyable::float8 as "khongBangTai", sc.vat::float8 as "vat",
           sc.total_amount::float8 as "tongCuoc", sc.currency as "donViCuoc",
           sc.source as "nguonCuoc", sc.imported_at::text as "nhapCuocLuc",
           coalesce(rs.status::text, 'chua_duyet') as "trangThaiDoiSoat",
           rs.carrier_error_kind as "loaiLoiHang",
           rs.delta_vnd_at_review::float8 as "lechLucDuyet",
           rs.recovered_vnd::float8 as "daThuHoi", rs.credit_note_number as "soChungTuHoanTien",
           rs.note as "ghiChuDoiSoat",
           s.cac_don_trong_kien as "cacDonTrongKien",
           s.delivery_status as "trangThaiGiao", s.delivered_at::text as "ngayGiao"
      from shipments s
      join shopify_orders o on o.id = s.order_id
      join stores st on st.id = o.store_id
      left join shipment_charges sc on sc.shipment_id = s.id
      left join carrier_accounts ca on ca.id = sc.carrier_account_id
      left join shipment_reconcile_status rs on rs.shipment_id = s.id
      left join hd on hd.sid = s.id
     where s.label_created_at >= ${tu} and s.label_created_at < ${den}
     order by s.label_created_at, o.shopify_order_number`)).rows;

  // Cước HÀNG HOÀN: dòng hoá đơn gắn về ĐƠN, không về kiện — nên ra bảng riêng.
  const hoan = (await db.execute<Kien>(sql`
    select o.shopify_order_number as "maDon", b.bill_number as "soHoaDon",
           b.issue_date::text as "ngayHoaDon", bl.tracking_number as "maVanDon",
           bl.weight_kg::float8 as "can", bl.base::float8 as "cuocGoc",
           bl.discount::float8 as "giamGia", bl.fuel::float8 as "xangDau",
           bl.duty::float8 as "thueNhapKhau", bl.vat::float8 as "vat",
           bl.other::float8 as "khac", bl.total::float8 as "tong", bl.note as "ghiChu"
      from carrier_bill_lines bl
      join carrier_bills b on b.id = bl.bill_id
      join shopify_orders o on o.id = bl.return_of_order_id
     where bl.return_of_order_id is not null
     order by b.issue_date, o.shopify_order_number`)).rows;

  // Danh sách HOÁ ĐƠN hãng trong kỳ, để đối chiếu tổng tờ với tổng dòng.
  const hoaDon = (await db.execute<Kien>(sql`
    select b.bill_number as "soHoaDon", ca.name as "taiKhoanHang",
           b.issue_date::text as "ngayHoaDon", b.period_start::text as "kyTu",
           b.period_end::text as "kyDen", b.amount::float8 as "tienTrenTo",
           b.pdf_amount::float8 as "tienTrenPdf", b.currency as "donViTien",
           b.fx_rate::float8 as "tyGia", b.filename as "tenFile",
           count(bl.id)::int as "soDong", sum(bl.total::float8) as "tongDong",
           count(bl.shipment_id)::int as "soDongGanDuocKien"
      from carrier_bills b
      left join carrier_accounts ca on ca.id = b.carrier_account_id
      left join carrier_bill_lines bl on bl.bill_id = b.id
     where b.issue_date >= ${tu} and b.issue_date < ${den}
     group by b.id, ca.name
     order by b.issue_date, b.bill_number`)).rows;

  const shipHo = (await db.execute<Kien>(sql`
    select h.code as "maDon", h.partner_brand_slug as "brand",
           to_char(h.created_at at time zone 'UTC' at time zone 'Asia/Bangkok', 'YYYY-MM') as thang,
           h.created_at::text as "taoLuc", h.carrier_key as "hangTheoKey",
           ca.name as "taiKhoanHang", h.country as "nuoc", h.tracking_number as "maVanDon",
           h.weight_kg::float8 as "can", h.status::text as "trangThai",
           h.reconcile_status::text as "trangThaiDoiSoat", h.reconcile_decision as "quyetDinh",
           h.charged_vnd::float8 as "thuDuTinh", h.actual_charged_vnd::float8 as "thuThuc",
           h.actual_duty_vnd::float8 as "thueNhapKhau",
           h.carrier_cost_vnd::float8 as "giaVonDuTinh",
           h.actual_carrier_cost_vnd::float8 as "giaVonThuc",
           h.actual_bill_breakdown as "bocChiTietHoaDon",
           h.statement_id as "bangKe", h.shipped_at::text as "ngayGui",
           h.picked_up_at::text as "ngayLayHang"
      from ship_ho_orders h
      left join carrier_accounts ca on ca.id = h.carrier_account_id
     where h.created_at >= ${tu} and h.created_at < ${den}
       and h.status::text not in ('draft', 'cancelled')
     order by h.created_at`)).rows;

  writeFileSync(duong, JSON.stringify({ tu, den, kien, hoan, hoaDon, shipHo }), 'utf8');
  console.log(`kiện ${kien.length} · hàng hoàn ${hoan.length} · hoá đơn ${hoaDon.length} · ship hộ ${shipHo.length}`);
  console.log(`Đã ghi ${duong}`);
  process.exit(0);
}

if (process.argv[1]?.endsWith('xuat-chi-tiet-ship.ts')) {
  void main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
