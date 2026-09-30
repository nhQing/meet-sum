import type { TranscriptSegment } from './types'

/** Khoảng thời gian sẽ được bóc băng lại cho một lượt nói. */
export interface SegmentRedoRange {
  start: number
  end: number
  /**
   * Khoảng này có "ăn" thêm phần lặng sau lượt nói không.
   *
   * Đây mới là điểm chính của tính năng: chỗ AI bỏ sót người nói thường nằm
   * đúng trong khoảng trống giữa hai lượt, chứ không nằm trong lượt đã có chữ.
   */
  includesGap: boolean
}

/** Khoảng ngắn hơn mức này thì main process từ chối chạy. */
export const MIN_REDO_SEC = 0.5

/**
 * Tính khoảng bóc lại cho một lượt nói: từ lúc lượt này bắt đầu cho tới ngay
 * trước khi lượt kế tiếp bắt đầu.
 *
 * Vài chi tiết dễ sai:
 * - Phải xét trên TOÀN BỘ danh sách đã sắp xếp, không phải danh sách đang lọc
 *   theo ô tìm kiếm — nếu không, "lượt kế tiếp" sẽ là một lượt cách đó rất xa.
 * - Nếu hai lượt chồng lấn nhau (lượt sau bắt đầu trước khi lượt này kết thúc)
 *   thì lấy điểm kết thúc của chính lượt này, để không cắt cụt nội dung đã có.
 * - Lượt cuối cùng kéo tới hết video, vì phần đuôi cũng là chỗ hay bị bỏ sót.
 */
export function segmentRedoRange(
  segments: TranscriptSegment[],
  segmentId: string,
  durationSec?: number
): SegmentRedoRange | null {
  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end)
  const idx = sorted.findIndex((s) => s.id === segmentId)
  if (idx < 0) return null

  const seg = sorted[idx]
  const next = sorted.slice(idx + 1).find((s) => s.start > seg.start)

  const tail = Number.isFinite(durationSec) ? (durationSec as number) : seg.end
  const end = next ? Math.max(seg.end, next.start) : Math.max(seg.end, tail)

  return { start: seg.start, end, includesGap: end > seg.end + 0.01 }
}

/** Hai khoảng có giao nhau không (chạm mép không tính). */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart) > 0.01
}

/** Bao nhiêu phần trăm của lượt nói nằm trong khoảng chọn (0–1). */
export function insideRatio(segStart: number, segEnd: number, start: number, end: number): number {
  const dur = Math.max(0.01, segEnd - segStart)
  const ov = Math.min(segEnd, end) - Math.max(segStart, start)
  return Math.max(0, ov) / dur
}

/**
 * Lượt cũ phải nằm trong khoảng chọn ít nhất chừng này mới bị thay.
 *
 * Trước đây chỉ cần chạm nhau một chút là xoá. Kéo chọn lố sang một góc của câu
 * bên cạnh là mất trắng cả câu đó, mà phần mới bóc ra lại không phủ hết nó —
 * chữ biến mất không dấu vết.
 */
export const REPLACE_RATIO = 0.5

/**
 * Phần thò ra ngoài khoảng chọn tối đa còn chấp nhận xoá được (giây).
 *
 * Chỉ nhìn tỉ lệ là chưa đủ. Một lượt dài 20 giây mà bóc lại đúng 10 giây giữa
 * thì tỉ lệ vẫn quá 50%, nhưng 5 giây đầu và 5 giây cuối là chữ THẬT mà lần bóc
 * lại không hề nghe tới — xoá đi là mất hẳn. Thò ra nhiều thì giữ lại: cùng lắm
 * là trùng nội dung ở mép, nhìn thấy được và xoá tay được, còn hơn mất chữ trong
 * im lặng.
 */
export const MAX_LOST_SEC = 2

/** Lượt cũ này có được phép thay bằng kết quả bóc lại không. */
export function shouldReplace(
  seg: { start: number; end: number },
  start: number,
  end: number
): boolean {
  if (insideRatio(seg.start, seg.end, start, end) < REPLACE_RATIO) return false
  const thoRaTrai = Math.max(0, start - seg.start)
  const thoRaPhai = Math.max(0, seg.end - end)
  return thoRaTrai <= MAX_LOST_SEC && thoRaPhai <= MAX_LOST_SEC
}

/**
 * Nới khoảng bóc lại ra cho trùm trọn những lượt nói nó chạm vào.
 *
 * Kéo chọn bằng tay gần như không bao giờ trùng đúng mốc đầu/cuối của một lượt.
 * Chọn 12–58 thường cắt ngang câu ở 10–30 và câu ở 30–60. Lúc đó không có lựa
 * chọn nào tốt: thay cả câu thì mất phần chữ nằm ngoài khoảng (lần bóc lại
 * không nghe tới đoạn đó), còn giữ câu lại thì nội dung trùng nhau ở mép.
 *
 * Cách thoát ra là đừng chọn giữa hai cái dở: nới khoảng thành 10–60 rồi bóc
 * lại trọn cả hai câu. Không mất chữ, không trùng chữ. Nghe thêm vài giây audio
 * là cái giá quá rẻ.
 */
export function snapToSegments(
  segments: { start: number; end: number }[],
  start: number,
  end: number
): { start: number; end: number } {
  let a = Math.min(start, end)
  let b = Math.max(start, end)

  // Lặp vì nới ra có thể chạm thêm lượt khác (lượt chồng lấn nhau).
  for (let i = 0; i < 8; i++) {
    let a2 = a
    let b2 = b
    for (const sg of segments) {
      if (!overlaps(sg.start, sg.end, a, b)) continue
      if (sg.start < a2) a2 = sg.start
      if (sg.end > b2) b2 = sg.end
    }
    if (a2 === a && b2 === b) break
    a = a2
    b = b2
  }
  return { start: Math.max(0, a), end: b }
}
