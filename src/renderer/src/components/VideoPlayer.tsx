import { RefObject, useEffect, useState } from 'react'
import { Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX, Film } from 'lucide-react'
import { formatTime } from '../lib/format'

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]

export default function VideoPlayer({
  videoRef,
  src,
  onTimeUpdate
}: {
  videoRef: RefObject<HTMLVideoElement>
  src: string
  onTimeUpdate: (t: number) => void
}): JSX.Element {
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
          <div className="text-ink-500 flex flex-col items-center gap-2 text-[13px]">
            <Film size={26} />
            Chưa có video
          </div>
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
          className="w-full h-1 accent-brand-500 cursor-pointer"
        />
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
      </div>
    </div>
  )
}
