import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import type { CliProviderConfig, Settings } from '../../shared/types'
import { run } from './proc'

export interface CliProbe {
  bin: string | null
  version: string
  detail: string
  attempts: { cmd: string; reason: string }[]
}

/**
 * Claude Desktop đăng ký Claude.exe trong WindowsApps — gọi nhầm sẽ mở app GUI rồi treo.
 * Chỉ lọc với các lệnh tên "claude", các CLI khác không bị ảnh hưởng.
 */
function isDesktopShadow(binName: string, path: string): boolean {
  if (!/^claude/i.test(binName)) return false
  return /WindowsApps/i.test(path) || /AnthropicClaude/i.test(path)
}

/** Hỏi hệ điều hành xem lệnh nằm ở đâu. */
async function fromPathLookup(binName: string): Promise<string[]> {
  const win = process.platform === 'win32'
  try {
    const r = await run(win ? 'where.exe' : 'which', win ? [binName] : ['-a', binName], {
      timeoutMs: 10000
    })
    if (r.code !== 0) return []
    return r.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !isDesktopShadow(binName, l))
  } catch {
    return []
  }
}

/** Các vị trí cài đặt phổ biến của những CLI agent này. */
function commonInstallPaths(binName: string): string[] {
  const home = homedir()
  const bare = binName.replace(/\.(exe|cmd|bat)$/i, '')
  if (process.platform === 'win32') {
    return [
      join(home, '.local', 'bin', `${bare}.exe`),
      join(home, '.local', 'bin', `${bare}.cmd`),
      join(process.env.LOCALAPPDATA ?? '', 'Programs', bare, `${bare}.exe`),
      join(process.env.APPDATA ?? '', 'npm', `${bare}.cmd`)
    ]
  }
  return [
    join(home, '.local', 'bin', bare),
    join(home, '.bun', 'bin', bare),
    '/opt/homebrew/bin/' + bare,
    '/usr/local/bin/' + bare
  ]
}

async function buildCandidates(bin: string): Promise<string[]> {
  const list: string[] = []
  const push = (p: string): void => {
    if (p && !list.includes(p) && !isDesktopShadow(bin, p)) list.push(p)
  }

  const isPath = /[\\/]/.test(bin)
  if (isPath) {
    // Người dùng đã trỏ đường dẫn cụ thể — chỉ dùng đúng nó
    push(bin)
    return list
  }

  for (const p of commonInstallPaths(bin)) push(p)
  for (const p of await fromPathLookup(bin)) push(p)
  push(bin)
  if (process.platform === 'win32') {
    push(`${bin}.exe`)
    push(`${bin}.cmd`)
  }
  return list
}

/** Tìm binary của một CLI agent và lấy version. */
export async function probeCli(bin: string): Promise<CliProbe> {
  const attempts: { cmd: string; reason: string }[] = []
  if (!bin.trim()) {
    return { bin: null, version: '', attempts, detail: 'Chưa điền tên lệnh của CLI trong Cài đặt.' }
  }

  for (const cand of await buildCandidates(bin)) {
    const looksLikePath = /[\\/]/.test(cand)
    if (looksLikePath && !existsSync(cand)) {
      attempts.push({ cmd: cand, reason: 'đường dẫn không tồn tại' })
      continue
    }
    try {
      // .cmd/.bat trên Windows phải chạy qua shell
      const needShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cand)
      const r = await run(cand, ['--version'], { timeoutMs: 25000, shell: needShell })
      const out = (r.stdout + ' ' + r.stderr).trim()
      const m = /(\d+\.\d+\.\d+[^\s]*)/.exec(out)
      if (r.code === 0 && (m || out.length > 0)) {
        const version = m ? m[1] : out.split('\n')[0].slice(0, 40)
        return { bin: cand, version, detail: `${cand} · v${version}`, attempts }
      }
      attempts.push({
        cmd: cand,
        reason: `exit ${r.code}: ${out.replace(/\s+/g, ' ').slice(0, 140) || 'không in ra version'}`
      })
    } catch (e) {
      const msg = (e as Error).message || ''
      attempts.push({
        cmd: cand,
        reason: /ENOENT/.test(msg)
          ? 'không có trong PATH'
          : /thời gian chờ/.test(msg)
            ? 'chạy mãi không trả lời'
            : msg.slice(0, 140)
      })
    }
  }

  const tried = attempts.map((a) => `  • ${a.cmd} → ${a.reason}`).join('\n')
  return {
    bin: null,
    version: '',
    attempts,
    detail:
      `Không tìm thấy CLI "${bin}".\n\nĐã thử:\n${tried}\n\n` +
      'Cách sửa:\n' +
      `  1. Mở terminal gõ: ${bin} --version — phải ra số phiên bản.\n` +
      '  2. Nếu có nhưng app không thấy: vào Cài đặt → AI và điền đường dẫn tuyệt đối tới file thực thi.\n' +
      '  3. Hoặc chuyển sang provider dùng API key.'
  }
}

function tmpFile(suffix: string): string {
  return join(tmpdir(), `meetsum_${randomBytes(6).toString('hex')}${suffix}`)
}

/**
 * Ghép danh sách tham số từ template.
 * Nếu model rỗng thì bỏ token chứa {model} và cả cờ đứng ngay trước nó.
 */
export function buildArgs(
  template: string[],
  vars: { prompt: string; model: string; doc: string; docfile: string; outfile: string }
): string[] {
  const out: string[] = []
  for (const raw of template) {
    if (raw.includes('{model}') && !vars.model.trim()) {
      // Chỉ bỏ cờ đứng trước khi token này CHÍNH LÀ giá trị của cờ đó ("-m", "{model}").
      // Với dạng "--model={model}" thì cờ nằm ngay trong token, bỏ thêm token trước
      // sẽ ăn mất một cờ không liên quan (ví dụ "-s" của Copilot CLI).
      if (raw.trim() === '{model}') {
        const prev = out[out.length - 1]
        if (prev !== undefined && prev.startsWith('-') && !prev.includes('=')) out.pop()
      }
      continue
    }
    out.push(
      raw
        .replaceAll('{prompt}', vars.prompt)
        .replaceAll('{model}', vars.model)
        .replaceAll('{doc}', vars.doc)
        .replaceAll('{docfile}', vars.docfile)
        .replaceAll('{outfile}', vars.outfile)
    )
  }
  return out
}

export interface CliRunResult {
  text: string
  bin: string
}

/** Đọc nội dung ra khỏi kết quả CLI theo kiểu output đã cấu hình. */
function pickOutput(cfg: CliProviderConfig, stdout: string, outfile: string): string {
  if (cfg.output === 'file') {
    if (!existsSync(outfile)) {
      throw new Error(
        `${cfg.label}: không tìm thấy file kết quả CLI ghi ra (${outfile}). ` +
          'Kiểm tra lại tham số {outfile} trong Cài đặt.'
      )
    }
    return readFileSync(outfile, 'utf-8')
  }

  if (cfg.output === 'json') {
    const trimmed = stdout.trim()
    // Một số CLI in JSON Lines — lấy dòng JSON cuối cùng có chứa trường cần tìm
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().startsWith('{'))
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]) as Record<string, unknown>
        const val = cfg.jsonPath ? obj[cfg.jsonPath] : undefined
        if (typeof val === 'string' && val.trim()) return val
      } catch {
        continue
      }
    }
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      const val = cfg.jsonPath ? obj[cfg.jsonPath] : undefined
      if (typeof val === 'string') return val
    } catch {
      // rơi xuống dùng stdout thô
    }
    return trimmed
  }

  return stdout
}

/**
 * Gọi một CLI agent trên máy để xử lý văn bản dài.
 * Bản bóc băng đi qua stdin (mặc định) nên không đụng giới hạn độ dài dòng lệnh của Windows.
 */
export async function runCliAgent(
  cfg: CliProviderConfig,
  instruction: string,
  document: string
): Promise<CliRunResult> {
  const probe = await probeCli(cfg.bin)
  if (!probe.bin) throw new Error(probe.detail)

  const outfile = cfg.output === 'file' ? tmpFile('.txt') : ''
  const needDocFile = cfg.args.some((a) => a.includes('{docfile}'))
  const docfile = needDocFile ? tmpFile('.txt') : ''
  if (docfile) writeFileSync(docfile, document, 'utf-8')

  const args = buildArgs(cfg.args, {
    prompt: instruction,
    model: cfg.model ?? '',
    doc: document,
    docfile,
    outfile
  })

  const needShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(probe.bin)

  try {
    const res = await run(probe.bin, args, {
      stdin: cfg.input === 'stdin' ? document : undefined,
      timeoutMs: Math.max(30, cfg.timeoutSec || 1200) * 1000,
      shell: needShell
    })

    if (res.code !== 0) {
      const reason = (res.stderr || res.stdout).replace(/\s+/g, ' ').trim().slice(0, 600)
      if (/not logged in|unauthorized|authentication|\/login|not authenticated|sign in/i.test(reason)) {
        throw new Error(
          `${cfg.label} chưa đăng nhập.\n\nMở terminal, chạy lệnh ${cfg.bin} một lần và đăng nhập, rồi thử lại.\n\nChi tiết: ${reason}`
        )
      }
      throw new Error(`${cfg.label} lỗi (exit ${res.code}): ${reason || 'không rõ nguyên nhân'}`)
    }

    const text = pickOutput(cfg, res.stdout, outfile)
    if (!text.trim()) {
      throw new Error(
        `${cfg.label} chạy xong nhưng không trả về nội dung. ` +
          (cfg.output === 'json'
            ? `Có thể tên trường JSON ("${cfg.jsonPath}") không đúng — kiểm tra lại trong Cài đặt.`
            : 'Kiểm tra lại tham số dòng lệnh trong Cài đặt.')
      )
    }
    return { text, bin: probe.bin }
  } finally {
    for (const f of [outfile, docfile]) {
      if (f && existsSync(f)) {
        try {
          unlinkSync(f)
        } catch {
          // file tạm — xoá không được cũng không sao
        }
      }
    }
  }
}

export function activeCli(settings: Settings): CliProviderConfig | null {
  const id = settings.llm.active
  const cfg = settings.cliProviders?.[id as keyof typeof settings.cliProviders]
  return cfg ?? null
}
