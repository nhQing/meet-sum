import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { PipelineProgress, Project, ProjectStatus, Settings } from '../../shared/types'
import { extractAudio, probeDuration, sliceAudio } from './ffmpeg'
import { runPythonPipeline, runWhisperCpp, type DiarTurn, type RawSegment } from './localEngine'
import { transcribeWithGemini, transcribeWithOpenAI } from './apiEngine'
import { assignSpeakers, buildSpeakers, mergeAdjacent } from './merge'
import { attributeSpeakersByLlm } from './summarize'
import { workDir } from './paths'
import { getProject, loadSpeakerBook, patchProject, saveProject, upsertGlobalSpeaker } from './store'

export type ProgressSink = (p: PipelineProgress) => void

const running = new Set<string>()

export function isRunning(projectId: string): boolean {
  return running.has(projectId)
}

function checkpointPath(projectId: string): string {
  return join(workDir(projectId), 'checkpoint.json')
}

function stopFilePath(projectId: string): string {
  return join(workDir(projectId), 'stop.flag')
}

interface Checkpoint {
  segments?: RawSegment[]
  turns?: DiarTurn[]
  embeddings?: Record<string, number[]>
  asr_done_sec?: number
  diar_done?: boolean
}

export function readCheckpoint(projectId: string): Checkpoint | null {
  const f = checkpointPath(projectId)
  if (!existsSync(f)) return null
  try {
    return JSON.parse(readFileSync(f, 'utf-8')) as Checkpoint
  } catch {
    return null
  }
}

export function clearCheckpoint(projectId: string): void {
  for (const f of [checkpointPath(projectId), stopFilePath(projectId)]) {
    if (existsSync(f)) rmSync(f, { force: true })
  }
}

/**
 * Yêu cầu dừng: tạo file cờ. Tiến trình Python kiểm tra file này sau mỗi câu
 * rồi thoát gọn gàng, giữ nguyên tiến độ đã lưu trong checkpoint.
 */
export function requestPause(projectId: string): boolean {
  if (!running.has(projectId)) return false
  writeFileSync(stopFilePath(projectId), String(Date.now()), 'utf-8')
  return true
}

export function isPauseRequested(projectId: string): boolean {
  return existsSync(stopFilePath(projectId))
}

/** Chuyển các câu đã có nhãn người nói (từ API) thành danh sách lượt nói. */
function segmentsToTurns(segments: { start: number; end: number; speaker?: string }[]): DiarTurn[] {
  return segments
    .filter((s) => s.speaker)
    .map((s) => ({ start: s.start, end: s.end, speaker: String(s.speaker) }))
}

export async function runTranscription(
  projectId: string,
  settings: Settings,
  emit: ProgressSink
): Promise<Project> {
  if (running.has(projectId)) throw new Error('Dự án này đang được xử lý.')
  running.add(projectId)

  // Bấm Tiếp tục thì cờ dừng cũ phải được dọn, nếu không sẽ dừng lại ngay lập tức
  const stopFile = stopFilePath(projectId)
  if (existsSync(stopFile)) rmSync(stopFile, { force: true })

  const report = (stage: ProjectStatus, percent: number, message: string): void => {
    emit({ projectId, stage, percent, message })
  }

  try {
    let project = getProject(projectId)
    if (!project) throw new Error('Không tìm thấy dự án.')

    const ckpt = readCheckpoint(projectId)
    const resumingFrom = ckpt?.asr_done_sec ?? 0

    // 1. Tách audio — bỏ qua nếu lần chạy trước đã tách rồi
    project = saveProject({ ...project, status: 'extracting', error: undefined, engineUsed: settings.engine })
    const duration = project.durationSec || (await probeDuration(project.videoPath))
    project = saveProject({ ...project, durationSec: duration })

    let audioPath = project.audioPath ?? ''
    if (audioPath && existsSync(audioPath)) {
      report('extracting', 100, 'Dùng lại âm thanh đã tách từ lần trước')
    } else {
      report('extracting', 0, 'Đang đọc thông tin video')
      audioPath = await extractAudio(projectId, project.videoPath, duration, (pct) =>
        report('extracting', pct, 'Đang tách âm thanh khỏi video')
      )
      project = saveProject({ ...project, audioPath })
      report('extracting', 100, 'Đã tách âm thanh')
    }

    if (isPauseRequested(projectId)) return finishPaused(projectId, report, resumingFrom, duration)

    // 2. ASR + diarization
    let segments: RawSegment[] = []
    let turns: DiarTurn[] = []
    let embeddings: Record<string, number[]> = {}
    let warning: string | undefined
    let paused = false

    if (settings.engine === 'local') {
      if (settings.localAsr === 'python') {
        const mode = settings.enableDiarization ? 'full' : 'asr'

        // Chạy tiếp: cắt bỏ phần audio đã bóc băng xong để khỏi làm lại
        let asrAudio = audioPath
        let offset = 0
        if (resumingFrom > 1 && resumingFrom < duration - 1) {
          report('transcribing', 0, `Chuẩn bị chạy tiếp từ phút ${Math.floor(resumingFrom / 60)}`)
          asrAudio = await sliceAudio(projectId, audioPath, resumingFrom, duration - resumingFrom, 900)
          offset = resumingFrom
        }

        report(settings.enableDiarization ? 'diarizing' : 'transcribing', 0, 'Đang khởi động pipeline local')
        const res = await runPythonPipeline(
          projectId,
          asrAudio,
          settings,
          mode,
          (stage, pct, msg) => {
            const st: ProjectStatus = stage === 'diarizing' ? 'diarizing' : 'transcribing'
            patchProject(projectId, { status: st })
            report(st, pct, msg || 'Đang xử lý')
          },
          {
            checkpointPath: checkpointPath(projectId),
            stopFilePath: stopFile,
            audioOffsetSec: offset,
            fullDurationSec: duration
          }
        )
        segments = res.segments
        turns = res.turns
        embeddings = res.embeddings
        warning = res.warning
        paused = res.status === 'paused'
      } else {
        if (settings.enableDiarization) {
          project = saveProject({ ...project, status: 'diarizing' })
          const dz = await runPythonPipeline(projectId, audioPath, settings, 'diarize', (_s, pct, msg) =>
            report('diarizing', pct, msg || 'Đang tách người nói')
          )
          turns = dz.turns
          embeddings = dz.embeddings
          warning = dz.warning
        }
        project = saveProject({ ...project, status: 'transcribing' })
        segments = await runWhisperCpp(projectId, audioPath, settings, (pct, msg) =>
          report('transcribing', pct, msg)
        )
      }
    } else {
      project = saveProject({ ...project, status: 'transcribing' })
      if (settings.asrProvider === 'gemini') {
        const apiSegs = await transcribeWithGemini(projectId, audioPath, settings, (pct, msg) =>
          report('transcribing', pct, msg)
        )
        segments = apiSegs.map((s) => ({ start: s.start, end: s.end, text: s.text }))
        turns = segmentsToTurns(apiSegs)
      } else {
        const apiSegs = await transcribeWithOpenAI(projectId, audioPath, duration, settings, (pct, msg) =>
          report('transcribing', pct, msg)
        )
        segments = apiSegs.map((s) => ({ start: s.start, end: s.end, text: s.text }))
        report('diarizing', 92, 'Đang suy luận người nói bằng AI')
        try {
          const labels = await attributeSpeakersByLlm(segments, settings)
          turns = segments.map((s, i) => ({ start: s.start, end: s.end, speaker: labels[i] }))
        } catch {
          turns = []
        }
      }
    }

    if (!segments.length) {
      if (paused) return finishPaused(projectId, report, resumingFrom, duration)
      throw new Error('Không nhận được nội dung hội thoại nào từ video.')
    }

    // 3. Gán người nói + đối chiếu danh bạ giọng nói
    report(paused ? 'paused' : 'transcribing', 99, 'Đang gán người nói')
    const assigned = mergeAdjacent(assignSpeakers(segments, turns))
    const book = loadSpeakerBook().speakers
    const built = buildSpeakers(assigned, embeddings, book, settings.voiceMatchThreshold)

    // 4. Ghi nhớ voiceprint vào danh bạ JSON — chỉ khi đã chạy xong hẳn
    if (!paused) {
      for (const sp of built.speakers) {
        upsertGlobalSpeaker(sp)
      }
    }

    const doneSec = segments.length ? segments[segments.length - 1].end : resumingFrom
    const final = saveProject({
      ...(getProject(projectId) as Project),
      speakers: built.speakers,
      segments: built.segments,
      status: paused ? 'paused' : 'ready',
      error: undefined,
      warning,
      progressSec: paused ? doneSec : undefined
    })

    if (paused) {
      report(
        'paused',
        Math.min(99, Math.round((doneSec / (duration || 1)) * 100)),
        `Đã tạm dừng ở phút ${Math.floor(doneSec / 60)} — giữ được ${built.segments.length} câu. Bấm Tiếp tục bất cứ lúc nào.`
      )
      return final
    }

    clearCheckpoint(projectId)
    const msg = warning
      ? 'Xong phần bóc băng, nhưng chưa tách được người nói — xem cảnh báo phía trên.'
      : built.matchedNames.length
        ? `Xong. Nhận ra giọng đã biết: ${built.matchedNames.join(', ')}`
        : 'Xong. Hãy click vào user_(n) để đặt tên.'
    report('ready', 100, msg)
    return final
  } catch (err) {
    const message = (err as Error).message || String(err)
    patchProject(projectId, { status: 'error', error: message })
    report('error', 0, message)
    throw err
  } finally {
    running.delete(projectId)
    if (existsSync(stopFile)) rmSync(stopFile, { force: true })
  }
}

/** Dừng khi chưa có câu nào mới — vẫn giữ nguyên tiến độ cũ. */
function finishPaused(
  projectId: string,
  report: (stage: ProjectStatus, percent: number, message: string) => void,
  doneSec: number,
  duration: number
): Project {
  const p = patchProject(projectId, { status: 'paused', progressSec: doneSec }) as Project
  report(
    'paused',
    Math.min(99, Math.round((doneSec / (duration || 1)) * 100)),
    'Đã tạm dừng. Bấm Tiếp tục để chạy tiếp từ chỗ dở.'
  )
  return p
}

/**
 * Gọi lúc khởi động app: dự án nào còn kẹt ở trạng thái "đang chạy" nghĩa là
 * lần trước app bị tắt đột ngột (hoặc mất điện) — chuyển sang tạm dừng để chạy tiếp được.
 */
export function recoverInterrupted(projectIds: string[]): string[] {
  const stuck: ProjectStatus[] = ['extracting', 'diarizing', 'transcribing', 'summarizing']
  const recovered: string[] = []
  for (const id of projectIds) {
    const p = getProject(id)
    if (!p || !stuck.includes(p.status)) continue
    const ckpt = readCheckpoint(id)
    const doneSec = ckpt?.asr_done_sec ?? p.progressSec ?? 0
    patchProject(id, {
      status: doneSec > 0 || p.segments.length > 0 ? 'paused' : 'new',
      progressSec: doneSec
    })
    recovered.push(id)
  }
  return recovered
}
