import { describe, it, expect } from 'vitest';
import { deliveryStatusToEvent } from './mmp-events-map';
import { deriveShipHoStage } from './order-stage';
import { mapTrangThai } from '@/features/lark/ghi-nguoc/map-trang-thai';

/**
 * Nấc `awaiting_pickup` đi RA NGOÀI hai nơi: MMP và Lark. Bộ test này ghim rằng nấc mới KHÔNG
 * làm đổi thứ hai bên kia nhận — nên không cần một vòng đổi hợp đồng với đối tác.
 */
describe('awaiting_pickup ra ngoài', () => {
  /* MMP chỉ có ba nghĩa. Kiện nằm ở điểm nhận KHÔNG còn đi → báo in_transit là nói sai. Và
     trước 02/10 ca này tới MMP từ FedEx HL cũng dưới dạng exception, nên giữ exception là
     GIỮ NGUYÊN hợp đồng đang chạy. */
  it('MMP: → shipment.exception, KHÔNG phải in_transit', () => {
    expect(deliveryStatusToEvent('awaiting_pickup')).toBe('shipment.exception');
  });

  /* Chuỗi "awaiting_pickup" không khớp biểu thức bắt ngoại lệ, nên nếu thiếu nhánh tường minh
     thì nó rơi xuống nhánh cuối và ra in_transit. Đây là ca ghim đúng cái bẫy đó. */
  it('MMP: không được rơi vào nhánh cuối', () => {
    expect(deliveryStatusToEvent('awaiting_pickup')).not.toBe('shipment.in_transit');
  });

  /* Cột trên Lark là cột CHỌN: gửi giá trị lạ thì Lark đẻ thêm lựa chọn mới trong bảng vận
     hành của đội kho. Dùng lại đúng cặp của exception = không đổi gì phía Lark. */
  it('Lark: dùng lại cặp lựa chọn đang có, không đẻ option mới', () => {
    expect(mapTrangThai('awaiting_pickup')).toEqual(mapTrangThai('exception'));
    expect(mapTrangThai('awaiting_pickup')).not.toBeNull();
  });
});

describe('awaiting_pickup trên màn ship hộ', () => {
  const nen = { status: 'shipped', trackingNumber: '1Z', reconcileStatus: null, marginVnd: null };

  /* Việc cần làm khác hẳn 'exception': sự cố thì gọi HÃNG, chờ lấy thì gọi KHÁCH. Một chữ cho
     hai việc là người đọc phải mở từng đơn mới biết phải làm gì. */
  it('cảnh báo RIÊNG, không dùng chung chữ với sự cố', () => {
    const a = deriveShipHoStage({ ...nen, deliveryStatus: 'awaiting_pickup' });
    const b = deriveShipHoStage({ ...nen, deliveryStatus: 'exception' });
    expect(a.warnings).toEqual(['Chờ khách tới lấy — nhắc brand liên hệ khách']);
    expect(b.warnings).toEqual(['Sự cố giao hàng']);
    expect(a.label).toBe('Chờ khách tới lấy');
  });

  /* 'warn' chứ không 'bad': hãng đã làm xong phần mình, kiện không hỏng. */
  it('tone warn, và KHÔNG tính là đã giao', () => {
    const a = deriveShipHoStage({ ...nen, deliveryStatus: 'awaiting_pickup' });
    expect(a.tone).toBe('warn');
    expect(a.label).not.toBe('Đã giao');
  });

  it('đã lên bảng kê / đã thanh toán vẫn thắng nhãn vận chuyển, nhưng GIỮ cảnh báo', () => {
    const r = deriveShipHoStage({ ...nen, status: 'billed', deliveryStatus: 'awaiting_pickup' });
    expect(r.label).toBe('Đã lên bảng kê');
    expect(r.warnings).toContain('Chờ khách tới lấy — nhắc brand liên hệ khách');
  });
});
