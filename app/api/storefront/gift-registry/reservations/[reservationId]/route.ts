/**
 * DELETE /api/storefront/gift-registry/reservations/:reservationId?reserverEmail=…
 *   → { cancelled }
 *
 * Cancels a reservation. Email match acts as the auth gate.
 */

import type { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, handleOptions } from '../../_shared';
import { cancelReservation } from '@/features/functions/gift-registry/storefront';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ reservationId: string }> },
) {
  const { reservationId } = await params;
  const reserverEmail = req.nextUrl.searchParams.get('reserverEmail') ?? '';
  try {
    const result = await cancelReservation(reservationId, reserverEmail);
    return jsonResponse(req, result);
  } catch (err) {
    return errorResponse(req, 'bad_input', (err as Error).message);
  }
}

export const OPTIONS = handleOptions;
