/**
 * Phần thuần (không đụng mạng, không đụng ffmpeg) của việc bóc băng bằng Gemini
 * theo từng đoạn. Tách riêng ra để test được.
 *
 * Vì sao phải chia đoạn: gửi nguyên cuộc họp 90 phút trong MỘT lượt thì kết quả
 * hay bị cắt cụt giữa chừng (chạm giới hạn token đầu ra) và mốc thời gian trôi
 * dần về cuối file. Đoạn khoảng 10 phút thì Gemini nghe kỹ, mốc chuẩn, và hỏng
 * một đoạn chỉ phải gọi lại đoạn đó.
 */

export interface ChunkSpan {
  start: number
  end: number
}

export interface GeminiSegment {
  start: number
  end: number
  speaker: string
  text: string
}

/** Đoạn cuối ngắn hơn mức này thì nhập vào đoạn trước. */
const MIN_TAIL_SEC = 60

/**
 * Chia phần audio CẦN bóc (đã trừ vùng bỏ qua) thành các đoạn dài tối đa
 * `chunkSec`. Mốc theo timeline gốc của video.
 */
export function planChunks(
  durationSec: number,
  skipRanges: { start: number; end: number }[],
  chunkSec: number
): ChunkSpan[] {
  const total = Math.max(0, durationSec || 0)
  if (!total) return []

  const skips = (skipRanges || [])
    .map((r) => ({ start: Math.max(0, Math.min(r.start, r.end)), end: Math.min(total, Math.max(r.start, r.end)) }))
    .filter((r) => r.end - r.start > 0.05)
    .sort((a, b) => a.start - b.start)

  const keep: ChunkSpan[] = []
  let cursor = 0
  for (const s of skips) {
    if (s.start - cursor > 0.05) keep.push({ start: cursor, end: s.start })
    cursor = Math.max(cursor, s.end)
  }
  if (total - cursor > 0.05) keep.push({ start: cursor, end: total })

  const out: ChunkSpan[] = []
  for (const k of keep) {
    let a = k.start
    while (k.end - a > 0.05) {
      let b = Math.min(k.end, a + chunkSec)
      if (k.end - b < MIN_TAIL_SEC) b = k.end
      out.push({ start: a, end: b })
      a = b
    }
  }
  return out
}

/** Đọc mốc thời gian: số giây, "MM:SS", "HH:MM:SS" (cho phép phần lẻ). */
export function parseClock(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return NaN
  const s = v.trim()
  if (!s) return NaN
  if (!s.includes(':')) return Number(s)
  const parts = s.split(':').map(Number)
  if (parts.some((p) => Number.isNaN(p))) return NaN
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

/**
 * Lấy mảng JSON từ câu trả lời. Nếu bị cắt cụt giữa một phần tử thì bỏ phần
 * tử dở dang đó và giữ những câu đã đủ — mất một câu còn hơn mất cả đoạn.
 */
function extractArray(text: string): unknown[] {
  let t = (text || '').trim()
  if (t.startsWith('```')) t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '')
  const first = t.indexOf('[')
  if (first < 0) return []
  t = t.slice(first)
  try {
    const v = JSON.parse(t.slice(0, t.lastIndexOf(']') + 1))
    if (Array.isArray(v)) return v
  } catch {
    // rơi xuống phần cứu dữ liệu bên dưới
  }
  const lastClose = t.lastIndexOf('}')
  if (lastClose < 0) return []
  try {
    const v = JSON.parse(t.slice(0, lastClose + 1) + ']')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** Đổi câu trả lời của một đoạn sang danh sách câu theo mốc video gốc. */
export function parseChunkSegments(text: string, offset: number, chunkLen: number): GeminiSegment[] {
  const out: GeminiSegment[] = []
  for (const r of extractArray(text)) {
    const o = (r ?? {}) as Record<string, unknown>
    const body = String(o.text ?? '').trim()
    if (!body) continue
    let a = parseClock(o.start)
    let b = parseClock(o.end)
    if (Number.isNaN(a)) continue
    if (Number.isNaN(b) || b < a) b = a
    a = Math.max(0, Math.min(a, chunkLen))
    b = Math.max(a, Math.min(b, chunkLen))
    out.push({
      start: Number((a + offset).toFixed(3)),
      end: Number((b + offset).toFixed(3)),
      speaker: String(o.speaker ?? '').trim(),
      text: body
    })
  }
  return out.sort((x, y) => x.start - y.start)
}

/** Nhãn Gemini dùng khi không biết người đó là ai. */
export function isAnonLabel(label: string): boolean {
  const l = (label || '').trim().toLowerCase()
  if (!l) return true
  return /^(speaker[_ ]?\d+|người lạ\s*\d*|nguoi la\s*\d*|unknown.*|user_\d+)$/.test(l)
}

/** Vài câu cuối của đoạn trước, để đoạn sau gọi tên người nói nhất quán. */
export function promptTail(segments: GeminiSegment[], n = 12): string {
  return segments
    .slice(-n)
    .map((s) => `${s.speaker || 'Người lạ'}: ${s.text}`)
    .join('\n')
}

export interface PromptInput {
  lang: string
  names: string[]
  terms: string[]
  context: string
  tail: string
}

export function buildGeminiPrompt(p: PromptInput): string {
  const lines = [
    'Bạn là hệ thống bóc băng cuộc họp. Nghe toàn bộ đoạn audio đính kèm và trả về DUY NHẤT một mảng JSON, không giải thích, không markdown.',
    '',
    'Mỗi phần tử: {"start": "MM:SS", "end": "MM:SS", "speaker": "<tên>", "text": "..."}',
    '',
    'Yêu cầu:',
    '- Mốc thời gian tính từ đầu ĐOẠN audio này (bắt đầu từ 00:00).',
    '- Tách theo lượt nói: đổi người nói thì bắt đầu phần tử mới.',
    `- Ngôn ngữ chính là ${p.lang}. Giữ nguyên từ/thuật ngữ tiếng Anh đúng như người nói phát âm, không dịch.`,
    '- Ghi đúng những gì nghe được. Không bỏ sót, không thêm, không tóm tắt.',
    '- Đoạn im lặng, nhạc nền, tiếng ồn thì bỏ qua — TUYỆT ĐỐI không bịa câu kiểu "hãy subscribe", "hẹn gặp lại", "cảm ơn đã theo dõi".',
    '- Cùng một giọng phải luôn dùng đúng một nhãn trong cả đoạn.'
  ]
  if (p.names.length) {
    lines.push(
      `- Người tham gia cuộc họp: ${p.names.join(', ')}. Chỉ dùng một tên trong danh sách này khi CHẮC CHẮN (người đó tự giới thiệu, được gọi tên và trả lời, hoặc cùng giọng với người đã có tên ở phần trước). Không chắc thì ghi "Người lạ 1", "Người lạ 2"...`
    )
  } else {
    lines.push('- Chưa biết tên ai thì ghi "Người lạ 1", "Người lạ 2"...')
  }
  if (p.terms.length) lines.push(`- Tên riêng và thuật ngữ hay gặp (viết đúng chính tả này): ${p.terms.join(', ')}.`)
  if (p.context) lines.push(`- Bối cảnh cuộc họp: ${p.context}`)
  if (p.tail) {
    lines.push(
      '',
      'Đoạn ngay trước đoạn audio này (chỉ để tham khảo cách gọi tên người nói, KHÔNG chép lại vào kết quả):',
      p.tail
    )
  }
  return lines.join('\n')
}

interface NamedSpeaker {
  id: string
  name: string
  named: boolean
  color: string
}

/**
 * buildSpeakers() đặt ai cũng là user_n vì nó chỉ biết voiceprint. Nhưng với
 * Gemini, nhãn người nói thường CHÍNH LÀ tên thật (nó được đưa danh sách người
 * họp). Nhãn nào là tên thật thì:
 *  - trùng tên người đã có trong cuộc họp (thường là người dùng gõ tay) ->
 *    gộp vào đúng người đó, giữ id/màu/vai trò;
 *  - chưa có -> đặt tên luôn.
 * Nhãn ẩn danh ("Người lạ 1") để nguyên user_n cho người dùng tự đặt.
 */
export function applyNamedLabels<S extends NamedSpeaker, G extends { speakerId: string }>(
  speakers: S[],
  segments: G[],
  keyToId: Record<string, string>,
  previous: S[]
): { speakers: S[]; segments: G[] } {
  const remap: Record<string, string> = {}
  const byName = new Map(previous.map((p) => [p.name.trim().toLowerCase(), p]))
  const idToKey = new Map(Object.entries(keyToId).map(([k, id]) => [id, k]))

  const out = speakers.map((s) => {
    const key = idToKey.get(s.id)
    if (!key || isAnonLabel(key)) return s
    const prev = byName.get(key.trim().toLowerCase())
    if (prev && !Object.values(remap).includes(prev.id)) {
      remap[s.id] = prev.id
      return { ...s, ...prev, name: prev.name, named: true }
    }
    return { ...s, name: key.trim(), named: true }
  })

  return {
    speakers: out,
    segments: segments.map((g) => (remap[g.speakerId] ? { ...g, speakerId: remap[g.speakerId] } : g))
  }
}

export type QuotaKind = 'daily' | 'no-free-tier' | 'minute'

/**
 * Đọc lỗi 429 của Gemini để biết có đáng gửi lại không.
 *
 * Gửi lại là gửi lại NGUYÊN đoạn audio 10 phút — mỗi lần đốt thêm vài chục
 * nghìn token. Hết hạn mức của cả ngày, hoặc model không có hạn mức miễn phí
 * (limit: 0, ví dụ dòng Pro), thì gửi lại chắc chắn hỏng mà vẫn tốn — trước đây
 * app thử 4 lần liền, làm hạn mức hết nhanh hơn hẳn. Chỉ vượt hạn mức theo phút
 * mới đáng chờ rồi gửi lại, và chờ đúng số giây Google bảo.
 */
export function classifyQuota(raw: string): { kind: QuotaKind; retryAfterSec?: number } {
  const text = raw || ''
  if (/limit:\s*0\b/.test(text)) return { kind: 'no-free-tier' }
  if (/PerDay/i.test(text)) return { kind: 'daily' }
  let retryAfterSec = 60
  try {
    const details = (JSON.parse(text)?.error?.details ?? []) as { retryDelay?: string }[]
    const d = details.find((x) => typeof x.retryDelay === 'string')?.retryDelay
    const n = d ? parseFloat(d) : NaN
    if (Number.isFinite(n) && n > 0) retryAfterSec = Math.ceil(n)
  } catch {
    // không phải JSON: dùng mặc định
  }
  return { kind: 'minute', retryAfterSec }
}
