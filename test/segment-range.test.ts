import { describe, expect, it } from 'vitest'
import { MIN_REDO_SEC, segmentRedoRange } from '../src/shared/segmentRange'
import type { TranscriptSegment } from '../src/shared/types'

const seg = (id: string, start: number, end: number): TranscriptSegment => ({
  id,
  start,
  end,
  speakerId: 'sp1',
  text: id
})

/** Biên bản có một khoảng trống 30–60: đúng chỗ AI bỏ sót người nói. */
const bien_ban = (): TranscriptSegment[] => [seg('a', 0, 10), seg('b', 10, 30), seg('c', 60, 70)]

describe('khoảng bóc lại của một lượt nói', () => {
  it('kéo tới ngay trước lượt kế tiếp, không phải tới cuối lượt này', () => {
    // Đây là yêu cầu chính: lượt b kết thúc ở 30 nhưng lượt sau mới bắt đầu ở 60
    const r = segmentRedoRange(bien_ban(), 'b', 100)
    expect(r).toEqual({ start: 10, end: 60, includesGap: true })
  })

  it('lượt sát ngay lượt sau thì không ăn thêm khoảng lặng nào', () => {
    const r = segmentRedoRange(bien_ban(), 'a', 100)
    expect(r).toEqual({ start: 0, end: 10, includesGap: false })
  })

  it('lượt cuối kéo tới hết video, vì phần đuôi cũng hay bị bỏ sót', () => {
    const r = segmentRedoRange(bien_ban(), 'c', 100)
    expect(r).toEqual({ start: 60, end: 100, includesGap: true })
  })

  it('lượt cuối mà không biết độ dài video thì dừng ở cuối lượt', () => {
    const r = segmentRedoRange(bien_ban(), 'c', undefined)
    expect(r).toEqual({ start: 60, end: 70, includesGap: false })
  })

  it('không kéo lùi khi độ dài video nhỏ hơn cuối lượt cuối', () => {
    // durationSec sai/thiếu không được phép sinh ra khoảng âm
    const r = segmentRedoRange(bien_ban(), 'c', 65)
    expect(r).toEqual({ start: 60, end: 70, includesGap: false })
  })

  it('hai lượt chồng lấn: không cắt cụt lượt đang chọn', () => {
    // b bắt đầu ở 5, trước khi a kết thúc ở 10 — lấy 10 chứ không phải 5
    const s = [seg('a', 0, 10), seg('b', 5, 20)]
    const r = segmentRedoRange(s, 'a', 100)
    expect(r).toEqual({ start: 0, end: 10, includesGap: false })
  })

  it('hai lượt bắt đầu cùng lúc: bỏ qua lượt cùng mốc, lấy lượt thật sự kế tiếp', () => {
    const s = [seg('a', 10, 15), seg('b', 10, 20), seg('c', 40, 50)]
    const r = segmentRedoRange(s, 'a', 100)
    expect(r).toEqual({ start: 10, end: 40, includesGap: true })
  })

  it('danh sách chưa sắp xếp vẫn ra đúng lượt kế tiếp', () => {
    const s = [seg('c', 60, 70), seg('a', 0, 10), seg('b', 10, 30)]
    expect(segmentRedoRange(s, 'b', 100)).toEqual({ start: 10, end: 60, includesGap: true })
  })

  it('id không có trong biên bản thì trả về null chứ không đoán bừa', () => {
    expect(segmentRedoRange(bien_ban(), 'khong-co', 100)).toBeNull()
  })

  it('biên bản rỗng thì trả về null', () => {
    expect(segmentRedoRange([], 'a', 100)).toBeNull()
  })

  it('lượt ngắn hơn mức tối thiểu bị nhận ra để nút tự tắt', () => {
    // main process từ chối khoảng < 0.5s, nút phải mờ đi thay vì báo lỗi
    const s = [seg('a', 0, 0.2), seg('b', 0.3, 5)]
    const r = segmentRedoRange(s, 'a', 100)
    expect(r).not.toBeNull()
    expect((r as { end: number; start: number }).end - (r as { start: number }).start).toBeLessThan(
      MIN_REDO_SEC
    )
  })

  it('không sửa mảng gốc', () => {
    const s = [seg('c', 60, 70), seg('a', 0, 10)]
    segmentRedoRange(s, 'a', 100)
    expect(s.map((x) => x.id)).toEqual(['c', 'a'])
  })
})

describe('nút bóc lại từng dòng, chạy hết đường (tính khoảng → ghép kết quả)', () => {
  it('lượt kế tiếp phải sống sót, dù khoảng bóc lại chạm đúng mép nó', async () => {
    const { mergeRedone } = await import('../src/main/lib/redo')
    const truoc = bien_ban()
    const r = segmentRedoRange(truoc, 'b', 100)!

    // Python trả về 2 lượt trong khoảng 10–60, gồm cả phần trước đây im lặng
    const moi = [
      { start: 10, end: 28, text: 'Bắt đầu nhé.' },
      { start: 34, end: 52, text: 'Chỗ trước đây không nghe ra.' }
    ]
    let n = 0
    const res = mergeRedone(truoc, moi, r.start, r.end, () => `new_${++n}`)

    expect(res.replaced).toBe(1) // chỉ lượt b bị thay
    expect(res.added).toBe(2)
    expect(res.segments.map((s) => s.text)).toEqual([
      'a', // lượt a giữ nguyên
      'Bắt đầu nhé.',
      'Chỗ trước đây không nghe ra.',
      'c' // lượt c bắt đầu đúng mốc 60 = mép cuối khoảng — KHÔNG được bị xoá
    ])
  })

  it('lượt cuối kéo tới hết video không đụng vào lượt nào khác', async () => {
    const { mergeRedone } = await import('../src/main/lib/redo')
    const truoc = bien_ban()
    const r = segmentRedoRange(truoc, 'c', 100)!
    const res = mergeRedone(truoc, [{ start: 62, end: 90, text: 'Đuôi họp.' }], r.start, r.end, () => 'x')
    expect(res.replaced).toBe(1)
    expect(res.segments.map((s) => s.id)).toEqual(['a', 'b', 'x'])
  })
})
