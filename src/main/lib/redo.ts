import type { TranscriptSegment } from '../../shared/types'

/**
 * Ghép kết quả bóc lại của MỘT KHOẢNG vào biên bản đã có.
 *
 * Người dùng chọn một khoảng nghe không ra chữ, bóc lại riêng khoảng đó với
 * cấu hình nhạy hơn, rồi kết quả mới phải thay đúng chỗ cũ — không được đụng
 * tới phần còn lại của biên bản.
 *
 * Tách riêng ra khỏi IPC để test được: đây là chỗ dễ làm mất nội dung nhất.
 */

/** Hai khoảng có giao nhau không (chạm mép không tính). */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart) > 0.01
}

/**
 * Đoán người nói cho một lượt mới, dựa trên lượt CŨ chồng lấn nhiều nhất.
 *
 * Bóc lại chỉ lấy chữ chứ không chạy lại tách người nói (chậm và không cần),
 * nên người nói được kế thừa từ biên bản cũ. Không có gì để dựa vào thì trả
 * về người nói đầu tiên của cuộc họp — người dùng sửa tay được, và như thế
 * vẫn hơn là để trống.
 */
export function guessSpeaker(
  seg: { start: number; end: number },
  previous: TranscriptSegment[],
  fallback: string
): string {
  let best = ''
  let bestOverlap = 0
  for (const p of previous) {
    const ov = Math.min(seg.end, p.end) - Math.max(seg.start, p.start)
    if (ov > bestOverlap) {
      bestOverlap = ov
      best = p.speakerId
    }
  }
  if (best) return best

  // Không chồng lấn ai: lấy người nói của lượt gần nhất về thời gian
  let nearest = ''
  let nearestGap = Infinity
  for (const p of previous) {
    const gap = seg.start >= p.end ? seg.start - p.end : p.start - seg.end
    if (gap >= 0 && gap < nearestGap) {
      nearestGap = gap
      nearest = p.speakerId
    }
  }
  return nearest || fallback
}

export interface MergeResult {
  segments: TranscriptSegment[]
  /** Số lượt cũ đã bị thay */
  replaced: number
  /** Số lượt mới thêm vào */
  added: number
}

/**
 * Bỏ các lượt cũ nằm trong [start, end] rồi chèn các lượt mới vào đúng chỗ.
 *
 * Lượt cũ chỉ chồng lấn MỘT PHẦN khoảng chọn thì vẫn bị thay: nếu giữ lại,
 * nội dung sẽ trùng lặp với lượt mới vừa bóc ra ở cùng quãng thời gian đó.
 */
export function mergeRedone(
  previous: TranscriptSegment[],
  fresh: { start: number; end: number; text: string }[],
  start: number,
  end: number,
  newId: () => string
): MergeResult {
  const kept = previous.filter((p) => !overlaps(p.start, p.end, start, end))
  const replaced = previous.length - kept.length
  const fallback = previous[0]?.speakerId ?? 'SPEAKER_00'

  const inserted: TranscriptSegment[] = fresh
    .filter((f) => (f.text || '').trim().length > 0)
    .map((f) => ({
      id: newId(),
      start: f.start,
      end: f.end,
      text: f.text.trim(),
      speakerId: guessSpeaker(f, previous, fallback),
      edited: true
    }))

  const segments = [...kept, ...inserted].sort((a, b) => a.start - b.start || a.end - b.end)
  return { segments, replaced, added: inserted.length }
}
