import { BrowserWindow, clipboard, dialog, ipcMain, shell, app } from 'electron'
import { basename, join } from 'path'
import { existsSync } from 'fs'
import type {
  BundleInfo,
  SkipRange,
  DoctorResult,
  ImportBundleResult,
  MeetingSummary,
  PdfOptionsShape,
  Project,
  Settings,
  SpeakerProfile,
  TranscriptSegment
} from './types'
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  loadSettings,
  loadSpeakerBook,
  patchProject,
  removeGlobalSpeaker,
  saveProject,
  saveSettings,
  mergeGlobalSpeakers,
  uid,
  upsertGlobalSpeaker
} from '../lib/store'
import { probeDuration, checkFfmpeg } from '../lib/ffmpeg'
import { activeCli, probeCli } from '../lib/cliAgent'
import { defaultCliProviders } from '../lib/defaults'
import { buildInitialPrompt, HF_GATED_HELP, probePython, runPythonPipeline } from '../lib/localEngine'
import { pingLlm } from '../lib/llm'
import {
  clearCheckpoint,
  clearQueue,
  dequeue,
  enqueue,
  isRunning,
  queuedIds,
  readCheckpoint,
  recoverInterrupted,
  requestPause,
  runTranscription
} from '../lib/pipeline'
import { suggestSpeakerNames, summarizeProject, transcriptToText } from '../lib/summarize'
import { exportPdf } from '../lib/pdf'
import { exportAs, type ExportFormat } from '../lib/exporters'
import { clearHistory, snapshot, undo, undoInfo } from '../lib/history'
import { mergeRedone } from '../lib/redo'
import { mediaUrl } from '../lib/mediaProtocol'
import { dataRoot, exportsDir } from '../lib/paths'
import {
  BUNDLE_EXT,
  buildBundle,
  describeBundle,
  importBundle,
  suggestBundleName,
  writeBundle
} from '../lib/bundle'
import {
  checkForUpdate,
  downloadUpdate,
  installUpdate,
  onUpdateState,
  openReleases,
  updateState
} from '../lib/updater'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

export function registerIpc(): void {
  // ---------- Settings ----------
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => saveSettings(patch))
  ipcMain.handle('settings:defaultCli', () => defaultCliProviders())

  // ---------- Cập nhật ----------
  onUpdateState((st) => broadcast('update:state', st))
  ipcMain.handle('update:state', () => updateState())
  ipcMain.handle('update:check', () => checkForUpdate())
  ipcMain.handle('update:download', () => downloadUpdate())
  ipcMain.handle('update:install', () => installUpdate())
  ipcMain.handle('update:openReleases', () => openReleases())

  // ---------- Chia sẻ / nhập gói ----------
  ipcMain.handle(
    'bundle:export',
    async (
      _e,
      projectIds: string[],
      opts: { includeNotes?: boolean; exportedBy?: string }
    ): Promise<{ path: string; meetings: number; speakers: number } | null> => {
      // Dựng gói TRƯỚC khi mở hộp thoại lưu: dự án chưa có hội thoại thì báo lỗi
      // ngay, đừng để người dùng chọn xong chỗ lưu mới biết là không có gì để gửi.
      const bundle = buildBundle(projectIds, opts)
      const res = await dialog.showSaveDialog({
        title: 'Chia sẻ cuộc họp',
        defaultPath: join(exportsDir(), suggestBundleName(projectIds)),
        filters: [
          { name: 'Gói MeetSum', extensions: [BUNDLE_EXT] },
          { name: 'Tất cả', extensions: ['*'] }
        ]
      })
      if (res.canceled || !res.filePath) return null
      writeBundle(bundle, res.filePath)
      return {
        path: res.filePath,
        meetings: bundle.meetings.length,
        speakers: bundle.speakers.length
      }
    }
  )

  /** Mở file rồi mô tả nội dung — nhập cái gì vào máy mình thì phải thấy trước. */
  ipcMain.handle('bundle:pick', async (): Promise<BundleInfo | null> => {
    const res = await dialog.showOpenDialog({
      title: 'Chọn gói MeetSum để nhập',
      properties: ['openFile'],
      filters: [
        { name: 'Gói MeetSum', extensions: [BUNDLE_EXT, 'json'] },
        { name: 'Tất cả', extensions: ['*'] }
      ]
    })
    if (res.canceled || !res.filePaths.length) return null
    return describeBundle(res.filePaths[0])
  })

  ipcMain.handle('bundle:describe', (_e, path: string): BundleInfo => describeBundle(path))

  ipcMain.handle(
    'bundle:import',
    (
      _e,
      path: string,
      opts: { select?: string[]; importVoiceprints?: boolean }
    ): ImportBundleResult => importBundle(path, opts)
  )

  // ---------- Dialogs / hệ thống ----------
  ipcMain.handle('dialog:pickVideo', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Chọn video cuộc họp',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video / Audio', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] },
        { name: 'Tất cả', extensions: ['*'] }
      ]
    })
    return res.canceled ? [] : res.filePaths
  })

  ipcMain.handle('dialog:pickFile', async (_e, opts: { title: string; extensions?: string[] }) => {
    const res = await dialog.showOpenDialog({
      title: opts.title,
      properties: ['openFile'],
      filters: opts.extensions?.length ? [{ name: 'File', extensions: opts.extensions }] : undefined
    })
    return res.canceled ? '' : res.filePaths[0]
  })

  ipcMain.handle('dialog:pickSavePdf', async (_e, defaultName: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Lưu báo cáo PDF',
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    return res.canceled ? '' : res.filePath
  })

  ipcMain.handle('system:openPath', (_e, p: string) => shell.openPath(p))
  ipcMain.handle('system:showInFolder', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('system:copyText', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('system:dataRoot', () => dataRoot())
  ipcMain.handle('system:exportsDir', () => exportsDir())
  ipcMain.handle('system:version', () => ({ app: app.getVersion(), electron: process.versions.electron, platform: process.platform }))
  ipcMain.handle('system:mediaUrl', (_e, p: string) => mediaUrl(p))

  // ---------- Projects ----------
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:get', (_e, id: string) => getProject(id))
  ipcMain.handle('projects:delete', (_e, id: string) => {
    deleteProject(id)
    return listProjects()
  })
  ipcMain.handle('projects:rename', (_e, id: string, name: string) => patchProject(id, { name }))
  ipcMain.handle('projects:saveNotes', (_e, id: string, notes: string) => patchProject(id, { notes }))

  /** Lưu các đoạn đánh dấu bỏ qua. Chỉ có tác dụng cho lần bóc băng SAU. */
  ipcMain.handle('projects:setSkipRanges', (_e, id: string, ranges: SkipRange[]) => {
    const clean = (ranges ?? [])
      .map((r) => ({
        id: r.id || uid('skip_'),
        start: Math.max(0, Math.min(r.start, r.end)),
        end: Math.max(r.start, r.end),
        note: r.note
      }))
      .filter((r) => r.end - r.start > 0.2)
      .sort((a, b) => a.start - b.start)
    return patchProject(id, { skipRanges: clean })
  })

  /**
   * Trỏ một cuộc họp tới file video trên máy này.
   * Cần cho cuộc họp nhập từ gói chia sẻ: người nhận không có video, nhưng nếu
   * họ tự có bản video đó thì gắn vào là xem/nghe lại được ngay.
   */
  ipcMain.handle('projects:relinkVideo', async (_e, projectId: string) => {
    const res = await dialog.showOpenDialog({
      title: 'Chọn file video của cuộc họp này',
      properties: ['openFile'],
      filters: [
        { name: 'Video / audio', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4a', 'mp3', 'wav'] },
        { name: 'Tất cả', extensions: ['*'] }
      ]
    })
    if (res.canceled || !res.filePaths.length) return null
    const file = res.filePaths[0]
    const current = getProject(projectId)
    // Giữ nguyên thời lượng đã có nếu không đọc được từ file mới
    const duration = (await probeDuration(file)) || current?.durationSec
    return patchProject(projectId, { videoPath: file, durationSec: duration })
  })

  ipcMain.handle('projects:import', async (_e, filePaths: string[]) => {
    const created: Project[] = []
    for (const file of filePaths) {
      if (!existsSync(file)) continue
      const name = basename(file).replace(/\.[^.]+$/, '')
      const p = createProject(name, file)
      const duration = await probeDuration(file)
      created.push(saveProject({ ...p, durationSec: duration }))
    }
    return created
  })

  /**
   * Bóc băng lại MỘT KHOẢNG rồi ghép vào biên bản đã có.
   *
   * Dùng khi có đoạn nghe rõ có tiếng mà AI không ra chữ. Cho phép ghi đè độ
   * nhạy VAD và model RIÊNG cho lần chạy này — chạy lại y hệt cấu hình cũ thì
   * đương nhiên ra y hệt kết quả cũ, nên đây mới là phần làm nó có ích.
   */
  ipcMain.handle(
    'pipeline:runRange',
    async (
      _e,
      projectId: string,
      start: number,
      end: number,
      override: { vadThreshold?: number; disableVad?: boolean; fwModelSize?: string }
    ) => {
      const project = getProject(projectId)
      if (!project) throw new Error('Không tìm thấy dự án.')
      if (!project.audioPath || !existsSync(project.audioPath)) {
        throw new Error('Chưa có audio đã tách. Hãy bóc băng cả video một lần trước đã.')
      }
      const a = Math.max(0, Math.min(start, end))
      const b = Math.max(start, end)
      if (b - a < 0.5) throw new Error('Khoảng chọn quá ngắn.')

      const settings: Settings = { ...loadSettings(), ...override }
      snapshot(projectId, `bóc lại đoạn ${Math.round(a)}s–${Math.round(b)}s`)

      broadcast('pipeline:progress', {
        projectId,
        stage: 'transcribing',
        percent: -1,
        message: `Đang bóc lại đoạn ${Math.floor(a / 60)}:${String(Math.floor(a % 60)).padStart(2, '0')}…`
      })

      // Bỏ qua MỌI thứ ngoài khoảng chọn -> model chỉ nghe đúng đoạn này
      const outside = [
        { start: 0, end: a },
        { start: b, end: Math.max(b + 1, project.durationSec ?? b + 1) }
      ].filter((r) => r.end - r.start > 0.05)

      const res = await runPythonPipeline(
        projectId,
        project.audioPath,
        settings,
        'asr',
        (_stage, pct, msg) =>
          broadcast('pipeline:progress', { projectId, stage: 'transcribing', percent: pct, message: msg }),
        undefined,
        buildInitialPrompt(settings, (project.speakers ?? []).map((sp) => sp.name)),
        outside,
        project.durationSec
      )

      const current = getProject(projectId) as Project
      const merged = mergeRedone(current.segments ?? [], res.segments ?? [], a, b, () => uid('seg_'))
      const saved = saveProject({ ...current, segments: merged.segments })

      broadcast('pipeline:progress', {
        projectId,
        stage: saved.status,
        percent: 100,
        message: merged.added
          ? `Đã bóc lại: ${merged.added} lượt nói mới${merged.replaced ? `, thay ${merged.replaced} lượt cũ` : ''}.`
          : 'Bóc lại nhưng vẫn không nghe ra chữ nào. Thử hạ độ nhạy xuống nữa hoặc tắt hẳn VAD.'
      })
      return { project: saved, added: merged.added, replaced: merged.replaced }
    }
  )

  // ---------- Pipeline ----------
  ipcMain.handle('pipeline:run', async (_e, projectId: string) => {
    const settings = loadSettings()
    return runTranscription(projectId, settings, (p) => broadcast('pipeline:progress', p))
  })
  ipcMain.handle('pipeline:isRunning', (_e, projectId: string) => isRunning(projectId))

  // ---------- Hàng đợi bóc băng (chạy tuần tự, một video một lúc) ----------
  const emitQueue = (q: string[]): void => broadcast('pipeline:queue', q)

  ipcMain.handle('pipeline:enqueue', (_e, projectIds: string[]) =>
    enqueue(projectIds, (p) => broadcast('pipeline:progress', p), emitQueue)
  )
  ipcMain.handle('pipeline:dequeue', (_e, projectId: string) => dequeue(projectId, emitQueue))
  ipcMain.handle('pipeline:clearQueue', () => {
    clearQueue(emitQueue)
    return queuedIds()
  })
  ipcMain.handle('pipeline:queue', () => queuedIds())

  /** Tạm dừng: đặt cờ để tiến trình Python dừng gọn gàng sau câu đang xử lý. */
  ipcMain.handle('pipeline:pause', (_e, projectId: string) => requestPause(projectId))

  /** Bỏ tiến độ đã lưu, lần sau chạy lại từ đầu. */
  ipcMain.handle('pipeline:reset', (_e, projectId: string) => {
    clearCheckpoint(projectId)
    return patchProject(projectId, { status: 'new', progressSec: undefined, segments: [], speakers: [] })
  })

  ipcMain.handle('pipeline:resumeInfo', (_e, projectId: string) => {
    const ckpt = readCheckpoint(projectId)
    return ckpt ? { doneSec: ckpt.asr_done_sec ?? 0, segments: ckpt.segments?.length ?? 0 } : null
  })

  // ---------- Speakers ----------
  ipcMain.handle('speakers:rename', (_e, projectId: string, speakerId: string, name: string, role: string, propagate: boolean) => {
    snapshot(projectId, 'đổi tên người nói')
    const project = getProject(projectId)
    if (!project) throw new Error('Không tìm thấy dự án.')
    const trimmed = name.trim()
    const speakers = project.speakers.map((s) =>
      s.id === speakerId ? { ...s, name: trimmed || s.name, role: role?.trim() || undefined, named: Boolean(trimmed) } : s
    )
    const updated = saveProject({ ...project, speakers })
    const target = speakers.find((s) => s.id === speakerId)
    if (target) upsertGlobalSpeaker(target)

    // Ghi nhớ sang các cuộc họp khác có cùng giọng (cùng speakerId)
    if (propagate && target) {
      for (const row of listProjects()) {
        if (row.id === projectId) continue
        const other = getProject(row.id)
        if (!other) continue
        if (!other.speakers.some((s) => s.id === speakerId)) continue
        saveProject({
          ...other,
          speakers: other.speakers.map((s) => (s.id === speakerId ? { ...s, name: target.name, role: target.role, named: target.named } : s))
        })
      }
    }
    return updated
  })

  ipcMain.handle('speakers:setColor', (_e, projectId: string, speakerId: string, color: string) => {
    const project = getProject(projectId)
    if (!project) throw new Error('Không tìm thấy dự án.')
    const speakers = project.speakers.map((s) => (s.id === speakerId ? { ...s, color } : s))
    const updated = saveProject({ ...project, speakers })
    const target = speakers.find((s) => s.id === speakerId)
    if (target) upsertGlobalSpeaker(target)
    return updated
  })

  ipcMain.handle('speakers:merge', (_e, projectId: string, fromId: string, intoId: string) => {
    const project = getProject(projectId)
    if (!project) throw new Error('Không tìm thấy dự án.')
    const segments = project.segments.map((s) => (s.speakerId === fromId ? { ...s, speakerId: intoId } : s))
    const speakers = project.speakers.filter((s) => s.id !== fromId)
    return saveProject({ ...project, segments, speakers })
  })

  ipcMain.handle('speakers:book', () => loadSpeakerBook().speakers)
  /** Gộp hai giọng trong danh bạ thành một người, học gộp cả hai mẫu giọng. */
  ipcMain.handle('speakers:bookMerge', (_e, keepId: string, dropId: string) => mergeGlobalSpeakers(keepId, dropId))

  ipcMain.handle('speakers:bookRemove', (_e, id: string) => {
    removeGlobalSpeaker(id)
    return loadSpeakerBook().speakers
  })
  ipcMain.handle('speakers:suggest', async (_e, projectId: string) => {
    const project = getProject(projectId)
    if (!project) throw new Error('Không tìm thấy dự án.')
    return suggestSpeakerNames(project, loadSettings())
  })

  // ---------- Segments ----------
  ipcMain.handle('segments:update', (_e, projectId: string, segmentId: string, patch: { text?: string; speakerId?: string }) => {
    snapshot(projectId, patch.text !== undefined ? 'sửa nội dung câu' : 'đổi người nói')
    const project = getProject(projectId)
    if (!project) throw new Error('Không tìm thấy dự án.')
    const segments = project.segments.map((s) =>
      s.id === segmentId ? { ...s, ...patch, edited: true } : s
    )
    return saveProject({ ...project, segments })
  })

  /**
   * Tách một lượt nói thành nhiều phần — dùng khi AI gộp nhầm 2-3 người vào một đoạn.
   * Mỗi phần có thời gian và người nói riêng. Các phần được sắp xếp và kẹp lại
   * trong khoảng thời gian của đoạn gốc để không đè lên đoạn bên cạnh.
   */
  ipcMain.handle(
    'segments:split',
    (
      _e,
      projectId: string,
      segmentId: string,
      parts: { start: number; end: number; text: string; speakerId: string }[]
    ) => {
      snapshot(projectId, 'tách lượt nói')
      const project = getProject(projectId)
      if (!project) throw new Error('Không tìm thấy dự án.')
      const idx = project.segments.findIndex((s) => s.id === segmentId)
      if (idx < 0) throw new Error('Không tìm thấy lượt nói cần tách.')

      const origin = project.segments[idx]
      const clean = parts
        .map((p) => ({
          start: Math.max(origin.start, Math.min(origin.end, Number(p.start))),
          end: Math.max(origin.start, Math.min(origin.end, Number(p.end))),
          text: String(p.text ?? '').trim(),
          speakerId: p.speakerId || origin.speakerId
        }))
        .filter((p) => p.text.length > 0)
        .sort((a, b) => a.start - b.start)

      if (clean.length < 2) throw new Error('Cần ít nhất 2 phần có nội dung để tách.')

      const made: TranscriptSegment[] = clean.map((p, i) => ({
        id: 'seg_' + Math.random().toString(16).slice(2, 12) + i,
        start: p.start,
        // Phần cuối lấy đúng mốc kết thúc gốc; các phần khác chạm tới đầu phần kế tiếp
        end: i === clean.length - 1 ? origin.end : Math.max(p.start + 0.2, clean[i + 1].start),
        speakerId: p.speakerId,
        text: p.text,
        edited: true
      }))

      const segments = [...project.segments.slice(0, idx), ...made, ...project.segments.slice(idx + 1)]
      return saveProject({ ...project, segments })
    }
  )

  /**
   * Thay tất cả trong bản bóc băng. Whisper nghe sai một tên riêng thì sai suốt
   * cả file, nên sửa từng câu bằng tay là không khả thi.
   */
  ipcMain.handle(
    'segments:replaceAll',
    (
      _e,
      projectId: string,
      find: string,
      replaceWith: string,
      opts: { caseSensitive?: boolean; wholeWord?: boolean } = {}
    ) => {
      snapshot(projectId, 'thay tất cả')
      const project = getProject(projectId)
      if (!project) throw new Error('Không tìm thấy dự án.')
      const needle = find
      if (!needle) throw new Error('Chưa nhập chữ cần tìm.')

      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = opts.wholeWord ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped
      const re = new RegExp(pattern, opts.caseSensitive ? 'gu' : 'giu')

      let replaced = 0
      const segments = project.segments.map((sg) => {
        const next = sg.text.replace(re, () => {
          replaced += 1
          return replaceWith
        })
        return next === sg.text ? sg : { ...sg, text: next, edited: true }
      })
      if (!replaced) return { project, replaced: 0 }
      return { project: saveProject({ ...project, segments }), replaced }
    }
  )

  ipcMain.handle('segments:delete', (_e, projectId: string, segmentId: string) => {
    snapshot(projectId, 'xoá lượt nói')
    const project = getProject(projectId)
    if (!project) throw new Error('Không tìm thấy dự án.')
    return saveProject({ ...project, segments: project.segments.filter((s) => s.id !== segmentId) })
  })

  /** Gộp một lượt nói vào lượt ngay trước nó. */
  ipcMain.handle('segments:mergeUp', (_e, projectId: string, segmentId: string) => {
    snapshot(projectId, 'gộp lượt nói')
    const project = getProject(projectId)
    if (!project) throw new Error('Không tìm thấy dự án.')
    const idx = project.segments.findIndex((s) => s.id === segmentId)
    if (idx <= 0) throw new Error('Không có lượt nói phía trên để gộp.')
    const prev = project.segments[idx - 1]
    const cur = project.segments[idx]
    const merged: TranscriptSegment = {
      ...prev,
      end: Math.max(prev.end, cur.end),
      text: `${prev.text} ${cur.text}`.replace(/\s+/g, ' ').trim(),
      edited: true
    }
    const segments = [...project.segments.slice(0, idx - 1), merged, ...project.segments.slice(idx + 1)]
    return saveProject({ ...project, segments })
  })

  ipcMain.handle('segments:reassignRange', (_e, projectId: string, segmentIds: string[], speakerId: string) => {
    const project = getProject(projectId)
    if (!project) throw new Error('Không tìm thấy dự án.')
    const ids = new Set(segmentIds)
    const segments = project.segments.map((s) => (ids.has(s.id) ? { ...s, speakerId, edited: true } : s))
    return saveProject({ ...project, segments })
  })

  ipcMain.handle('segments:addSpeaker', (_e, projectId: string) => {
    const project = getProject(projectId)
    if (!project) throw new Error('Không tìm thấy dự án.')
    const anon = project.speakers.filter((s) => /^user_\d+$/.test(s.name)).length
    const colors = ['#4da3ff', '#f2994a', '#27c19a', '#bb6bd9', '#eb5757', '#f2c94c', '#56ccf2', '#9b9bff']
    const sp: SpeakerProfile = {
      id: 'spk_' + Math.random().toString(16).slice(2, 12),
      name: `user_${anon + 1}`,
      named: false,
      color: colors[project.speakers.length % colors.length],
      seen: 1,
      updatedAt: new Date().toISOString()
    }
    return saveProject({ ...project, speakers: [...project.speakers, sp] })
  })

  // ---------- Summary ----------
  ipcMain.handle('summary:run', async (_e, projectId: string) => {
    const project = getProject(projectId)
    if (!project) throw new Error('Không tìm thấy dự án.')
    const settings = loadSettings()
    patchProject(projectId, { status: 'summarizing' })
    broadcast('pipeline:progress', { projectId, stage: 'summarizing', percent: -1, message: 'AI đang nghiên cứu và tóm tắt' })
    try {
      const summary = await summarizeProject(project, settings, (message) =>
        broadcast('pipeline:progress', { projectId, stage: 'summarizing', percent: -1, message })
      )
      const saved = saveProject({ ...(getProject(projectId) as Project), summary, status: 'done' })
      broadcast('pipeline:progress', { projectId, stage: 'done', percent: 100, message: 'Đã tóm tắt xong' })
      return saved
    } catch (err) {
      patchProject(projectId, { status: 'ready' })
      broadcast('pipeline:progress', { projectId, stage: 'ready', percent: 0, message: (err as Error).message })
      throw err
    }
  })

  /** Lưu bản tóm tắt sau khi người dùng sửa tay. */
  ipcMain.handle('summary:update', (_e, projectId: string, summary: MeetingSummary) => {
    snapshot(projectId, 'sửa bản tóm tắt')
    const project = getProject(projectId)
    if (!project) throw new Error('Không tìm thấy dự án.')
    return saveProject({ ...project, summary: { ...summary, editedAt: new Date().toISOString() } })
  })

  ipcMain.handle('summary:transcriptText', (_e, projectId: string, withTime: boolean) => {
    const project = getProject(projectId)
    if (!project) return ''
    return transcriptToText(project, withTime)
  })

  // ---------- Export ----------
  ipcMain.handle('export:pdf', async (_e, projectId: string, opts: PdfOptionsShape, targetPath?: string) => {
    const project = getProject(projectId)
    if (!project) throw new Error('Không tìm thấy dự án.')
    return exportPdf(project, opts, targetPath)
  })

  ipcMain.handle('export:json', (_e, projectId: string) => {
    const project = getProject(projectId)
    if (!project) throw new Error('Không tìm thấy dự án.')
    return JSON.stringify(project, null, 2)
  })

  // ---------- Doctor: kiểm tra môi trường ----------
  /**
   * Tìm xuyên tất cả cuộc họp. Sidebar chỉ lọc theo TÊN file, nên trước đây
   * không có cách nào trả lời "ai nói gì về KYC ba tháng nay".
   */
  ipcMain.handle('search:all', (_e, query: string, limit = 200) => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const hits: {
      projectId: string
      projectName: string
      createdAt: string
      segmentId: string
      start: number
      speaker: string
      snippet: string
      inSummary: boolean
    }[] = []

    for (const row of listProjects()) {
      const p = getProject(row.id)
      if (!p) continue
      const names = new Map(p.speakers.map((sp) => [sp.id, sp.name]))

      for (const sg of p.segments) {
        if (!sg.text.toLowerCase().includes(q)) continue
        const at = sg.text.toLowerCase().indexOf(q)
        hits.push({
          projectId: p.id,
          projectName: p.name,
          createdAt: p.createdAt,
          segmentId: sg.id,
          start: sg.start,
          speaker: names.get(sg.speakerId) ?? 'unknown',
          snippet: sg.text.slice(Math.max(0, at - 45), at + q.length + 75),
          inSummary: false
        })
        if (hits.length >= limit) return hits
      }

      // Tìm cả trong bản tóm tắt: quyết định và việc cần làm thường là chỗ người ta cần lại
      const sum = p.summary
      if (sum) {
        const pool = [
          sum.title,
          sum.oneLiner,
          ...sum.decisions,
          ...sum.openQuestions,
          ...sum.actionItems.map((a) => `${a.owner}: ${a.task}`),
          ...sum.sections.flatMap((sec) => [sec.title, sec.body ?? '', ...(sec.bullets ?? [])])
        ]
        for (const text of pool) {
          if (!text || !text.toLowerCase().includes(q)) continue
          const at = text.toLowerCase().indexOf(q)
          hits.push({
            projectId: p.id,
            projectName: p.name,
            createdAt: p.createdAt,
            segmentId: '',
            start: 0,
            speaker: 'Tóm tắt',
            snippet: text.slice(Math.max(0, at - 45), at + q.length + 75),
            inSummary: true
          })
          if (hits.length >= limit) return hits
        }
      }
    }
    return hits
  })

  // ---------- Hoàn tác ----------
  ipcMain.handle('history:info', (_e, projectId: string) => undoInfo(projectId))
  ipcMain.handle('history:undo', (_e, projectId: string) => undo(projectId))
  ipcMain.handle('history:clear', (_e, projectId: string) => {
    clearHistory(projectId)
    return undoInfo(projectId)
  })

  // ---------- Xuất file (ngoài PDF) ----------
  ipcMain.handle(
    'export:file',
    async (
      _e,
      projectId: string,
      format: ExportFormat,
      opts: { includeTranscript: boolean; includeTimestamps: boolean }
    ) => {
      const project = getProject(projectId)
      if (!project) throw new Error('Không tìm thấy dự án.')
      const safe = project.name.replace(/[\\/:*?"<>|]/g, '_')
      const res = await dialog.showSaveDialog({
        title: `Xuất ${format.toUpperCase()}`,
        defaultPath: join(exportsDir(), `${safe}.${format}`),
        filters: [{ name: format.toUpperCase(), extensions: [format] }]
      })
      if (res.canceled || !res.filePath) return ''
      return exportAs(project, format, res.filePath, opts)
    }
  )

  ipcMain.handle('doctor:run', async (): Promise<DoctorResult> => {
    const settings = loadSettings()
    const ffmpeg = await checkFfmpeg()

    const whisperBin = settings.whisperBinPath
      ? { ok: existsSync(settings.whisperBinPath), detail: settings.whisperBinPath }
      : { ok: false, detail: 'Chưa cấu hình (chỉ cần nếu dùng backend whisper.cpp)' }
    const whisperModel = settings.whisperModelPath
      ? { ok: existsSync(settings.whisperModelPath), detail: settings.whisperModelPath }
      : { ok: false, detail: 'Chưa cấu hình (chỉ cần nếu dùng backend whisper.cpp)' }

    const py = await probePython(settings)
    const info = py.info
    const useVibe = settings.localAsr === 'vibevoice'
    const python = py.bin
      ? {
          ok: useVibe ? Boolean(info?.vibevoice) : Boolean(info?.faster_whisper),
          detail:
            `${[py.bin, ...py.prefix].join(' ')} · Python ${info?.python ?? '?'}` +
            `${info?.cuda ? ' · CUDA' : ` · CPU ${info?.cpu_count ?? '?'} nhân`}` +
            (info?.cuda
              ? ''
              : ` · dùng ${
                  settings.asrThreads > 0 ? `${settings.asrThreads} luồng` : 'hết số nhân'
                }${settings.asrBatchSize > 1 ? `, lô ${settings.asrBatchSize}` : ', không chia lô'}`) +
            (useVibe
              ? info?.vibevoice
                ? ` · VibeVoice-ASR OK (${settings.vibevoiceModel})`
                : `\n${
                    info?.transformers
                      ? 'Có transformers nhưng chưa đủ mới — VibeVoice-ASR cần bản 5.14 trở lên.'
                      : 'Thiếu transformers.'
                  } Chạy: "${py.bin}" -m pip install -U "transformers>=5.14" torch torchaudio`
              : info?.faster_whisper
                ? ' · faster-whisper OK'
                : `\nThiếu faster-whisper. Chạy: "${py.bin}" -m pip install faster-whisper`)
        }
      : { ok: false, detail: py.detail }
    // VibeVoice tự tách người nói, pyannote chỉ còn cần cho voiceprint
    const diarization = useVibe
      ? info?.vibevoice
        ? info?.pyannote
          ? {
              ok: true,
              detail:
                'VibeVoice-ASR tự tách người nói trong cùng một lượt — không cần pyannote cho việc này, ' +
                'cũng không cần token HuggingFace.\npyannote.audio đã cài nên vẫn lấy được voiceprint để nhớ giọng qua các cuộc họp.'
            }
          : {
              ok: false,
              detail:
                'VibeVoice-ASR tách được người nói trong CHÍNH cuộc họp này mà không cần pyannote hay token HuggingFace.\n\n' +
                'Nhưng chưa cài pyannote.audio nên KHÔNG lấy được voiceprint — app sẽ không nhận ra người quen ở các cuộc họp sau, ' +
                'và cuộc họp dài trên 50 phút cũng khó ghép đúng người giữa các đoạn.\n\n' +
                (py.bin ? `Chạy: "${py.bin}" -m pip install "pyannote.audio>=3.1"` : 'Cần có Python trước (xem dòng trên)')
            }
        : { ok: false, detail: 'Cần cài VibeVoice-ASR trước (xem dòng trên)' }
      : info?.pyannote
      ? settings.hfToken
        ? { ok: true, detail: 'pyannote.audio đã cài + đã có token HuggingFace' }
        : {
            ok: false,
            detail:
              'pyannote.audio đã cài nhưng CHƯA có token HuggingFace — model tách người nói bị giới hạn truy cập nên sẽ lỗi 401 khi chạy.\n\n' +
              HF_GATED_HELP
          }
      : {
          ok: false,
          detail: py.bin
            ? `Chưa cài pyannote.audio. Chạy: "${py.bin}" -m pip install "pyannote.audio>=3.1" torch torchaudio`
            : 'Cần có Python trước (xem dòng trên)'
        }

    const cliCfg = activeCli(settings)
    const cliAgent = cliCfg
      ? await (async () => {
          const probe = await probeCli(cliCfg.bin)
          return probe.bin
            ? { ok: true, detail: `${cliCfg.label}: ${probe.detail} — dùng phiên đăng nhập của CLI, không cần API key` }
            : { ok: false, detail: probe.detail }
        })()
      : { ok: true, detail: 'Đang dùng provider API, không cần CLI agent.' }

    const llm = await pingLlm(settings)
    return { ffmpeg, whisperBin, whisperModel, python, diarization, cliAgent, llm }
  })
}
