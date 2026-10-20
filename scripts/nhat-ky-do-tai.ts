/**
 * Đo TẢI của nhật ký thay đổi — ba con số spec 2026-10-20 §8 đòi, cho MỖI bảng đang bật
 * trigger: số dòng nhật ký mỗi ngày, tỉ lệ dòng do người so với do máy, và thời gian ghi
 * trung bình của bảng đó.
 *
 *   tsx scripts/nhat-ky-do-tai.ts            # đo (chỉ đọc)
 *   tsx scripts/nhat-ky-do-tai.ts --ngay=14  # bảng chia theo ngày dài hơn
 *
 * KHÔNG có `--ap-dung`: tệp này không có đường ghi nào. Nếp "chạy thử là mặc định" của
 * `scripts/` là để một lệnh chạm dữ liệu phải được gõ thêm một chữ mới chạy; ở đây không có
 * lệnh nào chạm dữ liệu, nên một cờ `--ap-dung` không làm gì sẽ chỉ dạy người đọc rằng cờ
 * đó vô hại ở những script khác — nơi nó KHÔNG vô hại.
 *
 * VÌ SAO phải nói "chưa đủ dữ liệu" chứ không in 0: một báo cáo đo nói *"0 dòng/ngày, đạt
 * ngưỡng"* là báo cáo NÓI DỐI — số 0 ở đây nghĩa là chưa có lệnh ghi nào vào bảng được bật,
 * không phải nghĩa là tải thấp. Quyết định mở rộng cho 9 bảng còn lại treo vào ba con số
 * này, nên một con số không có cơ sở còn tệ hơn không có con số.
 *
 * VÌ SAO danh sách bảng đọc từ `pg_trigger` chứ không từ `CAU_HINH`: `CAU_HINH` là KHAI BÁO
 * (10 bảng), còn trigger bật/gỡ từng bảng một bằng `nhat-ky-bat-tat.ts`. Đo theo khai báo
 * là đo những bảng chưa bật.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

/** Ngưỡng dừng spec §8: chạm là KHÔNG mở rộng, cắt theo thứ tự §8 rồi đo lại. */
const NGUONG_DONG_MOI_NGAY = 200_000;
const NGUONG_TANG_GHI = 0.2;

const ngayThamSo = process.argv.find((a) => a.startsWith('--ngay='))?.slice('--ngay='.length);
const soNgayBang = Number(ngayThamSo ?? 7);

function so(n: number): string {
  return n.toLocaleString('vi-VN');
}
function phanTram(phan: number, tong: number): string {
  return tong === 0 ? '—' : `${((phan / tong) * 100).toFixed(1)}%`;
}

/** Bảng ĐANG BẬT trigger, đọc từ catalog chứ không từ khai báo. */
async function bangDangBat(): Promise<string[]> {
  const r = await db.execute<{ relname: string }>(sql`
    SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND t.tgname LIKE 'nhat_ky_%'
     ORDER BY c.relname`);
  return r.rows.map((x) => x.relname);
}

interface DemDong {
  tong: number;
  nguoi: number;
  may: number;
  chuaGan: number;
  cuNhat: string | null;
  moiNhat: string | null;
}

/**
 * Ba nhóm tác nhân, KHÔNG phải hai. "Chưa gắn danh tính" (không có cả id người lẫn nhãn
 * máy) tách riêng thay vì nhập vào "máy": gộp lại là biến món nợ của Task 4 thành một câu
 * trả lời, và tỉ lệ người/máy sẽ nói sai về chính cái nó đo.
 */
async function demDongCua(bang: string): Promise<DemDong> {
  const r = await db.execute<{
    tong: number; nguoi: number; may: number; chua_gan: number;
    cu_nhat: string | null; moi_nhat: string | null;
  }>(sql`
    SELECT count(*)::int AS tong,
           count(*) FILTER (WHERE tac_nhan_id IS NOT NULL)::int AS nguoi,
           count(*) FILTER (WHERE tac_nhan_id IS NULL AND tac_nhan_nhan IS NOT NULL)::int AS may,
           count(*) FILTER (WHERE tac_nhan_id IS NULL AND tac_nhan_nhan IS NULL)::int AS chua_gan,
           min(luc)::text AS cu_nhat, max(luc)::text AS moi_nhat
      FROM nhat_ky_thay_doi WHERE bang = ${bang}`);
  const x = r.rows[0];
  return {
    tong: Number(x?.tong ?? 0),
    nguoi: Number(x?.nguoi ?? 0),
    may: Number(x?.may ?? 0),
    chuaGan: Number(x?.chua_gan ?? 0),
    cuNhat: x?.cu_nhat ?? null,
    moiNhat: x?.moi_nhat ?? null,
  };
}

/** Số dòng theo từng ngày — để thấy một ngày nhập hàng lớn, không chỉ thấy số bình quân. */
async function theoNgay(bang: string, soNgay: number): Promise<Array<{ ngay: string; so: number }>> {
  const r = await db.execute<{ ngay: string; so: number }>(sql`
    SELECT (luc AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS ngay, count(*)::int AS so
      FROM nhat_ky_thay_doi
     WHERE bang = ${bang} AND luc >= now() - make_interval(days => ${soNgay})
     GROUP BY 1 ORDER BY 1 DESC`);
  return r.rows.map((x) => ({ ngay: x.ngay, so: Number(x.so) }));
}

interface ThoiGianGhi {
  soLenh: number;
  tongMs: number;
  trungBinhMs: number | null;
  tuLuc: string | null;
}

/**
 * Thời gian ghi trung bình của bảng, lấy từ `pg_stat_statements`.
 *
 * Khớp theo ĐẦU CÂU (`insert into "bảng"`, `update "bảng"`, `delete from "bảng"`) chứ không
 * `ILIKE '%bảng%'`: một câu `SELECT` có bảng này trong truy vấn con không phải lệnh ghi, mà
 * đếm nó vào thì con số "thời gian ghi" nói về chuyện khác.
 *
 * `\\s` trong chuỗi mẫu PHẢI nhân đôi dấu gạch chéo: `sql` là template literal của
 * JavaScript, nên `\s` bị chính JS nuốt thành `s` và biểu thức chính quy thành
 * `^insertsintos"?` — khớp không gì cả, rồi lặng lẽ báo "chưa đủ dữ liệu" (đã mắc đúng lỗi
 * này lúc viết, 20/10/2026).
 *
 * `trungBinhMs` là bình quân TÍCH LUỸ từ `tuLuc` (lượt reset gần nhất của
 * `pg_stat_statements`), nên nó TRỘN cả quãng trước khi bật trigger. Vì thế lượt sau phải
 * so bằng HIỆU: (tongMs₂ − tongMs₁) / (soLenh₂ − soLenh₁). Hai con số thô được in ra chính
 * là để làm phép hiệu đó — in riêng mỗi bình quân tích luỹ là một cái bẫy: nó luôn trông
 * "không tăng" vì quãng cũ pha loãng quãng mới.
 */
async function thoiGianGhiCua(bang: string): Promise<ThoiGianGhi> {
  const r = await db.execute<{ so_lenh: number; tong_ms: number; tu_luc: string | null }>(sql`
    SELECT coalesce(sum(calls), 0)::bigint AS so_lenh,
           coalesce(sum(total_exec_time), 0)::float8 AS tong_ms,
           min(stats_since)::text AS tu_luc
      FROM pg_stat_statements
     WHERE query ~* ('^insert\\s+into\\s+"?' || ${bang} || '"?')
        OR query ~* ('^update\\s+"?' || ${bang} || '"?')
        OR query ~* ('^delete\\s+from\\s+"?' || ${bang} || '"?')`);
  const x = r.rows[0];
  const soLenh = Number(x?.so_lenh ?? 0);
  const tongMs = Number(x?.tong_ms ?? 0);
  return {
    soLenh,
    tongMs,
    trungBinhMs: soLenh > 0 ? tongMs / soLenh : null,
    tuLuc: x?.tu_luc ?? null,
  };
}

function inMotBang(
  bang: string,
  dem: DemDong,
  ngay: Array<{ ngay: string; so: number }>,
  ghi: ThoiGianGhi,
): void {
  console.log(`\n=== ${bang} ===`);

  // ── 1. Số dòng mỗi ngày ───────────────────────────────────────────────────────────
  if (dem.tong === 0) {
    console.log('1) Dòng/ngày:            CHƯA ĐỦ DỮ LIỆU ĐỂ KẾT LUẬN — 0 dòng nhật ký.');
    console.log('   Nghĩa là chưa có lệnh ghi nào vào bảng này kể từ lúc bật trigger,');
    console.log('   KHÔNG phải nghĩa là tải thấp. Chờ bảng có việc thật rồi đo lại.');
  } else {
    const batDau = new Date(dem.cuNhat!).getTime();
    const gio = (Date.now() - batDau) / 3_600_000;
    console.log(`   Quan sát: ${so(dem.tong)} dòng, từ ${dem.cuNhat!.slice(0, 19)} đến ${dem.moiNhat!.slice(0, 19)}.`);
    if (gio < 24) {
      // Chia cho một quãng ngắn hơn một ngày là phóng đại; chia cho 7 ngày khi mới bật
      // một ngày là thu nhỏ 7 lần. Cả hai đều sai, nên nói rõ thay vì chọn một cái.
      console.log(`1) Dòng/ngày:            CHƯA ĐỦ DỮ LIỆU — mới quan sát ${gio.toFixed(1)} giờ (< 24h).`);
    } else {
      const moiNgay = dem.tong / (gio / 24);
      console.log(`1) Dòng/ngày (bình quân ${(gio / 24).toFixed(1)} ngày): ${so(Math.round(moiNgay))}`);
      console.log(`   Ngưỡng dừng: ${so(NGUONG_DONG_MOI_NGAY)} dòng/ngày → ` +
        (moiNgay > NGUONG_DONG_MOI_NGAY ? '⚠ VƯỢT NGƯỠNG, không mở rộng.' : 'trong ngưỡng.'));
    }
    if (ngay.length > 0) {
      console.log(`   Theo ngày (${soNgayBang} ngày gần nhất, giờ VN):`);
      for (const d of ngay) console.log(`     ${d.ngay}  ${so(d.so).padStart(9)}`);
    }
  }

  // ── 2. Người so với máy ───────────────────────────────────────────────────────────
  if (dem.tong === 0) {
    console.log('2) Người / máy:          CHƯA ĐỦ DỮ LIỆU ĐỂ KẾT LUẬN — không có dòng nào để chia.');
  } else {
    console.log(`2) Người: ${so(dem.nguoi)} (${phanTram(dem.nguoi, dem.tong)}) · ` +
      `Máy: ${so(dem.may)} (${phanTram(dem.may, dem.tong)}) · ` +
      `Chưa gắn danh tính: ${so(dem.chuaGan)} (${phanTram(dem.chuaGan, dem.tong)})`);
    if (dem.chuaGan > 0) {
      console.log('   "Chưa gắn danh tính" CỐ Ý tách khỏi "máy": đó là món nợ Task 4, không phải một');
      console.log('   câu trả lời. Gộp vào máy là nói sai về chính tỉ lệ đang đo.');
    }
  }

  // ── 3. Thời gian ghi ──────────────────────────────────────────────────────────────
  if (ghi.trungBinhMs === null) {
    console.log('3) Thời gian ghi:        CHƯA ĐỦ DỮ LIỆU — pg_stat_statements không có lệnh ghi nào');
    console.log('   cho bảng này (chưa có lệnh ghi, hoặc thống kê vừa bị reset).');
  } else {
    console.log(`3) Thời gian ghi trung bình: ${ghi.trungBinhMs.toFixed(2)} ms ` +
      `(${so(ghi.soLenh)} lệnh, tổng ${ghi.tongMs.toFixed(0)} ms, tích luỹ từ ${ghi.tuLuc?.slice(0, 19) ?? '?'})`);
    console.log(`   Để so lượt sau: hiệu = (tổng₂ − tổng₁) / (lệnh₂ − lệnh₁). ` +
      `Ngưỡng dừng: tăng quá ${(NGUONG_TANG_GHI * 100).toFixed(0)}%.`);
    console.log('   ⚠ Bình quân này TRỘN cả quãng trước khi bật trigger, nên bản thân nó KHÔNG');
    console.log('   kết luận được gì về chi phí của trigger. Nó là MỐC NỀN cho phép hiệu.');
  }
}

async function main(): Promise<void> {
  if (!Number.isInteger(soNgayBang) || soNgayBang < 1 || soNgayBang > 365) {
    console.error(`--ngay phải là số nguyên 1…365, nhận được ${JSON.stringify(ngayThamSo)}`);
    process.exit(2);
  }

  const bangs = await bangDangBat();
  console.log(`Đo lúc ${new Date().toISOString()}`);
  console.log(`Bảng ĐANG BẬT trigger nhật ký: ${bangs.join(', ') || '(không có)'}`);

  if (bangs.length === 0) {
    console.log('\nKhông có bảng nào đang bật — không có gì để đo. ' +
      'Bật bằng scripts/nhat-ky-bat-tat.ts trước.');
    return;
  }

  const tong = await db.execute<{ so: number }>(sql`SELECT count(*)::int AS so FROM nhat_ky_thay_doi`);
  console.log(`Cả bảng nhat_ky_thay_doi: ${so(Number(tong.rows[0]?.so ?? 0))} dòng.`);

  for (const b of bangs) {
    inMotBang(b, await demDongCua(b), await theoNgay(b, soNgayBang), await thoiGianGhiCua(b));
  }

  console.log('\nLượt đo này là MỐC NỀN. Chạy lại sau 7 ngày (spec §8 Step 4) rồi so bằng hiệu.');
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
