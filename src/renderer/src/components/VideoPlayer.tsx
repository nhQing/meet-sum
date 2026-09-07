import { ReactNode, RefObject, useEffect, useRef, useState } from 'react'
import { Mic, Pause, Play, RotateCcw, RotateCw, Scissors, Trash2, Volume2, VolumeX, Film, X } from 'lucide-react'
import type { SkipRange } from '../../../shared/types'
import { formatTime } from '../lib/format'

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]

export default function VideoPlayer({
  videoRef,
  src,
  onTimeUpdate,
  /** Thay cho chữ "Chưa có video" — ví dụ cuộc họp nhập từ gói chia sẻ cần nút trỏ lại file */
  emptyState,
  skipRanges = [],
  onChangeSkipRanges,
  onRedoRange
}: {
  videoRef: RefObject<HTMLVideoElement>
  src: string
  onTimeUpdate: (t: number) => void
  emptyState?: ReactNode
  /** Các đoạn đánh dấu bỏ qua khi bóc băng, vẽ thành vệt xám trên thanh thời gian */
  skipRanges?: SkipRange[]
  onChangeSkipRanges?: (ranges: SkipRange[]) => void
  /** Bóc băng lại riêng khoảng đang chọn */
  onRedoRange?: (start: number, end: number) => void
}): JSX.Element {
  /** Mốc "Đầu đoạn" đang chờ bấm "Cuối đoạn"; null = chưa bắt đầu đánh dấu */
  const [markStart, setMarkStart] = useState<number | null>(null)
  /** Khoảng đang kéo chọn trên dải chọn; null = chưa chọn gì */
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = (): void => {
      setTime(v.currentTime)
      onTimeUpdate(v.currentTime)
    }
    const onMeta = (): void => setDuration(v.duration || 0)
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    const onError = (): void => setFailed(true)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('error', onError)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('loadedmetadata', onMeta)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('error', onError)
    }
  }, [videoRef, onTimeUpdate, src])

  useEffect(() => {
    setFailed(false)
  }, [src])

  const toggle = (): void => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play()
    else v.pause()
  }

  /** Đổi toạ độ chuột trên dải chọn thành giây trong video. */
  const timeAt = (clientX: number): number => {
    const el = stripRef.current
    if (!el || !duration) return 0
    const r = el.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
    return ratio * duration
  }

  // Kéo chuột ra ngoài dải rồi mới thả vẫn phải kết thúc được thao tác kéo,
  // nên bắt sự kiện ở cấp window chứ không phải trên chính dải chọn.
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!dragging.current) return
      setSel((cur) => (cur ? { ...cur, b: timeAt(e.clientX) } : cur))
    }
    const onUp = (): void => {
      dragging.current = false
      setSel((cur) => (cur && Math.abs(cur.b - cur.a) < 0.4 ? null : cur))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [duration])

  const selStart = sel ? Math.min(sel.a, sel.b) : 0
  const selEnd = sel ? Math.max(sel.a, sel.b) : 0

  const addRange = (a: number, b: number): void => {
    if (!onChangeSkipRanges) return
    const start = Math.max(0, Math.min(a, b))
    const end = Math.max(a, b)
    if (end - start < 0.3) return
    onChangeSkipRanges([
      ...skipRanges,
      { id: `skip_${Date.now().toString(36)}`, start, end }
    ])
  }

  const skip = (delta: number): void => {
    const v = videoRef.current
    if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta))
  }

  return (
    <div className="card overflow-hidden">
      <div className="relative bg-black aspect-video flex items-center justify-center">
        {src ? (
          <video
            ref={videoRef}
            src={src}
            className="w-full h-full"
            onClick={toggle}
            preload="metadata"
          />
        ) : (
          emptyState ?? (
            <div className="text-ink-500 flex flex-col items-center gap-2 text-[13px]">
              <Film size={26} />
              Chưa có video
            </div>
          )
        )}
        {failed && (
          <div className="absolute inset-0 bg-ink-950/85 flex items-center justify-center p-6 text-center">
            <p className="text-[12.5px] text-ink-300 leading-relaxed">
              Không phát được video này trong app (codec không được hỗ trợ).
              <br />
              Phần bóc băng và tóm tắt vẫn hoạt động bình thường.
            </p>
          </div>
        )}
      </div>

      <div className="px-3 py-2.5 border-t border-ink-800">
        {/* Thanh thời gian + vệt xám cho các đoạn sẽ bỏ qua khi bóc băng */}
        <div className="relative">
          {duration > 0 && skipRanges.length > 0 && (
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 pointer-events-none">
              {skipRanges.map((r) => (
                <div
                  key={r.id}
                  className="absolute h-full bg-ink-500/80 rounded-full"
                  style={{
                    left: `${(r.start / duration) * 100}%`,
                    width: `${Math.max(0.4, ((r.end - r.start) / duration) * 100)}%`
                  }}
                />
              ))}
            </div>
          )}
          {duration > 0 && markStart !== null && (
            <div
              className="absolute top-1/2 -translate-y-1/2 h-3 w-0.5 bg-amber-400 pointer-events-none"
              style={{ left: `${(markStart / duration) * 100}%` }}
            />
          )}
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            onChange={(e) => {
              const v = videoRef.current
              if (v) v.currentTime = Number(e.target.value)
            }}
            className="relative w-full h-1 accent-brand-500 cursor-pointer bg-transparent"
          />
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <button className="btn-ghost h-8 w-8 !px-0" onClick={() => skip(-5)} title="Lùi 5 giây">
            <RotateCcw size={15} />
          </button>
          <button className="btn-primary h-8 w-8 !px-0" onClick={toggle} title="Phát / Tạm dừng">
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button className="btn-ghost h-8 w-8 !px-0" onClick={() => skip(5)} title="Tiến 5 giây">
            <RotateCw size={15} />
          </button>
          <span className="ml-1 text-[12px] text-ink-300 font-mono tabular-nums">
            {formatTime(time)} <span className="text-ink-600">/</span> {formatTime(duration)}
          </span>
          <div className="grow" />
          <select
            className="h-8 px-2 rounded-lg bg-ink-850 border border-ink-700 text-[12px] text-ink-200 outline-none"
            value={speed}
            onChange={(e) => {
              const s = Number(e.target.value)
              setSpeed(s)
              if (videoRef.current) videoRef.current.playbackRate = s
            }}
            title="Tốc độ phát"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
          <button
            className="btn-ghost h-8 w-8 !px-0"
            onClick={() => {
              const v = videoRef.current
              if (!v) return
              v.muted = !v.muted
              setMuted(v.muted)
            }}
            title="Tắt / Bật tiếng"
          >
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
        </div>

        {(onChangeSkipRanges || onRedoRange) && src && duration > 0 && (
          <div className="mt-2">
            {/* Dải kéo chọn RIÊNG, không nằm chung với thanh tua — nếu chung thì
                kéo chọn sẽ thành tua video, hai thao tác đá nhau. */}
            <div
              ref={stripRef}
              className="relative h-6 rounded-md bg-ink-850/70 border border-ink-800 cursor-crosshair select-none overflow-hidden"
              title="Kéo ngang để chọn một khoảng"
              onMouseDown={(e) => {
                const t = timeAt(e.clientX)
                dragging.current = true
                setSel({ a: t, b: t })
              }}
            >
              {skipRanges.map((r) => (
                <div
                  key={r.id}
                  className="absolute inset-y-0 bg-ink-600/50"
                  style={{
                    left: `${(r.start / duration) * 100}%`,
                    width: `${Math.max(0.3, ((r.end - r.start) / duration) * 100)}%`
                  }}
                />
              ))}
              {sel && (
                <div
                  className="absolute inset-y-0 bg-amber-400/30 border-x-2 border-amber-400"
                  style={{
                    left: `${(selStart / duration) * 100}%`,
                    width: `${Math.max(0.3, ((selEnd - selStart) / duration) * 100)}%`
                  }}
                />
              )}
              <div
                className="absolute inset-y-0 w-px bg-brand-400"
                style={{ left: `${(time / duration) * 100}%` }}
              />
              {!sel && (
                <span className="absolute inset-0 flex items-center justify-center text-[11px] text-ink-500 pointer-events-none">
                  Kéo ngang để chọn một khoảng
                </span>
              )}
            </div>

            {sel && selEnd - selStart >= 0.4 && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="text-[12px] font-mono tabular-nums text-amber-300">
                  {formatTime(selStart)}–{formatTime(selEnd)}
                  <span className="text-ink-500 ml-1.5">({formatTime(selEnd - selStart)})</span>
                </span>
                <button
                  className="btn-ghost h-7 text-[12px]"
                  onClick={() => {
                    const v = videoRef.current
                    if (v) {
                      v.currentTime = selStart
                      void v.play()
                    }
                  }}
                >
                  Nghe thử
                </button>
                <span className="grow" />
                {onRedoRange && (
                  <button
                    className="btn-primary h-7 text-[12px]"
                    onClick={() => {
                      onRedoRange(selStart, selEnd)
                      setSel(null)
                    }}
                    title="Chỉ bóc băng lại đoạn này, phần còn lại của biên bản giữ nguyên"
                  >
                    <Mic size={13} />
                    Bóc lại đoạn này
                  </button>
                )}
                {onChangeSkipRanges && (
                  <button
                    className="btn-outline h-7 text-[12px]"
                    onClick={() => {
                      addRange(selStart, selEnd)
                      setSel(null)
                    }}
                    title="Đánh dấu bỏ qua đoạn này ở lần bóc băng sau"
                  >
                    <Scissors size={13} />
                    Bỏ qua
                  </button>
                )}
                <button className="btn-ghost h-7 !px-2" onClick={() => setSel(null)} title="Bỏ chọn">
                  <X size={13} />
                </button>
              </div>
            )}
          </div>
        )}

        {onChangeSkipRanges && src && (
          <div className="mt-2.5 pt-2.5 border-t border-ink-800/70">
            <div className="flex items-center gap-2 flex-wrap">
              <Scissors size={13} className="text-ink-400 shrink-0" />
              {markStart === null ? (
                <button
                  className="btn-ghost h-7 text-[12px]"
                  onClick={() => setMarkStart(time)}
                  title="Đánh dấu chỗ bắt đầu đoạn cần bỏ qua khi bóc băng"
                >
                  Đầu đoạn bỏ qua
                </button>
              ) : (
                <>
                  <span className="text-[12px] text-amber-300 font-mono tabular-nums">
                    từ {formatTime(markStart)}
                  </span>
                  <button
                    className="btn-outline h-7 text-[12px]"
                    onClick={() => {
                      addRange(markStart, time)
                      setMarkStart(null)
                    }}
                    disabled={time - markStart < 0.3}
                    title="Kết thúc đoạn tại vị trí đang xem"
                  >
                    Cuối đoạn tại {formatTime(time)}
                  </button>
                  <button className="btn-ghost h-7 !px-2" onClick={() => setMarkStart(null)} title="Huỷ đánh dấu">
                    <X size={13} />
                  </button>
                </>
              )}
              <span className="grow" />
              {skipRanges.length > 0 && (
                <span className="text-[11.5px] text-ink-400">
                  bỏ qua {formatTime(skipRanges.reduce((t, r) => t + (r.end - r.start), 0))}
                </span>
              )}
            </div>

            {skipRanges.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {skipRanges.map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-ink-850 border border-ink-700 pl-2.5 pr-1 py-0.5 text-[11.5px] font-mono tabular-nums"
                  >
                    <button
                      className="text-ink-200 hover:text-brand-300"
                      onClick={() => {
                        const v = videoRef.current
                        if (v) v.currentTime = r.start
                      }}
                      title="Tua tới đầu đoạn này"
                    >
                      {formatTime(r.start)}–{formatTime(r.end)}
                    </button>
                    <button
                      className="text-ink-500 hover:text-red-300 p-0.5"
                      onClick={() => onChangeSkipRanges(skipRanges.filter((x) => x.id !== r.id))}
                      title="Bỏ đánh dấu đoạn này"
                    >
                      <Trash2 size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Chỉ giải thích khi đã có đoạn bị cắt. Chiều cao cột này là chỗ
                dùng cho danh sách người nói, họp 12 người là chật ngay. */}
            {skipRanges.length > 0 && (
              <p className="hint mt-1.5">
                Đoạn xám bị bỏ qua ở lần <b>bóc băng sau</b>; mốc thời gian các câu còn lại không đổi.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
