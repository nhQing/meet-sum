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

/**
 * Nhiều CLI (rõ nhất là Claude Code) khi lỗi vẫn in ra một khối JSON đầy đủ
 * thống kê, trong đó câu báo lỗi thật nằm ở trường "result"/"error". Trước đây
 * app cắt 600 ký tự đầu của stdout nên người dùng chỉ thấy một dãy số 0 vô
 * nghĩa, còn câu quan trọng thì bị cắt mất. Hàm này moi đúng câu đó ra.
 */
export function extractCliMessage(raw: string): {
  message: string
  envelope: Record<string, unknown> | null
} {
  const text = (raw || '').trim()
  if (!text) return { message: '', envelope: null }

  const candidates: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim()
    if (l.startsWith('{')) candidates.push(l)
  }
  if (text.startsWith('{')) candidates.push(text)

  for (let i = candidates.length - 1; i >= 0; i--) {
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(candidates[i]) as Record<string, unknown>
    } catch {
      continue
    }
    for (const key of ['result', 'error', 'message', 'error_message']) {
      const v = obj[key]
      if (typeof v === 'string' && v.trim()) return { message: v.trim(), envelope: obj }
      // Anthropic API trả {"error":{"message":"..."}}
      if (v && typeof v === 'object') {
        const inner = (v as Record<string, unknown>).message
        if (typeof inner === 'string' && inner.trim()) return { message: inner.trim(), envelope: obj }
      }
    }
    return { message: '', envelope: obj }
  }
  return { message: '', envelope: null }
}

/** Tổng token đã dùng. 0 nghĩa là request chưa hề tới được model; -1 = không biết. */
function usedTokens(envelope: Record<string, unknown> | null): number {
  const u = envelope?.usage as Record<string, unknown> | undefined
  if (!u) return -1
  const keys = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
  let total = 0
  let sawAny = false
  for (const k of keys) {
    if (typeof u[k] === 'number') {
      sawAny = true
      total += u[k] as number
    }
  }
  return sawAny ? total : -1
}

/** Lỗi do bản bóc băng vượt cửa sổ ngữ cảnh — chỗ gọi dùng để tự chia phần rồi thử lại. */
export function isContextLengthError(text: string): boolean {
  return /prompt is too long|context.{0,25}(too long|length|limit|window|exceed)|max.{0,15}tokens.{0,15}exceed|request too large|413|input length/i.test(
    text || ''
  )
}

/**
 * Dịch lỗi của CLI agent sang câu người dùng làm được gì đó, thay vì ném nguyên
 * khối JSON vào mặt họ.
 */
export function explainCliFailure(
  label: string,
  bin: string,
  code: number | null,
  stdout: string,
  stderr: string,
  docChars: number
): string {
  const { message, envelope } = extractCliMessage(stdout)
  const rawTail = (stderr || stdout).replace(/\s+/g, ' ').trim()
  const hay = `${message} ${rawTail}`.toLowerCase()
  const terminal = String(envelope?.terminal_reason ?? '')
  const tokens = usedTokens(envelope)

  const head = `${label} không chạy được (exit ${code ?? '?'}).`
  const detail = message ? `\n\nCLI báo: ${message}` : ''

  if (/not logged in|unauthorized|authentication|\/login|not authenticated|sign in|oauth|invalid api key|401/i.test(hay)) {
    return `${head}\n\nCó vẻ chưa đăng nhập hoặc phiên đăng nhập hết hạn. Mở terminal, chạy "${bin}" một lần và đăng nhập lại, rồi thử lại.${detail}`
  }
  if (/usage limit|rate.?limit|429|too many requests|quota/i.test(hay)) {
    return (
      `${head}\n\nTài khoản đã hết lượt dùng trong khung giờ này. Chờ tới lúc được cấp lại, ` +
      `hoặc vào Cài đặt → AI & API key đổi tạm sang một CLI/API key khác.${detail}`
    )
  }
  if (/credit balance|insufficient|billing|payment/i.test(hay)) {
    return `${head}\n\nTài khoản hết credit hoặc có vấn đề thanh toán. Kiểm tra lại tài khoản rồi thử lại.${detail}`
  }
  if (isContextLengthError(hay)) {
    return (
      `${head}\n\nBản bóc băng quá dài so với giới hạn của model (${Math.round(docChars / 1000)}k ký tự). ` +
      `Vào Cài đặt → Prompt tóm tắt, đặt "Độ dài mỗi phần khi tóm tắt" khác 0 (mặc định 45000) ` +
      `để app tự chia nhỏ rồi tóm tắt từng phần. Hoặc đổi sang model có cửa sổ ngữ cảnh lớn hơn.${detail}`
    )
  }
  if (/overloaded|529|503|temporarily unavailable/i.test(hay)) {
    return `${head}\n\nMáy chủ của nhà cung cấp đang quá tải. Chờ vài phút rồi bấm Tóm tắt lại.${detail}`
  }
  if (/enotfound|econnrefused|etimedout|network|proxy|certificate|tunnel|socket hang up/i.test(hay)) {
    return (
      `${head}\n\nKhông kết nối được tới máy chủ. Kiểm tra mạng, VPN hoặc proxy của công ty ` +
      `— CLI cần ra được internet.${detail}`
    )
  }

  // Có khối JSON, lỗi phía API, mà không tốn token nào: request chưa hề tới model
  if (terminal === 'api_error' || (envelope && tokens === 0)) {
    return (
      `${head}\n\nCLI kết nối được tới máy chủ AI nhưng bị trả lỗi trước khi model kịp đọc gì ` +
      `(không tốn token nào). Ba nguyên nhân hay gặp, kiểm tra theo thứ tự:\n` +
      `  1. Tài khoản hết lượt dùng trong khung giờ này.\n` +
      `  2. Phiên đăng nhập hết hạn — chạy "${bin}" trong terminal một lần để đăng nhập lại.\n` +
      `  3. Mạng / VPN / proxy chặn.\n\n` +
      `Thử nhanh: mở terminal gõ   ${bin} -p "xin chào"   — nếu cũng lỗi thì vấn đề nằm ở CLI ` +
      `chứ không phải MeetSum. Trong lúc chờ, vào Cài đặt → AI & API key đổi sang CLI hoặc API key khác vẫn tóm tắt được.` +
      detail
    )
  }

  return `${head}${detail || `\n\nChi tiết: ${rawTail.slice(0, 400) || 'không rõ nguyên nhân'}`}`
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

    // Có CLI trả exit 0 nhưng trong JSON vẫn báo lỗi — đừng coi đó là thành công
    const envelope = extractCliMessage(res.stdout).envelope
    if (res.code !== 0 || envelope?.is_error === true) {
      throw new Error(
        explainCliFailure(cfg.label, probe.bin, res.code, res.stdout, res.stderr, document.length)
      )
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
