import { useState } from 'react'
import { FileDown, FolderOpen } from 'lucide-react'
import type { Project } from '../../../shared/types'
import { Modal, Spinner, Toggle } from './Ui'

export default function ExportDialog({
  open,
  project,
  onClose,
  onDone
}: {
  open: boolean
  project: Project
  onClose: () => void
  onDone: (msg: string, tone: 'ok' | 'err') => void
}): JSX.Element {
  const [includeTranscript, setIncludeTranscript] = useState(true)
  const [includeTimestamps, setIncludeTimestamps] = useState(true)
  const [busy, setBusy] = useState(false)
  const [lastPath, setLastPath] = useState('')

  const exportOther = async (format: 'docx' | 'srt' | 'vtt' | 'md' | 'txt'): Promise<void> => {
    setBusy(true)
    try {
      const out = await window.api.exporter.file(project.id, format, { includeTranscript, includeTimestamps })
      if (!out) return
      setLastPath(out)
      onDone(`Đã xuất ${format.toUpperCase()}: ${out}`, 'ok')
    } catch (e) {
      onDone((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const exportPdf = async (chooseLocation: boolean): Promise<void> => {
    setBusy(true)
    try {
      let target: string | undefined
      if (chooseLocation) {
        const suggested = `${(project.summary?.title || project.name).replace(/[\\/:*?"<>|]/g, '_')}.pdf`
        target = await window.api.dialog.pickSavePdf(suggested)
        if (!target) return
      }
      const out = await window.api.exporter.pdf(project.id, { includeTranscript, includeTimestamps }, target)
      setLastPath(out)
      onDone(`Đã xuất PDF: ${out}`, 'ok')
    } catch (e) {
      onDone((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Xuất kết quả"
      subtitle="Chọn định dạng phù hợp với việc bạn định làm tiếp — gửi đi, sửa tiếp, hay gắn phụ đề lên video."
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Đóng
          </button>
          <button className="btn-outline" onClick={() => void exportPdf(false)} disabled={busy}>
            Lưu vào thư mục app
          </button>
          <button className="btn-primary" onClick={() => void exportPdf(true)} disabled={busy}>
            {busy ? <Spinner size={13} /> : <FileDown size={14} />}
            Chọn nơi lưu...
          </button>
        </>
      }
    >
      <Toggle
        checked={includeTranscript}
        onChange={setIncludeTranscript}
        label="Kèm bản bóc băng đầy đủ"
        hint={`${project.segments.length} lượt nói sẽ được in kèm sau phần tóm tắt.`}
      />
      <Toggle
        checked={includeTimestamps}
        onChange={setIncludeTimestamps}
        label="Hiện mốc thời gian"
        hint="Tắt đi nếu muốn báo cáo gọn như biên bản họp."
      />
      <div className="mt-4">
        <div className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-400 mb-2 pb-1.5 border-b border-ink-800">
          Định dạng khác
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['docx', 'Word (.docx)', 'Gửi cấp trên, sửa tiếp được'],
              ['srt', 'Phụ đề (.srt)', 'Gắn lại lên video'],
              ['md', 'Markdown (.md)', 'Dán vào Notion, wiki'],
              ['txt', 'Text thuần (.txt)', 'Dán vào chat, email'],
              ['vtt', 'Phụ đề web (.vtt)', 'Cho player trên web']
            ] as const
          ).map(([fmt, label, why]) => (
            <button
              key={fmt}
              className="text-left rounded-lg border border-ink-800 bg-ink-850/40 hover:bg-ink-850 hover:border-ink-700 px-3 py-2 transition-colors disabled:opacity-50"
              onClick={() => void exportOther(fmt)}
              disabled={busy}
            >
              <div className="text-[12.5px] font-medium text-ink-100">{label}</div>
              <div className="text-[11px] text-ink-500">{why}</div>
            </button>
          ))}
        </div>
      </div>

      {!project.summary && (
        <p className="hint rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200">
          Cuộc họp này chưa có tóm tắt. PDF sẽ chỉ gồm phần bản bóc băng.
        </p>
      )}
      {lastPath && (
        <button className="btn-ghost mt-3 !px-0 text-brand-300" onClick={() => void window.api.system.showInFolder(lastPath)}>
          <FolderOpen size={14} />
          Mở thư mục chứa file vừa xuất
        </button>
      )}
    </Modal>
  )
}
