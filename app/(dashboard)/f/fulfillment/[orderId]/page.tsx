import { redirect } from 'next/navigation';

export default async function FulfillmentDetailRedirect({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  redirect(`/f/lifecycle/${orderId}`);
}
