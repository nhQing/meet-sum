import { useEffect, useState } from 'react'
import { Mic, TriangleAlert } from 'lucide-react'
import type { Settings } from '../../../shared/types'
import { formatTime } from '../lib/format'
import { Field, Modal, Spinner, Toggle } from './Ui'

/**
 * Bóc băng lại một khoảng.
 *
 * Điểm mấu chốt: chạy lại y hệt cấu hình cũ thì ra y hệt kết quả cũ. Nên hộp
 * thoại này MẶC ĐỊNH nghe kỹ hơn bình thường — người dùng bấm vào đây nghĩa là
 * cấu hình hiện tại đã bỏ sót đoạn đó rồi.
 */
export default function RedoRangeDialog({
  open,
  range,
  settings,
  busy,
  onClose,
  onRun
}: {
  open: boolean
  range: { start: number; end: number } | null
  settings: Settings | null
  busy: boolean
  onClose: () => void
  onRun: (o: { vadThreshold?: number; disableVad?: boolean; fwModelSize?: string }) => void
}): JSX.Element {
  const [threshold, setThreshold] = useState(0.2)
  const [noVad, setNoVad] = useState(false)
  const [bigModel, setBigModel] = useState(false)

  useEffect(() => {
    if (!open) return
    // Bắt đầu từ mức nhạy hơn hẳn cấu hình đang dùng
    const cur = settings?.vadThreshold ?? 0.5
    setThreshold(Math.max(0.1, Math.min(cur - 0.2, 0.3)))
    setNoVad(false)
    setBigModel(false)
  }, [open, settings])

  const len = range ? range.end - range.start : 0

  return (
    <Modal
      open={open}
      title="Bóc băng lại đoạn này"
      subtitle={
        range
          ? `${formatTime(range.start)}–${formatTime(range.end)} · dài ${formatTime(len)}`
          : ''
      }
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Huỷ
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() =>
              onRun({
                vadThreshold: threshold,
                disableVad: noVad,
                ...(bigModel ? { fwModelSize: 'large-v3' } : {})
              })
            }
          >
            {busy ? <Spinner size={13} /> : <Mic size={14} />}
            Bóc lại đoạn này
          </button>
        </>
      }
    >
      <p className="text-[12.5px] text-ink-300 leading-relaxed mb-4">
        Chỉ đoạn này được bóc lại, phần còn lại của biên bản giữ nguyên. Các lượt nói cũ nằm trong
        đoạn sẽ bị thay bằng kết quả mới — bấm <b>Hoàn tác</b> là quay lại được.
      </p>

      <Field
        label="Độ nhạy nghe tiếng nói cho lần này"
        hint={`Cấu hình đang dùng là ${(settings?.vadThreshold ?? 0.5).toFixed(2)}. Thấp hơn = nghe kỹ hơn, bắt được người nói nhỏ.`}
      >
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0.1}
            max={0.9}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="grow accent-brand-500"
            disabled={noVad}
          />
          <span className="text-[12px] font-mono tabular-nums text-ink-300 w-8">
            {threshold.toFixed(2)}
          </span>
        </div>
      </Field>

      <Toggle
        checked={noVad}
        onChange={setNoVad}
        label="Tắt hẳn bộ lọc tiếng nói cho đoạn này"
        hint="Đưa toàn bộ audio của đoạn cho model, không bỏ sót gì. Đoạn ngắn nên chậm hơn cũng không đáng kể."
      />

      {settings?.fwModelSize !== 'large-v3' && (
        <Toggle
          checked={bigModel}
          onChange={setBigModel}
          label="Dùng model large-v3 cho đoạn này"
          hint={`Đang dùng ${settings?.fwModelSize ?? '?'}. Đoạn ngắn nên chạy model to cũng nhanh.`}
        />
      )}

      {len > 600 && (
        <p className="text-[12.5px] text-amber-300 flex items-start gap-1.5">
          <TriangleAlert size={13} className="shrink-0 mt-0.5" />
          Đoạn dài {formatTime(len)} — bóc lại sẽ mất thời gian tương ứng. Chọn khoảng ngắn hơn nếu
          chỉ cần vá một chỗ.
        </p>
      )}
    </Modal>
  )
}
