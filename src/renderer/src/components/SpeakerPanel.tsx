import { useMemo } from 'react'
import { Sparkles, UserPlus, BadgeCheck, Pencil } from 'lucide-react'
import type { Project, SpeakerProfile } from '../../../shared/types'
import { Spinner } from './Ui'

export default function SpeakerPanel({
  project,
  onEdit,
  onSuggest,
  onAdd,
  suggesting
}: {
  project: Project
  onEdit: (s: SpeakerProfile) => void
  onSuggest: () => void
  onAdd: () => void
  suggesting: boolean
}): JSX.Element {
  const stats = useMemo(() => {
    const map = new Map<string, { count: number; seconds: number }>()
    for (const seg of project.segments) {
      const cur = map.get(seg.speakerId) ?? { count: 0, seconds: 0 }
      cur.count += 1
      cur.seconds += Math.max(0, seg.end - seg.start)
      map.set(seg.speakerId, cur)
    }
    return map
  }, [project.segments])

  const totalSeconds = Array.from(stats.values()).reduce((a, b) => a + b.seconds, 0) || 1

  return (
    // flex-col + min-h-0: danh sách người nói phải cuộn BÊN TRONG hộp này.
    // Trước đây hộp cứ phình theo số người, họp 12 người là đẩy luôn khung
    // video ra khỏi vùng nhìn thấy.
    <div className="card p-3 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2.5 shrink-0">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
          Người nói ({project.speakers.length})
        </h3>
        <div className="flex gap-1">
          <button
            className="btn-ghost h-7 !px-2 text-[12px]"
            onClick={onSuggest}
            disabled={suggesting || !project.segments.length}
            title="Nhờ AI dò tên người nói trong hội thoại"
          >
            {suggesting ? <Spinner size={12} /> : <Sparkles size={13} />}
            Gợi ý tên
          </button>
          <button className="btn-ghost h-7 !px-2 text-[12px]" onClick={onAdd} title="Thêm người nói thủ công">
            <UserPlus size={13} />
          </button>
        </div>
      </div>

      {project.speakers.length === 0 && (
        <p className="hint py-3 text-center">Chưa có người nói. Hãy chạy bóc băng trước.</p>
      )}

      <div className="space-y-1.5 grow min-h-0 overflow-y-auto -mr-1 pr-1">
        {project.speakers.map((s) => {
          const st = stats.get(s.id) ?? { count: 0, seconds: 0 }
          const share = Math.round((st.seconds / totalSeconds) * 100)
          return (
            <button
              key={s.id}
              onClick={() => onEdit(s)}
              className="group w-full text-left rounded-lg border border-ink-800 hover:border-ink-600 bg-ink-850/60 hover:bg-ink-800 px-2.5 py-2 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                <span className={`text-[13px] font-medium truncate ${s.named ? 'text-ink-100' : 'text-brand-200'}`}>
                  {s.name}
                </span>
                {s.named && (
                  <span className="shrink-0" title="Đã lưu vào danh bạ giọng nói">
                    <BadgeCheck size={13} className="text-emerald-400" />
                  </span>
                )}
                {s.role && <span className="text-[11px] text-ink-400 truncate">· {s.role}</span>}
                <span className="grow" />
                <Pencil size={12} className="text-ink-600 group-hover:text-ink-300 shrink-0" />
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1 grow rounded-full bg-ink-800 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${share}%`, background: s.color }} />
                </div>
                <span className="text-[10.5px] text-ink-500 tabular-nums shrink-0">
                  {share}% · {st.count} lượt
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {project.speakers.some((s) => s.named && !s.embedding?.length && !stats.get(s.id)?.count) && (
        <p className="hint mt-2.5 shrink-0">
          Người có <span className="text-amber-300">0 lượt</span> là tên bạn tự thêm, app chưa gán
          được giọng nào cho họ (họ chưa có mẫu giọng để đối chiếu). Bấm vào một
          <span className="text-brand-200 font-medium"> user_(n)</span> đã phát hiện rồi chọn{' '}
          <b>Gộp</b> vào tên đó.
        </p>
      )}

      {project.speakers.some((s) => !s.named) && (
        <p className="hint mt-2.5 shrink-0">
          Click vào <span className="text-brand-200 font-medium">user_(n)</span> để đặt tên. Tên và voiceprint sẽ được
          ghi vào <code className="text-ink-300">speakers.json</code> và tự nhận ra ở các cuộc họp sau.
        </p>
      )}
    </div>
  )
}
