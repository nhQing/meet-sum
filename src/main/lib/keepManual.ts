import type { SpeakerProfile, TranscriptSegment } from '../../shared/types'

/**
 * Giữ lại những người nói NGƯỜI DÙNG TỰ THÊM khi bóc băng xong.
 *
 * Vấn đề: buildSpeakers() dựng danh sách người nói chỉ từ kết quả diarization
 * cộng danh bạ giọng nói, rồi pipeline ghi đè cả mảng project.speakers. Ai gõ
 * tay 12 cái tên trước khi bóc băng là mất sạch — mà đó là việc thật, mất là
 * mất công.
 *
 * Những người này KHÔNG có voiceprint (chưa từng được nghe), nên không có cách
 * nào khớp tự động vào giọng vừa phát hiện. Cố đoán mà gán bừa thì còn tệ hơn:
 * biên bản sẽ ghi sai người một cách tự tin. Nên chỉ giữ lại và để người dùng
 * tự bấm Gộp vào giọng đúng.
 */

/** Người nói do người dùng gõ tay: đã đặt tên, chưa có voiceprint. */
export function isManualSpeaker(sp: SpeakerProfile): boolean {
  return Boolean(sp.named) && !sp.embedding?.length
}

export interface KeepResult {
  speakers: SpeakerProfile[]
  /** Tên những người được giữ lại mà chưa gán được giọng nào */
  unassigned: string[]
}

/**
 * Ghép danh sách vừa dựng với những người nói gõ tay còn sót lại.
 *
 * Bỏ qua người gõ tay nếu tên đã trùng với một người vừa phát hiện — nghĩa là
 * danh bạ đã nhận ra họ rồi, giữ thêm chỉ làm danh sách bị đôi.
 */
export function keepManualSpeakers(
  previous: SpeakerProfile[],
  built: SpeakerProfile[],
  segments: TranscriptSegment[]
): KeepResult {
  const builtIds = new Set(built.map((s) => s.id))
  const builtNames = new Set(built.map((s) => s.name.trim().toLowerCase()))
  const usedInSegments = new Set(segments.map((s) => s.speakerId))

  const kept: SpeakerProfile[] = []
  for (const sp of previous) {
    if (!isManualSpeaker(sp)) continue
    if (builtIds.has(sp.id)) continue
    if (builtNames.has(sp.name.trim().toLowerCase())) continue
    // Đã có lượt nói trỏ tới thì buildSpeakers lo rồi, không phải người mồ côi
    if (usedInSegments.has(sp.id)) continue
    kept.push(sp)
  }

  return {
    speakers: [...built, ...kept],
    unassigned: kept.map((s) => s.name)
  }
}
