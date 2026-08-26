import { safeStorage } from 'electron'
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
import { blendEmbedding, mergeEmbeddings, normalize } from './voice'
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

// ---------------- Mã hoá key ----------------

/**
 * API key và HuggingFace token trước đây nằm plaintext trong settings.json.
 * Nay được mã hoá bằng safeStorage của Electron — Keychain trên macOS, DPAPI
 * trên Windows — nên chỉ user đang đăng nhập trên chính máy đó giải mã được.
 *
 * Giá trị đã mã hoá có tiền tố "enc:v1:". Giá trị plaintext cũ vẫn đọc được và
 * sẽ tự chuyển sang dạng mã hoá ở lần lưu kế tiếp.
 */
const ENC_PREFIX = 'enc:v1:'

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function encryptSecret(plain: string): string {
  if (!plain || plain.startsWith(ENC_PREFIX) || !canEncrypt()) return plain
  try {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
  } catch {
    return plain
  }
}

function decryptSecret(stored: string): string {
  if (!stored || !stored.startsWith(ENC_PREFIX)) return stored
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    // Máy khác / profile khác thì không giải mã được — trả về rỗng để người dùng nhập lại,
    // tốt hơn là ném lỗi làm app không mở được.
    return ''
  }
}

/** Đi qua mọi trường bí mật trong settings và biến đổi tại chỗ. */
function mapSecrets(s: Settings, fn: (v: string) => string): Settings {
  const providers = Object.fromEntries(
    Object.entries(s.llm.providers).map(([id, cfg]) => [id, { ...cfg, apiKey: fn(cfg.apiKey ?? '') }])
  ) as Settings['llm']['providers']
  return {
    ...s,
    hfToken: fn(s.hfToken ?? ''),
    updateToken: fn(s.updateToken ?? ''),
    llm: { ...s.llm, providers }
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

  const merged: Settings = {
    ...base,
    ...raw,
    llm: {
      active: validActive,
      providers: { ...base.llm.providers, ...cleanProviders }
    },
    cliProviders
  }
  return mapSecrets(merged, decryptSecret)
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
  writeJson(settingsFile(), mapSecrets(next, encryptSecret))
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

/**
 * Ghi một giọng vào danh bạ.
 * learnVoice = true (sau mỗi lần bóc băng): trộn mẫu giọng mới vào mẫu cũ theo
 * trung bình có trọng số và tăng số lần gặp.
 * learnVoice = false (khi chỉ đổi tên/màu): giữ nguyên mẫu giọng và số lần gặp.
 */
export function upsertGlobalSpeaker(profile: SpeakerProfile, opts: { learnVoice?: boolean } = {}): void {
  const book = loadSpeakerBook()
  const idx = book.speakers.findIndex((s) => s.id === profile.id)
  const now = new Date().toISOString()

  if (idx < 0) {
    book.speakers.push({
      ...profile,
      embedding: profile.embedding?.length ? normalize(profile.embedding) : undefined,
      seen: profile.seen ?? 1,
      updatedAt: now
    })
    saveSpeakerBook(book)
    return
  }

  const prev = book.speakers[idx]
  const prevSeen = prev.seen ?? 1

  book.speakers[idx] = {
    ...prev,
    ...profile,
    embedding: opts.learnVoice
      ? blendEmbedding(prev.embedding, profile.embedding, prevSeen)
      : (prev.embedding ?? profile.embedding),
    seen: opts.learnVoice ? prevSeen + 1 : prevSeen,
    updatedAt: now
  }
  saveSpeakerBook(book)
}

/**
 * Gộp hai giọng trong danh bạ thành một người: mẫu giọng lấy trung bình có
 * trọng số của cả hai, số lần gặp cộng dồn. Mọi cuộc họp đang trỏ tới giọng bị
 * gộp sẽ được chuyển sang giọng giữ lại.
 */
export function mergeGlobalSpeakers(keepId: string, dropId: string): { book: SpeakerProfile[]; projectsUpdated: number } {
  if (keepId === dropId) throw new Error('Phải chọn hai giọng khác nhau.')
  const book = loadSpeakerBook()
  const keep = book.speakers.find((s) => s.id === keepId)
  const drop = book.speakers.find((s) => s.id === dropId)
  if (!keep || !drop) throw new Error('Không tìm thấy giọng cần gộp.')

  const keepSeen = keep.seen ?? 1
  const dropSeen = drop.seen ?? 1

  const merged: SpeakerProfile = {
    ...keep,
    // Bên nào đã được đặt tên thì giữ tên đó; cả hai đều có tên thì ưu tiên bên giữ lại
    name: keep.named ? keep.name : drop.named ? drop.name : keep.name,
    named: keep.named || drop.named,
    role: keep.role || drop.role,
    embedding: mergeEmbeddings(keep.embedding, keepSeen, drop.embedding, dropSeen),
    seen: keepSeen + dropSeen,
    updatedAt: new Date().toISOString()
  }

  saveSpeakerBook({ speakers: book.speakers.filter((s) => s.id !== dropId).map((s) => (s.id === keepId ? merged : s)) })

  // Chuyển các cuộc họp cũ sang dùng giọng đã gộp
  let projectsUpdated = 0
  for (const row of listProjects()) {
    const p = getProject(row.id)
    if (!p || !p.speakers.some((s) => s.id === dropId)) continue

    const hasKeep = p.speakers.some((s) => s.id === keepId)
    const speakers = hasKeep
      ? p.speakers.filter((s) => s.id !== dropId)
      : p.speakers.map((s) => (s.id === dropId ? { ...s, id: keepId, name: merged.name, named: merged.named } : s))
    const segments = p.segments.map((sg) => (sg.speakerId === dropId ? { ...sg, speakerId: keepId } : sg))
    saveProject({ ...p, speakers, segments })
    projectsUpdated += 1
  }

  return { book: loadSpeakerBook().speakers, projectsUpdated }
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
