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
      title="Xuất báo cáo PDF"
      subtitle="Báo cáo gồm tóm tắt, người tham gia, quyết định, việc cần làm và (tuỳ chọn) toàn bộ bản bóc băng."
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
