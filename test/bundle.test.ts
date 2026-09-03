import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseBundle, BUNDLE_FORMAT, BUNDLE_VERSION } from '../src/main/lib/bundle'
import { cosine, mergeEmbeddings, normalize } from '../src/main/lib/voice'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meetsum-bundle-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const write = (name: string, content: string): string => {
  const p = join(dir, name)
  writeFileSync(p, content, 'utf-8')
  return p
}

const validBundle = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: '2026-08-01T00:00:00.000Z',
    exportedBy: 'Quỳnh',
    includesVoiceprints: true,
    speakers: [{ id: 'spk_a', name: 'Tuấn', named: true, color: '#fff', embedding: [1, 0], seen: 3 }],
    meetings: [
      {
        id: 'prj_goc',
        name: 'Review Q3',
        createdAt: '2026-08-01T00:00:00.000Z',
        speakers: [{ id: 'spk_a', name: 'Tuấn', named: true, color: '#fff' }],
        segments: [{ id: 's1', start: 0, end: 5, speakerId: 'spk_a', text: 'Doanh thu tăng.' }]
      }
    ],
    ...over
  })

describe('parseBundle — từ chối file rác bằng lời nói được', () => {
  it('đọc được gói hợp lệ', () => {
    const b = parseBundle(write('ok.meetsum', validBundle()))
    expect(b.meetings).toHaveLength(1)
    expect(b.exportedBy).toBe('Quỳnh')
    expect(b.speakers[0].name).toBe('Tuấn')
  })

  it('file không tồn tại thì báo về đường dẫn/quyền', () => {
    expect(() => parseBundle(join(dir, 'khong-co.meetsum'))).toThrow(/đường dẫn|quyền/i)
  })

  it('không phải JSON thì gợi ý khả năng tải dở', () => {
    expect(() => parseBundle(write('rac.meetsum', 'day khong phai json'))).toThrow(/tải dở|JSON/i)
  })

  it('JSON hợp lệ nhưng không phải gói MeetSum', () => {
    expect(() => parseBundle(write('khac.json', '{"hello":"world"}'))).toThrow(/không phải gói/i)
  })

  it('gói của bản app mới hơn thì bảo đi cập nhật, không cố đọc bừa', () => {
    const p = write('moi.meetsum', validBundle({ version: BUNDLE_VERSION + 5 }))
    expect(() => parseBundle(p)).toThrow(/cập nhật/i)
  })

  it('gói rỗng thì nói rõ là không có cuộc họp nào', () => {
    expect(() => parseBundle(write('rong.meetsum', validBundle({ meetings: [] })))).toThrow(
      /không có cuộc họp/i
    )
  })

  it('thiếu mảng speakers vẫn đọc được, coi như không kèm danh bạ', () => {
    const b = parseBundle(write('khong-sp.meetsum', validBundle({ speakers: undefined })))
    expect(b.speakers).toEqual([])
  })
})

/**
 * Phần quan trọng nhất của việc nhập: mẫu giọng của người gửi phải được TRỘN vào
 * mẫu của mình theo số lần gặp, chứ không ghi đè. Đây là cùng một hàm mà
 * importBundle dùng, test riêng ở đây vì nó là chỗ dễ sai nhất.
 */
describe('trộn danh bạ khi nhập gói', () => {
  const vec = (seed: number, dim = 16): number[] =>
    normalize(Array.from({ length: dim }, (_, i) => Math.sin(seed * 12.9898 + i * 78.233)))

  it('bên đã gặp nhiều lần hơn có tiếng nói lớn hơn', () => {
    const mine = vec(1)
    const theirs = vec(2)
    const merged = mergeEmbeddings(mine, 10, theirs, 1) as number[]
    expect(cosine(merged, mine)).toBeGreaterThan(cosine(merged, theirs))
  })

  it('nhận gói hai lần thì mẫu giọng không bị lệch đi mãi', () => {
    const mine = vec(1)
    const theirs = vec(1.02)
    let cur = mine
    let seen = 5
    for (let i = 0; i < 5; i++) {
      cur = mergeEmbeddings(cur, seen, theirs, 2) as number[]
      seen += 2
    }
    // vẫn còn rất giống giọng gốc của mình
    expect(cosine(cur, mine)).toBeGreaterThan(0.95)
  })

  it('người gửi không kèm vector thì giữ nguyên vector của mình', () => {
    const mine = vec(3)
    const out = mergeEmbeddings(mine, 4, undefined, 1) as number[]
    expect(cosine(out, mine)).toBeCloseTo(1, 10)
  })
})

/**
 * Gói .meetsum đến từ máy khác — có thể do bản app cũ tạo, hoặc bị sửa tay.
 * Không được tin là mọi trường đều có mặt.
 */
describe('gói thiếu trường vẫn đọc được, không rò undefined', () => {
  it('người nói thiếu "named" thì parse được, không nổ', () => {
    const raw = JSON.stringify({
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      exportedAt: '2026-08-01T00:00:00.000Z',
      includesVoiceprints: false,
      speakers: [{ id: 'spk_a', name: 'Tuấn', color: '#fff' }],
      meetings: [
        {
          id: 'p1',
          name: 'Họp',
          createdAt: '2026-08-01T00:00:00.000Z',
          speakers: [{ id: 'spk_a', name: 'Tuấn', color: '#fff' }],
          segments: [{ id: 's1', start: 0, end: 5, speakerId: 'spk_a', text: 'xin chào' }]
        }
      ]
    })
    const b = parseBundle(write('thieu-truong.meetsum', raw))
    expect(b.meetings[0].segments).toHaveLength(1)
    expect(b.speakers[0].name).toBe('Tuấn')
  })
})
