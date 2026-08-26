import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

/** Toàn bộ dữ liệu nằm trong thư mục userData -> không có database, chỉ JSON trên máy cá nhân. */
export function dataRoot(): string {
  const root = join(app.getPath('userData'), 'MeetSumData')
  ensureDir(root)
  return root
}

export function projectsDir(): string {
  return ensureDir(join(dataRoot(), 'projects'))
}

export function projectDir(id: string): string {
  return ensureDir(join(projectsDir(), id))
}

export function projectFile(id: string): string {
  return join(projectDir(id), 'project.json')
}

export function workDir(id: string): string {
  return ensureDir(join(projectDir(id), 'work'))
}

export function settingsFile(): string {
  return join(dataRoot(), 'settings.json')
}

/** Danh bạ giọng nói dùng chung cho mọi cuộc họp. */
export function speakerBookFile(): string {
  return join(dataRoot(), 'speakers.json')
}

export function exportsDir(): string {
  return ensureDir(join(dataRoot(), 'exports'))
}

export function pythonScript(name: string): string {
  const packaged = join(process.resourcesPath || '', 'python', name)
  if (existsSync(packaged)) return packaged
  return join(app.getAppPath(), 'python', name)
}

/** Icon dùng cho cửa sổ / taskbar (hoạt động cả khi .exe chưa được ghi icon). */
export function appIconPath(): string {
  const packaged = join(process.resourcesPath || '', 'icon.png')
  if (existsSync(packaged)) return packaged
  return join(app.getAppPath(), 'build', 'icon.png')
}

export function ensureDir(p: string): string {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
  return p
}
