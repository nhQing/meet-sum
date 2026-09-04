import { describe, expect, it } from 'vitest'
import { guessSpeaker, mergeRedone, overlaps } from '../src/main/lib/redo'
import type { TranscriptSegment } from '../src/shared/types'

let n = 0
const newId = (): string => `new_${++n}`

const seg = (id: string, start: number, end: number, speakerId: string, text = 'cũ'): TranscriptSegment => ({
  id,
  start,
  end,
  speakerId,
  text
})

/** Biên bản cũ: 3 lượt, có một khoảng trống 30–60 mà AI không nghe ra chữ nào. */
const truoc = (): TranscriptSegment[] => [
  seg('a', 0, 10, 'sp1', 'Chào mọi người.'),
  seg('b', 10, 30, 'sp2', 'Bắt đầu nhé.'),
  seg('c', 60, 70, 'sp1', 'Chốt vậy đi.')
]

describe('overlaps', () => {
  it('giao nhau thật thì đúng', () => {
    expect(overlaps(0, 10, 5, 15)).toBe(true)
    expect(overlaps(5, 15, 0, 10)).toBe(true)
  })

  it('chỉ chạm mép thì không tính là giao', () => {
    expect(overlaps(0, 10, 10, 20)).toBe(false)
  })

  it('rời hẳn nhau thì không giao', () => {
    expect(overlaps(0, 10, 20, 30)).toBe(false)
  })
})

describe('mergeRedone — bóc lại một khoảng', () => {
  it('điền vào đúng khoảng trống, KHÔNG đụng phần còn lại', () => {
    const res = mergeRedone(truoc(), [{ start: 32, end: 45, text: 'Câu vừa nghe ra được.' }], 30, 60, newId)
    expect(res.replaced).toBe(0)
    expect(res.added).toBe(1)
    expect(res.segments.map((s) => s.text)).toEqual([
      'Chào mọi người.',
      'Bắt đầu nhé.',
      'Câu vừa nghe ra được.',
      'Chốt vậy đi.'
    ])
  })

  it('thay lượt cũ nằm trong khoảng chọn', () => {
    const res = mergeRedone(truoc(), [{ start: 12, end: 28, text: 'Bản nghe lại rõ hơn.' }], 10, 30, newId)
    expect(res.replaced).toBe(1)
    expect(res.segments.find((s) => s.text === 'Bắt đầu nhé.')).toBeUndefined()
    expect(res.segments.find((s) => s.text === 'Bản nghe lại rõ hơn.')).toBeDefined()
    // hai lượt ngoài khoảng còn nguyên
    expect(res.segments.find((s) => s.id === 'a')).toBeDefined()
    expect(res.segments.find((s) => s.id === 'c')).toBeDefined()
  })

  it('lượt cũ chỉ chồng lấn một phần cũng bị thay, tránh nội dung trùng nhau', () => {
    const res = mergeRedone(truoc(), [{ start: 5, end: 25, text: 'Nghe lại cả đoạn.' }], 5, 25, newId)
    expect(res.replaced).toBe(2)
    expect(res.segments).toHaveLength(2)
  })

  it('kết quả luôn sắp theo thời gian', () => {
    const res = mergeRedone(
      truoc(),
      [
        { start: 50, end: 55, text: 'sau' },
        { start: 32, end: 40, text: 'trước' }
      ],
      30,
      60,
      newId
    )
    const starts = res.segments.map((s) => s.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it('bóc lại không ra chữ nào thì chỉ xoá lượt cũ, không chèn rác', () => {
    const res = mergeRedone(truoc(), [{ start: 12, end: 20, text: '   ' }], 10, 30, newId)
    expect(res.added).toBe(0)
    expect(res.replaced).toBe(1)
    expect(res.segments).toHaveLength(2)
  })

  it('biên bản đang rỗng vẫn chèn được', () => {
    const res = mergeRedone([], [{ start: 0, end: 5, text: 'Câu đầu tiên.' }], 0, 10, newId)
    expect(res.segments).toHaveLength(1)
    expect(res.segments[0].speakerId).toBe('SPEAKER_00')
  })

  it('lượt mới được đánh dấu là đã sửa tay, để phân biệt với bản máy chạy', () => {
    const res = mergeRedone(truoc(), [{ start: 35, end: 40, text: 'x' }], 30, 60, newId)
    expect(res.segments.find((s) => s.text === 'x')?.edited).toBe(true)
  })
})

describe('guessSpeaker — kế thừa người nói từ biên bản cũ', () => {
  it('lấy người chồng lấn nhiều nhất', () => {
    expect(guessSpeaker({ start: 8, end: 20 }, truoc(), 'x')).toBe('sp2')
  })

  it('không chồng lấn ai thì lấy người của lượt gần nhất', () => {
    expect(guessSpeaker({ start: 40, end: 45 }, truoc(), 'x')).toBe('sp2')
  })

  it('biên bản rỗng thì dùng giá trị dự phòng', () => {
    expect(guessSpeaker({ start: 0, end: 5 }, [], 'sp_default')).toBe('sp_default')
  })
})
