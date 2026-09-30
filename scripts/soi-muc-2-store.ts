/**
 * So GIÁ THẬT hai store trả ra ở checkout: gọi đúng callback carrier-service của từng store.
 * Không suy từ mã — engine dùng chung tài khoản carrier, nhưng chỉ phép gọi thật mới chứng minh
 * được hai store nhận cùng một kết quả (sự cố 01/10 cho thấy cấu hình phía Shopify đủ sức làm
 * engine câm lặng mà nhìn từ mã không thấy).
 */
import { db } from '@/db/client';
import { sql } from 'drizzle-orm';

const NUOC: Array<[string, string, string]> = [
  ['US', '10001', 'New York'], ['SA', '23531', 'Jeddah'], ['JP', '100-0001', 'Tokyo'],
  ['AU', '2000', 'Sydney'], ['DE', '10115', 'Berlin'], ['GB', 'SW1A1AA', 'London'],
  ['SG', '018956', 'Singapore'], ['IN', '110001', 'Delhi'], ['CN', '100000', 'Beijing'],
  ['CA', 'M5H2N2', 'Toronto'], ['AE', '00000', 'Dubai'], ['VN', '100000', 'Hanoi'],
];
const CAN = [0.5, 1, 2, 5];
const URL = 'https://shopify-management-system-production.up.railway.app/api/shopify/carrier-service';

async function hoi(storeId: string, nuoc: string, zip: string, tp: string, kg: number) {
  const res = await fetch(`${URL}/${storeId}`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rate: { origin: { country: 'VN' },
      destination: { country: nuoc, postal_code: zip, city: tp },
      items: [{ grams: Math.round(kg * 1000), quantity: 1 }] } }) });
  const j = await res.json() as { rates?: Array<Record<string, string>> };
  return (j.rates ?? []).map((r) => `${r.service_code}=${Number(r.total_price) / 100}${r.currency}`).sort().join(' | ') || '(RỖNG)';
}

async function main() {
  const r = await db.execute<Record<string, unknown>>(sql`SELECT name, id FROM stores WHERE name IN ('meanblvd','tinhatelier');`);
  const id = new Map(r.rows.map((x) => [x.name as string, x.id as string]));
  const bang: Array<Record<string, unknown>> = [];
  let khop = 0, lech = 0, rong = 0;
  for (const [n, zip, tp] of NUOC) {
    const hang: Record<string, unknown> = { nuoc: n };
    for (const kg of CAN) {
      const [a, b] = await Promise.all([hoi(id.get('meanblvd')!, n, zip, tp, kg), hoi(id.get('tinhatelier')!, n, zip, tp, kg)]);
      if (a === '(RỖNG)' || b === '(RỖNG)') { rong++; hang[`${kg}kg`] = a === b ? 'cả hai RỖNG' : `!! ${a === '(RỖNG)' ? 'meanblvd' : 'tinh'} RỖNG`; }
      else if (a === b) { khop++; hang[`${kg}kg`] = '='; }
      else { lech++; hang[`${kg}kg`] = `LỆCH\n  mean: ${a}\n  tinh: ${b}`; }
    }
    bang.push(hang);
  }
  console.table(bang);
  console.log(`Khớp: ${khop} · lệch: ${lech} · có bên rỗng: ${rong}  (trên ${NUOC.length * CAN.length} phép so)`);
  // In giá mẫu để anh thấy con số thật
  console.log('\nGiá mẫu (meanblvd, 1kg):');
  for (const [n, zip, tp] of NUOC.slice(0, 6)) console.log(`   ${n}: ${await hoi(id.get('meanblvd')!, n, zip, tp, 1)}`);
  process.exit(0);
}
main();
