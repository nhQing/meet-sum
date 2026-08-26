import { protocol } from 'electron'
import { createReadStream, statSync } from 'fs'
import { extname } from 'path'
import { Readable } from 'stream'

export const MEDIA_SCHEME = 'meetsum'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg'
}

export function mediaUrl(filePath: string): string {
  return `${MEDIA_SCHEME}://media/?p=${encodeURIComponent(filePath)}`
}

export function registerPrivilegedScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
    }
  ])
}

/** Phục vụ file video/audio local kèm hỗ trợ Range để tua được trên thanh thời gian. */
export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const filePath = url.searchParams.get('p')
      if (!filePath) return new Response('Thiếu tham số p', { status: 400 })

      const stat = statSync(filePath)
      const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      const range = request.headers.get('Range')

      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range)
        if (m) {
          const start = m[1] ? Number(m[1]) : 0
          const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1
          if (start >= stat.size) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${stat.size}` }
            })
          }
          const stream = createReadStream(filePath, { start, end })
          return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
            status: 206,
            headers: {
              'Content-Type': type,
              'Content-Length': String(end - start + 1),
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Accept-Ranges': 'bytes'
            }
          })
        }
      }

      const stream = createReadStream(filePath)
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(stat.size),
          'Accept-Ranges': 'bytes'
        }
      })
    } catch (e) {
      return new Response(`Không đọc được file: ${(e as Error).message}`, { status: 404 })
    }
  })
}

