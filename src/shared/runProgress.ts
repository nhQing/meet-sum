import type { ProjectStatus } from './types'

/** Các trạng thái mà lượt chạy đã kết thúc (thành công, lỗi hoặc tạm dừng). */
const IDLE_STAGES: ProjectStatus[] = ['ready', 'done', 'error', 'paused']

/** Sự kiện tiến độ này có nghĩa là đang chạy không. Cùng quy ước với App.tsx. */
export function isActiveStage(stage: ProjectStatus): boolean {
  return !IDLE_STAGES.includes(stage)
}

/**
 * Sự kiện tiến độ này có phải là lúc một lượt chạy MỚI bắt đầu không.
 *
 * Main process xoá lỗi cũ trong project.json ngay khi bắt đầu chạy, nhưng giao
 * diện chỉ tải lại cuộc họp khi lượt chạy kết thúc — nên suốt lượt chạy lại,
 * thông báo lỗi của lần trước vẫn nằm đó như thể vừa lỗi tiếp. Đúng lúc này
 * phải tải lại một lần; còn mỗi lần nhích % thì không, tránh gọi IPC liên tục.
 */
export function isRunStarting(prev: ProjectStatus | undefined, next: ProjectStatus): boolean {
  return isActiveStage(next) && (prev === undefined || !isActiveStage(prev))
}
