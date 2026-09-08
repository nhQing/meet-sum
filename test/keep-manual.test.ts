import { describe, expect, it } from 'vitest'
import { isManualSpeaker, keepManualSpeakers } from '../src/main/lib/keepManual'
import type { SpeakerProfile, TranscriptSegment } from '../src/shared/types'

const sp = (id: string, name: string, over: Partial<SpeakerProfile> = {}): SpeakerProfile => ({
  id,
  name,
  named: true,
  color: '#fff',
  ...over
})

const seg = (id: string, speakerId: string): TranscriptSegment => ({
  id,
  start: 0,
  end: 5,
  speakerId,
  text: 'x'
})

describe('isManualSpeaker', () => {
  it('đã đặt tên mà chưa có voiceprint = người gõ tay', () => {
    expect(isManualSpeaker(sp('a', 'Quỳnh'))).toBe(true)
  })

  it('có voiceprint = do máy phát hiện, không phải gõ tay', () => {
    expect(isManualSpeaker(sp('a', 'Quỳnh', { embedding: [1, 2, 3] }))).toBe(false)
  })

  it('user_n chưa đặt tên thì không tính là gõ tay', () => {
    expect(isManualSpeaker(sp('a', 'user_1', { named: false }))).toBe(false)
  })
})

describe('keepManualSpeakers — không xoá công gõ tên của người dùng', () => {
  /** Người dùng gõ tay 3 tên trước khi bóc băng, không ai có voiceprint. */
  const goTay = [sp('m1', 'Quỳnh'), sp('m2', 'Bằng'), sp('m3', 'Dương')]

  it('bóc băng xong vẫn giữ đủ tên đã gõ', () => {
    const built = [sp('d1', 'user_1', { named: false, embedding: [1] })]
    const res = keepManualSpeakers(goTay, built, [seg('s1', 'd1')])
    expect(res.speakers).toHaveLength(4)
    expect(res.unassigned).toEqual(['Quỳnh', 'Bằng', 'Dương'])
  })

  it('người máy phát hiện luôn đứng trước, người gõ tay xếp sau', () => {
    const built = [sp('d1', 'user_1', { named: false, embedding: [1] })]
    const res = keepManualSpeakers(goTay, built, [])
    expect(res.speakers[0].id).toBe('d1')
    expect(res.speakers.slice(1).map((s) => s.name)).toEqual(['Quỳnh', 'Bằng', 'Dương'])
  })

  it('danh bạ đã nhận ra đúng tên đó thì KHÔNG giữ thêm, tránh danh sách bị đôi', () => {
    const built = [sp('d1', 'Quỳnh', { embedding: [1] })]
    const res = keepManualSpeakers(goTay, built, [])
    expect(res.unassigned).toEqual(['Bằng', 'Dương'])
    expect(res.speakers.filter((s) => s.name === 'Quỳnh')).toHaveLength(1)
  })

  it('so tên không phân biệt hoa thường và khoảng trắng', () => {
    const built = [sp('d1', '  quỳnh ', { embedding: [1] })]
    expect(keepManualSpeakers(goTay, built, []).unassigned).not.toContain('Quỳnh')
  })

  it('người gõ tay đã có lượt nói trỏ tới thì để buildSpeakers lo, không giữ trùng', () => {
    const built = [sp('m1', 'Quỳnh', { embedding: [1] })]
    const res = keepManualSpeakers(goTay, built, [seg('s1', 'm1')])
    expect(res.speakers.filter((s) => s.id === 'm1')).toHaveLength(1)
  })

  it('không có ai gõ tay thì trả về đúng danh sách máy dựng', () => {
    const built = [sp('d1', 'user_1', { named: false, embedding: [1] })]
    const res = keepManualSpeakers([], built, [])
    expect(res.speakers).toEqual(built)
    expect(res.unassigned).toEqual([])
  })

  it('KHÔNG tự đoán gán tên vào giọng vừa phát hiện', () => {
    // Gõ tay 3 tên, máy phát hiện đúng 3 giọng — rất dễ tưởng là ghép được theo
    // thứ tự, nhưng đoán sai thì biên bản ghi sai người một cách tự tin.
    const built = [
      sp('d1', 'user_1', { named: false, embedding: [1] }),
      sp('d2', 'user_2', { named: false, embedding: [2] }),
      sp('d3', 'user_3', { named: false, embedding: [3] })
    ]
    const res = keepManualSpeakers(goTay, built, [])
    expect(res.speakers.filter((s) => s.name.startsWith('user_'))).toHaveLength(3)
    expect(res.unassigned).toHaveLength(3)
  })
})
