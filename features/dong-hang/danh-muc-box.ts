import { docKichThuoc, BaChieu } from './kich-thuoc-box';

export type LoaiBox = 'thung' | 'tui' | 'khac';

export interface Box {
  ten: string;
  ma: string;
  loai: LoaiBox;
  kichThuoc: BaChieu;
  larkRecordIds: string[];
}

export interface DongKho {
  recordId: string;
  lineitemName: string | null;
  dinhDanh: string | null;
  kichThuoc: string | null;
}

/**
 * Nhận dạng loại box từ tên, bỏ qua dấu và hoa/thường.
 * - 'thung': chứa 'thùng' hoặc 'hộp'
 * - 'tui': chứa 'túi'
 * - 'khac': mọi trường hợp khác
 */
export function loaiTheoTen(ten: string): LoaiBox {
  // Normalize: tách dấu thành các ký tự riêng biệt, loại bỏ dấu, rồi ghép lại
  const normalized = ten
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Loại bỏ dấu Việt
    .toLowerCase();

  if (normalized.includes('thung') || normalized.includes('hop')) {
    return 'thung';
  }
  if (normalized.includes('tui')) {
    return 'tui';
  }
  return 'khac';
}

export interface BoLai {
  ten: string;
  lyDo: string;
  recordIds: string[];
}

export function gomBox(rows: DongKho[]): { box: Box[]; boLai: BoLai[] } {
  const box: Box[] = [];
  const boLai: BoLai[] = [];

  // Nhóm theo tên
  const grouped = new Map<string | null, DongKho[]>();
  for (const row of rows) {
    const key = row.lineitemName;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(row);
  }

  // Xử lý từng nhóm
  for (const [ten, group] of grouped) {
    if (!ten) {
      // lineitemName null → tất cả vào boLai
      boLai.push({
        ten: ten ?? '(không có tên)',
        lyDo: 'Không có tên sản phẩm',
        recordIds: group.map((r) => r.recordId),
      });
      continue;
    }

    // Xác định loại
    const loai = loaiTheoTen(ten);

    // Loại 'khac' không thể là box
    if (loai === 'khac') {
      boLai.push({
        ten,
        lyDo: 'Không phải container (thùng/túi)',
        recordIds: group.map((r) => r.recordId),
      });
      continue;
    }

    // Đọc kích thước của từng dòng
    const withSize = group.map((row) => ({
      row,
      size: docKichThuoc(row.kichThuoc),
    }));

    // Tìm dòng đầu tiên có kích thước hợp lệ
    let mainBox: { row: DongKho; size: BaChieu } | null = null;
    for (const item of withSize) {
      if (item.size) {
        mainBox = item as { row: DongKho; size: BaChieu };
        break;
      }
    }

    if (!mainBox) {
      // Tất cả dòng đều không có kích thước hợp lệ
      boLai.push({
        ten,
        lyDo: 'Không đọc được kích thước từ bất kỳ dòng nào',
        recordIds: group.map((r) => r.recordId),
      });
      continue;
    }

    // Tạo box chính từ dòng đầu tiên có kích thước
    const mainRecordIds = [mainBox.row.recordId];

    // Kiểm tra các dòng còn lại
    for (const item of withSize) {
      if (item === mainBox) continue; // Bỏ qua dòng chính

      if (!item.size) {
        // Không đọc được kích thước
        boLai.push({
          ten,
          lyDo: 'Không đọc được kích thước',
          recordIds: [item.row.recordId],
        });
      } else {
        // So sánh kích thước
        const match =
          item.size.daiCm === mainBox.size.daiCm &&
          item.size.rongCm === mainBox.size.rongCm &&
          item.size.caoCm === mainBox.size.caoCm;

        if (!match) {
          // Kích thước khác
          boLai.push({
            ten,
            lyDo: `Kích thước khác: ${item.size.daiCm}x${item.size.rongCm}${item.size.caoCm ? 'x' + item.size.caoCm : ''} vs ${mainBox.size.daiCm}x${mainBox.size.rongCm}${mainBox.size.caoCm ? 'x' + mainBox.size.caoCm : ''}`,
            recordIds: [item.row.recordId],
          });
        } else {
          // Kích thước giống, thêm vào recordIds
          mainRecordIds.push(item.row.recordId);
        }
      }
    }

    // Tạo box
    box.push({
      ten,
      ma: mainBox.row.dinhDanh ?? '',
      loai,
      kichThuoc: mainBox.size,
      larkRecordIds: mainRecordIds,
    });
  }

  return { box, boLai };
}
