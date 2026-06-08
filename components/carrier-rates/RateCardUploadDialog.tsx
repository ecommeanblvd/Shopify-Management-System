'use client';

import { useState } from 'react';
import { Upload } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RateCardUpload } from '@/components/carrier-rates/RateCardUpload';
import type { StagedRateCard } from '@/features/carrier-rates/rate-card-upload-actions';

/**
 * Header-button entry point for the rate-card upload + preview/confirm flow.
 * Wraps the inline <RateCardUpload> form inside a modal dialog so it can be
 * triggered from the title row instead of sitting inline in the page.
 */
export function RateCardUploadDialog({
  stageAction,
  commitAction,
  triggerLabel = 'Upload rate card',
  triggerVariant = 'outline',
}: {
  stageAction: (formData: FormData) => Promise<StagedRateCard>;
  commitAction: (input: { pdfKey: string; filename: string; effectiveFrom: string; effectiveTo: string | null }) => Promise<{ id: string }>;
  triggerLabel?: string;
  triggerVariant?: 'default' | 'outline';
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        className="gap-2 whitespace-nowrap"
        onClick={() => setOpen(true)}
      >
        <Upload className="size-4" />
        {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload rate card</DialogTitle>
          <DialogDescription>
            Upload a carrier rate-sheet PDF, preview the parse, then set the effective window to create the card.
          </DialogDescription>
        </DialogHeader>
        <RateCardUpload
          stageAction={stageAction}
          commitAction={commitAction}
          onCommitted={() => setOpen(false)}
        />
        </DialogContent>
      </Dialog>
    </>
  );
}
