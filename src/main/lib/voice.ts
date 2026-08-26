/** Xử lý vector đặc trưng giọng nói (voiceprint). */

export function cosine(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function normalize(v: number[]): number[] {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n)
  return n > 0 ? v.map((x) => x / n) : v
}

/**
 * Số lần gặp tối đa được tính vào trọng số. Chặn lại để mẫu giọng vẫn còn
 * thích nghi được khi người ta đổi mic, đổi phòng, hay bị khàn tiếng.
 */
const MAX_WEIGHT = 8

/**
 * Trộn mẫu giọng cũ với mẫu vừa thu được, lấy trung bình có trọng số theo số
 * lần đã gặp. Trước đây mẫu cũ bị ghi đè thẳng, nên chỉ một cuộc họp thu âm tệ
 * là làm hỏng mẫu giọng đã tốt.
 */
export function blendEmbedding(
  oldVec: number[] | undefined,
  newVec: number[] | undefined,
  seen: number
): number[] | undefined {
  if (!newVec?.length) return oldVec
  if (!oldVec?.length || oldVec.length !== newVec.length) return normalize(newVec)

  const w = Math.min(Math.max(1, seen), MAX_WEIGHT)
  const out = new Array<number>(oldVec.length)
  for (let i = 0; i < oldVec.length; i++) {
    out[i] = (oldVec[i] * w + newVec[i]) / (w + 1)
  }
  return normalize(out)
}

/** Gộp hai mẫu giọng của cùng một người, cân theo số lần gặp của mỗi bên. */
export function mergeEmbeddings(
  a: number[] | undefined,
  aSeen: number,
  b: number[] | undefined,
  bSeen: number
): number[] | undefined {
  if (!a?.length) return b?.length ? normalize(b) : undefined
  if (!b?.length) return normalize(a)
  if (a.length !== b.length) return normalize(a)

  const wa = Math.max(1, aSeen)
  const wb = Math.max(1, bSeen)
  const out = new Array<number>(a.length)
  for (let i = 0; i < a.length; i++) {
    out[i] = (a[i] * wa + b[i] * wb) / (wa + wb)
  }
  return normalize(out)
}
