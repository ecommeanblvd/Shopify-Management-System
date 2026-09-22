/**
 * MỘT LẦN: đánh dấu mọi kiện trong SMS mà dòng LOG-Export trên Lark không còn.
 *
 * Cron chỉ đánh dấu tối đa 50 kiện mỗi lượt (guard chống Lark trả thiếu), nên dữ liệu tồn
 * từ trước phải dọn bằng script này. Chạy:
 *   railway run --service "sync Lark operation" npx tsx scripts/chuyen-doi/danh-dau-kien-mat-dong-lark.ts --dry
 *   railway run --service "sync Lark operation" npx tsx scripts/chuyen-doi/danh-dau-kien-mat-dong-lark.ts --xac-nhan
 */
import { inArray, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listAllRecords } from '@/features/lark/client';
import { larkText } from '@/features/lark/parse-pack-row';
import { soatMatDong } from '@/features/lark/mat-dong';

const CHUNK = 200;

async function main(): Promise<void> {
  const dry = !process.argv.includes('--xac-nhan');
  const records = await listAllRecords();
  const logCodeTrenLark = records
    .map((r) => larkText(r.fields['Log Unique code']))
    .filter((c): c is string => !!c);

  const kien = await db
    .select({
      logUniqueCode: schema.shipments.logUniqueCode,
      luc: schema.shipments.larkMatDongLuc,
      tracking: schema.shipments.trackingNumber,
    })
    .from(schema.shipments)
    .where(isNotNull(schema.shipments.logUniqueCode));

  const kq = soatMatDong(
    logCodeTrenLark,
    kien.map((k) => ({ logUniqueCode: k.logUniqueCode!, daDanhDau: k.luc != null })),
    Number.MAX_SAFE_INTEGER,
  );
  const chuaShip = new Set(kien.filter((k) => !k.tracking).map((k) => k.logUniqueCode));
  process.stdout.write(
    `Lark ${logCodeTrenLark.length} dòng · SMS ${kien.length} kiện\n` +
    `cần đánh dấu ${kq.canDanhDau.length} (trong đó ${kq.canDanhDau.filter((c) => chuaShip.has(c)).length} kiện chưa có mã vận đơn)\n` +
    `cần gỡ dấu ${kq.canGoDanhDau.length}\n`,
  );
  process.stdout.write(`ví dụ: ${kq.canDanhDau.slice(0, 10).join(', ')}\n`);

  if (dry) {
    process.stdout.write('DRY — chưa ghi gì. Thêm --xac-nhan để ghi.\n');
    return;
  }
  let daGhi = 0;
  for (let i = 0; i < kq.canDanhDau.length; i += CHUNK) {
    const res = await db.update(schema.shipments)
      .set({ larkMatDongLuc: new Date(), updatedAt: new Date() })
      .where(inArray(schema.shipments.logUniqueCode, kq.canDanhDau.slice(i, i + CHUNK)));
    daGhi += (res as { rowCount?: number }).rowCount ?? 0;
  }
  process.stdout.write(`đã đánh dấu ${daGhi} kiện\n`);
}

main()
  .catch((e) => { process.stderr.write(`lỗi: ${e instanceof Error ? e.stack : String(e)}\n`); process.exitCode = 1; })
  .finally(() => process.exit());
