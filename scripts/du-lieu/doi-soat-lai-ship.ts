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
 * ## Ba lỗ hổng quanh phép ghép — đã vá 29/10/2026 (CEO hỏi đúng chỗ này)
 *
 * Ghép nhiều kiện về một đơn là đúng, nhưng quanh nó có ba ca mà bản đầu đếm sai:
 *
 * 1. **Kiện của đơn nằm NGOÀI cửa sổ thời gian.** Cửa sổ chỉ dùng để CHỌN đơn nào thuộc kỳ;
 *    chi phí thì lấy **mọi kiện của đơn đó**, kể cả kiện gửi tháng khác. Bản đầu lọc kiện theo
 *    cửa sổ nên đơn bị hụt cước và trông đẹp hơn thực — đo: 5 đơn, hụt 3.829.723 đ.
 * 2. **Đơn nhiều kiện mà chỉ MỘT PHẦN kiện có hoá đơn.** Bản đầu vẫn coi là "đủ hai vế" rồi cộng
 *    chi phí thiếu. Nay đơn nào còn kiện chưa có hoá đơn thì rơi vào ô *chưa đủ hoá đơn* và bị
 *    loại khỏi phép cộng — cùng luật với đơn một kiện — đo: 6 đơn, thiếu nhất là `#MBLVD30428`
 *    (thu 12.545.000 mà chỉ cộng cước của 1/2 kiện).
 * 3. **Một KIỆN chở NHIỀU ĐƠN** (`shipments.cac_don_trong_kien`). Kiện chỉ gắn `order_id` vào MỘT
 *    đơn, nên đơn đi ghép không có kiện nào của riêng nó và **biến mất khỏi đối soát**, còn đơn
 *    chủ gánh nguyên cước của cả hai. Đo: 7 kiện chở 2 đơn; **12.036.440 đ tiền thu bị bỏ ngoài**,
 *    và `#MBLVD30149` bị ghi **lỗ −198.780 đ** dù cặp của nó thật ra **lãi +1.315.460 đ**.
 *    Nay các đơn dùng chung một kiện được gộp thành MỘT đơn vị: thu là tổng thu của chúng, cước
 *    của kiện chỉ tính một lần.
 *
 * ## Ba thứ lượt này CỐ Ý không làm
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
import { gopDonChungKien } from '@/features/ship-report/gop-don-chung-kien';

/** `type` chứ KHÔNG `interface`: `db.execute<T>` đòi `T extends Record<string, unknown>`. */
type DongKien = {
  kienId: string; donId: string; soDon: string; dom: string; ngay: string | null;
  trongKy: boolean; bill: number | null; coBill: boolean; brand: number | null;
  thuHoi: number | null; tt: string; canVoLy: boolean | null;
  hang: string | null; donTrongKien: string[] | null;
};
type DongDon = {
  donId: string; soDon: string; dom: string; nuoc: string | null;
  ship: number; fx: number | null; tienDon: string; tienChi: string | null;
  hoan: number | null;
};
type DongShipHo = {
  code: string; thang: string; hang: string | null; nuoc: string | null; brand: string | null;
  charged: number | null; actualCharged: number | null; actualDuty: number | null;
  cost: number | null; actualCost: number | null;
};

/** Store brand: doanh thu là tiền THU BRAND, không phải tiền khách cuối trả. */
const STORE_BRAND = new Set(['tinhatelier.myshopify.com', 'mirermirer-official.myshopify.com']);

/** Cờ "đơn có vấn đề" — lấy mức NẶNG NHẤT trong các kiện của đơn. */
const CO = ['bình thường', 'lỗi nội bộ', 'đang khiếu nại', 'lỗi hãng (đã gắn cờ)', 'hãng đã trả lại tiền'] as const;

const NANG: Record<string, number> = {
  credited: 4, carrier_error: 3, disputing: 2, internal_error: 1,
};

export interface DonShip {
  nguon: 'shopify' | 'ship_ho';
  /** Mã đơn; đơn vị GỘP (nhiều đơn dùng chung một kiện) ghi đủ các mã, cách nhau bằng " + ". */
  ma: string;
  thang: string;
  nuoc: string | null;
  hang: string | null;
  /** Nhãn kho/brand — để bóc theo nguồn hàng. */
  khoi: string;
  soKien: number;
  /** Số kiện ĐÃ có hoá đơn hãng. Nhỏ hơn `soKien` ⇒ chi chưa đủ ⇒ không đưa vào phép cộng. */
  soKienCoBill: number;
  /** Số đơn Shopify trong đơn vị này (>1 khi nhiều đơn dùng chung một kiện). */
  soDonGop: number;
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
  /* Cửa sổ thời gian chỉ dùng để CHỌN đơn nào thuộc kỳ. Chi phí thì lấy MỌI kiện của đơn đó —
   * kể cả kiện gửi tháng khác — nếu không thì đơn bị hụt cước và trông lãi hơn thực. */
  const kien = (await db.execute<DongKien>(sql`
    with don_trong_ky as (
      select distinct order_id from shipments
       where label_created_at >= ${tu} and label_created_at < ${den}
    )
    select s.id as "kienId", o.id as "donId", o.shopify_order_number as "soDon",
           st.shop_domain as dom, s.label_created_at::text as ngay,
           (s.label_created_at >= ${tu} and s.label_created_at < ${den}) as "trongKy",
           sc.total_amount::float8 as bill, (sc.id is not null) as "coBill",
           s.brand_charge_vnd::float8 as brand, rs.recovered_vnd::float8 as "thuHoi",
           coalesce(rs.status::text, 'chua_duyet') as tt, s.carrier_key as hang,
           (sc.billing_weight_kg is not null and s.actual_weight_kg is not null
            and s.actual_weight_kg::float8 > 0
            and sc.billing_weight_kg::float8 > 3 * s.actual_weight_kg::float8) as "canVoLy",
           s.cac_don_trong_kien as "donTrongKien"
      from don_trong_ky d
      join shipments s on s.order_id = d.order_id
      join shopify_orders o on o.id = s.order_id
      join stores st on st.id = o.store_id
      left join shipment_charges sc on sc.shipment_id = s.id
      left join shipment_reconcile_status rs on rs.shipment_id = s.id`)).rows;

  /* Đơn đi ghép (có mã trong `cac_don_trong_kien` mà KHÔNG có kiện riêng) cũng phải nạp, nếu
   * không thì tiền thu của nó biến mất — đo 29/10: 12.036.440 đ trên 7 cặp. */
  const maTrongKien = [...new Set(kien.flatMap((k) => k.donTrongKien ?? []))];
  const maCanNap = [...new Set([...kien.map((k) => k.soDon), ...maTrongKien])];
  const don = (await db.execute<DongDon>(sql`
    with tra as (
      select return_of_order_id as oid, sum(total::float8) as ret
        from carrier_bill_lines where return_of_order_id is not null group by 1
    )
    select o.id as "donId", o.shopify_order_number as "soDon", st.shop_domain as dom,
           o.ship_country as nuoc, o.total_shipping::float8 as ship,
           st.fx_cost_per_order_currency::float8 as fx, o.currency as "tienDon",
           st.cost_currency as "tienChi", t.ret as hoan
      from shopify_orders o
      join stores st on st.id = o.store_id
      left join tra t on t.oid = o.id
     where o.shopify_order_number in ${maCanNap}`)).rows;

  const kienTheoDon = new Map<string, DongKien[]>();
  for (const k of kien) {
    const a = kienTheoDon.get(k.soDon) ?? [];
    a.push(k);
    kienTheoDon.set(k.soDon, a);
  }

  /* Thu của MỘT đơn. Store brand tính theo `brand_charge_vnd` của từng kiện nên phải cộng từ
   * kiện; store của mình thì lấy phí ship trên đơn, nhân tỉ giá khi khác đồng tiền. Khác đồng mà
   * store chưa khai tỉ giá ⇒ null (chưa đo được), KHÔNG phải 0 — coi là 0 là vẽ ra lỗ bằng cước. */
  const thuCuaDon = (d: DongDon): number | null => {
    if (STORE_BRAND.has(d.dom)) {
      const ks = kienTheoDon.get(d.soDon) ?? [];
      const co = ks.filter((k) => k.brand != null);
      return co.length === 0 ? null : co.reduce((s, k) => s + (k.brand ?? 0), 0);
    }
    if (d.tienDon === d.tienChi) return d.ship;
    return d.fx != null ? d.ship * d.fx : null;
  };

  // Một kiện chở nhiều đơn ⇒ các đơn đó về cùng một đơn vị, cước kiện chỉ tính MỘT lần.
  const canh: [string, string][] = [];
  for (const k of kien) {
    for (const m of k.donTrongKien ?? []) if (m !== k.soDon) canh.push([k.soDon, m]);
  }
  const goc = gopDonChungKien(canh);
  const donVi = new Map<string, DongDon[]>();
  for (const d of don) {
    const g = goc.get(d.soDon) ?? d.soDon;
    const a = donVi.get(g) ?? [];
    a.push(d);
    donVi.set(g, a);
  }

  const ra: DonShip[] = [];
  for (const [, ds] of donVi) {
    // Kiện của đơn vị: hợp mọi kiện của mọi đơn thành viên, bỏ trùng theo id kiện.
    const ks = [...new Map(ds.flatMap((d) => kienTheoDon.get(d.soDon) ?? []).map((k) => [k.kienId, k])).values()];
    if (ks.length === 0) continue; // đơn vị không có kiện nào trong kỳ — không thuộc kỳ này
    const trongKy = ks.filter((k) => k.trongKy);
    if (trongKy.length === 0) continue;

    const thuMoiDon = ds.map(thuCuaDon);
    /* Một thành viên chưa có giá thu ⇒ cả đơn vị để null. Cộng thu MỘT PHẦN đối lại cước TOÀN
     * BỘ của kiện là vẽ ra lỗ không có thật. */
    const thu: number | null = thuMoiDon.some((x) => x == null)
      ? null : thuMoiDon.reduce<number>((t, x) => t + (x ?? 0), 0);
    const hoan = ds.reduce((s, d) => s + (d.hoan ?? 0), 0);
    const soKienCoBill = ks.filter((k) => k.coBill).length;
    /* Còn kiện chưa có hoá đơn ⇒ chi CHƯA ĐỦ ⇒ để null, rơi vào ô đếm riêng. Cộng chi thiếu
     * thì đơn trông lãi hơn thực — đúng bệnh mà `pnl.ts` đã chốt là không được mắc. */
    const chi = soKienCoBill < ks.length ? null
      : ks.reduce((s, k) => s + (k.bill ?? 0), 0) + hoan;

    const dauTien = trongKy.map((k) => k.ngay).filter((x): x is string => x != null).sort()[0];
    ra.push({
      nguon: 'shopify',
      ma: ds.map((d) => d.soDon).sort().join(' + '),
      thang: dauTien != null ? thangUtc7(dauTien) : '—',
      nuoc: ds[0].nuoc,
      hang: ks[0].hang,
      khoi: ds[0].dom.replace('.myshopify.com', ''),
      soKien: ks.length,
      soKienCoBill,
      soDonGop: ds.length,
      co: Math.max(...ks.map((k) => NANG[k.tt] ?? 0)),
      canVoLy: ks.some((k) => k.canVoLy === true),
      thuHoiVnd: ks.reduce((s, k) => s + (k.thuHoi ?? 0), 0),
      hoanVnd: hoan,
      thuVnd: thu == null ? null : Math.round(thu),
      chiVnd: chi == null ? null : Math.round(chi),
    });
  }

  const shipHo = (await db.execute<DongShipHo>(sql`
    select code, to_char(created_at at time zone 'UTC' at time zone 'Asia/Bangkok', 'YYYY-MM') as thang,
           carrier_key as hang, country as nuoc, partner_brand_slug as brand,
           charged_vnd::float8 as charged, actual_charged_vnd::float8 as "actualCharged",
           actual_duty_vnd::float8 as "actualDuty",
           carrier_cost_vnd::float8 as cost, actual_carrier_cost_vnd::float8 as "actualCost"
      from ship_ho_orders
     where created_at >= ${tu} and created_at < ${den}
       and status::text not in ('draft', 'cancelled')`)).rows;

  for (const x of shipHo) {
    const tc = thuChiShipHo({
      chargedVnd: x.charged, actualChargedVnd: x.actualCharged, actualDutyVnd: x.actualDuty,
      carrierCostVnd: x.cost, actualCarrierCostVnd: x.actualCost,
    });
    ra.push({
      nguon: 'ship_ho', ma: x.code, thang: x.thang, nuoc: x.nuoc, hang: x.hang,
      khoi: `ship hộ · ${x.brand ?? '—'}`,
      soKien: 1, soKienCoBill: tc.costVnd == null ? 0 : 1, soDonGop: 1,
      co: 0, canVoLy: false, thuHoiVnd: 0, hoanVnd: 0,
      thuVnd: tc.revenueVnd == null ? null : Math.round(tc.revenueVnd),
      chiVnd: tc.costVnd == null ? null : Math.round(tc.costVnd),
    });
  }
  return ra;
}

/** Gom tháng theo GIỜ NGHIỆP VỤ (UTC+7): đơn cuối tháng gửi buổi tối giờ VN bị UTC xếp sang
 *  tháng trước — đo 04/09 có 91 đơn lệch tháng, tức doanh thu tháng sai. Xem lib/timezone.ts. */
function thangUtc7(moc: string): string {
  const t = new Date(`${moc.replace(' ', 'T')}Z`);
  const vn = new Date(t.getTime() + 7 * 3600_000);
  return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
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
  const thieuMotPhan = thieuChi.filter((d) => d.soKienCoBill > 0);
  console.log(`Chưa đủ hoá đơn  : ${thieuChi.length} đơn · thu của chúng ${vnd(thieuChi.reduce((s, d) => s + (d.thuVnd ?? 0), 0))} đ`);
  if (thieuMotPhan.length > 0) {
    console.log(`  trong đó ĐƠN NHIỀU KIỆN mới có hoá đơn một phần: ${thieuMotPhan.length} — ${thieuMotPhan.map((d) => `${d.ma} (${d.soKienCoBill}/${d.soKien})`).join(', ')}`);
  }
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

  const gop = ds.filter((d) => d.soDonGop > 1);
  const nhieuKien = ds.filter((d) => d.nguon === 'shopify' && d.soKien > 1);
  console.log(`\nĐơn vị GỘP (nhiều đơn dùng chung một kiện): ${gop.length} — ${gop.map((d) => d.ma).join(' · ') || 'không có'}`);
  console.log(`Đơn nhiều kiện đã ghép về một đơn: ${nhieuKien.length}`);

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

/* Chỉ chạy khi gọi THẲNG tệp này. Không có cổng này thì `import { napDonShip }` ở nơi khác sẽ
 * kích `main()` rồi `process.exit(0)` giết luôn tiến trình gọi — mắc đúng lỗi đó 29/10/2026. */
if (process.argv[1]?.endsWith('doi-soat-lai-ship.ts')) {
  void main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
