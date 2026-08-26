import { Modal } from './Ui'

/** macOS quen ⌘, còn lại dùng Ctrl. */
const mod =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? '⌘'
    : 'Ctrl'

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Xem lại video',
    items: [
      ['Space', 'Phát / dừng'],
      ['K', 'Phát / dừng (kiểu trình dựng phim)'],
      ['J / L', 'Lùi / tiến 5 giây'],
      ['← / →', 'Lùi / tiến 2 giây'],
      ['1 … 9', 'Nhảy tới 10% … 90% thời lượng']
    ]
  },
  {
    title: 'Đi trong hội thoại',
    items: [
      ['N / P', 'Lượt nói sau / trước (video tua theo)'],
      ['E', 'Sửa nội dung lượt đang phát'],
      [`${mod}+F`, 'Nhảy vào ô tìm kiếm trong cuộc họp này'],
      [`${mod}+H`, 'Mở thanh tìm & thay thế'],
      [`${mod}+Shift+F`, 'Tìm trong TẤT CẢ cuộc họp'],
      [`${mod}+Z`, 'Hoàn tác thao tác sửa tay gần nhất']
    ]
  },
  {
    title: 'Khác',
    items: [
      [`${mod}+S`, 'Lưu ghi chú đang gõ (ở tab Ghi chú)'],
      ['?', 'Bảng phím tắt này'],
      ['Esc', 'Đóng hộp thoại / huỷ đang sửa']
    ]
  }
]

export default function ShortcutsDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element {
  return (
    <Modal
      open={open}
      title="Phím tắt"
      subtitle="Soát lại bản bóc băng bằng bàn phím nhanh hơn nhiều so với dùng chuột."
      onClose={onClose}
      width="max-w-xl"
      footer={
        <button className="btn-primary" onClick={onClose}>
          Đóng
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-400 mb-2 pb-1.5 border-b border-ink-800">
              {g.title}
            </h3>
            <div className="flex flex-col gap-1.5">
              {g.items.map(([key, desc]) => (
                <div key={key} className="flex items-center gap-3 text-[13px]">
                  <kbd className="shrink-0 min-w-[74px] text-center font-mono text-[11.5px] px-2 py-1 rounded border border-ink-700 border-b-2 bg-ink-850 text-ink-200">
                    {key}
                  </kbd>
                  <span className="text-ink-200">{desc}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="hint mt-5">
        Phím tắt bị bỏ qua khi con trỏ đang ở trong ô nhập chữ — cứ gõ tiếp bình thường.
      </p>
    </Modal>
  )
}
