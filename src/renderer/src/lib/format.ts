export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(r).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function formatDuration(sec?: number): string {
  if (!sec) return '—'
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} phút`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return iso
  }
}

export const STATUS_LABEL: Record<string, string> = {
  new: 'Chưa xử lý',
  queued: 'Đang chờ trong hàng đợi',
  extracting: 'Đang tách audio',
  diarizing: 'Đang tách người nói',
  transcribing: 'Đang bóc băng',
  paused: 'Đang tạm dừng',
  ready: 'Đã có hội thoại',
  summarizing: 'Đang tóm tắt',
  done: 'Hoàn tất',
  error: 'Lỗi'
}

export const STATUS_TONE: Record<string, string> = {
  new: 'bg-ink-800 text-ink-300',
  queued: 'bg-violet-500/15 text-violet-300',
  extracting: 'bg-amber-500/15 text-amber-300',
  diarizing: 'bg-amber-500/15 text-amber-300',
  transcribing: 'bg-amber-500/15 text-amber-300',
  paused: 'bg-sky-500/15 text-sky-300',
  ready: 'bg-brand-500/15 text-brand-200',
  summarizing: 'bg-violet-500/15 text-violet-300',
  done: 'bg-emerald-500/15 text-emerald-300',
  error: 'bg-red-500/15 text-red-300'
}
