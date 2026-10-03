/**
 * Bù lý do + ảnh lỗi QC lên bảng Lark cho các chiếc đã trượt QC TRƯỚC khi hệ thống biết đẩy
 * (CEO cho phép 03/10/2026).
 *
 * Gọi ĐÚNG hàm vận hành `danhDauQcKhongDatTrenLark` — script không dựng bản thứ hai của luật,
 * nên không thể lệch với đường chạy thật. Hàm ấy nối-không-ghi-đè, nên chạy lại vô hại: lượt
 * sau không còn gì để nối thì không gửi cột nào ngoài `QC Check`.
 *
 * Chỉ chiếc `qc_result = 'fail'` CÓ dòng Lark. In trước/sau từng dòng: ghi vào bảng vận hành
 * của đội logistics thì phải để lại dấu vết đọc được bằng mắt.
 */
import { db, schema } from '@/db/client';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getWhInventoryRecord } from '@/features/lark/client';
import { danhDauQcKhongDatTrenLark } from '@/features/kho-nhan/day-wh-lark';

const COT = ['QC Check', 'WH - Action', 'Lý do QC failed', 'Ảnh chụp lỗi QC fail'] as const;

const goN = (v: unknown): string => {
  if (Array.isArray(v)) return `${v.length} tấm`;
  if (typeof v === 'string') return JSON.stringify(v);
  return '(trống)';
};

async function main() {
  const ds = await db.select({
    id: schema.goodsReceiptItems.id, rec: schema.goodsReceiptItems.larkRecordId,
    dinhDanh: schema.goodsReceiptItems.unitCode,
  }).from(schema.goodsReceiptItems).where(and(
    eq(schema.goodsReceiptItems.qcResult, 'fail'),
    isNotNull(schema.goodsReceiptItems.larkRecordId),
  ));
  console.log('Chiếc cần bù:', ds.length);

  for (const c of ds) {
    const truoc = (await getWhInventoryRecord(c.rec!))?.fields;
    if (!truoc) { console.log(`\n── ${c.rec} — KHÔNG CÒN TRÊN LARK, bỏ qua`); continue; }
    await danhDauQcKhongDatTrenLark(c.id, 'bu-loi-qc-lark');
    const sau = (await getWhInventoryRecord(c.rec!))?.fields;
    console.log(`\n── ${c.rec}  ${c.dinhDanh ?? ''}`);
    for (const k of COT) {
      const a = goN(truoc[k]), b = goN(sau?.[k]);
      console.log(`   ${k.padEnd(22)} ${a === b ? `= ${a}  (giữ nguyên)` : `${a}  →  ${b}`}`);
    }
  }
  console.log('\nXong.');
  process.exit(0);
}
void main();
