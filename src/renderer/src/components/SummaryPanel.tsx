import { Brain, CheckCircle2, HelpCircle, ListTodo, Pencil, Tag, Users2 } from 'lucide-react'
import type { Project } from '../../../shared/types'
import { formatDate } from '../lib/format'
import { Spinner } from './Ui'

export default function SummaryPanel({
  project,
  onSummarize,
  onEdit,
  busy
}: {
  project: Project
  onSummarize: () => void
  onEdit: () => void
  busy: boolean
}): JSX.Element {
  const s = project.summary

  if (!s) {
    return (
      <div className="card grow flex flex-col items-center justify-center text-center p-10 gap-3">
        <Brain size={30} className="text-ink-600" />
        <p className="text-[13.5px] text-ink-300 max-w-sm leading-relaxed">
          Sau khi đã đặt tên cho người nói, bấm bên dưới để AI nghiên cứu toàn bộ hội thoại và viết tóm tắt: chủ đề,
          quyết định, việc cần làm và vấn đề còn treo.
        </p>
        <button className="btn-primary" onClick={onSummarize} disabled={busy || !project.segments.length}>
          {busy ? <Spinner size={14} /> : <Brain size={15} />}
          Tóm tắt bằng AI
        </button>
        {!project.segments.length && <p className="hint">Cần có bản bóc băng trước.</p>}
      </div>
    )
  }

  return (
    <div className="card grow overflow-y-auto min-h-0">
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[19px] font-semibold leading-snug">{s.title}</h2>
            {s.oneLiner && <p className="mt-1.5 text-[13.5px] text-ink-300 leading-relaxed">{s.oneLiner}</p>}
            <p className="hint mt-2">
              {s.provider} · {s.model} · {formatDate(s.generatedAt)}
              {s.editedAt && <span className="text-brand-300"> · đã sửa tay {formatDate(s.editedAt)}</span>}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button className="btn-outline" onClick={onEdit} disabled={busy} title="Sửa tay nội dung tóm tắt">
              <Pencil size={14} />
              Sửa
            </button>
            <button className="btn-outline" onClick={onSummarize} disabled={busy} title="Bỏ bản hiện tại, để AI viết lại">
              {busy ? <Spinner size={13} /> : <Brain size={14} />}
              Tóm tắt lại
            </button>
          </div>
        </div>

        {s.participants.length > 0 && (
          <Section icon={<Users2 size={14} />} title="Người tham gia">
            <div className="grid gap-2 sm:grid-cols-2">
              {s.participants.map((p, i) => (
                <div key={i} className="rounded-lg border border-ink-800 bg-ink-850/50 px-3 py-2">
                  <div className="text-[13px] font-medium">
                    {p.name}
                    {p.role && <span className="text-ink-400 font-normal"> · {p.role}</span>}
                  </div>
                  {p.contribution && <p className="hint mt-1">{p.contribution}</p>}
                </div>
              ))}
            </div>
          </Section>
        )}

        {s.sections.length > 0 && (
          <Section title="Nội dung chính">
            <div className="space-y-4">
              {s.sections.map((sec, i) => (
                <div key={i}>
                  <h4 className="text-[14px] font-semibold text-ink-100">{sec.title}</h4>
                  {sec.body && <p className="mt-1 text-[13px] text-ink-200 leading-relaxed">{sec.body}</p>}
                  {sec.bullets?.length ? (
                    <ul className="mt-1.5 space-y-1">
                      {sec.bullets.map((b, j) => (
                        <li key={j} className="text-[13px] text-ink-200 leading-relaxed flex gap-2">
                          <span className="text-brand-400 mt-[7px] w-1 h-1 rounded-full bg-brand-400 shrink-0" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>
        )}

        {s.decisions.length > 0 && (
          <Section icon={<CheckCircle2 size={14} />} title="Quyết định">
            <ul className="space-y-1.5">
              {s.decisions.map((d, i) => (
                <li key={i} className="text-[13px] text-ink-100 flex gap-2.5 rounded-lg bg-emerald-500/8 border border-emerald-500/20 px-3 py-2">
                  <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {s.actionItems.length > 0 && (
          <Section icon={<ListTodo size={14} />} title="Việc cần làm">
            <div className="overflow-hidden rounded-lg border border-ink-800">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-ink-850 text-[11px] uppercase tracking-wider text-ink-400">
                    <th className="text-left px-3 py-2 font-semibold">Công việc</th>
                    <th className="text-left px-3 py-2 font-semibold w-36">Phụ trách</th>
                    <th className="text-left px-3 py-2 font-semibold w-28">Hạn</th>
                  </tr>
                </thead>
                <tbody>
                  {s.actionItems.map((a, i) => (
                    <tr key={i} className="border-t border-ink-800">
                      <td className="px-3 py-2 align-top">{a.task}</td>
                      <td className="px-3 py-2 align-top font-medium">{a.owner}</td>
                      <td className="px-3 py-2 align-top text-ink-400">{a.due || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {s.openQuestions.length > 0 && (
          <Section icon={<HelpCircle size={14} />} title="Vấn đề còn treo">
            <ul className="space-y-1.5">
              {s.openQuestions.map((q, i) => (
                <li key={i} className="text-[13px] text-ink-200 flex gap-2.5">
                  <HelpCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>{q}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {s.keywords.length > 0 && (
          <Section icon={<Tag size={14} />} title="Từ khoá">
            <div className="flex flex-wrap gap-1.5">
              {s.keywords.map((k, i) => (
                <span key={i} className="pill bg-brand-500/12 text-brand-200 border border-brand-500/25">
                  {k}
                </span>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  icon,
  children
}: {
  title: string
  icon?: JSX.Element
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="mt-6">
      <h3 className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-400 mb-2.5 pb-1.5 border-b border-ink-800">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}
