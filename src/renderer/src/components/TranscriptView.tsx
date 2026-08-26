import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpToLine, Check, Crosshair, Scissors, Search, Trash2, X } from 'lucide-react'
import type { Project, TranscriptSegment } from '../../../shared/types'
import { formatTime } from '../lib/format'

export default function TranscriptView({
  project,
  currentTime,
  onSeek,
  onEditText,
  onReassign,
  onSpeakerClick,
  onSplit,
  onDelete,
  onMergeUp
}: {
  project: Project
  currentTime: number
  onSeek: (t: number) => void
  onEditText: (segmentId: string, text: string) => Promise<void>
  onReassign: (segmentId: string, speakerId: string) => Promise<void>
  onSpeakerClick: (speakerId: string) => void
  onSplit: (seg: TranscriptSegment) => void
  onDelete: (seg: TranscriptSegment) => Promise<void>
  onMergeUp: (seg: TranscriptSegment) => Promise<void>
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [follow, setFollow] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)

  const speakerMap = useMemo(() => new Map(project.speakers.map((s) => [s.id, s])), [project.speakers])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return project.segments
    return project.segments.filter(
      (s) => s.text.toLowerCase().includes(q) || (speakerMap.get(s.speakerId)?.name ?? '').toLowerCase().includes(q)
    )
  }, [project.segments, query, speakerMap])

  const activeId = useMemo(() => {
    const hit = project.segments.find((s) => currentTime >= s.start && currentTime < s.end)
    return hit?.id ?? null
  }, [project.segments, currentTime])

  useEffect(() => {
    if (!follow || !activeRef.current) return
    activeRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeId, follow])

  const startEdit = (seg: TranscriptSegment): void => {
    setEditingId(seg.id)
    setDraft(seg.text)
  }

  const commitEdit = async (seg: TranscriptSegment): Promise<void> => {
    const text = draft.trim()
    setEditingId(null)
    if (text && text !== seg.text) await onEditText(seg.id, text)
  }

  return (
    <div className="card flex flex-col min-h-0 grow">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-ink-800">
        <div className="relative grow">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            className="input pl-8 pr-8 h-8"
            placeholder="Tìm trong hội thoại..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-500 hover:text-ink-200"
              onClick={() => setQuery('')}
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          className={`btn h-8 !px-2.5 text-[12px] border ${
            follow ? 'bg-brand-600/20 border-brand-600/60 text-brand-200' : 'border-ink-700 text-ink-300 hover:bg-ink-800'
          }`}
          onClick={() => setFollow((v) => !v)}
          title="Tự động cuộn theo video"
        >
          <Crosshair size={13} />
          Theo video
        </button>
        <span className="text-[11.5px] text-ink-500 tabular-nums shrink-0">
          {filtered.length}/{project.segments.length}
        </span>
      </div>

      <div ref={listRef} className="grow overflow-y-auto min-h-0">
        {filtered.length === 0 && (
          <p className="hint text-center py-10">
            {project.segments.length ? 'Không tìm thấy nội dung khớp.' : 'Chưa có hội thoại. Hãy bấm “Bóc băng”.'}
          </p>
        )}

        {filtered.map((seg) => {
          const sp = speakerMap.get(seg.speakerId)
          const isActive = seg.id === activeId
          const lowConf = (seg.confidence ?? 1) < 0.5
          return (
            <div
              key={seg.id}
              ref={isActive ? activeRef : undefined}
              className={`group flex gap-2.5 px-3 py-2 border-b border-ink-850/70 transition-colors cursor-pointer ${
                isActive ? 'bg-brand-500/10' : 'hover:bg-ink-850/50'
              }`}
              title="Bấm để tua video tới đoạn này"
              onClick={(e) => {
                // Bỏ qua khi bấm vào nút / ô chọn / vùng đang sửa
                const el = e.target as HTMLElement
                if (el.closest('button, select, textarea, input')) return
                onSeek(seg.start)
              }}
            >
              <button
                className="shrink-0 w-[46px] text-left text-[11.5px] font-mono tabular-nums text-ink-500 hover:text-brand-300 pt-0.5"
                onClick={() => onSeek(seg.start)}
                title="Nhảy tới thời điểm này"
              >
                {formatTime(seg.start)}
              </button>

              <div className="shrink-0 w-[124px]">
                <button
                  className="inline-flex items-center gap-1.5 max-w-full text-[12.5px] font-semibold hover:underline"
                  style={{ color: sp?.color ?? '#8892a4' }}
                  onClick={() => onSpeakerClick(seg.speakerId)}
                  title="Click để đặt tên / sửa người nói"
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: sp?.color ?? '#8892a4' }} />
                  <span className="truncate">{sp?.name ?? 'unknown'}</span>
                </button>
                <select
                  className="mt-1 w-full h-6 rounded bg-ink-850 border border-ink-700 text-[11px] text-ink-300 opacity-0 group-hover:opacity-100 transition-opacity outline-none"
                  value={seg.speakerId}
                  onChange={(e) => void onReassign(seg.id, e.target.value)}
                  title="Đổi người nói cho lượt này"
                >
                  {project.speakers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grow min-w-0">
                {editingId === seg.id ? (
                  <div className="flex gap-2 items-start">
                    <textarea
                      className="textarea text-[13px] min-h-[64px]"
                      value={draft}
                      autoFocus
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void commitEdit(seg)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                    />
                    <button className="btn-primary h-8 w-8 !px-0 shrink-0" onClick={() => void commitEdit(seg)}>
                      <Check size={14} />
                    </button>
                  </div>
                ) : (
                  <p
                    className={`text-[13.5px] leading-relaxed cursor-text ${lowConf ? 'text-ink-300' : 'text-ink-100'}`}
                    onDoubleClick={() => startEdit(seg)}
                    title="Nhấn đúp để sửa nội dung"
                  >
                    {seg.text}
                    {seg.edited && <span className="ml-1.5 text-[10px] text-ink-500 align-middle">(đã sửa)</span>}
                    {lowConf && (
                      <span className="ml-1.5 text-[10px] text-amber-400/80 align-middle" title="Độ tin cậy gán người nói thấp">
                        ?
                      </span>
                    )}
                  </p>
                )}
              </div>

              <div className="shrink-0 flex items-start gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  className="btn-ghost h-7 w-7 !px-0 text-ink-500 hover:text-brand-300"
                  onClick={() => onSplit(seg)}
                  title="Tách lượt này thành nhiều người nói"
                >
                  <Scissors size={13} />
                </button>
                <button
                  className="btn-ghost h-7 w-7 !px-0 text-ink-500 hover:text-brand-300"
                  onClick={() => void onMergeUp(seg)}
                  title="Gộp vào lượt phía trên"
                >
                  <ArrowUpToLine size={13} />
                </button>
                <button
                  className="btn-ghost h-7 w-7 !px-0 text-ink-500 hover:text-red-300"
                  onClick={() => void onDelete(seg)}
                  title="Xoá lượt này"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
