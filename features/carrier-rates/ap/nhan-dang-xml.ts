/**
 * Nhận dạng một file XML hoá đơn thuộc loại nào.
 *
 * Vì sao cần: cùng đuôi .xml nhưng có ít nhất BỐN loại khác hẳn nhau — file tải
 * từ FedEx Billing Online, hoá đơn GTGT điện tử Việt Nam (chuẩn TT78, cả FedEx
 * Việt Nam lẫn Hợp Nhất đều phát hành), hoá đơn DHL, và hoá đơn UPS (EBR). Trước đây tải nhầm loại
 * chỉ nhận được câu "Không đúng định dạng hoá đơn FedEx (FBO/XML)" — không cho
 * biết file thực sự là gì nên không biết phải làm gì tiếp.
 */
export type LoaiXmlHoaDon = 'fedex_fbo' | 'hoa_don_dien_tu_vn' | 'dhl' | 'ups' | 'khac';

export interface KetQuaNhanDang {
  loai: LoaiXmlHoaDon;
  /** Tên thẻ gốc của file — nêu ra để người dùng gửi đúng thông tin khi báo lỗi. */
  theGoc: string | null;
}

export function nhanDangXmlHoaDon(text: string): KetQuaNhanDang {
  const theGoc = text.replace(/<\?xml[^>]*\?>/g, '').match(/<\s*([A-Za-z_][\w.:-]*)/)?.[1] ?? null;
  if (!text) return { loai: 'khac', theGoc };
  if (text.includes('<Invoice_Download>')) return { loai: 'fedex_fbo', theGoc };
  if (/<HDon\b/.test(text) && /<DLHDon\b/.test(text)) return { loai: 'hoa_don_dien_tu_vn', theGoc };
  /* UPS phải đứng TRƯỚC DHL: hoá đơn UPS cũng có thẻ `<Invoice>` (lồng trong
   * `<InvoiceDetails>`), nên luật DHL ở dưới nhận nhầm file UPS là DHL rồi đẩy sang parser
   * DHL — parser đó đọc ra số hoá đơn rỗng và người tải chỉ thấy "không đúng định dạng hoá
   * đơn DHL", không biết file mình đúng là hoá đơn UPS. */
  if (/<UPS_EBR_BILL\b/.test(text)) return { loai: 'ups', theGoc };
  if (/<Invoice\b/.test(text)) return { loai: 'dhl', theGoc };
  return { loai: 'khac', theGoc };
}

/** Câu giải thích cho người dùng khi file không dùng được ở chỗ đang mở. */
export function moTaLoaiXml(kq: KetQuaNhanDang): string {
  switch (kq.loai) {
    case 'fedex_fbo': return 'file tải từ FedEx Billing Online';
    case 'hoa_don_dien_tu_vn': return 'hoá đơn GTGT điện tử Việt Nam';
    case 'dhl': return 'hoá đơn DHL';
    case 'ups': return 'hoá đơn UPS (Billing XML)';
    default: return kq.theGoc ? `XML lạ (thẻ gốc <${kq.theGoc}>)` : 'không phải XML hợp lệ';
  }
}
