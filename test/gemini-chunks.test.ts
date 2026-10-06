import { describe, expect, it } from 'vitest'
import {
  buildGeminiPrompt,
  applyNamedLabels,
  classifyQuota,
  isAnonLabel,
  parseChunkSegments,
  parseClock,
  planChunks,
  promptTail
} from '../src/main/lib/geminiChunks'

describe('planChunks — chia audio thành đoạn gửi Gemini', () => {
  it('video 90 phút, không bỏ qua gì -> 9 đoạn 10 phút', () => {
    const c = planChunks(5400, [], 600)
    expect(c).toHaveLength(9)
    expect(c[0]).toEqual({ start: 0, end: 600 })
    expect(c[8]).toEqual({ start: 4800, end: 5400 })
  })

  it('bỏ qua 14 phút đầu thì không gửi phần đó', () => {
    const c = planChunks(5413.57, [{ start: 0, end: 861.69 }], 600)
    expect(c[0].start).toBeCloseTo(861.69)
    expect(c[c.length - 1].end).toBeCloseTo(5413.57)
    expect(c.every((x) => x.end - x.start <= 600 + 1e-6)).toBe(true)
  })

  it('đoạn cuối quá ngắn thì nhập vào đoạn trước, khỏi tốn một lượt gọi', () => {
    const c = planChunks(1210, [], 600)
    expect(c).toEqual([
      { start: 0, end: 600 },
      { start: 600, end: 1210 }
    ])
  })

  it('vùng bỏ qua ở giữa tách audio làm hai phần', () => {
    const c = planChunks(1200, [{ start: 300, end: 900 }], 600)
    expect(c).toEqual([
      { start: 0, end: 300 },
      { start: 900, end: 1200 }
    ])
  })
})

describe('parseClock — Gemini trả mốc thời gian nhiều kiểu', () => {
  it.each([
    [12.5, 12.5],
    ['12.5', 12.5],
    ['01:05', 65],
    ['1:02:03', 3723],
    ['00:07.5', 7.5]
  ])('%s -> %s', (v, want) => {
    expect(parseClock(v)).toBeCloseTo(want as number)
  })

  it('giá trị rác -> NaN', () => {
    expect(Number.isNaN(parseClock('abc'))).toBe(true)
    expect(Number.isNaN(parseClock(undefined))).toBe(true)
  })
})

describe('parseChunkSegments — đổi mốc của đoạn sang mốc video gốc', () => {
  it('cộng offset của đoạn, giữ tên người nói', () => {
    const raw = JSON.stringify([
      { start: '00:05', end: '00:09', speaker: 'Quỳnh', text: 'Bắt đầu nhé' },
      { start: 10, end: 14, speaker: 'Người lạ 1', text: 'Vâng' }
    ])
    const s = parseChunkSegments(raw, 900, 600)
    expect(s).toEqual([
      { start: 905, end: 909, speaker: 'Quỳnh', text: 'Bắt đầu nhé' },
      { start: 910, end: 914, speaker: 'Người lạ 1', text: 'Vâng' }
    ])
  })

  it('mốc vượt quá độ dài đoạn thì kẹp lại, không lấn sang đoạn sau', () => {
    const raw = JSON.stringify([{ start: 590, end: 700, speaker: 'A', text: 'x' }])
    expect(parseChunkSegments(raw, 0, 600)[0]).toMatchObject({ start: 590, end: 600 })
  })

  it('kết quả bị cắt cụt giữa chừng vẫn cứu được các câu đã đủ', () => {
    const raw = '[{"start":1,"end":2,"speaker":"A","text":"một"},{"start":3,"end":4,"speaker":"B","text":"ha'
    const s = parseChunkSegments(raw, 0, 600)
    expect(s).toHaveLength(1)
    expect(s[0].text).toBe('một')
  })

  it('bỏ câu rỗng và bọc markdown', () => {
    const raw = '```json\n[{"start":1,"end":2,"speaker":"A","text":"  "},{"start":3,"end":4,"speaker":"A","text":"ok"}]\n```'
    expect(parseChunkSegments(raw, 0, 600).map((x) => x.text)).toEqual(['ok'])
  })
})

describe('isAnonLabel — nhãn nào là "chưa biết tên"', () => {
  it.each(['SPEAKER_00', 'Người lạ 2', 'nguoi la 1', 'Unknown', 'user_3', ''])('%s là ẩn danh', (l) => {
    expect(isAnonLabel(l)).toBe(true)
  })
  it.each(['Quỳnh', 'Hoàng Bùi'])('%s là tên thật', (l) => {
    expect(isAnonLabel(l)).toBe(false)
  })
})

describe('buildGeminiPrompt', () => {
  it('đưa danh sách người họp, thuật ngữ và phần cuối đoạn trước vào prompt', () => {
    const p = buildGeminiPrompt({
      lang: 'tiếng Việt',
      names: ['Quỳnh', 'Bằng'],
      terms: ['MaiMoney'],
      context: '',
      tail: 'Quỳnh: Xong phần này rồi.'
    })
    expect(p).toContain('Quỳnh, Bằng')
    expect(p).toContain('MaiMoney')
    expect(p).toContain('Xong phần này rồi.')
  })

  it('không có gì thì không nhắc tới mấy mục đó', () => {
    const p = buildGeminiPrompt({ lang: 'tiếng Việt', names: [], terms: [], context: '', tail: '' })
    expect(p).not.toContain('Người tham gia')
    expect(p).not.toContain('Đoạn ngay trước')
  })
})

describe('promptTail — vài câu cuối đoạn trước để Gemini gọi tên nhất quán', () => {
  it('lấy các câu cuối, kèm tên người nói', () => {
    const t = promptTail(
      [
        { start: 0, end: 1, speaker: 'Quỳnh', text: 'a' },
        { start: 1, end: 2, speaker: 'Bằng', text: 'b' },
        { start: 2, end: 3, speaker: 'Quỳnh', text: 'c' }
      ],
      2
    )
    expect(t).toBe('Bằng: b\nQuỳnh: c')
  })
})

describe('applyNamedLabels — Gemini gọi được tên thì dùng luôn tên đó', () => {
  const sp = (id: string, name: string, named = false) => ({ id, name, named, color: '#000' })
  const seg = (id: string, speakerId: string) => ({ id, start: 0, end: 1, speakerId, text: 'x' })

  it('tên trùng người đã gõ tay -> dùng lại đúng người đó (id, màu), không tạo người mới', () => {
    const r = applyNamedLabels(
      [sp('spk_new1', 'user_1'), sp('spk_new2', 'user_2')],
      [seg('s1', 'spk_new1'), seg('s2', 'spk_new2')],
      { 'Quỳnh': 'spk_new1', 'Người lạ 1': 'spk_new2' },
      [{ ...sp('spk_manual', 'Quỳnh', true), color: '#f00' }]
    )
    expect(r.speakers[0]).toMatchObject({ id: 'spk_manual', name: 'Quỳnh', named: true, color: '#f00' })
    expect(r.segments[0].speakerId).toBe('spk_manual')
    // nhãn ẩn danh giữ nguyên user_n để người dùng tự đặt
    expect(r.speakers[1]).toMatchObject({ id: 'spk_new2', name: 'user_2', named: false })
  })

  it('tên mới chưa có -> đặt tên luôn', () => {
    const r = applyNamedLabels([sp('a', 'user_1')], [seg('s1', 'a')], { 'Hải': 'a' }, [])
    expect(r.speakers[0]).toMatchObject({ id: 'a', name: 'Hải', named: true })
  })
})

describe('classifyQuota — đọc lỗi 429 của Gemini để biết có nên gửi lại không', () => {
  const body = (violations: string[], retry?: string): string =>
    JSON.stringify({
      error: {
        code: 429,
        message: 'You exceeded your current quota',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: violations.map((quotaId) => ({ quotaId })) },
          ...(retry ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: retry }] : [])
        ]
      }
    })

  it('hết hạn mức theo NGÀY -> không gửi lại', () => {
    expect(classifyQuota(body(['GenerateRequestsPerDayPerProjectPerModel-FreeTier'], '13s')).kind).toBe('daily')
  })

  it('model không có hạn mức miễn phí (limit: 0) -> không gửi lại', () => {
    const raw = '{"error":{"code":429,"message":"Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 0, model: gemini-3.1-pro"}}'
    expect(classifyQuota(raw).kind).toBe('no-free-tier')
  })

  it('vượt hạn mức theo PHÚT -> chờ đúng số giây Google bảo', () => {
    const q = classifyQuota(body(['GenerateContentInputTokensPerModelPerMinute-FreeTier'], '41.5s'))
    expect(q).toEqual({ kind: 'minute', retryAfterSec: 42 })
  })

  it('không đọc được gì -> coi như theo phút, chờ mặc định', () => {
    expect(classifyQuota('not json')).toEqual({ kind: 'minute', retryAfterSec: 60 })
  })
})
