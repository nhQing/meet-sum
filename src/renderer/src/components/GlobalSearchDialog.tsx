import { useEffect, useMemo, useState } from 'react'
import { Brain, MessageSquare, Search } from 'lucide-react'
import type { SearchHit } from '../../../preload'
import { formatDate, formatTime } from '../lib/format'
import { Modal, Spinner } from './Ui'

/**
 * Tìm trong nội dung của TẤT CẢ cuộc họp — ô tìm ở sidebar chỉ lọc theo tên file.
 * Càng dùng lâu thì đây càng là giá trị chính: "ai nói gì về KYC ba tháng nay".
 */
export default function GlobalSearchDialog({
  open,
  initialQuery,
  onClose,
  onJump
}: {
  open: boolean
  initialQuery: string
  onClose: () => void
  onJump: (projectId: string, start: number) => void
}): JSX.Element {
  const [query, setQuery] = useState(initialQuery)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [ran, setRan] = useState(false)

  useEffect(() => {
    if (open) setQuery(initialQuery)
  }, [open, initialQuery])

  // Gõ xong nghỉ 250ms mới tìm, tránh quét lại toàn bộ dự án sau mỗi ký tự
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      setRan(false)
      return
    }
    let alive = true
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const res = await window.api.search.all(q)
        if (alive) {
          setHits(res)
          setRan(true)
        }
      } finally {
        if (alive) setBusy(false)
      }
    }, 250)
    return () => {
      alive = false
      clearTimeout(t)
      setBusy(false)
    }
  }, [query, open])

  /** Nhóm theo cuộc họp để đọc dễ hơn danh sách phẳng. */
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; createdAt: string; items: SearchHit[] }>()
    for (const h of hits) {
      const g = map.get(h.projectId) ?? { name: h.projectName, createdAt: h.createdAt, items: [] }
      g.items.push(h)
      map.set(h.projectId, g)
    }
    return [...map.entries()].sort((a, b) => (a[1].createdAt < b[1].createdAt ? 1 : -1))
  }, [hits])

  const highlight = (text: string): JSX.Element => {
    const q = query.trim()
    const at = text.toLowerCase().indexOf(q.toLowerCase())
    if (at < 0 || !q) return <>{text}</>
    return (
      <>
        {text.slice(0, at)}
        <mark className="bg-brand-500/30 text-brand-100 rounded px-0.5">{text.slice(at, at + q.length)}</mark>
        {text.slice(at + q.length)}
      </>
    )
  }

  return (
    <Modal
      open={open}
      title="Tìm trong tất cả cuộc họp"
      subtitle="Quét nội dung hội thoại và bản tóm tắt của mọi cuộc họp đã lưu."
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <button className="btn-ghost" onClick={onClose}>
          Đóng
        </button>
      }
    >
      <div className="relative mb-4">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
        <input
          className="input pl-9"
          placeholder="Nhập từ khoá, tên người, thuật ngữ… (ít nhất 2 ký tự)"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        {busy && <Spinner size={13} className="absolute right-3 top-1/2 -translate-y-1/2" />}
      </div>

      {query.trim().length >= 2 && ran && hits.length === 0 && (
        <p className="hint py-8 text-center">Không tìm thấy “{query.trim()}” trong cuộc họp nào.</p>
      )}

      {hits.length > 0 && (
        <>
          <p className="hint mb-2.5">
            {hits.length} kết quả trong {grouped.length} cuộc họp
            {hits.length >= 200 && ' (đã giới hạn 200 kết quả đầu)'}
          </p>
          <div className="flex flex-col gap-3.5">
            {grouped.map(([projectId, g]) => (
              <section key={projectId}>
                <div className="flex items-baseline gap-2 mb-1.5">
                  <h3 className="text-[13px] font-semibold text-ink-100">{g.name}</h3>
                  <span className="text-[11px] text-ink-500">{formatDate(g.createdAt)}</span>
                  <span className="text-[11px] text-ink-500">· {g.items.length} chỗ</span>
                </div>
                <div className="flex flex-col gap-1">
                  {g.items.slice(0, 8).map((h, i) => (
                    <button
                      key={i}
                      className="text-left rounded-lg border border-ink-800 bg-ink-850/40 hover:bg-ink-850 hover:border-ink-700 px-3 py-2 transition-colors"
                      onClick={() => {
                        onJump(h.projectId, h.start)
                        onClose()
                      }}
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        {h.inSummary ? (
                          <Brain size={11} className="text-violet-300 shrink-0" />
                        ) : (
                          <MessageSquare size={11} className="text-ink-500 shrink-0" />
                        )}
                        <span className="text-[11.5px] font-medium text-ink-300">{h.speaker}</span>
                        {!h.inSummary && (
                          <span className="text-[11px] font-mono text-ink-500">{formatTime(h.start)}</span>
                        )}
                      </div>
                      <p className="text-[12.5px] text-ink-200 leading-snug">…{highlight(h.snippet)}…</p>
                    </button>
                  ))}
                  {g.items.length > 8 && (
                    <p className="hint pl-1">còn {g.items.length - 8} chỗ nữa trong cuộc họp này</p>
                  )}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
