import { contextBridge, ipcRenderer } from 'electron'
import type {
  CliProviderConfig,
  CliProviderId,
  DoctorResult,
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

export interface NameSuggestion {
  speakerId: string
  suggestedName: string
  evidence: string
  confidence: number
}

const api = {
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
  system: {
    openPath: (p: string): Promise<string> => ipcRenderer.invoke('system:openPath', p),
    showInFolder: (p: string): Promise<void> => ipcRenderer.invoke('system:showInFolder', p),
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
    saveNotes: (id: string, notes: string): Promise<Project> => ipcRenderer.invoke('projects:saveNotes', id, notes)
  },
  pipeline: {
    run: (projectId: string): Promise<Project> => ipcRenderer.invoke('pipeline:run', projectId),
    isRunning: (projectId: string): Promise<boolean> => ipcRenderer.invoke('pipeline:isRunning', projectId),
    pause: (projectId: string): Promise<boolean> => ipcRenderer.invoke('pipeline:pause', projectId),
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
    mergeUp: (projectId: string, segmentId: string): Promise<Project> =>
      ipcRenderer.invoke('segments:mergeUp', projectId, segmentId)
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
    json: (projectId: string): Promise<string> => ipcRenderer.invoke('export:json', projectId)
  },
  doctor: {
    run: (): Promise<DoctorResult> => ipcRenderer.invoke('doctor:run')
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
