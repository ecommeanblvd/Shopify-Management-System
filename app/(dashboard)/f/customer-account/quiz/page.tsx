import { redirect } from 'next/navigation';

/** Style Quiz đã tách thành function riêng. Giữ route cũ → redirect. */
export default function LegacyQuizRedirectPage() {
  redirect('/f/functions/style-quiz');
}
