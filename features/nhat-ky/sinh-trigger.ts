/**
 * Sinh câu SQL trigger nhật ký từ cấu hình `CAU_HINH`.
 *
 * Thuần, không I/O. Mọi bảng dùng CHUNG một hàm `nhat_ky_ghi()` (tạo ở migration); mỗi
 * bảng chỉ khác ở ba đối số: danh sách cột, cột cha, bảng cha. Quyết định "cột nào được
 * ghi" xảy ra ở ĐÂY (có test) và chốt vào đối số, nên hàm SQL không còn tự quyết gì —
 * trigger không có cách nào sinh dòng cho một cột không nằm trong đối số.
 */
import { cotDuocGhi, type CauHinhBang } from './cot-theo-doi';

/**
 * Chuỗi này đi thẳng vào CSDL production. Tên ở đây hoặc là định danh trần (tên bảng,
 * tên trigger) hoặc nằm trong chuỗi đối số bọc dấu nháy đơn (tên cột); dấu nháy, dấu
 * chấm phẩy, khoảng trắng hay dấu phẩy đều thoát được khỏi một trong hai chỗ đó. Nên tên
 * không hợp lệ phải chết tại đây, không đi tiếp.
 */
const TEN_HOP_LE = /^[a-z_][a-z0-9_]*$/;

function kiemTraTen(ten: string, vaiTro: string): string {
  if (!TEN_HOP_LE.test(ten)) {
    throw new Error(`nhật ký: ${vaiTro} không hợp lệ: ${JSON.stringify(ten)}`);
  }
  return ten;
}

export function sinhTrigger(ch: CauHinhBang, moiCot: readonly string[]): string {
  const bang = kiemTraTen(ch.bang, 'tên bảng');

  // Khai cha thiếu một nửa sẽ ghi bản ghi cha rỗng hoặc trỏ sai; chết to còn hơn lệch lặng lẽ.
  if ((ch.cotCha === undefined) !== (ch.bangCha === undefined)) {
    throw new Error(`nhật ký: bảng ${bang} phải khai đủ cả cotCha lẫn bangCha hoặc không khai cái nào`);
  }
  const cotCha = ch.cotCha === undefined ? '' : kiemTraTen(ch.cotCha, 'cột cha');
  const bangCha = ch.bangCha === undefined ? '' : kiemTraTen(ch.bangCha, 'bảng cha');

  // Chỉ kiểm cột ĐƯỢC GHI: cột bị loại trừ không vào SQL nên tên lạ của nó vô hại.
  const cot = cotDuocGhi(ch, moiCot).map((c) => kiemTraTen(c, 'tên cột'));

  // Trigger không có cột nào để so sẽ im lặng không ghi gì (vd cột cho-phép đã bị đổi tên).
  if (cot.length === 0) {
    throw new Error(`nhật ký: bảng ${bang} không còn cột nào để theo dõi`);
  }

  return (
    `CREATE TRIGGER nhat_ky_${bang} ` +
    `AFTER INSERT OR UPDATE OR DELETE ON ${bang} ` +
    `FOR EACH ROW EXECUTE FUNCTION nhat_ky_ghi('${cot.join(',')}', '${cotCha}', '${bangCha}');`
  );
}

/** `IF EXISTS` để migration chạy lại được: gỡ rồi tạo lại là cách duy nhất cập nhật trigger. */
export function sinhGoTrigger(bang: string): string {
  const ten = kiemTraTen(bang, 'tên bảng');
  return `DROP TRIGGER IF EXISTS nhat_ky_${ten} ON ${ten};`;
}
