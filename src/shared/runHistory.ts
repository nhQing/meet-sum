import type { ProjectStatus, Settings } from './types'

/**
 * Lịch sử các lần bóc băng của một cuộc họp.
 *
 * Trước đây chỉ có đúng một ô `error` — chạy lại là lỗi cũ bị xoá, không còn
 * cách nào biết lần trước chạy bằng gì, hỏng ở đâu, mất bao lâu. Lưu ngay trong
 * project.json để đi theo cuộc họp, không phải file riêng.
 */

export type RunOutcome = 'running' | 'ok' | 'error' | 'paused' | 'interrupted'

export interface RunRecord {
  id: string
  /** full = bóc cả video (hoặc chạy tiếp); redo = bóc lại một khoảng */
  kind: 'full' | 'redo'
  startedAt: string
  endedAt?: string
  outcome: RunOutcome
  /** Chạy bằng gì, ví dụ "Gemini · gemini-2.5-pro" */
  engine: string
  /** Chạy tiếp sau tạm dừng: bắt đầu từ giây thứ mấy */
  resumedFromSec?: number
  /** Bóc lại một khoảng: khoảng nào */
  range?: { start: number; end: number }
  /** Số lượt nói có được sau lần chạy */
  segments?: number
  /** Lỗi nguyên văn, hoặc cảnh báo / kết quả ngắn gọn */
  message?: string
}

export const MAX_RUNS = 30

/** Thêm một lần chạy mới, mới nhất đứng đầu, chỉ giữ MAX_RUNS lần. */
export function addRun(runs: RunRecord[] | undefined, rec: RunRecord): RunRecord[] {
  return [rec, ...(runs ?? [])].slice(0, MAX_RUNS)
}

/** Chốt kết quả cho một lần chạy. Lần đã chốt thì để nguyên. */
export function finishRun(
  runs: RunRecord[] | undefined,
  id: string,
  patch: Pick<RunRecord, 'outcome' | 'endedAt'> & Partial<Pick<RunRecord, 'segments' | 'message'>>
): RunRecord[] {
  return (runs ?? []).map((r) => (r.id === id && r.outcome === 'running' ? { ...r, ...patch } : r))
}

/** App bị tắt ngang: lần nào còn "đang chạy" thì thật ra đã bị ngắt. */
export function markInterrupted(runs: RunRecord[] | undefined, at: string): RunRecord[] {
  return (runs ?? []).map((r) => (r.outcome === 'running' ? { ...r, outcome: 'interrupted', endedAt: at } : r))
}

export function hasRunning(runs: RunRecord[] | undefined): boolean {
  return (runs ?? []).some((r) => r.outcome === 'running')
}

/** Đọc kết quả từ trạng thái cuộc họp sau khi lượt chạy kết thúc. */
export function outcomeFromStatus(status: ProjectStatus): RunOutcome {
  if (status === 'ready' || status === 'done') return 'ok'
  if (status === 'paused') return 'paused'
  if (status === 'error') return 'error'
  return 'interrupted'
}

export function runDurationSec(r: RunRecord): number | undefined {
  if (!r.endedAt) return undefined
  const ms = Date.parse(r.endedAt) - Date.parse(r.startedAt)
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : undefined
}

export function engineLabel(s: Settings): string {
  if (s.engine === 'api') {
    return s.asrProvider === 'gemini' ? `Gemini · ${s.llm.providers.gemini.model}` : 'OpenAI Whisper'
  }
  if (s.localAsr === 'vibevoice') return 'VibeVoice-ASR'
  if (s.localAsr === 'whispercpp') return 'whisper.cpp'
  return `faster-whisper · ${s.fwModelSize}`
}
