'use client';

import { useRouter } from 'next/navigation';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

export interface RateCardOption {
  id: string;
  label: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isOpen: boolean;
}

export function RateCardSelect({
  accountId, cards, selectedCardId,
}: { accountId: string; cards: RateCardOption[]; selectedCardId: string }) {
  const router = useRouter();
  return (
    <Select value={selectedCardId} onValueChange={(id) => router.push(`/f/carrier-rates/${accountId}/matrix?card=${id}`)}>
      <SelectTrigger className="w-full max-w-md"><SelectValue /></SelectTrigger>
      <SelectContent>
        {cards.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.label} · {c.effectiveFrom} → {c.effectiveTo ?? 'open'} · {c.isOpen ? 'Current' : 'History'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
