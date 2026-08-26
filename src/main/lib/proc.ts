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
  timeoutMs?: number
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

    if (opts.stdin !== undefined) {
      // tiến trình con có thể đóng stdin sớm — bỏ qua lỗi EPIPE, kết quả vẫn đọc ở stdout
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(opts.stdin, 'utf-8')
    }

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        child.kill()
        reject(new Error(`Tiến trình quá thời gian chờ (${opts.timeoutMs}ms): ${cmd}`))
      }, opts.timeoutMs)
    }

    child.stdout?.on('data', (d) => {
      const s = d.toString()
      stdout += s
      opts.onStdout?.(s)
    })
    child.stderr?.on('data', (d) => {
      const s = d.toString()
      stderr += s
      opts.onStderr?.(s)
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}
