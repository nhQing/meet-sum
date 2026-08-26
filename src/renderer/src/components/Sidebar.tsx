import { useMemo, useState } from 'react'
import { Clock, Download, FilePlus2, FileText, ListPlus, Search, Share2, Trash2, Users, X } from 'lucide-react'
import { Spinner } from './Ui'
import type { ProjectSummaryRow } from '../../../shared/types'
import { STATUS_LABEL, STATUS_TONE, formatDate, formatDuration } from '../lib/format'

export default function Sidebar({
  rows,
  activeId,
  onSelect,
  onImport,
  onImportBundle,
  onDelete,
  importing,
  queueIds,
  onQueueAll,
  onClearQueue
}: {
  rows: ProjectSummaryRow[]
  activeId: string | null
  onSelect: (id: string) => void
  onImport: () => void
  onImportBundle: () => void
  onDelete: (id: string) => void
  importing: boolean
  queueIds: string[]
  onQueueAll: (ids: string[]) => Promise<void>
  onClearQueue: () => Promise<void>
}): JSX.Element {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(q))
  }, [rows, query])

  // Những cuộc họp chưa có hội thoại, hoặc đang tạm dừng dở — đáng để xếp hàng chạy qua đêm
  const pending = rows.filter(
    (r) => !queueIds.includes(r.id) && (r.status === 'new' || r.status === 'paused' || r.status === 'error')
  )

  return (
    <aside className="w-[286px] shrink-0 h-full flex flex-col border-r border-ink-800 bg-ink-900/60">
      <div className="p-3 space-y-2.5">
        <button className="btn-primary w-full" onClick={onImport} disabled={importing}>
          <FilePlus2 size={15} />
          Nhập video cuộc họp
        </button>

        <button
          className="btn-outline w-full text-[12.5px]"
          onClick={onImportBundle}
          title="Mở file .meetsum đồng nghiệp gửi qua Teams/Zalo/Drive — có sẵn bản bóc băng, không phải chạy lại"
        >
          <Download size={14} />
          Nhập gói được chia sẻ
        </button>

        {pending.length > 1 && (
          <button
            className="btn-outline w-full text-[12.5px]"
            onClick={() => void onQueueAll(pending.map((r) => r.id))}
            title="Xếp hàng chạy lần lượt, mỗi lúc một video — bật rồi để đó"
          >
            <ListPlus size={14} />
            Bóc băng tất cả ({pending.length})
          </button>
        )}

        {queueIds.length > 0 && (
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-2 text-[12px]">
            <div className="flex items-center gap-1.5 text-violet-200">
              <Spinner size={11} />
              <span className="font-medium">Hàng đợi: {queueIds.length}</span>
              <span className="grow" />
              <button className="text-ink-400 hover:text-red-300" onClick={() => void onClearQueue()} title="Bỏ hàng đợi">
                <X size={13} />
              </button>
            </div>
            <p className="text-ink-400 mt-1 leading-snug">Chạy lần lượt, mỗi lúc một video.</p>
          </div>
        )}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            className="input pl-8"
            placeholder="Tìm cuộc họp..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="px-3 pb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
          Cuộc họp ({rows.length})
        </span>
      </div>

      <div className="grow overflow-y-auto px-2 pb-3 space-y-1.5">
        {filtered.length === 0 && (
          <p className="hint px-2 py-6 text-center">
            {rows.length ? 'Không tìm thấy cuộc họp nào.' : 'Chưa có cuộc họp. Nhập video để bắt đầu.'}
          </p>
        )}
        {filtered.map((r) => {
          const active = r.id === activeId
          return (
            <div
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={`group relative rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                active
                  ? 'bg-ink-800 border-brand-600/60'
                  : 'bg-ink-900 border-ink-800 hover:border-ink-700 hover:bg-ink-850'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[13px] font-medium leading-snug line-clamp-2 pr-1">{r.name}</h3>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-ink-500 hover:text-red-400 shrink-0 mt-0.5"
                  title="Xoá cuộc họp"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(r.id)
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-ink-400">
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} />
                  {formatDuration(r.durationSec)}
                </span>
                {r.speakerCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Users size={11} />
                    {r.speakerCount}
                  </span>
                )}
                {r.segmentCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <FileText size={11} />
                    {r.segmentCount}
                  </span>
                )}
                {r.shared && (
                  <span
                    className="inline-flex items-center gap-1 text-brand-300"
                    title="Nhập từ gói chia sẻ — không bóc băng trên máy này"
                  >
                    <Share2 size={11} />
                    chia sẻ
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className={`pill ${STATUS_TONE[r.status] ?? 'bg-ink-800 text-ink-300'}`}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
                <span className="text-[10.5px] text-ink-500">{formatDate(r.updatedAt)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
