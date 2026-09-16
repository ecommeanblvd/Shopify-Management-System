import { Card, CardContent } from '@/components/ui/card';
import { CreditNoteUpload } from './CreditNoteUpload';
import { CreditNoteDetailDialog } from './CreditNoteDetailDialog';

export interface CreditNoteRow {
  id: string; soHoaDon: string; kyHieu: string; ngay: string; tongCong: number; soDong: number; tenFile: string | null;
  loai: 'credit' | 'debit';
}

export interface CreditNoteThang { thang: string; tong: number; n: number; tongDebit: number; nDebit: number }

/**
 * Khối credit note trên trang Đối soát — gọn về MỘT DÒNG: tóm tắt tiền thu hồi tháng gần nhất và nút tải.
 * Bảng từng chứng từ và phần giải thích nằm trong modal, bấm vào dòng tóm tắt mới mở (CEO 16/09/2026).
 */
export function CreditNoteCard({ rows, tongThang }: { rows: CreditNoteRow[]; tongThang: CreditNoteThang[] }) {
  return (
    <Card><CardContent className="flex flex-wrap items-center gap-3 p-2.5">
      <CreditNoteDetailDialog rows={rows} tongThang={tongThang} />
      <CreditNoteUpload />
    </CardContent></Card>
  );
}
