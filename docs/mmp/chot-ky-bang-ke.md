# Đề xuất chốt kỳ bảng kê ship hộ — MEAN ↔ MMP

**Ngày:** 30/09/2026 · **Từ:** MEAN BLVD (SMS) · **Gửi:** MMP
**Mục đích:** chốt một luật cắt kỳ duy nhất để sổ hai bên khớp nhau mà không phải đối chiếu tay.

## 1. Vì sao cần chốt bây giờ

Hai kỳ đầu (07 và 08) khớp nhau, nhưng **không phải vì hai hệ thống cùng luật** — mà vì SMS
**chép nguyên bảng kê đã chốt của MMP vào**. Từ kỳ 09, SMS tự cắt kỳ bằng luật của mình.

Hai cách cắt đã chứng minh cho kết quả khác nhau. Đo trên dữ liệu thật: **4 đơn** MMP xếp vào
kỳ tháng 8, còn luật của SMS xếp vào tháng 7 — **13.532.293đ** nằm khác tháng giữa hai sổ.

| Đơn | MMP xếp | SMS sẽ xếp | Tiền |
|---|---|---|---|
| `#KLS1992` | T8 | T7 | 1.939.351đ |
| `#KLS1985 (4)` | T8 | T7 | 4.528.008đ |
| `#KLS1985 (5)` | T8 | T7 | 4.715.145đ |
| `#KLS1994` | T8 | T7 | 2.349.789đ |

Không bên nào sai. Hai bên chỉ đang dùng hai mốc khác nhau, và **chưa ai viết mốc đó ra giấy**.

Nếu không chốt, từ kỳ 09 hai sổ bắt đầu trôi khỏi nhau mà **không có gì báo** — vì tổng mỗi
bên vẫn tự khớp với chính nó.

## 2. Ba câu phải chốt

Chốt kỳ không phải một câu hỏi mà là ba. Thiếu câu nào thì hai sổ vẫn lệch được.

**(a) Mốc nào quyết định một đơn thuộc kỳ nào?**
**(b) Ai phát hành kỳ, vào lúc nào, và bên kia xác nhận thế nào?**
**(c) Sau khi kỳ đã chốt mà giá một đơn thay đổi thì xử lý ra sao?**

Câu (c) là câu hay bị bỏ quên nhất, và là câu tốn tiền nhất. Nó không phải giả định: ngày
30/09 SMS đã tính lại giá **17 đơn**, trong đó **2 đơn nằm trong kỳ tháng 7 đã phát hành**.

## 3. Đề xuất của MEAN

### (a) Mốc kỳ = ngày SMS đẩy `order.reconciled` THÀNH CÔNG lần đầu

Không dùng ngày gửi hàng, không dùng ngày hoá đơn hãng vận chuyển.

**Lý do chính: đây là mốc duy nhất CẢ HAI BÊN tự tính được từ cùng một bằng chứng.** MMP nhận
webhook đó và có dấu thời gian của chính mình; MEAN có dấu thời gian trong outbox. Hai bên
không cần tin số của nhau — mỗi bên tự suy ra cùng một kết quả.

Vì sao không phải hai mốc kia:

- **Ngày gửi hàng** trực quan nhưng lúc gửi hàng **chưa biết giá**. Hoá đơn hãng về sau 3–6
  tuần. Kỳ cắt theo ngày gửi thì hoặc phải treo mở hàng tuần, hoặc phải phát hành rồi sửa lại.
- **Ngày hoá đơn hãng vận chuyển** MMP **không nhìn thấy** — nên không tự kiểm được.

Mốc này cũng đã là luật đang chạy trong SMS, nên chọn nó thì không phải viết lại gì.

### (b) Duty đi kỳ RIÊNG, mốc riêng

Giữ nguyên như hiện nay: bảng kê `type: "duty"` tách khỏi bảng kê cước, mốc kỳ là **ngày đẩy
`order.duty_charged` thành công lần đầu**.

Lý do: hoá đơn thuế của hãng về sau hoá đơn cước 3–6 tuần. Ép chung một kỳ thì hoặc kỳ cước
phải chờ thuế, hoặc thuế phải hồi tố vào kỳ đã chốt. Cả hai đều tệ hơn việc thu làm hai lần.

Một đơn xuất hiện ở hai bảng kê, hai thời điểm. **Tổng brand phải trả cho đơn đó = dòng ở kê
cước + dòng ở kê duty.**

### (c) MEAN phát hành, MMP xác nhận

- **Ngày 5 hàng tháng**, MEAN phát hành bảng kê kỳ tháng trước và bắn `statement.issued`.
- MMP đối chiếu với phần tích luỹ của mình, **xác nhận hoặc phản hồi trong 3 ngày làm việc**.
- Quá hạn không phản hồi thì coi như khớp.

Vì sao MEAN phát hành: **MEAN là bên cầm hoá đơn hãng vận chuyển** — nguồn duy nhất của con
số. MMP không nhìn thấy hoá đơn nên không thể là bên dựng số trước.

### (d) Sau khi chốt: KHÔNG mở lại kỳ cũ — phát hành DÒNG ĐIỀU CHỈNH ở kỳ sau

Đây là phần MEAN đề nghị thêm mới, vì hiện nay **chưa bên nào định nghĩa**.

Hôm nay SMS đóng băng bảng kê đã phát hành. Nghĩa là một đơn được sửa giá sau khi kỳ chốt thì
**bảng kê không đổi, nhưng `order.reconciled` vẫn bắn giá mới**. Hai kênh nói hai số khác nhau
và không kênh nào sai — chúng chỉ trả lời hai câu hỏi khác nhau.

Đề xuất:

1. Kỳ đã phát hành **đứng yên vĩnh viễn**. Không sửa, không phát hành lại.
2. Giá đổi sau khi chốt → **một dòng điều chỉnh trong kỳ kế tiếp**, có `adjustsStatementId` và
   `orderCode` trỏ về dòng gốc, tiền là **phần chênh** (âm hoặc dương).
3. `order.reconciled` bắn sau khi kỳ đã chốt sẽ **kèm `statementId` của kỳ gốc**, để MMP biết
   nó đang sửa dòng nào chứ không phải một khoản mới.

Như vậy mỗi kỳ chỉ có một con số duy nhất từ đầu tới cuối, và mọi thay đổi đều có đường đi
nhìn thấy được.

### (e) Cả hai bên chạy cùng một phép kiểm

> Mọi đơn trong một bảng kê phải có **mốc kỳ nằm trong chính kỳ đó**.

Phép kiểm này đơn giản nhưng hiện **không bên nào chạy**. Đo hôm nay trên SMS: **9 đơn** không
thoả — 4 đơn là do chép từ MMP (đúng luật MMP, khác luật SMS), 5 đơn còn lại nằm trong bản
nháp và đang được soi.

Nó bắt đúng loại lỗi mà kiểm tổng không bắt được: tổng vẫn khớp, chỉ là khớp với một tập đơn
đã bị xếp nhầm kỳ.

## 4. Hiện trạng SMS, để MMP đối chiếu

| Kỳ | Loại | Trạng thái | Đơn | Tiền | Nguồn |
|---|---|---|---|---|---|
| 07/2026 | cước | đã phát hành | 12 | 19.972.951đ | chép từ MMP |
| 08/2026 | cước | đã phát hành | 30 | 69.049.655đ | chép từ MMP |
| 08/2026 | duty | đã phát hành | 23 | 12.746.333đ | chép từ MMP |
| 09/2026 | cước | **nháp** | 74 | 149.541.818đ | SMS tự cắt |
| 09/2026 | duty | **nháp** | 50 | 33.787.481đ | SMS tự cắt |

Kỳ 09 còn **nháp** — số chưa cố định, chưa gửi. MEAN đề nghị kỳ 09 là kỳ đầu tiên chạy theo
luật chốt này.

Ngoài ra còn **2 đơn đã chốt giá mà chưa vào kỳ nào** (kalisa 1.415.017đ, lekieu 1.712.472đ) —
sẽ rơi vào kỳ kế tiếp theo đúng mốc của chúng.

## 5. MEAN cần MMP trả lời

1. **Mốc kỳ hiện tại của MMP là gì?** MEAN quan sát thấy 4 đơn trên đều có một lần cập nhật
   giá trong tháng 8, nên phỏng đoán MMP dùng **lần cập nhật gần nhất tính tới lúc chốt kỳ**.
   Đây chỉ là phỏng đoán từ dữ liệu — mong MMP xác nhận hoặc nói lại cho đúng.
2. **MMP chốt kỳ vào ngày nào** và có ràng buộc kế toán nào bắt kỳ phải đóng trước ngày đó không?
3. **Có chấp nhận dòng điều chỉnh ở kỳ sau** thay vì mở lại kỳ đã chốt không? Nếu hệ thống MMP
   bắt buộc phải sửa tại chỗ thì MEAN cần biết để thiết kế khác.
4. **Bốn đơn 13.532.293đ** — giữ nguyên ở kỳ tháng 8 như MMP đã chốt (MEAN đề nghị giữ, vì hai
   kỳ đó đã phát hành và đã được thu), hay xử lý bằng dòng điều chỉnh?

## 6. Nếu chốt được thì MEAN sẽ làm gì

- Thêm phép kiểm ở mục (e) vào lượt phát hành: có đơn lệch kỳ thì **chặn phát hành**, không
  cảnh báo suông.
- Thêm loại bảng kê `adjustment` kèm `adjustsStatementId`.
- Thêm `statementId` vào `order.reconciled` khi đơn đã thuộc một kỳ đã phát hành.
- File đối soát Google Sheet gửi MMP sẽ sinh thẳng từ bảng kê, **mỗi kỳ một sheet**, tổng sheet
  bằng đúng tổng bảng kê — từ đó không còn bước đối chiếu tay nào.
