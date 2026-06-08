'use client';

import { useRouter } from 'next/navigation';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { formatDateVN } from '@/features/carrier-rates/lib';

export interface RateCardOption {
  id: string;
  label: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isOpen: boolean;
}

/** Friendly, human-readable label for a rate card. Used both in the trigger
 *  display and the dropdown items so they stay consistent — e.g.
 *  "FedEx IP 2026 · 2026-01-01 → open · Current". */
function cardLabel(c: RateCardOption): string {
  return `${c.label} · ${formatDateVN(c.effectiveFrom)} → ${formatDateVN(c.effectiveTo, 'nay')} · ${c.isOpen ? 'Hiện hành' : 'Lịch sử'}`;
}

export function RateCardSelect({
  accountId, cards, selectedCardId,
}: { accountId: string; cards: RateCardOption[]; selectedCardId: string }) {
  const router = useRouter();
  const selected = cards.find((c) => c.id === selectedCardId) ?? null;
  return (
    <Select value={selectedCardId} onValueChange={(id) => router.push(`/f/carrier-rates/${accountId}/workspace?card=${id}`)}>
      <SelectTrigger className="w-full max-w-md">
        <SelectValue placeholder="Select a rate card">
          {selected ? cardLabel(selected) : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {cards.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {cardLabel(c)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
