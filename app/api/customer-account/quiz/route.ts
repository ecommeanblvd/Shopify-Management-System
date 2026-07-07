/**
 * GET /api/customer-account/quiz — trả định nghĩa câu hỏi quiz cho extension.
 * Không nhạy cảm (chỉ câu hỏi) nên không yêu cầu auth; vẫn gắn CORS.
 */
import { caJson, preflight } from '../_shared';
import { QUIZ_QUESTIONS } from '@/features/customer-account/style-quiz/quiz-definition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS(): Response { return preflight(); }
export function GET(): Response { return caJson({ questions: QUIZ_QUESTIONS }); }
