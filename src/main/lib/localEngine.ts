import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, basename } from 'path'
import type { Settings } from '../../shared/types'
import { run } from './proc'
import { pythonScript, workDir } from './paths'

export interface RawSegment {
  start: number
  end: number
  text: string
}

export interface DiarTurn {
  start: number
  end: number
  speaker: string
}

export interface LocalResult {
  segments: RawSegment[]
  turns: DiarTurn[]
  embeddings: Record<string, number[]>
  meta: Record<string, unknown>
  /** Có kết quả nhưng thiếu một phần (ví dụ không tách được người nói) */
  warning?: string
  /** Bóc băng xong nhưng không lấy được voiceprint -> không nhớ giọng qua các cuộc họp */
  embeddingWarning?: string
  /** 'paused' = người dùng bấm tạm dừng, tiến độ đã được lưu lại */
  status?: 'done' | 'paused'
  /** Đã bóc băng tới giây thứ mấy */
  asrDoneSec?: number
  /** Số câu quảng cáo model bịa ra ở đoạn im lặng đã bị gỡ */
  hallucinationsRemoved?: number
  /**
   * Engine đã tự gán người nói cho từng câu (VibeVoice-ASR làm cả hai việc trong
   * một lượt). App KHÔNG được chạy lại bước ghép ASR với diarization — chính bước
   * ghép đó là chỗ hay gộp nhầm mấy người vào một lượt nói.
   */
  preassigned?: boolean
}

export type AsrBackend = 'faster-whisper' | 'vibevoice'

/**
 * Backend ASR đang chọn. 'python' trong cài đặt vẫn là faster-whisper để không
 * làm hỏng cấu hình cũ của người dùng.
 */
export function asrBackend(settings: Settings): AsrBackend {
  return settings.localAsr === 'vibevoice' ? 'vibevoice' : 'faster-whisper'
}

/**
 * Dựng câu mồi cho model từ từ điển thuật ngữ + tên người đã biết.
 * faster-whisper dùng nó làm ngữ cảnh cho cửa sổ đầu tiên rồi lan tiếp,
 * nên tên riêng và thuật ngữ nội bộ được nghe đúng hơn nhiều.
 */
export function buildInitialPrompt(settings: Settings, knownNames: string[] = []): string {
  const terms = (settings.glossary || '')
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)

  if (settings.glossaryIncludeSpeakers) {
    for (const n of knownNames) {
      const name = n.trim()
      if (name && !/^user_\d+$/.test(name) && !terms.includes(name)) terms.push(name)
    }
  }
  // Mô tả bối cảnh: VibeVoice-ASR nhận cả câu chữ tự do làm ngữ cảnh chứ không
  // chỉ danh sách từ khoá, và faster-whisper cũng dùng được vì initial_prompt
  // vốn là văn bản thường.
  const context = (settings.meetingContext || '').trim().replace(/\s+/g, ' ').slice(0, 600)
  if (!terms.length) return context

  // Viết thành một câu tự nhiên: model bắt chước văn phong của prompt, nên
  // danh sách trần trụi sẽ làm nó trả về output kiểu liệt kê.
  const unique = Array.from(new Set(terms)).slice(0, 60)
  const list = `Cuộc họp có các tên riêng và thuật ngữ sau: ${unique.join(', ')}.`
  return context ? `${context} ${list}` : list
}

export interface ResumeOptions {
  /** File JSON lưu tiến độ giữa các lần chạy */
  checkpointPath: string
  /** File cờ: tạo ra file này thì pipeline dừng gọn gàng */
  stopFilePath: string
  /** Audio truyền vào đã cắt bỏ bao nhiêu giây đầu */
  audioOffsetSec: number
  /** Độ dài video gốc */
  fullDurationSec: number
}

export const HF_GATED_HELP = `Model tách người nói của pyannote bị giới hạn truy cập — cần token HuggingFace (miễn phí).

Làm 4 bước, khoảng 2 phút:
  1. Đăng nhập / đăng ký tại https://huggingface.co
  2. Bấm nút "Agree and access repository" ở CẢ HAI trang:
       https://huggingface.co/pyannote/speaker-diarization-3.1
       https://huggingface.co/pyannote/segmentation-3.0
     (thêm https://huggingface.co/pyannote/embedding nếu muốn app nhớ giọng qua nhiều cuộc họp)
  3. Tạo token loại "Read" tại https://huggingface.co/settings/tokens
  4. Dán token vào Cài đặt → Bóc băng → HuggingFace token, rồi chạy lại

Không muốn làm phần này:
  • Tắt "Tách người nói" trong Cài đặt — vẫn bóc băng bình thường, nhưng mọi câu gộp vào một người.
  • Hoặc Cài đặt → Bóc băng → "Qua API" + Gemini: Gemini tự tách người nói, không cần token.`

/** Đổi mã lỗi từ pipeline.py thành hướng dẫn tiếng Việt. */
export const VOICEPRINT_HELP = `Bóc băng và tách người nói vẫn xong, nhưng KHÔNG lấy được voiceprint.
Hệ quả: app không nhận ra giọng này ở các cuộc họp sau, lần nào cũng phải đặt tên lại.

Nguyên nhân hay gặp nhất: chưa xin quyền model \u0022pyannote/embedding\u0022 trên HuggingFace.
Đây là repo THỨ BA, tách biệt với speaker-diarization-3.1 và segmentation-3.0.

Cách sửa (một lần, ~1 phút):
  1. Mở https://huggingface.co/pyannote/embedding
  2. Bấm \u0022Agree and access repository\u0022
  3. Bóc băng lại video này (bấm \u0022Bóc băng lại\u0022)

Kiểm tra kết quả ở Cài đặt → Danh bạ giọng nói: mỗi giọng phải ghi \u0022voiceprint ...d\u0022
thay vì \u0022chưa có voiceprint\u0022.`

/** Đổi mã lỗi voiceprint thành hướng dẫn cụ thể. */
export function explainEmbeddingError(code: string): string {
  const [kind, ...rest] = code.split('|')
  const detail = rest.join('|').trim()
  if (kind === 'NO_EMBEDDING') {
    return (
      'Bóc băng xong nhưng không trích được voiceprint nào.\n\n' +
      'Thường do các lượt nói đều quá ngắn (dưới 1 giây) — app cần ít nhất một lượt đủ dài ' +
      'cho mỗi người để dựng mẫu giọng. Cuộc họp có người chỉ nói vài từ thì bỏ qua được.\n\n' +
      `Chi tiết: ${detail}`
    )
  }
  return `${VOICEPRINT_HELP}\n\nChi tiết kỹ thuật: ${detail.slice(0, 300)}`
}

export function explainLocalError(code: string): string {
  const [kind, ...rest] = code.split('|')
  const detail = rest.join('|').trim()
  switch (kind) {
    case 'HF_GATED':
      return `${HF_GATED_HELP}\n\nChi tiết kỹ thuật: ${detail.slice(0, 300)}`
    case 'HF_OFFLINE':
      return `Không tải được model vì máy không kết nối được HuggingFace.\n\nKiểm tra mạng / proxy rồi thử lại. Nếu đã tải model trước đó, nó nằm trong thư mục cache của HuggingFace và sẽ dùng lại được khi có mạng.\n\nChi tiết: ${detail.slice(0, 300)}`
    case 'NO_VOICEPRINT_SPLIT':
      // Không phải lỗi: kết quả vẫn dùng được, chỉ là người nói bị tách dư ra
      return detail
    case 'OOM':
      return `Hết bộ nhớ khi chạy model.\n\nThử: chọn model nhỏ hơn (medium hoặc small) trong Cài đặt → Kích thước model, hoặc đổi Thiết bị sang CPU.\n\nChi tiết: ${detail.slice(0, 300)}`
    default:
      return detail || code
  }
}

export interface PythonInfo {
  python?: string
  faster_whisper?: boolean
  pyannote?: boolean
  transformers?: boolean
  /** transformers >= 5.14, đã có lớp VibeVoiceAsr */
  vibevoice?: boolean
  soundfile?: boolean
  torch?: boolean
  numpy?: boolean
  /** Số nhân CPU máy đang có — để đối chiếu với số luồng đang dùng */
  cpu_count?: number
  cuda?: boolean
  torch_version?: string
}

export interface PythonAttempt {
  cmd: string
  reason: string
}

export interface PythonProbe {
  /** Lệnh python chạy được, null nếu không tìm ra */
  bin: string | null
  /** Tham số đứng trước tên script (ví dụ ['-3'] cho py launcher) */
  prefix: string[]
  info: PythonInfo | null
  detail: string
  attempts: PythonAttempt[]
  scriptPath: string
  scriptExists: boolean
}

interface Candidate {
  bin: string
  prefix: string[]
}

/** Dò các vị trí cài Python phổ biến trên Windows (khi người dùng không tick "Add to PATH"). */
function windowsGuesses(): string[] {
  if (process.platform !== 'win32') return []
  const out: string[] = []
  const roots = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Python') : '',
    'C:\\Python313',
    'C:\\Python312',
    'C:\\Python311',
    'C:\\Python310'
  ].filter(Boolean)

  for (const root of roots) {
    try {
      if (!existsSync(root)) continue
      const direct = join(root, 'python.exe')
      if (existsSync(direct)) {
        out.push(direct)
        continue
      }
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const exe = join(root, entry.name, 'python.exe')
        if (existsSync(exe)) out.push(exe)
      }
    } catch {
      // bỏ qua thư mục không đọc được
    }
  }
  return out
}

/**
 * Vị trí Python phổ biến trên macOS / Linux. Cần thiết vì app mở từ Finder
 * không thấy Homebrew, pyenv hay python.org trong PATH.
 */
function unixGuesses(): string[] {
  if (process.platform === 'win32') return []
  const home = homedir()
  const out: string[] = []
  const push = (p: string): void => {
    if (p && !out.includes(p) && existsSync(p)) out.push(p)
  }

  // Bản cài từ python.org nằm trong Framework, ưu tiên bản mới nhất
  const framework = '/Library/Frameworks/Python.framework/Versions'
  try {
    if (existsSync(framework)) {
      const vers = readdirSync(framework, { withFileTypes: true })
        .filter((d) => d.isDirectory() && /^\d+\.\d+$/.test(d.name))
        .map((d) => d.name)
        .sort((a, b) => parseFloat(b) - parseFloat(a))
      for (const v of vers) push(join(framework, v, 'bin', 'python3'))
    }
  } catch {
    // bỏ qua nếu không đọc được
  }

  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin']) {
    try {
      if (!existsSync(dir)) continue
      // python3.13, python3.12... rồi mới tới python3 chung chung
      const named = readdirSync(dir)
        .filter((f) => /^python3\.\d+$/.test(f))
        .sort((a, b) => parseFloat(b.slice(6)) - parseFloat(a.slice(6)))
      for (const f of named) push(join(dir, f))
      push(join(dir, 'python3'))
    } catch {
      // bỏ qua
    }
  }

  push(join(home, '.pyenv', 'shims', 'python3'))
  push(join(home, '.local', 'bin', 'python3'))
  return out
}

export function pythonCandidates(settings: Settings): Candidate[] {
  const list: Candidate[] = []
  const push = (bin: string, prefix: string[] = []): void => {
    if (bin && !list.some((c) => c.bin === bin && c.prefix.join() === prefix.join())) {
      list.push({ bin, prefix })
    }
  }
  if (settings.pythonPath) push(settings.pythonPath)
  push('python')
  push('python3')
  if (process.platform === 'win32') push('py', ['-3'])
  for (const guess of windowsGuesses()) push(guess)
  for (const guess of unixGuesses()) push(guess)
  return list
}

/** Diễn giải lý do một ứng viên python không dùng được, bằng tiếng Việt dễ hiểu. */
function explainFailure(code: number, stdout: string, stderr: string): string {
  const err = (stderr || stdout).replace(/\s+/g, ' ').trim()
  if (/was not found|Microsoft Store|WindowsApps/i.test(err)) {
    return 'chỉ là shortcut rỗng của Microsoft Store, chưa cài Python thật'
  }
  if (/can't open file|No such file or directory/i.test(err)) {
    return 'không mở được file pipeline.py'
  }
  if (/SyntaxError/i.test(err)) return 'phiên bản Python quá cũ (cần 3.9 trở lên)'
  if (!err) return `chạy xong nhưng không trả về gì (exit ${code})`
  return `exit ${code}: ${err.slice(0, 180)}`
}

/** Tìm python chạy được pipeline.py, kèm chẩn đoán chi tiết để người dùng biết phải sửa gì. */
export async function probePython(settings: Settings): Promise<PythonProbe> {
  const scriptPath = pythonScript('pipeline.py')
  const scriptExists = existsSync(scriptPath)
  const attempts: PythonAttempt[] = []

  if (!scriptExists) {
    return {
      bin: null,
      prefix: [],
      info: null,
      attempts,
      scriptPath,
      scriptExists,
      detail: `Không tìm thấy file pipeline.py tại: ${scriptPath}. Thư mục "python" phải nằm cùng cấp với package.json (bản đóng gói: trong thư mục resources).`
    }
  }

  for (const cand of pythonCandidates(settings)) {
    const label = [cand.bin, ...cand.prefix].join(' ')
    const looksLikePath = /[\\/]/.test(cand.bin)
    if (looksLikePath && !existsSync(cand.bin)) {
      attempts.push({ cmd: label, reason: 'đường dẫn này không tồn tại trên máy' })
      continue
    }
    try {
      const r = await run(cand.bin, [...cand.prefix, scriptPath, '--mode', 'check'], { timeoutMs: 90000 })
      const out = r.stdout.trim()
      if (r.code === 0 && out.startsWith('{')) {
        return {
          bin: cand.bin,
          prefix: cand.prefix,
          info: JSON.parse(out) as PythonInfo,
          attempts,
          scriptPath,
          scriptExists,
          detail: `${label} sẵn sàng`
        }
      }
      attempts.push({ cmd: label, reason: explainFailure(r.code, out, r.stderr) })
    } catch (e) {
      const msg = (e as Error).message || ''
      attempts.push({
        cmd: label,
        reason: /ENOENT/.test(msg) ? 'không có trong PATH' : msg.slice(0, 160)
      })
    }
  }

  const tried = attempts.map((a) => `  • ${a.cmd} → ${a.reason}`).join('\n')
  return {
    bin: null,
    prefix: [],
    info: null,
    attempts,
    scriptPath,
    scriptExists,
    detail:
      `Không tìm thấy Python chạy được pipeline.py.\n\nĐã thử:\n${tried}\n\n` + installHelp()
  }
}

/** Hướng dẫn cài Python theo đúng hệ điều hành đang chạy. */
function installHelp(): string {
  if (process.platform === 'darwin') {
    return (
      'Cách sửa:\n' +
      '  1. Cài Python: brew install python@3.12 — hoặc tải bản .pkg từ python.org.\n' +
      '  2. Hoặc mở Cài đặt → Đường dẫn Python và trỏ tới file python3 (ví dụ /opt/homebrew/bin/python3).\n' +
      '  3. Không muốn cài Python: Cài đặt → Bóc băng → chuyển sang "Qua API" (Gemini).\n\n' +
      'Lưu ý: app mở từ Finder không tự thấy PATH trong ~/.zshrc. MeetSum đã tự dò Homebrew,\n' +
      'pyenv và python.org, nhưng nếu bạn cài Python ở chỗ khác thì phải điền đường dẫn thủ công.'
    )
  }
  if (process.platform === 'win32') {
    return (
      'Cách sửa:\n' +
      '  1. Cài Python 3.10–3.12 từ python.org, khi cài nhớ tick "Add python.exe to PATH".\n' +
      '  2. Hoặc mở Cài đặt → Đường dẫn Python và trỏ trực tiếp tới file python.exe.\n' +
      '  3. Không muốn cài Python: Cài đặt → Bóc băng → chuyển sang "Qua API" (Gemini).'
    )
  }
  return (
    'Cách sửa:\n' +
    '  1. Cài Python 3.10–3.12 bằng trình quản lý gói của bản phân phối.\n' +
    '  2. Hoặc mở Cài đặt → Đường dẫn Python và trỏ tới file python3.\n' +
    '  3. Không muốn cài Python: Cài đặt → Bóc băng → chuyển sang "Qua API" (Gemini).'
  )
}

/** Kiểm tra thư viện Python cần cho từng chế độ, báo lỗi rõ ràng trước khi chạy pipeline. */
function assertLibraries(
  info: PythonInfo | null,
  mode: 'full' | 'asr' | 'diarize',
  bin: string,
  backend: AsrBackend
): void {
  if (!info) return

  if (backend === 'vibevoice') {
    if (info.vibevoice) return
    const why = info.transformers
      ? 'Có transformers nhưng chưa đủ mới — VibeVoice-ASR cần transformers 5.14 trở lên.'
      : 'Chưa có thư viện transformers.'
    throw new Error(
      `Python (${bin}) chưa chạy được VibeVoice-ASR.\n\n${why}\n\n` +
        `Chạy lệnh sau rồi thử lại:\n  "${bin}" -m pip install -U "transformers>=5.14" torch torchaudio\n\n` +
        'Muốn lấy voiceprint để nhớ giọng qua các cuộc họp thì cài thêm:\n  ' +
        `"${bin}" -m pip install "pyannote.audio>=3.1"\n\n` +
        'Hoặc quay lại backend faster-whisper trong Cài đặt → Bóc băng.'
    )
  }

  const needAsr = mode === 'full' || mode === 'asr'
  const needDiar = mode === 'full' || mode === 'diarize'
  const missing: string[] = []
  if (needAsr && !info.faster_whisper) missing.push('faster-whisper')
  if (needDiar && !info.pyannote) missing.push('"pyannote.audio>=3.1" torch torchaudio')
  if (!missing.length) return
  throw new Error(
    `Python (${bin}) chưa có thư viện cần thiết.\n\nChạy lệnh sau rồi thử lại:\n  ` +
      `"${bin}" -m pip install ${missing.join(' ')}\n\n` +
      (needDiar && !info.pyannote
        ? 'Nếu không cần tách người nói, có thể tắt "Tách người nói" trong Cài đặt.\n'
        : '')
  )
}

/** Chạy pipeline python: ASR (faster-whisper) và/hoặc diarization (pyannote). */
export async function runPythonPipeline(
  projectId: string,
  audioPath: string,
  settings: Settings,
  mode: 'full' | 'asr' | 'diarize',
  onProgress: (stage: string, percent: number, message: string) => void,
  resume?: ResumeOptions,
  initialPrompt?: string,
  skipRanges?: { start: number; end: number }[],
  /**
   * Độ dài THẬT của video. Bắt buộc truyền khi có skipRanges: nếu không, python
   * phải đoán độ dài từ file audio, mà lệch một chút là các vùng bỏ qua bị kẹp
   * sai rồi cắt nhầm sạch cả video.
   */
  fullDurationSec?: number
): Promise<LocalResult> {
  const backend = asrBackend(settings)
  const probe = await probePython(settings)
  if (!probe.bin) throw new Error(probe.detail)
  assertLibraries(probe.info, mode, probe.bin, backend)

  const outFile = join(workDir(projectId), 'local_result.json')
  const args = [
    ...probe.prefix,
    probe.scriptPath,
    '--audio', audioPath,
    '--out', outFile,
    '--mode', mode,
    '--language', settings.language || 'vi',
    '--model-size', settings.fwModelSize || 'large-v3',
    '--device', settings.fwDevice || 'auto',
    '--num-speakers', String(settings.fixedSpeakerCount || 0),
    '--asr-backend', backend,
    '--voice-threshold', String(settings.voiceMatchThreshold ?? 0.72),
    '--threads', String(settings.asrThreads ?? 0),
    '--batch-size', String(settings.asrBatchSize ?? 8),
    '--anti-hallucination', settings.antiHallucination === false ? '0' : '1',
    '--vad-threshold', String(settings.vadThreshold ?? 0.5),
    '--no-vad', settings.disableVad ? '1' : '0'
  ]
  if (settings.extraHallucinationPhrases?.trim()) {
    args.push('--extra-hallucinations', settings.extraHallucinationPhrases.trim())
  }
  if (skipRanges?.length) {
    args.push('--skip-ranges', JSON.stringify(skipRanges.map((r) => ({ start: r.start, end: r.end }))))
    if (!resume && fullDurationSec && fullDurationSec > 0) {
      args.push('--full-duration', String(fullDurationSec))
    }
  }
  if (backend === 'vibevoice') {
    args.push('--vibevoice-model', settings.vibevoiceModel || 'microsoft/VibeVoice-ASR-HF')
  }
  if (settings.hfToken) args.push('--hf-token', settings.hfToken)
  if (initialPrompt?.trim()) args.push('--initial-prompt', initialPrompt.trim())
  if (resume) {
    args.push(
      '--checkpoint', resume.checkpointPath,
      '--stop-file', resume.stopFilePath,
      '--audio-offset', String(resume.audioOffsetSec),
      '--full-duration', String(resume.fullDurationSec)
    )
  }

  let stderrTail = ''
  const res = await run(probe.bin, args, {
    timeoutMs: 1000 * 60 * 60 * 6,
    env: { PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    onStderr: (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-4000)
      for (const line of chunk.split('\n')) {
        const m = /^PROGRESS\s+(\S+)\s+(\d+)\s*(.*)$/.exec(line.trim())
        if (m) onProgress(m[1], Number(m[2]), m[3] || '')
      }
    }
  })

  if (!existsSync(outFile)) {
    throw new Error(
      `Pipeline local thất bại (code ${res.code}). Chi tiết:\n${stderrTail.slice(-1200) || res.stdout.slice(-800)}`
    )
  }
  const parsed = JSON.parse(readFileSync(outFile, 'utf-8')) as LocalResult & {
    error?: string
    asr_done_sec?: number
    embedding_error?: string
    preassigned?: boolean
  }
  if (parsed.error && (parsed.segments?.length ?? 0) === 0 && (parsed.turns?.length ?? 0) === 0) {
    throw new Error(explainLocalError(parsed.error))
  }
  return {
    segments: parsed.segments ?? [],
    turns: parsed.turns ?? [],
    embeddings: parsed.embeddings ?? {},
    meta: parsed.meta ?? {},
    warning: parsed.warning ? explainLocalError(parsed.warning) : undefined,
    embeddingWarning: parsed.embedding_error ? explainEmbeddingError(parsed.embedding_error) : undefined,
    status: parsed.status ?? 'done',
    asrDoneSec: parsed.asr_done_sec ?? 0,
    hallucinationsRemoved: Number(
      (parsed.meta as Record<string, unknown> | undefined)?.hallucinations_removed ?? 0
    ),
    preassigned: Boolean(parsed.preassigned)
  }
}

interface WhisperCppJson {
  transcription?: { offsets?: { from: number; to: number }; text?: string }[]
}

/** Chạy whisper.cpp (whisper-cli) để bóc băng. */
export async function runWhisperCpp(
  projectId: string,
  audioPath: string,
  settings: Settings,
  onProgress: (percent: number, message: string) => void
): Promise<RawSegment[]> {
  const bin = settings.whisperBinPath
  const model = settings.whisperModelPath
  if (!bin || !existsSync(bin)) throw new Error('Chưa cấu hình đường dẫn whisper.cpp (whisper-cli).')
  if (!model || !existsSync(model)) throw new Error('Chưa cấu hình file model .bin của whisper.cpp.')

  const outBase = join(workDir(projectId), 'whispercpp')
  const args = [
    '-m', model,
    '-f', audioPath,
    '-oj',
    '-of', outBase,
    '-t', String(settings.whisperThreads || 4),
    '-pp'
  ]
  if (settings.language && settings.language !== 'auto') args.push('-l', settings.language)

  onProgress(3, `Đang chạy ${basename(bin)}`)
  const res = await run(bin, args, {
    timeoutMs: 1000 * 60 * 60 * 6,
    onStderr: (chunk) => {
      const m = /progress\s*=\s*(\d+)%/.exec(chunk)
      if (m) onProgress(Math.min(98, Number(m[1])), 'Đang bóc băng')
    }
  })

  const jsonFile = outBase + '.json'
  if (!existsSync(jsonFile)) {
    throw new Error(`whisper.cpp không tạo được file JSON (code ${res.code}). ${res.stderr.slice(-800)}`)
  }
  const data = JSON.parse(readFileSync(jsonFile, 'utf-8')) as WhisperCppJson
  const segments: RawSegment[] = (data.transcription ?? [])
    .map((t) => ({
      start: (t.offsets?.from ?? 0) / 1000,
      end: (t.offsets?.to ?? 0) / 1000,
      text: (t.text ?? '').trim()
    }))
    .filter((s) => s.text.length > 0)
  onProgress(99, `Xong ${segments.length} câu`)
  return segments
}
