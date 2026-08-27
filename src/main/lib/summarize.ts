import type { MeetingSummary, Project, Settings, TranscriptSegment } from '../../shared/types'
import { chat, extractJson, providerMeta } from './llm'
import { isContextLengthError } from './cliAgent'

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

/**
 * Cuộc họp dài thì bản bóc băng vượt cửa sổ ngữ cảnh của model, gọi một phát là
 * lỗi "prompt is too long" hoặc bị cắt cụt mà không báo gì. Cách xử lý:
 *
 *   1. Chia bản bóc băng theo LƯỢT NÓI (không bao giờ cắt giữa câu).
 *   2. Tóm tắt từng phần thành một bản rút gọn dạng chữ (không phải JSON —
 *      càng ít chỗ phải parse JSON thì càng ít chỗ hỏng).
 *   3. Ghép các bản rút gọn lại rồi mới sinh JSON cuối cùng. Nếu ghép xong vẫn
 *      quá dài (họp cả ngày) thì rút gọn thêm một vòng nữa.
 *
 * Mỗi phần đều được ghi rõ mốc thời gian, để bản tóm tắt cuối vẫn bám đúng
 * diễn biến trước sau của cuộc họp.
 */

/** Mặc định ~45k ký tự mỗi phần: tiếng Việt khoảng 2,5 ký tự/token nên vào tầm 18k token, an toàn với mọi model. */
export const DEFAULT_CHUNK_CHARS = 45_000
const MIN_CHUNK_CHARS = 4_000

export function chunkChars(settings: Settings): number {
  const v = settings.summaryChunkChars
  if (!v || v <= 0) return 0 // 0 = tắt tự chia
  return Math.max(MIN_CHUNK_CHARS, v)
}

export interface TranscriptChunk {
  index: number
  total: number
  startSec: number
  endSec: number
  text: string
}

/**
 * Chia theo lượt nói. Một lượt dài hơn cả giới hạn thì vẫn đứng riêng một phần
 * — thà một phần hơi to còn hơn cắt ngang câu nói của người ta.
 */
export function chunkTranscript(
  segments: TranscriptSegment[],
  nameOf: Map<string, string>,
  maxChars: number
): TranscriptChunk[] {
  const lines = segments.map((sg) => ({
    seg: sg,
    line: `[${formatTime(sg.start)}] ${nameOf.get(sg.speakerId) ?? 'unknown'}: ${sg.text}`
  }))

  const chunks: TranscriptChunk[] = []
  let buf: typeof lines = []
  let size = 0

  const flush = (): void => {
    if (!buf.length) return
    chunks.push({
      index: chunks.length,
      total: 0,
      startSec: buf[0].seg.start,
      endSec: buf[buf.length - 1].seg.end,
      text: buf.map((l) => l.line).join('\n')
    })
    buf = []
    size = 0
  }

  for (const l of lines) {
    const len = l.line.length + 1
    if (size > 0 && size + len > maxChars) flush()
    buf.push(l)
    size += len
  }
  flush()

  return chunks.map((c) => ({ ...c, total: chunks.length }))
}

const DIGEST_SYSTEM = `Bạn đang đọc MỘT PHẦN của bản bóc băng một cuộc họp dài, và phải rút gọn phần này lại để sau đó ghép với các phần khác thành bản tóm tắt chung.

Nguyên tắc:
- Viết tiếng Việt, GIỮ NGUYÊN thuật ngữ tiếng Anh chuyên môn.
- Chỉ ghi những gì THỰC SỰ có trong phần này, không suy diễn, không bịa.
- Giữ nguyên chính xác số liệu, deadline, tên người, tên hệ thống/sản phẩm.
- Nêu rõ AI nói/quyết định/nhận việc gì.
- Đây là bản trung gian, không phải bản tóm tắt cuối — thà dài và đầy đủ còn hơn ngắn mà mất thông tin.

Trả về đúng các mục sau, dạng chữ có gạch đầu dòng, KHÔNG dùng JSON:
NỘI DUNG ĐÃ BÀN:
QUYẾT ĐỊNH:
VIỆC CẦN LÀM (ai phụ trách, hạn):
VẤN ĐỀ CÒN TREO:
AI ĐÓNG GÓP GÌ:
SỐ LIỆU / THUẬT NGỮ ĐÁNG NHỚ:
Mục nào phần này không có thì ghi "không có".`

/** Rút gọn một phần bản bóc băng. */
async function digestChunk(
  settings: Settings,
  project: Project,
  c: TranscriptChunk
): Promise<string> {
  const user = `Cuộc họp: ${project.name}
Đây là PHẦN ${c.index + 1}/${c.total}, từ phút ${formatTime(c.startSec)} đến ${formatTime(c.endSec)}.
Người nói trong cả cuộc họp: ${project.speakers.map((s) => s.name).join(', ')}

=== PHẦN BÓC BĂNG ===
${c.text}
=== HẾT PHẦN ${c.index + 1}/${c.total} ===`

  const out = await chat(settings, DIGEST_SYSTEM, user, { maxTokens: 4000 })
  return `### PHẦN ${c.index + 1}/${c.total} (${formatTime(c.startSec)} – ${formatTime(c.endSec)})\n${out.trim()}`
}

/**
 * Rút gọn dần cho tới khi toàn bộ nội dung vừa một lần gọi.
 * Vòng lặp có giới hạn để không bao giờ chạy vô tận nếu model trả về lảm nhảm dài hơn cả đầu vào.
 */
async function reduceUntilFits(
  settings: Settings,
  project: Project,
  digests: string[],
  maxChars: number,
  onProgress?: (msg: string) => void
): Promise<string> {
  let current = digests
  for (let round = 0; round < 3; round++) {
    const joined = current.join('\n\n')
    if (joined.length <= maxChars || current.length === 1) return joined

    onProgress?.(`Nội dung vẫn còn dài — đang rút gọn thêm vòng ${round + 2}`)
    const groups: string[][] = []
    let buf: string[] = []
    let size = 0
    for (const d of current) {
      if (size > 0 && size + d.length > maxChars) {
        groups.push(buf)
        buf = []
        size = 0
      }
      buf.push(d)
      size += d.length
    }
    if (buf.length) groups.push(buf)
    if (groups.length >= current.length) return joined.slice(0, maxChars)

    const next: string[] = []
    for (let i = 0; i < groups.length; i++) {
      const out = await chat(
        settings,
        DIGEST_SYSTEM,
        `Gộp các bản rút gọn sau của cùng một cuộc họp thành MỘT bản rút gọn, giữ nguyên thứ tự thời gian và mọi số liệu/tên người:\n\n${groups[i].join('\n\n')}`,
        { maxTokens: 4000 }
      )
      next.push(out.trim())
    }
    current = next
  }
  return current.join('\n\n')
}

function buildSummary(
  parsed: Partial<MeetingSummary>,
  project: Project,
  settings: Settings,
  meta: { label: string; model: string },
  parts: number
): MeetingSummary {
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
    model: meta.model,
    parts: parts > 1 ? parts : undefined
  }
}

const finalSystem = (settings: Settings): string =>
  `${settings.summaryPrompt}\n\nCHỈ trả về JSON hợp lệ theo đúng schema sau, không kèm markdown, không kèm giải thích:\n${SUMMARY_SCHEMA}`

export async function summarizeProject(
  project: Project,
  settings: Settings,
  onProgress?: (msg: string) => void
): Promise<MeetingSummary> {
  if (!project.segments.length) throw new Error('Chưa có bản bóc băng để tóm tắt.')
  const meta = providerMeta(settings)
  const nameOf = new Map(project.speakers.map((s) => [s.id, s.name]))
  const transcript = transcriptToText(project)
  const limit = chunkChars(settings)

  const header = `Tên file/cuộc họp: ${project.name}
Thời lượng: ${formatTime(project.durationSec ?? 0)}
Số người nói: ${project.speakers.length}
Danh sách người nói: ${project.speakers.map((s) => s.name).join(', ')}`

  const oneShot = async (): Promise<MeetingSummary> => {
    const raw = await chat(
      settings,
      finalSystem(settings),
      `${header}\n\n=== BẢN BÓC BĂNG ===\n${transcript}\n=== HẾT ===`,
      { json: true, maxTokens: 16000 }
    )
    return buildSummary(extractJson(raw) as Partial<MeetingSummary>, project, settings, meta, 1)
  }

  /** Đường dài: chia phần → rút gọn từng phần → ghép → sinh JSON cuối. */
  const chunked = async (size: number): Promise<MeetingSummary> => {
    const chunks = chunkTranscript(project.segments, nameOf, size)
    onProgress?.(`Bản bóc băng dài ${Math.round(transcript.length / 1000)}k ký tự — chia làm ${chunks.length} phần`)

    const digests: string[] = []
    for (const c of chunks) {
      onProgress?.(`Đang tóm tắt phần ${c.index + 1}/${c.total} (${formatTime(c.startSec)} – ${formatTime(c.endSec)})`)
      digests.push(await digestChunk(settings, project, c))
    }

    const merged = await reduceUntilFits(settings, project, digests, size, onProgress)
    onProgress?.(`Đang ghép ${chunks.length} phần thành bản tóm tắt chung`)

    const raw = await chat(
      settings,
      finalSystem(settings),
      `${header}

Dưới đây KHÔNG phải bản bóc băng đầy đủ mà là bản rút gọn của từng phần cuộc họp, xếp theo thứ tự thời gian. Hãy tổng hợp chúng thành MỘT bản tóm tắt chung cho cả cuộc họp: gộp các ý trùng nhau, giữ nguyên số liệu và tên người, sắp xếp theo chủ đề chứ không theo số thứ tự phần.

=== CÁC PHẦN ĐÃ RÚT GỌN ===
${merged}
=== HẾT ===`,
      { json: true, maxTokens: 16000 }
    )
    return buildSummary(extractJson(raw) as Partial<MeetingSummary>, project, settings, meta, chunks.length)
  }

  /**
   * Model từ chối vì quá dài thì thử lại với phần NHỎ HƠN.
   * Chia lại đúng cỡ cũ là chắc chắn lỗi tiếp — mỗi model một cửa sổ ngữ cảnh
   * khác nhau và con số trong Cài đặt chỉ là phỏng đoán.
   */
  const chunkedShrinking = async (startSize: number): Promise<MeetingSummary> => {
    let size = Math.max(MIN_CHUNK_CHARS, startSize)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await chunked(size)
      } catch (err) {
        const msg = (err as Error).message || ''
        const next = Math.floor(size / 3)
        if (!isContextLengthError(msg) || next < MIN_CHUNK_CHARS) throw err
        size = Math.max(MIN_CHUNK_CHARS, next)
        onProgress?.(`Model vẫn báo quá dài — chia nhỏ hơn nữa (${Math.round(size / 1000)}k ký tự mỗi phần)`)
      }
    }
    throw new Error(
      'Đã thử chia nhỏ nhiều lần mà model vẫn báo nội dung quá dài. ' +
        'Vào Cài đặt → Prompt tóm tắt, giảm "Độ dài mỗi phần khi tóm tắt", ' +
        'hoặc đổi sang model có cửa sổ ngữ cảnh lớn hơn.'
    )
  }

  // Ngắn thì gọi thẳng một phát cho nhanh và sát nội dung nhất
  if (!limit || transcript.length <= limit) {
    try {
      return await oneShot()
    } catch (err) {
      const msg = (err as Error).message || ''
      if (!isContextLengthError(msg) || !limit) throw err
      onProgress?.('Model báo nội dung quá dài — đang tự chia nhỏ rồi tóm tắt lại từng phần')
      // Chia sao cho chắc chắn ra ít nhất 3 phần, vì cỡ đang dùng vừa bị model từ chối
      return await chunkedShrinking(Math.floor(Math.min(limit, transcript.length) / 3))
    }
  }

  return await chunkedShrinking(limit)
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
