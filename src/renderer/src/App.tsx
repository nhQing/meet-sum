import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Brain, Copy, FileDown, FolderOpen, Mic, PauseCircle, PlayCircle, RefreshCw, Settings as SettingsIcon, Sparkles, StickyNote } from 'lucide-react'
import type {
  PipelineProgress,
  Project,
  ProjectSummaryRow,
  Settings,
  SpeakerProfile,
  TranscriptSegment
} from '../../shared/types'
import type { NameSuggestion } from '../../preload'
import Sidebar from './components/Sidebar'
import VideoPlayer from './components/VideoPlayer'
import SpeakerPanel from './components/SpeakerPanel'
import SpeakerDialog from './components/SpeakerDialog'
import TranscriptView from './components/TranscriptView'
import SummaryPanel from './components/SummaryPanel'
import SummaryEditor from './components/SummaryEditor'
import SplitDialog from './components/SplitDialog'
import SettingsDialog from './components/SettingsDialog'
import ExportDialog from './components/ExportDialog'
import NoBridgeNotice from './components/NoBridgeNotice'
import { Modal, Spinner, Toast } from './components/Ui'
import { hasBridge } from './lib/bridge'
import { STATUS_LABEL, STATUS_TONE, formatDuration, formatTime } from './lib/format'

type MainTab = 'transcript' | 'summary' | 'notes'

export default function App(): JSX.Element {
  if (!hasBridge) return <NoBridgeNotice />
  return <MeetSumApp />
}

function MeetSumApp(): JSX.Element {
  const [rows, setRows] = useState<ProjectSummaryRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [videoSrc, setVideoSrc] = useState('')
  const [currentTime, setCurrentTime] = useState(0)
  const [tab, setTab] = useState<MainTab>('transcript')

  const [progress, setProgress] = useState<PipelineProgress | null>(null)
  // Mốc thời gian để hiện đồng hồ và phát hiện tiến trình đứng im
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [lastTickAt, setLastTickAt] = useState<number>(Date.now())
  const [now, setNow] = useState<number>(Date.now())
  const [busyRun, setBusyRun] = useState(false)
  const [splitting, setSplitting] = useState<TranscriptSegment | null>(null)
  const [editingSummary, setEditingSummary] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [busySummary, setBusySummary] = useState(false)
  const [busySuggest, setBusySuggest] = useState(false)
  const [importing, setImporting] = useState(false)

  const [editingSpeaker, setEditingSpeaker] = useState<SpeakerProfile | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [suggestions, setSuggestions] = useState<NameSuggestion[] | null>(null)
  const [notes, setNotes] = useState('')
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'err' | 'info' } | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)

  const notify = useCallback((message: string, tone: 'ok' | 'err' | 'info' = 'info') => {
    setToast({ message, tone })
    setTimeout(() => setToast(null), tone === 'err' ? 25000 : 4000)
  }, [])

  const refreshRows = useCallback(async () => {
    setRows(await window.api.projects.list())
  }, [])

  useEffect(() => {
    void (async () => {
      setSettings(await window.api.settings.get())
      const list = await window.api.projects.list()
      setRows(list)
      if (list.length) setActiveId(list[0].id)
    })()
  }, [])

  useEffect(() => {
    return window.api.pipeline.onProgress((p) => {
      setProgress(p)
      const t = Date.now()
      setLastTickAt(t)
      setNow(t)
      setRunStartedAt((prev) => (prev === null || p.stage === 'extracting' ? t : prev))
      if (p.stage === 'ready' || p.stage === 'done' || p.stage === 'error') {
        setRunStartedAt(null)
        void refreshRows()
        if (p.projectId === activeId) void window.api.projects.get(p.projectId).then((x) => x && setProject(x))
      }
    })
  }, [activeId, refreshRows])

  useEffect(() => {
    if (!activeId) {
      setProject(null)
      setVideoSrc('')
      return
    }
    void (async () => {
      const p = await window.api.projects.get(activeId)
      setProject(p)
      setNotes(p?.notes ?? '')
      setCurrentTime(0)
      if (p) setVideoSrc(await window.api.system.mediaUrl(p.videoPath))
      setTab(p?.summary ? 'summary' : 'transcript')
    })()
  }, [activeId])

  const reload = useCallback(async () => {
    if (!activeId) return
    const p = await window.api.projects.get(activeId)
    setProject(p)
    await refreshRows()
  }, [activeId, refreshRows])

  const handleImport = async (): Promise<void> => {
    setImporting(true)
    try {
      const files = await window.api.dialog.pickVideo()
      if (!files.length) return
      const created = await window.api.projects.import(files)
      await refreshRows()
      if (created.length) {
        setActiveId(created[0].id)
        notify(`Đã nhập ${created.length} video. Bấm “Bóc băng” để bắt đầu.`, 'ok')
      }
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setImporting(false)
    }
  }

  const handleRun = async (): Promise<void> => {
    if (!project) return
    setBusyRun(true)
    try {
      const updated = await window.api.pipeline.run(project.id)
      setProject(updated)
      await refreshRows()
      setTab('transcript')
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBusyRun(false)
    }
  }
  const handlePause = async (): Promise<void> => {
    if (!project) return
    setPausing(true)
    try {
      const ok = await window.api.pipeline.pause(project.id)
      notify(
        ok
          ? 'Đang dừng lại — chờ xử lý nốt câu hiện tại rồi lưu tiến độ.'
          : 'Tiến trình đã kết thúc trước đó.',
        'info'
      )
    } finally {
      setPausing(false)
    }
  }

  const handleResetRun = async (): Promise<void> => {
    if (!project) return
    const p = await window.api.pipeline.reset(project.id)
    if (p) setProject(p)
    await refreshRows()
    notify('Đã xoá tiến độ cũ. Lần chạy sau sẽ bắt đầu lại từ đầu.', 'info')
  }


  const handleSummarize = async (): Promise<void> => {
    if (!project) return
    setBusySummary(true)
    try {
      const updated = await window.api.summary.run(project.id)
      setProject(updated)
      await refreshRows()
      setTab('summary')
      notify('Đã tạo tóm tắt.', 'ok')
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBusySummary(false)
    }
  }

  const handleSuggest = async (): Promise<void> => {
    if (!project) return
    setBusySuggest(true)
    try {
      const res = await window.api.speakers.suggest(project.id)
      if (!res.length) notify('AI không tìm thấy bằng chứng rõ ràng về tên người nói trong hội thoại.', 'info')
      else setSuggestions(res)
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBusySuggest(false)
    }
  }

  const applySuggestion = async (s: NameSuggestion): Promise<void> => {
    if (!project) return
    const updated = await window.api.speakers.rename(project.id, s.speakerId, s.suggestedName, '', true)
    setProject(updated)
    setSuggestions((prev) => (prev ? prev.filter((x) => x.speakerId !== s.speakerId) : prev))
  }

  const seek = (t: number): void => {
    const v = videoRef.current
    if (v) {
      v.currentTime = t
      void v.play()
    }
  }

  /** Phát đúng một khoảng rồi tự dừng — dùng khi soát lại đoạn định tách. */
  const playRange = (from: number, to: number): void => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = from
    void v.play()
    const stop = (): void => {
      if (v.currentTime >= to) {
        v.pause()
        v.removeEventListener('timeupdate', stop)
      }
    }
    v.addEventListener('timeupdate', stop)
  }

  const isRunning = Boolean(
    progress &&
      project &&
      progress.projectId === project.id &&
      !['ready', 'done', 'error', 'paused'].includes(progress.stage)
  )

  useEffect(() => {
    if (!isRunning) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [isRunning])

  const elapsed = runStartedAt ? Math.max(0, Math.floor((now - runStartedAt) / 1000)) : 0
  const stalledSec = Math.floor((now - lastTickAt) / 1000)
  /** Không nhận được cập nhật nào >20 giây: chuyển thanh sang kiểu chạy vô định để khỏi trông như treo. */
  const stalled = isRunning && stalledSec > 20

  const clock = (sec: number): string =>
    `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

  const statusPill = useMemo(() => {
    if (!project) return null
    const running =
      progress && progress.projectId === project.id && !['ready', 'done', 'error', 'paused'].includes(progress.stage)
    const stage = running ? progress!.stage : project.status
    return (
      <span className={`pill ${STATUS_TONE[stage] ?? 'bg-ink-800 text-ink-300'}`}>
        {running && <Spinner size={10} />}
        {STATUS_LABEL[stage] ?? stage}
        {running && progress!.percent >= 0 && !stalled ? ` ${progress!.percent}%` : ''}
      </span>
    )
  }, [project, progress])

  const liveMessage =
    progress && project && progress.projectId === project.id && !['ready', 'done', 'error', 'paused'].includes(progress.stage)
      ? progress.message
      : null

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="drag-region h-[52px] shrink-0 border-b border-ink-800 bg-ink-900/80 backdrop-blur flex items-center gap-3 px-4">
        <div className="flex items-center gap-2 no-drag">
          <span className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
            <Mic size={15} className="text-white" />
          </span>
          <span className="text-[14px] font-semibold tracking-tight">MeetSum</span>
        </div>

        <div className="w-px h-5 bg-ink-800" />

        <div className="min-w-0 flex items-center gap-2.5 no-drag">
          <span className="text-[13px] text-ink-200 truncate max-w-[340px]">
            {project ? project.name : 'Chưa chọn cuộc họp'}
          </span>
          {project && <span className="text-[11.5px] text-ink-500">{formatDuration(project.durationSec)}</span>}
          {statusPill}
        </div>

        <div className="grow" />

        <div className="flex items-center gap-2 no-drag">
          {project && (
            <>
              {isRunning ? (
                <button className="btn-outline" onClick={handlePause} disabled={pausing} title="Lưu tiến độ rồi dừng lại, lúc nào chạy tiếp cũng được">
                  {pausing ? <Spinner size={13} /> : <PauseCircle size={14} />}
                  {pausing ? 'Đang dừng…' : 'Tạm dừng'}
                </button>
              ) : project.status === 'paused' ? (
                <>
                  <button className="btn-primary" onClick={handleRun} disabled={busyRun} title="Chạy tiếp từ chỗ đang dở">
                    {busyRun ? <Spinner size={13} /> : <PlayCircle size={14} />}
                    Tiếp tục
                    {project.progressSec ? (
                      <span className="opacity-70 ml-1 tabular-nums">
                        {formatTime(project.progressSec)}/{formatTime(project.durationSec ?? 0)}
                      </span>
                    ) : null}
                  </button>
                  <button className="btn-ghost" onClick={handleResetRun} disabled={busyRun} title="Bỏ tiến độ đã lưu và bóc băng lại từ đầu">
                    <RefreshCw size={14} />
                    Làm lại
                  </button>
                </>
              ) : (
                <button className="btn-outline" onClick={handleRun} disabled={busyRun}>
                  {busyRun ? <Spinner size={13} /> : project.segments.length ? <RefreshCw size={14} /> : <Sparkles size={14} />}
                  {project.segments.length ? 'Bóc băng lại' : 'Bóc băng'}
                </button>
              )}
              <button className="btn-outline" onClick={handleSummarize} disabled={busySummary || !project.segments.length}>
                {busySummary ? <Spinner size={13} /> : <Brain size={14} />}
                Tóm tắt
              </button>
              <button className="btn-primary" onClick={() => setShowExport(true)} disabled={!project.segments.length}>
                <FileDown size={14} />
                Xuất PDF
              </button>
            </>
          )}
          <button className="btn-ghost h-9 w-9 !px-0" title="Cài đặt" onClick={() => setShowSettings(true)}>
            <SettingsIcon size={16} />
          </button>
        </div>
      </header>

      {liveMessage && (
        <div className="shrink-0 px-4 py-2 bg-brand-600/10 border-b border-brand-600/25 text-[12px] text-brand-200 flex items-center gap-2.5">
          <Spinner size={11} />
          <span className="truncate">{liveMessage}</span>

          {stalled && (
            <span className="shrink-0 text-ink-400">· vẫn đang chạy, chưa có cập nhật mới</span>
          )}

          <span className="ml-auto shrink-0 flex items-center gap-2.5">
            {runStartedAt !== null && (
              <span className="tabular-nums text-ink-400" title="Thời gian đã chạy">
                {clock(elapsed)}
              </span>
            )}
            {progress!.percent >= 0 && !stalled && (
              <span className="tabular-nums text-brand-200/80 w-9 text-right">{progress!.percent}%</span>
            )}
            <span className="w-40 h-1.5 rounded-full bg-ink-800 overflow-hidden block">
              {stalled || progress!.percent < 0 ? (
                <span className="block h-full w-1/3 bg-brand-500 rounded-full progress-indeterminate" />
              ) : (
                <span
                  className="block h-full bg-brand-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(2, progress!.percent)}%` }}
                />
              )}
            </span>
          </span>
        </div>
      )}

      {/* Body */}
      <div className="grow min-h-0 flex">
        <Sidebar
          rows={rows}
          activeId={activeId}
          onSelect={setActiveId}
          onImport={handleImport}
          importing={importing}
          onDelete={async (id) => {
            const next = await window.api.projects.remove(id)
            setRows(next)
            if (activeId === id) setActiveId(next[0]?.id ?? null)
          }}
        />

        {!project ? (
          <main className="grow flex flex-col items-center justify-center gap-4 text-center p-10">
            <span className="w-14 h-14 rounded-2xl bg-ink-850 border border-ink-800 flex items-center justify-center">
              <Mic size={22} className="text-ink-500" />
            </span>
            <div>
              <h2 className="text-[17px] font-semibold">Bóc băng và tóm tắt cuộc họp ngay trên máy bạn</h2>
              <p className="hint mt-1.5 max-w-md">
                Nhập video đã tải về, app tách người nói, bạn đặt tên cho từng giọng, AI nghiên cứu và viết tóm tắt,
                cuối cùng xuất PDF. Không có server, không có database — tất cả là file JSON trên máy.
              </p>
            </div>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={handleImport} disabled={importing}>
                <FolderOpen size={15} />
                Nhập video
              </button>
              <button className="btn-outline" onClick={() => setShowSettings(true)}>
                <SettingsIcon size={15} />
                Cài đặt engine
              </button>
            </div>
          </main>
        ) : (
          <main className="grow min-w-0 flex gap-3 p-3">
            {/* Cột trái: video + người nói */}
            <div className="w-[41%] max-w-[560px] shrink-0 flex flex-col gap-3 min-h-0 overflow-y-auto pr-1">
              <VideoPlayer videoRef={videoRef} src={videoSrc} onTimeUpdate={setCurrentTime} />
              <SpeakerPanel
                project={project}
                onEdit={setEditingSpeaker}
                onSuggest={handleSuggest}
                suggesting={busySuggest}
                onAdd={async () => setProject(await window.api.speakers.add(project.id))}
              />
              {project.error && (
                <div className="card p-3 border-red-500/30 bg-red-500/5">
                  <p className="text-[12px] text-red-200 leading-relaxed break-words whitespace-pre-line">
                    {project.error}
                  </p>
                </div>
              )}
              {project.warning && !project.error && (
                <div className="card p-3 border-amber-500/30 bg-amber-500/5">
                  <div className="flex items-center gap-1.5 mb-1.5 text-[12px] font-semibold text-amber-300">
                    <AlertTriangle size={13} />
                    Bóc băng xong nhưng chưa tách được người nói
                  </div>
                  <p className="text-[12px] text-amber-100/85 leading-relaxed break-words whitespace-pre-line">
                    {project.warning}
                  </p>
                </div>
              )}
            </div>

            {/* Cột phải: hội thoại / tóm tắt / ghi chú */}
            <div className="grow min-w-0 flex flex-col gap-2 min-h-0">
              <div className="flex items-center gap-1">
                {(
                  [
                    ['transcript', 'Hội thoại'],
                    ['summary', 'Tóm tắt'],
                    ['notes', 'Ghi chú']
                  ] as [MainTab, string][]
                ).map(([id, label]) => (
                  <button key={id} className={`tab ${tab === id ? 'tab-active' : ''}`} onClick={() => setTab(id)}>
                    {label}
                  </button>
                ))}
                <div className="grow" />
                {tab === 'transcript' && project.segments.length > 0 && (
                  <button
                    className="btn-ghost h-8 !px-2 text-[12px]"
                    onClick={async () => {
                      const text = await window.api.summary.transcriptText(project.id, true)
                      await navigator.clipboard.writeText(text)
                      notify('Đã copy bản bóc băng.', 'ok')
                    }}
                  >
                    <Copy size={13} />
                    Copy hội thoại
                  </button>
                )}
              </div>

              {tab === 'transcript' && (
                <TranscriptView
                  project={project}
                  currentTime={currentTime}
                  onSeek={seek}
                  onSpeakerClick={(id) => setEditingSpeaker(project.speakers.find((s) => s.id === id) ?? null)}
                  onEditText={async (segmentId, text) => setProject(await window.api.segments.update(project.id, segmentId, { text }))}
                  onReassign={async (segmentId, speakerId) =>
                    setProject(await window.api.segments.update(project.id, segmentId, { speakerId }))
                  }
                  onSplit={(seg) => setSplitting(seg)}
                  onDelete={async (seg) => {
                    setProject(await window.api.segments.remove(project.id, seg.id))
                    notify('Đã xoá lượt nói.', 'ok')
                  }}
                  onMergeUp={async (seg) => {
                    try {
                      setProject(await window.api.segments.mergeUp(project.id, seg.id))
                    } catch (e) {
                      notify((e as Error).message, 'err')
                    }
                  }}
                />
              )}

              {tab === 'summary' &&
                (editingSummary && project.summary ? (
                  <SummaryEditor
                    value={project.summary}
                    onCancel={() => setEditingSummary(false)}
                    onSave={async (next) => {
                      setProject(await window.api.summary.update(project.id, next))
                      setEditingSummary(false)
                      notify('Đã lưu bản tóm tắt.', 'ok')
                    }}
                  />
                ) : (
                  <SummaryPanel
                    project={project}
                    onSummarize={handleSummarize}
                    onEdit={() => setEditingSummary(true)}
                    busy={busySummary}
                  />
                ))}

              {tab === 'notes' && (
                <div className="card grow p-3 flex flex-col min-h-0">
                  <div className="flex items-center gap-2 mb-2">
                    <StickyNote size={14} className="text-ink-400" />
                    <span className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
                      Ghi chú của bạn
                    </span>
                    <span className="grow" />
                    <button
                      className="btn-outline h-8 text-[12px]"
                      onClick={async () => {
                        setProject(await window.api.projects.saveNotes(project.id, notes))
                        notify('Đã lưu ghi chú.', 'ok')
                      }}
                    >
                      Lưu
                    </button>
                  </div>
                  <textarea
                    className="textarea grow min-h-0"
                    value={notes}
                    placeholder="Ghi lại điều bạn muốn nhớ về cuộc họp này..."
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              )}
            </div>
          </main>
        )}
      </div>

      {/* Dialogs */}
      {project && (
        <SpeakerDialog
          open={Boolean(editingSpeaker)}
          project={project}
          speaker={editingSpeaker}
          onClose={() => setEditingSpeaker(null)}
          onSave={async (name, role, color, propagate) => {
            let updated = await window.api.speakers.rename(project.id, editingSpeaker!.id, name, role, propagate)
            if (color !== editingSpeaker!.color) {
              updated = await window.api.speakers.setColor(project.id, editingSpeaker!.id, color)
            }
            setProject(updated)
            await refreshRows()
            notify(name ? `Đã ghi nhớ giọng của ${name}.` : 'Đã cập nhật.', 'ok')
          }}
          onMerge={async (fromId, intoId) => {
            setProject(await window.api.speakers.merge(project.id, fromId, intoId))
            notify('Đã gộp người nói.', 'ok')
          }}
        />
      )}

      {settings && (
        <SettingsDialog
          open={showSettings}
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={async (patch) => {
            setSettings(await window.api.settings.set(patch))
          }}
        />
      )}

      {project && (
        <ExportDialog
          open={showExport}
          project={project}
          onClose={() => setShowExport(false)}
          onDone={(msg, tone) => notify(msg, tone)}
        />
      )}

      <Modal
        open={Boolean(suggestions?.length)}
        title="AI gợi ý tên người nói"
        subtitle="Dựa trên những chỗ có người tự giới thiệu hoặc được gọi tên trong hội thoại."
        onClose={() => setSuggestions(null)}
        width="max-w-xl"
        footer={
          <button className="btn-ghost" onClick={() => setSuggestions(null)}>
            Đóng
          </button>
        }
      >
        <div className="space-y-2">
          {(suggestions ?? []).map((s) => {
            const sp = project?.speakers.find((x) => x.id === s.speakerId)
            return (
              <div key={s.speakerId} className="rounded-lg border border-ink-800 bg-ink-850/50 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-ink-300">{sp?.name ?? '—'}</span>
                  <span className="text-ink-600">→</span>
                  <span className="text-[13.5px] font-semibold text-brand-200">{s.suggestedName}</span>
                  <span className="pill bg-ink-800 text-ink-400">{Math.round(s.confidence * 100)}%</span>
                  <span className="grow" />
                  <button className="btn-primary h-7 !px-3 text-[12px]" onClick={() => void applySuggestion(s)}>
                    Dùng tên này
                  </button>
                </div>
                {s.evidence && <p className="hint mt-1.5 italic">“{s.evidence}”</p>}
              </div>
            )
          })}
        </div>
      </Modal>

      {project && (
        <SplitDialog
          open={Boolean(splitting)}
          segment={splitting}
          speakers={project.speakers}
          currentTime={currentTime}
          onSeek={seek}
          onPlayRange={playRange}
          onClose={() => setSplitting(null)}
          onSave={async (parts) => {
            setProject(await window.api.segments.split(project.id, splitting!.id, parts))
            notify(`Đã tách thành ${parts.length} lượt nói.`, 'ok')
          }}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  )
}
