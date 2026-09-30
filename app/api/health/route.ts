/**
 * Đường dẫn Railway gọi để biết container MỚI đã sẵn sàng nhận traffic chưa (CEO 30/09/2026).
 *
 * Vì sao cần: hôm nay CEO mở /f/dong-hang và gặp trang lỗi CỦA RAILWAY — "The train has not
 * arrived at the station" — tức edge không có container nào lành để chuyển request tới. Dịch vụ
 * KHÔNG hề có healthcheck, nên Railway chuyển traffic sang container mới NGAY khi build xong,
 * trước lúc Next kịp sẵn sàng. Mỗi lượt deploy vì vậy có một khoảng vài giây tới vài chục giây
 * người dùng bị đá ra. Hôm nay deploy 13 lượt, nên nhân viên gặp khoảng đó nhiều lần.
 *
 * CỐ Ý KHÔNG hỏi cơ sở dữ liệu. Healthcheck phải trả lời đúng MỘT câu: "tiến trình này nhận
 * request được chưa". Kéo CSDL vào là biến một lần CSDL chậm thành một lượt deploy THẤT BẠI và
 * một lần rollback không cần thiết — tệ hơn hẳn thứ nó định phòng.
 *
 * `force-dynamic` vì một healthcheck bị cache trả 200 từ bản build cũ thì nó không kiểm gì cả.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ ok: true, at: new Date().toISOString() });
}
