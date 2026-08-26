import { useEffect, useState } from 'react'
import { Check, Copy, FolderOpen, Info, Share2, TriangleAlert } from 'lucide-react'
import type { ProjectSummaryRow } from '../../../shared/types'
import { formatDate, formatTime } from '../lib/format'
import { Field, Modal, Spinner, Toggle } from './Ui'

/**
 * Xuất một file .meetsum để gửi qua Teams/Zalo/Drive.
 *
 * App không có server nên "chia sẻ" = tạo một file rồi mở sẵn thư mục chứa nó,
 * để người dùng kéo thẳng vào cửa sổ chat hoặc thư mục Drive đã sync. Không cần
 * đăng ký app, không cần token, không có gì đi qua máy chủ của ai.
 */
export default function ShareDialog({
  open,
  rows,
  currentId,
  onClose,
  notify
}: {
  open: boolean
  rows: ProjectSummaryRow[]
  currentId: string | null
  onClose: () => void
  notify: (msg: string, tone?: 'ok' | 'err' | 'info') => void
}): JSX.Element {
  const [picked, setPicked] = useState<string[]>([])
  const [includeNotes, setIncludeNotes] = useState(false)
  const [by, setBy] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ path: string; meetings: number; speakers: number } | null>(null)

  // Chỉ chia sẻ được cuộc họp đã có nội dung
  const usable = rows.filter((r) => r.segmentCount > 0)

  useEffect(() => {
    if (!open) return
    setDone(null)
    setBusy(false)
    setPicked(currentId && usable.some((r) => r.id === currentId) ? [currentId] : [])
  }, [open, currentId])

  const toggle = (id: string): void =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const doExport = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.api.bundle.export(picked, { includeNotes, exportedBy: by })
      if (res) setDone(res)
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Chia sẻ cuộc họp"
      subtitle="Tạo một file gửi qua Teams, Zalo, Drive… Người nhận nhập vào là có ngay bản bóc băng, không phải chạy lại."
      onClose={onClose}
      width="max-w-2xl"
      footer={
        done ? (
          <button className="btn-primary" onClick={onClose}>
            Xong
          </button>
        ) : (
          <>
            <button className="btn-ghost" onClick={onClose}>
              Huỷ
            </button>
            <button className="btn-primary" disabled={!picked.length || busy} onClick={doExport}>
              {busy ? <Spinner size={13} /> : <Share2 size={14} />}
              Tạo file chia sẻ{picked.length > 1 ? ` (${picked.length} cuộc họp)` : ''}
            </button>
          </>
        )
      }
    >
      {done ? (
        <div>
          <p className="text-[13px] text-emerald-300 flex items-center gap-1.5 mb-3">
            <Check size={15} />
            Đã tạo file: {done.meetings} cuộc họp, {done.speakers} giọng nói trong danh bạ.
          </p>
          <div className="rounded-lg border border-ink-800 bg-ink-850/60 px-3 py-2.5 mb-3">
            <div className="text-[11px] uppercase tracking-wider text-ink-500 mb-1">Đường dẫn file</div>
            <div className="font-mono text-[12px] text-ink-200 break-all">{done.path}</div>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              className="btn-outline"
              onClick={() => {
                void window.api.system.showInFolder(done.path)
              }}
            >
              <FolderOpen size={13} />
              Mở thư mục chứa file
            </button>
            <button
              className="btn-outline"
              onClick={() => {
                void window.api.system.copyText(done.path)
                notify('Đã copy đường dẫn.', 'ok')
              }}
            >
              <Copy size={13} />
              Copy đường dẫn
            </button>
          </div>
          <p className="hint">
            Kéo file từ thư mục vừa mở vào cửa sổ chat Teams/Zalo, hoặc bỏ vào thư mục Google
            Drive/OneDrive đã sync trên máy. Người nhận mở MeetSum → <b>Nhập gói</b> → chọn file này.
          </p>
        </div>
      ) : (
        <div>
          <Field label={`Chọn cuộc họp để gửi (${picked.length}/${usable.length})`}>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-800 divide-y divide-ink-800">
              {usable.length === 0 && (
                <p className="hint p-3">
                  Chưa có cuộc họp nào đã bóc băng. Bóc băng xong mới có nội dung để chia sẻ.
                </p>
              )}
              {usable.map((r) => (
                <button
                  key={r.id}
                  className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                    picked.includes(r.id) ? 'bg-brand-600/15' : 'hover:bg-ink-850'
                  }`}
                  onClick={() => toggle(r.id)}
                >
                  <span
                    className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center ${
                      picked.includes(r.id) ? 'bg-brand-600 border-brand-600' : 'border-ink-600'
                    }`}
                  >
                    {picked.includes(r.id) && <Check size={11} className="text-white" />}
                  </span>
                  <span className="min-w-0 grow">
                    <span className="block text-[13px] text-ink-100 truncate">{r.name}</span>
                    <span className="block hint">
                      {formatDate(r.createdAt)} · {r.segmentCount} lượt nói · {r.speakerCount} người
                      {r.durationSec ? ` · ${formatTime(r.durationSec)}` : ''}
                      {r.hasSummary ? ' · có tóm tắt' : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Tên người gửi (không bắt buộc)" hint="Hiện lên khi người nhận xem trước gói.">
            <input
              className="input"
              placeholder="Ví dụ: Quỳnh — MaiMoney"
              value={by}
              onChange={(e) => setBy(e.target.value)}
            />
          </Field>

          <Toggle
            checked={includeNotes}
            onChange={setIncludeNotes}
            label="Kèm cả phần Ghi chú riêng của tôi"
            hint="Mặc định TẮT. Ghi chú là sổ tay cá nhân, thường không nên đi ra khỏi máy."
          />

          <div className="rounded-lg border border-ink-800 bg-ink-850/50 px-3 py-2.5 mb-3">
            <p className="text-[12.5px] text-ink-300 flex items-start gap-1.5">
              <Info size={13} className="shrink-0 mt-0.5 text-brand-300" />
              <span>
                File gồm <b>hội thoại, tên người nói, bản tóm tắt và mẫu giọng nói</b>. Kèm mẫu giọng
                để máy người nhận cũng tự nhận ra đúng người ở những cuộc họp sau của họ.
                <br />
                <b>Không kèm video</b> — một cuộc họp 1 tiếng chỉ ra file vài trăm KB.
              </span>
            </p>
          </div>

          <p className="text-[12.5px] text-amber-300 flex items-start gap-1.5">
            <TriangleAlert size={13} className="shrink-0 mt-0.5" />
            <span>
              Nội dung nằm dạng chữ thường trong file, ai mở cũng đọc được. Đừng gửi qua kênh mà bạn
              không gửi chính cuộc họp đó qua.
            </span>
          </p>
        </div>
      )}
    </Modal>
  )
}
