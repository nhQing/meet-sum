import type { Project } from '../../shared/types'
import { getProject, saveProject } from './store'

/**
 * Lịch sử hoàn tác cho các thao tác sửa tay (sửa câu, tách/gộp/xoá lượt nói,
 * đổi tên người, sửa tóm tắt). Giữ trong RAM: mất khi tắt app, nhưng đủ để cứu
 * những cú bấm sai — trước đây xoá một lượt nói là mất luôn.
 *
 * KHÔNG dùng cho các thay đổi do pipeline sinh ra (tiến độ, trạng thái), vì
 * chúng cập nhật liên tục và sẽ làm ngập stack.
 */
const MAX_DEPTH = 25

const stacks = new Map<string, { label: string; snapshot: Project }[]>()

/** Chụp trạng thái hiện tại TRƯỚC khi sửa. Gọi ngay đầu mỗi handler sửa tay. */
export function snapshot(projectId: string, label: string): void {
  const p = getProject(projectId)
  if (!p) return
  const stack = stacks.get(projectId) ?? []
  stack.push({ label, snapshot: structuredClone(p) })
  while (stack.length > MAX_DEPTH) stack.shift()
  stacks.set(projectId, stack)
}

export function undoInfo(projectId: string): { depth: number; label: string | null } {
  const stack = stacks.get(projectId) ?? []
  return { depth: stack.length, label: stack.length ? stack[stack.length - 1].label : null }
}

/** Quay lại trạng thái trước thao tác gần nhất. Trả về null nếu không còn gì để lùi. */
export function undo(projectId: string): { project: Project; label: string } | null {
  const stack = stacks.get(projectId)
  if (!stack?.length) return null
  const entry = stack.pop() as { label: string; snapshot: Project }
  stacks.set(projectId, stack)
  // Giữ lại trạng thái pipeline hiện tại, chỉ hoàn tác phần nội dung
  const now = getProject(projectId)
  const restored = saveProject({
    ...entry.snapshot,
    status: now?.status ?? entry.snapshot.status,
    progressSec: now?.progressSec,
    error: now?.error,
    warning: now?.warning
  })
  return { project: restored, label: entry.label }
}

export function clearHistory(projectId: string): void {
  stacks.delete(projectId)
}
