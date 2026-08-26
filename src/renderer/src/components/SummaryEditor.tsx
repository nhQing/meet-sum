import { useState } from 'react'
import { Check, Plus, Trash2, X } from 'lucide-react'
import type { MeetingSummary } from '../../../shared/types'
import { Field, Spinner } from './Ui'

/** Form sửa tay bản tóm tắt do AI viết — sửa được mọi mục, thêm/bớt từng dòng. */
export default function SummaryEditor({
  value,
  onCancel,
  onSave
}: {
  value: MeetingSummary
  onCancel: () => void
  onSave: (next: MeetingSummary) => Promise<void>
}): JSX.Element {
  const [d, setD] = useState<MeetingSummary>(structuredClone(value))
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof MeetingSummary>(k: K, v: MeetingSummary[K]): void =>
    setD((x) => ({ ...x, [k]: v }))

  /** Sửa một phần tử trong mảng. */
  const setAt = <T,>(list: T[], i: number, patch: Partial<T>): T[] =>
    list.map((x, j) => (j === i ? { ...x, ...patch } : x))

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await onSave({
        ...d,
        title: d.title.trim() || value.title,
        decisions: d.decisions.map((x) => x.trim()).filter(Boolean),
        openQuestions: d.openQuestions.map((x) => x.trim()).filter(Boolean),
        keywords: d.keywords.map((x) => x.trim()).filter(Boolean),
        participants: d.participants.filter((p) => p.name.trim()),
        actionItems: d.actionItems.filter((a) => a.task.trim()),
        sections: d.sections
          .filter((s) => s.title.trim() || s.body?.trim() || s.bullets?.length)
          .map((s) => ({ ...s, bullets: (s.bullets ?? []).map((b) => b.trim()).filter(Boolean) }))
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card grow overflow-y-auto min-h-0">
      <div className="sticky top-0 z-10 flex items-center gap-2 px-5 py-3 border-b border-ink-800 bg-ink-900/95 backdrop-blur">
        <span className="text-[13px] font-semibold">Đang sửa bản tóm tắt</span>
        <span className="hint">Sửa xong nhớ bấm Lưu</span>
        <span className="grow" />
        <button className="btn-ghost" onClick={onCancel} disabled={saving}>
          <X size={14} />
          Huỷ
        </button>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? <Spinner size={13} /> : <Check size={14} />}
          Lưu
        </button>
      </div>

      <div className="p-5">
        <Field label="Tiêu đề">
          <input className="input" value={d.title} onChange={(e) => set('title', e.target.value)} />
        </Field>

        <Field label="Tóm tắt một câu">
          <textarea
            className="textarea min-h-[60px] text-[13px]"
            value={d.oneLiner}
            onChange={(e) => set('oneLiner', e.target.value)}
          />
        </Field>

        {/* ---------- Người tham gia ---------- */}
        <Group
          title="Người tham gia"
          onAdd={() => set('participants', [...d.participants, { name: '', role: '', contribution: '' }])}
        >
          {d.participants.map((p, i) => (
            <Row key={i} onRemove={() => set('participants', d.participants.filter((_, j) => j !== i))}>
              <div className="grid sm:grid-cols-2 gap-2">
                <input
                  className="input h-8 text-[13px]"
                  placeholder="Tên"
                  value={p.name}
                  onChange={(e) => set('participants', setAt(d.participants, i, { name: e.target.value }))}
                />
                <input
                  className="input h-8 text-[13px]"
                  placeholder="Vai trò"
                  value={p.role ?? ''}
                  onChange={(e) => set('participants', setAt(d.participants, i, { role: e.target.value }))}
                />
              </div>
              <textarea
                className="textarea min-h-[46px] text-[12.5px] mt-2"
                placeholder="Đóng góp trong cuộc họp"
                value={p.contribution ?? ''}
                onChange={(e) => set('participants', setAt(d.participants, i, { contribution: e.target.value }))}
              />
            </Row>
          ))}
        </Group>

        {/* ---------- Nội dung chính ---------- */}
        <Group
          title="Nội dung chính"
          onAdd={() => set('sections', [...d.sections, { title: '', body: '', bullets: [] }])}
        >
          {d.sections.map((sec, i) => (
            <Row key={i} onRemove={() => set('sections', d.sections.filter((_, j) => j !== i))}>
              <input
                className="input h-8 text-[13px] font-medium"
                placeholder="Tên chủ đề"
                value={sec.title}
                onChange={(e) => set('sections', setAt(d.sections, i, { title: e.target.value }))}
              />
              <textarea
                className="textarea min-h-[60px] text-[12.5px] mt-2"
                placeholder="Diễn giải"
                value={sec.body ?? ''}
                onChange={(e) => set('sections', setAt(d.sections, i, { body: e.target.value }))}
              />
              <div className="mt-2 flex flex-col gap-1.5">
                {(sec.bullets ?? []).map((b, j) => (
                  <div key={j} className="flex gap-1.5">
                    <input
                      className="input h-7 text-[12.5px]"
                      value={b}
                      placeholder="Ý chính"
                      onChange={(e) => {
                        const bullets = (sec.bullets ?? []).map((x, k) => (k === j ? e.target.value : x))
                        set('sections', setAt(d.sections, i, { bullets }))
                      }}
                    />
                    <button
                      className="btn-ghost h-7 w-7 !px-0 text-ink-500 hover:text-red-300 shrink-0"
                      onClick={() =>
                        set('sections', setAt(d.sections, i, { bullets: (sec.bullets ?? []).filter((_, k) => k !== j) }))
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <button
                  className="btn-ghost h-7 text-[12px] self-start"
                  onClick={() => set('sections', setAt(d.sections, i, { bullets: [...(sec.bullets ?? []), ''] }))}
                >
                  <Plus size={12} />
                  Thêm ý
                </button>
              </div>
            </Row>
          ))}
        </Group>

        {/* ---------- Quyết định ---------- */}
        <Group title="Quyết định" onAdd={() => set('decisions', [...d.decisions, ''])}>
          {d.decisions.map((x, i) => (
            <div key={i} className="flex gap-1.5">
              <textarea
                className="textarea min-h-[42px] text-[12.5px]"
                value={x}
                onChange={(e) => set('decisions', d.decisions.map((y, j) => (j === i ? e.target.value : y)))}
              />
              <button
                className="btn-ghost h-8 w-8 !px-0 text-ink-500 hover:text-red-300 shrink-0"
                onClick={() => set('decisions', d.decisions.filter((_, j) => j !== i))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </Group>

        {/* ---------- Việc cần làm ---------- */}
        <Group
          title="Việc cần làm"
          onAdd={() => set('actionItems', [...d.actionItems, { owner: '', task: '', due: '' }])}
        >
          {d.actionItems.map((a, i) => (
            <Row key={i} onRemove={() => set('actionItems', d.actionItems.filter((_, j) => j !== i))}>
              <textarea
                className="textarea min-h-[44px] text-[12.5px]"
                placeholder="Công việc"
                value={a.task}
                onChange={(e) => set('actionItems', setAt(d.actionItems, i, { task: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2 mt-2">
                <input
                  className="input h-8 text-[12.5px]"
                  placeholder="Người phụ trách"
                  value={a.owner}
                  onChange={(e) => set('actionItems', setAt(d.actionItems, i, { owner: e.target.value }))}
                />
                <input
                  className="input h-8 text-[12.5px]"
                  placeholder="Hạn (nếu có)"
                  value={a.due ?? ''}
                  onChange={(e) => set('actionItems', setAt(d.actionItems, i, { due: e.target.value }))}
                />
              </div>
            </Row>
          ))}
        </Group>

        {/* ---------- Vấn đề còn treo ---------- */}
        <Group title="Vấn đề còn treo" onAdd={() => set('openQuestions', [...d.openQuestions, ''])}>
          {d.openQuestions.map((x, i) => (
            <div key={i} className="flex gap-1.5">
              <textarea
                className="textarea min-h-[42px] text-[12.5px]"
                value={x}
                onChange={(e) => set('openQuestions', d.openQuestions.map((y, j) => (j === i ? e.target.value : y)))}
              />
              <button
                className="btn-ghost h-8 w-8 !px-0 text-ink-500 hover:text-red-300 shrink-0"
                onClick={() => set('openQuestions', d.openQuestions.filter((_, j) => j !== i))}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </Group>

        {/* ---------- Từ khoá ---------- */}
        <Field label="Từ khoá" hint="Ngăn cách bằng dấu phẩy">
          <input
            className="input"
            value={d.keywords.join(', ')}
            onChange={(e) => set('keywords', e.target.value.split(',').map((x) => x.trim()))}
          />
        </Field>
      </div>
    </div>
  )
}

function Group({
  title,
  onAdd,
  children
}: {
  title: string
  onAdd: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="mt-5">
      <div className="flex items-center gap-2 mb-2.5 pb-1.5 border-b border-ink-800">
        <h3 className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-400">{title}</h3>
        <span className="grow" />
        <button className="btn-ghost h-7 text-[12px]" onClick={onAdd}>
          <Plus size={12} />
          Thêm
        </button>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

function Row({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }): JSX.Element {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850/40 p-2.5 relative">
      <button
        className="btn-ghost h-7 w-7 !px-0 absolute top-2 right-2 text-ink-500 hover:text-red-300"
        onClick={onRemove}
        title="Xoá mục này"
      >
        <Trash2 size={13} />
      </button>
      <div className="pr-8">{children}</div>
    </div>
  )
}
