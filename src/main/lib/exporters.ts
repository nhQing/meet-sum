import { writeFileSync } from 'fs'
import type { MeetingSummary, Project, SpeakerProfile } from '../../shared/types'

export type ExportFormat = 'srt' | 'vtt' | 'md' | 'txt' | 'docx'

function nameOf(project: Project): Map<string, SpeakerProfile> {
  return new Map(project.speakers.map((s) => [s.id, s]))
}

/** hh:mm:ss,mmm cho SRT — dấu phẩy, còn VTT dùng dấu chấm. */
function stamp(sec: number, comma: boolean): string {
  const s = Math.max(0, sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = Math.floor(s % 60)
  const ms = Math.round((s - Math.floor(s)) * 1000)
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(r)}${comma ? ',' : '.'}${pad(ms, 3)}`
}

/** Phụ đề để gắn lại lên video. Tên người nói đặt trong ngoặc vuông đầu dòng. */
export function toSubtitle(project: Project, kind: 'srt' | 'vtt'): string {
  const names = nameOf(project)
  const vtt = kind === 'vtt'
  const blocks = project.segments.map((sg, i) => {
    const who = names.get(sg.speakerId)?.name ?? 'unknown'
    const time = `${stamp(sg.start, !vtt)} --> ${stamp(sg.end, !vtt)}`
    return `${vtt ? '' : i + 1 + '\n'}${time}\n[${who}] ${sg.text}`
  })
  return (vtt ? 'WEBVTT\n\n' : '') + blocks.join('\n\n') + '\n'
}

/** Bản bóc băng dạng text thuần, gộp các lượt liền nhau của cùng một người. */
export function toPlainText(project: Project, withTime: boolean): string {
  const names = nameOf(project)
  const lines: string[] = []
  let lastSpeaker = ''
  for (const sg of project.segments) {
    const who = names.get(sg.speakerId)?.name ?? 'unknown'
    const t = withTime ? `[${stamp(sg.start, false).slice(0, 8)}] ` : ''
    if (who === lastSpeaker && !withTime) {
      lines[lines.length - 1] += ' ' + sg.text
    } else {
      lines.push(`${t}${who}: ${sg.text}`)
      lastSpeaker = who
    }
  }
  return lines.join('\n')
}

function summaryToMarkdown(s: MeetingSummary): string {
  const out: string[] = [`# ${s.title}`, '']
  if (s.oneLiner) out.push(s.oneLiner, '')
  if (s.participants.length) {
    out.push('## Người tham gia', '')
    for (const p of s.participants) {
      out.push(`- **${p.name}**${p.role ? ` — ${p.role}` : ''}${p.contribution ? `: ${p.contribution}` : ''}`)
    }
    out.push('')
  }
  for (const sec of s.sections) {
    out.push(`## ${sec.title}`, '')
    if (sec.body) out.push(sec.body, '')
    for (const b of sec.bullets ?? []) out.push(`- ${b}`)
    if (sec.bullets?.length) out.push('')
  }
  if (s.decisions.length) {
    out.push('## Quyết định', '')
    for (const d of s.decisions) out.push(`- ${d}`)
    out.push('')
  }
  if (s.actionItems.length) {
    out.push('## Việc cần làm', '', '| Công việc | Phụ trách | Hạn |', '| --- | --- | --- |')
    for (const a of s.actionItems) out.push(`| ${a.task} | ${a.owner} | ${a.due || '—'} |`)
    out.push('')
  }
  if (s.openQuestions.length) {
    out.push('## Vấn đề còn treo', '')
    for (const q of s.openQuestions) out.push(`- ${q}`)
    out.push('')
  }
  if (s.keywords.length) out.push('## Từ khoá', '', s.keywords.join(', '), '')
  return out.join('\n')
}

export function toMarkdown(project: Project, includeTranscript: boolean, withTime: boolean): string {
  const parts: string[] = []
  if (project.summary) parts.push(summaryToMarkdown(project.summary))
  else parts.push(`# ${project.name}`, '')

  if (includeTranscript && project.segments.length) {
    parts.push('---', '', '## Bản bóc băng', '', '```', toPlainText(project, withTime), '```', '')
  }
  if (project.notes?.trim()) parts.push('---', '', '## Ghi chú', '', project.notes.trim(), '')
  return parts.join('\n')
}

/** File Word thật (không phải HTML đổi đuôi), để gửi đi và sửa tiếp được. */
export async function writeDocx(
  project: Project,
  outPath: string,
  includeTranscript: boolean,
  withTime: boolean
): Promise<void> {
  // Nạp động: chỉ cần khi người dùng thực sự xuất .docx
  const {
    Document,
    Packer,
    Paragraph,
    HeadingLevel,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType
    // eslint-disable-next-line @typescript-eslint/no-var-requires
  } = require('docx')

  const s = project.summary
  const body: unknown[] = []
  const H = (text: string, level: unknown): unknown =>
    new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } })
  const P = (text: string, opts: Record<string, unknown> = {}): unknown =>
    new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 100 } })

  body.push(
    new Paragraph({
      text: s?.title || project.name,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT
    })
  )
  if (s?.oneLiner) body.push(P(s.oneLiner, { italics: true, color: '444444' }))

  if (s) {
    if (s.participants.length) {
      body.push(H('Người tham gia', HeadingLevel.HEADING_1))
      for (const p of s.participants) {
        body.push(
          new Paragraph({
            children: [
              new TextRun({ text: p.name, bold: true }),
              new TextRun({ text: p.role ? ` — ${p.role}` : '' }),
              new TextRun({ text: p.contribution ? `: ${p.contribution}` : '' })
            ],
            bullet: { level: 0 }
          })
        )
      }
    }

    for (const sec of s.sections) {
      body.push(H(sec.title, HeadingLevel.HEADING_1))
      if (sec.body) body.push(P(sec.body))
      for (const b of sec.bullets ?? []) {
        body.push(new Paragraph({ text: b, bullet: { level: 0 } }))
      }
    }

    if (s.decisions.length) {
      body.push(H('Quyết định', HeadingLevel.HEADING_1))
      for (const d of s.decisions) body.push(new Paragraph({ text: d, bullet: { level: 0 } }))
    }

    if (s.actionItems.length) {
      body.push(H('Việc cần làm', HeadingLevel.HEADING_1))
      const cell = (text: string, bold = false): unknown =>
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] })
      body.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: [cell('Công việc', true), cell('Phụ trách', true), cell('Hạn', true)] }),
            ...s.actionItems.map(
              (a) => new TableRow({ children: [cell(a.task), cell(a.owner), cell(a.due || '—')] })
            )
          ]
        })
      )
    }

    if (s.openQuestions.length) {
      body.push(H('Vấn đề còn treo', HeadingLevel.HEADING_1))
      for (const q of s.openQuestions) body.push(new Paragraph({ text: q, bullet: { level: 0 } }))
    }
    if (s.keywords.length) {
      body.push(H('Từ khoá', HeadingLevel.HEADING_1))
      body.push(P(s.keywords.join(', ')))
    }
  }

  if (includeTranscript && project.segments.length) {
    body.push(H('Bản bóc băng', HeadingLevel.HEADING_1))
    const names = nameOf(project)
    for (const sg of project.segments) {
      const who = names.get(sg.speakerId)?.name ?? 'unknown'
      body.push(
        new Paragraph({
          children: [
            ...(withTime
              ? [new TextRun({ text: `[${stamp(sg.start, false).slice(0, 8)}] `, color: '888888', size: 18 })]
              : []),
            new TextRun({ text: `${who}: `, bold: true }),
            new TextRun({ text: sg.text })
          ],
          spacing: { after: 80 }
        })
      )
    }
  }

  if (project.notes?.trim()) {
    body.push(H('Ghi chú', HeadingLevel.HEADING_1))
    for (const line of project.notes.trim().split('\n')) body.push(P(line))
  }

  const doc = new Document({ sections: [{ children: body }] })
  const buf = await Packer.toBuffer(doc)
  writeFileSync(outPath, buf)
}

export async function exportAs(
  project: Project,
  format: ExportFormat,
  outPath: string,
  opts: { includeTranscript: boolean; includeTimestamps: boolean }
): Promise<string> {
  switch (format) {
    case 'srt':
    case 'vtt':
      writeFileSync(outPath, toSubtitle(project, format), 'utf-8')
      return outPath
    case 'txt':
      writeFileSync(outPath, toPlainText(project, opts.includeTimestamps), 'utf-8')
      return outPath
    case 'md':
      writeFileSync(outPath, toMarkdown(project, opts.includeTranscript, opts.includeTimestamps), 'utf-8')
      return outPath
    case 'docx':
      await writeDocx(project, outPath, opts.includeTranscript, opts.includeTimestamps)
      return outPath
    default:
      throw new Error(`Định dạng không hỗ trợ: ${format}`)
  }
}
