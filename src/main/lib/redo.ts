import type { TranscriptSegment } from '../../shared/types'
import { insideRatio, MAX_LOST_SEC, overlaps, REPLACE_RATIO, shouldReplace, snapToSegments } from '../../shared/segmentRange'

// Bày lại ở đây cho tiện dùng: cùng một bộ quy tắc, main và renderer phải khớp nhau
export { insideRatio, MAX_LOST_SEC, overlaps, REPLACE_RATIO, shouldReplace, snapToSegments }

/**
 * Ghép kết quả bóc lại của MỘT KHOẢNG vào biên bản đã có.
 *
 * Người dùng chọn một khoảng nghe không ra chữ, bóc lại riêng khoảng đó với
 * cấu hình nhạy hơn, rồi kết quả mới phải thay đúng chỗ cũ — không được đụng
 * tới phần còn lại của biên bản.
 *
 * Tách riêng ra khỏi IPC để test được: đây là chỗ dễ làm mất nội dung nhất.
 */

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
 * Chỉ thay lượt cũ nào nằm chủ yếu trong khoảng chọn VÀ không thò ra ngoài quá
 * nhiều (xem shouldReplace). Phần thò ra là chữ mà lần bóc lại không nghe tới,
 * xoá đi là mất hẳn.
 *
 * Lượt mới KHÔNG đánh dấu "đã sửa": đó vẫn là chữ do AI nghe ra, chỉ khác lần
 * chạy. Đánh dấu hết thì nhãn "(đã sửa)" mất ý nghĩa, không còn nhìn ra chỗ nào
 * do người thật sửa tay.
 */
export function mergeRedone(
  previous: TranscriptSegment[],
  fresh: { start: number; end: number; text: string }[],
  start: number,
  end: number,
  newId: () => string
): MergeResult {
  const fallback = previous[0]?.speakerId ?? 'SPEAKER_00'

  const inserted: TranscriptSegment[] = fresh
    .filter((f) => (f.text || '').trim().length > 0)
    .map((f) => ({
      id: newId(),
      start: f.start,
      end: f.end,
      text: f.text.trim(),
      speakerId: guessSpeaker(f, previous, fallback)
    }))

  /**
   * Bóc lại mà không ra chữ nào thì GIỮ NGUYÊN biên bản cũ.
   *
   * Xoá sạch rồi báo "không nghe ra chữ nào" là tệ nhất: người dùng bấm bóc lại
   * để mong tốt hơn, kết quả là mất luôn cái đang có. Muốn bỏ đoạn đó thì bấm
   * nút xoá lượt — một cú click, còn chữ đã mất thì không lấy lại được.
   */
  if (!inserted.length) return { segments: previous, replaced: 0, added: 0 }

  const kept = previous.filter((p) => !shouldReplace(p, start, end))
  const replaced = previous.length - kept.length

  const segments = [...kept, ...inserted].sort((a, b) => a.start - b.start || a.end - b.end)
  return { segments, replaced, added: inserted.length }
}
