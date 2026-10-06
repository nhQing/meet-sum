import { readFileSync, rmSync } from 'fs'
import type { Settings } from '../../shared/types'
import { compressAudio, sliceAudio, sliceAudioMp3 } from './ffmpeg'
import {
  buildGeminiPrompt,
  classifyQuota,
  isAnonLabel,
  parseChunkSegments,
  planChunks,
  promptTail,
  type GeminiSegment,
  type QuotaKind
} from './geminiChunks'
import type { RawSegment } from './localEngine'

export interface ApiSegment extends RawSegment {
  speaker?: string
}

const CHUNK_SEC = 600 // 10 phút: đủ ngữ cảnh để nhận giọng, mà không chạm trần token đầu ra
const MAX_TRIES = 4

export interface GeminiRunOptions {
  /** Vùng người dùng đánh dấu bỏ qua, mốc theo video gốc */
  skipRanges?: { start: number; end: number }[]
  /** Tên người họp đã biết: người gõ tay trong cuộc họp này + danh bạ giọng nói */
  knownNames?: string[]
  /** Chạy tiếp sau khi tạm dừng: câu đã có + đã bóc xong tới giây nào */
  resume?: { segments: ApiSegment[]; doneSec: number }
  /** Người dùng bấm Tạm dừng chưa — hỏi liên tục, kể cả khi Gemini đang nghe */
  shouldStop?: () => boolean
  /** Xong mỗi đoạn: lưu tiến độ, để dừng hay app bị tắt cũng không mất công */
  onChunkDone?: (segments: ApiSegment[], doneSec: number) => void
}

export interface GeminiRunResult {
  segments: ApiSegment[]
  stopped: boolean
  /** Đã bóc xong tới giây nào (mốc video gốc) */
  doneSec: number
}

/** Người dùng bấm dừng — không phải lỗi, chỉ là tín hiệu thoát vòng lặp. */
class StopRequested extends Error {}

/** Hết hạn mức mà chờ cũng không hết được (theo ngày, hoặc model không có hạn mức miễn phí). */
class QuotaExhausted extends Error {
  constructor(
    readonly kind: QuotaKind,
    readonly raw: string
  ) {
    super(raw)
  }
}

const STOP_POLL_MS = 300

/**
 * Model đã từ chối tắt "suy nghĩ" — nhớ lại để khỏi gửi thử rồi bị từ chối ở
 * mỗi đoạn. Chép lời không cần suy nghĩ: đo thực tế trên gemini-3.5-flash với
 * 1 phút họp, tắt đi giảm từ 3978 xuống 2465 token (~38%) mà chữ vẫn như cũ.
 * Với gói miễn phí, chừng đó là thêm gần nửa cuộc họp mỗi ngày.
 */
const thinkingLocked = new Set<string>()

/** Chờ `ms`, nhưng thoát ngay khi người dùng bấm dừng. */
async function sleepOrStop(ms: number, shouldStop: () => boolean): Promise<void> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (shouldStop()) throw new StopRequested()
    await new Promise((r) => setTimeout(r, Math.min(STOP_POLL_MS, until - Date.now())))
  }
}

/**
 * Một lượt gọi generateContent, tự thử lại khi dính hạn mức (429) hoặc lỗi máy chủ.
 *
 * Một lượt nghe 10 phút audio có thể mất 1–2 phút. Bấm Tạm dừng mà phải chờ
 * hết lượt đó thì nút như bị liệt, nên lượt đang chạy bị HUỶ ngay — chỉ mất
 * đúng đoạn đang nghe dở, chạy tiếp sẽ nghe lại đoạn đó.
 */
async function geminiGenerate(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  audioB64: string,
  onWait: (msg: string) => void,
  shouldStop: () => boolean
): Promise<string> {
  let lastErr = ''
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    if (shouldStop()) throw new StopRequested()
    const ctrl = new AbortController()
    let stopHit = false
    const poll = setInterval(() => {
      if (shouldStop()) {
        stopHit = true
        ctrl.abort()
      }
    }, STOP_POLL_MS)
    const timeout = setTimeout(() => ctrl.abort(), 1000 * 60 * 10)

    let res: Response
    try {
      res = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'audio/mpeg', data: audioB64 } }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 65536,
            responseMimeType: 'application/json',
            ...(thinkingLocked.has(model) ? {} : { thinkingConfig: { thinkingBudget: 0 } })
          }
        })
      })
      if (res.ok) {
        const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
        return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
      }
      lastErr = `Gemini lỗi ${res.status}: ${(await res.text()).slice(0, 600)}`
    } catch (err) {
      if (stopHit || shouldStop()) throw new StopRequested()
      lastErr = (err as Error).message
      onWait(`Mạng lỗi (${lastErr}), thử lại lần ${attempt + 1}`)
      await sleepOrStop(5000 * attempt, shouldStop)
      continue
    } finally {
      clearInterval(poll)
      clearTimeout(timeout)
    }
    // Model không cho tắt suy nghĩ (thường là dòng Pro): gửi lại kiểu thường, không tính lượt
    if (res.status === 400 && /thinking/i.test(lastErr) && !thinkingLocked.has(model)) {
      thinkingLocked.add(model)
      attempt--
      continue
    }
    // 400/401/403 là sai key hoặc sai model — thử lại cũng vô ích
    if (res.status !== 429 && res.status < 500) throw new Error(lastErr)
    let waitSec = 5 * attempt
    if (res.status === 429) {
      const q = classifyQuota(lastErr.slice(lastErr.indexOf('{')))
      // Hết hạn mức ngày / không có hạn mức miễn phí: gửi lại chỉ đốt thêm token
      if (q.kind !== 'minute') throw new QuotaExhausted(q.kind, lastErr)
      waitSec = Math.min(300, q.retryAfterSec ?? 60)
    }
    onWait(`Gemini ${res.status === 429 ? 'báo vượt hạn mức theo phút' : 'đang bận'}, chờ ${waitSec} giây rồi thử lại`)
    await sleepOrStop(waitSec * 1000, shouldStop)
  }
  throw new Error(lastErr || 'Gemini không phản hồi.')
}

/**
 * Bóc băng bằng Gemini: cắt audio thành từng đoạn ~10 phút, gửi lần lượt, ghép lại.
 *
 * Đoạn sau được đưa kèm vài câu cuối của đoạn trước và danh sách người họp, để
 * Gemini gọi đúng tên và gọi nhất quán — mỗi lượt gọi là độc lập, không có cách
 * nào khác để nó biết "giọng này ở đoạn trước là Quỳnh".
 */
export async function transcribeWithGemini(
  projectId: string,
  audioPath: string,
  durationSec: number,
  settings: Settings,
  onProgress: (percent: number, message: string) => void,
  opts: GeminiRunOptions = {}
): Promise<GeminiRunResult> {
  const cfg = settings.llm.providers.gemini
  if (!cfg.apiKey) throw new Error('Chưa nhập API key của Gemini trong Cài đặt.')
  const shouldStop = opts.shouldStop ?? ((): boolean => false)

  // Chạy tiếp: phần đã bóc xong coi như một vùng bỏ qua nữa, thế là các đoạn
  // còn lại bắt đầu đúng ở chỗ dở — không cần cơ chế riêng cho việc này.
  const resumeAt = Math.max(0, opts.resume?.doneSec ?? 0)
  const skips = [...(opts.skipRanges ?? []), ...(resumeAt > 0 ? [{ start: 0, end: resumeAt }] : [])]
  const chunks = planChunks(durationSec, skips, CHUNK_SEC)
  const all: GeminiSegment[] = (opts.resume?.segments ?? [])
    .filter((s) => s.start < resumeAt)
    .map((s) => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker ?? '' }))
  const toApi = (): ApiSegment[] =>
    all.map((s) => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker || undefined }))

  if (!chunks.length) {
    if (resumeAt > 0) return { segments: toApi(), stopped: false, doneSec: resumeAt }
    throw new Error('Không còn đoạn audio nào để bóc (toàn bộ đã bị đánh dấu bỏ qua).')
  }

  const names = Array.from(
    new Set((opts.knownNames ?? []).map((n) => n.trim()).filter((n) => n && !isAnonLabel(n)))
  ).slice(0, 40)
  const terms = (settings.glossary || '')
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 60)
  const lang = settings.language === 'auto' || !settings.language ? 'tiếng Việt (có thể lẫn tiếng Anh)' : settings.language
  const context = (settings.meetingContext || '').trim().replace(/\s+/g, ' ').slice(0, 600)

  // % tính theo phút audio trên cả video, để chạy tiếp thì thanh tiến độ không tụt về 0
  const pct = (sec: number): number => Math.min(98, Math.round((sec / (durationSec || 1)) * 98))
  let doneSec = resumeAt
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const label = `đoạn ${i + 1}/${chunks.length} (phút ${Math.floor(c.start / 60)}–${Math.ceil(c.end / 60)})`
    if (shouldStop()) return { segments: toApi(), stopped: true, doneSec }

    onProgress(pct(c.start), `Đang cắt audio ${label}`)
    const mp3 = await sliceAudioMp3(projectId, audioPath, c.start, c.end - c.start, i)
    const b64 = readFileSync(mp3).toString('base64')
    rmSync(mp3, { force: true })

    onProgress(pct(c.start), `Gemini đang nghe ${label}`)
    const prompt = buildGeminiPrompt({ lang, names, terms, context, tail: promptTail(all) })
    let text: string
    try {
      text = await geminiGenerate(
        cfg.baseUrl,
        cfg.apiKey,
        cfg.model,
        prompt,
        b64,
        (m) => onProgress(pct(c.start), `${m} — ${label}`),
        shouldStop
      )
    } catch (err) {
      if (err instanceof StopRequested) return { segments: toApi(), stopped: true, doneSec }
      if (err instanceof QuotaExhausted) {
        // Tiến độ các đoạn trước đã nằm trong checkpoint: chạy lại là đi tiếp từ đây
        const kept = doneSec > 0 ? ` Đã lưu ${all.length} câu tới phút ${Math.floor(doneSec / 60)} — bấm Bóc băng lại sau là chạy tiếp từ đó.` : ''
        const why =
          err.kind === 'no-free-tier'
            ? `Model ${cfg.model} không có hạn mức miễn phí qua API (limit: 0). Đổi sang model Flash trong Cài đặt, hoặc bật thanh toán cho API key.`
            : 'Đã hết hạn mức miễn phí của Gemini trong ngày hôm nay. Chờ sang ngày (giờ Mỹ) hoặc bật thanh toán cho API key.'
        throw new Error(`${why}${kept}\n\nChi tiết: ${err.raw.slice(0, 400)}`)
      }
      throw err
    }
    const segs = parseChunkSegments(text, c.start, c.end - c.start)
    all.push(...segs)
    doneSec = c.end
    opts.onChunkDone?.(toApi(), doneSec)
    onProgress(pct(c.end), `Xong ${label}: ${segs.length} câu, tổng ${all.length} câu`)
  }
  return { segments: toApi(), stopped: false, doneSec }
}

// ---------------------------------------------------------------- OpenAI

interface VerboseJson {
  segments?: { start: number; end: number; text: string }[]
  text?: string
}

export async function transcribeWithOpenAI(
  projectId: string,
  audioPath: string,
  durationSec: number,
  settings: Settings,
  onProgress: (percent: number, message: string) => void
): Promise<ApiSegment[]> {
  const cfg = settings.llm.providers.openai
  if (!cfg.apiKey) throw new Error('Chưa nhập API key của OpenAI trong Cài đặt.')

  const CHUNK = 600 // 10 phút mỗi lần gửi để không vượt giới hạn 25MB
  const chunks = Math.max(1, Math.ceil((durationSec || CHUNK) / CHUNK))
  const all: ApiSegment[] = []

  for (let i = 0; i < chunks; i++) {
    const offset = i * CHUNK
    onProgress(Math.round((i / chunks) * 85) + 5, `Đang gửi phần ${i + 1}/${chunks} lên OpenAI`)
    const part = chunks === 1 ? await compressAudio(projectId, audioPath, 64) : await sliceAudio(projectId, audioPath, offset, CHUNK, i)

    const form = new FormData()
    const buf = readFileSync(part)
    form.append('file', new Blob([new Uint8Array(buf)]), part.endsWith('.mp3') ? 'audio.mp3' : 'audio.wav')
    form.append('model', 'whisper-1')
    form.append('response_format', 'verbose_json')
    if (settings.language && settings.language !== 'auto') form.append('language', settings.language)

    const res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form
    })
    if (!res.ok) throw new Error(`OpenAI ASR lỗi ${res.status}: ${(await res.text()).slice(0, 500)}`)
    const data = (await res.json()) as VerboseJson
    for (const s of data.segments ?? []) {
      const text = (s.text ?? '').trim()
      if (text) all.push({ start: s.start + offset, end: s.end + offset, text })
    }
  }
  onProgress(92, 'Đang suy luận người nói')
  return all
}
