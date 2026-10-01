# Chốt kỳ bảng kê ship hộ — SMS trả lời MMP

**Ngày:** 2026-10-01 · **Trả lời:** "Chốt kỳ bảng kê ship hộ — MMP trả lời đề xuất của SMS" (MMP, 01/10/2026) · **Trạng thái:** SMS đã sửa mã và dữ liệu; chờ MMP trả lời 2 câu ở §6.

**Một câu:** SMS nhận **nguyên** đề xuất của MMP (kể cả bỏ chữ "thành công"); **49.739.868đ không hề chưa phát hành** — lỗi nằm ở tài liệu của SMS, không ở hệ thống; và trong lúc kiểm thì SMS tìm ra **luật gán kỳ thật của mình không khớp cả hai tài liệu**, đã sửa, nay kỳ 07 và kỳ 09 khớp sổ MMP **đến từng đồng**.

---

## 1. 49.739.868đ: không mất đồng nào. Lỗi ở tài liệu của SMS

**Cách đọc (1) của MMP đúng.** SMS phát hành **một bảng kê mỗi brand** (`ship_ho_statements.partner_brand_slug`). Bảng §4 trong tài liệu 30/09 của SMS chỉ liệt kê Kalisa — đó là **thiếu sót khi viết tài liệu**, không phải thiếu sót của hệ thống. SMS xin lỗi vì đã làm MMP phải đi truy một khoản không mất.

Bằng chứng, đo trước khi sửa bất cứ thứ gì:

| | MMP đếm | SMS có |
|---|---|---|
| đơn cước của 5 brand ngoài Kalisa | **23** | **23** |
| tiền | 49.739.868đ | 49.214.650đ |

Đúng **23 đơn** cả hai bên. Phần lệch **525.218đ** đã khoanh được về **một đơn duy nhất** — xem §6 câu 1.

**Còn 22 đơn Kalisa / 40.064.267đ chưa gắn bảng kê nào** — cũng không phải tiền mất: cả 22 đơn có `reconcile_status = NULL` và **chưa từng đẩy `order.reconciled`**, tức chưa chốt giá vì chưa có hoá đơn hãng. Chúng bị loại đúng luật và sẽ vào kê ở kỳ chứa mốc khi giá chốt.

---

## 2. Câu 2 của MMP — và đây là chỗ SMS phải tự nhận lỗi nặng hơn

MMP hỏi SMS đang chạy "lần đầu" hay "lần gần nhất". **Cả hai tài liệu đều sai.**

Mã SMS (`features/ship-ho/statement-core.ts`) lọc theo `min(occurred_at)` của `order.reconciled` — tức **lần đầu**, đúng như tài liệu SMS nói. Nhưng mốc đó **chỉ dùng để lọc xem đơn đã chốt giá chưa**. Kỳ mà đơn rơi vào là **THÁNG LÚC CHẠY LỆNH GOM** (`kyThang(now)`, cửa sổ nhặt đơn mở về quá khứ không giới hạn).

Nghĩa là: đơn đẩy tháng 7, lệnh gom chạy tháng 9 → nằm ở **kỳ 9**. Không tài liệu nào của hai bên mô tả đúng việc này.

**Đo trước khi sửa:** 14 đơn / **32.316.966đ** nằm ở kỳ khác kỳ chứa mốc của chúng:

| kỳ kê | brand | đơn | tiền | trạng thái |
|---|---|---|---|---|
| 08 | kalisa | 4 | 13.532.293đ | **đã phát hành** |
| 07 | tom-fried | 2 | 4.411.824đ | nháp |
| 09 | kalisa | 1 | 3.333.719đ | nháp |
| 09–10 | 5 brand | 7 | 11.039.130đ | nháp |

Và chính **phép chiếu chéo mục (e)** mà hai bên vừa thống nhất sẽ **chặn phát hành** — vì SMS tự vi phạm nó.

**Đề nghị với MMP:** luật đúng là **lần ĐẦU** (`min(occurred_at)`). Quyết định MMP sửa ngày 22/09 (chuyển sang "lần gần nhất") dựa trên một hành vi SMS không có — nên **revert về "lần đầu"**. SMS đã sửa phía mình để kỳ của đơn **là kỳ chứa mốc đó**, không còn phụ thuộc lúc chạy lệnh.

---

## 3. Câu 3 — SMS ĐỒNG Ý bỏ chữ "thành công"

Lý lẽ của MMP đúng, và SMS đã bị chính cái lỗi đó cắn: ba đơn `26-INSLG-SV-0957` / `0995` / `0912` kẹt 12 ngày vì 409. Gắn kỳ kế toán vào chất lượng đường truyền thì một cú 409, một lần bảo trì, hay một bug bên nào cũng đẩy doanh thu sang tháng khác **mà không ai sai**.

SMS đã bỏ bộ lọc `delivery_status = 'delivered'` khỏi mốc, ở **cả hai** loại. Đo trước khi đổi:

| | |
|---|---|
| event `order.reconciled` | 332 `delivered` · 6 `failed` |
| đơn có mốc ĐỔI khi bỏ lọc | **3** |
| trong đó **đổi THÁNG** | **0** |
| đơn chưa từng đẩy thành công lần nào | **0** |
| `order.duty_charged` | 76/76 `delivered` → bỏ lọc không đổi gì |

Tức đổi luật này **không dịch đồng nào hôm nay**; nó chỉ chặn trước cho tương lai. SMS nêu con số này để MMP không phải lo về giá của thay đổi.

**Mốc chốt, cả hai loại:** `occurred_at` của lần đẩy **ĐẦU TIÊN** — `order.reconciled` cho cước, `order.duty_charged` cho duty. Không điều kiện "thành công".

---

## 4. SMS đã sửa gì, và kết quả đối chiếu

**Luật gán kỳ.** Đơn vào bảng kê của **kỳ chứa mốc**. Kỳ đã `issued`/`paid` thì không mở lại — đơn đi tới **kỳ đang mở sớm nhất**, giống `assignBillingPeriod` của MMP, nên hai bên xử lý **cùng một cách**.

**Phép chiếu chéo (e): CHẶN phát hành**, không cảnh báo suông, và báo **mã đơn** chứ không báo số đếm.

**Đã xếp lại 15 đơn trên bản NHÁP.** Không đụng bản đã phát hành.

Kết quả — **cước**:

| kỳ | | MMP | SMS sau khi sửa | |
|---|---|---|---|---|
| 07 | Kalisa | 12 · 19.972.951đ | 12 · 19.972.951đ | ✅ |
| 07 | 2 brand kia | 2 · 4.427.688đ | **2 · 4.427.688đ** | ✅ |
| 08 | Kalisa | 30 · 69.049.655đ | 30 · 69.049.655đ | ✅ |
| 08 | brand khác | 4 · 11.533.143đ | 5 · 16.751.470đ | ❌ §6.1 |
| 09 | Kalisa | 75 · 150.956.835đ | **75 · 150.956.835đ** | ✅ |
| 09 | brand khác | 17 · 33.779.037đ | 16 · 28.035.492đ | ❌ §6.1 |

Kỳ 09 Kalisa trước khi sửa là **74 đơn / 149.541.818đ** — chính "lệch 1 đơn" MMP nêu ở cuối tài liệu. Nó tự khỏi khi luật gán kỳ đúng, **không cần sửa đơn nào bằng tay**.

**Duty — tổng hai bên GIỐNG NHAU ĐẾN TỪNG ĐỒNG:**

| kỳ | MMP | SMS |
|---|---|---|
| 08 | 24 · 14.174.075đ | 23 · 12.746.333đ |
| 09 | 52 · 35.400.854đ | 53 · 36.828.596đ |
| **Σ** | **49.574.929đ** | **49.574.929đ** |

Lệch đúng **một đơn, 1.427.742đ**, nằm khác kỳ — xem §6 câu 2.

---

## 5. Trả lời ba câu của MMP, gọn

| Câu | Trả lời |
|---|---|
| **1. Bảng kê SMS có bao đủ 6 brand?** | **CÓ** — một bảng kê mỗi brand. 49.739.868đ đã nằm trên 8 bản kê của 5 brand đó, **không có khoản nào chưa phát hành**. Bảng §4 tài liệu 30/09 của SMS viết thiếu |
| **2. SMS chạy "lần đầu" hay "lần gần nhất"?** | **Lần ĐẦU** — nhưng mốc đó trước nay chỉ dùng để LỌC; kỳ thật lấy theo tháng chạy lệnh gom. **Đã sửa.** Đề nghị MMP revert quyết định 22/09 về "lần đầu" |
| **3. Bỏ chữ "thành công"?** | **ĐỒNG Ý**, đã bỏ ở cả hai loại. Đo: 0 đơn đổi tháng hôm nay |

Và bốn mục còn lại của đề xuất, SMS xác nhận giữ nguyên như MMP đã đồng ý: (b) duty kỳ riêng mốc riêng · (c) MEAN phát hành ngày 5, MMP xác nhận trong 3 ngày · (d) không mở lại kỳ cũ · (e) cả hai bên chạy phép chiếu chéo.

**Bốn đơn 13.532.293đ:** SMS đồng ý **giữ nguyên ở kỳ 08**, không mở lại. Script xếp lại của SMS cố ý không đụng bản đã phát hành.

---

## 6. SMS cần MMP trả lời

**1. Đơn `26-INSLG-SV-0032` — kỳ nào, và tiền bao nhiêu?**
SMS xếp **kỳ 08** (mốc `order.reconciled` lần đầu nằm trong tháng 8) với **5.218.327đ**. Suy từ sổ MMP thì đơn này ở **kỳ 09** với **5.743.545đ**.
Suy luận: dời đơn này sang kỳ 09 thì kỳ 08 khớp tuyệt đối (4 đơn / 11.533.143đ), và **toàn bộ** phần lệch 525.218đ gói vào đúng đơn này. Đây là phỏng đoán từ con số — nhờ MMP xác nhận kỳ và số tiền bên mình.

**2. Đơn `26-INSLG-SV-0056` (duty) — vì sao MMP xếp kỳ 08?**
SMS xếp **kỳ 09**: mốc `order.duty_charged` lần đầu nằm trong tháng 9 (tháng hoá đơn FedEx là tháng 8). Theo mốc hai bên vừa chốt thì nó thuộc **kỳ 09**. Nếu bên MMP nó đang ở kỳ 08 vì kỳ đó đã khoá trước khi mốc về, thì đây đúng là ca cần **dòng điều chỉnh** — xem §7.

---

## 7. Một ca mà cả hai bên PHẢI thống nhất trước khi phát hành kỳ 09

Đơn `26-INSLG-SV-0035`: mốc nằm ở **kỳ 08**, mà kỳ 08 của Kalisa **đã phát hành**. Theo luật hai bên vừa chốt, nó rơi vào **kỳ đang mở sớm nhất = kỳ 09**. Nên **bảng kê cước kỳ 09 của Kalisa chứa một đơn có mốc kỳ 08** — và điều đó **hợp lệ**, không phải lỗi.

MMP cần biết vì: nếu phép chiếu chéo phía MMP so thẳng *"mốc có nằm trong cửa sổ kỳ"* thì nó sẽ báo lỗi oan đúng ca này. SMS đã mắc chính lỗi đó: bản đầu của phép kiểm báo đơn này là lỗi, tức sẽ **chặn vĩnh viễn** việc phát hành kỳ 09. Phép kiểm phải hỏi *"luật sẽ đặt đơn này vào kỳ nào"*, không hỏi *"mốc có trong cửa sổ không"*.

Đây cũng chính là chỗ cần **dòng điều chỉnh** mà MMP đã có (`diffPeriod`, `ShipHoPeriodLock`): đơn bị dời nên xuất hiện ở kỳ sau như **dòng điều chỉnh của kỳ 08**, không phải một khoản mới của kỳ 09. SMS **chưa dựng** phần này — hai trường `adjustsStatementId` và `statementId` MMP đã đồng ý nhận vẫn đang nằm trong kế hoạch, chưa có mã. Đề nghị: kỳ 09 phát hành như bảng kê thường, và hai bên chốt cơ chế dòng điều chỉnh **trước kỳ 10**.

---

## 8. Ngoài phạm vi tài liệu này

- Bảng kê **duty kỳ 08** của SMS (23 đơn) dựng dưới luật cũ của SMS (kỳ theo **ngày hoá đơn FedEx**, spec 21/09, bị quyết định 22/09 thay). Nó **đã phát hành** nên SMS không mở lại. Mọi bản từ kỳ 09 trở đi dùng mốc ngày đẩy.
- SMS còn **6 bảng kê nháp RỖNG** sau khi xếp lại (vỏ do luật cũ tạo) — việc dọn nội bộ, không ảnh hưởng số của MMP.
- Hạn xuất hoá đơn GTGT và lịch kế toán: việc của kế toán MEAN, không bàn ở đây.
