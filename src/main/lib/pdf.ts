import { BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { Project } from '../../shared/types'
import { exportsDir, workDir } from './paths'
import { formatTime } from './summarize'

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'MeetSum'
}

export interface PdfOptions {
  includeTranscript: boolean
  includeTimestamps: boolean
}

export function buildReportHtml(project: Project, opts: PdfOptions): string {
  const s = project.summary
  const colorOf = new Map(project.speakers.map((sp) => [sp.id, sp.color]))
  const nameOf = new Map(project.speakers.map((sp) => [sp.id, sp.name]))
  const created = new Date(project.createdAt).toLocaleString('vi-VN')

  const speakerChips = project.speakers
    .map(
      (sp) =>
        `<span class="chip"><i style="background:${esc(sp.color)}"></i>${esc(sp.name)}${sp.role ? ` · ${esc(sp.role)}` : ''}</span>`
    )
    .join('')

  const sections = (s?.sections ?? [])
    .map(
      (sec) => `<section class="block">
        <h3>${esc(sec.title)}</h3>
        ${sec.body ? `<p>${esc(sec.body)}</p>` : ''}
        ${sec.bullets?.length ? `<ul>${sec.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      </section>`
    )
    .join('')

  const participants = (s?.participants ?? [])
    .map(
      (p) => `<tr><td class="strong">${esc(p.name)}</td><td>${esc(p.role ?? '')}</td><td>${esc(p.contribution ?? '')}</td></tr>`
    )
    .join('')

  const actions = (s?.actionItems ?? [])
    .map(
      (a, i) =>
        `<tr><td class="num">${i + 1}</td><td>${esc(a.task)}</td><td class="strong">${esc(a.owner)}</td><td>${esc(a.due ?? '—')}</td></tr>`
    )
    .join('')

  const transcript = opts.includeTranscript
    ? project.segments
        .map((seg) => {
          const color = colorOf.get(seg.speakerId) ?? '#888'
          const who = nameOf.get(seg.speakerId) ?? 'unknown'
          return `<div class="line">
            ${opts.includeTimestamps ? `<span class="t">${formatTime(seg.start)}</span>` : ''}
            <span class="who" style="color:${esc(color)}">${esc(who)}</span>
            <span class="txt">${esc(seg.text)}</span>
          </div>`
        })
        .join('')
    : ''

  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<title>${esc(s?.title || project.name)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; color:#14161c; font-size:10.5pt; line-height:1.55; margin:0; }
  h1 { font-size:19pt; margin:0 0 4px; letter-spacing:-.01em; }
  h2 { font-size:12.5pt; margin:22px 0 8px; padding-bottom:5px; border-bottom:1.5px solid #1a6fe0; color:#1a6fe0; text-transform:uppercase; letter-spacing:.06em; }
  h3 { font-size:11pt; margin:12px 0 4px; }
  p { margin:0 0 7px; }
  .lead { font-size:11.5pt; color:#3a4152; margin:8px 0 4px; }
  .meta { color:#6b7280; font-size:9pt; margin-top:6px; }
  .rule { height:3px; background:linear-gradient(90deg,#1a6fe0,#4da3ff 55%,#e7ecf4); border-radius:3px; margin:12px 0 4px; }
  .chips { margin:10px 0 0; }
  .chip { display:inline-block; border:1px solid #dfe4ec; border-radius:20px; padding:2px 9px; margin:0 5px 5px 0; font-size:9pt; }
  .chip i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; }
  ul { margin:4px 0 8px 18px; padding:0; }
  li { margin:2px 0; }
  table { width:100%; border-collapse:collapse; margin:6px 0 10px; font-size:9.5pt; }
  th { text-align:left; background:#f2f5fa; padding:6px 8px; border-bottom:1px solid #dfe4ec; font-size:8.5pt; text-transform:uppercase; letter-spacing:.05em; color:#4b5563; }
  td { padding:6px 8px; border-bottom:1px solid #eef1f6; vertical-align:top; }
  td.num { width:24px; color:#9aa3b2; }
  .strong { font-weight:600; }
  .block { break-inside:avoid; }
  .kw span { display:inline-block; background:#eef4ff; color:#1557ad; border-radius:4px; padding:2px 7px; margin:0 5px 5px 0; font-size:8.5pt; }
  .line { display:flex; gap:8px; padding:3px 0; border-bottom:1px solid #f4f6fa; break-inside:avoid; }
  .line .t { flex:0 0 46px; color:#9aa3b2; font-size:8.5pt; font-variant-numeric:tabular-nums; padding-top:1px; }
  .line .who { flex:0 0 92px; font-weight:600; font-size:9pt; }
  .line .txt { flex:1; }
  .foot { margin-top:18px; padding-top:8px; border-top:1px solid #e7ecf4; color:#9aa3b2; font-size:8pt; }
  .empty { color:#9aa3b2; font-style:italic; }
</style></head>
<body>
  <h1>${esc(s?.title || project.name)}</h1>
  <div class="rule"></div>
  ${s?.oneLiner ? `<p class="lead">${esc(s.oneLiner)}</p>` : ''}
  <div class="meta">Nguồn: ${esc(project.name)} · Thời lượng ${formatTime(project.durationSec ?? 0)} · ${project.speakers.length} người nói · ${project.segments.length} lượt nói · Tạo ngày ${esc(created)}</div>
  <div class="chips">${speakerChips}</div>

  ${
    s
      ? `
  ${participants ? `<h2>Người tham gia</h2><table><thead><tr><th>Tên</th><th>Vai trò</th><th>Đóng góp chính</th></tr></thead><tbody>${participants}</tbody></table>` : ''}
  ${sections ? `<h2>Nội dung chính</h2>${sections}` : ''}
  ${s.decisions?.length ? `<h2>Quyết định</h2><ul>${s.decisions.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
  ${actions ? `<h2>Việc cần làm</h2><table><thead><tr><th></th><th>Công việc</th><th>Phụ trách</th><th>Hạn</th></tr></thead><tbody>${actions}</tbody></table>` : ''}
  ${s.openQuestions?.length ? `<h2>Vấn đề còn treo</h2><ul>${s.openQuestions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
  ${s.keywords?.length ? `<h2>Từ khoá</h2><div class="kw">${s.keywords.map((k) => `<span>${esc(k)}</span>`).join('')}</div>` : ''}
  `
      : '<h2>Tóm tắt</h2><p class="empty">Chưa tạo tóm tắt cho cuộc họp này.</p>'
  }

  ${transcript ? `<h2>Bản bóc băng đầy đủ</h2>${transcript}` : ''}

  <div class="foot">MeetSum · Bóc băng và tóm tắt cuộc họp trên máy cá nhân${s ? ` · Tóm tắt bởi ${esc(s.provider)} (${esc(s.model)})` : ''}</div>
</body></html>`
}

/** Render HTML rồi in ra PDF bằng chính Chromium của Electron (không cần thư viện ngoài). */
export async function exportPdf(project: Project, opts: PdfOptions, targetPath?: string): Promise<string> {
  const html = buildReportHtml(project, opts)
  const htmlFile = join(workDir(project.id), 'report.html')
  writeFileSync(htmlFile, html, 'utf-8')

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, sandbox: true }
  })
  try {
    await win.loadURL(pathToFileURL(htmlFile).toString())
    await new Promise((r) => setTimeout(r, 350))
    const buffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' },
      generateDocumentOutline: true
    })
    const out =
      targetPath ||
      join(exportsDir(), `${safeFileName(project.summary?.title || project.name)}_${Date.now()}.pdf`)
    writeFileSync(out, buffer)
    return out
  } finally {
    win.destroy()
  }
}
