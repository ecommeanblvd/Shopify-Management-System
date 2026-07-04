/** THUẦN: playbook vận hành tĩnh theo giai đoạn vòng đời. */
import type { StageKey } from './derive';

export type InfoKey =
  | 'address' | 'items' | 'brand' | 'brandEta' | 'brandRequests'
  | 'kcs' | 'packs' | 'carrier' | 'tracking' | 'deliveryStatus' | 'refund';

export interface StagePlaybook { whatToDo: string; infoKeys: InfoKey[] }

export const STAGE_PLAYBOOK: Record<StageKey, StagePlaybook> = {
  placed: { whatToDo: 'Xác nhận đơn, kiểm tồn kho, quyết định lấy từ kho hay push brand.', infoKeys: ['address', 'items'] },
  production: { whatToDo: 'Theo dõi brand xác nhận + gửi hàng về kho; giục KCS ngay khi hàng tới.', infoKeys: ['brand', 'brandEta', 'brandRequests', 'kcs'] },
  qc: { whatToDo: 'Đối chiếu KCS pass/fail; xử lý hàng lỗi trước khi đóng gói.', infoKeys: ['kcs', 'items', 'packs'] },
  packed: { whatToDo: 'Lên vận đơn, cân kiện, bàn giao carrier.', infoKeys: ['packs', 'carrier', 'address'] },
  shipped: { whatToDo: 'Theo dõi tracking; xử lý sự cố; báo khách khi cần.', infoKeys: ['carrier', 'tracking', 'deliveryStatus', 'address'] },
  in_transit: { whatToDo: 'Theo dõi hành trình carrier; can thiệp nếu kẹt.', infoKeys: ['carrier', 'tracking', 'deliveryStatus'] },
  out_for_delivery: { whatToDo: 'Giao trong ngày; sẵn sàng xử lý giao thất bại.', infoKeys: ['carrier', 'tracking', 'deliveryStatus', 'address'] },
  post_delivery: { whatToDo: 'Theo dõi return/refund trong 30 ngày trước khi đóng đơn.', infoKeys: ['deliveryStatus', 'refund'] },
  completed: { whatToDo: 'Đơn đã hoàn tất — không còn việc.', infoKeys: [] },
  refunded_full: { whatToDo: 'Đơn đã hoàn tiền toàn phần.', infoKeys: ['refund'] },
  cancelled: { whatToDo: 'Đơn đã huỷ.', infoKeys: [] },
};

export function stagePlaybook(stage: StageKey): StagePlaybook {
  return STAGE_PLAYBOOK[stage];
}
