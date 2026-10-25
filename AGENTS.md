<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- Phần dưới do người viết, KHÔNG thuộc khối nextjs-agent-rules ở trên. -->

# Quy trình agent cho repo này

> Luật CHUNG (chọn model, soát toàn nhánh có điều kiện, đột biến thay reviewer,
> trần vòng lặp) nằm ở `~/.claude/CLAUDE.md` mục *"Spend tokens where a mistake is
> expensive"* — chốt 25/10/2026, áp cho **mọi** project. Tệp này chỉ ghi phần
> **riêng của repo này**: số đo, và danh sách đường dẫn cụ thể.

## Số đo dẫn tới luật (25/10/2026)

| | |
|---|---|
| Full suite + `tsc` | **23,65 giây** · 5.729 test · 531 tệp |
| Token subagent trong MỘT phiên | **≈977.607** (4 agent: 373.766 · 240.378 · 187.793 · 175.670 — 3 chạy opus) |
| Hạn mức phụ tài khoản khi đo | **32,53 / 30,00 USD — cạn, đã bị tắt** |

Vòng test rẻ gần như miễn phí; chỗ tốn là **dispatch**. Và `~/.claude/agents/` trống
nên model vốn do ai dispatch thì người đó tự chọn — ba agent chạy opus là **mặc định
thừa hưởng**, không phải quyết định.

**Bằng chứng cho tầng rẻ:** lượt gác 22 hàm + viết test + chạy 8 đột biến chạy
**sonnet**, **187.793 token**, và qua được soát độc lập của controller.

## Mặt PHẢI soát toàn nhánh (cụ thể hoá §3 của luật chung)

- Danh sách **CODEOWNERS** đã có: `lib/shopify` · `lib/crypto` · `lib/auth` ·
  `db/schema.ts`. Dùng lại nó làm định nghĩa "nguy hiểm" — đã được duyệt, và một
  nguồn sự thật tốt hơn hai.
- `db/migrations/**` — migration repo này **áp TAY** (`npm run db:migrate` in thành
  công mà **không làm gì**; xem `db/migrations/README.md`).
- Thêm/bớt chỉ thị `'use server'`, hoặc đổi một lời gọi `requirePerm` /
  `hasPermission` / `can(`.
- Tiền: `features/carrier-rates/ap/**` · `features/cogs/**` · `features/ship-ho/pnl*`.
- Ghi **ra ngoài công ty**: `lib/shopify/writer.ts` · `features/mmp/order-outbound*` ·
  mọi đường đẩy lên Lark/Drive/email.

## `npm run build` chạy khi nào

Chỉ khi diff chạm: chỉ thị `'use server'` · `app/**` (route/layout/page) ·
`middleware.ts` · `next.config*` · phụ thuộc trong `package.json`.

**Vì sao bắt buộc cho lớp đó:** đo thật 25/10/2026 — bỏ `'use server'` khỏi 3 tệp thì
`tsc` **xanh**, và chỉ `next build` chứng minh được **18 endpoint đã mất** (mã action
423 → 405). `tsc` không nhìn thấy tầng này.

## Hai bẫy riêng của repo này khi viết test cổng quyền

- **vitest chỉ bắt `.test.ts`, KHÔNG bắt `.test.tsx`** — đặt test cổng vào `.ts`.
- **`vi.mock` được kéo lên đầu tệp**, nên factory chạy trước khi một `const` kịp khởi
  tạo. Dùng khai báo `function` cho hàm "chạm là ném", và dựng Proxy `schema` ngay
  trong factory. Biến đếm thì an toàn vì chỉ bị đọc/ghi lúc hàm được gọi.
