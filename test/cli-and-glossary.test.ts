import { describe, expect, it } from 'vitest'
import { buildArgs } from '../src/main/lib/cliAgent'
import { buildInitialPrompt } from '../src/main/lib/localEngine'
import { defaultCliProviders, defaultSettings } from '../src/main/lib/defaults'

const vars = {
  prompt: 'HUONG_DAN',
  model: '',
  doc: 'TAI_LIEU',
  docfile: '/tmp/doc.txt',
  outfile: '/tmp/out.txt'
}

describe('buildArgs — dựng dòng lệnh cho CLI agent', () => {
  it('thay đúng các chỗ giữ chỗ', () => {
    const out = buildArgs(['-p', '{prompt}', '--out', '{outfile}'], { ...vars, model: 'sonnet' })
    expect(out).toEqual(['-p', 'HUONG_DAN', '--out', '/tmp/out.txt'])
  })

  it('model rỗng thì bỏ cả token và cờ đứng trước nó', () => {
    const out = buildArgs(['-p', '{prompt}', '-m', '{model}'], vars)
    expect(out).toEqual(['-p', 'HUONG_DAN'])
  })

  it('cờ dạng --model={model} thì chỉ bỏ chính token đó', () => {
    const out = buildArgs(['-p', '{prompt}', '-s', '--model={model}'], vars)
    expect(out).toEqual(['-p', 'HUONG_DAN', '-s'])
  })

  it('không xoá lây cờ không liên quan đứng trước', () => {
    const out = buildArgs(['--json', '-m', '{model}', '{prompt}'], vars)
    expect(out).toEqual(['--json', 'HUONG_DAN'])
  })

  it('mọi preset có sẵn đều dựng được dòng lệnh, cả khi bỏ trống model', () => {
    for (const cfg of Object.values(defaultCliProviders())) {
      if (!cfg.bin) continue
      const withModel = buildArgs(cfg.args, { ...vars, model: 'X' })
      const without = buildArgs(cfg.args, vars)
      expect(withModel.join(' ')).toContain('HUONG_DAN')
      expect(without.join(' ')).toContain('HUONG_DAN')
      expect(without.join(' ')).not.toContain('{model}')
      expect(without.length).toBeLessThanOrEqual(withModel.length)
    }
  })
})

describe('buildInitialPrompt — mồi thuật ngữ cho ASR', () => {
  it('chưa điền gì thì trả rỗng, để không mồi nhầm', () => {
    expect(buildInitialPrompt(defaultSettings(), [])).toBe('')
  })

  it('tách theo dấu phẩy, chấm phẩy và xuống dòng', () => {
    const s = { ...defaultSettings(), glossary: 'MaiMoney, KYC\nonboarding; e-wallet' }
    const out = buildInitialPrompt(s, [])
    expect(out).toContain('MaiMoney, KYC, onboarding, e-wallet')
  })

  it('ghép tên người trong danh bạ nhưng bỏ user_n', () => {
    const s = { ...defaultSettings(), glossary: 'KYC' }
    const out = buildInitialPrompt(s, ['Quỳnh', 'user_3', 'Tuấn'])
    expect(out).toContain('Quỳnh')
    expect(out).toContain('Tuấn')
    expect(out).not.toContain('user_3')
  })

  it('không lặp lại từ đã có trong từ điển', () => {
    const s = { ...defaultSettings(), glossary: 'Quỳnh' }
    const out = buildInitialPrompt(s, ['Quỳnh'])
    expect(out.match(/Quỳnh/g)).toHaveLength(1)
  })

  it('tắt công tắc thì không ghép tên người', () => {
    const s = { ...defaultSettings(), glossary: 'KYC', glossaryIncludeSpeakers: false }
    expect(buildInitialPrompt(s, ['Quỳnh'])).not.toContain('Quỳnh')
  })

  it('chặn ở 60 từ để không tràn cửa sổ ngữ cảnh của model', () => {
    const many = Array.from({ length: 200 }, (_, i) => `tu${i}`).join(', ')
    const out = buildInitialPrompt({ ...defaultSettings(), glossary: many }, [])
    expect(out.split(',').length).toBeLessThanOrEqual(60)
  })
})
