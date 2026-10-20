/**
 * Kiểm ĐƯỜNG DỮ LIỆU đầu-cuối của nhật ký thay đổi, KHÔNG commit gì.
 *
 *   tsx scripts/nhat-ky-kiem-duong.ts          # sửa một ô dưới danh tính một NGƯỜI
 *   tsx scripts/nhat-ky-kiem-duong.ts --tran   # sửa cùng ô bằng lệnh TRẦN (ngoài ghiVoi)
 *   tsx scripts/nhat-ky-kiem-duong.ts --nguoi=<userId> --chiec=<goods_receipt_items.id>
 *
 * VÌ SAO có tệp này: hệ thống chỉ có đăng nhập Google, không có đường đăng nhập chỉ-dev,
 * nên tới 20/10/2026 chưa ai mở được hai màn hình nhật ký bằng trình duyệt để soát
 * (Task 7 Step 6 bị chặn). Tệp này chứng minh mọi mắt của chuỗi TRỪ CSS: trigger ghi →
 * đúng câu SQL của `features/nhat-ky/queries.ts` đọc lại → `gomKhoi` gom → các hàm trình
 * bày thuần của `components/nhat-ky/trinh-bay.ts` → bốn cột `Ngày · Người dùng · Trường ·
 * Trước → Sau` mà `BangNhatKy.tsx` vẽ.
 *
 * Chạy HAI lượt là chủ ý: lượt bọc `ghiVoi` phải ra TÊN NGƯỜI, lượt trần phải ra
 * "Chưa gắn danh tính". Chỉ một lượt thì không phân biệt được "danh tính chạy đúng" với
 * "mọi dòng đều mang danh tính của ai đó".
 *
 * ⚠ KHÔNG CÓ `--ap-dung`, và cố ý không có: tệp này LUÔN kết thúc bằng `ROLLBACK`.
 * `DATABASE_URL` trỏ production, nên một cờ "ghi thật" ở đây là một cờ để ai đó bấm nhầm
 * vào dữ liệu kho và vào bảng nhật ký — mà nhật ký là BẰNG CHỨNG, một dòng giả trong đó
 * đắt hơn nhiều một dòng giả ở bảng thường. Rollback cưỡng chế bằng `tx.rollback()`, và
 * kiểm lại SAU khi giao dịch đóng: số dòng nhật ký và ô vừa sửa đều phải y như trước.
 */
import { sql, type SQL } from 'drizzle-orm';
import { TransactionRollbackError } from 'drizzle-orm/errors';
import { db } from '@/db/client';
import { ghiVoi, type Tx } from '@/features/nhat-ky/ghi-voi';
import { docDongCuaBang, docDongCuaBanGhi, thanhDongTho } from '@/features/nhat-ky/queries';
import { gomKhoi, type KhoiNhatKy } from '@/features/nhat-ky/gom-dong';
import {
  catGiaTri, CHE_HIEN, chipGiaTri, chipThaoTac, hienOThoiGian, kieuTacNhan,
  LY_DO_CHE, NULL_HIEN,
} from '@/components/nhat-ky/trinh-bay';
import { hienNgayGio } from '@/lib/timezone';

const BANG = 'goods_receipt_items';
/** Bảng CHA của `BANG` (`CAU_HINH` khai `cotCha: 'receipt_id'`) — lối vào tab "Lịch sử". */
const BANG_CHA = 'goods_receipts';
/** Cột VÔ HẠI để sửa thử: số cân của một chiếc, không phải cột trạng thái hay cột tiền. */
const COT_THU = 'weight_kg';

const tran = process.argv.includes('--tran');
const nguoiThamSo = process.argv.find((a) => a.startsWith('--nguoi='))?.slice('--nguoi='.length);
const chiecThamSo = process.argv.find((a) => a.startsWith('--chiec='))?.slice('--chiec='.length);

/**
 * Quyền của người xem ÍT QUYỀN NHẤT mà vẫn đọc được bảng này.
 *
 * `view_fulfillment` chứ không phải danh sách RỖNG (sửa 20/10/2026 cùng C1): `DO_NHAY` nay
 * CHE MẶC ĐỊNH cả ở mức bảng, và `goods_receipt_items` được khai với `view_fulfillment` —
 * đúng quyền mà `/f/warehouse` đang gác. Quyền rỗng thì mọi ô ra `•••` và lượt kiểm này
 * không còn kiểm đường dữ liệu nào cả, chỉ kiểm cái hàng rào.
 *
 * `view_fulfillment` là mẫu số chung của cả năm vai trên production (đo 20/10/2026), nên
 * thấy được giá trị ở đây nghĩa là ai mở màn kho cũng thấy được.
 */
const QUYEN_MAN_KHO = ['view_fulfillment'] as const;

async function chonChiec(): Promise<{ id: string; weight: string | null; receiptId: string }> {
  const r = await db.execute<{ id: string; weight_kg: string | null; receipt_id: string }>(sql`
    SELECT id, weight_kg, receipt_id FROM goods_receipt_items
     WHERE ${chiecThamSo ? sql`id = ${chiecThamSo}` : sql`true`}
     ORDER BY created_at DESC LIMIT 1`);
  const x = r.rows[0];
  if (!x) throw new Error(`Không tìm thấy chiếc nào trong ${BANG}` + (chiecThamSo ? ` với id ${chiecThamSo}` : ''));
  return { id: x.id, weight: x.weight_kg, receiptId: x.receipt_id };
}

async function chonNguoi(): Promise<{ id: string; name: string | null }> {
  const r = await db.execute<{ id: string; name: string | null }>(sql`
    SELECT id, name FROM "user"
     WHERE ${nguoiThamSo ? sql`id = ${nguoiThamSo}` : sql`true`}
     ORDER BY created_at ASC LIMIT 1`);
  const x = r.rows[0];
  if (!x) throw new Error('Không tìm thấy người dùng nào trong bảng "user".');
  return { id: x.id, name: x.name };
}

/** Giá trị mới: cộng thêm 0.001 kg để chắc chắn KHÁC giá trị cũ (kể cả khi ô đang NULL). */
function cauSuaThu(chiecId: string): SQL {
  return sql`UPDATE goods_receipt_items
                SET weight_kg = round(coalesce(weight_kg, 0) + 0.001, 3)
              WHERE id = ${chiecId}`;
}

/* ---------------------------------------------------------------------------
 * In ra ĐÚNG thứ màn hình hiện. Mỗi hàm dưới đây soi một hàm của `BangNhatKy.tsx`:
 * `hienNgayGio` + `chipThaoTac` + id bản ghi cho cột Ngày, `kieuTacNhan` cho cột Người
 * dùng, `chipGiaTri` / `hienOThoiGian` / `NULL_HIEN` / `catGiaTri` / `CHE_HIEN` +
 * `LY_DO_CHE` cho cột Trước → Sau. Dùng CHÍNH các hàm đó, không chép lại luật — chép lại
 * là kiểm bản chép.
 * ------------------------------------------------------------------------- */

function oNguoiDung(k: KhoiNhatKy): string {
  const kieu = kieuTacNhan(k);
  if (kieu === 'may') return `${k.tacNhanNhan} [máy]`;
  return k.tacNhanNhan;
}

function oGiaTri(truong: string, gia: string | null): string {
  if (gia === null) return NULL_HIEN;
  const chip = chipGiaTri(truong, gia);
  if (chip) return `${chip.nhan} (chip)`;
  if (gia === '') return '(để trống)';
  // Cột `*_at` ra ISO UTC thô từ trigger; màn hình quy về giờ nghiệp vụ nên ở đây cũng vậy.
  const moc = hienOThoiGian(truong, gia);
  if (moc) return moc;
  const { hien, daCat } = catGiaTri(gia);
  return hien + (daCat ? '…' : '');
}

function inBang(khoi: readonly KhoiNhatKy[], banGhiDangMo?: string): void {
  if (khoi.length === 0) {
    console.log('  (Chưa có thay đổi nào được ghi.)');
    return;
  }
  console.log(`  ${'Ngày'.padEnd(22)}${'Người dùng'.padEnd(26)}${'Trường'.padEnd(22)}Trước → Sau`);
  console.log(`  ${'-'.repeat(96)}`);
  for (const k of khoi) {
    for (const [i, d] of k.dong.entries()) {
      const ngay = i === 0 ? hienNgayGio(k.luc) : '';
      const nguoi = i === 0 ? oNguoiDung(k) : '';
      const truocSau = d.biChe
        ? `${CHE_HIEN} → ${CHE_HIEN}  (${LY_DO_CHE})`
        : `${oGiaTri(d.truong, d.truoc)} → ${oGiaTri(d.truong, d.sau)}`;
      console.log(`  ${ngay.padEnd(22)}${nguoi.padEnd(26)}${d.nhan.padEnd(22)}${truocSau}`);
    }
    // Dòng phụ dưới cột Ngày — đúng ba nhánh của `ONoiXay`: chính bản ghi đang mở,
    // một dòng con của nó, hay (trang cả bảng) chỉ id bản ghi.
    const noiXay = banGhiDangMo
      ? (k.banGhiId === banGhiDangMo ? 'Bản ghi này' : `Dòng con · ${k.banGhiId.slice(0, 8)}`)
      : k.banGhiId.slice(0, 8);
    // Chip THAO TÁC, cùng chỗ và cùng luật với `OThaoTac` của `BangNhatKy.tsx`: `sua` không
    // có chip, nên dòng này chỉ hiện ở ca `them` / `xoa` / `tron`.
    const thao = chipThaoTac(k.thaoTac);
    console.log(`  ${('└ ' + noiXay).padEnd(22)}${thao ? `[${thao.nhan}]` : ''}`);
  }
}

/**
 * Đọc lại bằng CẢ HAI câu của `queries.ts`, trên giao dịch đang mở — thay đổi chưa commit
 * thì chỉ giao dịch này thấy.
 *
 * Hai lối vào của spec §6, và lối thứ hai mới là lối CEO dùng nhiều nhất: tab "Lịch sử"
 * của một LÔ nhập kho phải cuốn được thay đổi của từng CHIẾC (`cha_bang`/`cha_id`), nên
 * câu đó đọc bằng id của LÔ, không phải id của chiếc.
 */
async function docVaIn(tx: Tx, tuLuc: Date, loId: string): Promise<number> {
  const rows = await docDongCuaBang(tx, BANG, { tuNgay: tuLuc });
  const khoi = gomKhoi(rows.map(thanhDongTho), QUYEN_MAN_KHO);
  console.log(`\n[1] Trang nhật ký cả bảng — docDongCuaBang('${BANG}'): ` +
    `${rows.length} dòng thô → ${khoi.length} khối\n`);
  inBang(khoi);

  const rowsCha = await docDongCuaBanGhi(tx, BANG_CHA, loId);
  const khoiCha = gomKhoi(rowsCha.map(thanhDongTho), QUYEN_MAN_KHO);
  console.log(`\n[2] Tab "Lịch sử" của LÔ ${loId} — docDongCuaBanGhi('${BANG_CHA}'): ` +
    `${rowsCha.length} dòng thô → ${khoiCha.length} khối` +
    ` (cuốn lên từ dòng con nhờ cha_bang/cha_id)\n`);
  inBang(khoiCha, loId);

  return rows.length;
}

async function main(): Promise<void> {
  const chiec = await chonChiec();
  const nguoi = tran ? null : await chonNguoi();
  const nhatKyTruoc = await demNhatKy();

  console.log(`Lượt: ${tran ? 'UPDATE TRẦN (ngoài ghiVoi)' : 'bọc trong ghiVoi() dưới danh tính NGƯỜI'}`);
  console.log(`Chiếc: ${chiec.id} (lô ${chiec.receiptId}), ${COT_THU} đang là ${chiec.weight ?? 'NULL'}`);
  if (nguoi) console.log(`Người: ${nguoi.id} — ${nguoi.name ?? '(không có tên)'}`);
  console.log(`nhat_ky_thay_doi trước khi chạy: ${nhatKyTruoc} dòng`);

  // Mốc lọc: lùi một phút để chắc chắn bắt được dòng vừa ghi, mà không cuốn lịch sử cũ.
  const tuLuc = new Date(Date.now() - 60_000);
  let soDongDaThay = 0;

  const trongGiaoDich = async (tx: Tx): Promise<never> => {
    await tx.execute(cauSuaThu(chiec.id));
    soDongDaThay = await docVaIn(tx, tuLuc, chiec.receiptId);
    // ROLLBACK cưỡng chế. `tx.rollback()` ném `TransactionRollbackError`, Drizzle chạy
    // `ROLLBACK` rồi ném lại — nên không có nhánh nào ra khỏi hàm này mà đã commit.
    tx.rollback();
  };

  try {
    if (tran) await db.transaction(trongGiaoDich);
    else await ghiVoi({ kieu: 'nguoi', userId: nguoi!.id }, trongGiaoDich);
    throw new Error('Giao dịch đã COMMIT — tx.rollback() không ném. DỪNG và kiểm dữ liệu.');
  } catch (e) {
    if (!(e instanceof TransactionRollbackError)) throw e;
    console.log('\nĐã ROLLBACK.');
  }

  // Kiểm SAU khi giao dịch đóng: hai con số này là bằng chứng production còn sạch.
  const nhatKySau = await demNhatKy();
  const lai = await chonChiec();
  console.log(`\nSau rollback:`);
  console.log(`  nhat_ky_thay_doi: ${nhatKySau} dòng (trước: ${nhatKyTruoc}) → ` +
    (nhatKySau === nhatKyTruoc ? 'KHÔNG đổi ✓' : '⚠ ĐỔI — kiểm ngay'));
  console.log(`  ${COT_THU} của chiếc: ${lai.weight ?? 'NULL'} (trước: ${chiec.weight ?? 'NULL'}) → ` +
    (lai.weight === chiec.weight ? 'KHÔNG đổi ✓' : '⚠ ĐỔI — kiểm ngay'));
  if (nhatKySau !== nhatKyTruoc || lai.weight !== chiec.weight) process.exit(1);
  if (soDongDaThay === 0) {
    console.error('\n⚠ Không đọc được dòng nhật ký nào trong giao dịch — trigger không chạy?');
    process.exit(1);
  }
}

async function demNhatKy(): Promise<number> {
  const r = await db.execute<{ so: number }>(sql`SELECT count(*)::int AS so FROM nhat_ky_thay_doi`);
  return Number(r.rows[0]?.so ?? 0);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
