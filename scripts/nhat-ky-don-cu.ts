/**
 * Dọn dòng nhật ký thay đổi cũ hơn 12 tháng (spec 2026-10-20 §8 chốt giữ 12 tháng).
 *
 *   tsx scripts/nhat-ky-don-cu.ts              # chạy thử: chỉ đếm
 *   tsx scripts/nhat-ky-don-cu.ts --ap-dung    # xoá thật
 *   tsx scripts/nhat-ky-don-cu.ts --lo=2000 --ap-dung
 *
 * Vì sao viết ngay bây giờ chứ không để sau: trong một năm nữa sẽ không ai nhớ ra việc này,
 * và lúc nhớ ra thì bảng đã quá lớn để dọn trong một lượt — chính cái lượt dọn đầu tiên đó
 * sẽ là lượt khoá bảng lâu nhất. CHƯA đặt cron: Task 9 đo tốc độ phình trước, CEO quyết sau.
 *
 * Vì sao xoá theo LÔ chứ không một câu `DELETE` duy nhất: một `DELETE` quét cả bảng giữ khoá
 * và phình WAL tới khi xong; lô nhỏ, mỗi lô một giao dịch, dừng giữa đường cũng không sao —
 * phần đã xoá là xoá xong, lượt sau tiếp tục từ đó.
 *
 * Mặc định CHỈ ĐẾM. `--ap-dung` mới xoá. XOÁ LÀ KHÔNG LÙI ĐƯỢC.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

const apDung = process.argv.includes('--ap-dung');
const loThamSo = process.argv.find((a) => a.startsWith('--lo='))?.slice('--lo='.length);
const lo = Number(loThamSo ?? 5000);

/** Mốc giữ: dòng có `luc` cũ hơn mốc này là dòng bị dọn. */
const MOC = sql`now() - interval '12 months'`;

async function demCu(): Promise<{ so: number; cuNhat: string | null }> {
  const r = await db.execute<{ so: number; cu_nhat: string | null }>(sql`
    SELECT count(*)::int AS so, min(luc)::text AS cu_nhat
      FROM nhat_ky_thay_doi WHERE luc < ${MOC}`);
  return { so: Number(r.rows[0]?.so ?? 0), cuNhat: r.rows[0]?.cu_nhat ?? null };
}

async function main(): Promise<void> {
  if (!Number.isInteger(lo) || lo < 1 || lo > 100_000) {
    console.error(`--lo phải là số nguyên 1…100000, nhận được ${JSON.stringify(loThamSo)}`);
    process.exit(2);
  }

  const tong = await db.execute<{ so: number }>(sql`SELECT count(*)::int AS so FROM nhat_ky_thay_doi`);
  const truoc = await demCu();
  console.log(`Bảng nhat_ky_thay_doi: ${Number(tong.rows[0]?.so ?? 0).toLocaleString('vi-VN')} dòng.`);
  console.log(`Cũ hơn 12 tháng: ${truoc.so.toLocaleString('vi-VN')} dòng` +
    (truoc.cuNhat ? ` (dòng cũ nhất ${truoc.cuNhat.slice(0, 10)})` : ''));

  if (!apDung) {
    console.log(`\n(chỉ đếm — thêm --ap-dung để xoá ${truoc.so.toLocaleString('vi-VN')} dòng, lô ${lo})`);
    return;
  }
  if (truoc.so === 0) {
    console.log('\nKhông có gì để dọn.');
    return;
  }

  let daXoa = 0;
  for (;;) {
    // Mốc tính LẠI trong từng câu lệnh, không truyền hằng đọc lúc đầu: lượt dọn có thể chạy
    // qua nửa đêm, và mốc đúng là mốc lúc xoá. Lọc `luc <` lặp lại NGAY trong câu `DELETE`
    // là hàng rào duy nhất không có khe hở giữa lúc chọn id và lúc xoá.
    const r = await db.execute(sql`
      DELETE FROM nhat_ky_thay_doi
       WHERE id IN (SELECT id FROM nhat_ky_thay_doi WHERE luc < ${MOC} LIMIT ${lo})`);
    const n = (r as unknown as { rowCount?: number }).rowCount ?? 0;
    if (n === 0) break;
    daXoa += n;
    console.log(`  đã xoá ${daXoa.toLocaleString('vi-VN')} dòng…`);
  }

  const sau = await demCu();
  console.log(`\nĐã xoá ${daXoa.toLocaleString('vi-VN')} dòng. Còn cũ hơn 12 tháng: ${sau.so}.`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
