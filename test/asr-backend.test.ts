import { describe, expect, it } from 'vitest'
import { asrBackend, buildInitialPrompt } from '../src/main/lib/localEngine'
import { defaultSettings } from '../src/main/lib/defaults'
import type { Settings } from '../src/shared/types'

const s = (over: Partial<Settings> = {}): Settings => ({ ...defaultSettings(), ...over })

describe('asrBackend — chọn backend local', () => {
  it('mặc định vẫn là faster-whisper, không đổi hành vi của người đang dùng', () => {
    expect(asrBackend(defaultSettings())).toBe('faster-whisper')
  })

  it('chọn vibevoice thì dùng vibevoice', () => {
    expect(asrBackend(s({ localAsr: 'vibevoice' }))).toBe('vibevoice')
  })

  it('whisper.cpp vẫn đi đường faster-whisper cho phần pyannote', () => {
    expect(asrBackend(s({ localAsr: 'whispercpp' }))).toBe('faster-whisper')
  })
})

describe('buildInitialPrompt — mồi bối cảnh, không chỉ danh sách từ', () => {
  it('có bối cảnh thì đặt trước danh sách thuật ngữ', () => {
    const out = buildInitialPrompt(
      s({ meetingContext: 'Họp sản phẩm MaiMoney về eKYC.', glossary: 'KYC, onboarding' }),
      []
    )
    expect(out.startsWith('Họp sản phẩm MaiMoney về eKYC.')).toBe(true)
    expect(out).toContain('KYC, onboarding')
  })

  it('chỉ có bối cảnh, không có thuật ngữ, thì vẫn mồi được', () => {
    const out = buildInitialPrompt(s({ meetingContext: 'Họp review quý 3.', glossary: '' }), [])
    expect(out).toBe('Họp review quý 3.')
  })

  it('chỉ có thuật ngữ thì giữ nguyên như cũ', () => {
    const out = buildInitialPrompt(s({ glossary: 'KYC' }), [])
    expect(out).toContain('Cuộc họp có các tên riêng và thuật ngữ sau: KYC.')
  })

  it('không điền gì thì trả rỗng, để không mồi nhầm', () => {
    expect(buildInitialPrompt(s(), [])).toBe('')
  })

  it('bối cảnh dài bị cắt để không nuốt mất chỗ của thuật ngữ', () => {
    const out = buildInitialPrompt(s({ meetingContext: 'x'.repeat(2000), glossary: 'KYC' }), [])
    expect(out.length).toBeLessThan(900)
    expect(out).toContain('KYC')
  })

  it('bối cảnh nhiều dòng được ép về một dòng', () => {
    const out = buildInitialPrompt(s({ meetingContext: 'Dòng một.\n\n  Dòng hai.' }), [])
    expect(out).toBe('Dòng một. Dòng hai.')
  })

  it('vẫn ghép tên người trong danh bạ như trước', () => {
    const out = buildInitialPrompt(s({ meetingContext: 'Họp tuần.', glossary: 'KYC' }), ['Quỳnh', 'user_3'])
    expect(out).toContain('Quỳnh')
    expect(out).not.toContain('user_3')
  })
})
