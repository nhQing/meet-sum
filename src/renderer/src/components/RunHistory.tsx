import { useState } from 'react'
import { ChevronDown, ChevronRight, History } from 'lucide-react'
import type { Project } from '../../../shared/types'
import { runDurationSec, type RunOutcome, type RunRecord } from '../../../shared/runHistory'
import { formatDate, formatTime } from '../lib/format'

const OUTCOME_LABEL: Record<RunOutcome, string> = {
  running: 'Đang chạy',
  ok: 'Xong',
  error: 'Lỗi',
  paused: 'Tạm dừng',
  interrupted: 'Bị ngắt'
}

const OUTCOME_TONE: Record<RunOutcome, string> = {
  running: 'bg-amber-500/15 text-amber-300',
  ok: 'bg-emerald-500/15 text-emerald-300',
  error: 'bg-red-500/15 text-red-300',
  paused: 'bg-sky-500/15 text-sky-300',
  interrupted: 'bg-ink-800 text-ink-300'
}

/** Thời gian chạy: giây cho lượt ngắn, phút/giờ cho lượt dài. */
function spent(sec: number | undefined): string | null {
  if (sec === undefined) return null
  if (sec < 60) return `${sec} giây`
  const m = Math.round(sec / 60)
  return m < 60 ? `${m} phút` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

function RunRow({ run }: { run: RunRecord }): JSX.Element {
  const [open, setOpen] = useState(false)
  const details = [
    run.kind === 'redo' && run.range ? `bóc lại ${formatTime(run.range.start)}–${formatTime(run.range.end)}` : null,
    run.resumedFromSec ? `chạy tiếp từ ${formatTime(run.resumedFromSec)}` : null,
    run.engine,
    spent(runDurationSec(run)),
    run.outcome !== 'running' && run.segments !== undefined ? `${run.segments} lượt nói` : null
  ].filter(Boolean)

  return (
    <li className="rounded-lg border border-ink-800 bg-ink-950/40 px-2.5 py-2">
      <button
        className="w-full flex items-center gap-2 text-left"
        onClick={() => run.message && setOpen((v) => !v)}
        disabled={!run.message}
        title={run.message ? (open ? 'Thu gọn' : 'Xem chi tiết') : undefined}
      >
        <span className={`pill shrink-0 ${OUTCOME_TONE[run.outcome]}`}>{OUTCOME_LABEL[run.outcome]}</span>
        <span className="text-[12px] text-ink-200 tabular-nums">{formatDate(run.startedAt)}</span>
        {run.message && (
          <span className="ml-auto text-ink-500">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
        )}
      </button>
      <p className="mt-1 text-[11.5px] text-ink-400 leading-relaxed break-words">{details.join(' · ')}</p>
      {run.message && (
        <p
          className={`mt-1 text-[11.5px] leading-relaxed break-words whitespace-pre-line ${
            run.outcome === 'error' ? 'text-red-200/90' : 'text-ink-300'
          } ${open ? 'max-h-48 overflow-y-auto' : 'line-clamp-1'}`}
        >
          {run.message}
        </p>
      )}
    </li>
  )
}

/**
 * Lịch sử các lần bóc băng. Thu gọn mặc định: phần lớn thời gian người dùng
 * không cần nó, nhưng khi bóc băng hỏng thì đây là chỗ duy nhất còn ghi lại
 * lần trước chạy bằng gì và hỏng vì sao.
 */
export default function RunHistory({ project }: { project: Project }): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const runs = project.runs ?? []
  if (!runs.length) return null
  const last = runs[0]

  return (
    <div className="card p-3 shrink-0">
      <button className="w-full flex items-center gap-2" onClick={() => setOpen((v) => !v)}>
        <History size={13} className="text-ink-400" />
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
          Lịch sử bóc băng ({runs.length})
        </h3>
        {!open && <span className={`pill ml-1 ${OUTCOME_TONE[last.outcome]}`}>{OUTCOME_LABEL[last.outcome]}</span>}
        <span className="ml-auto text-ink-500">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      {open && (
        <ul className="mt-2.5 space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {runs.map((r) => (
            <RunRow key={r.id} run={r} />
          ))}
        </ul>
      )}
    </div>
  )
}
