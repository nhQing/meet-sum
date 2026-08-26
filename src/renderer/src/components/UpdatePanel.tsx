import { useEffect, useState } from 'react'
import { ArrowUpCircle, CheckCircle2, Download, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react'
import type { Settings } from '../../../shared/types'
import type { UpdateState } from '../../../preload'
import { Field, Spinner, Toggle } from './Ui'

/**
 * Tab Cập nhật trong Cài đặt.
 *
 * Trên Windows app tự tải và cài được. Trên macOS bản không ký không thể tự cài
 * (Squirrel bắt buộc Developer ID), nên chỉ báo có bản mới và mở trang release.
 */
export default function UpdatePanel({
  draft,
  set
}: {
  draft: Settings
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
}): JSX.Element {
  const [st, setSt] = useState<UpdateState | null>(null)

  useEffect(() => {
    void window.api.update.state().then(setSt)
    return window.api.update.onState(setSt)
  }, [])

  const busy = Boolean(st?.checking || st?.downloading)

  return (
    <div>
      <Toggle
        checked={draft.autoUpdateCheck}
        onChange={(v) => set('autoUpdateCheck', v)}
        label="Tự kiểm tra bản mới khi mở app"
        hint="Chỉ kiểm tra rồi báo, không bao giờ tự tải — để không ngốn mạng lúc đang bóc băng."
      />

      <Field
        label="GitHub token (chỉ khi repo phát hành ở chế độ riêng tư)"
        hint="Token chỉ cần quyền đọc repo. Được mã hoá bằng Keychain (macOS) / DPAPI (Windows) trước khi lưu xuống file."
      >
        <input
          className="input"
          type="password"
          placeholder="ghp_… (để trống nếu repo công khai)"
          value={draft.updateToken}
          onChange={(e) => set('updateToken', e.target.value)}
        />
      </Field>

      <div className="rounded-xl border border-ink-800 bg-ink-850/50 p-3.5">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div>
            <div className="text-[13px] font-medium">Phiên bản đang dùng {st?.current ?? '—'}</div>
            {st?.checkedAt && (
              <div className="hint">Kiểm tra lần cuối: {new Date(st.checkedAt).toLocaleString('vi-VN')}</div>
            )}
          </div>
          <button
            className="btn-ghost shrink-0"
            disabled={busy}
            onClick={() => void window.api.update.check()}
          >
            {st?.checking ? <Spinner size={13} /> : <RefreshCw size={13} />}
            Kiểm tra ngay
          </button>
        </div>

        {st?.skipped && <p className="hint">{st.skipped}</p>}

        {st?.error && (
          <p className="text-[12.5px] text-amber-300 flex items-start gap-1.5">
            <TriangleAlert size={13} className="shrink-0 mt-0.5" />
            <span className="whitespace-pre-line">{st.error}</span>
          </p>
        )}

        {st && !st.error && !st.skipped && st.latest && !st.available && (
          <p className="text-[12.5px] text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 size={13} />
            Đang dùng bản mới nhất.
          </p>
        )}

        {st?.available && (
          <div>
            <p className="text-[13px] text-brand-200 flex items-center gap-1.5 mb-1.5">
              <ArrowUpCircle size={14} />
              Có bản mới {st.latest}
            </p>
            {st.notes && (
              <p className="hint mb-2.5 max-h-24 overflow-y-auto whitespace-pre-line">{st.notes}</p>
            )}

            {st.downloading && (
              <div className="mb-2.5">
                <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden">
                  <div
                    className="h-full bg-brand-500 transition-[width]"
                    style={{ width: `${Math.max(2, st.percent)}%` }}
                  />
                </div>
                <p className="hint mt-1">Đang tải… {st.percent}%</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {st.canInstall && !st.downloaded && (
                <button
                  className="btn-primary"
                  disabled={st.downloading}
                  onClick={() => void window.api.update.download()}
                >
                  <Download size={13} />
                  Tải bản mới
                </button>
              )}
              {st.canInstall && st.downloaded && (
                <button className="btn-primary" onClick={() => void window.api.update.install()}>
                  <ArrowUpCircle size={13} />
                  Cài và mở lại app
                </button>
              )}
              <button className="btn-ghost" onClick={() => void window.api.update.openReleases()}>
                <ExternalLink size={13} />
                Mở trang tải về
              </button>
            </div>

            {!st.canInstall && (
              <p className="hint mt-2">
                Bản macOS không được ký bằng Developer ID nên không tự cài được. Hãy tải file .dmg ở trang
                trên rồi kéo vào Applications như lần đầu.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
