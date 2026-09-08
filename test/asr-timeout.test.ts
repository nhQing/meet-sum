import { describe, expect, it } from 'vitest'
import { asrTimeout, vibevoiceDeviceProblem } from '../src/main/lib/localEngine'
import type { PythonInfo } from '../src/main/lib/localEngine'

const info = (over: Partial<PythonInfo> = {}): PythonInfo => ({
  python: '3.14.0',
  torch: true,
  vibevoice: true,
  cuda: true,
  torch_version: '2.13.0+cu124',
  ...over
})

describe('vibevoiceDeviceProblem — chặn trước khi mất hàng giờ', () => {
  it('có CUDA thì cho chạy', () => {
    expect(vibevoiceDeviceProblem(info(), 'auto')).toBeNull()
    expect(vibevoiceDeviceProblem(info(), 'cuda')).toBeNull()
  })

  it('torch bản CPU-only thì chặn, và nói rõ đó là bản CPU-only', () => {
    // Đúng cấu hình đã làm mất 6 giờ: torch 2.13.0+cpu, không thấy GPU
    const msg = vibevoiceDeviceProblem(info({ cuda: false, torch_version: '2.13.0+cpu' }), 'auto')
    expect(msg).toBeTruthy()
    expect(msg).toContain('CPU-only')
    expect(msg).toContain('2.13.0+cpu')
    // Phải chỉ đường ra, không chỉ báo lỗi
    expect(msg).toContain('faster-whisper')
  })

  it('có torch nhưng không thấy GPU thì vẫn chặn', () => {
    const msg = vibevoiceDeviceProblem(info({ cuda: false, torch_version: '2.13.0' }), 'auto')
    expect(msg).toBeTruthy()
    expect(msg).not.toContain('CPU-only')
  })

  it('người dùng tự chọn CPU thì vẫn chặn — kể cả máy có GPU', () => {
    // Chọn tay không làm cho việc chạy 16 GB model trên CPU khả thi hơn
    expect(vibevoiceDeviceProblem(info({ cuda: true }), 'cpu')).toBeTruthy()
  })

  it('chưa cài torch thì để assertLibraries báo, không chèn lỗi thiết bị lên trước', () => {
    expect(vibevoiceDeviceProblem(info({ torch: false, cuda: undefined }), 'auto')).toBeNull()
  })

  it('không dò được python thì không phán gì', () => {
    expect(vibevoiceDeviceProblem(null, 'auto')).toBeNull()
  })
})

describe('asrTimeout — hạn chót theo độ dài video, không phải hằng số 6 giờ', () => {
  it('video 90 phút trên CPU được hạn rộng hơn hằng số 6 giờ cũ', () => {
    // Chính là ca đã bị giết oan lúc đang chạy bình thường
    const { timeoutMs } = asrTimeout(5413, false)
    expect(timeoutMs).toBeGreaterThan(1000 * 60 * 60 * 6)
  })

  it('video ngắn không bị kẹp xuống quá thấp — lần đầu còn phải tải model', () => {
    const { timeoutMs } = asrTimeout(60, false)
    expect(timeoutMs).toBe(1000 * 60 * 90)
  })

  it('có GPU thì hạn ngắn hơn cùng độ dài video', () => {
    expect(asrTimeout(20000, true).timeoutMs).toBeLessThan(asrTimeout(20000, false).timeoutMs)
  })

  it('video dài bất thường vẫn bị kẹp trần, không thành vô hạn', () => {
    expect(asrTimeout(10 ** 9, false).timeoutMs).toBe(1000 * 60 * 60 * 36)
  })

  it('không biết độ dài thì rơi về mức sàn chứ không thành 0', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(asrTimeout(bad, false).timeoutMs).toBe(1000 * 60 * 90)
    }
  })

  it('hạn im lặng cố định 20 phút — đủ rộng cho lúc nạp model vài GB', () => {
    expect(asrTimeout(5413, false).idleTimeoutMs).toBe(1000 * 60 * 20)
    expect(asrTimeout(0, true).idleTimeoutMs).toBe(1000 * 60 * 20)
  })
})
