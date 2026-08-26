import { describe, expect, it } from 'vitest'
import { toPlainText, toSubtitle, toMarkdown } from '../src/main/lib/exporters'
import type { Project } from '../src/shared/types'

const project: Project = {
  id: 'p1',
  name: 'Hop review Q3',
  videoPath: '/x.mp4',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  status: 'ready',
  durationSec: 3725.5,
  speakers: [
    { id: 'a', name: 'Quỳnh', named: true, color: '#fff' },
    { id: 'b', name: 'Tuấn', named: true, color: '#fff' }
  ],
  segments: [
    { id: 's1', start: 0, end: 4.25, speakerId: 'a', text: 'Doanh thu tăng 18%.' },
    { id: 's2', start: 4.25, end: 9, speakerId: 'a', text: 'Chủ yếu từ kênh app.' },
    { id: 's3', start: 9, end: 3661.75, speakerId: 'b', text: 'Chi phí marketing cũng tăng.' }
  ],
  notes: 'Ghi chú riêng của tôi',
  summary: {
    title: 'Review Q3',
    oneLiner: 'Doanh thu tăng, chi phí cũng tăng.',
    language: 'vi',
    participants: [{ name: 'Quỳnh', role: 'PM', contribution: 'chủ trì' }],
    sections: [{ title: 'Doanh thu', body: 'Tăng 18%', bullets: ['kênh app dẫn đầu'] }],
    decisions: ['Chốt tăng ngân sách 150 triệu'],
    actionItems: [{ owner: 'Tuấn', task: 'Làm proposal', due: 'Thứ Sáu' }],
    openQuestions: ['Chi phí server tăng 30% vì sao?'],
    keywords: ['doanh thu', 'marketing'],
    generatedAt: '2026-08-01T01:00:00.000Z',
    provider: 'test',
    model: 'test'
  }
}

describe('toSubtitle', () => {
  it('SRT có số thứ tự, dấu phẩy ở phần milli giây, và tên người nói', () => {
    const srt = toSubtitle(project, 'srt')
    expect(srt.startsWith('1\n')).toBe(true)
    expect(srt).toContain('00:00:00,000 --> 00:00:04,250')
    expect(srt).toContain('[Quỳnh] Doanh thu tăng 18%.')
    expect(srt.split('\n\n')).toHaveLength(3)
  })

  it('VTT có header WEBVTT, không số thứ tự, dùng dấu chấm', () => {
    const vtt = toSubtitle(project, 'vtt')
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    expect(vtt).toContain('00:00:00.000 --> 00:00:04.250')
    expect(vtt).not.toMatch(/^\d+$/m)
  })

  it('mốc thời gian quá 1 tiếng vẫn đúng giờ', () => {
    const srt = toSubtitle(project, 'srt')
    expect(srt).toContain('01:01:01,750')
  })
})

describe('toPlainText', () => {
  it('gộp các lượt liền nhau của cùng một người khi không in mốc thời gian', () => {
    const txt = toPlainText(project, false)
    expect(txt.split('\n')).toHaveLength(2)
    expect(txt).toContain('Quỳnh: Doanh thu tăng 18%. Chủ yếu từ kênh app.')
  })

  it('có mốc thời gian thì giữ từng lượt riêng', () => {
    const txt = toPlainText(project, true)
    expect(txt.split('\n')).toHaveLength(3)
    expect(txt).toContain('[00:00:00] Quỳnh:')
  })
})

describe('toMarkdown', () => {
  it('có tiêu đề, quyết định, bảng việc cần làm', () => {
    const md = toMarkdown(project, true, false)
    expect(md).toContain('# Review Q3')
    expect(md).toContain('## Quyết định')
    expect(md).toContain('| Làm proposal | Tuấn | Thứ Sáu |')
    expect(md).toContain('## Ghi chú')
  })

  it('bỏ bản bóc băng khi không yêu cầu', () => {
    const md = toMarkdown(project, false, false)
    expect(md).not.toContain('Bản bóc băng')
  })

  it('chưa có tóm tắt thì vẫn ra được file, dùng tên dự án', () => {
    const md = toMarkdown({ ...project, summary: undefined }, false, false)
    expect(md).toContain('# Hop review Q3')
  })
})
