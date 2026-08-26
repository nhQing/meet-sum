import { useEffect, useState } from 'react'
import { Check, Download, FileJson, Info, MessageSquare, TriangleAlert, Users } from 'lucide-react'
import type { BundleInfo } from '../../../shared/types'
import { formatDate, formatTime } from '../lib/format'
import { Modal, Spinner, Toggle } from './Ui'

/**
 * Nhập gói .meetsum của người khác.
 *
 * Luôn XEM TRƯỚC rồi mới nhập: người dùng phải thấy trong gói có gì, ai gửi,
 * có kèm mẫu giọng nói không, cuộc họp nào đã nhập rồi — trước khi cho nó ghi
 * vào dữ liệu của mình.
 */
export default function ImportBundleDialog({
  open,
  info,
  onClose,
  onImported,
  notify
}: {
  open: boolean
  info: BundleInfo | null
  onClose: () => void
  onImported: (firstProjectId: string | null) => void
  notify: (msg: string, tone?: 'ok' | 'err' | 'info') => void
}): JSX.Element {
  const [picked, setPicked] = useState<string[]>([])
  const [withVoices, setWithVoices] = useState(true)
  const [busy, setBusy] = useState(false)

  // Mặc định tick những cuộc họp CHƯA nhập; cái đã nhập rồi để người dùng tự bật
  useEffect(() => {
    if (!open || !info) return
    setPicked(info.meetings.filter((m) => !m.existingProjectId).map((m) => m.id))
    setWithVoices(info.includesVoiceprints)
    setBusy(false)
  }, [open, info])

  const dupes = info?.meetings.filter((m) => m.existingProjectId).length ?? 0

  const toggle = (id: string): void =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  const doImport = async (): Promise<void> => {
    if (!info) return
    setBusy(true)
    try {
      const res = await window.api.bundle.import(info.path, {
        select: picked,
        importVoiceprints: withVoices
      })
      const bits = [`Đã nhập ${res.imported.length} cuộc họp`]
      if (res.speakersAdded) bits.push(`${res.speakersAdded} giọng mới vào danh bạ`)
      if (res.speakersMerged) bits.push(`${res.speakersMerged} giọng khớp người đã biết`)
      notify(bits.join(' · ') + '.', 'ok')
      if (res.renamed.length) {
        notify(
          'Giữ tên bạn đã đặt: ' +
            res.renamed.map((r) => `${r.from} → ${r.to}`).join(', ') +
            '.',
          'info'
        )
      }
      onImported(res.imported[0]?.projectId ?? null)
      onClose()
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Nhập gói cuộc họp"
      subtitle={
        info
          ? `Từ ${info.exportedBy || 'người gửi không ghi tên'} · ${
              info.exportedAt ? formatDate(info.exportedAt) : 'không rõ ngày'
            }`
          : 'Đang đọc file…'
      }
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Huỷ
          </button>
          <button className="btn-primary" disabled={!picked.length || busy} onClick={doImport}>
            {busy ? <Spinner size={13} /> : <Download size={14} />}
            Nhập {picked.length} cuộc họp
          </button>
        </>
      }
    >
      {!info ? (
        <div className="py-8 flex justify-center">
          <Spinner size={18} />
        </div>
      ) : (
        <div>
          <div className="rounded-lg border border-ink-800 bg-ink-850/50 px-3 py-2.5 mb-3.5">
            <p className="text-[12.5px] text-ink-300 flex items-start gap-1.5">
              <Info size={13} className="shrink-0 mt-0.5 text-brand-300" />
              <span>
                Gói không kèm video. Bản bóc băng, tóm tắt và tên người nói nhập được đầy đủ; phần
                phát lại video sẽ trống cho tới khi bạn trỏ tới file video của mình.
              </span>
            </p>
          </div>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-800 divide-y divide-ink-800 mb-3.5">
            {info.meetings.map((m) => (
              <button
                key={m.id}
                className={`w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors ${
                  picked.includes(m.id) ? 'bg-brand-600/15' : 'hover:bg-ink-850'
                }`}
                onClick={() => toggle(m.id)}
              >
                <span
                  className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center ${
                    picked.includes(m.id) ? 'bg-brand-600 border-brand-600' : 'border-ink-600'
                  }`}
                >
                  {picked.includes(m.id) && <Check size={11} className="text-white" />}
                </span>
                <span className="min-w-0 grow">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] text-ink-100 truncate">{m.name}</span>
                    {m.existingProjectId && (
                      <span className="pill bg-amber-500/15 text-amber-300 shrink-0">đã nhập rồi</span>
                    )}
                  </span>
                  <span className="block hint">
                    {formatDate(m.createdAt)}
                    {m.durationSec ? ` · ${formatTime(m.durationSec)}` : ''} · {m.segmentCount} lượt nói
                    {m.hasSummary ? ' · có tóm tắt' : ''}
                    {m.hasNotes ? ' · có ghi chú' : ''}
                  </span>
                  {m.speakerNames.length > 0 && (
                    <span className="flex items-center gap-1.5 hint mt-0.5">
                      <Users size={11} className="shrink-0" />
                      {m.speakerNames.join(', ')}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>

          {dupes > 0 && (
            <p className="text-[12.5px] text-amber-300 flex items-start gap-1.5 mb-3.5">
              <TriangleAlert size={13} className="shrink-0 mt-0.5" />
              <span>
                {dupes} cuộc họp trong gói này bạn đã nhập trước đó nên được bỏ tick. Tick lại thì
                sẽ tạo thêm một bản nữa, cuộc họp cũ vẫn giữ nguyên.
              </span>
            </p>
          )}

          {info.includesVoiceprints ? (
            <Toggle
              checked={withVoices}
              onChange={setWithVoices}
              label={`Nhập cả ${info.speakerCount} mẫu giọng nói vào danh bạ của tôi`}
              hint="Bật thì các cuộc họp bạn tự bóc băng về sau cũng tự điền đúng tên những người này. Giọng nào khớp người bạn đã đặt tên thì tên của bạn được giữ."
            />
          ) : (
            <p className="hint flex items-center gap-1.5">
              <FileJson size={12} />
              Gói này không kèm mẫu giọng nói, nên chỉ nhập nội dung cuộc họp.
            </p>
          )}

          <p className="hint flex items-center gap-1.5">
            <MessageSquare size={12} />
            Nhập xong bạn sửa được mọi thứ như cuộc họp tự bóc băng: sửa chữ, tách lượt, đổi tên,
            tóm tắt lại, xuất PDF.
          </p>
        </div>
      )}
    </Modal>
  )
}
