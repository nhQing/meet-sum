import { useEffect, useState } from 'react'
import { Merge } from 'lucide-react'
import type { Project, SpeakerProfile } from '../../../shared/types'
import { Field, Modal, Toggle } from './Ui'

const PALETTE = ['#4da3ff', '#f2994a', '#27c19a', '#bb6bd9', '#eb5757', '#f2c94c', '#56ccf2', '#9b9bff', '#6fcf97', '#ff8fab']

export default function SpeakerDialog({
  open,
  project,
  speaker,
  onClose,
  onSave,
  onMerge
}: {
  open: boolean
  project: Project
  speaker: SpeakerProfile | null
  onClose: () => void
  onSave: (name: string, role: string, color: string, propagate: boolean) => Promise<void>
  onMerge: (fromId: string, intoId: string) => Promise<void>
}): JSX.Element | null {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [color, setColor] = useState(PALETTE[0])
  const [propagate, setPropagate] = useState(true)
  const [mergeInto, setMergeInto] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!speaker) return
    setName(speaker.named ? speaker.name : '')
    setRole(speaker.role ?? '')
    setColor(speaker.color || PALETTE[0])
    setMergeInto('')
  }, [speaker])

  if (!speaker) return null

  const others = project.speakers.filter((s) => s.id !== speaker.id)
  const segCount = project.segments.filter((s) => s.speakerId === speaker.id).length

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await onSave(name, role, color, propagate)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={`Đặt tên cho ${speaker.name}`}
      subtitle={`${segCount} lượt nói trong cuộc họp này · voiceprint ${speaker.embedding?.length ? 'đã có' : 'chưa có'}`}
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Huỷ
          </button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            Lưu và ghi nhớ
          </button>
        </>
      }
    >
      <Field label="Tên người nói" hint="Để trống nếu muốn giữ nhãn tạm user_(n).">
        <input
          className="input"
          value={name}
          autoFocus
          placeholder="Ví dụ: Quỳnh Dương"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
          }}
        />
      </Field>

      <Field label="Vai trò (tuỳ chọn)">
        <input
          className="input"
          value={role}
          placeholder="Ví dụ: PM, Backend, Khách hàng"
          onChange={(e) => setRole(e.target.value)}
        />
      </Field>

      <Field label="Màu nhận diện">
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-7 h-7 rounded-full border-2 transition-transform ${
                color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>

      <Toggle
        checked={propagate}
        onChange={setPropagate}
        label="Áp dụng tên này cho các cuộc họp khác"
        hint="Cập nhật lại tên ở những cuộc họp trước đã nhận ra cùng giọng nói này."
      />

      {others.length > 0 && (
        <div className="pt-3 border-t border-ink-800">
          <label className="label">Gộp người nói</label>
          <p className="hint mb-2">
            Nếu hệ thống tách một người thành hai giọng, hãy gộp lại. Mọi lượt nói của{' '}
            <span className="text-ink-200">{speaker.name}</span> sẽ chuyển sang người được chọn.
          </p>
          <div className="flex gap-2">
            <select className="input" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
              <option value="">— Chọn người nói —</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <button
              className="btn-outline shrink-0"
              disabled={!mergeInto || busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onMerge(speaker.id, mergeInto)
                  onClose()
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Merge size={14} />
              Gộp
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
