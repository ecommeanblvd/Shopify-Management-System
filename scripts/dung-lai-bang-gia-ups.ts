/**
 * DỰNG LẠI bảng giá UPS từ kết quả đo của `do-bang-gia-ups.ts`.
 *
 * Nền: hợp đồng chiết khấu theo HAI trục — 10 cột Zone và 5 cột LANE (HK·SG·TW·AU·NZ) đè lên
 * zone — cộng thêm MRPP (giá sàn mỗi kiện). Bảng giá nhập trước chỉ lấy cột Zone và không có
 * sàn, nên sai ở ba chỗ:
 *   · 5 lane ăn nhầm chiết khấu của zone        → −48,0% (AU·NZ) tới +82,6% (HK)
 *   · sàn MRPP không có                          → bậc 1kg Zone 3 và Zone 4 thấp 18–19%
 *   · FR không nằm trong zone nào                → không báo giá được tuyến Pháp
 *
 * Script này KHÔNG suy từ % chiết khấu. Nó ghi đúng con số UPS trả về, và chỉ ghi ô NÀO LỆCH.
 *
 * Nước KHÔNG đo được (mình chưa từng gửi tới) giữ nguyên zone hiện tại — không có bằng chứng
 * thì không đụng. Script in ra danh sách đó để người đọc biết chỗ nào còn là giả định.
 *
 *   npx dotenv -- npx tsx scripts/dung-lai-bang-gia-ups.ts --do <ketqua.json>
 *   npx dotenv -- npx tsx scripts/dung-lai-bang-gia-ups.ts --do <ketqua.json> --apply
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const UPS = '46fa242a-d9e6-4bbc-a0ae-2549b84c9ade';
/** Nhãn zone cho nhóm phải tách ra. Đặt theo TÊN NƯỚC, không đánh số tiếp: `push/recalc.ts`
 *  cắt tiền tố "Zone " khi hiện cho brand, đánh số tiếp sẽ thành "11" — đọc như một zone
 *  chính thức của UPS mà không phải. */
const nhanZoneMoi = (nuoc: string[]): string => `Zone ${nuoc.join('-')}`;

interface KetQuaDo {
  nhom: Array<{ nuoc: string[]; thang: Record<string, number | null> }>;
  khongDo: string[];
}

/** Lệch dưới mức này coi là làm tròn, không ghi lại. */
const NGUONG_LECH = 0.005;

const apply = process.argv.includes('--apply');
const vnd = (v: number) => Math.round(v).toLocaleString('vi-VN');

async function main() {
  const duongDan = process.argv[process.argv.indexOf('--do') + 1];
  if (!duongDan || duongDan.startsWith('--')) throw new Error('thiếu --do <ketqua.json>');
  const kq: KetQuaDo = JSON.parse(readFileSync(duongDan, 'utf8'));
  console.log(apply ? '>>> GHI THẬT (--apply)\n' : '>>> CHẠY THỬ — chưa ghi gì. Thêm --apply để ghi.\n');

  const [the] = await db.select({ id: schema.carrierRateCards.id })
    .from(schema.carrierRateCards).where(eq(schema.carrierRateCards.carrierAccountId, UPS)).limit(1);
  if (!the) throw new Error('tài khoản UPS chưa có bảng giá nào');

  const zones = await db.select().from(schema.carrierZones).where(eq(schema.carrierZones.carrierAccountId, UPS));
  const tiers = await db.select().from(schema.carrierWeightTiers).where(eq(schema.carrierWeightTiers.carrierAccountId, UPS));
  const nuocZone = await db.select().from(schema.carrierZoneCountries).where(eq(schema.carrierZoneCountries.carrierAccountId, UPS));
  const cells = await db.select().from(schema.carrierRateCells).where(eq(schema.carrierRateCells.rateCardId, the.id));

  const zoneTheoId = new Map(zones.map((z) => [z.id, z]));
  const zoneTheoNhan = new Map(zones.map((z) => [z.label, z]));
  const zoneCuaNuoc = new Map(nuocZone.map((r) => [r.countryCode, zoneTheoId.get(r.carrierZoneId)!]));
  const tierTheoKg = new Map(tiers.map((t) => [Number(t.upperKg), t]));
  const oHienCo = new Map(cells.map((c) => [`${c.carrierZoneId}|${c.carrierWeightTierId}`, c]));
  const soNuocDo = new Map<string, number>();
  for (const g of kq.nhom) for (const c of g.nuoc) soNuocDo.set(zoneCuaNuoc.get(c)?.label ?? '?', (soNuocDo.get(zoneCuaNuoc.get(c)?.label ?? '?') ?? 0) + 1);

  interface Viec { zoneNhan: string; taoZone: boolean; chuyen: string[]; oDoi: Array<{ kg: number; cu: number | null; moi: number }> }
  const viec: Viec[] = [];

  /* Mỗi zone do NHÓM ĐÔNG NHẤT trong zone đó giữ; nhóm khác có nước trong cùng zone thì tách
   * ra zone riêng. Hoà phiếu thì nhóm nào KHỚP SẴN ô giá của zone được giữ — đổi ít nhất là
   * đổi an toàn nhất.
   *
   * Bản đầu của luật này ra kết quả sai hẳn: Zone 6 đang khớp 0,0% mà vẫn bị đòi tách thành
   * zone mới 16 nước, chỉ vì FR chưa có zone nên "các nước của nhóm không ở chung một zone".
   * Nước CHƯA CÓ ZONE không được phép phủ quyết chuyện giữ zone — nó chỉ việc nhập vào. */
  const lechVoiZone = (g: { thang: Record<string, number | null> }, zoneId: string): number => {
    let tong = 0;
    for (const [kgStr, tien] of Object.entries(g.thang)) {
      if (tien == null) continue;
      const t = tierTheoKg.get(Number(kgStr));
      const cu = t ? oHienCo.get(`${zoneId}|${t.id}`) : undefined;
      if (cu) tong += Math.abs(Number(cu.costAmount) - tien);
    }
    return tong;
  };

  // zone → các nhóm có nước trong zone đó, kèm số nước.
  const theoZone = new Map<string, Array<{ g: KetQuaDo['nhom'][number]; dem: number }>>();
  for (const g of kq.nhom) {
    const dem = new Map<string, number>();
    for (const c of g.nuoc) {
      const z = zoneCuaNuoc.get(c);
      if (z) dem.set(z.id, (dem.get(z.id) ?? 0) + 1);
    }
    for (const [zid, d] of dem) theoZone.set(zid, [...(theoZone.get(zid) ?? []), { g, dem: d }]);
  }
  const zoneChuCua = new Map<KetQuaDo['nhom'][number], string>();
  for (const [zid, ds] of theoZone) {
    const chu = ds.slice().sort((a, b) => b.dem - a.dem || lechVoiZone(a.g, zid) - lechVoiZone(b.g, zid))[0];
    zoneChuCua.set(chu.g, zid);
  }

  for (const g of kq.nhom) {
    const zidGiu = zoneChuCua.get(g) ?? null;
    const nhan = zidGiu ? zoneTheoId.get(zidGiu)!.label : nhanZoneMoi(g.nuoc);
    const zoneDich = zoneTheoNhan.get(nhan) ?? null;

    const oDoi: Array<{ kg: number; cu: number | null; moi: number }> = [];
    for (const [kgStr, tien] of Object.entries(g.thang)) {
      if (tien == null) continue;
      const kg = Number(kgStr);
      const t = tierTheoKg.get(kg);
      if (!t) continue;
      const cu = zoneDich ? oHienCo.get(`${zoneDich.id}|${t.id}`) : undefined;
      const soCu = cu ? Number(cu.costAmount) : null;
      /* Chỉ ghi ô LỆCH ĐÁNG KỂ. Các zone đang đúng lệch vài chục đồng (552.277 vs 552.250 =
       * 0,005%) — đó là làm tròn giữa nguồn dựng bảng và con số UPS trả hôm nay, không phải
       * sai giá. Ghi lại cả 160 ô như thế thì bản diff đầy nhiễu, và cái sai thật (1kg Zone 3
       * lệch 18%) chìm nghỉm giữa chúng. */
      if (soCu == null || Math.abs(soCu - tien) / tien >= NGUONG_LECH) oDoi.push({ kg, cu: soCu, moi: tien });
    }
    const chuyen = g.nuoc.filter((c) => zoneCuaNuoc.get(c)?.label !== nhan);
    if (oDoi.length === 0 && chuyen.length === 0) continue;
    viec.push({ zoneNhan: nhan, taoZone: !zoneDich, chuyen, oDoi });
  }

  // In kế hoạch
  for (const v of viec) {
    console.log(`▸ ${v.zoneNhan}${v.taoZone ? '  (TẠO MỚI)' : ''}`);
    if (v.chuyen.length) {
      console.log(`    chuyển nước: ${v.chuyen.map((c) => `${c} (từ ${zoneCuaNuoc.get(c)?.label ?? 'chưa có zone'})`).join(' · ')}`);
    }
    if (v.oDoi.length) {
      const g = v.oDoi.slice().sort((a, b) => a.kg - b.kg);
      console.log(`    sửa ${v.oDoi.length}/20 ô giá:`);
      for (const x of g) {
        const p = x.cu ? ((x.cu - x.moi) / x.moi * 100).toFixed(1) + '%' : 'ô mới';
        console.log(`      ${String(x.kg).padStart(2)}kg  ${(x.cu == null ? '—' : vnd(x.cu)).padStart(12)} → ${vnd(x.moi).padStart(12)}   (${p})`);
      }
    }
  }

  // Nước ở lại zone bị tách mà KHÔNG đo được — nói ra, vì thang của chúng là giả định.
  const zoneBiDung = new Set(viec.map((v) => v.zoneNhan));
  const daDo = new Set(kq.nhom.flatMap((g) => g.nuoc));
  console.log('\n— Nước Ở LẠI zone cũ mà mình CHƯA đo (giữ nguyên, thang là giả định):');
  for (const z of zones) {
    const oLai = nuocZone.filter((r) => r.carrierZoneId === z.id && !daDo.has(r.countryCode)).map((r) => r.countryCode);
    const coDo = nuocZone.some((r) => r.carrierZoneId === z.id && daDo.has(r.countryCode));
    if (oLai.length && coDo) console.log(`   ${z.label.padEnd(10)} ${oLai.length} nước: ${oLai.sort().join(' ')}`);
    void zoneBiDung;
  }

  const soZoneMoi = viec.filter((v) => v.taoZone).length;
  const soChuyen = viec.reduce((a, v) => a + v.chuyen.length, 0);
  const soO = viec.reduce((a, v) => a + v.oDoi.length, 0);
  console.log(`\nTỔNG: tạo ${soZoneMoi} zone · chuyển ${soChuyen} nước · ghi ${soO} ô giá`
    + ` (ngưỡng lệch ${(NGUONG_LECH * 100).toFixed(1)}%)`);

  if (!apply) { console.log('\nXong — chưa ghi gì.'); process.exit(0); }

  /* Chụp trạng thái CŨ trước khi ghi. Chuyển nước giữa zone thì lùi lại được, nhưng chỉ khi
   * còn biết nước nào vốn ở đâu — và sau lượt ghi thì không còn ai biết. */
  const anh = `${duongDan.replace(/\.json$/, '')}-truoc-khi-ghi.json`;
  writeFileSync(anh, JSON.stringify({
    luc: new Date().toISOString(),
    zone: zones.map((z) => ({ id: z.id, label: z.label, position: z.position })),
    nuoc: nuocZone.map((r) => ({ nuoc: r.countryCode, zone: zoneTheoId.get(r.carrierZoneId)?.label ?? null })),
    o: cells.map((c) => ({
      zone: zoneTheoId.get(c.carrierZoneId)?.label ?? null,
      kg: Number(tiers.find((t) => t.id === c.carrierWeightTierId)?.upperKg ?? 0),
      tien: Number(c.costAmount),
    })),
  }, null, 1));
  console.log(`Đã chụp trạng thái cũ: ${anh}`);

  await db.transaction(async (tx) => {
    let maxPos = Math.max(...zones.map((z) => z.position), 0);
    for (const v of viec) {
      let z = zoneTheoNhan.get(v.zoneNhan) ?? null;
      if (!z) {
        maxPos += 1;
        const [moi] = await tx.insert(schema.carrierZones)
          .values({ carrierAccountId: UPS, label: v.zoneNhan, position: maxPos }).returning();
        z = moi; zoneTheoNhan.set(v.zoneNhan, moi);
      }
      for (const c of v.chuyen) {
        await tx.insert(schema.carrierZoneCountries)
          .values({ carrierAccountId: UPS, carrierZoneId: z.id, countryCode: c })
          .onConflictDoUpdate({
            target: [schema.carrierZoneCountries.carrierAccountId, schema.carrierZoneCountries.countryCode],
            set: { carrierZoneId: z.id, updatedAt: new Date() },
          });
      }
      for (const x of v.oDoi) {
        const t = tierTheoKg.get(x.kg)!;
        await tx.insert(schema.carrierRateCells)
          .values({
            rateCardId: the.id, carrierZoneId: z.id, carrierWeightTierId: t.id,
            packageType: 'package', costAmount: String(Math.round(x.moi)),
          })
          .onConflictDoUpdate({
            target: [schema.carrierRateCells.rateCardId, schema.carrierRateCells.carrierZoneId,
              schema.carrierRateCells.carrierWeightTierId, schema.carrierRateCells.packageType],
            set: { costAmount: String(Math.round(x.moi)), updatedAt: new Date() },
          });
      }
    }
  });
  console.log('\nXong — đã ghi.');
  process.exit(0);
}
void main();
