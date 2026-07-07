# Style Quiz + Product Recommender — Design Spec

**Ngày:** 2026-07-08 · **Trạng thái:** thiết kế (build tự động qua đêm, CEO review sáng)
**Goal:** Khách trên meanblvd/CICI/các store làm 1 quiz nhiều cấp → biết **style phù hợp** (màu + dáng + gu) → hệ thống **gợi ý sản phẩm** hợp từ catalog của chính store đó.

## 0. Lập trường khoa học (BẮT BUỘC phản ánh trong UI)
Nghiên cứu (4 hướng, nguồn ở `scratchpad/research-*.md`) cho thấy phải trung thực về mức độ "khoa học":
- **Sinh lý màu da = khoa học [E]** (melanin/hemoglobin/carotene quyết định undertone + độ sâu).
- **"Mặc màu hợp da thì đẹp hơn" = bằng chứng HẠN CHẾ [E→C]**: chỉ 1 nghiên cứu peer-review (Perrett & Sprengelmeyer, i-Perception 2021) — da sáng hợp màu lạnh, da rám hợp màu ấm (d≈0.53–0.68) — nhưng tác giả nói do **học tập văn hoá, không phải sinh học**, mẫu chỉ nữ da trắng trẻ.
- **Hệ 12-season, dáng người → "luật" = CONVENTION** (image-consulting), KHÔNG validate. Line-theory (thẳng=sắc, cong=mềm; dọc kéo dài) là **curriculum thiết kế có cơ sở tri giác**.
- Kibbe body-typing = pseudo-typology (không validate).
→ **UI copy:** trình bày là **"gợi ý phong cách"**, KHÔNG "khoa học chứng minh"; dùng "màu thường tôn da bạn", "dáng thường hợp bạn"; **không cấm đoán**; với da sâu/không-trắng làm mềm phần "nên tránh". Result screen có 1 dòng "honesty note".

## 1. Hồ sơ 3 trục (orthogonal — 3 câu hỏi khác nhau, kết hợp khi gợi ý)
```
StyleProfile = {
  color:     { season: 12-season, palette: hex[], temperature: warm|cool|neutral, confidence, sisterFallback? }
  body:      { shape: hourglass|pear|apple|rectangle|invertedTriangle, heightMod?, confidence }
  archetype: { primary: 6-archetype, secondary?, keywords: string[], confidence }
}
```
Mỗi trục tính ĐỘC LẬP + có `confidence` (coarse/refined). Recommender kết hợp: **archetype (what to show, weight cao nhất) × color-season (which shade) × body-shape (which fit)** — SCORE không hard-filter (không bao giờ để trống lưới).

## 2. Trục MÀU (chi tiết: `research-color.md`)
3 axis Munsell, mỗi câu trả lời → {-1,0,+1}, trọng số:
- HUE = 0.30·whiteVsCream + 0.25·jewelry + 0.20·eyesHair + 0.15·sun + 0.10·vein (+warm/−cool)
- VALUE = 0.45·skinDepth + 0.35·hairDepth + 0.20·overall (+deep/−light)
- CHROMA = 0.40·vividVsDusty + 0.35·eyesClearSoft + 0.25·contrast (+bright/−soft)
- Bucket ±0.34; dominant=argmax|·| → sub-season. Cây quyết định family→sub-season (12), tie→contrast, neutral+low-conf→sister-pair. Palette hex (12 bộ, [A] approx — designer chỉnh) lưu **bảng config** để merchandiser sửa không cần deploy.

## 3. Trục DÁNG (chi tiết: `research-body.md`)
5 dáng xác định từ tỉ lệ vai:ngực:eo:hông + "tăng cân ở đâu" + độ rõ eo (self-report/ảnh, tuỳ chọn số đo):
- **hourglass** (vai≈hông, eo rõ): tôn eo — wrap/fit-flare/bias, V/scoop/sweetheart, high-waist, vải mềm-có-cấu-trúc; tránh boxy/shift/vải cứng-dày.
- **pear/triangle** (hông>vai): cân bằng lên trên — cổ/vai điểm nhấn, boat/scoop, A-line, tối màu dưới; tránh chi tiết ở hông.
- **apple/round** (eo đầy, chân thon): kéo dài thân — V sâu, empire, skim-not-cling, cột màu đơn sắc, hem cong; tránh cạp cứng bó eo, thắt eo tự nhiên, crop, bó.
- **rectangle/straight** (vai≈eo≈hông, eo ít rõ): tạo đường cong — thắt eo/peplum/chi tiết ngang (bản slim "I"); bản đậm "H" → dọc+cấu-trúc, tránh thắt eo.
- **invertedTriangle** (vai>hông): thêm khối dưới — A-line/full skirt, wide-leg, V/scoop; tránh vai độn, cầu vai, cổ thuyền.
Height modifier (petite/tall, thân/chân dài-ngắn) tinh chỉnh độ dài. Controlled vocab: `neckline∈{v,scoop,jewel,sweetheart,boat,halter,square}`, `silhouette∈{fit-and-flare,wrap,a-line,shift,bodycon,empire,column,peplum,straight}`, `fit∈{fitted,relaxed,structured}`, `feature∈{waist-defining,belted,high-waist,vertical,skim,...}`.

## 4. Trục GU/ARCHETYPE (chi tiết: `research-archetype.md`)
6 archetype (span yin↔yang × relaxed↔tailored): **classic, natural, romantic, dramatic, creative, edgy**. Ma trận 8 câu, mỗi option cho điểm/archetype [Cla,Dra,Rom,Nat,Cre,Edg]; Q1 (outfit dinner) ×2. Primary=max, secondary=2nd (blend). Tie<10% → break theo trục lệch (Dra/Edg=structure, Nat/Cre=detail, Cla/Rom=line). Mỗi archetype có keywords để match sản phẩm.

## 5. Quiz nhiều cấp (chi tiết: `research-quiz.md`)
- **L0 Warm-up** (không chấm): tên + "mua cho dịp gì".
- **L1 Quick result** (5–6 câu): ra coarse profile 3 trục + kết quả tức thì (4-season, 1 archetype, dáng coarse). <90s.
- **L2 Refine** (4–6 câu, mở khoá sau L1): nâng 12-season, archetype blend, dáng chi tiết → confidence "refined".
- **L3 Mastery** (tuỳ chọn, giáo dục): giải thích palette/silhouette, lưu "style passport" (email).
- Ưu tiên image/swatch tap; slider ít; progress bar theo LEVEL; autosave; mỗi level tự đủ để gợi ý (drop-off vẫn có profile). Result screen dạy khách + "why these picks" cho từng sản phẩm.

## 6. Recommender (chi tiết: `research-quiz.md` Part 2)
- **Extraction** (cache theo product updatedAt): từ title+type+tags+variant colors → {colors→seasons, category, silhouette{neckline,fit,features}, moods}. Dictionary-driven; miss → `null` (KHÔNG đoán bừa). Data thật cici: type cụ thể (Maxi/Midi/Mini Dress chiếm ~55%), màu trong tags (white/black/red...), silhouette trong title (a-line 100, v-neck 98, off-shoulder 69, peplum 49...). Dictionaries lưu config (merchandiser sửa).
- **Scoring** (profile,product)→[0,1]: colorScore×0.40 + bodyScore×0.30 + archetypeScore×0.30, **unknown = 0.5 tại nửa trọng số** (không phạt như sai), renormalize theo axis biết được. Coarse-confidence → kéo về neutral.
- **Ranking**: score→drop<0.35 (trừ khi catalog nhỏ)→**MMR greedy** λ=0.7 + **cap mỗi category = k/4** (chống dồn 1 loại). Seed 1 "hero"/category. Log per-axis sub-score cho "why this pick".

## 7. Data model (migration)
- `style_quiz_definitions` (store_id nullable=global default, version, levels jsonb[questions], active) — bộ câu hỏi + trọng số versioned, sửa không deploy.
- `style_quiz_results` (id, store_id, customer_id nullable, session_key, answers jsonb, profile jsonb {color/body/archetype}, level_reached, created_at, updated_at) — 1 hồ sơ/khách/session.
- `style_palettes` / dictionaries: seed từ code (không cần bảng riêng v1 — hằng số + có thể chuyển config sau).
Reuse `CatalogProduct` (features/customer-account/recommend.ts). Recommender đọc `shopify_products` theo store.

## 8. API + UI + extension
- API (HMAC/session-token như customer-account hiện có): `GET /api/customer-account/quiz` (định nghĩa theo store), `POST /api/customer-account/quiz/submit` (answers→profile, lưu), `GET /api/customer-account/quiz/recommendations` (profile→sản phẩm store).
- **Module mới `quiz`** trong MODULE_KEYS + config-hub bật/tắt per store.
- **Admin preview** `/f/customer-account/quiz`: CEO tự làm quiz, xem profile + gợi ý (review được sáng mai KHÔNG cần deploy extension).
- **Extension** `shopify-extension/extensions/customer-account-quiz` (Preact) — customer-facing; deploy per store (bước sau, cần app store).

## 9. Thứ tự build (TDD từng bước, commit riêng, branch feat/style-quiz)
A2 engine thuần (color-season, archetype, body-shape → profile) + test →
A3 extraction + recommender thuần + test →
A4 schema+migration + seed câu hỏi default →
A5 API + admin preview + deploy migration + verify (CEO chạy thử) →
[extension để tăng dần].

## 10. Giới hạn đã biết (báo CEO)
- Chỉ **cici-mean có catalog** (1814 sp); meanblvd/mirermirer/tinhatelier sync=0 → quiz recommender chỉ chạy có nghĩa ở cici tới khi sync catalog (task riêng, liên quan pending "cron sync-products").
- Palette hex là [A] approx — cần designer duyệt.
- Body-shape/color "avoid" là convention — copy phải mềm, không cấm đoán.
