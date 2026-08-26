import { AlertTriangle, Terminal } from 'lucide-react'

/** Hiện khi trang được mở bằng browser thường thay vì cửa sổ Electron. */
export default function NoBridgeNotice(): JSX.Element {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="card max-w-xl p-6">
        <div className="flex items-center gap-2.5 mb-3">
          <span className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} className="text-amber-400" />
          </span>
          <h1 className="text-[16px] font-semibold">Bạn đang mở MeetSum bằng browser</h1>
        </div>

        <p className="text-[13.5px] text-ink-200 leading-relaxed">
          MeetSum là ứng dụng desktop. Trang này chỉ là phần giao diện — nó cần cửa sổ Electron để đọc file, chạy
          ffmpeg và gọi AI. Mở bằng Chrome/Edge thì các chức năng đó không tồn tại.
        </p>

        <div className="mt-4 rounded-lg border border-ink-800 bg-ink-850/60 p-3.5">
          <div className="flex items-center gap-2 mb-2 text-[12px] font-semibold uppercase tracking-wider text-ink-400">
            <Terminal size={13} />
            Cách chạy đúng
          </div>
          <ol className="space-y-2 text-[13px] text-ink-200">
            <li>
              <span className="text-ink-400 mr-1.5">1.</span>Đóng tab browser này.
            </li>
            <li>
              <span className="text-ink-400 mr-1.5">2.</span>Trong terminal, tại thư mục dự án chạy{' '}
              <code className="px-1.5 py-0.5 rounded bg-ink-900 border border-ink-700 text-brand-200">npm run dev</code>
              .
            </li>
            <li>
              <span className="text-ink-400 mr-1.5">3.</span>Một cửa sổ tên <b>MeetSum</b> sẽ tự mở ra. Làm việc trong
              cửa sổ đó (không mở địa chỉ localhost bằng browser).
            </li>
          </ol>
        </div>

        <p className="hint mt-3.5">
          Nếu chạy <code className="text-ink-300">npm run dev</code> mà không thấy cửa sổ nào mở, hãy xem log trong
          terminal — thường là Electron chưa tải xong binary. Chạy lại{' '}
          <code className="text-ink-300">npm install</code> rồi thử lại. Muốn dùng bản đã đóng gói:{' '}
          <code className="text-ink-300">npm run build:win</code> hoặc{' '}
          <code className="text-ink-300">npm run build:mac</code>.
        </p>
      </div>
    </div>
  )
}
