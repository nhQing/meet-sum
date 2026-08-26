import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, renameSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import type {
  CliProviderConfig,
  Project,
  ProjectSummaryRow,
  Settings,
  SpeakerProfile
} from '../../shared/types'
import { defaultSettings } from './defaults'
import { projectFile, projectsDir, projectDir, settingsFile, speakerBookFile } from './paths'

export function uid(prefix = ''): string {
  return prefix + randomBytes(5).toString('hex')
}

/** Ghi JSON kiểu atomic: ghi file tạm rồi rename, tránh mất dữ liệu nếu app tắt giữa lúc ghi. */
function writeJson(file: string, data: unknown): void {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmp, file)
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf-8')) as T
  } catch {
    return fallback
  }
}

// ---------------- Settings ----------------

export function loadSettings(): Settings {
  const raw = readJson<Partial<Settings>>(settingsFile(), {})
  const base = defaultSettings()

  // Chỉ giữ các provider API hợp lệ — bỏ những id cũ đã chuyển sang nhóm CLI
  const apiIds = Object.keys(base.llm.providers)
  const rawProviders = (raw.llm?.providers ?? {}) as Record<string, unknown>
  const cleanProviders = Object.fromEntries(
    Object.entries(rawProviders).filter(([id]) => apiIds.includes(id))
  ) as Settings['llm']['providers']

  // Gộp từng CLI với preset để cài cũ vẫn có đủ các trường mới
  const rawCli = (raw.cliProviders ?? {}) as Record<string, Partial<CliProviderConfig>>
  const cliProviders = Object.fromEntries(
    Object.entries(base.cliProviders).map(([id, preset]) => [id, { ...preset, ...(rawCli[id] ?? {}) }])
  ) as Settings['cliProviders']

  const active = raw.llm?.active
  const validActive =
    active && (apiIds.includes(active) || Object.keys(cliProviders).includes(active))
      ? active
      : base.llm.active

  return {
    ...base,
    ...raw,
    llm: {
      active: validActive,
      providers: { ...base.llm.providers, ...cleanProviders }
    },
    cliProviders
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const current = loadSettings()
  const next: Settings = {
    ...current,
    ...patch,
    llm: patch.llm
      ? { active: patch.llm.active ?? current.llm.active, providers: { ...current.llm.providers, ...patch.llm.providers } }
      : current.llm
  }
  writeJson(settingsFile(), next)
  return next
}

// ---------------- Speaker book (danh bạ giọng nói) ----------------

export interface SpeakerBook {
  speakers: SpeakerProfile[]
}

export function loadSpeakerBook(): SpeakerBook {
  return readJson<SpeakerBook>(speakerBookFile(), { speakers: [] })
}

export function saveSpeakerBook(book: SpeakerBook): SpeakerBook {
  writeJson(speakerBookFile(), book)
  return book
}

export function upsertGlobalSpeaker(profile: SpeakerProfile): void {
  const book = loadSpeakerBook()
  const idx = book.speakers.findIndex((s) => s.id === profile.id)
  const entry: SpeakerProfile = { ...profile, updatedAt: new Date().toISOString() }
  if (idx >= 0) {
    // Giữ lại embedding cũ nếu bản mới không có
    entry.embedding = profile.embedding ?? book.speakers[idx].embedding
    entry.seen = (book.speakers[idx].seen ?? 1) + 0
    book.speakers[idx] = entry
  } else {
    entry.seen = entry.seen ?? 1
    book.speakers.push(entry)
  }
  saveSpeakerBook(book)
}

export function removeGlobalSpeaker(id: string): void {
  const book = loadSpeakerBook()
  saveSpeakerBook({ speakers: book.speakers.filter((s) => s.id !== id) })
}

// ---------------- Projects ----------------

export function listProjects(): ProjectSummaryRow[] {
  const dir = projectsDir()
  const rows: ProjectSummaryRow[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const p = readJson<Project | null>(join(dir, entry.name, 'project.json'), null)
    if (!p) continue
    rows.push({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      status: p.status,
      durationSec: p.durationSec,
      speakerCount: p.speakers?.length ?? 0,
      segmentCount: p.segments?.length ?? 0,
      hasSummary: Boolean(p.summary)
    })
  }
  return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export function getProject(id: string): Project | null {
  return readJson<Project | null>(projectFile(id), null)
}

export function saveProject(project: Project): Project {
  const next: Project = { ...project, updatedAt: new Date().toISOString() }
  writeJson(projectFile(next.id), next)
  return next
}

export function createProject(name: string, videoPath: string): Project {
  const now = new Date().toISOString()
  const project: Project = {
    id: uid('prj_'),
    name,
    videoPath,
    createdAt: now,
    updatedAt: now,
    status: 'new',
    speakers: [],
    segments: []
  }
  projectDir(project.id)
  return saveProject(project)
}

export function deleteProject(id: string): void {
  rmSync(projectDir(id), { recursive: true, force: true })
}

export function patchProject(id: string, patch: Partial<Project>): Project | null {
  const p = getProject(id)
  if (!p) return null
  return saveProject({ ...p, ...patch })
}
