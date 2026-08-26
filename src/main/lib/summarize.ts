import type { MeetingSummary, Project, Settings } from '../../shared/types'
import { chat, extractJson, providerMeta } from './llm'

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(r).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Bản bóc băng dạng text để đưa vào LLM. */
export function transcriptToText(project: Project, withTime = true): string {
  const nameOf = new Map(project.speakers.map((s) => [s.id, s.name]))
  return project.segments
    .map((s) => {
      const who = nameOf.get(s.speakerId) ?? 'unknown'
      return withTime ? `[${formatTime(s.start)}] ${who}: ${s.text}` : `${who}: ${s.text}`
    })
    .join('\n')
}

const SUMMARY_SCHEMA = `{
  "title": "tiêu đề ngắn gọn của cuộc họp",
  "oneLiner": "một câu tóm tắt toàn bộ cuộc họp",
  "language": "vi",
  "participants": [{ "name": "tên người nói", "role": "vai trò suy ra từ nội dung", "contribution": "họ đóng góp/đề xuất gì" }],
  "sections": [{ "title": "tên chủ đề", "body": "diễn giải chi tiết chủ đề đó", "bullets": ["ý chính 1", "ý chính 2"] }],
  "decisions": ["quyết định đã chốt"],
  "actionItems": [{ "owner": "người phụ trách", "task": "việc cần làm", "due": "deadline nếu có" }],
  "openQuestions": ["vấn đề còn treo, chưa có kết luận"],
  "keywords": ["từ khoá", "thuật ngữ"]
}`

export async function summarizeProject(project: Project, settings: Settings): Promise<MeetingSummary> {
  if (!project.segments.length) throw new Error('Chưa có bản bóc băng để tóm tắt.')
  const meta = providerMeta(settings)
  const transcript = transcriptToText(project)

  const system = `${settings.summaryPrompt}\n\nCHỈ trả về JSON hợp lệ theo đúng schema sau, không kèm markdown, không kèm giải thích:\n${SUMMARY_SCHEMA}`
  const user = `Tên file/cuộc họp: ${project.name}
Thời lượng: ${formatTime(project.durationSec ?? 0)}
Số người nói: ${project.speakers.length}
Danh sách người nói: ${project.speakers.map((s) => s.name).join(', ')}

=== BẢN BÓC BĂNG ===
${transcript}
=== HẾT ===`

  const raw = await chat(settings, system, user, { json: true, maxTokens: 16000 })
  const parsed = extractJson(raw) as Partial<MeetingSummary>

  return {
    title: parsed.title || project.name,
    oneLiner: parsed.oneLiner || '',
    language: parsed.language || settings.language,
    participants: parsed.participants ?? [],
    sections: parsed.sections ?? [],
    decisions: parsed.decisions ?? [],
    actionItems: parsed.actionItems ?? [],
    openQuestions: parsed.openQuestions ?? [],
    keywords: parsed.keywords ?? [],
    generatedAt: new Date().toISOString(),
    provider: meta.label,
    model: meta.model
  }
}

export interface NameSuggestion {
  speakerId: string
  suggestedName: string
  evidence: string
  confidence: number
}

/** Nhờ LLM dò trong hội thoại xem ai tự giới thiệu tên / được gọi tên, để gợi ý đặt tên cho user_(n). */
export async function suggestSpeakerNames(project: Project, settings: Settings): Promise<NameSuggestion[]> {
  if (!project.segments.length) return []
  const transcript = transcriptToText(project)
  const unnamed = project.speakers.filter((s) => !s.named)
  if (!unnamed.length) return []

  const system = `Bạn phân tích bản bóc băng cuộc họp để suy ra TÊN THẬT của những người nói đang mang nhãn tạm user_(n).
Chỉ dựa vào bằng chứng trong hội thoại: người đó tự giới thiệu, người khác gọi tên họ, hoặc được nhắc tới rõ ràng khi tới lượt nói.
Nếu không có bằng chứng đủ rõ thì BỎ QUA người đó, tuyệt đối không đoán bừa.
CHỈ trả về JSON: {"suggestions":[{"speaker":"user_1","name":"Tên đề xuất","evidence":"câu làm bằng chứng","confidence":0.0}]}`

  const user = `Những nhãn cần suy ra tên: ${unnamed.map((s) => s.name).join(', ')}

=== BẢN BÓC BĂNG ===
${transcript}
=== HẾT ===`

  const raw = await chat(settings, system, user, { json: true, maxTokens: 4000 })
  const parsed = extractJson(raw) as { suggestions?: { speaker?: string; name?: string; evidence?: string; confidence?: number }[] }
  const byName = new Map(project.speakers.map((s) => [s.name, s.id]))

  return (parsed.suggestions ?? [])
    .map((s) => ({
      speakerId: byName.get(String(s.speaker ?? '')) ?? '',
      suggestedName: String(s.name ?? '').trim(),
      evidence: String(s.evidence ?? '').trim(),
      confidence: Number(s.confidence ?? 0)
    }))
    .filter((s) => s.speakerId && s.suggestedName)
}

/**
 * Khi engine ASR không hỗ trợ tách người nói (ví dụ Whisper API), nhờ LLM suy luận
 * lượt nói dựa vào mạch hội thoại. Kết quả gần đúng, người dùng có thể sửa lại trong app.
 */
export async function attributeSpeakersByLlm(
  lines: { start: number; end: number; text: string }[],
  settings: Settings
): Promise<string[]> {
  const numbered = lines.map((l, i) => `${i}\t${formatTime(l.start)}\t${l.text}`).join('\n')
  const system = `Bạn nhận danh sách câu nói theo thứ tự thời gian của một cuộc họp, mỗi dòng có dạng: index<TAB>thời gian<TAB>nội dung.
Hãy suy luận xem mỗi câu do ai nói dựa vào mạch hội thoại (câu hỏi - câu trả lời, cách nói, ngôi thứ, nội dung).
Dùng nhãn SPEAKER_00, SPEAKER_01, ... và giữ nhất quán trong toàn bộ file.
CHỈ trả về JSON: {"labels":[{"i":0,"speaker":"SPEAKER_00"}, ...]} cho ĐỦ mọi index.`

  const raw = await chat(settings, system, numbered, { json: true, maxTokens: 16000 })
  const parsed = extractJson(raw) as { labels?: { i?: number; speaker?: string }[] }
  const result = new Array<string>(lines.length).fill('SPEAKER_00')
  for (const item of parsed.labels ?? []) {
    const i = Number(item.i)
    if (Number.isInteger(i) && i >= 0 && i < result.length && item.speaker) {
      result[i] = String(item.speaker)
    }
  }
  return result
}
