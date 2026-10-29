# Lịch sử báo lỗi cho nhân sự — thiết kế

**Ngày:** 2026-10-30 · **Chốt với:** CEO Lê Minh Tiệp · **Trạng thái:** CEO ĐÃ DUYỆT (30/10/2026)

## 1. Vì sao làm

Nhân sự gửi báo lỗi qua nút "Báo lỗi" ở header (mọi trang, mọi người đăng nhập đều gửi được),
rồi **không bao giờ biết chuyện gì xảy ra với nó**. Hệ thống có đủ dữ liệu để trả lời — trạng
thái, ghi chú xử lý, dòng thời gian — nhưng chỉ `/admin/issues` đọc được, và màn đó đòi quyền
`manage_users` nên **duy nhất 1 trong 9 người** vào được.

Ca thật, đo 29/10/2026: BL-2 của Minh Tú được đóng kèm một ghi chú **1.069 ký tự** viết riêng cho
Tú — có cả câu *"Tú không cần làm gì thêm"* và *"đây là lỗi hệ thống, Tú không làm sai bước nào"*.
**Tú không có cách nào đọc nó trong hệ thống.** Ghi chú viết cho một người mà người đó không với
tới được là công viết ra rồi bỏ.

Hệ quả thứ hai: đội logistics 2 người thường gặp đúng một lỗi. Không thấy được lỗi đồng nghiệp đã
báo thì họ báo trùng, và không ai biết việc đã xong.

## 2. Mục tiêu

1. Nhân sự xem được **mọi báo lỗi thuộc phạm vi công việc của mình** — không chỉ lỗi họ tự báo —
   kèm trạng thái: xong, đang xử lý, còn treo, cần người quyết, không phải lỗi.
2. Bấm vào một lỗi thì **mở modal** nói rõ: lỗi ở đâu (module, trang, mô tả, ảnh), đã xử lý thế
   nào (ghi chú xử lý, thời điểm, PR), và dòng thời gian đầy đủ.
3. **Admin và Operation Coordinator (`OC`) xem được hết**, mọi bộ phận.
4. Lối vào ngay tại nút "Báo lỗi" đang có, **lọc sẵn theo màn đang đứng** — để người đang làm biết
   "lỗi màn này ai báo chưa, sửa chưa" mà không rời màn.
5. Có **trang xem rộng** để xem chéo mọi module và **gửi được link tới một lỗi cụ thể**.

## 3. Không làm (non-goals)

- Không đổi ai được **gửi** báo lỗi (đang là mọi người, giữ nguyên).
- Không đụng `/admin/issues`. Màn admin giữ nguyên, kể cả nút đổi trạng thái.
- Không sửa lỗi **đóng cứng người thực hiện** ở `PATCH /api/issues` (xem §7). Ghi lại thành hạn
  chế đã biết.
- Không thêm cột bộ phận vào `user`, không dựng bảng ánh xạ module → bộ phận.
- Không thông báo (email / Lark / toast khi lỗi được đóng). Người dùng tự vào xem.
- Không cho nhân sự đổi trạng thái, thêm ghi chú, hay bình luận. **Chỉ đọc.**

## 4. Thất bại dù chạy được (anti-goals)

- **Nhân sự đọc dòng thời gian rồi tưởng bot làm việc mà người làm.** Hiện 3/5 sự kiện đứng tên
  `tác vụ tự động` kể cả lượt CEO tự tay sửa. Màn này **không được** khẳng định một người nào đó
  đã làm khi dữ liệu không nói thế.
- **Nhân sự thấy lỗi của màn họ không mở được** — tức đọc việc của bộ phận khác.
- **Thêm một mục vào menu chính.** Đó đúng là hình CEO đã bỏ ở Nhật ký (`lib/nav.ts`: *"trong từng
  module sẽ đều có 1 tab nhật kí hoặc button ở cùng 1 vị trí… chứ không tách thành 1 phần riêng"*).
- **Ghi chú xử lý viết bằng tiếng kỹ thuật** (`job_runs`, số migration, đường dẫn tệp) rồi đưa
  nguyên cho nhân sự đọc. Hai ghi chú hiện có đều đã viết cho người báo — giữ chuẩn đó.
- Panel mở ra làm mất bộ lọc / vị trí cuộn của màn đang xem.

## 5. Ràng buộc

- Next.js 16.2.6, React 19.2.4, Tailwind 4, bắt buộc chạy đúng cả light và dark mode.
- Drizzle + Postgres. **Không migration nào**: `issue_reports` và `issue_report_events` đã đủ cột
  (xem §6.1). Khoá quyền là **chuỗi có kiểm**, không phải enum — `/admin/roles` tự nhận khoá mới,
  nên CEO tự cấp quyền trên giao diện.
- `ACTIONS` trong `lib/auth/permissions.ts` là **tập đóng** (`view, create, edit, delete, apply,
  push, override`). Không được thêm action mới ⇒ "xem hết" phải là **phạm vi con**, không phải
  action mới.
- vitest 4 **chỉ bắt `.test.ts`, KHÔNG bắt `.test.tsx`** — logic phạm vi phải nằm trong `.ts`.
- `vi.mock` được kéo lên đầu tệp; dùng khai báo `function` cho hàm "chạm là ném".
- `NutBaoLoi` **không nhận prop vị trí / className** — cố ý, để nút ở cùng một chỗ trên mọi module.
  Giữ nguyên tính chất đó.
- Khuôn header module: tiêu đề bên trái, nhóm nút bên phải, nút Nhật ký là phần tử **cuối**.
- `npm run build` **bắt buộc** cho việc này: diff chạm `app/**` (route mới) và chỉ thị `'use server'`.

## 6. Cách làm

### 6.0 Các cách đã cân, và cách đã chọn

| | Cách | Đánh đổi |
|---|---|---|
| **A** ✅ | Tab "Lịch sử" trong panel Báo lỗi đã có (lọc sẵn theo màn đang đứng) **+** trang rộng `/f/bao-loi`. Modal chi tiết mở từ cả hai. | Tốn nhất trong ba. Đúng khuôn Nhật ký, và panel lọc sẵn theo màn trả lời ngay câu chặn báo trùng. |
| B | Chỉ trang `/f/bao-loi`. | Gọn nhất, nhưng bắt người ta rời màn đang làm rồi tự chọn lại module — **đúng cái hình CEO đã bỏ** ở Nhật ký. |
| C | Chỉ panel, không trang. | Không gửi được link cho nhau, không xem chéo được — mà "logs fix lỗi tổng thể" CEO yêu cầu thì cần xem chéo. |

**CEO chọn A** (30/10/2026).

### 6.1 Dữ liệu — đã có đủ, không migration

`issue_reports`: `so` (⇒ `BL-n`), `module`, `pagePath`, `title`, `description`, `mucDo`,
`trangThai`, `reporterId` → `user.id`, `reporterEmail`, `anh` (jsonb), `ghiChuXuLy`, `prUrl`,
`xuLyLanCuoi`, `createdAt`.

`issue_report_events`: `issueId`, `luc`, `nguoi`, `loai` (`tao` | `doi_trang_thai` | `ghi_chu` |
`pr`), `tuTrangThai`, `denTrangThai`, `ghiChu`, `prUrl`. Chỉ thêm, không sửa dòng cũ.

Hàm đã có, dùng lại: `danhSachBaoLoi`, `suKienCuaCacBaoLoi`, `demTheoTrangThai`
(`features/issue-report/queries.ts`); `maBaoLoi`, `nhanModule`, `nhanMucDo`, `nhanTrangThai`,
`TRANG_THAI`, `moduleTuDuongDan` (`features/issue-report/phan-loai.ts`).

### 6.2 Luật phạm vi — "đọc được lỗi của màn mình mở được"

**Quyết định cốt lõi (CEO 29/10/2026).** Không hỏi "người này thuộc bộ phận nào" mà hỏi "người này
mở được màn nào".

Lý do chọn luật này thay vì chặn theo `app_roles.bo_phan`: đo thật 29/10, trong 5 vai trò **chỉ
`logistics` có bộ phận** (`DISCO-LOG`); `admin`, `OC`, `operator`, `viewer` đều để trống. `operator`
đang có **5 người** và là rổ chung nhiều việc, nên gán nó vào một bộ phận là sai. Luật theo quyền
**tự đúng** khi thêm người hoặc đổi quyền, không ai phải bảo trì bảng ánh xạ.

Cách suy, thuần, không I/O:

1. `NAV` trong `lib/nav.ts` đã map `href` → `requires` (một hoặc nhiều `Permission`, nghĩa OR).
2. `moduleTuDuongDan(href)` cho mã module của chính `href` đó.
3. ⇒ dựng được `module → Permission[]`. Một module có thể nhận nhiều quyền (ví dụ `ship-report`
   nhận cả `view_carrier_rates` và `view_kpi_logistics` vì NAV có hai mục trỏ vào nó) — **OR**.
4. Người đọc thấy một báo lỗi khi: có `bao_loi.tat_ca:view`, **hoặc** có ít nhất một quyền trong
   danh sách của `module` của báo lỗi đó.
5. Nguồn quyền là **`NAV` VÀ `SETTINGS_ITEMS`** — cả hai, không chỉ `NAV`.
6. Mục có **`requires: null`** thì **không dựng quyền nào** cho module của nó ⇒ module đó rơi về
   nhóm chỉ-`tat_ca`.
7. Module không rút được quyền nào từ hai danh sách trên: chỉ người có `bao_loi.tat_ca:view`.
   **Fail-closed.**

> **Hai chỗ bản nháp đầu viết SAI, người soát bắt được, đã kiểm lại bằng mã (30/10/2026):**
>
> - Bản nháp liệt `settings` và `khac` vào nhóm "không có mục nào trong `NAV`". **Sai**: `NAV` có
>   `{ href: '/settings', requires: null }` (dòng 84) và `{ href: '/', requires: null }` (dòng 51),
>   mà `moduleTuDuongDan('/settings')` ra `settings` còn `moduleTuDuongDan('/')` ra `khac`. Dựng
>   quyền ngây thơ theo bước 1–3 thì `canSeeNavItem` trả `true` cho `null` ⇒ **hai module này thành
>   "ai cũng thấy"**, phá đúng ý fail-closed. Vì vậy mới có bước 6.
> - Bản nháp nói 6 module kia "không có quyền nào để suy ra chủ sở hữu". **Sai**: `SETTINGS_ITEMS`
>   khai quyền cho cả sáu — `stores`→`manage_stores`, `settings-sync`→`run_feature`,
>   `markets`→`view_markets_history`, `jobs`→`view_functions`,
>   `can-san-pham`→`view_kpi_logistics`, `admin`→`manage_users`.

Chỗ sai thứ hai **quan trọng về nghiệp vụ**, không chỉ về kỹ thuật: `can-san-pham` cần
`view_kpi_logistics` — đúng 2 người logistics, chính những người tài liệu này nói hay báo trùng.
Fail-closed ở đó là **giấu lỗi của màn họ dùng khỏi chính họ**, trái luật CEO đã chốt. Nên lấy
quyền từ `SETTINGS_ITEMS` mới là bản thi hành trung thực của luật đó.

Sau khi vá, nhóm **chỉ-`tat_ca`** còn lại đúng: `settings` · `nhat-ky` · `khac`.

Hệ quả đã biết và chấp nhận: nhân sự logistics chỉ mở được tab KPI của Báo cáo ship vẫn thấy báo
lỗi của cả module `ship-report`. Cùng module, chấp nhận; ghi ra để không ai tưởng là lỗi.

### 6.2b Người báo LUÔN thấy báo lỗi của chính mình

Ngoài luật phạm vi trên, một báo lỗi còn hiện khi `reporterId` là chính người đọc — **bất kể
module**.

Lý do: yêu cầu gốc của CEO là *"chỗ cho nhân sự xem lại lịch sử báo lỗi **của họ**"*; luật bộ phận
là phần **mở rộng** thêm, không phải phần thay thế. Và không có nhánh này thì tái hiện đúng thất
bại ở §1: `guiBaoLoi` lưu `module` theo **ô chọn tay** của người báo, nên ai gửi từ Dashboard
(module `khac`) hay tự chọn `admin`/`jobs` sẽ **không đọc được chính báo lỗi mình vừa gửi**.

Nhánh này phải có ở **cả bốn chỗ**: câu truy vấn danh sách, kiểm `?bl=`, route ảnh, và bộ test.

### 6.3 Quyền

Thêm vào `CATALOG` (`lib/auth/permissions.ts`) — **hai phạm vi, mỗi phạm vi một action `view`**,
vì `ACTIONS` là tập đóng:

- `bao_loi` → `bao_loi:view` — "Xem báo lỗi của các màn mình mở được". Cấp cho **mọi vai trò**,
  cùng khuôn `nhat_ky:view` (quyền riêng để sau siết được một vai mà không phải sửa mã).
- `bao_loi.tat_ca` → `bao_loi.tat_ca:view` — "Xem báo lỗi của MỌI bộ phận". Cấp cho **`admin` và
  `OC`**.

Khai `nhanHanhDong` cho cả hai (lưới `/admin/roles` là module × action nên không có nhãn thì ô
hiện ra vô nghĩa — đúng lỗi CEO đã báo 24/10/2026).

**Cấp quyền — khai trong MÃ, rồi chạy một lượt seed.** Bản nháp đầu nói "cấp trên `/admin/roles`,
không bằng migration" đồng thời nói "cùng khuôn `nhat_ky:view`" — **hai câu đó đá nhau**, người soát
bắt đúng. Đã kiểm mã, cách đúng là:

- `bao_loi:view` → thêm vào `QUYEN_MOI_VAI_TRO` (`lib/auth/permission-map.ts`, hiện đang là
  `['nhat_ky:view']`). `seedRoles()` cấp danh sách này cho **mọi dòng `app_roles`**, kể cả vai cấp
  tay như `OC`.
- `bao_loi.tat_ca:view` → thêm vào `QUYEN_THEO_VAI_NGOAI_HAT_GIONG.OC`. Vai `admin` **tự có** vì
  hạt giống của nó là `allPermissionKeys()`.
- Production cần **một lượt `npm run db:seed-roles`**. `seedRoles()` là **THÊM-KHÔNG-XOÁ**
  (`onConflictDoNothing`, có chú thích tại chỗ về lỗi "quyền bị reset" ngày trước), nên chạy lại
  bao nhiêu lần cũng không đụng quyền đã cấp tay. Script **không** tự chạy khi deploy: `build` chỉ
  là `next build`, `prebuild`/`postinstall` chỉ copy flags.
- Phải sửa `lib/auth/permission-map.test.ts` — test đó kiểm nội dung `QUYEN_MOI_VAI_TRO`.

**Không có lượt seed đó thì tab "Lịch sử" vô hình với tất cả mọi người.** Đây là bước triển khai
bắt buộc, không phải việc tuỳ chọn.

### 6.4 Lối vào 1 — tab trong panel Báo lỗi

`NutBaoLoi` thành hai tab trong cùng `Sheet`:

- **"Báo lỗi"** — nguyên form hiện tại, không đổi gì.
- **"Lịch sử"** — danh sách báo lỗi **của module đang xem** (suy từ `usePathname`, cùng
  `moduleTuDuongDan` mà form đang dùng), mới nhất trước, trong phạm vi người đọc.

Mỗi dòng: mã `BL-n` · tiêu đề · chip trạng thái · người báo · thời điểm. Bấm dòng → modal (§6.6).

Cuối tab có liên kết **"Xem đầy đủ"** sang `/f/bao-loi`, đúng khuôn panel Nhật ký.

Không có quyền `bao_loi:view` ⇒ **không hiện tab "Lịch sử"**, form gửi lỗi vẫn chạy bình thường.
Tab này sống bên trong panel của mọi module nên **không được ném** khi thiếu quyền — nói một câu
rồi thôi, theo đúng khuôn `TabLichSu`.

### 6.5 Lối vào 2 — trang rộng `/f/bao-loi`

Gác bằng `bao_loi:view`. **KHÔNG thêm mục vào `NAV`** (anti-goal §4); vào từ liên kết "Xem đầy đủ"
trong panel, và từ link người khác gửi.

Có: ô đếm theo trạng thái (dùng được làm bộ lọc), bộ lọc trạng thái + module (chỉ liệt kê module
người đọc thấy được), danh sách mới nhất trước. Người có `bao_loi.tat_ca:view` thấy thêm nhãn bộ
phận/module của mọi dòng.

**`?bl=<so>` mở thẳng modal** của báo lỗi đó — để gửi link cho nhau. Số không thuộc phạm vi người
đọc ⇒ nói "không tìm thấy", **không** nói "không có quyền" (đừng tiết lộ là nó tồn tại).

### 6.6 Modal chi tiết

Một `Dialog`, dùng ở cả hai lối vào:

1. **Đầu:** `BL-n` · tiêu đề · chip module · chip mức độ · chip trạng thái.
2. **Lỗi ở đâu:** mô tả của người báo (giữ `whitespace-pre-wrap`), ảnh đính kèm, liên kết tới
   `pagePath`, người báo, thời điểm gửi.
3. **Đã xử lý thế nào:** hộp nổi bật chứa `ghiChuXuLy` + `xuLyLanCuoi`; link PR chỉ hiện khi khớp
   `^https://`. Chưa có ghi chú ⇒ câu theo trạng thái, ví dụ `moi` → *"Chưa ai xử lý. Tác vụ tự
   động chạy mỗi đêm khoảng 1:41."*
4. **Dòng thời gian:** mới nhất **cuối** (kể theo thứ tự thời gian), mỗi dòng: thời điểm · người ·
   chuyển trạng thái · ghi chú.
   - Dòng có `nguoi = 'tác vụ tự động'` ghi là **"ghi qua đường tự động"**, KHÔNG ghi "Hệ thống
     tự động". Người soát chỉ ra đúng: nhãn "Hệ thống tự động" **khẳng định** bot đã làm, mà §7
     nói rõ vài dòng như thế thực ra do người làm tay — tức nhãn đó tạo ra chính sự hiểu lầm mà
     anti-goal §4 cấm. "Qua đường tự động" chỉ nói **đường ghi**, đúng với dữ liệu đang có.
   - Cuối dòng thời gian có một câu: *"Đường tự động không ghi lại ai thực hiện."*
   - Dòng của người thật: hiện **`user.name`**, thiếu thì mới hiện email. `issue_report_events.nguoi`
     lưu email, nên tra `user` theo email để lấy tên — không rải email đồng nghiệp ra màn hình.

Ảnh đi qua route mới `/f/bao-loi/[id]/anh/[n]` gác bằng **cùng luật phạm vi** — không dùng lại
route `/admin/issues/[id]/anh/[n]` (route đó gác bằng `manage_users`).

## 7. Hạn chế đã biết, cố ý không sửa trong việc này

`PATCH /api/issues` (đường không session, cho tác vụ cloud) **đóng cứng** người thực hiện là
`'tác vụ tự động'` (`NGUOI_TU_DONG`). Nên lượt một người tự tay đổi trạng thái qua đường đó vẫn
đứng tên bot: 3/5 sự kiện hiện có là vậy. Sửa đúng là cho đường API mang danh tính khi có — **việc
khác, không gộp vào đây**. Màn này chỉ có trách nhiệm **không nói sai**: dòng bot ghi là "Hệ thống
tự động".

## 8. Để người làm tự quyết

- Chọn component `Dialog` / `Tabs` cụ thể trong `components/ui`.
- Bảng hay danh sách thẻ ở trang rộng; số dòng mỗi trang và cách phân trang.
- Chữ cho các ô trống, thứ tự chip, màu chip theo trạng thái (miễn là đạt tương phản 4.5:1 ở cả
  hai theme).
- Có cache `demTheoTrangThai` theo phạm vi hay không.

## 9. Phải có test (vitest, `.ts`)

Logic phạm vi là **cổng quyền**, nên test là bắt buộc, và phải có ca **chặn**:

1. `module → Permission[]` dựng đúng từ `NAV`; module có hai mục NAV ⇒ nhận cả hai quyền.
2. Người có `bao_loi.tat_ca:view` thấy **mọi** module, kể cả `khac` và module không có trong `NAV`.
3. Người chỉ có `bao_loi:view` + quyền của một màn ⇒ **KHÔNG** thấy module khác. Ca chặn.
4. Module không có mục NAV và nhóm `khac` ⇒ chỉ người có `bao_loi.tat_ca:view`. Fail-closed.
5. Không có `bao_loi:view` ⇒ không thấy gì, và **không ném**.
6. Phân nhóm "xong" (`da_xong`, `tu_choi`) vs "còn treo" (bốn trạng thái còn lại).
7. Mục `requires: null` ⇒ **không** dựng quyền; `settings` và `khac` **không** thành "ai cũng thấy".
   Ca chặn cho đúng lỗi §6.2 đã bắt.
8. Quyền rút được từ **`SETTINGS_ITEMS`**: người có `view_kpi_logistics` thấy module `can-san-pham`.
9. Người báo thấy báo lỗi của **chính mình** ở module nằm ngoài phạm vi của họ (ca §6.2b).

Sau khi viết test, chạy **đột biến thật** trên chúng (bỏ ca fail-closed, đảo OR thành AND, bỏ nhánh
`tat_ca`) và báo số đỏ, rồi hoàn nguyên — theo luật `~/.claude/CLAUDE.md`.


## 10. Các chỗ người viết tài liệu tự quyết — CEO soi lại

Người soát độc lập nêu 5 câu; 4 câu giải quyết được mà không cần CEO, ghi lại đây để soi:

1. **Người báo luôn thấy lỗi của mình** (§6.2b) — lấy từ chính yêu cầu gốc *"lịch sử báo lỗi của
   họ"*, không phải suy đoán.
2. **Rút quyền từ cả `SETTINGS_ITEMS`** thay vì fail-closed 6 module (§6.2) — vì fail-closed ở
   `can-san-pham` trái luật CEO đã chốt.
3. **Nhãn "ghi qua đường tự động"** thay cho "Hệ thống tự động" (§6.6) — để không khẳng định điều
   dữ liệu không nói.
4. **Cấp quyền bằng mã + một lượt `db:seed-roles`** (§6.3) — đã kiểm là thêm-không-xoá, an toàn
   chạy lại.
5. **Hiện cả 2 báo lỗi cũ**, không chỉ từ ngày ra mắt — đúng 2 dòng, và cả hai ghi chú đều đã viết
   cho người báo đọc.

**Câu thứ 5 của người soát KHÔNG tự quyết được** — xem §11.

## 11. Ảnh đính kèm — CEO đã chốt: lối (b)

Từ nay báo lỗi **không còn là chuyện riêng giữa người báo và admin**. Mô tả, **ảnh chụp màn hình**
và danh tính người báo sẽ hiện cho **mọi người có quyền vào module đó**.

Ca cụ thể người soát tìm ra: màn **Lãi gộp** cần quyền riêng `orders.cogs:view`, nhưng nó thuộc
module `orders`. Một ảnh chụp màn Lãi gộp đính trong báo lỗi sẽ hiện cho **mọi người có
`view_orders`** — gồm cả vai `viewer`. Nhật ký đã có cơ chế che giá trị nhạy cảm
(`features/nhat-ky/che-gia-tri.ts`); **màn này thì không**.

Ba lối đi:

- **(a) Chấp nhận** — ảnh và mô tả hiện theo quyền module, đổi lại sửa dòng gợi ý trong form thành
  câu cứng rắn hơn (*"ảnh này đồng nghiệp cùng bộ phận sẽ đọc được"*).
- **(b) Ảnh siết hơn chữ** — mô tả hiện theo quyền module, nhưng **ảnh** chỉ người báo và
  `bao_loi.tat_ca:view` xem được.
- **(c) Không đụng ảnh** — chữ hiện, ảnh chỉ hiện ở `/admin/issues` như hiện tại.

**CEO chốt (b) ngày 30/10/2026.** Lý do chọn: ảnh là chỗ lọt dữ liệu ngoài ý muốn, còn chữ thì
người viết biết mình đang viết gì. (b) giữ được gần hết giá trị "xem lỗi màn này đã ai báo chưa"
mà không mở đường lọt số liệu qua ảnh.

### Thi hành lối (b)

- **Chữ** (tiêu đề, mô tả, ghi chú xử lý, dòng thời gian, danh tính người báo): hiện theo luật
  phạm vi §6.2 + §6.2b.
- **Ảnh**: chỉ hiện khi người đọc là **chính người báo** hoặc có **`bao_loi.tat_ca:view`**.
  - Modal: không đủ điều kiện ⇒ thay khung ảnh bằng một câu — *"Báo lỗi này có N ảnh. Chỉ người
    báo và quản lý xem được."* Nói có bao nhiêu ảnh thì được (người cùng bộ phận biết là có bằng
    chứng), nhưng không cho xem.
  - Route `/f/bao-loi/[id]/anh/[n]`: gác bằng **đúng luật ảnh này**, không phải luật chữ. Thiếu
    điều kiện ⇒ **404**, không phải 403 — đừng xác nhận ảnh đó tồn tại cho người không được xem.
- **Dòng gợi ý trong form `NutBaoLoi`** giữ nguyên câu "Che thông tin nhạy cảm trước khi gửi":
  lối (b) đã chặn đường lọt, nên không cần làm người báo e dè thêm.
- Test phải có ca chặn: người **cùng module** mà **không phải người báo** và **không có
  `tat_ca`** ⇒ đọc được chữ, **không** đọc được ảnh, và route ảnh trả 404.
