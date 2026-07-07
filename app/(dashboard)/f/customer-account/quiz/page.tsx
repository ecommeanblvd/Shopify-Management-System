import { db, schema } from '@/db/client';
import { QUIZ_QUESTIONS } from '@/features/customer-account/style-quiz/quiz-definition';
import { QuizPreview } from './QuizPreview';

export const dynamic = 'force-dynamic';

export default async function StyleQuizPreviewPage() {
  const stores = await db
    .select({ id: schema.stores.id, domain: schema.stores.shopDomain })
    .from(schema.stores)
    .orderBy(schema.stores.shopDomain);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Style Quiz — Preview</h1>
        <p className="text-sm text-muted-foreground">
          Làm thử quiz → xem hồ sơ phong cách (màu / dáng / gu) + sản phẩm gợi ý từ catalog của store.
          Đây là bản preview nội bộ để review logic; bản khách hàng chạy trong extension.
        </p>
        <p className="text-xs text-amber-700 mt-1">
          ⚠ Kết quả là <b>gợi ý phong cách</b> (dựa trên color-theory & body-shape convention), không phải chẩn đoán khoa học.
          Chỉ <b>cici-mean</b> đã đồng bộ catalog; store khác cần sync sản phẩm trước.
        </p>
      </div>
      <QuizPreview stores={stores} questions={QUIZ_QUESTIONS} />
    </div>
  );
}
