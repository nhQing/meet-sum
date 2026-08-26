import type { LlmProviderConfig, Settings } from '../../shared/types'
import { isCliProvider } from '../../shared/types'
import { activeCli, runCliAgent } from './cliAgent'

export function activeProvider(settings: Settings): LlmProviderConfig {
  const id = settings.llm.active
  if (isCliProvider(id)) throw new Error(`${id} là CLI agent, không phải provider API`)
  const cfg = settings.llm.providers[id]
  if (!cfg) throw new Error(`Chưa cấu hình provider ${id}`)
  return cfg
}

/** Nhãn + model của provider đang chọn, dùng cho cả CLI lẫn API. */
export function providerMeta(settings: Settings): { label: string; model: string } {
  const id = settings.llm.active
  if (isCliProvider(id)) {
    const cfg = activeCli(settings)
    return { label: cfg?.label ?? id, model: cfg?.model || '(mặc định của CLI)' }
  }
  const cfg = settings.llm.providers[id]
  return { label: cfg?.label ?? id, model: cfg?.model ?? '' }
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Gọi LLM đã chọn trong Cài đặt. Trả về text thuần. */
export async function chat(
  settings: Settings,
  system: string,
  user: string,
  opts: { json?: boolean; maxTokens?: number } = {}
): Promise<string> {
  // CLI agent trên máy (claude / gemini / copilot / codex...): dùng phiên đăng nhập của chính CLI đó
  if (isCliProvider(settings.llm.active)) {
    const cliCfg = activeCli(settings)
    if (!cliCfg) throw new Error(`Chưa cấu hình CLI ${settings.llm.active}`)
    const info = await runCliAgent(cliCfg, system, user)
    return info.text
  }

  const cfg = activeProvider(settings)
  if (!cfg.apiKey && cfg.id !== 'custom') {
    throw new Error(`Chưa nhập API key cho ${cfg.label}. Mở Cài đặt để nhập.`)
  }
  const maxTokens = opts.maxTokens ?? 16000
  const base = trimBase(cfg.baseUrl)

  if (cfg.id === 'claude') {
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: maxTokens,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: user }]
      })
    })
    if (!res.ok) throw new Error(`Claude lỗi ${res.status}: ${(await res.text()).slice(0, 500)}`)
    const data = (await res.json()) as { content?: { text?: string }[] }
    return data.content?.map((c) => c.text ?? '').join('') ?? ''
  }

  if (cfg.id === 'gemini') {
    const res = await fetch(
      `${base}/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: maxTokens,
            ...(opts.json ? { responseMimeType: 'application/json' } : {})
          }
        })
      }
    )
    if (!res.ok) throw new Error(`Gemini lỗi ${res.status}: ${(await res.text()).slice(0, 500)}`)
    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  }

  // openai | glm | custom — đều dùng chuẩn OpenAI chat/completions
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      max_tokens: maxTokens,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  })
  if (!res.ok) throw new Error(`${cfg.label} lỗi ${res.status}: ${(await res.text()).slice(0, 500)}`)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

export async function pingLlm(settings: Settings): Promise<{ ok: boolean; detail: string }> {
  try {
    const meta = providerMeta(settings)
    const out = await chat(settings, 'Trả lời đúng một từ.', 'Nói "ok".', { maxTokens: 32 })
    return { ok: out.trim().length > 0, detail: `${meta.label} · ${meta.model} → ${out.trim().slice(0, 60)}` }
  } catch (e) {
    return { ok: false, detail: (e as Error).message }
  }
}

export function extractJson(text: string): unknown {
  let t = text.trim()
  if (t.startsWith('```')) t = t.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '')
  const start = t.search(/[[{]/)
  if (start > 0) t = t.slice(start)
  const lastObj = t.lastIndexOf('}')
  const lastArr = t.lastIndexOf(']')
  const end = Math.max(lastObj, lastArr)
  if (end > 0) t = t.slice(0, end + 1)
  return JSON.parse(t)
}
