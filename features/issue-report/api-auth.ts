import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

/** Cổng máy-với-máy cho tác vụ xử lý báo lỗi. `null` = được phép; còn lại là phản hồi lỗi. */
export function kiemTokenIssue(request: Request): Response | null {
  const expected = process.env.ISSUE_API_TOKEN;
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'ISSUE_API_TOKEN is not configured.' }, { status: 500 });
  }
  const a = Buffer.from(request.headers.get('authorization') ?? '');
  const b = Buffer.from(`Bearer ${expected}`);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
