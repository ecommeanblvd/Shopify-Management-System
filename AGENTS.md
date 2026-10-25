<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- Phần dưới do người viết, KHÔNG thuộc khối nextjs-agent-rules ở trên. -->

# Quy trình agent: model nào cho việc gì, và vòng loop chạy khi nào

> Chốt 25/10/2026 sau khi **đo** chi phí thật, không ước. Mục tiêu: giảm token mà
> **không** hạ cổng an toàn. Luật ở đây **thay thế** mặc định của
> `superpowers:subagent-driven-development` khi hai bên lệch nhau.

## 0. Ba số đo dẫn tới luật này

| Đo được (25/10/2026) | Số |
|---|---|
| Full suite + `tsc` của repo này | **23,65 giây** · 5.729 test · 531 tệp |
| Token subagent trong MỘT phiên | **≈977.607** (4 agent: 373.766 · 240.378 · 187.793 · 175.670) |
| Hạn mức phụ của tài khoản | **32,53 / 30,00 USD — cạn, đã bị tắt** |

**Kết luận dẫn đường:** vòng test **không phải** chỗ tốn — nó rẻ gần như miễn phí.
Chỗ tốn là **số agent được dispatch và model của chúng**. Nên mọi luật tiết kiệm ở
đây nhắm vào *dispatch*, và **không** nhắm vào việc chạy test.

## 1. Model theo loại việc

Luôn **khai model tường minh** khi dispatch. Bỏ trống là thừa hưởng model của phiên
— thường là con đắt nhất, và đó chính là cách token bốc hơi im lặng.

| Loại việc | Model | Căn cứ |
|---|---|---|
| Chép lại (kế hoạch đã có sẵn mã) | rẻ nhất | Chỉ là chép + chạy test |
| Sửa cơ học nhiều tệp, spec rõ | **sonnet** | Đo thật: lượt gác 22 hàm + test + 8 đột biến chạy sonnet, **187.793 token**, và qua được soát độc lập của controller |
| Tích hợp / cần phán đoán, nhiều tệp | sonnet | |
| **auth · quyền · tiền · ghi RA NGOÀI công ty · migration** | **opus** | Sai ở đây tốn hơn mọi khoản token tiết kiệm được |
| Soát theo task, soát lại phạm vi hẹp | sonnet | |
| Soát toàn nhánh cuối | **có điều kiện — xem §2** | |

**Đừng chọn model theo cảm giác "việc này quan trọng".** Chọn theo *sai thì mất gì*:
mất một giờ làm lại thì sonnet; mất tiền, mất dữ liệu, hoặc lọt quyền thì opus.

## 2. Soát toàn nhánh cuối: CÓ ĐIỀU KIỆN, không mặc định

Mặc định **KHÔNG** chạy. Controller tự soát diff. Chỉ dispatch khi nhánh chạm một
trong các mặt dưới đây — và khi chạm thì chạy **opus**, không rút xuống.

**Mặt phải soát (của repo này):**
- Bất cứ thứ gì trong danh sách **CODEOWNERS** đã có: `lib/shopify`, `lib/crypto`,
  `lib/auth`, `db/schema.ts`. Dùng lại danh sách đó làm định nghĩa "nguy hiểm" —
  nó đã được duyệt, và một nguồn sự thật tốt hơn hai.
- `db/migrations/**` (nhớ: migration ở repo này **áp tay**, xem `db/migrations/README.md`).
- Thêm/bớt chỉ thị `'use server'`, hoặc đổi một lời gọi `requirePerm` / `hasPermission`
  / `can(`.
- Tiền: `features/carrier-rates/ap/**`, `features/cogs/**`, `features/ship-ho/pnl*`.
- Ghi **ra ngoài công ty**: `lib/shopify/writer.ts`, `features/mmp/order-outbound*`,
  mọi đường đẩy lên Lark/Drive/email.
- Quy mô: **> 15 tệp** hoặc **> 400 dòng** thay đổi.

**Không chạm mặt nào ở trên:** controller tự soát, cộng **một** lượt soát phạm vi hẹp
bằng sonnet **chỉ trên tập rủi ro nhất** — không soát cả nhánh.

**Lý do:** soát toàn nhánh trên model đắt nhất là khoản chi lớn nhất của một phiên
(đo: 175.670–240.378 token mỗi agent). Với nhánh cơ học nó mua rất ít. Với nhánh chạm
quyền hoặc tiền nó mua nhiều — lượt 24-25/10 người soát bắt được **4 đột biến mà bài
kiểm để lọt** và **một chú thích nói quá**, cả hai controller đều không tự thấy.

## 3. Thay reviewer thứ hai bằng ĐỘT BIẾN — đổi tốt nhất về token

Một lượt đột biến tốn **vài giây chạy test**. Một reviewer tốn **175.000–240.000 token**.

**Luật:** mọi câu khẳng định "test cắn" phải kèm **đột biến chạy THẬT trên mã thật**,
báo số test đỏ, và hoàn nguyên ngay sau mỗi lần. Không có số đỏ thì không được nói
là có hàng rào.

**Và:** khi vòng sửa chỉ xử lý phát hiện Nhỏ, hoặc là thay đổi cơ học, controller tự
soát diff **và chạy một lượt đột biến** thay vì dispatch người soát lại.

**Căn cứ:** 25/10/2026, controller tự khai "hai bài kiểm đã thử đột biến" — đột biến
đã thử là bản **yếu nhất có thể**; người soát chạy 4 hình khác, **cả 4 đều xanh**. Giá
trị của lượt soát đó nằm ở việc **chạy đột biến**, không ở việc đọc. Nên hãy mua đúng
cái đó, bằng giá vài giây.

## 4. Vòng build / test / fix chạy khi nào

| Bước | Khi nào | Vì sao |
|---|---|---|
| Test **có phạm vi** (`vitest run <đường dẫn>`) | trong lúc TDD và mỗi vòng sửa | Nhanh, đủ tín hiệu |
| `tsc --noEmit` + **full suite** | **một lần** trước mỗi commit | 23,65s — rẻ, đừng tiết kiệm |
| `npm run build` | **chỉ khi** diff chạm: chỉ thị `'use server'` · `app/**` (route/layout/page) · `middleware.ts` · `next.config*` · phụ thuộc trong `package.json` | Có thứ `tsc` **không** thấy. Đo thật: bỏ `'use server'` khỏi 3 tệp → `tsc` xanh, nhưng chỉ `next build` chứng minh được 18 endpoint đã mất |
| Hook `pre-push` | tự chạy, **không bỏ** | Cổng cuối, miễn phí về token |

**Trần vòng lặp: 2 vòng sửa.** Sau 2 vòng mà còn phát hiện mở, controller phán quyết
(sửa tại chỗ · ghi lại kèm phán quyết · hỏi CEO nếu nó chịu lực). **Mỗi vòng sửa phải
nói trước mình sẽ đổi gì** — vòng không có phạm vi là vòng không có điểm dừng.

## 5. Mấy chỗ KHÔNG được tiết kiệm

Luật này để giảm token, **không** để giảm cổng. Năm chỗ bất khả xâm phạm:

1. **auth · quyền · tiền · ghi ra ngoài** → luôn đủ cổng, luôn opus, luôn soát.
2. **Migration áp tay**, rồi **xác minh trên CSDL thật** (`npm run db:migrate` in
   thành công mà không làm gì).
3. **`tsc` + full suite trước commit**, và hook `pre-push`. 23 giây.
4. **Không bao giờ bỏ qua: đo trên dữ liệu thật** khi kết luận về production. Phiên
   20-25/10 có **bốn** lần suy luận bị số đo bác lại (ngày Lark lệch 17:00Z · grep
   "176 export" sai phương pháp · thước quyền sai 5/5 · bài kiểm 4/4 đột biến xanh).
5. **Không báo "xong" ở tầng dữ liệu mà chưa xem chỗ người dùng nhìn.** Lỗi lặp của
   phiên này: báo xong quyền "Tạo vận đơn" dựa trên dòng CSDL, trong khi CEO không
   thấy nó trên màn hình.
