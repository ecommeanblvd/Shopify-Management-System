import { db, schema } from '@/db/client';

export const NGUOI_TU_DONG = 'tác vụ tự động';

export interface SuKienVao {
  issueId: string;
  nguoi: string;
  loai: 'tao' | 'doi_trang_thai' | 'ghi_chu' | 'pr';
  tuTrangThai?: string | null;
  denTrangThai?: string | null;
  ghiChu?: string | null;
  prUrl?: string | null;
}

/**
 * Ghi một dòng vào dòng thời gian. BEST-EFFORT có chủ đích: dòng thời gian là phần xem lại,
 * còn việc chính (tạo báo lỗi, đổi trạng thái) đã ghi xong — bảng sự kiện chưa áp di trú hay
 * lỗi tạm không được làm hỏng việc chính. Lỗi được in ra log để không mất tăm.
 */
export async function ghiSuKien(v: SuKienVao): Promise<void> {
  try {
    await db.insert(schema.issueReportEvents).values({
      issueId: v.issueId, nguoi: v.nguoi, loai: v.loai,
      tuTrangThai: v.tuTrangThai ?? null, denTrangThai: v.denTrangThai ?? null,
      ghiChu: v.ghiChu ?? null, prUrl: v.prUrl ?? null,
    });
  } catch (e) {
    console.error('[issue-report] ghi sự kiện lỗi:', e);
  }
}
