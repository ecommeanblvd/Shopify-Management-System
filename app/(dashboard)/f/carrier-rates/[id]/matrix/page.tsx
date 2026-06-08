import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function MatrixRedirect({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ card?: string }> }) {
  const { id } = await params;
  const { card } = await searchParams;
  redirect(`/f/carrier-rates/${id}/workspace${card ? `?card=${card}` : ''}`);
}
