import { describe, expect, it } from 'vitest'
import {
  guessSpeaker,
  insideRatio,
  MAX_LOST_SEC,
  mergeRedone,
  overlaps,
  REPLACE_RATIO,
  shouldReplace,
  snapToSegments
} from '../src/main/lib/redo'
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

  it('sau khi nới khoảng cho trùm trọn lượt thì thay sạch, không sót không trùng', () => {
    // Đây là đường chạy thật: app nới 5–25 thành 0–30 trước khi chạy python
    const r = snapToSegments(truoc(), 5, 25)
    expect(r).toEqual({ start: 0, end: 30 })
    const res = mergeRedone(truoc(), [{ start: 1, end: 28, text: 'Nghe lại cả đoạn.' }], r.start, r.end, newId)
    expect(res.replaced).toBe(2)
    expect(res.segments.map((x) => x.text)).toEqual(['Nghe lại cả đoạn.', 'Chốt vậy đi.'])
  })

  it('lượt chỉ thò một góc vào khoảng chọn thì GIỮ LẠI, không xoá mất chữ', () => {
    // Đây là chỗ mất chữ trong im lặng của bản cũ: kéo chọn lố sang 2 giây của
    // câu bên cạnh là mất trắng cả câu, mà phần mới bóc ra không phủ hết nó.
    const truocDai = [seg('a', 0, 20, 'sp1', 'Câu rất dài, chỉ 2 giây cuối lọt vào khoảng chọn.'), seg('b', 20, 40, 'sp2', 'Câu sau.')]
    const res = mergeRedone(truocDai, [{ start: 18, end: 38, text: 'Bản mới.' }], 18, 38, newId)
    expect(res.segments.map((x) => x.text)).toContain('Câu rất dài, chỉ 2 giây cuối lọt vào khoảng chọn.')
    expect(res.replaced).toBe(1) // chỉ lượt b bị thay
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

  it('bóc lại không ra chữ nào thì GIỮ NGUYÊN biên bản, không xoá gì', () => {
    // Bấm bóc lại để mong tốt hơn mà mất luôn cái đang có là tệ nhất.
    const truocDo = truoc()
    const res = mergeRedone(truocDo, [{ start: 12, end: 20, text: '   ' }], 10, 30, newId)
    expect(res.added).toBe(0)
    expect(res.replaced).toBe(0)
    expect(res.segments).toEqual(truocDo)
  })

  it('python trả về rỗng hoàn toàn cũng giữ nguyên biên bản', () => {
    const truocDo = truoc()
    const res = mergeRedone(truocDo, [], 10, 30, newId)
    expect(res.segments).toEqual(truocDo)
    expect(res.added).toBe(0)
    expect(res.replaced).toBe(0)
  })

  it('biên bản đang rỗng vẫn chèn được', () => {
    const res = mergeRedone([], [{ start: 0, end: 5, text: 'Câu đầu tiên.' }], 0, 10, newId)
    expect(res.segments).toHaveLength(1)
    expect(res.segments[0].speakerId).toBe('SPEAKER_00')
  })

  it('lượt mới KHÔNG bị đánh dấu "đã sửa" — đó vẫn là chữ máy nghe, không phải người sửa', () => {
    // Đánh dấu hết thì nhãn "(đã sửa)" mất ý nghĩa: không còn nhìn ra chỗ nào
    // do người thật sửa tay.
    const res = mergeRedone(truoc(), [{ start: 35, end: 40, text: 'x' }], 30, 60, newId)
    expect(res.segments.find((s) => s.text === 'x')?.edited).toBeFalsy()
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

describe('insideRatio — bao nhiêu phần trăm lượt nói lọt vào khoảng chọn', () => {
  it('nằm trọn trong khoảng thì 100%', () => {
    expect(insideRatio(10, 20, 0, 30)).toBe(1)
  })

  it('nằm ngoài hoàn toàn thì 0%', () => {
    expect(insideRatio(40, 50, 0, 30)).toBe(0)
  })

  it('chạm mép cũng là 0%, không phải số âm', () => {
    expect(insideRatio(30, 40, 0, 30)).toBe(0)
    expect(insideRatio(0, 10, 10, 30)).toBe(0)
  })

  it('thò một nửa vào thì đúng 50% — đúng ngưỡng bị thay', () => {
    expect(insideRatio(0, 20, 10, 30)).toBe(0.5)
    expect(0.5 >= REPLACE_RATIO).toBe(true)
  })

  it('lượt dài 0 giây không làm chia cho 0', () => {
    expect(Number.isFinite(insideRatio(10, 10, 0, 30))).toBe(true)
  })
})

describe('shouldReplace — lượt cũ nào được phép xoá đi thay bằng bản mới', () => {
  it('nằm trọn trong khoảng thì thay', () => {
    expect(shouldReplace({ start: 12, end: 25 }, 10, 30)).toBe(true)
  })

  it('nằm ngoài hẳn thì không đụng tới', () => {
    expect(shouldReplace({ start: 40, end: 50 }, 10, 30)).toBe(false)
  })

  it('thò ra một chút thì vẫn thay, khỏi để lại nội dung trùng', () => {
    expect(shouldReplace({ start: 8.5, end: 25 }, 10, 30)).toBe(true)
  })

  it('thò ra quá 2 giây thì GIỮ LẠI, dù phần lớn nằm trong khoảng', () => {
    // Lượt 0–20, bóc lại đúng 10 giây giữa: tỉ lệ >50% nhưng 5 giây đầu và
    // 5 giây cuối là chữ thật mà lần bóc lại không hề nghe tới.
    expect(insideRatio(0, 20, 5, 15)).toBeGreaterThanOrEqual(REPLACE_RATIO)
    expect(shouldReplace({ start: 0, end: 20 }, 5, 15)).toBe(false)
  })

  it('đúng bằng ngưỡng thò ra thì vẫn thay', () => {
    expect(shouldReplace({ start: 10 - MAX_LOST_SEC, end: 30 }, 10, 30)).toBe(true)
    expect(shouldReplace({ start: 10 - MAX_LOST_SEC - 0.1, end: 30 }, 10, 30)).toBe(false)
  })

  it('kéo chọn trùm nhiều lượt liền nhau thì thay hết, không để lại bản trùng', () => {
    // Trường hợp hay gặp nhất của thao tác kéo chọn
    expect(shouldReplace({ start: 10, end: 30 }, 12, 58)).toBe(true)
    expect(shouldReplace({ start: 30, end: 60 }, 12, 58)).toBe(true)
  })
})

describe('mergeRedone không được làm mất chữ ở mép', () => {
  it('bóc lại giữa một lượt dài: lượt cũ còn nguyên, bản mới nằm cạnh', () => {
    const dai = [seg('x', 0, 20, 'sp1', 'Câu rất dài từ đầu đến cuối.')]
    const res = mergeRedone(dai, [{ start: 5, end: 15, text: 'Phần giữa nghe lại.' }], 5, 15, newId)
    expect(res.replaced).toBe(0)
    expect(res.segments.map((s) => s.text)).toEqual([
      'Câu rất dài từ đầu đến cuối.',
      'Phần giữa nghe lại.'
    ])
  })
})

describe('snapToSegments — nới khoảng cho trùm trọn lượt nói', () => {
  it('cắt ngang hai lượt thì nới ra hai đầu', () => {
    expect(snapToSegments(truoc(), 12, 25)).toEqual({ start: 10, end: 30 })
  })

  it('chọn giữa một lượt dài thì nới thành cả lượt đó', () => {
    expect(snapToSegments([seg('x', 0, 20, 'sp1')], 5, 15)).toEqual({ start: 0, end: 20 })
  })

  it('đã trùng đúng mốc rồi thì giữ nguyên — nút bóc lại từng dòng không bị nới oan', () => {
    expect(snapToSegments(truoc(), 10, 30)).toEqual({ start: 10, end: 30 })
  })

  it('khoảng nằm trong chỗ trống giữa hai lượt thì giữ nguyên', () => {
    expect(snapToSegments(truoc(), 35, 50)).toEqual({ start: 35, end: 50 })
  })

  it('chạm mép không tính là chồng lấn, không nới oan', () => {
    expect(snapToSegments(truoc(), 30, 50)).toEqual({ start: 30, end: 50 })
  })

  it('lượt chồng lấn nhau thì nới dây chuyền cho tới khi đủ', () => {
    const chong = [seg('a', 0, 12, 'sp1'), seg('b', 10, 30, 'sp2'), seg('c', 28, 45, 'sp1')]
    expect(snapToSegments(chong, 20, 22)).toEqual({ start: 0, end: 45 })
  })

  it('đảo đầu đuôi vẫn ra khoảng đúng chiều', () => {
    expect(snapToSegments(truoc(), 25, 12)).toEqual({ start: 10, end: 30 })
  })

  it('không bao giờ trả về mốc âm', () => {
    expect(snapToSegments([seg('x', -5, 10, 'sp1')], 1, 2).start).toBe(0)
  })

  it('biên bản rỗng thì trả nguyên khoảng đã chọn', () => {
    expect(snapToSegments([], 12, 25)).toEqual({ start: 12, end: 25 })
  })

  it('nới xong thì mọi lượt bị chạm đều nằm TRỌN trong khoảng', () => {
    const r = snapToSegments(truoc(), 5, 25)
    for (const sg of truoc()) {
      if (!overlaps(sg.start, sg.end, r.start, r.end)) continue
      expect(sg.start).toBeGreaterThanOrEqual(r.start)
      expect(sg.end).toBeLessThanOrEqual(r.end)
      expect(shouldReplace(sg, r.start, r.end)).toBe(true)
    }
  })
})
