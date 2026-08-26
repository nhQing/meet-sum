import { useMemo, useState } from 'react'
import { FilePlus2, Search, Trash2, Users, Clock, FileText } from 'lucide-react'
import type { ProjectSummaryRow } from '../../../shared/types'
import { STATUS_LABEL, STATUS_TONE, formatDate, formatDuration } from '../lib/format'

export default function Sidebar({
  rows,
  activeId,
  onSelect,
  onImport,
  onDelete,
  importing
}: {
  rows: ProjectSummaryRow[]
  activeId: string | null
  onSelect: (id: string) => void
  onImport: () => void
  onDelete: (id: string) => void
  importing: boolean
}): JSX.Element {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(q))
  }, [rows, query])

  return (
    <aside className="w-[286px] shrink-0 h-full flex flex-col border-r border-ink-800 bg-ink-900/60">
      <div className="p-3 space-y-2.5">
        <button className="btn-primary w-full" onClick={onImport} disabled={importing}>
          <FilePlus2 size={15} />
          Nhập video cuộc họp
        </button>
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
