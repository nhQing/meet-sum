import { existsSync } from 'fs'
import { join } from 'path'
import { run } from './proc'
import { workDir } from './paths'

/** Trả về đường dẫn binary đã fix cho trường hợp app được đóng gói (asar). */
function resolveBin(mod: { path: string }): string {
  const p = mod.path
  const unpacked = p.replace('app.asar', 'app.asar.unpacked')
  return existsSync(unpacked) ? unpacked : p
}

export function ffmpegPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@ffmpeg-installer/ffmpeg')
  return resolveBin(mod)
}

export function ffprobePath(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@ffprobe-installer/ffprobe')
  return resolveBin(mod)
}

export async function checkFfmpeg(): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await run(ffmpegPath(), ['-version'], { timeoutMs: 15000 })
    const first = r.stdout.split('\n')[0] || r.stderr.split('\n')[0]
    return { ok: r.code === 0, detail: first.trim() || 'Không đọc được phiên bản' }
  } catch (e) {
    return { ok: false, detail: (e as Error).message }
  }
}

export async function probeDuration(file: string): Promise<number> {
  try {
    const r = await run(
      ffprobePath(),
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { timeoutMs: 30000 }
    )
    const v = parseFloat(r.stdout.trim())
    return Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

/**
 * Tách audio từ video thành WAV 16kHz mono — định dạng chuẩn cho whisper và pyannote.
 * onProgress nhận % dựa trên thời lượng đã xử lý.
 */
/**
 * Chuỗi filter audio dùng khi tách khỏi video.
 *
 * loudnorm chuẩn hoá độ to của CẢ FILE — nó kéo mức chung về -18 LUFS nhưng
 * GIỮ NGUYÊN chênh lệch giữa người nói to và người nói nhỏ. Họp mà có người
 * ngồi xa mic thì người đó vẫn nhỏ y như cũ, VAD bỏ qua, thành đoạn im lặng,
 * rồi model bịa quảng cáo vào đó.
 *
 * dynaudnorm chuẩn hoá theo CỬA SỔ TRƯỢT nên kéo được đoạn nhỏ lên. Đo trên
 * file thử 5 giây to + 5 giây nhỏ: chênh lệch 24,4dB -> 9,7dB, đoạn nhỏ được
 * nâng 10dB.
 *
 * Đổi lại nó cũng khuếch đại tiếng ồn nền ở đoạn im lặng, nên mặc định TẮT —
 * chỉ bật khi thật sự có người nói nhỏ. m=12 chặn mức khuếch đại tối đa,
 * s=6 làm mượt để đỡ bị "bơm" lên xuống.
 */
export function audioFilterChain(boostQuietVoices: boolean): string {
  const base = 'highpass=f=70,lowpass=f=7800'
  const norm = 'loudnorm=I=-18:TP=-2:LRA=9'
  return boostQuietVoices
    ? `${base},dynaudnorm=f=250:g=15:p=0.9:m=12:s=6,${norm}`
    : `${base},${norm}`
}

export async function extractAudio(
  projectId: string,
  videoPath: string,
  durationSec: number,
  onProgress?: (percent: number) => void,
  filterChain?: string
): Promise<string> {
  const out = join(workDir(projectId), 'audio.wav')
  const args = [
    '-y',
    '-i', videoPath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'pcm_s16le',
    '-af', filterChain || audioFilterChain(false),
    out
  ]
  await run(ffmpegPath(), args, {
    timeoutMs: 1000 * 60 * 90,
    onStderr: (chunk) => {
      if (!onProgress || !durationSec) return
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(chunk)
      if (m) {
        const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
        onProgress(Math.max(0, Math.min(99, Math.round((secs / durationSec) * 100))))
      }
    }
  })
  if (!existsSync(out)) throw new Error('ffmpeg không tạo được file audio. Kiểm tra lại định dạng video.')
  return out
}

/** Cắt một đoạn audio ngắn (dùng khi gửi lên API theo chunk). */
export async function sliceAudio(
  projectId: string,
  audioPath: string,
  startSec: number,
  durationSec: number,
  index: number
): Promise<string> {
  const out = join(workDir(projectId), `chunk_${String(index).padStart(3, '0')}.wav`)
  await run(
    ffmpegPath(),
    ['-y', '-i', audioPath, '-ss', String(startSec), '-t', String(durationSec), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out],
    { timeoutMs: 1000 * 60 * 10 }
  )
  return out
}

/** Nén audio thành mp3 mono nhẹ để upload lên API (tiết kiệm băng thông). */
export async function compressAudio(projectId: string, audioPath: string, kbps = 48): Promise<string> {
  const out = join(workDir(projectId), `audio_${kbps}k.mp3`)
  await run(
    ffmpegPath(),
    ['-y', '-i', audioPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', `${kbps}k`, out],
    { timeoutMs: 1000 * 60 * 60 }
  )
  if (!existsSync(out)) throw new Error('Không nén được audio để gửi lên API.')
  return out
}
