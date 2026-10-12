/**
 * Đặt lại TOÀN BỘ các dòng Surge Emergency Fee (`demand_per_kg`) của UPS theo số UPS tự trả
 * về qua Rating API — thay cho bản em suy từ một hoá đơn hôm 12/10/2026.
 *
 * VÌ SAO PHẢI SỬA: bản trước lấy mức từ hoá đơn kỳ 03–30/09, mỗi nhóm ngoài Mỹ chỉ dựa 1–2
 * lô, và để KHÔNG CÓ ngày kết thúc. Gọi Rating API (CEO bật 12/10/2026) với
 * `NegotiatedRatesIndicator=Y` cho 31 nước thì thấy hai nhóm đã TĂNG mà bản cũ không biết:
 *
 *      nhóm            hoá đơn tháng 9      UPS trả về hôm nay
 *      châu Âu+ISMEA        7.050 đ/kg          28.200 đ/kg    ← thiếu 21.150 đ/kg
 *      Canada              11.750 đ/kg          39.950 đ/kg    ← thiếu 28.200 đ/kg
 *      Mỹ                  11.750 → 39.950      39.950 đ/kg    (bản cũ đã đúng)
 *      châu Á–TBD           2.350 đ/kg           2.350 đ/kg    (không đổi)
 *
 * Tức bảng so cước đang báo đi châu Âu rẻ hơn thực ~64.000đ/lô 2kg (21.150×2 + fuel 52,5%).
 * Lỗi của bản suy diễn, không phải của hoá đơn: tháng 9 châu Âu THẬT là 7.050, nó tăng sau.
 *
 * BA NHÓM, do UPS tự phân — đo trên 31 nước, không nước nào lệch nhóm:
 *   39.950 đ/kg  US · CA · MX · BR · AR · CL · PA          → châu Mỹ
 *   28.200 đ/kg  GB · DE · FR · PT · PL · CH · NO · TR · IL · AE · SA · EG · NG · ZA
 *                                                           → châu Âu + ISMEA
 *    2.350 đ/kg  AU · NZ · JP · KR · SG · TH · MY · PH · TW · HK · CN · IN
 *                                                           → "Rest of Asia" + Úc/NZ/Ấn
 * Danh sách nước đầy đủ lấy theo chính bảng vùng UPS in ở cuối tài liệu surge.
 *
 * MỐC 27/09/2026: ngày UPS công bố mức mới. Với Mỹ thì CHỨNG MINH ĐƯỢC — hoá đơn đổi mức
 * đúng từ lô đi 28/09 (29 lô mức cũ, 8 lô mức mới, không lô nào lẫn). Với châu Âu và Canada
 * thì SUY: chỉ biết tháng 9 là mức cũ và hôm nay là mức mới, lấy cùng mốc với Mỹ. Sai mốc này
 * chỉ ảnh hưởng việc báo giá lại đơn CŨ, không ảnh hưởng đơn đang đóng.
 *
 * Hàng rào: chỉ xoá đúng những dòng `demand_per_kg` của tài khoản UPS (do script
 * `sua-phu-phi-ups.ts` tạo 12/10/2026, không có gì khác trỏ vào). Mặc định chạy thử.
 *
 *   npx dotenv -- npx tsx scripts/sua-surge-ups.ts
 *   npx dotenv -- npx tsx scripts/sua-surge-ups.ts --apply
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

const UPS_ACCOUNT = '46fa242a-d9e6-4bbc-a0ae-2549b84c9ade';

/** Châu Mỹ: Mỹ · Canada · Mexico + danh sách "Latin America" của UPS. */
const CHAU_MY = [
  'US', 'CA', 'MX',
  'AG', 'AI', 'AR', 'AW', 'BB', 'BL', 'BM', 'BO', 'BQ', 'BR', 'BS', 'BZ', 'CL', 'CO', 'CR',
  'CU', 'CW', 'DM', 'DO', 'EC', 'GD', 'GF', 'GP', 'GT', 'GY', 'HN', 'HT', 'JM', 'KN', 'KY',
  'LC', 'MQ', 'MS', 'NI', 'PA', 'PE', 'PY', 'SR', 'SV', 'SX', 'TC', 'TT', 'UY', 'VC', 'VG', 'VI',
];
/** Danh sách "Europe" + "ISMEA" của UPS (Trung Đông nằm trong ISMEA). */
const CHAU_AU_ISMEA = [
  'AD', 'AL', 'AM', 'AT', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES',
  'FI', 'FR', 'GB', 'GE', 'GG', 'GI', 'GR', 'HR', 'HU', 'IE', 'IL', 'IS', 'IT', 'JE', 'LT',
  'LU', 'LV', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS', 'RU', 'SE', 'SI',
  'SK', 'SM', 'TR', 'UA', 'XK',
  'AF', 'AO', 'AZ', 'BD', 'BF', 'BH', 'BI', 'BJ', 'BW', 'CD', 'CG', 'CI', 'CM', 'CV', 'DJ',
  'DZ', 'EG', 'ER', 'ET', 'GA', 'GH', 'GM', 'GN', 'GQ', 'GW', 'IQ', 'JO', 'KE', 'KG', 'KM',
  'KW', 'KZ', 'LB', 'LK', 'LR', 'LS', 'LY', 'MA', 'MG', 'ML', 'MR', 'MU', 'MV', 'MW', 'MZ',
  'NA', 'NE', 'NG', 'NP', 'OM', 'PK', 'QA', 'RE', 'RW', 'SA', 'SC', 'SL', 'SN', 'ST', 'SZ',
  'TD', 'TG', 'TJ', 'TM', 'TN', 'TZ', 'UG', 'UZ', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
];
/** Danh sách "Rest of Asia" của UPS + Úc · New Zealand · Ấn Độ + Trung Quốc/Hồng Kông
 *  (hai nước này UPS tách riêng ở chiều ĐI Mỹ, nhưng chiều từ VN thì Rating API trả
 *  cùng mức 2.350đ/kg — đo hôm 12/10/2026). */
const CHAU_A_TBD = [
  'AS', 'AU', 'BN', 'BT', 'CN', 'FJ', 'GU', 'HK', 'ID', 'IN', 'JP', 'KH', 'KR', 'LA', 'MM',
  'MN', 'MO', 'MP', 'MY', 'NC', 'NZ', 'PF', 'PH', 'SG', 'TH', 'TW', 'VN', 'WS',
];

const MOC = new Date('2026-09-27T00:00:00Z');
const HD = 'hoá đơn 100000813108';
const API = 'Rating API 12/10/2026';

interface Dong { value: number; countryCodes: string[]; ten: string; startsAt: Date | null; endsAt: Date | null; note: string }
const BANG: Dong[] = [
  { ten: 'châu Mỹ (cũ)', value: 11750, countryCodes: CHAU_MY, startsAt: null, endsAt: MOC,
    note: `UPS Surge Emergency Fee châu Mỹ 11.750đ/kg, lô đi TRƯỚC 27/09/2026 — ${HD}: Mỹ 29/29 lô khớp, Canada 1 lô; các nước Latin America suy theo nhóm` },
  { ten: 'châu Mỹ (nay)', value: 39950, countryCodes: CHAU_MY, startsAt: MOC, endsAt: null,
    note: `UPS Surge Emergency Fee châu Mỹ 39.950đ/kg từ 27/09/2026 — ${HD}: 8/8 lô Mỹ khớp; ${API}: US·CA·MX·BR·AR·CL·PA đều ra mức này` },
  { ten: 'châu Âu+ISMEA (cũ)', value: 7050, countryCodes: CHAU_AU_ISMEA, startsAt: null, endsAt: MOC,
    note: `UPS Surge Emergency Fee châu Âu+ISMEA 7.050đ/kg, lô đi TRƯỚC 27/09/2026 — ${HD}: MỘT lô (PT 09/09). Mốc 27/09 SUY theo tuyến Mỹ, chưa có bằng chứng riêng cho nhóm này` },
  { ten: 'châu Âu+ISMEA (nay)', value: 28200, countryCodes: CHAU_AU_ISMEA, startsAt: MOC, endsAt: null,
    note: `UPS Surge Emergency Fee châu Âu+ISMEA 28.200đ/kg từ 27/09/2026 — ${API}: GB·DE·FR·PT·PL·CH·NO·TR·IL·AE·SA·EG·NG·ZA đều ra mức này` },
  { ten: 'châu Á–TBD', value: 2350, countryCodes: CHAU_A_TBD, startsAt: null, endsAt: null,
    note: `UPS Surge Emergency Fee châu Á–TBD 2.350đ/kg — ${HD}: AU 09/09 và TH 29/09 (hai bên mốc 27/09 đều cùng mức → nhóm này KHÔNG tăng); ${API}: AU·NZ·JP·KR·SG·TH·MY·PH·TW·HK·CN·IN đều ra mức này` },
];

const apply = process.argv.includes('--apply');
const vnd = (n: number) => n.toLocaleString('vi-VN');

async function main() {
  console.log(apply ? '>>> GHI THẬT (--apply)\n' : '>>> CHẠY THỬ — chưa ghi gì. Thêm --apply để ghi.\n');
  const dieuKien = and(
    eq(schema.carrierSurcharges.carrierAccountId, UPS_ACCOUNT),
    eq(schema.carrierSurcharges.kind, 'demand_per_kg'),
  );
  const cu = await db.select().from(schema.carrierSurcharges).where(dieuKien);
  console.log(`Đang có ${cu.length} dòng surge:`);
  for (const r of cu) {
    const nuoc = Array.isArray(r.countryCodes) ? (r.countryCodes as string[]) : [];
    console.log(`  − ${vnd(Number(r.value)).padStart(7)}đ/kg · ${String(nuoc.length).padStart(3)} nước`
      + ` · ${r.startsAt?.toISOString().slice(0, 10) ?? '—'} → ${r.endsAt?.toISOString().slice(0, 10) ?? '—'}`);
  }
  console.log(`\nThay bằng ${BANG.length} dòng:`);
  for (const d of BANG) {
    console.log(`  + ${vnd(d.value).padStart(7)}đ/kg · ${String(d.countryCodes.length).padStart(3)} nước`
      + ` · ${d.startsAt?.toISOString().slice(0, 10) ?? '—'} → ${d.endsAt?.toISOString().slice(0, 10) ?? '—'} · ${d.ten}`);
  }
  // Không nước nào được nằm ở hai nhóm — chồng nhóm là lặng lẽ cộng dồn hai mức.
  const trung = new Map<string, string[]>();
  for (const d of BANG) for (const c of d.countryCodes) {
    const k = `${c}|${d.startsAt?.toISOString() ?? '-'}|${d.endsAt?.toISOString() ?? '-'}`;
    trung.set(k, [...(trung.get(k) ?? []), d.ten]);
  }
  const loi = [...trung.entries()].filter(([, v]) => v.length > 1);
  if (loi.length > 0) {
    console.log(`\nDỪNG: ${loi.length} nước nằm ở nhiều nhóm cùng cửa sổ — engine sẽ CỘNG DỒN hai mức.`);
    for (const [k, v] of loi.slice(0, 10)) console.log(`  ${k} ← ${v.join(' + ')}`);
    process.exit(1);
  }
  if (apply) {
    await db.delete(schema.carrierSurcharges).where(dieuKien);
    for (const d of BANG) {
      await db.insert(schema.carrierSurcharges).values({
        carrierAccountId: UPS_ACCOUNT, kind: 'demand_per_kg', value: String(d.value),
        countryCodes: d.countryCodes, startsAt: d.startsAt, endsAt: d.endsAt,
        applyMode: 'always', active: true, note: d.note,
      });
    }
  }
  console.log(apply ? '\nXong — đã ghi.' : '\nXong — chưa ghi gì.');
  process.exit(0);
}
void main();
