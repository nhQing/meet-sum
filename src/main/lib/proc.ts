import { spawn } from 'child_process'
import { homedir } from 'os'
import { delimiter, join } from 'path'

/**
 * App mở từ Finder/Dock trên macOS KHÔNG kế thừa PATH của shell (~/.zshrc),
 * chỉ có /usr/bin:/bin:/usr/sbin:/sbin. Nghĩa là python3 của Homebrew, claude,
 * gemini, codex... đều "không tìm thấy" dù gõ trong Terminal vẫn chạy.
 * Bổ sung sẵn các thư mục bin phổ biến vào PATH cho mọi tiến trình con.
 */
function augmentedPath(): string {
  const home = homedir()
  const current = process.env.PATH ?? ''
  if (process.platform === 'win32') return current

  const extras = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    join(home, '.local', 'bin'),
    join(home, 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.pyenv', 'shims'),
    join(home, '.asdf', 'shims'),
    '/opt/local/bin'
  ]
  const seen = new Set(current.split(delimiter).filter(Boolean))
  const add = extras.filter((d) => !seen.has(d))
  return add.length ? [...add, current].filter(Boolean).join(delimiter) : current
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export interface RunOptions {
  cwd?: string
  /** Dữ liệu ghi vào stdin của tiến trình con (đẩy văn bản dài mà không đụng giới hạn độ dài dòng lệnh) */
  stdin?: string
  env?: Record<string, string>
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
  /** Hạn chót TUYỆT ĐỐI tính từ lúc spawn. Chỉ nên dùng cho lệnh ngắn, dứt điểm. */
  timeoutMs?: number
  /**
   * Hạn chót TÍNH LẠI mỗi lần tiến trình con in ra gì đó.
   *
   * Với việc chạy hàng giờ (bóc băng), `timeoutMs` là sai công cụ: nó giết cả
   * tiến trình đang chạy hoàn toàn bình thường chỉ vì đã quá mốc. Cái ta thật
   * sự muốn biết là "nó còn sống không", mà dấu hiệu của việc đó là còn in ra
   * tiến độ. Ngưỡng này phải rộng hơn khoảng lặng dài nhất hợp lệ — nạp model
   * vài GB từ đĩa là im lặng vài phút.
   */
  idleTimeoutMs?: number
  /** Câu báo lỗi khi hết hạn — mặc định là câu chung chung nói về tiến trình. */
  timeoutMessage?: string
  /** Chạy qua shell — cần cho file .cmd/.bat trên Windows */
  shell?: boolean
}

/** Chạy một tiến trình con và thu output. Không bao giờ throw vì exit code khác 0 — trả về code để bên gọi xử lý. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      // PATH phải đặt SAU khi trải process.env, nếu không sẽ bị chính process.env.PATH ghi đè
      env: { ...process.env, PATH: augmentedPath(), ...(opts.env ?? {}) },
      windowsHide: true,
      shell: opts.shell ?? false
    })
    let stdout = ''
    let stderr = ''
    let timer: NodeJS.Timeout | undefined
    let idleTimer: NodeJS.Timeout | undefined
    let settled = false

    if (opts.stdin !== undefined) {
      // tiến trình con có thể đóng stdin sớm — bỏ qua lỗi EPIPE, kết quả vẫn đọc ở stdout
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(opts.stdin, 'utf-8')
    }

    const clearTimers = (): void => {
      if (timer) clearTimeout(timer)
      if (idleTimer) clearTimeout(idleTimer)
    }

    const expire = (kind: 'absolute' | 'idle', ms: number): void => {
      if (settled) return
      settled = true
      clearTimers()
      child.kill()
      const span = ms >= 60000 ? `${Math.round(ms / 60000)} phút` : `${Math.round(ms / 1000)} giây`
      const why =
        kind === 'idle'
          ? `Tiến trình không báo tiến độ gì trong ${span} nên bị coi là treo`
          : `Tiến trình quá thời gian chờ (${ms}ms)`
      reject(new Error(opts.timeoutMessage ? `${why}.\n\n${opts.timeoutMessage}` : `${why}: ${cmd}`))
    }

    if (opts.timeoutMs) {
      timer = setTimeout(() => expire('absolute', opts.timeoutMs as number), opts.timeoutMs)
    }

    /** Còn in ra là còn sống — đẩy hạn chót ra xa thêm một nhịp nữa. */
    const touch = (): void => {
      if (!opts.idleTimeoutMs || settled) return
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => expire('idle', opts.idleTimeoutMs as number), opts.idleTimeoutMs)
    }
    touch()

    child.stdout?.on('data', (d) => {
      const s = d.toString()
      stdout += s
      touch()
      opts.onStdout?.(s)
    })
    child.stderr?.on('data', (d) => {
      const s = d.toString()
      stderr += s
      touch()
      opts.onStderr?.(s)
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimers()
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimers()
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}
