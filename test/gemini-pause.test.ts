import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Không cắt audio thật: trả về một file giả, đọc ra vài byte
vi.mock('../src/main/lib/ffmpeg', () => ({
  sliceAudioMp3: vi.fn(async () => 'fake.mp3'),
  sliceAudio: vi.fn(),
  compressAudio: vi.fn()
}))
vi.mock('fs', async (orig) => {
  const real = await orig<typeof import('fs')>()
  return { ...real, readFileSync: vi.fn(() => Buffer.from('abc')), rmSync: vi.fn() }
})

import { transcribeWithGemini } from '../src/main/lib/apiEngine'
import { defaultSettings } from '../src/main/lib/defaults'

const settings = (() => {
  const s = defaultSettings()
  s.llm.providers.gemini.apiKey = 'k'
  return s
})()

/** Gemini giả: mỗi lượt gọi trả một câu ở giây thứ 5 của đoạn. */
function geminiReply(text: string): Response {
  const body = { candidates: [{ content: { parts: [{ text: JSON.stringify([{ start: 5, end: 8, speaker: 'Quỳnh', text }]) }] } }] }
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('transcribeWithGemini — tạm dừng và chạy tiếp', () => {
  let calls = 0
  beforeEach(() => {
    calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        return geminiReply(`câu ${calls}`)
      })
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('chạy hết: 3 đoạn, lưu tiến độ sau mỗi đoạn', async () => {
    const saved: number[] = []
    const r = await transcribeWithGemini('p', 'a.wav', 1800, settings, () => {}, {
      onChunkDone: (_all, done) => saved.push(done)
    })
    expect(r.stopped).toBe(false)
    expect(r.segments.map((s) => s.start)).toEqual([5, 605, 1205])
    expect(saved).toEqual([600, 1200, 1800])
  })

  it('bấm dừng sau đoạn 1 -> dừng, giữ câu đã có, không gọi thêm', async () => {
    let stop = false
    const r = await transcribeWithGemini('p', 'a.wav', 1800, settings, () => {}, {
      shouldStop: () => stop,
      onChunkDone: () => {
        stop = true
      }
    })
    expect(r.stopped).toBe(true)
    expect(r.doneSec).toBe(600)
    expect(r.segments).toHaveLength(1)
    expect(calls).toBe(1)
  })

  it('chạy tiếp: bỏ qua phần đã xong, nối vào câu cũ', async () => {
    const r = await transcribeWithGemini('p', 'a.wav', 1800, settings, () => {}, {
      resume: { segments: [{ start: 5, end: 8, speaker: 'Quỳnh', text: 'cũ' }], doneSec: 600 }
    })
    expect(calls).toBe(2)
    expect(r.segments.map((s) => s.text)).toEqual(['cũ', 'câu 1', 'câu 2'])
    expect(r.segments[1].start).toBe(605)
  })

  it('bấm dừng khi Gemini đang nghe -> huỷ lượt gọi đó, không chờ nó trả lời', async () => {
    let stop = false
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_res, rej) => {
            stop = true // người dùng bấm dừng ngay khi request đang chạy
            init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
          })
      )
    )
    const r = await transcribeWithGemini('p', 'a.wav', 1800, settings, () => {}, { shouldStop: () => stop })
    expect(r.stopped).toBe(true)
    expect(r.doneSec).toBe(0)
    expect(r.segments).toEqual([])
  })
})
