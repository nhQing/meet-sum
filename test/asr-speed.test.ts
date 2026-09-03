import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { defaultSettings } from '../src/main/lib/defaults'
import { loadSettings, saveSettings } from '../src/main/lib/store'

// Cùng đường dẫn mà bản electron giả trong test/stubs trả về
const dataRoot = join(tmpdir(), 'meetsum-test', 'MeetSumData')
const settingsFile = join(dataRoot, 'settings.json')

// Không dọn thì cài đặt của test trước rớt sang test sau và kết quả tùy thứ tự chạy
beforeEach(() => {
  mkdirSync(dataRoot, { recursive: true })
  if (existsSync(settingsFile)) rmSync(settingsFile)
})

describe('cấu hình tăng tốc bóc băng', () => {
  it('mặc định: 0 luồng = dùng hết số nhân, không phải 4 như faster-whisper', () => {
    expect(defaultSettings().asrThreads).toBe(0)
    expect(loadSettings().asrThreads).toBe(0)
  })

  it('mặc định bật chia lô 8 khúc', () => {
    expect(defaultSettings().asrBatchSize).toBe(8)
    expect(loadSettings().asrBatchSize).toBe(8)
  })

  it('settings.json của bản cũ thiếu hai trường này thì được vá mặc định, không thành undefined', () => {
    // Người đã cài bản trước sẽ có file thiếu asrThreads/asrBatchSize. Nếu merge
    // hỏng thì tham số truyền xuống python thành chuỗi "undefined".
    writeFileSync(settingsFile, JSON.stringify({ engine: 'local', fwModelSize: 'medium' }), 'utf-8')
    const back = loadSettings()
    expect(back.asrThreads).toBe(0)
    expect(back.asrBatchSize).toBe(8)
    expect(back.fwModelSize).toBe('medium')
    expect(String(back.asrThreads)).not.toBe('undefined')
    expect(String(back.asrBatchSize)).not.toBe('undefined')
  })

  it('lưu được giá trị người dùng tự chọn', () => {
    saveSettings({ asrThreads: 12, asrBatchSize: 4 })
    const back = loadSettings()
    expect(back.asrThreads).toBe(12)
    expect(back.asrBatchSize).toBe(4)
  })

  it('tắt chia lô bằng 0 vẫn lưu được, không bị hiểu là chưa đặt', () => {
    saveSettings({ asrBatchSize: 0 })
    expect(loadSettings().asrBatchSize).toBe(0)
  })
})
