# Chốt kỳ bảng kê ship hộ — SMS trả lời MMP (vòng 2)

**Ngày:** 2026-10-01 · **Trả lời:** §9–§12 bản sửa của MMP (`f56209a`) · **Trạng thái:** SMS đã truy xong sự cố 00:04; chờ MMP chốt 1 việc ở §5.

**Một câu:** MMP **đúng** về 525.218đ và **suy luận của SMS sai**; sự cố 00:04 là **lượt đối soát thật** (hoá đơn hãng về, giá hạ, brand trả ÍT hơn) chứ không phải SMS tự sửa số; SMS **đã revert về "lần đầu"** và đã deploy; và phát hiện §10 của MMP là **gốc thật của cả bất đồng** — SMS chứng minh được điều đó bằng một con số khớp tuyệt đối.

---

## 1. Sự cố 00:04 — đã truy ra, và nó là lượt ĐỐI SOÁT THẬT

Ba đơn MMP nêu đều có `order.reconciled` với `occurred_at = 2026-09-30 17:04 UTC` = **01/10 00:04 giờ VN**. Đúng như MMP đo. Nội dung payload của lượt đó:

| Đơn | Brand | Giá BÁO (trước) | Giá THẬT (sau) | Delta | Cân tính cước |
|---|---|---|---|---|---|
| `26-INSLG-SV-0116` | mirer | 1.526.913đ | 1.266.662đ | −260.251đ | 1 kg |
| `26-INSLG-SV-0148` | white-chic | 2.480.405đ | 2.440.120đ | −40.285đ | 4 kg |
| `26-INSLG-SV-0163` | tinh | 985.298đ | 760.616đ | −224.682đ | 0,5 kg |
| | | | | **−525.218đ** | |

**Σ delta = −525.218đ, trùng tuyệt đối con số MMP truy ra.**

Đây **không** phải SMS tự hạ giá. Đó là lượt đối soát: hoá đơn hãng về, cân tính cước chốt, giá thu brand đi từ **giá BÁO** sang **giá THẬT**. Brand trả **ít hơn**, không nhiều hơn. Đó là đúng việc mà `order.reconciled` sinh ra để làm.

**Một chi tiết SMS phải nói rõ vì nó giải thích vì sao sổ MMP giữ số cũ lâu:** lượt đẩy 18/09 của `26-INSLG-SV-0163` mang `previousChargedVnd = finalChargedVnd = 985.298đ`, `deltaVnd = 0` — tức **vẫn là giá BÁO**, chưa có hoá đơn. Sổ MMP giữ giá báo từ 18/09 tới 00:04 ngày 01/10 là đúng với dữ liệu SMS gửi lúc đó, không phải MMP đọc sai.

### Suy luận của SMS ở vòng 1 là SAI

SMS viết: *"suy từ sổ MMP thì đơn `26-INSLG-SV-0032` ở kỳ 09 với 5.743.545đ"*. **MMP chưa bao giờ mang con số đó.** SMS lấy phần dư của một phép trừ rồi gán cho một đơn cụ thể — phần dư đó thực ra là delta đối soát của **ba đơn khác**. Tiền của `0032` khớp từng đồng hai bên: **5.218.327đ**.

Bài học SMS ghi lại: **phần dư của một phép trừ không phải bằng chứng về một bản ghi cụ thể.** Σ khớp hoặc Σ lệch chỉ nói có chuyện gì đó; muốn gọi tên một đơn thì phải tra chính đơn đó.

---

## 2. SMS đã làm xong phía mình

| Việc | Trạng thái |
|---|---|
| Mốc kỳ = `occurred_at` của **lần đẩy ĐẦU**, bỏ chữ "thành công" | **Đã deploy** (`649ac740`) |
| Kỳ của đơn = **kỳ chứa mốc**, không phải tháng chạy lệnh gom | **Đã deploy**; đã xếp lại 15 đơn trên bản nháp |
| Kỳ đã chốt thì đơn đi tới **kỳ đang mở sớm nhất** | Đã có, giống `assignBillingPeriod` |
| Phép chiếu chéo (e) hỏi *"luật sẽ đặt đơn này vào kỳ nào"* | **Đã deploy** (`2ab2a213`) — **CHẶN** phát hành, báo mã đơn |
| Dọn 6 bảng kê nháp rỗng do luật cũ sinh ra | Đã xoá |

Lưu ý với MMP: phép chiếu chéo của SMS so với **luật của SMS**, mà luật đó chỉ biết các kỳ SMS đã `issued` — xem §3, đó chính là chỗ còn hở.

---

## 3. §10 của MMP là GỐC THẬT, và SMS chứng minh được

MMP phát hiện 4 kỳ-brand **đã khoá ở MMP mà vẫn là NHÁP ở SMS**: `lekieu 07`, `tinh 08`, `tom-fried 07`, `tom-fried 08`. SMS xác nhận đúng, kèm số:

| Kỳ-brand | SMS | trạng thái SMS |
|---|---|---|
| lekieu 07 | 1 đơn · 2.194.024đ | nháp |
| tom-fried 07 | 1 đơn · 2.233.664đ | nháp |
| tinh 08 | 1 đơn · 1.250.219đ | nháp |
| tom-fried 08 | 4 đơn · 15.501.251đ | nháp |

**SMS xin sửa lại một câu trong bản trước.** SMS đã viết *"hai bên định nghĩa kỳ đã đóng bằng hai thứ khác nhau"* — **không đúng**. Hai bên cùng một định nghĩa.

Chuyện thật: SMS chỉ biết một kỳ đã đóng **qua lượt NHẬP bản đã chốt của MMP**, và lượt nhập 28/09 **chỉ nhập Kalisa**. Ba bảng kê Kalisa 07/08 mang trạng thái `issued` ở SMS chính vì được nhập từ MMP. Bốn bảng kê còn lại MMP đã khoá thì **chưa bao giờ được nhập**, nên SMS vẫn coi bốn kỳ đó là MỞ và `goBangKeNhap` tiếp tục gom đơn vào.

Nên đây là **lỗ ĐỒNG BỘ, không phải bất đồng về luật** — và nó nguy hơn một bất đồng. Bất đồng thì hai bên biết mà bàn; lỗ này thì im lặng: hôm nay SMS không có đường nào biết MMP đã khoá kỳ nào, và cách duy nhất để biết là **có người nhớ nhập đúng một file cho mỗi brand mỗi kỳ**. Đó là lý do mục 5 là việc gấp, không phải việc cho đẹp.

### Bằng chứng rằng cách của MMP là cách khớp

`26-INSLG-SV-0032` hiện nằm trong bản nháp **tom-fried kỳ 08** của SMS. Nếu nhận khoá của MMP làm chuẩn và **dời đơn này sang kỳ 09**:

```
kỳ 08 ngoài Kalisa, SMS hiện có : 5 đơn · 16.751.470đ
dời 0032 sang kỳ 09            : 4 đơn · 11.533.143đ
MMP công bố kỳ 08              : 4 đơn · 11.533.143đ   ← KHỚP TỪNG ĐỒNG
```

Một phép dời duy nhất, và kỳ 08 khớp tuyệt đối. **SMS đề nghị: nhận bản khoá kỳ của MMP làm nguồn sự thật cho "đã đóng".** Lý do không phải nhường — mà vì nó là mốc duy nhất hai bên **cùng đo được**, và con số trên đã chứng minh nó là cách làm sổ khớp.

---

## 4. `26-INSLG-SV-0056` (duty) — SMS nhận phần của mình

MMP nói SMS đúng, và SMS xác nhận lại: mốc `order.duty_charged` lần đầu là **22/09** → **kỳ 09**. Ngày hoá đơn FedEx 13/08 chỉ dùng để brand tra tờ khai, không dùng chia kỳ.

SMS cũng vừa dọn đúng chỗ đã gây nhập nhằng này: `schema.ts` và `statement-actions.ts` còn ghi *"kỳ duty theo ngày hoá đơn FedEx"* — văn bản spec 21/09 đã bị quyết định 22/09 thay mà không ai xoá. **Đã xoá** (`66a1cef2`). Nó từng làm chính SMS tưởng mình có hai luật kỳ mâu thuẫn.

Vì `tom-fried 08` đã khoá, dòng này cần **dòng điều chỉnh** — mà SMS **chưa dựng**. Xem §6.

---

## 5. SMS cần MMP một việc

**Gửi danh sách kỳ-brand đã khoá, và một đường để SMS đọc được nó về sau.**

Hôm nay SMS biết một kỳ đã đóng CHỈ qua lượt nhập tay bản đã chốt của MMP (xem §3). Không có danh sách đọc được thì `chonKyGom` của SMS vẫn xếp đơn vào kỳ mà MMP coi là đóng mỗi khi ai đó quên nhập một file, và phép chiếu chéo hai bên sẽ báo lỗi ở hai phía khác nhau — đúng cảnh MMP cảnh báo ở §10.

Đề nghị cụ thể: MMP thêm `lockedPeriods` (danh sách `{brandSlug, periodKey, lockedAt}`) vào phản hồi của một endpoint SMS gọi được, hoặc bắn một sự kiện `period.locked` khi khoá. SMS sẽ nhận và dùng nó làm đầu vào cho `chonKyGom` thay cho trạng thái `issued` nội bộ.

---

## 6. Hai việc SMS chưa làm, nói trước để MMP không chờ

1. **Dòng điều chỉnh** (`adjustsStatementId`, `statementId`, loại bảng kê `adjustment`) — SMS **chưa có mã**. Đề nghị: kỳ 09 phát hành như bảng kê thường; hai bên chốt cơ chế này **trước kỳ 10**.
2. **Đọc khoá kỳ của MMP** — chờ §5.

---

## 7. Một nhãn trong payload dễ gây hiểu nhầm, MMP nên biết

`reconcileResolution: "internal_error"` xuất hiện trong **187/338** sự kiện `order.reconciled` (423.095.363đ). Đọc tên thì tưởng SMS gặp lỗi hệ thống. **Không phải.** Nó là nhãn SMS gán khi **người vận hành CHẤP NHẬN phần lệch** (`acceptShipHoDiscrepancy`) — tức phần lệch do báo giá của MEAN, MEAN chịu, đối lập với `claim_credited` / `claim_rejected` (phần lệch do hãng).

SMS giữ nguyên tên để không phá cách MMP đang đọc, nhưng nêu ra vì nửa số sự kiện mang nhãn này: nếu MMP đang đọc nó là "SMS lỗi" thì con số thống kê hai bên sẽ nói hai chuyện khác nhau.

---

## 8. Ngoài phạm vi tài liệu này

- SMS **chưa dời** `26-INSLG-SV-0032` — chờ hai bên chốt §3, vì nó dịch 5.218.327đ giữa hai kỳ (cả hai đều còn nháp bên SMS nên dời được, không mất gì).
- 24 đơn / 42.568.517đ ở SMS chưa gắn bảng kê nào: đều chưa chốt giá (`reconcile_status IS NULL`), đang chờ hoá đơn hãng. Không phải tiền thiếu.
- Bảng kê **duty kỳ 08** của SMS (23 đơn) dựng dưới luật 21/09 và **đã phát hành** — SMS không mở lại.
- Hạn hoá đơn GTGT: việc của kế toán MEAN.
