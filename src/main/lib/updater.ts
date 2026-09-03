import { app, shell } from 'electron'
import { loadSettings } from './store'

/**
 * Tự cập nhật qua GitHub Releases.
 *
 * Vì app phát hành nội bộ (Windows ký bằng chứng chỉ tự tạo, macOS không ký),
 * luồng cập nhật được chia làm hai nhánh có chủ đích:
 *
 *  - Windows (bản đã đóng gói): tải file cài mới ngay trong app rồi cài khi thoát.
 *    Cần `win.verifyUpdateCodeSignature: false` trong electron-builder.yml, nếu không
 *    electron-updater sẽ từ chối file cài không có chứng chỉ hợp lệ.
 *  - macOS: Squirrel.Mac bắt buộc app phải được ký bằng Developer ID, bản không ký
 *    sẽ luôn thất bại ở bước cài. Nên ở macOS ta CHỈ kiểm tra và mở trang release
 *    để người dùng tải .dmg về thay tay — thà nói thật còn hơn báo lỗi khó hiểu.
 *
 * Mọi lỗi ở đây đều không được làm chết app: cập nhật là tiện ích, không phải
 * chức năng chính.
 */

export const REPO_OWNER = 'nhQing'
export const REPO_NAME = 'meet-sum'
export const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`

export interface UpdateState {
  /** Phiên bản đang chạy */
  current: string
  /** Phiên bản mới nhất trên GitHub (nếu đã kiểm tra được) */
  latest?: string
  available: boolean
  /** Ghi chú phát hành, đã cắt ngắn */
  notes?: string
  releaseUrl: string
  /** Có thể tải + cài ngay trong app hay không (chỉ Windows đã đóng gói) */
  canInstall: boolean
  checking: boolean
  downloading: boolean
  percent: number
  downloaded: boolean
  error?: string
  /** Lý do không kiểm tra được (chạy dev, repo riêng tư thiếu token…) */
  skipped?: string
  checkedAt?: string
}

type Updater = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  logger: unknown
  setFeedURL: (o: unknown) => void
  checkForUpdates: () => Promise<{ updateInfo?: { version?: string; releaseNotes?: unknown } } | null>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall: (silent?: boolean, forceRunAfter?: boolean) => void
  on: (ev: string, fn: (...a: unknown[]) => void) => void
  removeAllListeners: () => void
}

let state: UpdateState = {
  current: app.getVersion(),
  available: false,
  releaseUrl: RELEASES_URL,
  // Bọc Boolean(): "A && B" trả về GIÁ TRỊ của B chứ không phải boolean. Trên
  // Windows vế đầu đúng nên kết quả là chính app.isPackaged — nếu vì lý do gì đó
  // nó không phải boolean thì trường này rò undefined ra tận renderer, dù kiểu
  // khai báo là boolean. Trên Linux/macOS vế đầu sai nên chập mạch thành false,
  // che mất chuyện đó.
  canInstall: Boolean(process.platform === 'win32' && app.isPackaged),
  checking: false,
  downloading: false,
  percent: 0,
  downloaded: false
}

let notify: ((s: UpdateState) => void) | null = null
let updater: Updater | null = null
let wired = false

export function onUpdateState(fn: (s: UpdateState) => void): void {
  notify = fn
}

function push(patch: Partial<UpdateState>): UpdateState {
  state = { ...state, ...patch }
  try {
    notify?.(state)
  } catch {
    // renderer đã đóng
  }
  return state
}

export function updateState(): UpdateState {
  return state
}

/** Nạp electron-updater kiểu lazy: thiếu module cũng không được làm app không mở được. */
function getUpdater(): Updater | null {
  if (updater) return updater
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('electron-updater') as { autoUpdater: Updater }
    updater = mod.autoUpdater
  } catch {
    return null
  }
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true
  updater.allowPrerelease = false
  if (!wired) {
    wired = true
    updater.on('download-progress', (p) => {
      const percent = Math.round(((p as { percent?: number })?.percent ?? 0) * 10) / 10
      push({ downloading: true, percent })
    })
    updater.on('update-downloaded', () => push({ downloading: false, downloaded: true, percent: 100 }))
    updater.on('error', (e) =>
      push({ checking: false, downloading: false, error: friendlyError(String(e)) })
    )
  }
  return updater
}

function friendlyError(raw: string): string {
  const s = raw.toLowerCase()
  if (s.includes('404') || s.includes('not found')) {
    return `Không đọc được danh sách phát hành. Nếu repo ${REPO_OWNER}/${REPO_NAME} ở chế độ riêng tư, hãy điền GitHub token (quyền đọc repo) trong Cài đặt.`
  }
  if (s.includes('enotfound') || s.includes('network') || s.includes('etimedout')) {
    return 'Không kết nối được GitHub. Kiểm tra mạng rồi thử lại.'
  }
  if (s.includes('code signature') || s.includes('sha512')) {
    return `Bản tải về không khớp chữ ký nên đã bị bỏ. Hãy tải file cài thủ công tại ${RELEASES_URL}.`
  }
  return raw.replace(/^Error:\s*/i, '')
}

function notesOf(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const txt = v
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return txt ? txt.slice(0, 600) : undefined
  }
  if (Array.isArray(v)) {
    const txt = v
      .map((x) => (x as { note?: string })?.note ?? '')
      .join('\n')
      .replace(/<[^>]+>/g, ' ')
      .trim()
    return txt ? txt.slice(0, 600) : undefined
  }
  return undefined
}

/** So sánh semver đơn giản, chỉ cần biết "có mới hơn không". */
export function isNewer(latest: string, current: string): boolean {
  const norm = (v: string): number[] =>
    v
      .replace(/^v/i, '')
      .split(/[.\-+]/)
      .slice(0, 3)
      .map((x) => Number.parseInt(x, 10) || 0)
  const a = norm(latest)
  const b = norm(current)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

export async function checkForUpdate(): Promise<UpdateState> {
  const s = loadSettings()
  if (!app.isPackaged) {
    return push({
      checking: false,
      error: undefined,
      skipped: 'Đang chạy bản dev nên không kiểm tra cập nhật. Bản đã cài (.exe/.dmg) sẽ kiểm tra bình thường.'
    })
  }
  const au = getUpdater()
  if (!au) {
    return push({ checking: false, skipped: 'Bản build này không kèm module cập nhật.' })
  }
  push({ checking: true, error: undefined, skipped: undefined })
  try {
    const token = (s.updateToken ?? '').trim()
    if (token) {
      au.setFeedURL({
        provider: 'github',
        owner: REPO_OWNER,
        repo: REPO_NAME,
        private: true,
        token
      })
    }
    const res = await au.checkForUpdates()
    const latest = res?.updateInfo?.version
    if (!latest) {
      return push({ checking: false, checkedAt: new Date().toISOString() })
    }
    return push({
      checking: false,
      latest,
      available: isNewer(latest, state.current),
      notes: notesOf(res?.updateInfo?.releaseNotes),
      releaseUrl: `${RELEASES_URL}/tag/v${latest}`,
      checkedAt: new Date().toISOString()
    })
  } catch (e) {
    return push({ checking: false, error: friendlyError(String(e)), checkedAt: new Date().toISOString() })
  }
}

/** Windows: tải file cài. Nền tảng khác: mở trang release. */
export async function downloadUpdate(): Promise<UpdateState> {
  if (!state.canInstall) {
    await shell.openExternal(state.releaseUrl)
    return state
  }
  const au = getUpdater()
  if (!au) return push({ error: 'Bản build này không kèm module cập nhật.' })
  push({ downloading: true, percent: 0, error: undefined })
  try {
    await au.downloadUpdate()
    return state
  } catch (e) {
    return push({ downloading: false, error: friendlyError(String(e)) })
  }
}

export function installUpdate(): void {
  const au = getUpdater()
  if (!au || !state.downloaded) return
  // isSilent=false để người dùng thấy trình cài chạy, forceRunAfter=true để mở lại app
  au.quitAndInstall(false, true)
}

export function openReleases(): void {
  void shell.openExternal(state.releaseUrl)
}

/**
 * Kiểm tra ngầm khi mở app (nếu người dùng bật). Chỉ báo khi có bản mới, không
 * bao giờ tự tải để tránh ngốn mạng lúc đang bóc băng.
 */
export function checkOnStartup(): void {
  try {
    if (!loadSettings().autoUpdateCheck) return
  } catch {
    return
  }
  if (!app.isPackaged) return
  setTimeout(() => {
    void checkForUpdate()
  }, 8000)
}
