import { describe, expect, it } from 'vitest'
import { blendEmbedding, cosine, mergeEmbeddings, normalize } from '../src/main/lib/voice'

/** Vector giả nhưng tái lập được, để test không phụ thuộc random. */
const vec = (seed: number, dim = 16): number[] =>
  Array.from({ length: dim }, (_, i) => Math.sin(seed * 12.9898 + i * 78.233))

describe('cosine', () => {
  it('giống hệt nhau thì bằng 1', () => {
    const a = normalize(vec(1))
    expect(cosine(a, a)).toBeCloseTo(1, 10)
  })

  it('khác số chiều hoặc rỗng thì trả 0 chứ không nổ', () => {
    expect(cosine([1, 2, 3], [1, 2])).toBe(0)
    expect(cosine([], [1])).toBe(0)
    expect(cosine([0, 0], [0, 0])).toBe(0)
  })
})

describe('normalize', () => {
  it('đưa độ dài về 1', () => {
    const n = normalize(vec(5))
    const len = Math.sqrt(n.reduce((s, x) => s + x * x, 0))
    expect(len).toBeCloseTo(1, 10)
  })

  it('vector toàn 0 thì giữ nguyên, không chia cho 0', () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0])
  })
})

describe('blendEmbedding — học giọng dần thay vì ghi đè', () => {
  const good = normalize(vec(1))
  const sameVoice = normalize(good.map((x, i) => x + (i % 2 ? 0.06 : -0.06)))
  const garbage = normalize(vec(99))

  it('chưa có mẫu cũ thì lấy mẫu mới, đã chuẩn hoá', () => {
    const out = blendEmbedding(undefined, vec(3), 1) as number[]
    expect(Math.sqrt(out.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 10)
  })

  it('không có mẫu mới thì giữ nguyên mẫu cũ', () => {
    expect(blendEmbedding(good, undefined, 4)).toBe(good)
  })

  it('cả hai đều rỗng thì trả undefined', () => {
    expect(blendEmbedding(undefined, undefined, 1)).toBeUndefined()
  })

  it('lệch số chiều thì dùng mẫu mới', () => {
    const out = blendEmbedding([1, 2], vec(7), 3) as number[]
    expect(out).toHaveLength(16)
  })

  it('một mẫu rác không phá được mẫu tốt đã gặp nhiều lần', () => {
    let learned = good
    for (let seen = 1; seen <= 5; seen++) {
      learned = blendEmbedding(learned, sameVoice, seen) as number[]
    }
    const afterGarbage = blendEmbedding(learned, garbage, 6) as number[]
    // Cách cũ là ghi đè, cosine sẽ tụt về đúng mức của mẫu rác
    expect(cosine(good, garbage)).toBeLessThan(0.5)
    expect(cosine(good, afterGarbage)).toBeGreaterThan(0.9)
  })

  it('trọng số bị chặn để mẫu giọng vẫn thích nghi được khi đổi mic', () => {
    // seen rất lớn không được làm mẫu mới mất hoàn toàn ảnh hưởng
    const shifted = normalize(vec(2))
    const withHugeSeen = blendEmbedding(good, shifted, 100000) as number[]
    expect(cosine(withHugeSeen, good)).toBeLessThan(1)
  })
})

describe('mergeEmbeddings — gộp hai giọng cùng người', () => {
  const a = normalize(vec(5))
  const b = normalize(vec(6))

  it('nghiêng về bên đã gặp nhiều lần hơn', () => {
    const merged = mergeEmbeddings(a, 9, b, 1) as number[]
    expect(cosine(merged, a)).toBeGreaterThan(cosine(merged, b))
  })

  it('gặp bằng nhau thì cân giữa hai bên', () => {
    const merged = mergeEmbeddings(a, 1, b, 1) as number[]
    expect(cosine(merged, a)).toBeCloseTo(cosine(merged, b), 6)
  })

  it('thiếu một bên thì lấy bên còn lại', () => {
    expect(mergeEmbeddings(undefined, 1, b, 2)).toBeDefined()
    expect(mergeEmbeddings(a, 1, undefined, 2)).toBeDefined()
    expect(mergeEmbeddings(undefined, 1, undefined, 1)).toBeUndefined()
  })

  it('kết quả luôn đã chuẩn hoá', () => {
    const merged = mergeEmbeddings(a, 3, b, 4) as number[]
    expect(Math.sqrt(merged.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 10)
  })
})
