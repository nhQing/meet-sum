import { cosine } from './voice'
import type { SpeakerProfile, TranscriptSegment } from '../../shared/types'
import type { DiarTurn, RawSegment } from './localEngine'
import { colorForIndex } from './defaults'
import { uid } from './store'


function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

/** Chia text theo tỷ lệ thời gian (dùng khi một câu ASR nằm vắt qua hai lượt nói). */
function splitTextByRatio(text: string, ratio: number): [string, string] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 4) return [text, '']
  const cut = Math.max(1, Math.min(words.length - 1, Math.round(words.length * ratio)))
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')]
}

export interface AssignedSegment extends RawSegment {
  speakerKey: string
  confidence: number
}

/**
 * Gán người nói cho từng câu ASR dựa trên độ trùng thời gian với các lượt nói (diarization).
 * Nếu một câu vắt qua hai người nói thì tách câu đó ra.
 */
export function assignSpeakers(segments: RawSegment[], turns: DiarTurn[]): AssignedSegment[] {
  if (!turns.length) {
    return segments.map((s) => ({ ...s, speakerKey: 'SPEAKER_00', confidence: 0.3 }))
  }
  const out: AssignedSegment[] = []

  for (const seg of segments) {
    const dur = Math.max(0.01, seg.end - seg.start)
    const scored = turns
      .map((t) => ({ turn: t, ov: overlap(seg.start, seg.end, t.start, t.end) }))
      .filter((x) => x.ov > 0.05)
      .sort((a, b) => b.ov - a.ov)

    if (!scored.length) {
      // Không trùng lượt nào: lấy lượt gần nhất
      const nearest = turns.reduce((best, t) => {
        const d = Math.min(Math.abs(t.start - seg.start), Math.abs(t.end - seg.end))
        const bd = Math.min(Math.abs(best.start - seg.start), Math.abs(best.end - seg.end))
        return d < bd ? t : best
      }, turns[0])
      out.push({ ...seg, speakerKey: nearest.speaker, confidence: 0.35 })
      continue
    }

    const top = scored[0]
    const second = scored.find((x) => x.turn.speaker !== top.turn.speaker)

    // Nếu người thứ hai chiếm >30% thời lượng câu -> tách câu
    if (second && second.ov / dur > 0.3 && seg.text.split(/\s+/).length >= 6) {
      const first = top.turn.start <= second.turn.start ? top : second
      const later = first === top ? second : top
      const boundary = Math.max(seg.start, Math.min(seg.end, later.turn.start))
      const ratio = (boundary - seg.start) / dur
      const [t1, t2] = splitTextByRatio(seg.text, ratio)
      if (t1 && t2) {
        out.push({ start: seg.start, end: boundary, text: t1, speakerKey: first.turn.speaker, confidence: 0.7 })
        out.push({ start: boundary, end: seg.end, text: t2, speakerKey: later.turn.speaker, confidence: 0.7 })
        continue
      }
    }

    out.push({ ...seg, speakerKey: top.turn.speaker, confidence: Math.min(1, top.ov / dur) })
  }

  return out.sort((a, b) => a.start - b.start)
}

/** Gộp các câu liền nhau của cùng một người thành một khối hội thoại dễ đọc. */
export function mergeAdjacent(segments: AssignedSegment[], maxGap = 0.8, maxChars = 420): AssignedSegment[] {
  const out: AssignedSegment[] = []
  for (const seg of segments) {
    const prev = out[out.length - 1]
    if (
      prev &&
      prev.speakerKey === seg.speakerKey &&
      seg.start - prev.end <= maxGap &&
      prev.text.length + seg.text.length <= maxChars
    ) {
      prev.end = seg.end
      prev.text = `${prev.text} ${seg.text}`.replace(/\s+/g, ' ').trim()
      prev.confidence = Math.min(prev.confidence, seg.confidence)
    } else {
      out.push({ ...seg })
    }
  }
  return out
}

export interface BuildResult {
  speakers: SpeakerProfile[]
  segments: TranscriptSegment[]
  /** map từ nhãn diarization (SPEAKER_00) sang id nội bộ */
  keyToId: Record<string, string>
  matchedNames: string[]
}

/**
 * Tạo danh sách người nói cho cuộc họp.
 * - Nếu voiceprint khớp với người đã có trong danh bạ -> lấy lại tên cũ.
 * - Nếu chưa biết -> đặt user_(n).
 */
export function buildSpeakers(
  assigned: AssignedSegment[],
  embeddings: Record<string, number[]>,
  book: SpeakerProfile[],
  threshold: number
): BuildResult {
  const keys = Array.from(new Set(assigned.map((s) => s.speakerKey)))
  // Sắp xếp theo thời điểm xuất hiện đầu tiên để user_1 là người nói trước
  keys.sort((a, b) => {
    const fa = assigned.find((s) => s.speakerKey === a)?.start ?? 0
    const fb = assigned.find((s) => s.speakerKey === b)?.start ?? 0
    return fa - fb
  })

  const speakers: SpeakerProfile[] = []
  const keyToId: Record<string, string> = {}
  const matchedNames: string[] = []
  const usedBookIds = new Set<string>()
  let anonCounter = 0

  keys.forEach((key, index) => {
    const emb = embeddings[key]
    let matched: SpeakerProfile | undefined
    if (emb?.length) {
      let bestScore = 0
      for (const cand of book) {
        if (!cand.embedding?.length || usedBookIds.has(cand.id)) continue
        const score = cosine(emb, cand.embedding)
        if (score > bestScore) {
          bestScore = score
          matched = cand
        }
      }
      if (!matched || bestScore < threshold) matched = undefined
    }

    if (matched) {
      usedBookIds.add(matched.id)
      keyToId[key] = matched.id
      // Giọng đã gặp trước đây: nếu đã từng được đặt tên thì lấy lại tên,
      // nếu chưa thì vẫn giữ nguyên id (để nhận ra sau này) nhưng hiển thị user_(n).
      let displayName = matched.name
      if (!matched.named) {
        anonCounter += 1
        displayName = `user_${anonCounter}`
      }
      speakers.push({
        ...matched,
        name: displayName,
        color: matched.color || colorForIndex(index),
        embedding: emb ?? matched.embedding,
        seen: (matched.seen ?? 1) + 1
      })
      if (matched.named) matchedNames.push(matched.name)
    } else {
      anonCounter += 1
      const id = uid('spk_')
      keyToId[key] = id
      speakers.push({
        id,
        name: `user_${anonCounter}`,
        named: false,
        color: colorForIndex(index),
        embedding: emb,
        seen: 1,
        updatedAt: new Date().toISOString()
      })
    }
  })

  const segments: TranscriptSegment[] = assigned.map((s) => ({
    id: uid('seg_'),
    start: Number(s.start.toFixed(2)),
    end: Number(s.end.toFixed(2)),
    speakerId: keyToId[s.speakerKey],
    text: s.text,
    confidence: Number(s.confidence.toFixed(2))
  }))

  return { speakers, segments, keyToId, matchedNames }
}
