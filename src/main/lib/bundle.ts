import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { basename } from 'path'
import type {
  BundleInfo,
  BundleMeeting,
  ImportBundleResult,
  MeetingBundle,
  Project,
  SpeakerProfile
} from '../../shared/types'
import {
  findBySharedOrigin,
  getProject,
  loadSettings,
  loadSpeakerBook,
  saveProject,
  saveSpeakerBook,
  uid
} from './store'
import { cosine, mergeEmbeddings, normalize } from './voice'
import { colorForIndex } from './defaults'

/**
 * Chia sẻ cuộc họp giữa các máy bằng MỘT file JSON.
 *
 * Bài toán: bóc băng 1 tiếng video mất 1–2 tiếng CPU. Đồng nghiệp không có lý gì
 * phải chạy lại việc đó — gửi cho họ file này là xong trong 5 giây.
 *
 * Vì sao là JSON thuần, không nén không mã hoá:
 *  - Bản bóc băng 1 tiếng họp chỉ vài trăm KB, gửi qua Zalo/Teams thoải mái.
 *  - Đúng tinh thần "không database, chỉ file JSON trên máy bạn": 5 năm sau mở
 *    bằng Notepad vẫn đọc được, không phụ thuộc phiên bản app.
 *  - Không kèm video/audio. Video là hàng GB và người nhận thường đã có sẵn hoặc
 *    không cần; thiếu video thì bản bóc băng vẫn đọc, sửa, tóm tắt, xuất được.
 *
 * ĐỔI LẠI: nội dung nằm dạng chữ thường trong file. Ai mở file cũng đọc được
 * toàn bộ hội thoại. Giao diện phải nói rõ điều này trước khi người dùng bấm xuất.
 */

export const BUNDLE_FORMAT = 'meetsum-bundle'
export const BUNDLE_VERSION = 1
export const BUNDLE_EXT = 'meetsum'

// ---------------------------------------------------------------- Đóng gói

/**
 * Gom các cuộc họp thành một gói.
 * Ghi chú riêng CHỈ được kèm khi người dùng chủ động tick — nó là sổ tay cá nhân,
 * mặc định không nên đi ra khỏi máy.
 */
export function buildBundle(
  projectIds: string[],
  opts: { includeNotes?: boolean; exportedBy?: string } = {}
): MeetingBundle {
  const meetings: BundleMeeting[] = []
  const speakerIds = new Set<string>()

  for (const id of projectIds) {
    const p = getProject(id)
    if (!p) continue
    if (!p.segments?.length) {
      throw new Error(`"${p.name}" chưa có nội dung hội thoại nên không có gì để chia sẻ.`)
    }
    for (const sp of p.speakers ?? []) speakerIds.add(sp.id)
    meetings.push({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      durationSec: p.durationSec,
      // Chỉ tên file: đường dẫn tuyệt đối của máy mình vô nghĩa với người nhận,
      // mà còn để lộ cấu trúc thư mục cá nhân.
      videoName: p.videoPath ? basename(p.videoPath) : undefined,
      speakers: p.speakers ?? [],
      segments: p.segments,
      summary: p.summary,
      notes: opts.includeNotes && p.notes ? p.notes : undefined
    })
  }

  if (!meetings.length) throw new Error('Không có cuộc họp nào để chia sẻ.')

  // Kèm danh bạ giọng nói của đúng những người xuất hiện trong các cuộc họp này,
  // để máy người nhận cũng nhận ra họ ở những cuộc họp về sau.
  const book = loadSpeakerBook().speakers.filter((sp) => speakerIds.has(sp.id))

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: opts.exportedBy?.trim() || undefined,
    appVersion: app.getVersion(),
    includesVoiceprints: book.some((sp) => sp.embedding?.length),
    speakers: book,
    meetings
  }
}

export function writeBundle(bundle: MeetingBundle, outPath: string): string {
  writeFileSync(outPath, JSON.stringify(bundle, null, 2), 'utf-8')
  return outPath
}

/** Tên file gợi ý: đọc được, không có ký tự Windows cấm, có ngày để khỏi trùng. */
export function suggestBundleName(projectIds: string[]): string {
  const first = projectIds.length === 1 ? getProject(projectIds[0]) : null
  const stamp = new Date().toISOString().slice(0, 10)
  const base = first
    ? first.name
    : `${projectIds.length} cuoc hop`
  const safe = base.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
  return `${safe} - ${stamp}.${BUNDLE_EXT}`
}

// ---------------------------------------------------------------- Đọc & xem trước

/** Kiểm tra một file có phải gói MeetSum hợp lệ, và báo lỗi bằng tiếng người nếu không. */
export function parseBundle(path: string): MeetingBundle {
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch {
    throw new Error('Không đọc được file. Kiểm tra lại đường dẫn hoặc quyền truy cập.')
  }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error(
      'File này không phải gói MeetSum (không đọc được dạng JSON). ' +
        'Nếu tải từ Zalo/Teams, kiểm tra xem file có bị tải dở không.'
    )
  }

  const b = data as Partial<MeetingBundle>
  if (b?.format !== BUNDLE_FORMAT) {
    throw new Error('File này không phải gói chia sẻ của MeetSum.')
  }
  if (typeof b.version !== 'number' || b.version > BUNDLE_VERSION) {
    throw new Error(
      `Gói này được tạo bởi bản MeetSum mới hơn (định dạng v${String(b.version)}, ` +
        `app của bạn đọc được tới v${BUNDLE_VERSION}). Hãy cập nhật app rồi thử lại.`
    )
  }
  if (!Array.isArray(b.meetings) || !b.meetings.length) {
    throw new Error('Gói này không có cuộc họp nào.')
  }
  return {
    format: BUNDLE_FORMAT,
    version: b.version,
    exportedAt: b.exportedAt ?? '',
    exportedBy: b.exportedBy,
    appVersion: b.appVersion,
    includesVoiceprints: Boolean(b.includesVoiceprints),
    speakers: Array.isArray(b.speakers) ? b.speakers : [],
    meetings: b.meetings
  }
}

/** Mô tả gói để hiển thị xem trước — nhập cái gì vào máy mình thì phải thấy trước. */
export function describeBundle(path: string): BundleInfo {
  const b = parseBundle(path)
  return {
    path,
    exportedAt: b.exportedAt,
    exportedBy: b.exportedBy,
    includesVoiceprints: b.includesVoiceprints,
    speakerCount: b.speakers.length,
    meetings: b.meetings.map((m) => ({
      id: m.id,
      name: m.name,
      createdAt: m.createdAt,
      durationSec: m.durationSec,
      segmentCount: m.segments?.length ?? 0,
      speakerNames: (m.speakers ?? []).map((sp) => sp.name),
      hasSummary: Boolean(m.summary),
      hasNotes: Boolean(m.notes),
      existingProjectId: findBySharedOrigin(m.id)?.id
    }))
  }
}

// ---------------------------------------------------------------- Nhập

interface SpeakerMapResult {
  idMap: Record<string, string>
  added: number
  merged: number
  renamed: { from: string; to: string }[]
}

/**
 * Ghép danh bạ giọng nói của gói vào danh bạ trên máy này.
 *
 * Nguyên tắc:
 *  - Id giọng nói do mỗi máy tự sinh, nên KHÔNG bao giờ dùng lại id trong gói;
 *    luôn ánh xạ sang id của máy này (hoặc id mới).
 *  - Khớp theo giọng (cosine) trước, vì đó là thứ đáng tin. Không có vector giọng
 *    thì mới khớp theo tên.
 *  - Khớp rồi thì TÊN CỦA MÁY NÀY THẮNG: người nhận biết đồng nghiệp của mình
 *    hơn, và tên đó đang được dùng ở các cuộc họp khác của họ. Chỗ nào bị đổi
 *    tên thì báo lại để người dùng biết.
 *  - Mẫu giọng được trộn theo số lần gặp của cả hai bên, không ghi đè.
 */
function mergeSpeakerBook(bundle: MeetingBundle, threshold: number): SpeakerMapResult {
  const book = loadSpeakerBook()
  const idMap: Record<string, string> = {}
  const renamed: { from: string; to: string }[] = []
  let added = 0
  let merged = 0

  // Gom mọi profile có trong gói: ưu tiên bản trong danh bạ (có vector + số lần gặp),
  // bù thêm những người chỉ xuất hiện ở mức cuộc họp.
  const incoming = new Map<string, SpeakerProfile>()
  for (const m of bundle.meetings) for (const sp of m.speakers ?? []) incoming.set(sp.id, sp)
  for (const sp of bundle.speakers) incoming.set(sp.id, sp)

  // Một giọng trên máy này chỉ được nhận một giọng trong gói, tránh dồn 2 người vào 1
  const usedLocal = new Set<string>()

  // CHỈ đối chiếu với những giọng đã có TRƯỚC khi nhập.
  // Nếu để cả những giọng vừa thêm từ chính gói này làm ứng viên thì hai người
  // khác nhau trong cùng một gói có thể bị gộp vào nhau: người thứ hai được thêm
  // mới, rồi người thứ ba lại "khớp" với người thứ hai đó. Trong khi diarization
  // của người gửi đã tách họ ra rồi — trong một gói, người khác nhau là khác nhau.
  const preexisting = new Set(book.speakers.map((c) => c.id))

  // Người đã có tên được xét trước: họ nên chiếm chỗ khớp tốt nhất
  const order = [...incoming.values()].sort((a, b) => Number(b.named) - Number(a.named))

  for (const sp of order) {
    let match: SpeakerProfile | undefined
    let bestScore = 0

    if (sp.embedding?.length) {
      for (const cand of book.speakers) {
        if (!preexisting.has(cand.id) || usedLocal.has(cand.id) || !cand.embedding?.length) continue
        const score = cosine(sp.embedding, cand.embedding)
        if (score > bestScore) {
          bestScore = score
          match = cand
        }
      }
      if (bestScore < threshold) match = undefined
    }

    // Không có vector giọng thì đành khớp theo tên — chỉ với người đã được đặt tên,
    // vì "user_2" của hai máy khác nhau không liên quan gì đến nhau.
    if (!match && sp.named) {
      const key = sp.name.trim().toLowerCase()
      match =
        book.speakers.find(
          (c) =>
            preexisting.has(c.id) && c.named && !usedLocal.has(c.id) && c.name.trim().toLowerCase() === key
        ) ?? undefined
    }

    if (match) {
      usedLocal.add(match.id)
      idMap[sp.id] = match.id
      const idx = book.speakers.findIndex((c) => c.id === match!.id)
      const keepName = match.named ? match.name : sp.named ? sp.name : match.name
      if (sp.named && match.named && sp.name.trim() !== match.name.trim()) {
        renamed.push({ from: sp.name, to: match.name })
      }
      book.speakers[idx] = {
        ...match,
        name: keepName,
        named: match.named || sp.named,
        role: match.role || sp.role,
        embedding: mergeEmbeddings(match.embedding, match.seen ?? 1, sp.embedding, sp.seen ?? 1),
        seen: (match.seen ?? 1) + (sp.seen ?? 1),
        updatedAt: new Date().toISOString()
      }
      merged += 1
    } else {
      const newId = uid('spk_')
      idMap[sp.id] = newId
      book.speakers.push({
        ...sp,
        id: newId,
        color: sp.color || colorForIndex(book.speakers.length),
        embedding: sp.embedding?.length ? normalize(sp.embedding) : undefined,
        seen: sp.seen ?? 1,
        updatedAt: new Date().toISOString()
      })
      added += 1
    }
  }

  saveSpeakerBook(book)
  return { idMap, added, merged, renamed }
}

/**
 * Nhập các cuộc họp được chọn từ gói.
 * `select` là danh sách id cuộc họp TRONG GÓI; không truyền thì nhập tất cả.
 */
export function importBundle(
  path: string,
  opts: { select?: string[]; importVoiceprints?: boolean } = {}
): ImportBundleResult {
  const bundle = parseBundle(path)
  const chosen = opts.select?.length
    ? bundle.meetings.filter((m) => opts.select!.includes(m.id))
    : bundle.meetings
  if (!chosen.length) throw new Error('Chưa chọn cuộc họp nào để nhập.')

  const wantVoices = opts.importVoiceprints !== false
  const map = wantVoices
    ? mergeSpeakerBook({ ...bundle, meetings: chosen }, loadSettings().voiceMatchThreshold)
    : { idMap: {}, added: 0, merged: 0, renamed: [] as { from: string; to: string }[] }

  const imported: { projectId: string; name: string }[] = []
  const skipped: string[] = []
  // Đọc danh bạ MỘT lần sau khi đã ghép, thay vì đọc lại cho từng người nói
  const bookAfter = loadSpeakerBook().speakers

  for (const m of chosen) {
    // Không nhập vào giọng nào: sinh id cục bộ để cuộc họp vẫn phân biệt được người nói
    const localId = (sharedId: string): string => {
      if (!map.idMap[sharedId]) map.idMap[sharedId] = uid('spk_')
      return map.idMap[sharedId]
    }

    const speakers = (m.speakers ?? []).map((sp, i) => {
      const id = localId(sp.id)
      // Nếu giọng này khớp với người mình đã đặt tên, lấy tên của mình
      const known = bookAfter.find((c) => c.id === id)
      return {
        ...sp,
        id,
        name: known?.named ? known.name : sp.name,
        named: known?.named ?? sp.named,
        color: known?.color || sp.color || colorForIndex(i)
      }
    })

    const segments = (m.segments ?? []).map((sg) => ({
      ...sg,
      speakerId: localId(sg.speakerId)
    }))

    const now = new Date().toISOString()
    const project: Project = {
      id: uid('prj_'),
      name: m.name,
      // Người nhận không có video. Để rỗng và giao diện tự biết cách xử lý;
      // họ trỏ lại file video của mình sau nếu có.
      videoPath: '',
      durationSec: m.durationSec,
      createdAt: m.createdAt || now,
      updatedAt: now,
      status: 'ready',
      speakers,
      segments,
      summary: m.summary,
      notes: m.notes,
      sharedFrom: {
        projectId: m.id,
        exportedAt: bundle.exportedAt,
        exportedBy: bundle.exportedBy,
        videoName: m.videoName
      }
    }
    saveProject(project)
    imported.push({ projectId: project.id, name: project.name })
  }

  for (const m of bundle.meetings) {
    if (!chosen.some((c) => c.id === m.id)) skipped.push(m.name)
  }

  return {
    imported,
    skipped,
    speakersAdded: map.added,
    speakersMerged: map.merged,
    renamed: map.renamed
  }
}
