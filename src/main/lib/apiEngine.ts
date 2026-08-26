import { readFileSync, statSync } from 'fs'
import type { Settings } from '../../shared/types'
import { compressAudio, sliceAudio } from './ffmpeg'
import type { RawSegment } from './localEngine'

export interface ApiSegment extends RawSegment {
  speaker?: string
}

const DIARIZE_INSTRUCTION = `Bạn là hệ thống bóc băng cuộc họp. Hãy nghe toàn bộ audio và trả về DUY NHẤT một mảng JSON, không kèm giải thích, không kèm markdown.

Mỗi phần tử có dạng:
{"start": <giây, số thực>, "end": <giây, số thực>, "speaker": "SPEAKER_00", "text": "..."}

Yêu cầu:
- Tách theo lượt nói. Mỗi khi người nói thay đổi thì bắt đầu phần tử mới.
- Gán nhãn người nói ổn định: SPEAKER_00, SPEAKER_01, ... Cùng một giọng phải dùng đúng một nhãn trong toàn bộ file.
- Nếu trong audio có người tự giới thiệu tên hoặc được gọi tên, vẫn giữ nhãn SPEAKER_xx (việc đặt tên do người dùng làm sau).
- Ngôn ngữ chính là {{LANG}}. Giữ nguyên các từ/thuật ngữ tiếng Anh đúng như người nói phát âm, không dịch.
- Không bỏ sót đoạn nào. Không thêm nội dung không có trong audio.
- Mốc thời gian tính từ đầu file, đơn vị giây.`

function stripFence(text: string): string {
  let t = text.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '')
  }
  const first = t.indexOf('[')
  const last = t.lastIndexOf(']')
  if (first >= 0 && last > first) t = t.slice(first, last + 1)
  return t.trim()
}

function parseSegments(text: string): ApiSegment[] {
  const raw = JSON.parse(stripFence(text)) as unknown
  const arr = Array.isArray(raw) ? raw : []
  return arr
    .map((r) => {
      const o = r as Record<string, unknown>
      return {
        start: Number(o.start ?? 0),
        end: Number(o.end ?? 0),
        text: String(o.text ?? '').trim(),
        speaker: o.speaker ? String(o.speaker) : undefined
      }
    })
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.start - b.start)
}

// ---------------------------------------------------------------- Gemini

async function geminiUpload(baseUrl: string, apiKey: string, filePath: string, mime: string): Promise<string> {
  const size = statSync(filePath).size
  const uploadBase = baseUrl.replace('/v1beta', '/upload/v1beta')
  const startRes = await fetch(`${uploadBase}/files?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: 'meetsum-audio' } })
  })
  if (!startRes.ok) throw new Error(`Gemini upload start lỗi ${startRes.status}: ${await startRes.text()}`)
  const uploadUrl = startRes.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('Gemini không trả về upload URL.')

  const bytes = readFileSync(filePath)
  const putRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(size),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: bytes
  })
  if (!putRes.ok) throw new Error(`Gemini upload lỗi ${putRes.status}: ${await putRes.text()}`)
  const meta = (await putRes.json()) as { file?: { uri?: string; name?: string; state?: string } }
  let uri = meta.file?.uri
  const name = meta.file?.name
  let state = meta.file?.state

  // Chờ file chuyển sang ACTIVE
  for (let i = 0; i < 60 && state && state !== 'ACTIVE'; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const check = await fetch(`${baseUrl}/${name}?key=${encodeURIComponent(apiKey)}`)
    if (!check.ok) break
    const j = (await check.json()) as { uri?: string; state?: string }
    state = j.state
    uri = j.uri ?? uri
  }
  if (!uri) throw new Error('Gemini không trả về file URI.')
  return uri
}

export async function transcribeWithGemini(
  projectId: string,
  audioPath: string,
  settings: Settings,
  onProgress: (percent: number, message: string) => void
): Promise<ApiSegment[]> {
  const cfg = settings.llm.providers.gemini
  if (!cfg.apiKey) throw new Error('Chưa nhập API key của Gemini trong Cài đặt.')

  onProgress(5, 'Đang nén audio')
  const mp3 = await compressAudio(projectId, audioPath, 48)

  onProgress(15, 'Đang upload audio lên Gemini')
  const fileUri = await geminiUpload(cfg.baseUrl, cfg.apiKey, mp3, 'audio/mpeg')

  onProgress(35, 'Gemini đang nghe và bóc băng')
  const prompt = DIARIZE_INSTRUCTION.replace('{{LANG}}', settings.language === 'auto' ? 'tiếng Việt (có thể lẫn tiếng Anh)' : settings.language)
  const res = await fetch(
    `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }, { fileData: { mimeType: 'audio/mpeg', fileUri } }]
          }
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 65536, responseMimeType: 'application/json' }
      })
    }
  )
  if (!res.ok) throw new Error(`Gemini lỗi ${res.status}: ${(await res.text()).slice(0, 600)}`)
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!text.trim()) throw new Error('Gemini trả về rỗng. Thử model khác hoặc video ngắn hơn.')
  onProgress(95, 'Đang xử lý kết quả')
  return parseSegments(text)
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
