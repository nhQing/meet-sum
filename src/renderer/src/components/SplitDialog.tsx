import { useMemo, useState } from 'react'
import { Play, Plus, Scissors, Trash2, Wand2 } from 'lucide-react'
import type { SpeakerProfile, TranscriptSegment } from '../../../shared/types'
import { formatTime } from '../lib/format'
import { Modal, Spinner } from './Ui'

interface Part {
  text: string
  speakerId: string
  start: number
  end: number
}

/** mm:ss.d -> giây. Chấp nhận cả "83.5" lẫn "1:23.5". */
function parseTime(v: string, fallback: number): number {
  const t = v.trim()
  if (!t) return fallback
  const m = /^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/.exec(t)
  if (!m) return fallback
  const min = m[1] ? Number(m[1]) : 0
  const sec = Number(m[2].replace(',', '.'))
  const out = min * 60 + sec
  return Number.isFinite(out) ? out : fallback
}

function showTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

/**
 * Tách một lượt nói bị AI gộp nhầm thành nhiều người.
 * Người dùng đặt con trỏ vào chỗ đổi người nói rồi bấm "Tách tại đây";
 * mốc thời gian được ước lượng theo vị trí ký tự, sau đó chỉnh tay cho chính xác
 * (tiện nhất là phát video tới đúng chỗ rồi bấm "Lấy từ video").
 */
export default function SplitDialog({
  open,
  segment,
  speakers,
  currentTime,
  onSeek,
  onPlayRange,
  onClose,
  onSave
}: {
  open: boolean
  segment: TranscriptSegment | null
  speakers: SpeakerProfile[]
  currentTime: number
  onSeek: (t: number) => void
  onPlayRange: (from: number, to: number) => void
  onClose: () => void
  onSave: (parts: Part[]) => Promise<void>
}): JSX.Element {
  const [parts, setParts] = useState<Part[]>([])
  const [caret, setCaret] = useState(0)
  const [activeIdx, setActiveIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [seedId, setSeedId] = useState<string | null>(null)

  // Nạp lại mỗi khi mở dialog cho một lượt nói khác
  if (open && segment && seedId !== segment.id) {
    setSeedId(segment.id)
    setParts([{ text: segment.text, speakerId: segment.speakerId, start: segment.start, end: segment.end }])
    setActiveIdx(0)
    setCaret(0)
  }

  const spMap = useMemo(() => new Map(speakers.map((s) => [s.id, s])), [speakers])

  const trackCaret = (e: { target: EventTarget | null }): void => {
    const el = e.target as HTMLTextAreaElement | null
    if (el && typeof el.selectionStart === 'number') setCaret(el.selectionStart)
  }

  const activePart = parts[activeIdx]
  // Chỉ tách được khi con trỏ nằm giữa nội dung, và hai bên đều còn chữ
  const canSplitHere = Boolean(
    activePart &&
      caret > 0 &&
      caret < activePart.text.length &&
      activePart.text.slice(0, caret).trim() &&
      activePart.text.slice(caret).trim()
  )

  if (!segment) return <></>

  const total = segment.end - segment.start

  /** Tách phần đang chọn tại vị trí con trỏ, ước lượng mốc thời gian theo số ký tự. */
  const splitAtCaret = (): void => {
    const p = parts[activeIdx]
    if (!p || !canSplitHere) return
    const pos = caret
    const left = p.text.slice(0, pos).trim()
    const right = p.text.slice(pos).trim()

    const ratio = pos / p.text.length
    const boundary = Number((p.start + (p.end - p.start) * ratio).toFixed(1))
    const next: Part[] = [
      { ...p, text: left, end: boundary },
      { text: right, speakerId: p.speakerId, start: boundary, end: p.end }
    ]
    setParts([...parts.slice(0, activeIdx), ...next, ...parts.slice(activeIdx + 1)])
    setActiveIdx(activeIdx + 1)
  }

  const setPart = (i: number, patch: Partial<Part>): void =>
    setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))

  /** Đổi mốc bắt đầu của phần i, đồng thời kéo mốc kết thúc của phần liền trước. */
  const setBoundary = (i: number, value: number): void => {
    const lo = i > 0 ? parts[i - 1].start + 0.2 : segment.start
    const hi = parts[i].end - 0.2
    const v = Number(Math.max(lo, Math.min(hi, value)).toFixed(1))
    setParts((ps) =>
      ps.map((p, j) => {
        if (j === i) return { ...p, start: v }
        if (j === i - 1) return { ...p, end: v }
        return p
      })
    )
  }

  const removePart = (i: number): void => {
    if (parts.length <= 1) return
    const gone = parts[i]
    const next = parts.filter((_, j) => j !== i)
    // Nội dung của phần bị xoá được nhập lại vào phần liền kề để không mất chữ
    const target = i > 0 ? i - 1 : 0
    next[target] = {
      ...next[target],
      text: `${next[target].text} ${gone.text}`.replace(/\s+/g, ' ').trim(),
      start: Math.min(next[target].start, gone.start),
      end: Math.max(next[target].end, gone.end)
    }
    setParts(next)
    setActiveIdx(Math.min(target, next.length - 1))
  }

  const valid = parts.length >= 2 && parts.every((p) => p.text.trim().length > 0)

  const save = async (): Promise<void> => {
    if (!valid) return
    setSaving(true)
    try {
      await onSave(parts)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Tách lượt nói"
      subtitle={`${formatTime(segment.start)} – ${formatTime(segment.end)} · ${total.toFixed(1)} giây`}
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Huỷ
          </button>
          <button className="btn-primary" onClick={save} disabled={!valid || saving}>
            {saving ? <Spinner size={13} /> : <Scissors size={14} />}
            Tách thành {parts.length} lượt
          </button>
        </>
      }
    >
      <div className="rounded-lg border border-brand-500/25 bg-brand-500/8 p-3 text-[12.5px] text-ink-200 leading-relaxed mb-4">
        Đặt con trỏ vào chỗ đổi người nói trong ô nội dung rồi bấm <b>Tách tại đây</b>. Mốc thời gian được ước
        lượng theo vị trí chữ — muốn chính xác thì phát video tới đúng thời điểm rồi bấm{' '}
        <b>Lấy từ video</b>.
      </div>

      <div className="flex flex-col gap-3">
        {parts.map((p, i) => {
          const sp = spMap.get(p.speakerId)
          return (
            <div
              key={i}
              className={`rounded-xl border p-3 transition-colors ${
                i === activeIdx ? 'border-brand-500/60 bg-ink-850/70' : 'border-ink-800 bg-ink-850/30'
              }`}
              onClick={() => setActiveIdx(i)}
            >
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-[11px] font-mono uppercase tracking-wider text-ink-500">Phần {i + 1}</span>

                <select
                  className="input h-7 !py-0 w-auto text-[12.5px]"
                  value={p.speakerId}
                  onChange={(e) => setPart(i, { speakerId: e.target.value })}
                  style={{ color: sp?.color ?? undefined }}
                >
                  {speakers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>

                {i > 0 ? (
                  <span className="flex items-center gap-1.5">
                    <input
                      className="input h-7 !py-0 w-[86px] text-[12px] font-mono tabular-nums"
                      value={showTime(p.start)}
                      onChange={(e) => setBoundary(i, parseTime(e.target.value, p.start))}
                      title="Thời điểm bắt đầu phần này"
                    />
                    <button
                      className="btn-ghost h-7 !px-2 text-[11.5px]"
                      onClick={() => setBoundary(i, currentTime)}
                      title={`Đặt mốc = vị trí video đang dừng (${showTime(currentTime)})`}
                    >
                      <Wand2 size={12} />
                      Lấy từ video
                    </button>
                  </span>
                ) : (
                  <span className="text-[12px] font-mono text-ink-500 tabular-nums">
                    bắt đầu {showTime(p.start)}
                  </span>
                )}

                <button
                  className="btn-ghost h-7 !px-2 text-[11.5px]"
                  onClick={() => {
                    onSeek(p.start)
                    onPlayRange(p.start, p.end)
                  }}
                  title="Nghe lại đúng đoạn này"
                >
                  <Play size={12} />
                  Nghe
                </button>

                <span className="grow" />

                {parts.length > 1 && (
                  <button
                    className="btn-ghost h-7 w-7 !px-0 text-ink-500 hover:text-red-300"
                    onClick={() => removePart(i)}
                    title="Bỏ phần này, gộp chữ về phần trước"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              <textarea
                className="textarea text-[13px] min-h-[62px]"
                value={p.text}
                onFocus={(e) => {
                  setActiveIdx(i)
                  trackCaret(e)
                }}
                onSelect={trackCaret}
                onKeyUp={trackCaret}
                onClick={trackCaret}
                onChange={(e) => {
                  setPart(i, { text: e.target.value })
                  trackCaret(e)
                }}
              />

              {i === activeIdx && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <button
                    className="btn-outline h-7 text-[12px]"
                    onClick={splitAtCaret}
                    disabled={!canSplitHere}
                    title={
                      canSplitHere
                        ? 'Cắt phần này làm đôi ngay tại con trỏ'
                        : 'Đặt con trỏ vào giữa nội dung trước đã'
                    }
                  >
                    <Plus size={12} />
                    Tách tại đây
                  </button>
                  {canSplitHere ? (
                    <span className="text-[11.5px] text-ink-400 truncate">
                      cắt sau: <span className="text-ink-200">…{p.text.slice(Math.max(0, caret - 18), caret)}</span>
                      <span className="text-brand-300 font-bold mx-0.5">|</span>
                      <span className="text-ink-200">{p.text.slice(caret, caret + 18)}…</span>
                    </span>
                  ) : (
                    <span className="text-[11.5px] text-ink-500">Bấm chuột vào chỗ đổi người nói trong ô trên</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!valid && (
        <p className="hint mt-3 text-amber-300/90">
          Cần ít nhất 2 phần và phần nào cũng phải có nội dung.
        </p>
      )}
    </Modal>
  )
}
