/**
 * Đối soát lãi/lỗ mảng ship: TIỀN THU KHÁCH so với TIỀN TRẢ HÃNG, theo từng ĐƠN.
 *
 *   npx dotenv -- npx tsx scripts/du-lieu/doi-soat-lai-ship.ts                      # T7..T10/2026
 *   npx dotenv -- npx tsx scripts/du-lieu/doi-soat-lai-ship.ts --tu 2026-07-01 --den 2026-11-01
 *   npx dotenv -- npx tsx scripts/du-lieu/doi-soat-lai-ship.ts --json <đường dẫn>   # xuất để dựng sổ
 *
 * CHỈ ĐỌC. Không ghi gì vào CSDL.
 *
 * ## Vì sao không dùng thẳng `/f/ship-report`
 *
 * Báo cáo đó cộng doanh thu ship **THEO KIỆN**: truy vấn của nó join `shipments → shopify_orders`
 * rồi lấy `o.total_shipping` trên MỖI DÒNG, nên đơn có 2–4 kiện bị tính tiền thu 2–4 lần (cước
 * hàng hoàn cũng vậy). Đo 29/10/2026 trên T7..T10: **thừa 182.946.920 đ** doanh thu trên 34 đơn
 * nhiều kiện. Lượt này cộng **THEO ĐƠN** — mỗi đơn một lần thu, chi là tổng mọi kiện của nó.
 *
 * ## Thu lấy ở đâu
 *
 * - Store của mình (MEAN BLVD…): `total_shipping` — phí ship khách trả **SAU giảm** (xem
 *   `shopify-mapper.ts`: `netShippingAmount`) — nhân tỉ giá `stores.fx_cost_per_order_currency`.
 * - Store brand (TINH Atelier, Mirer): **`brand_charge_vnd` của từng kiện**, không phải tiền
 *   khách cuối trả — brand chạy free ship thì khách trả 0 mà mình vẫn thu brand (CEO 11/09/2026).
 * - Ship hộ: qua hàm thuần `thuChiShipHo` — KHÔNG tự chọn trong SQL. `actual_charged_vnd` không
 *   gồm duty còn `actual_carrier_cost_vnd` có; quên chỗ đó là margin âm mọi tháng (CEO 28/09).
 *
 * ## Chi lấy ở đâu
 *
 * Tổng `shipment_charges.total_amount` của mọi kiện trong đơn, **cộng** cước hàng hoàn đã gắn về
 * đơn (`carrier_bill_lines.return_of_order_id`) — gắn MỘT lần cho đơn.
 *
 * ## Ba cái lượt này CỐ Ý không làm
 *
 * 1. **Không trừ tiền đã thu hồi.** Kiện được hãng trả lại tiền vẫn mang nguyên `total_amount`
 *    gộp, nên chi bị cao hơn thực. Lượt này in riêng số thu hồi ĐÃ ghi nhận (`recovered_vnd`) để
 *    thấy khoảng chênh, chứ không tự trừ — trừ bằng `credit_notes` thì phải bóc mã vận đơn từ ô
 *    văn bản tự do, không đủ chắc để đưa vào một con số lãi.
 * 2. **Không loại đơn đang khiếu nại.** Nó in cả hai cách đọc (nguyên trạng / bỏ đơn có cờ) vì
 *    đơn hãng tính sai 25 kg cho kiện 1,2 kg không phải là "mình định giá lỗ".
 * 3. **Không bỏ đơn chưa có hoá đơn.** Đơn thiếu một trong hai vế bị loại khỏi phép cộng và đếm
 *    riêng — cộng chúng như 0 thì tháng mới nhất luôn vẽ ra lãi ảo (bệnh đã gặp ở `pnl.ts`).
 */
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { thuChiShipHo } from '@/features/ship-report/thu-chi-ship-ho';

/** `type` chứ KHÔNG `interface`: `db.execute<T>` đòi `T extends Record<string, unknown>`. */
type DongShopify = {
  soDon: string; dom: string; thang: string; kien: number; kienCoBill: number;
  co: number; canVoLy: boolean | null; bill: number | null; brand: number | null;
  thuHoi: number | null; ret: number | null; ship: number; fx: number | null;
  tienDon: string; tienChi: string | null; nuoc: string | null; hang: string | null;
};
type DongShipHo = {
  code: string; thang: string; hang: string | null; nuoc: string | null; brand: string | null;
  ttDoiSoat: string | null; charged: number | null; actualCharged: number | null;
  actualDuty: number | null; cost: number | null; actualCost: number | null;
};

/** Store brand: doanh thu là tiền THU BRAND, không phải tiền khách cuối trả. */
const STORE_BRAND = new Set(['tinhatelier.myshopify.com', 'mirermirer-official.myshopify.com']);

/** Cờ "đơn có vấn đề" — lấy mức NẶNG NHẤT trong các kiện của đơn. */
const CO = ['bình thường', 'lỗi nội bộ', 'đang khiếu nại', 'lỗi hãng (đã gắn cờ)', 'hãng đã trả lại tiền'] as const;

export interface DonShip {
  nguon: 'shopify' | 'ship_ho';
  ma: string;
  thang: string;
  nuoc: string | null;
  hang: string | null;
  /** Nhãn kho/brand — để bóc theo nguồn hàng. */
  khoi: string;
  soKien: number;
  co: number;
  canVoLy: boolean;
  thuHoiVnd: number;
  hoanVnd: number;
  thuVnd: number | null;
  chiVnd: number | null;
}

const doc = (argv: readonly string[], ten: string): string | null => {
  const i = argv.indexOf(`--${ten}`);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};

export async function napDonShip(tu: string, den: string): Promise<DonShip[]> {
  const shopify = (await db.execute<DongShopify>(sql`
    with k as (
      select s.order_id, s.label_created_at, s.carrier_key,
             sc.id as charge_id, sc.total_amount::float8 as bill,
             s.brand_charge_vnd::float8 as brand,
             coalesce(rs.status::text, 'chua_duyet') as tt,
             rs.recovered_vnd::float8 as thu_hoi,
             sc.billing_weight_kg::float8 as can_phi, s.actual_weight_kg::float8 as can_that
        from shipments s
        left join shipment_charges sc on sc.shipment_id = s.id
        left join shipment_reconcile_status rs on rs.shipment_id = s.id
       where s.label_created_at >= ${tu} and s.label_created_at < ${den}
    ),
    -- Cước hàng hoàn gắn về ĐƠN: gộp sẵn ở đây để chỉ cộng MỘT lần cho mỗi đơn.
    tra as (
      select return_of_order_id as oid, sum(total::float8) as ret
        from carrier_bill_lines where return_of_order_id is not null group by 1
    ),
    d as (
      select order_id, min(label_created_at) as ngay, count(*)::int as kien,
             count(charge_id)::int as kien_co_bill,
             sum(bill) as bill, sum(brand) as brand, sum(thu_hoi) as thu_hoi,
             min(carrier_key) as hang,
             max(case tt when 'credited' then 4 when 'carrier_error' then 3
                         when 'disputing' then 2 when 'internal_error' then 1 else 0 end)::int as co,
             -- Hãng tính cân > 3× cân thật: dấu hiệu lỗi cân/bảng giá, không phải mình bán lỗ.
             bool_or(can_phi is not null and can_that is not null and can_that > 0
                     and can_phi > 3 * can_that) as can_vo_ly
        from k group by 1
    )
    select o.shopify_order_number as "soDon", st.shop_domain as dom,
           to_char(d.ngay at time zone 'UTC' at time zone 'Asia/Bangkok', 'YYYY-MM') as thang,
           d.kien, d.kien_co_bill as "kienCoBill", d.co, d.can_vo_ly as "canVoLy",
           d.bill, d.brand, d.thu_hoi as "thuHoi", t.ret, d.hang,
           o.total_shipping::float8 as ship, st.fx_cost_per_order_currency::float8 as fx,
           o.currency as "tienDon", st.cost_currency as "tienChi", o.ship_country as nuoc
      from d
      join shopify_orders o on o.id = d.order_id
      join stores st on st.id = o.store_id
      left join tra t on t.oid = o.id`)).rows;

  const shipHo = (await db.execute<DongShipHo>(sql`
    select code, to_char(created_at at time zone 'UTC' at time zone 'Asia/Bangkok', 'YYYY-MM') as thang,
           carrier_key as hang, country as nuoc, partner_brand_slug as brand,
           reconcile_status::text as "ttDoiSoat",
           charged_vnd::float8 as charged, actual_charged_vnd::float8 as "actualCharged",
           actual_duty_vnd::float8 as "actualDuty",
           carrier_cost_vnd::float8 as cost, actual_carrier_cost_vnd::float8 as "actualCost"
      from ship_ho_orders
     where created_at >= ${tu} and created_at < ${den}
       and status::text not in ('draft', 'cancelled')`)).rows;

  const ra: DonShip[] = shopify.map((x) => {
    const laBrand = STORE_BRAND.has(x.dom);
    /* Cùng đồng tiền thì không nhân tỉ giá; khác mà store chưa khai tỉ giá thì thu = null
     * (chưa đo được), KHÔNG phải 0 — coi là 0 là vẽ ra lỗ đúng bằng tiền cước. */
    const thu = laBrand
      ? x.brand
      : x.tienDon === x.tienChi ? x.ship
        : x.fx != null ? x.ship * x.fx : null;
    const hoan = x.ret ?? 0;
    const chi = x.bill == null && x.ret == null ? null : (x.bill ?? 0) + hoan;
    return {
      nguon: 'shopify', ma: x.soDon, thang: x.thang, nuoc: x.nuoc, hang: x.hang,
      khoi: x.dom.replace('.myshopify.com', ''),
      soKien: x.kien, co: x.co, canVoLy: x.canVoLy === true,
      thuHoiVnd: x.thuHoi ?? 0, hoanVnd: hoan,
      thuVnd: thu == null ? null : Math.round(thu),
      chiVnd: chi == null ? null : Math.round(chi),
    };
  });

  for (const x of shipHo) {
    const tc = thuChiShipHo({
      chargedVnd: x.charged, actualChargedVnd: x.actualCharged, actualDutyVnd: x.actualDuty,
      carrierCostVnd: x.cost, actualCarrierCostVnd: x.actualCost,
    });
    ra.push({
      nguon: 'ship_ho', ma: x.code, thang: x.thang, nuoc: x.nuoc, hang: x.hang,
      khoi: `ship hộ · ${x.brand ?? '—'}`,
      soKien: 1, co: x.ttDoiSoat === 'reconciled' ? 0 : 0, canVoLy: false,
      thuHoiVnd: 0, hoanVnd: 0,
      thuVnd: tc.revenueVnd == null ? null : Math.round(tc.revenueVnd),
      chiVnd: tc.costVnd == null ? null : Math.round(tc.costVnd),
    });
  }
  return ra;
}

const vnd = (n: number) => Math.round(n).toLocaleString('vi-VN');
const bien = (d: DonShip) => (d.thuVnd == null || d.chiVnd == null ? null : d.thuVnd - d.chiVnd);

function inKhoi(ten: string, ds: readonly DonShip[]): void {
  const du = ds.filter((d) => bien(d) != null);
  const thu = du.reduce((s, d) => s + d.thuVnd!, 0);
  const chi = du.reduce((s, d) => s + d.chiVnd!, 0);
  const lo = du.filter((d) => bien(d)! < 0);
  const thieuThu = ds.filter((d) => d.thuVnd == null);
  const thieuChi = ds.filter((d) => d.thuVnd != null && d.chiVnd == null);
  console.log(`\n===== ${ten} =====`);
  console.log(`Đơn đủ cả hai vế : ${du.length}`);
  console.log(`Chưa có giá thu  : ${thieuThu.length} đơn · chi của chúng ${vnd(thieuThu.reduce((s, d) => s + (d.chiVnd ?? 0), 0))} đ`);
  console.log(`Chưa có hoá đơn  : ${thieuChi.length} đơn · thu của chúng ${vnd(thieuChi.reduce((s, d) => s + (d.thuVnd ?? 0), 0))} đ`);
  console.log(`Thu   ${vnd(thu).padStart(15)} đ`);
  console.log(`Chi   ${vnd(chi).padStart(15)} đ`);
  console.log(`LÃI   ${vnd(thu - chi).padStart(15)} đ   (${thu > 0 ? (((thu - chi) / thu) * 100).toFixed(1) : '—'}% doanh thu ship)`);
  console.log(`Đơn LỖ: ${lo.length}/${du.length} — tổng ${vnd(lo.reduce((s, d) => s + bien(d)!, 0))} đ`);
}

async function main(): Promise<void> {
  const tu = doc(process.argv, 'tu') ?? '2026-07-01';
  const den = doc(process.argv, 'den') ?? '2026-11-01';
  const duongJson = doc(process.argv, 'json');
  console.log(`Kỳ: ${tu} → trước ${den}  (mốc = ngày tạo nhãn / ngày tạo đơn ship hộ, giờ UTC+7)\n`);

  const ds = await napDonShip(tu, den);
  inKhoi('TỔNG HAI MẢNG', ds);
  inKhoi('SHOPIFY — hàng của mình', ds.filter((d) => d.nguon === 'shopify'));
  inKhoi('SHIP HỘ — dịch vụ cho brand', ds.filter((d) => d.nguon === 'ship_ho'));

  const sp = ds.filter((d) => d.nguon === 'shopify' && bien(d) != null);
  console.log('\n--- Shopify: bóc đơn LỖ theo việc đã gắn cờ hay chưa ---');
  for (let c = 4; c >= 0; c--) {
    const g = sp.filter((d) => d.co === c);
    if (g.length === 0) continue;
    const gl = g.filter((d) => bien(d)! < 0);
    console.log(`${CO[c].padEnd(24)} ${String(g.length).padStart(4)} đơn · lãi ${vnd(g.reduce((s, d) => s + bien(d)!, 0)).padStart(14)} đ · trong đó ${String(gl.length).padStart(3)} đơn lỗ ${vnd(gl.reduce((s, d) => s + bien(d)!, 0)).padStart(13)} đ`);
  }

  const voLy = sp.filter((d) => d.canVoLy);
  console.log(`\nĐơn bị hãng tính cân > 3× cân thật: ${voLy.length} · chi ${vnd(voLy.reduce((s, d) => s + d.chiVnd!, 0))} đ · lãi/lỗ ${vnd(voLy.reduce((s, d) => s + bien(d)!, 0))} đ`);
  console.log(`Tiền thu hồi ĐÃ ghi nhận trên đơn trong kỳ: ${vnd(ds.reduce((s, d) => s + d.thuHoiVnd, 0))} đ`);
  console.log(`Cước hàng hoàn nằm trong chi: ${vnd(ds.reduce((s, d) => s + d.hoanVnd, 0))} đ trên ${ds.filter((d) => d.hoanVnd > 0).length} đơn`);

  console.log('\n--- Theo tháng (chỉ đơn đủ hai vế) ---');
  const duDs = ds.filter((d) => bien(d) != null);
  for (const th of [...new Set(duDs.map((d) => d.thang))].sort()) {
    const g = duDs.filter((d) => d.thang === th);
    const thu = g.reduce((s, d) => s + d.thuVnd!, 0);
    const chi = g.reduce((s, d) => s + d.chiVnd!, 0);
    const chuaBill = ds.filter((d) => d.thang === th && d.thuVnd != null && d.chiVnd == null).length;
    console.log(`${th}  đơn ${String(g.length).padStart(4)}  thu ${vnd(thu).padStart(14)}  chi ${vnd(chi).padStart(14)}  lãi ${vnd(thu - chi).padStart(13)}  (${(((thu - chi) / thu) * 100).toFixed(1)}%)  lỗ ${String(g.filter((d) => bien(d)! < 0).length).padStart(3)} đơn · còn ${chuaBill} đơn chưa có hoá đơn`);
  }

  if (duongJson) {
    writeFileSync(duongJson, JSON.stringify({ tu, den, don: ds }, null, 0), 'utf8');
    console.log(`\nĐã ghi ${ds.length} dòng vào ${duongJson}`);
  }
  process.exit(0);
}

void main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
