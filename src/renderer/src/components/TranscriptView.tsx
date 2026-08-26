import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpToLine, Check, Crosshair, Pencil, Replace, Scissors, Search, Trash2, X } from 'lucide-react'
import type { Project, TranscriptSegment } from '../../../shared/types'
import { formatTime } from '../lib/format'

/** macOS quen dùng ⌘, Windows/Linux dùng Ctrl. */
const modKey =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? '⌘'
    : 'Ctrl'

export default function TranscriptView({
  project,
  currentTime,
  onSeek,
  onEditText,
  onReassign,
  onSpeakerClick,
  onSplit,
  onDelete,
  onMergeUp,
  onReplaceAll
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
  onReplaceAll: (find: string, replaceWith: string, opts: { caseSensitive: boolean; wholeWord: boolean }) => Promise<number>
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [follow, setFollow] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [replacing, setReplacing] = useState(false)
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

  /** Đếm trước số chỗ sẽ bị thay, để không phải thay xong mới biết. */
  const matchCount = useMemo(() => {
    if (!findText) return 0
    try {
      const esc = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(
        wholeWord ? `(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])` : esc,
        caseSensitive ? 'gu' : 'giu'
      )
      return project.segments.reduce((n, sg) => n + (sg.text.match(re)?.length ?? 0), 0)
    } catch {
      return 0
    }
  }, [project.segments, findText, caseSensitive, wholeWord])

  const activeId = useMemo(() => {
    const hit = project.segments.find((s) => currentTime >= s.start && currentTime < s.end)
    return hit?.id ?? null
  }, [project.segments, currentTime])

  useEffect(() => {
    if (!follow || !activeRef.current) return
    activeRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeId, follow])

  // Phím tắt toàn cục ở App gửi xuống đây qua custom event
  useEffect(() => {
    const onToggleReplace = (): void => setShowReplace((v) => !v)
    const onEditSegment = (e: Event): void => {
      const id = (e as CustomEvent<string>).detail
      const seg = project.segments.find((x) => x.id === id)
      if (seg) {
        setEditingId(seg.id)
        setDraft(seg.text)
      }
    }
    window.addEventListener('meetsum:toggle-replace', onToggleReplace)
    window.addEventListener('meetsum:edit-segment', onEditSegment)
    return () => {
      window.removeEventListener('meetsum:toggle-replace', onToggleReplace)
      window.removeEventListener('meetsum:edit-segment', onEditSegment)
    }
  }, [project.segments])

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
            id="transcript-search"
            className="input pl-8 pr-8 h-8"
            placeholder="Tìm trong hội thoại... (Ctrl+F)"
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
        <button
          className={`btn h-8 !px-2.5 text-[12px] border ${
            showReplace
              ? 'bg-brand-600/20 border-brand-600/60 text-brand-200'
              : 'border-ink-700 text-ink-300 hover:bg-ink-800'
          }`}
          onClick={() => setShowReplace((v) => !v)}
          title="Thay tất cả — sửa một chữ AI nghe sai trong toàn bộ bản bóc băng"
        >
          <Replace size={13} />
          Thay thế
        </button>
        <span className="text-[11.5px] text-ink-500 tabular-nums shrink-0">
          {filtered.length}/{project.segments.length}
        </span>
      </div>

      {showReplace && (
        <div className="px-3 py-2.5 border-b border-ink-800 bg-ink-850/40 flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              className="input h-8 text-[13px] flex-1 min-w-[150px]"
              placeholder="Chữ AI nghe sai (vd: mai money)"
              value={findText}
              autoFocus
              onChange={(e) => setFindText(e.target.value)}
            />
            <span className="text-ink-500 shrink-0">→</span>
            <input
              className="input h-8 text-[13px] flex-1 min-w-[150px]"
              placeholder="Sửa thành (vd: MaiMoney)"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
            />
            <button
              className="btn-primary h-8 shrink-0"
              disabled={!findText || matchCount === 0 || replacing}
              onClick={async () => {
                setReplacing(true)
                try {
                  await onReplaceAll(findText, replaceText, { caseSensitive, wholeWord })
                  setFindText('')
                  setReplaceText('')
                } finally {
                  setReplacing(false)
                }
              }}
            >
              Thay {matchCount > 0 ? matchCount : ''} chỗ
            </button>
          </div>
          <div className="flex items-center gap-4 text-[12px] text-ink-400">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
              Phân biệt chữ hoa
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
              Đúng cả từ
            </label>
            {findText && (
              <span className={matchCount ? 'text-brand-300' : 'text-ink-500'}>
                {matchCount ? `tìm thấy ${matchCount} chỗ` : 'không tìm thấy chỗ nào'}
              </span>
            )}
          </div>
        </div>
      )}

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
                  <div>
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
                      <div className="flex flex-col gap-1 shrink-0">
                        <button
                          className="btn-primary h-8 w-8 !px-0"
                          onClick={() => void commitEdit(seg)}
                          title="Lưu"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          className="btn-ghost h-8 w-8 !px-0 text-ink-500 hover:text-ink-200"
                          onClick={() => setEditingId(null)}
                          title="Huỷ"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                    <p className="hint mt-1">
                      Nghe lại đoạn này bằng nút thời gian bên trái · <b>{modKey}+Enter</b> để lưu ·{' '}
                      <b>Esc</b> để huỷ
                    </p>
                  </div>
                ) : (
                  <p
                    className={`text-[13.5px] leading-relaxed cursor-text decoration-dotted underline-offset-4
                                group-hover:underline group-hover:decoration-ink-600 ${
                                  lowConf ? 'text-ink-300' : 'text-ink-100'
                                }`}
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
                  onClick={() => startEdit(seg)}
                  title="Sửa nội dung câu (hoặc nhấn đúp vào chữ)"
                >
                  <Pencil size={13} />
                </button>
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
