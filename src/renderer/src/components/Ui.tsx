import { ReactNode, useEffect } from 'react'
import { X } from 'lucide-react'

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 'max-w-2xl'
}: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${width} card shadow-card animate-in flex flex-col max-h-[86vh]`}>
        <header className="flex items-start justify-between gap-4 px-5 py-4 border-b border-ink-800">
          <div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {subtitle && <p className="hint mt-0.5">{subtitle}</p>}
          </div>
          <button className="btn-ghost h-8 w-8 !px-0 shrink-0" onClick={onClose} title="Đóng">
            <X size={16} />
          </button>
        </header>
        <div className="px-5 py-4 overflow-y-auto grow">{children}</div>
        {footer && <footer className="px-5 py-3.5 border-t border-ink-800 flex justify-end gap-2">{footer}</footer>}
      </div>
    </div>
  )
}

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="mb-4">
      <label className="label">{label}</label>
      {children}
      {hint && <p className="hint mt-1.5">{hint}</p>}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 w-full text-left group mb-4"
    >
      <span
        className={`mt-0.5 relative w-9 h-5 rounded-full transition-colors shrink-0 ${
          checked ? 'bg-brand-600' : 'bg-ink-700'
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </span>
      <span>
        <span className="block text-[13px] font-medium text-ink-100 group-hover:text-white">{label}</span>
        {hint && <span className="hint block mt-0.5">{hint}</span>}
      </span>
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className="inline-flex p-1 rounded-lg bg-ink-850 border border-ink-700 gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 h-7 rounded-md text-[12.5px] font-medium transition-colors ${
            value === o.value ? 'bg-brand-600 text-white' : 'text-ink-300 hover:text-ink-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }): JSX.Element {
  return (
    <span
      className={`inline-block rounded-full border-2 border-white/25 border-t-white animate-spin ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

export function Toast({
  message,
  tone,
  onClose
}: {
  message: string
  tone: 'ok' | 'err' | 'info'
  onClose?: () => void
}): JSX.Element {
  const tones = {
    ok: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200',
    err: 'bg-red-500/15 border-red-500/40 text-red-200',
    info: 'bg-brand-500/15 border-brand-500/40 text-brand-200'
  }
  return (
    <div
      className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] max-w-2xl max-h-[52vh] overflow-y-auto
                  pl-4 pr-10 py-2.5 rounded-lg border text-[13px] leading-relaxed whitespace-pre-line
                  shadow-card animate-in backdrop-blur-sm ${tones[tone]}`}
    >
      {message}
      {onClose && (
        <button
          className="absolute top-2 right-2 opacity-60 hover:opacity-100"
          onClick={onClose}
          title="Đóng"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
