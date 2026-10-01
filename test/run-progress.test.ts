import { describe, expect, it } from 'vitest'
import { isActiveStage, isRunStarting } from '../src/shared/runProgress'

describe('isActiveStage', () => {
  it.each(['extracting', 'transcribing', 'diarizing'] as const)('%s là đang chạy', (s) => {
    expect(isActiveStage(s)).toBe(true)
  })
  it.each(['ready', 'done', 'error', 'paused'] as const)('%s là không chạy', (s) => {
    expect(isActiveStage(s)).toBe(false)
  })
})

describe('isRunStarting — lúc nào phải tải lại cuộc họp để xoá lỗi cũ', () => {
  it('lần chạy đầu tiên từ khi mở app', () => {
    expect(isRunStarting(undefined, 'extracting')).toBe(true)
  })
  it('chạy lại sau khi lỗi', () => {
    expect(isRunStarting('error', 'extracting')).toBe(true)
  })
  it('tiếp tục sau khi tạm dừng', () => {
    expect(isRunStarting('paused', 'transcribing')).toBe(true)
  })
  it('đang chạy mà nhận thêm tiến độ thì KHÔNG tải lại (tránh gọi IPC mỗi lần nhích %)', () => {
    expect(isRunStarting('extracting', 'extracting')).toBe(false)
    expect(isRunStarting('extracting', 'transcribing')).toBe(false)
  })
  it('sự kiện kết thúc không phải là bắt đầu', () => {
    expect(isRunStarting('transcribing', 'error')).toBe(false)
  })
})
