/**
 * Sinh CONFIG zone kết hợp FedEx×DHL cho TOÀN BỘ nước có FedEx zone trong
 * `carrier_zone_countries` (bộ ~192 nước), gom theo cặp (fedexZone, dhlZone)
 * thành các zone kết hợp, định giá MỖI zone theo CHÍNH engine + offer-pricing
 * mà 2 script per-market đang dùng (gen-fedex-offer-matrix.ts /
 * gen-dhl-offer-matrix.ts), rồi ghi 1 dòng hợp nhất vào bảng hệ thống
 * `manual_shipping_config` (marketHandle = 'system').
 *
 *   npx dotenv -- tsx scripts/gen-system-shipping-matrix.ts          # DRY-RUN (mặc định, KHÔNG ghi)
 *   npx dotenv -- tsx scripts/gen-system-shipping-matrix.ts --apply  # DELETE all + INSERT 1 dòng 'system'
 *
 * Logic giá GIỮ NGUYÊN với 2 script gốc:
 *   - FedEx IP (a–b kg): quote mỗi nước trong zone ở bậc b qua snapshot FedEx,
 *     rồi fedexOfferPrice(quotes) = ((cost+$5)×markup) max-theo-nước, ceil $0.5.
 *   - DHL Express (a–b kg): tương tự nhưng dùng snapshot DHL, chỉ trên các nước
 *     trong zone CÓ DHL zone. (DHL dùng chung hàm fedexOfferPrice — như script gốc.)
 *   - Bộ bậc cân FedEx lấy từ seed cici 'middle-east'; bộ bậc DHL lấy từ zone cici
 *     có nhiều key "DHL Express" nhất (giống y 2 script gốc).
 *
 * buildSystemShippingTree() merge mọi dòng → nên 1 dòng 'system' = cả cây.
 */
import 'dotenv/config';
import { eq, ilike, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote } from '@/features/carrier-rates/engine/quote';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { fuelBandMidpoint } from '@/features/carrier-rates/fuel-band';
import { fedexOfferPrice } from '@/features/markets/domain/fedex-offer-pricing';
import type { ShippingRate, ShippingZone, MarketShipping } from '@/features/markets/types';

const FEDEX = '5683f3c0-9249-40c1-a3e7-d967f0d62c29';
const CICI_STORE = '04b6d06f-2747-4a86-9084-2cef7c2f88fa'; // cici-mean

/** Upper-bound parse từ key "... (a–b kg)" → b. EN-DASH '–' (U+2013). */
function upperOf(key: string): number | null {
  const m = key.match(/–\s*([\d.]+)\s*kg/);
  return m ? Number(m[1]) : null;
}

/** Trích nhãn ngắn: "Zone H"→"H". (không dùng cho zone name nhưng tiện debug) */
function zoneShort(label: string): string {
  return label.replace(/^Zone\s+/i, '').trim();
}

// ── Region classifier ──────────────────────────────────────────────────────
// Bước 1: từ market_templates (specific markets ưu tiên hơn broad). Map handle→code.
// Áp các market CỤ THỂ (ME, SEA, GC, JP, KR, OC, NA) TRƯỚC broad (EU). Bỏ qua
// các catch-all quá rộng/chồng lấn cho phân loại.
const MARKET_REGION_CODE: Record<string, string> = {
  'middle-east': 'ME',
  'south-east-asia': 'SEA',
  'greater-china': 'GC',
  japan: 'JP',
  korea: 'KR',
  canada: 'NA',
  america: 'NA',
  'united-states': 'NA',
  oceania: 'OC',
  europe: 'EU',
};
// Thứ tự ưu tiên: specific trước, broad (EU) sau.
const MARKET_PRIORITY = [
  'middle-east', 'south-east-asia', 'greater-china', 'japan', 'korea',
  'oceania', 'canada', 'america', 'united-states', 'europe',
];
const MARKET_IGNORE = new Set([
  'asia-and-oceania', 'rest-of-the-world',
  'restricted-destination-and-elevated-risk', 'international', 'vietnam-domestic',
]);

// Bước 2: static continent maps (chỉ dùng khi không match market ở bước 1).
const AF = new Set(['DZ','AO','BJ','BW','BF','BI','CM','CV','CF','TD','KM','CG','CD','CI','DJ','EG','GQ','ER','SZ','ET','GA','GM','GH','GN','GW','KE','LS','LR','LY','MG','MW','ML','MR','MU','MA','MZ','NA','NE','NG','RW','ST','SN','SC','SL','SO','ZA','SS','SD','TZ','TG','TN','UG','ZM','ZW','RE','YT','SH']);
const LATAM = new Set(['AR','BO','BR','CL','CO','CR','CU','DO','EC','SV','GT','HN','NI','PA','PY','PE','UY','VE','BZ','AG','AI','AW','BS','BB','BQ','VG','KY','CW','DM','GD','GP','JM','MQ','MS','PR','BL','KN','LC','MF','VC','SX','TT','TC','HT','GF','SR','GY','FK']);
const SAS = new Set(['IN','PK','BD','LK','NP','BT','MV','AF']);
const OC_EXTRA = new Set(['FJ','PG','NC','PF','WS','TO','VU','SB','KI','NR','TV','NU','CK','WF','AS','GU','FM','MH','PW','TL']);

/**
 * Trả region code cho 1 country code (UPPER), dùng:
 *  1) market_templates (specific trước broad), 2) static continent map, 3) RW.
 * `marketCountryRegion` = Map cc→code dựng sẵn từ market_templates.
 */
function regionOf(cc: string, marketCountryRegion: Map<string, string>): string {
  const m = marketCountryRegion.get(cc);
  if (m) return m;
  if (AF.has(cc)) return 'AF';
  if (LATAM.has(cc)) return 'LATAM';
  if (SAS.has(cc)) return 'SAS';
  if (OC_EXTRA.has(cc)) return 'OC';
  return 'RW';
}

/** Map countryCode → zone label cho 1 carrier account (join zones cho label). */
async function loadZoneOf(carrierAccountId: string): Promise<Map<string, string>> {
  const [zones, zoneCountries] = await Promise.all([
    db.select().from(schema.carrierZones)
      .where(eq(schema.carrierZones.carrierAccountId, carrierAccountId)),
    db.select().from(schema.carrierZoneCountries)
      .where(eq(schema.carrierZoneCountries.carrierAccountId, carrierAccountId)),
  ]);
  const labelById = new Map(zones.map((z) => [z.id, z.label]));
  const out = new Map<string, string>();
  for (const zc of zoneCountries) {
    const label = labelById.get(zc.carrierZoneId);
    if (label) out.set(zc.countryCode.toUpperCase(), label);
  }
  return out;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(apply
    ? '*** --apply: SẼ DELETE ALL + INSERT 1 dòng vào manual_shipping_config ***'
    : 'DRY-RUN — chỉ in, KHÔNG ghi.');

  // ── 1) Carrier accounts + zone maps ──────────────────────────────────────
  const [dhlAccount] = await db.select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name })
    .from(schema.carrierAccounts)
    .where(ilike(schema.carrierAccounts.name, '%DHL%'))
    .limit(1);
  if (!dhlAccount) throw new Error('Không tìm thấy carrier account DHL (name ILIKE %DHL%).');

  const fedexZoneOf = await loadZoneOf(FEDEX);
  const dhlZoneOf = await loadZoneOf(dhlAccount.id);
  console.log(`Zone map: FedEx ${fedexZoneOf.size} nước, DHL ${dhlZoneOf.size} nước (${dhlAccount.name}).`);

  // ── 1b) Region classifier từ market_templates ────────────────────────────
  // Dựng map cc(UPPER) → region code. Áp specific markets TRƯỚC broad (europe),
  // bỏ qua các catch-all. Country đứng sau (broad) KHÔNG đè country đã gán bởi
  // market cụ thể hơn (vì specific được duyệt trước trong MARKET_PRIORITY).
  const marketRows = await db.select({
    handle: schema.marketTemplates.handle,
    countries: schema.marketTemplates.countries,
  }).from(schema.marketTemplates);
  const marketCountries = new Map<string, string[]>();
  for (const r of marketRows) {
    const ccs = Array.isArray(r.countries) ? (r.countries as string[]) : [];
    marketCountries.set(r.handle, ccs.map((c) => c.toUpperCase()));
  }
  const marketCountryRegion = new Map<string, string>();
  for (const handle of MARKET_PRIORITY) {
    if (MARKET_IGNORE.has(handle)) continue;
    const code = MARKET_REGION_CODE[handle];
    if (!code) continue;
    for (const cc of marketCountries.get(handle) ?? []) {
      if (!marketCountryRegion.has(cc)) marketCountryRegion.set(cc, code);
    }
  }
  console.log(`Region classifier: ${marketCountryRegion.size} nước gán từ market_templates (specific>broad).`);

  // ── 2) Bộ bậc cân chuẩn (giống 2 script gốc) ─────────────────────────────
  // FedEx keys: từ seed cici 'middle-east'.
  const [seed] = await db.select({ shipping: schema.marketStoreOverrides.shipping })
    .from(schema.marketStoreOverrides)
    .where(sql`${schema.marketStoreOverrides.storeId} = ${CICI_STORE} AND ${schema.marketStoreOverrides.marketHandle} = 'middle-east'`)
    .limit(1);
  if (!seed?.shipping) throw new Error('Không tìm thấy shipping config cici middle-east (seed FedEx keys).');
  const seedZones = (seed.shipping as MarketShipping).zones;
  const sampleZone = Object.values(seedZones)[0];
  const fedexKeys = Object.keys(sampleZone.rates).filter((k) => /^FedEx IP/.test(k));
  if (fedexKeys.length === 0) throw new Error('Seed cici middle-east không có key FedEx IP.');

  // DHL keys: từ override cici có nhiều key "DHL Express" nhất.
  const ciciOverrides = await db.select().from(schema.marketStoreOverrides)
    .where(eq(schema.marketStoreOverrides.storeId, CICI_STORE));
  let dhlKeys: string[] = [];
  for (const o of ciciOverrides) {
    for (const z of Object.values((o.shipping as MarketShipping | null)?.zones ?? {})) {
      const ks = Object.keys(z.rates).filter((k) => /^DHL Express/.test(k));
      if (ks.length > dhlKeys.length) dhlKeys = ks;
    }
  }
  if (dhlKeys.length === 0) throw new Error('Không tìm thấy bộ key DHL Express nào ở cici.');

  const fedexKeyUpper = new Map<string, number>();
  for (const k of fedexKeys) {
    const b = upperOf(k);
    if (b === null) throw new Error(`Không parse được upper-bound từ FedEx key: ${JSON.stringify(k)}`);
    fedexKeyUpper.set(k, b);
  }
  const dhlKeyUpper = new Map<string, number>();
  for (const k of dhlKeys) {
    const b = upperOf(k);
    if (b === null) throw new Error(`Không parse được upper-bound từ DHL key: ${JSON.stringify(k)}`);
    dhlKeyUpper.set(k, b);
  }
  console.log(`Bộ bậc: FedEx ${fedexKeys.length} bậc, DHL ${dhlKeys.length} bậc.`);

  // Key bậc giữa 1.5–2 kg để in mẫu + sanity check.
  const fedexMidKey = fedexKeys.find((k) => fedexKeyUpper.get(k) === 2);
  const dhlMidKey = dhlKeys.find((k) => dhlKeyUpper.get(k) === 2);

  // ── 3) Snapshots (FedEx + DHL), date = now (giống script gốc) ────────────
  const now = new Date();
  const [fedexSnap, dhlSnap] = await Promise.all([
    loadAccountSnapshot(FEDEX, now),
    loadAccountSnapshot(dhlAccount.id, now),
  ]);
  if (!fedexSnap) throw new Error('Không load được FedEx snapshot.');
  if (!dhlSnap) throw new Error('Không load được DHL snapshot.');

  // Pin fuel về MỐC GIỮA khung 5% → giá manual ổn định trong khung (chỉ sinh lại
  // khi fuel nhảy khung). Engine vẫn dùng fuel LIVE (không qua đây).
  const pinFuel = (snap: NonNullable<typeof fedexSnap>, when: Date) => {
    const eff = snap.surcharges.find((s) => s.kind === 'fuel_percent' && s.active
      && (s.startsAt == null || s.startsAt <= when) && (s.endsAt == null || s.endsAt > when));
    const mid = eff ? fuelBandMidpoint(eff.value) : null;
    if (mid == null) return { snap, mid: null as number | null };
    return { snap: { ...snap, surcharges: snap.surcharges.map((s) => s.kind === 'fuel_percent' ? { ...s, value: mid } : s) }, mid };
  };
  const fedexPin = pinFuel(fedexSnap, now);
  const dhlPin = pinFuel(dhlSnap, now);
  const fedexSnapPinned = fedexPin.snap;
  const dhlSnapPinned = dhlPin.snap;
  console.log(`Fuel pin (mốc-giữa khung): FedEx ${fedexPin.mid}% · DHL ${dhlPin.mid}%`);

  // ── 4) Vũ trụ nước = MỌI key của fedexZoneOf. Gom theo (fz, dz) ──────────
  // Vu tru nuoc = UNION(FedEx zone, DHL zone).
  // Nước TÁCH RIÊNG zone (nhiều phí phát sinh riêng → không gộp chung với nước
  // cùng (fz,dz)). vd US nhiều phí hơn MX/CA dù cùng FedEx Zone D / DHL Zone 7.
  const SOLO_COUNTRIES = new Set(['US']);
  const universe = new Set<string>([...fedexZoneOf.keys(), ...dhlZoneOf.keys()]);
  const groups = new Map<string, { fz: string | null; dz: string | null; ccs: string[] }>();
  for (const cc of universe) {
    const fz = fedexZoneOf.get(cc) ?? null;
    const dz = dhlZoneOf.get(cc) ?? null;
    // SOLO → key kèm mã nước → zone riêng cho nước đó; còn lại gộp theo (fz,dz).
    const k = SOLO_COUNTRIES.has(cc)
      ? `${fz ?? 'none'}||${dz ?? 'none'}||SOLO:${cc}`
      : `${fz ?? 'none'}||${dz ?? 'none'}`;
    const g = groups.get(k) ?? { fz, dz, ccs: [] };
    g.ccs.push(cc);
    groups.set(k, g);
  }
  const countriesNoDhl: string[] = [];   // FedEx-only (dz=null) -> Standard-only
  const countriesNoFedex: string[] = []; // DHL-only   (fz=null) -> Express-only
  const countriesNeither: string[] = []; // rong theo dinh nghia universe
  for (const g of groups.values()) {
    if (g.fz !== null && g.dz === null) countriesNoDhl.push(...g.ccs);
    if (g.fz === null && g.dz !== null) countriesNoFedex.push(...g.ccs);
    if (g.fz === null && g.dz === null) countriesNeither.push(...g.ccs);
  }

  // ── 4b) Đặt tên zone theo MÃ VÙNG (region code) + số thứ tự ──────────────
  // Region của zone = region chiếm ĐA SỐ nước trong zone. Nếu region top < 50%
  // số nước (thực sự lẫn) → RW. Đánh số trong mỗi region theo (fz,dz) label tăng
  // dần → tên = `${region}${seq}` (ME1, EU2, RW3…). Tên PHẢI duy nhất.
  const fzdzLabel = (g: { fz: string | null; dz: string | null }): string =>
    `${g.fz ?? 'no-FedEx'} · ${g.dz ?? 'no-DHL'}`;
  const groupList = [...groups.values()];
  // region top của mỗi group.
  const groupRegion = new Map<typeof groupList[number], string>();
  for (const g of groupList) {
    const counts = new Map<string, number>();
    for (const cc of g.ccs) {
      const r = regionOf(cc, marketCountryRegion);
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    let topRegion = 'RW', topN = 0;
    for (const [r, n] of [...counts.entries()].sort((a, b) =>
      b[1] - a[1] || a[0].localeCompare(b[0]))) {
      if (n > topN) { topN = n; topRegion = r; }
    }
    const region = topN / g.ccs.length >= 0.5 ? topRegion : 'RW';
    groupRegion.set(g, region);
  }
  // Đánh số trong mỗi region theo (fz,dz) label.
  const seqByRegion = new Map<string, number>();
  const zoneNameOf = new Map<typeof groupList[number], string>();
  const byRegion = new Map<string, typeof groupList>();
  for (const g of groupList) {
    const r = groupRegion.get(g)!;
    (byRegion.get(r) ?? byRegion.set(r, []).get(r)!).push(g);
  }
  const seenNames = new Set<string>();
  for (const [region, gs] of [...byRegion.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    gs.sort((a, b) => fzdzLabel(a).localeCompare(fzdzLabel(b))
      // Tiebreak khi cùng (fz,dz) (vd zone SOLO US vs MX/CA): theo danh sách nước
      // → tên duy nhất & xác định.
      || a.ccs.slice().sort().join(',').localeCompare(b.ccs.slice().sort().join(',')));
    for (const g of gs) {
      const seq = (seqByRegion.get(region) ?? 0) + 1;
      seqByRegion.set(region, seq);
      const name = `${region}${seq}`;
      if (seenNames.has(name)) throw new Error(`Tên zone trùng: ${name}`);
      seenNames.add(name);
      zoneNameOf.set(g, name);
    }
  }

  // ── 5) Định giá mỗi zone kết hợp ─────────────────────────────────────────
  const zones: Record<string, ShippingZone> = {};
  for (const g of groups.values()) {
    const zoneName = zoneNameOf.get(g)!;
    const rates: Record<string, ShippingRate> = {};

    // FedEx IP — chỉ khi zone CÓ FedEx zone; quote mọi nước có FedEx zone trong
    // zone qua snapshot FedEx, max-theo-nước.
    if (g.fz !== null) {
      const fedexCcs = g.ccs.filter((cc) => fedexZoneOf.has(cc));
      for (const key of fedexKeys) {
        const b = fedexKeyUpper.get(key)!;
        const cq = fedexCcs.map((cc) => {
          // Bake residential cho US/CA (giống engine: isResidential = US||CA) → giá
          // manual phẳng đã gồm phí giao nhà dân, shop không bị gánh khi khách dùng Standard.
          const q = quote(fedexSnapPinned, { destinationCountry: cc, weightKg: b, effectiveDate: now, isResidential: cc === 'US' || cc === 'CA' });
          return q.ok
            ? { carrierCostDisplay: q.breakdown.carrierCostDisplay, finalDisplay: q.breakdown.finalDisplay }
            : { carrierCostDisplay: 0, finalDisplay: 0 };
        });
        const price = fedexOfferPrice(cq);
        if (price !== null) rates[key] = { type: 'flat', price, currency: 'USD' };
      }
    }

    // DHL Express — chỉ trên các nước trong zone CÓ DHL zone.
    if (g.dz !== null) {
      const dhlCcs = g.ccs.filter((cc) => dhlZoneOf.has(cc));
      for (const key of dhlKeys) {
        const b = dhlKeyUpper.get(key)!;
        const cq = dhlCcs.map((cc) => {
          const q = quote(dhlSnapPinned, { destinationCountry: cc, weightKg: b, effectiveDate: now, isResidential: cc === 'US' || cc === 'CA' });
          return q.ok
            ? { carrierCostDisplay: q.breakdown.carrierCostDisplay, finalDisplay: q.breakdown.finalDisplay }
            : { carrierCostDisplay: 0, finalDisplay: 0 };
        });
        const price = fedexOfferPrice(cq);
        if (price !== null) rates[key] = { type: 'flat', price, currency: 'USD' };
      }
    }

    zones[zoneName] = { countries: g.ccs, rates };
  }

  // cc → zoneName (mã vùng) + group, để tra cứu trong các phần kiểm tra dưới.
  const zoneNameByCc = new Map<string, string>();
  const groupByCc = new Map<string, typeof groupList[number]>();
  for (const g of groupList) {
    const name = zoneNameOf.get(g)!;
    for (const cc of g.ccs) { zoneNameByCc.set(cc, name); groupByCc.set(cc, g); }
  }

  // ── 6) Dry-run output ────────────────────────────────────────────────────
  const totalCountries = universe.size;
  const zoneNames = Object.keys(zones);

  // FULL list các zone: <regionCode> (FedEx <fz> / DHL <dz>) — <N> nước: <5 ISO>
  console.log(`\n--- FULL zone list (${groupList.length} zone) ---`);
  const fullSorted = groupList
    .map((g) => ({ name: zoneNameOf.get(g)!, g }))
    .sort((a, b) => {
      const ra = a.name.replace(/\d+$/, ''), rb = b.name.replace(/\d+$/, '');
      const na = Number(a.name.slice(ra.length)), nb = Number(b.name.slice(rb.length));
      return ra.localeCompare(rb) || na - nb;
    });
  for (const { name, g } of fullSorted) {
    const ccs = g.ccs.slice().sort();
    console.log(
      `  ${name.padEnd(7)} (FedEx ${g.fz ?? '—'} / DHL ${g.dz ?? '—'})  — ${g.ccs.length} nước: ${ccs.slice(0, 5).join(',')}`,
    );
  }
  // Uniqueness + RW report.
  const allNames = groupList.map((g) => zoneNameOf.get(g)!);
  const uniqueNames = new Set(allNames);
  const rwZones = fullSorted.filter(({ name }) => /^RW\d+$/.test(name));
  console.log(`\nUniqueness: ${allNames.length} tên / ${uniqueNames.size} duy nhất → ${allNames.length === uniqueNames.size ? 'OK (tất cả duy nhất)' : 'TRÙNG!'}`);
  console.log(`Zone rơi vào RW (mixed/<50% region top): ${rwZones.length}${rwZones.length ? ` [${rwZones.map((z) => z.name).join(',')}]` : ''}`);
  // Mỗi nước phải thuộc đúng 1 zone.
  const assignedCount = groupList.reduce((s, g) => s + g.ccs.length, 0);
  console.log(`Mỗi nước thuộc đúng 1 zone: ${assignedCount} gán / ${totalCountries} universe → ${assignedCount === totalCountries ? 'OK' : 'LỆCH!'}`);
  console.log(`\n=== KẾT QUẢ ===`);
  console.log(`Tổng nước phủ (UNION FedEx ∪ DHL): ${totalCountries}`);
  console.log(`  (FedEx zone: ${fedexZoneOf.size}, DHL zone: ${dhlZoneOf.size})`);
  console.log(`Tổng zone kết hợp (cặp fz×dz duy nhất): ${zoneNames.length}`);
  console.log(`Nước FedEx-only (không DHL → Standard-only): ${countriesNoDhl.length}${countriesNoDhl.length ? ` [${countriesNoDhl.sort().join(',')}]` : ''}`);
  console.log(`Nước DHL-only (không FedEx → Express-only): ${countriesNoFedex.length}${countriesNoFedex.length ? ` [${countriesNoFedex.sort().join(',')}]` : ''}`);
  console.log(`Nước KHÔNG có FedEx lẫn DHL (phải = 0): ${countriesNeither.length}${countriesNeither.length ? ` [${countriesNeither.sort().join(',')}]` : ''}`);
  // KY/NR sanity: phải xuất hiện trong universe + thuộc 1 zone có DHL Express rate.
  for (const cc of ['KY', 'NR']) {
    const zn = zoneNameByCc.get(cc);
    const z = zn ? zones[zn] : undefined;
    const hasExpress = z ? Object.keys(z.rates).some((k) => /^DHL Express/.test(k)) : false;
    const hasStandard = z ? Object.keys(z.rates).some((k) => /^FedEx IP/.test(k)) : false;
    console.log(`  ${cc}: zone "${zn ?? '—'}" — covered=${!!z} Express=${hasExpress} Standard=${hasStandard}`);
  }

  console.log(`\n--- Mẫu ${Math.min(10, zoneNames.length)} zone đầu (bậc giữa 1.5–2 kg) ---`);
  const sorted = [...Object.entries(zones)].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [name, z] of sorted.slice(0, 10)) {
    const fp = fedexMidKey ? z.rates[fedexMidKey]?.price : undefined;
    const dp = dhlMidKey ? z.rates[dhlMidKey]?.price : undefined;
    console.log(`  ${name} — ${z.countries.length} nước — FedEx IP 1.5–2kg=${fp !== undefined ? '$' + fp.toFixed(2) : '—'}  DHL Express 1.5–2kg=${dp !== undefined ? '$' + dp.toFixed(2) : '—'}`);
  }
  if (zoneNames.length > 10) console.log(`  … và ${zoneNames.length - 10} zone nữa.`);

  // ── SANITY CHECK vs cici ─────────────────────────────────────────────────
  // Xây map cici: country → { zoneName, countries[], fedexMid, dhlMid } từ
  // market_store_overrides. Lưu CẢ country set của zone cici để (a) so giá đã
  // STORE, và (b) RECOMPUTE bằng engine live trên ĐÚNG country set cici → tách
  // "khác do engine/path" với "khác do GỘP zone hoặc do snapshot/ngày trôi".
  console.log(`\n--- SANITY CHECK vs cici (1.5–2 kg) ---`);
  const ciciCountryRates = new Map<string, { zone: string; ccs: string[]; fedex?: number; dhl?: number }>();
  for (const o of ciciOverrides) {
    for (const [zname, z] of Object.entries((o.shipping as MarketShipping | null)?.zones ?? {})) {
      const fk = Object.keys(z.rates).find((k) => /^FedEx IP/.test(k) && upperOf(k) === 2);
      const dk = Object.keys(z.rates).find((k) => /^DHL Express/.test(k) && upperOf(k) === 2);
      const entry = {
        zone: `${o.marketHandle}/${zname}`,
        ccs: z.countries.map((c) => c.toUpperCase()),
        fedex: fk ? z.rates[fk]?.price : undefined,
        dhl: dk ? z.rates[dk]?.price : undefined,
      };
      for (const cc of z.countries) ciciCountryRates.set(cc.toUpperCase(), entry);
    }
  }

  // Helper: tính FedEx/DHL offer 2kg cho 1 country set bằng engine LIVE (now).
  const reFedex = (ccs: string[]): number | null => fedexOfferPrice(ccs.map((cc) => {
    const q = quote(fedexSnap, { destinationCountry: cc, weightKg: 2, effectiveDate: now });
    return q.ok ? { carrierCostDisplay: q.breakdown.carrierCostDisplay, finalDisplay: q.breakdown.finalDisplay } : { carrierCostDisplay: 0, finalDisplay: 0 };
  }));
  const reDhl = (ccs: string[]): number | null => fedexOfferPrice(ccs.filter((cc) => dhlZoneOf.has(cc)).map((cc) => {
    const q = quote(dhlSnap, { destinationCountry: cc, weightKg: 2, effectiveDate: now });
    return q.ok ? { carrierCostDisplay: q.breakdown.carrierCostDisplay, finalDisplay: q.breakdown.finalDisplay } : { carrierCostDisplay: 0, finalDisplay: 0 };
  }));

  // Chọn vài nước cici phủ, map sang zone hệ thống tương ứng (qua country), so sánh.
  const checkCountries = ['AE', 'SA', 'US', 'GB', 'DE', 'AU', 'JP', 'SG', 'CA', 'FR'];
  let storeMatch = 0, storeDiff = 0, engineMatch = 0, engineDiff = 0, checked = 0;
  for (const cc of checkCountries) {
    const ciciE = ciciCountryRates.get(cc);
    if (!ciciE) continue;
    const fz = fedexZoneOf.get(cc);
    if (!fz) continue;
    const dz = dhlZoneOf.get(cc) ?? null;
    const sysZoneName = zoneNameByCc.get(cc);
    const sysZone = sysZoneName ? zones[sysZoneName] : undefined;
    if (!sysZone) continue;
    const sysFedex = fedexMidKey ? sysZone.rates[fedexMidKey]?.price : undefined;
    const sysDhl = dhlMidKey ? sysZone.rates[dhlMidKey]?.price : undefined;
    checked++;

    // (A) So vs giá cici ĐÃ STORE (có thể khác do gộp zone / ngày trôi).
    const fStore = ciciE.fedex === undefined || sysFedex === ciciE.fedex;
    const dStore = ciciE.dhl === undefined || sysDhl === ciciE.dhl;
    if (fStore && dStore) storeMatch++; else storeDiff++;

    // (B) RECOMPUTE cici country set bằng engine LIVE → so vs sys. Nếu country set
    //     trùng nhau thì PHẢI bằng nhau (chứng minh engine+pricing path đồng nhất).
    const reF = reFedex(ciciE.ccs);
    const reD = reDhl(ciciE.ccs);
    const sameSet = ciciE.ccs.slice().sort().join(',') === sysZone.countries.slice().sort().join(',');
    const fEng = reF === (sysFedex ?? null);
    const dEng = (reD ?? null) === (sysDhl ?? null);
    if (sameSet) { if (fEng && dEng) engineMatch++; else engineDiff++; }

    console.log(
      `  ${cc} → sys "${sysZoneName}" (FedEx ${fz} / DHL ${dz ?? '—'}, ${sysZone.countries.length} nước) vs cici ${ciciE.zone} (${ciciE.ccs.length} nước)\n` +
      `      STORE : FedEx sys=${fmt(sysFedex)} ciciStored=${fmt(ciciE.fedex)} [${fStore ? 'MATCH' : 'DIFF'}]  DHL sys=${fmt(sysDhl)} ciciStored=${fmt(ciciE.dhl)} [${dStore ? 'MATCH' : 'DIFF'}]\n` +
      `      ENGINE: recompute cici-set live → FedEx=${fmt(reF ?? undefined)} DHL=${fmt(reD ?? undefined)}  sameCountrySet=${sameSet}${sameSet ? `  [${fEng && dEng ? 'MATCH' : 'DIFF'}]` : ' (set khác → gộp zone, không kỳ vọng bằng store)'}`,
    );
  }
  console.log(`  → checked ${checked}.`);
  console.log(`    vs giá cici ĐÃ STORE: MATCH ${storeMatch}, DIFF ${storeDiff}  (DIFF = do gộp zone toàn-nước và/hoặc snapshot/ngày trôi kể từ lần sinh cici).`);
  console.log(`    engine LIVE recompute trên cùng country set: MATCH ${engineMatch}, DIFF ${engineDiff}  (MATCH chứng minh engine+offer-pricing path ĐỒNG NHẤT với script gốc).`);

  // Coverage delta.
  console.log(`\n--- Coverage ---`);
  console.log(`Universe (FedEx ∪ DHL): ${totalCountries}. FedEx zone: ${fedexZoneOf.size}. DHL zone: ${dhlZoneOf.size}.`);
  const dhlOnly = [...dhlZoneOf.keys()].filter((cc) => !fedexZoneOf.has(cc));
  console.log(`Nước DHL-only (giờ phủ Express-only): ${dhlOnly.length}${dhlOnly.length ? ` [${dhlOnly.sort().join(',')}]` : ''}`);

  // ── 7) Apply ─────────────────────────────────────────────────────────────
  if (apply) {
    await db.transaction(async (tx) => {
      await tx.delete(schema.manualShippingConfig);
      await tx.insert(schema.manualShippingConfig).values({
        marketHandle: 'system',
        shipping: { zones },
        version: 1,
      });
      // Ghi khung fuel đã dùng (mốc-giữa) → banner cảnh báo khi fuel nhảy khung.
      for (const [acctId, mid] of [[FEDEX, fedexPin.mid], [dhlAccount.id, dhlPin.mid]] as const) {
        if (mid == null) continue;
        await tx.insert(schema.manualPricingState)
          .values({ carrierAccountId: acctId, fuelBandMid: String(mid), generatedAt: new Date() })
          .onConflictDoUpdate({ target: schema.manualPricingState.carrierAccountId, set: { fuelBandMid: String(mid), generatedAt: new Date() } });
      }
    });
    console.log(`\n*** ĐÃ GHI: xoá toàn bộ manual_shipping_config + INSERT 1 dòng 'system' (${zoneNames.length} zone). ***`);
  } else {
    console.log(`\nDRY-RUN — chưa ghi. Chạy với --apply để DELETE ALL + INSERT 1 dòng 'system'.`);
  }
  process.exit(0);
}

function fmt(n: number | undefined): string {
  return n === undefined ? '—' : '$' + n.toFixed(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
