/**
 * POST /api/mmp/ship-ho/contract — ALIAS của `/api/mmp/contracts` (path chính
 * MMP chốt 05/08). Giữ lại để không vỡ nếu MMP đã trỏ sang path công bố trước
 * đó; cùng handler, cùng secret, cùng hành vi idempotent.
 */
import { type NextRequest } from 'next/server';
import { handleMmpContractRequest } from '@/features/ship-ho/contract-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  return handleMmpContractRequest(req);
}
