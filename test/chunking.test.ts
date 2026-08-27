import { describe, expect, it } from 'vitest'
import { chunkChars, chunkTranscript, DEFAULT_CHUNK_CHARS } from '../src/main/lib/summarize'
import { defaultSettings } from '../src/main/lib/defaults'
import type { TranscriptSegment } from '../src/shared/types'

const nameOf = new Map([
  ['a', 'Quỳnh'],
  ['b', 'Tuấn']
])

/** n lượt nói, mỗi lượt ~len ký tự, cách nhau 10 giây. */
const segs = (n: number, len = 100): TranscriptSegment[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    start: i * 10,
    end: i * 10 + 10,
    speakerId: i % 2 ? 'b' : 'a',
    text: 'x'.repeat(len)
  }))

describe('chunkChars — đọc cấu hình', () => {
  it('mặc định bật, 45k ký tự', () => {
    expect(chunkChars(defaultSettings())).toBe(45000)
    expect(DEFAULT_CHUNK_CHARS).toBe(45000)
  })

  it('0 nghĩa là tắt tự chia', () => {
    expect(chunkChars({ ...defaultSettings(), summaryChunkChars: 0 })).toBe(0)
  })

  it('số quá nhỏ bị nâng lên mức tối thiểu, tránh chia thành hàng nghìn mảnh vụn', () => {
    expect(chunkChars({ ...defaultSettings(), summaryChunkChars: 50 })).toBeGreaterThanOrEqual(4000)
  })
})

describe('chunkTranscript — chia theo lượt nói', () => {
  it('ngắn thì chỉ một phần', () => {
    const c = chunkTranscript(segs(5), nameOf, 45000)
    expect(c).toHaveLength(1)
    expect(c[0].total).toBe(1)
  })

  it('dài thì chia thành nhiều phần, mỗi phần không vượt giới hạn', () => {
    const c = chunkTranscript(segs(200, 500), nameOf, 20000)
    expect(c.length).toBeGreaterThan(1)
    for (const part of c) expect(part.text.length).toBeLessThanOrEqual(20000)
  })

  it('KHÔNG cắt giữa câu — mọi lượt nói còn nguyên vẹn', () => {
    const all = segs(120, 400)
    const c = chunkTranscript(all, nameOf, 15000)
    const joined = c.map((x) => x.text).join('\n')
    for (const sg of all) {
      expect(joined).toContain(sg.text)
    }
    // và số dòng đúng bằng số lượt nói, không có dòng nào bị xé đôi
    expect(joined.split('\n')).toHaveLength(all.length)
  })

  it('không mất và không lặp lượt nói nào', () => {
    const all = segs(97, 300)
    const c = chunkTranscript(all, nameOf, 9000)
    const lines = c.flatMap((x) => x.text.split('\n'))
    expect(lines).toHaveLength(97)
    expect(new Set(lines).size).toBeGreaterThan(1)
  })

  it('mỗi phần biết mốc thời gian của mình, nối tiếp nhau đúng thứ tự', () => {
    const c = chunkTranscript(segs(100, 400), nameOf, 12000)
    expect(c[0].startSec).toBe(0)
    for (let i = 1; i < c.length; i++) {
      expect(c[i].startSec).toBeGreaterThanOrEqual(c[i - 1].endSec)
      expect(c[i].index).toBe(i)
      expect(c[i].total).toBe(c.length)
    }
  })

  it('một lượt nói dài hơn cả giới hạn vẫn đứng riêng, không bị cắt', () => {
    const monster: TranscriptSegment[] = [
      { id: 'm', start: 0, end: 600, speakerId: 'a', text: 'y'.repeat(50000) },
      { id: 'n', start: 600, end: 610, speakerId: 'b', text: 'ngắn thôi' }
    ]
    const c = chunkTranscript(monster, nameOf, 10000)
    expect(c).toHaveLength(2)
    expect(c[0].text).toContain('y'.repeat(50000))
  })

  it('bản bóc băng rỗng thì không ra phần nào, không nổ', () => {
    expect(chunkTranscript([], nameOf, 45000)).toEqual([])
  })

  it('có tên người nói trong từng dòng để model biết ai nói gì', () => {
    const c = chunkTranscript(segs(4, 50), nameOf, 45000)
    expect(c[0].text).toContain('Quỳnh:')
    expect(c[0].text).toContain('Tuấn:')
    expect(c[0].text).toMatch(/\[\d{2}:\d{2}\]/)
  })
})
