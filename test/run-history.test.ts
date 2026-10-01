import { describe, expect, it } from 'vitest'
import {
  addRun,
  engineLabel,
  finishRun,
  markInterrupted,
  MAX_RUNS,
  outcomeFromStatus,
  runDurationSec,
  type RunRecord
} from '../src/shared/runHistory'
import { defaultSettings } from '../src/main/lib/defaults'

const rec = (id: string, over: Partial<RunRecord> = {}): RunRecord => ({
  id,
  kind: 'full',
  startedAt: '2026-10-01T08:00:00.000Z',
  outcome: 'running',
  engine: 'Gemini · gemini-2.5-pro',
  ...over
})

describe('addRun', () => {
  it('lần mới nhất đứng đầu', () => {
    const runs = addRun(addRun(undefined, rec('a')), rec('b'))
    expect(runs.map((r) => r.id)).toEqual(['b', 'a'])
  })

  it(`chỉ giữ ${MAX_RUNS} lần gần nhất`, () => {
    let runs: RunRecord[] = []
    for (let i = 0; i < MAX_RUNS + 5; i++) runs = addRun(runs, rec(`r${i}`))
    expect(runs).toHaveLength(MAX_RUNS)
    expect(runs[0].id).toBe(`r${MAX_RUNS + 4}`)
  })
})

describe('finishRun', () => {
  it('chốt kết quả cho đúng lần chạy, không đụng lần khác', () => {
    const runs = [rec('b'), rec('a', { outcome: 'error', message: 'cũ' })]
    const out = finishRun(runs, 'b', {
      outcome: 'error',
      endedAt: '2026-10-01T08:05:00.000Z',
      message: 'Gemini lỗi 403'
    })
    expect(out[0]).toMatchObject({ id: 'b', outcome: 'error', message: 'Gemini lỗi 403' })
    expect(out[1]).toEqual(runs[1])
  })

  it('lần chạy đã chốt rồi thì không ghi đè (ví dụ bị gọi hai lần)', () => {
    const runs = [rec('a', { outcome: 'ok', segments: 10 })]
    expect(finishRun(runs, 'a', { outcome: 'error', endedAt: 'x' })).toEqual(runs)
  })
})

describe('markInterrupted — app bị tắt ngang giữa lúc chạy', () => {
  it('lần còn "đang chạy" chuyển thành "bị ngắt"', () => {
    const out = markInterrupted([rec('a'), rec('b', { outcome: 'ok' })], '2026-10-01T09:00:00.000Z')
    expect(out[0]).toMatchObject({ outcome: 'interrupted', endedAt: '2026-10-01T09:00:00.000Z' })
    expect(out[1].outcome).toBe('ok')
  })
})

describe('outcomeFromStatus', () => {
  it.each([
    ['ready', 'ok'],
    ['done', 'ok'],
    ['paused', 'paused'],
    ['error', 'error'],
    ['transcribing', 'interrupted']
  ] as const)('%s -> %s', (status, want) => {
    expect(outcomeFromStatus(status)).toBe(want)
  })
})

describe('runDurationSec', () => {
  it('tính từ lúc bắt đầu tới lúc kết thúc', () => {
    expect(runDurationSec(rec('a', { endedAt: '2026-10-01T08:01:30.000Z' }))).toBe(90)
  })
  it('chưa kết thúc thì không có', () => {
    expect(runDurationSec(rec('a'))).toBeUndefined()
  })
})

describe('engineLabel — ghi lại chạy bằng gì', () => {
  const s = defaultSettings()
  it('Gemini kèm tên model', () => {
    expect(engineLabel({ ...s, engine: 'api', asrProvider: 'gemini' })).toBe(
      `Gemini · ${s.llm.providers.gemini.model}`
    )
  })
  it('faster-whisper kèm cỡ model', () => {
    expect(engineLabel({ ...s, engine: 'local', localAsr: 'python', fwModelSize: 'large-v3' })).toBe(
      'faster-whisper · large-v3'
    )
  })
  it('VibeVoice', () => {
    expect(engineLabel({ ...s, engine: 'local', localAsr: 'vibevoice' })).toBe('VibeVoice-ASR')
  })
})
