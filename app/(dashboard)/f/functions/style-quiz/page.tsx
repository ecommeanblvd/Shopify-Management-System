import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ChevronLeft, Palette, FlaskConical, ClipboardList, Power, Sparkles } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { Card, CardContent } from '@/components/ui/card';
import { QUIZ_QUESTIONS } from '@/features/customer-account/style-quiz/quiz-definition';
import { listStyleQuizStatusPerStore } from '@/features/functions/style-quiz/admin-actions';
import { StoreEnablement } from './StoreEnablement';
import { QuizPreview } from './QuizPreview';

export const dynamic = 'force-dynamic';

/** Nhãn tin cậy: [E]=có bằng chứng peer-review, [C]=quy ước/convention ngành. */
function Cred({ kind }: { kind: 'E' | 'C' }) {
  return kind === 'E'
    ? <span className="rounded bg-emerald-500/15 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:text-emerald-400" title="Có bằng chứng peer-review">[E] bằng chứng</span>
    : <span className="rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:text-amber-400" title="Quy ước ngành thời trang, chưa phải khoa học kiểm chứng">[C] quy ước</span>;
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-lg font-semibold">
      <span className="text-fuchsia-600 dark:text-fuchsia-400">{icon}</span>
      {children}
    </h2>
  );
}

export default async function StyleQuizFunctionPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_functions')) {
    return <div className="px-6 py-16 text-center"><h1 className="text-3xl">Forbidden</h1></div>;
  }

  const stores = await listStyleQuizStatusPerStore();
  const previewStores = stores.map((s) => ({ id: s.storeId, domain: s.shopDomain }));
  const enabledCount = stores.filter((s) => s.enabled).length;

  const byAxis = { color: QUIZ_QUESTIONS.filter((q) => q.axis === 'color'), body: QUIZ_QUESTIONS.filter((q) => q.axis === 'body'), archetype: QUIZ_QUESTIONS.filter((q) => q.axis === 'archetype') };

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10 max-w-5xl">
      {/* Header */}
      <header className="space-y-3">
        <Link href="/f/functions" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3.5" /> Functions
        </Link>
        <div className="flex items-start gap-3">
          <div className="size-12 rounded-xl flex items-center justify-center bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 shrink-0">
            <Palette className="size-6" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Style Quiz</h1>
            <p className="text-sm text-muted-foreground max-w-2xl mt-1">
              Quiz phong cách khoa học: khách trả lời → hồ sơ 3 trục (mùa màu hợp da · dáng người · gu) →
              gợi ý sản phẩm từ catalog của store. Ship như một module trong extension Customer Account.
            </p>
            <p className="text-xs text-muted-foreground mt-1">Đang bật cho <b>{enabledCount}</b>/{stores.length} store.</p>
          </div>
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
          ⚠ Kết quả là <b>gợi ý phong cách</b> để bán hàng, KHÔNG phải chẩn đoán khoa học. Phần lớn quy tắc màu/dáng là
          <b> quy ước ngành [C]</b>; chỉ một phần undertone có bằng chứng peer-review <b>[E]</b>. Trình bày cho khách theo hướng
          gợi ý, không cấm đoán, và soft-touch với làn da sẫm màu (bằng chứng chủ yếu trên da trắng trẻ).
        </div>
      </header>

      {/* 1. Bật theo store */}
      <section className="space-y-3">
        <SectionTitle icon={<Power className="size-5" />}>Bật theo store</SectionTitle>
        <p className="text-sm text-muted-foreground">
          Bật quiz cho từng store. Vì quiz ship trong extension Customer Account, store <b>cần bật Customer Account</b> thì
          khách mới thấy quiz. Store chưa sync catalog sẽ ra hồ sơ nhưng không có sản phẩm gợi ý.
        </p>
        <StoreEnablement initial={stores} />
      </section>

      {/* 2. Nguyên lý & định nghĩa */}
      <section className="space-y-4">
        <SectionTitle icon={<FlaskConical className="size-5" />}>Nguyên lý & định nghĩa</SectionTitle>
        <p className="text-sm text-muted-foreground">
          Hồ sơ phong cách gồm <b>3 trục độc lập</b>. Mỗi trục có định nghĩa riêng và mức độ tin cậy khác nhau:
        </p>

        <Card><CardContent className="p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2 font-semibold">① Mùa màu theo làn da <Cred kind="C" /></div>
          <p className="text-muted-foreground">
            Hệ <b>12 mùa</b> (Light/True/Soft/Deep/Bright × Spring/Summer/Autumn/Winter) suy từ 3 chiều Munsell:
            <b> undertone</b> (ấm/lạnh), <b>value</b> (sáng/tối), <b>chroma</b> (tươi/trầm) của da–tóc–mắt. Mỗi mùa gắn một
            bảng màu nên mặc & màu nên tránh.
          </p>
          <p className="text-muted-foreground">
            <b>Tin cậy:</b> hệ mùa là <b>quy ước ngành [C]</b>. Chỉ có một mảnh <Cred kind="E" />: Perrett &amp; Sprengelmeyer (2021,
            <i> i-Perception</i>) cho thấy da trắng <i>sáng</i> hợp tông <b>lạnh</b>, da <i>rám</i> hợp tông <b>ấm</b> — nhưng
            chỉ đúng ở da trắng trẻ và <b>đảo chiều khi da rất sẫm (L*&lt;50)</b>. ⇒ trình bày là gợi ý, không cấm; soft-touch với da sẫm.
          </p>
        </CardContent></Card>

        <Card><CardContent className="p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2 font-semibold">② Dáng người <Cred kind="C" /></div>
          <p className="text-muted-foreground">
            5 dáng theo tỉ lệ vai–eo–hông (FFIT): <b>đồng hồ cát</b> (hourglass), <b>quả lê</b> (pear), <b>quả táo</b> (apple),
            <b> chữ nhật</b> (rectangle), <b>tam giác ngược</b> (invertedTriangle) + dải chiều cao. Mục tiêu styling là <i>cân bằng
            tỉ lệ</i> (vd nhấn eo cho rectangle, thêm khối trên cho pear).
          </p>
          <p className="text-muted-foreground"><b>Tin cậy:</b> quy ước styling [C], không có khẳng định y khoa; tuyệt đối không phán xét cơ thể — chỉ gợi ý phom dáng tôn dáng.</p>
        </CardContent></Card>

        <Card><CardContent className="p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2 font-semibold">③ Gu / archetype <Cred kind="C" /></div>
          <p className="text-muted-foreground">
            6 nhóm gu: <b>classic</b> (thanh lịch, tối giản), <b>dramatic</b> (mạnh, statement), <b>romantic</b> (nữ tính, mềm),
            <b> natural</b> (thoải mái, đời thường), <b>creative</b> (boho, eclectic), <b>edgy</b> (cá tính, street). Suy từ ma trận
            câu hỏi + tie-break theo cặp lệch; có thể ra gu phụ khi điểm ≥ 0.40× gu chính.
          </p>
          <p className="text-muted-foreground"><b>Tin cậy:</b> khung personal-style [C] (Kibbe/McJimsey điều chỉnh) — sở thích thẩm mỹ, không phải khoa học.</p>
        </CardContent></Card>
      </section>

      {/* 3. Cách recommendation hoạt động */}
      <section className="space-y-3">
        <SectionTitle icon={<Sparkles className="size-5" />}>Cách gợi ý sản phẩm hoạt động</SectionTitle>
        <Card><CardContent className="p-4 space-y-2 text-sm text-muted-foreground">
          <p>1. <b>Rút thuộc tính sản phẩm</b> từ title/tag/handle: màu, category, cổ áo, phom, mood… (thiếu dữ liệu → <i>unknown</i>, không loại).</p>
          <p>2. <b>Chấm điểm</b> mỗi sản phẩm theo 3 trục: khớp màu (bảng màu mùa), phù hợp dáng, khớp gu. Thuộc tính <i>unknown</i> tính <b>nửa trọng số (0.5)</b> để không phạt oan sản phẩm thiếu tag.</p>
          <p>3. <b>Đa dạng hoá</b>: MMR (giảm trùng lặp) + trần theo category, để danh sách không bị dồn 1 loại. Mỗi sản phẩm kèm <b>lý do</b> (vd “màu hợp mùa”, “tôn dáng”).</p>
          <p>Điểm càng cao càng khớp; danh sách mặc định top 12. Store chưa sync catalog → không có sản phẩm để gợi ý.</p>
        </CardContent></Card>
      </section>

      {/* 4. Cách set up quiz */}
      <section className="space-y-3">
        <SectionTitle icon={<ClipboardList className="size-5" />}>Cách set up quiz</SectionTitle>
        <p className="text-sm text-muted-foreground">
          Quiz gồm <b>{QUIZ_QUESTIONS.length} câu</b> chia 3 trục, có câu <b>cấp 1</b> (cơ bản, bắt buộc) và <b>cấp 2</b> (nâng cao,
          tinh chỉnh). Bật cho store → khách làm trong extension Customer Account → kết quả lưu vào <code>style_quiz_results</code>.
          Không cần cấu hình gì thêm — bộ câu hỏi và logic chấm điểm dùng chung mọi store; chỉ catalog gợi ý là riêng theo store.
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          {(['color', 'body', 'archetype'] as const).map((axis) => (
            <Card key={axis}><CardContent className="p-3 space-y-1.5">
              <div className="text-sm font-semibold">
                {axis === 'color' ? '① Màu sắc' : axis === 'body' ? '② Dáng người' : '③ Gu'} · {byAxis[axis].length} câu
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {byAxis[axis].map((q) => (
                  <li key={q.id} className="flex gap-1.5">
                    <span className={q.level === 2 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground/60'}>{q.level === 2 ? 'L2' : 'L1'}</span>
                    <span>{q.prompt}</span>
                  </li>
                ))}
              </ul>
            </CardContent></Card>
          ))}
        </div>
      </section>

      {/* 5. Preview */}
      <section className="space-y-3">
        <SectionTitle icon={<Palette className="size-5" />}>Preview nội bộ</SectionTitle>
        <p className="text-sm text-muted-foreground">
          Làm thử quiz → xem hồ sơ + sản phẩm gợi ý từ catalog store. Bản khách hàng chạy trong extension; đây là công cụ review logic.
        </p>
        <QuizPreview stores={previewStores} questions={QUIZ_QUESTIONS} />
      </section>
    </div>
  );
}
