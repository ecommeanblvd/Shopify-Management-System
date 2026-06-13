'use client';

import { FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

/** Nút mở modal xem PDF rate card (bằng chứng gốc). Iframe trỏ tới route stream
 *  PDF từ R2 (`…/cards/{cardId}/pdf`). Hiện trong toolbar của rate matrix. */
export function RateCardPdfButton({ pdfUrl, title }: { pdfUrl: string; title?: string | null }) {
  return (
    <Dialog>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted whitespace-nowrap">
        <FileText className="size-3.5" /> Xem PDF gốc
      </DialogTrigger>
      <DialogContent className="w-[92vw] max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{title ?? 'Rate card PDF'}</DialogTitle>
        </DialogHeader>
        <iframe src={pdfUrl} title="Rate card PDF" className="h-[80vh] w-full rounded border border-border" />
      </DialogContent>
    </Dialog>
  );
}
