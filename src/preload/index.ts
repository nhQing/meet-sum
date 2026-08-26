import { contextBridge, ipcRenderer } from 'electron'
import type {
  BundleInfo,
  CliProviderConfig,
  CliProviderId,
  DoctorResult,
  ImportBundleResult,
  MeetingSummary,
  PipelineProgress,
  Project,
  ProjectSummaryRow,
  Settings,
  SpeakerProfile
} from '../shared/types'

export interface PdfOptions {
  includeTranscript: boolean
  includeTimestamps: boolean
}

export interface SearchHit {
  projectId: string
  projectName: string
  createdAt: string
  segmentId: string
  start: number
  speaker: string
  snippet: string
  inSummary: boolean
}

export interface NameSuggestion {
  speakerId: string
  suggestedName: string
  evidence: string
  confidence: number
}

export interface UpdateState {
  current: string
  latest?: string
  available: boolean
  notes?: string
  releaseUrl: string
  canInstall: boolean
  checking: boolean
  downloading: boolean
  percent: number
  downloaded: boolean
  error?: string
  skipped?: string
  checkedAt?: string
}

const api = {
  /** Chia sẻ cuộc họp giữa các máy bằng một file .meetsum */
  bundle: {
    /** Dựng gói rồi hỏi chỗ lưu. Trả null nếu người dùng bấm Huỷ. */
    export: (
      projectIds: string[],
      opts: { includeNotes?: boolean; exportedBy?: string }
    ): Promise<{ path: string; meetings: number; speakers: number } | null> =>
      ipcRenderer.invoke('bundle:export', projectIds, opts),
    /** Mở hộp thoại chọn file và mô tả nội dung gói. Trả null nếu bấm Huỷ. */
    pick: (): Promise<BundleInfo | null> => ipcRenderer.invoke('bundle:pick'),
    describe: (path: string): Promise<BundleInfo> => ipcRenderer.invoke('bundle:describe', path),
    import: (
      path: string,
      opts: { select?: string[]; importVoiceprints?: boolean }
    ): Promise<ImportBundleResult> => ipcRenderer.invoke('bundle:import', path, opts)
  },
  update: {
    state: (): Promise<UpdateState> => ipcRenderer.invoke('update:state'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),
    download: (): Promise<UpdateState> => ipcRenderer.invoke('update:download'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    openReleases: (): Promise<void> => ipcRenderer.invoke('update:openReleases'),
    onState: (cb: (s: UpdateState) => void): (() => void) => {
      const listener = (_e: unknown, payload: UpdateState): void => cb(payload)
      ipcRenderer.on('update:state', listener)
      return () => ipcRenderer.removeListener('update:state', listener)
    }
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch),
    defaultCli: (): Promise<Record<CliProviderId, CliProviderConfig>> =>
      ipcRenderer.invoke('settings:defaultCli')
  },
  dialog: {
    pickVideo: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickVideo'),
    pickFile: (opts: { title: string; extensions?: string[] }): Promise<string> =>
      ipcRenderer.invoke('dialog:pickFile', opts),
    pickSavePdf: (defaultName: string): Promise<string> => ipcRenderer.invoke('dialog:pickSavePdf', defaultName)
  },
  /** Hệ điều hành đang chạy — renderer cần biết ngay lúc render đầu tiên để chừa chỗ cho nút cửa sổ macOS */
  platform: process.platform as NodeJS.Platform,

  system: {
    openPath: (p: string): Promise<string> => ipcRenderer.invoke('system:openPath', p),
    showInFolder: (p: string): Promise<void> => ipcRenderer.invoke('system:showInFolder', p),
    copyText: (text: string): Promise<void> => ipcRenderer.invoke('system:copyText', text),
    dataRoot: (): Promise<string> => ipcRenderer.invoke('system:dataRoot'),
    exportsDir: (): Promise<string> => ipcRenderer.invoke('system:exportsDir'),
    version: (): Promise<{ app: string; electron: string; platform: string }> =>
      ipcRenderer.invoke('system:version'),
    mediaUrl: (p: string): Promise<string> => ipcRenderer.invoke('system:mediaUrl', p)
  },
  projects: {
    list: (): Promise<ProjectSummaryRow[]> => ipcRenderer.invoke('projects:list'),
    get: (id: string): Promise<Project | null> => ipcRenderer.invoke('projects:get', id),
    import: (files: string[]): Promise<Project[]> => ipcRenderer.invoke('projects:import', files),
    remove: (id: string): Promise<ProjectSummaryRow[]> => ipcRenderer.invoke('projects:delete', id),
    rename: (id: string, name: string): Promise<Project> => ipcRenderer.invoke('projects:rename', id, name),
    saveNotes: (id: string, notes: string): Promise<Project> => ipcRenderer.invoke('projects:saveNotes', id, notes),
    /** Trỏ cuộc họp tới file video trên máy này (dùng cho cuộc họp nhập từ gói chia sẻ) */
    relinkVideo: (id: string): Promise<Project | null> => ipcRenderer.invoke('projects:relinkVideo', id)
  },
  pipeline: {
    run: (projectId: string): Promise<Project> => ipcRenderer.invoke('pipeline:run', projectId),
    isRunning: (projectId: string): Promise<boolean> => ipcRenderer.invoke('pipeline:isRunning', projectId),
    pause: (projectId: string): Promise<boolean> => ipcRenderer.invoke('pipeline:pause', projectId),
    enqueue: (projectIds: string[]): Promise<string[]> => ipcRenderer.invoke('pipeline:enqueue', projectIds),
    dequeue: (projectId: string): Promise<string[]> => ipcRenderer.invoke('pipeline:dequeue', projectId),
    clearQueue: (): Promise<string[]> => ipcRenderer.invoke('pipeline:clearQueue'),
    queue: (): Promise<string[]> => ipcRenderer.invoke('pipeline:queue'),
    onQueue: (cb: (ids: string[]) => void): (() => void) => {
      const listener = (_e: unknown, ids: string[]): void => cb(ids)
      ipcRenderer.on('pipeline:queue', listener)
      return () => ipcRenderer.removeListener('pipeline:queue', listener)
    },
    reset: (projectId: string): Promise<Project | null> => ipcRenderer.invoke('pipeline:reset', projectId),
    resumeInfo: (projectId: string): Promise<{ doneSec: number; segments: number } | null> =>
      ipcRenderer.invoke('pipeline:resumeInfo', projectId),
    onProgress: (cb: (p: PipelineProgress) => void): (() => void) => {
      const listener = (_e: unknown, payload: PipelineProgress): void => cb(payload)
      ipcRenderer.on('pipeline:progress', listener)
      return () => ipcRenderer.removeListener('pipeline:progress', listener)
    }
  },
  speakers: {
    rename: (projectId: string, speakerId: string, name: string, role: string, propagate: boolean): Promise<Project> =>
      ipcRenderer.invoke('speakers:rename', projectId, speakerId, name, role, propagate),
    setColor: (projectId: string, speakerId: string, color: string): Promise<Project> =>
      ipcRenderer.invoke('speakers:setColor', projectId, speakerId, color),
    merge: (projectId: string, fromId: string, intoId: string): Promise<Project> =>
      ipcRenderer.invoke('speakers:merge', projectId, fromId, intoId),
    book: (): Promise<SpeakerProfile[]> => ipcRenderer.invoke('speakers:book'),
    bookRemove: (id: string): Promise<SpeakerProfile[]> => ipcRenderer.invoke('speakers:bookRemove', id),
    bookMerge: (keepId: string, dropId: string): Promise<{ book: SpeakerProfile[]; projectsUpdated: number }> =>
      ipcRenderer.invoke('speakers:bookMerge', keepId, dropId),
    suggest: (projectId: string): Promise<NameSuggestion[]> => ipcRenderer.invoke('speakers:suggest', projectId),
    add: (projectId: string): Promise<Project> => ipcRenderer.invoke('segments:addSpeaker', projectId)
  },
  segments: {
    update: (projectId: string, segmentId: string, patch: { text?: string; speakerId?: string }): Promise<Project> =>
      ipcRenderer.invoke('segments:update', projectId, segmentId, patch),
    reassign: (projectId: string, segmentIds: string[], speakerId: string): Promise<Project> =>
      ipcRenderer.invoke('segments:reassignRange', projectId, segmentIds, speakerId),
    split: (
      projectId: string,
      segmentId: string,
      parts: { start: number; end: number; text: string; speakerId: string }[]
    ): Promise<Project> => ipcRenderer.invoke('segments:split', projectId, segmentId, parts),
    remove: (projectId: string, segmentId: string): Promise<Project> =>
      ipcRenderer.invoke('segments:delete', projectId, segmentId),
    replaceAll: (
      projectId: string,
      find: string,
      replaceWith: string,
      opts: { caseSensitive?: boolean; wholeWord?: boolean }
    ): Promise<{ project: Project; replaced: number }> =>
      ipcRenderer.invoke('segments:replaceAll', projectId, find, replaceWith, opts),
    mergeUp: (projectId: string, segmentId: string): Promise<Project> =>
      ipcRenderer.invoke('segments:mergeUp', projectId, segmentId)
  },
  search: {
    all: (query: string, limit?: number): Promise<SearchHit[]> =>
      ipcRenderer.invoke('search:all', query, limit)
  },

  history: {
    info: (projectId: string): Promise<{ depth: number; label: string | null }> =>
      ipcRenderer.invoke('history:info', projectId),
    undo: (projectId: string): Promise<{ project: Project; label: string } | null> =>
      ipcRenderer.invoke('history:undo', projectId),
    clear: (projectId: string): Promise<{ depth: number; label: string | null }> =>
      ipcRenderer.invoke('history:clear', projectId)
  },

  summary: {
    run: (projectId: string): Promise<Project> => ipcRenderer.invoke('summary:run', projectId),
    update: (projectId: string, summary: MeetingSummary): Promise<Project> =>
      ipcRenderer.invoke('summary:update', projectId, summary),
    transcriptText: (projectId: string, withTime: boolean): Promise<string> =>
      ipcRenderer.invoke('summary:transcriptText', projectId, withTime)
  },
  exporter: {
    pdf: (projectId: string, opts: PdfOptions, targetPath?: string): Promise<string> =>
      ipcRenderer.invoke('export:pdf', projectId, opts, targetPath),
    json: (projectId: string): Promise<string> => ipcRenderer.invoke('export:json', projectId),
    file: (
      projectId: string,
      format: 'srt' | 'vtt' | 'md' | 'txt' | 'docx',
      opts: { includeTranscript: boolean; includeTimestamps: boolean }
    ): Promise<string> => ipcRenderer.invoke('export:file', projectId, format, opts)
  },
  doctor: {
    run: (): Promise<DoctorResult> => ipcRenderer.invoke('doctor:run')
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
