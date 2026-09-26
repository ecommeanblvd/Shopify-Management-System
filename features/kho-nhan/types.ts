/**
 * Kiểu dùng chung cho luồng Nhận & Kiểm hàng.
 *
 * VÌ SAO Ở ĐÂY chứ không nằm cạnh hàm: file `'use server'` chỉ được phép export
 * HÀM ASYNC. Khai `interface` hay hằng trong đó rồi export ra là nổ lúc CHẠY
 * THẬT — `next build` KHÔNG bắt. Đã trả giá 24/09: production ném
 * `ReferenceError: DongQc is not defined`, ô tìm im lặng trả rỗng và không ai
 * biết vì sao.
 */
import type { DongThuocTinh } from './thuoc-tinh-shopify';

export interface KetQuaTim {
  lineId: string; orderId: string; storeId: string; shopifyOrderId: string;
  maDon: string; sku: string | null;
  tenSanPham: string | null; tenBienThe: string | null;
  vendor: string | null; datSl: number; daNhan: number;
}

export interface DangKiem {
  id: string; unitCode: string; sku: string | null;
  /** ID biến thể Shopify ghim lúc nhận (D-106). Null khi tra không ra. */
  shopifyVariantId: string | null;
  /** record_id trên bảng Lark. Null = chưa gửi. */
  larkRecordId: string | null;
  tenSanPham: string | null; tenBienThe: string | null;
  orderId: string | null; maDon: string | null;
  storeId: string | null; shopifyOrderId: string | null;
  /** Kho của phiếu nhận — cũng là kho đã ghi sang Lark. Mặc định của ô "Nhập kho". */
  kho: string;
  /** Phiếu nhận chứa chiếc này — ảnh hàng đến và biên bản gắn ở MỨC PHIẾU. */
  receiptId: string;
  vendor: string | null;
  taoLuc: Date;
}

export interface DongQc {
  sku: string | null;
  variantId: string | null;
  productId: string | null;
  tenSanPham: string | null;
  tenBienThe: string | null;
  /** Ảnh biến thể ĐỨNG ĐẦU (đúng màu khách đặt), rồi tới ảnh sản phẩm. */
  anh: string[];
  thuocTinh: DongThuocTinh[];
  soBiCat: number;
}

export interface DuLieuQcDon { dong: DongQc[] }

export interface ChiecLoi {
  itemId: string; unitCode: string; sku: string | null;
  tenSanPham: string | null; tenBienThe: string | null; maDon: string | null;
  loi: { lyDo: string; ghiChu: string | null; anhUrl: string | null }[];
}

export interface FileLark { token: string; ten: string }

/** Một dòng SỔ NHẬP KHO — đọc từ bản sao bảng Lark "WH - Inventory". */
export interface DongSoNhap {
  recordId: string;
  /** 'YYYY-MM-DD' theo giờ nghiệp vụ. */
  ngayImport: string | null;
  dinhDanh: string | null;
  warehouse: string | null;
  inventoryType: string | null;
  orderNumber: string | null;
  sku: string | null;
  lineitemName: string | null;
  storeFinal: string | null;
  vendorFinal: string | null;
  qcCheck: string | null;
  whAction: string | null;
  uniqueCode: string | null;
  soLuong: number | null;
  coAnhHangDen: boolean;
  coBbBanGiao: boolean;
  /** File đính kèm trên Lark — token để tải qua /api/kho-nhan/anh-lark. */
  anhHangDen: FileLark[];
  bbBanGiao: FileLark[];
  /** Dòng do CHÍNH hệ thống này tạo, không phải đội kho gõ thẳng trên Lark. */
  cuaHeThong: boolean;
}

/** Hai loại đính kèm lúc nhận hàng — khớp hai cột đính kèm trên Lark. */
export type LoaiAnhNhan = 'hang_den' | 'bb_ban_giao';

export interface AnhNhan {
  id: string; receiptId: string; loai: LoaiAnhNhan;
  s3Key: string; tenFile: string | null;
  /** Link ký hạn ngắn; null khi S3 chưa cấu hình hoặc ký hỏng. */
  url: string | null;
}
