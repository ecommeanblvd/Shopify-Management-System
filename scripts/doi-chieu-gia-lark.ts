/**
 * ĐỐI CHIẾU giá hệ thống tính ra với số ĐANG ĐIỀN TAY trên Lark — để kiểm chứng công thức.
 *
 *   railway run npx tsx scripts/doi-chieu-gia-lark.ts            # 7 ngày gần đây
 *   railway run npx tsx scripts/doi-chieu-gia-lark.ts --ngay=30
 *
 * Số trên Lark là số nhân sự đọc từ cổng hãng rồi gõ tay, nên nó là MỐC THẬT để soi công
 * thức. Chỉ so những ô Lark ĐÃ CÓ số — ô trống không nói lên điều gì.
 *
 * KHÔNG ghi gì lên Lark. Đi đúng đường của màn Phân tích (`layGiaUocTinh`), nên có cập nhật
 * dòng `fedex_rate_quotes`; kiện đã có hoá đơn giữ nguyên dòng cũ (mốc đối soát) và bị LOẠI
 * khỏi phép so, vì số của chúng không phải vừa hỏi theo thông số nhãn.
 */
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getLogRecordById } from '@/features/lark/client';
import { xemTruocGhiGia } from '@/features/lark/ghi-nguoc/patch-gia-uoc-tinh';
import { layGiaUocTinh } from '@/features/dong-hang/lay-gia-uoc-tinh';
import { layThongSoVanDon } from '@/lib/fedex/track';

const soNgay = Number(process.argv.find((a) => a.startsWith('--ngay='))?.slice(7) ?? 7);
const tien = (n: number) => n.toLocaleString('vi-VN');

interface ODoi { cot: string; heThong: number; lark: number }

async function main() {
  const ds = await db.select({
    id: schema.shipments.id,
    tracking: schema.shipments.trackingNumber,
    maDon: schema.shopifyOrders.shopifyOrderNumber,
    rid: schema.shipments.larkRecordId,
  }).from(schema.shipments)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .where(and(
      eq(schema.shipments.carrierKey, 'fedex'),
      isNotNull(schema.shipments.trackingNumber),
      isNotNull(schema.shipments.larkRecordId),
      gte(sql`coalesce(${schema.shipments.labelCreatedAt}, ${schema.shipments.createdAt})`,
        sql`now() - (${soNgay} || ' days')::interval`),
    ))
    .orderBy(desc(schema.shipments.createdAt));

  console.log(`Đối chiếu ${ds.length} kiện FedEx ${soNgay} ngày gần đây.\n`);

  const theoO = new Map<string, { khop: number; lech: number }>();
  let soSoSanh = 0, soKhopHet = 0, soLechO = 0, khongTra = 0, khongGia = 0, khongOnao = 0;
  const lechTong: Array<{ ma: string; ht: number; lark: number }> = [];

  for (const k of ds) {
    const nhan = `${k.tracking} ${k.maDon ?? ''}`.trim();
    const ts = await layThongSoVanDon(k.tracking as string);
    const gia = await layGiaUocTinh(k.id, k.tracking);
    if (!gia) { console.log(`✗ ${nhan} — không lấy được giá`); khongGia++; continue; }
    if (!ts) khongTra++;

    const rec = await getLogRecordById(k.rid as string);
    if (!rec) { console.log(`✗ ${nhan} — không đọc được dòng Lark`); continue; }

    const xem = xemTruocGhiGia(gia, rec.fields as Record<string, unknown>, k.tracking);
    const soDoi: ODoi[] = [];
    for (const d of xem.dong) {
      if (d.trangThai !== 'da-co-so' || d.soLarkDangCo == null || d.soNguon == null) continue;
      soDoi.push({ cot: d.cot, heThong: d.soNguon, lark: d.soLarkDangCo });
    }
    if (soDoi.length === 0) { khongOnao++; continue; }

    soSoSanh++;
    const lech = soDoi.filter((o) => o.heThong !== o.lark);
    for (const o of soDoi) {
      const m = theoO.get(o.cot) ?? { khop: 0, lech: 0 };
      if (o.heThong === o.lark) m.khop++; else m.lech++;
      theoO.set(o.cot, m);
    }
    const oTong = soDoi.find((o) => o.cot.includes('Chi phí Tổng'));
    if (oTong && oTong.heThong !== oTong.lark) lechTong.push({ ma: nhan, ht: oTong.heThong, lark: oTong.lark });

    if (lech.length === 0) {
      soKhopHet++;
      console.log(`✓ ${nhan} — khớp cả ${soDoi.length} ô${ts ? '' : '  (hãng chưa có dữ liệu tra cứu)'}`);
    } else {
      soLechO += lech.length;
      console.log(`✗ ${nhan} — lệch ${lech.length}/${soDoi.length} ô${ts ? '' : '  (hãng chưa có dữ liệu tra cứu)'}`);
      for (const o of lech) {
        console.log(`     ${o.cot.padEnd(26)} hệ thống ${tien(o.heThong).padStart(11)} | Lark ${tien(o.lark).padStart(11)} | lệch ${tien(o.heThong - o.lark)}`);
      }
    }
  }

  console.log(`\n${'='.repeat(70)}\nTỔNG KẾT`);
  console.log(`  kiện có ô để so        : ${soSoSanh}`);
  console.log(`  khớp HẾT mọi ô         : ${soKhopHet}`);
  console.log(`  có ít nhất một ô lệch  : ${soSoSanh - soKhopHet}  (tổng ${soLechO} ô lệch)`);
  if (khongOnao > 0) console.log(`  Lark chưa điền ô nào   : ${khongOnao} (không so được)`);
  if (khongGia > 0) console.log(`  không lấy được giá     : ${khongGia}`);
  if (khongTra > 0) console.log(`  hãng chưa có dữ liệu tra cứu: ${khongTra}`);

  console.log('\nTheo từng ô:');
  for (const [cot, m] of [...theoO.entries()].sort((a, b) => (b[1].khop + b[1].lech) - (a[1].khop + a[1].lech))) {
    console.log(`  ${cot.padEnd(26)} khớp ${String(m.khop).padStart(3)}/${String(m.khop + m.lech).padStart(3)}`);
  }
  if (lechTong.length > 0) {
    console.log('\nÔ TỔNG lệch (ô quan trọng nhất):');
    for (const x of lechTong) console.log(`  ${x.ma.padEnd(32)} hệ thống ${tien(x.ht).padStart(11)} | Lark ${tien(x.lark).padStart(11)} | lệch ${tien(x.ht - x.lark)}`);
  }
  process.exit(0);
}
main();
