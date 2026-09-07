import { describe, expect, it } from 'vitest'
import { audioFilterChain } from '../src/main/lib/ffmpeg'

describe('audioFilterChain', () => {
  it('mặc định KHÔNG có dynaudnorm — nó cũng khuếch đại tiếng ồn nền', () => {
    const f = audioFilterChain(false)
    expect(f).not.toContain('dynaudnorm')
    expect(f).toContain('loudnorm')
  })

  it('bật thì có dynaudnorm, và đặt TRƯỚC loudnorm', () => {
    const f = audioFilterChain(true)
    expect(f).toContain('dynaudnorm')
    // Kéo đoạn nhỏ lên trước, rồi mới chuẩn hoá mức chung — ngược lại thì vô nghĩa
    expect(f.indexOf('dynaudnorm')).toBeLessThan(f.indexOf('loudnorm'))
  })

  it('chặn mức khuếch đại tối đa để tiếng ồn không nổ tung', () => {
    expect(audioFilterChain(true)).toMatch(/dynaudnorm[^,]*m=12/)
  })

  it('luôn giữ lọc tần số cho giọng người', () => {
    for (const f of [audioFilterChain(true), audioFilterChain(false)]) {
      expect(f).toContain('highpass=f=70')
      expect(f).toContain('lowpass=f=7800')
    }
  })

  it('hai chế độ cho ra chuỗi KHÁC nhau — đây là thứ dùng để biết có phải tách lại audio không', () => {
    expect(audioFilterChain(true)).not.toBe(audioFilterChain(false))
  })
})
