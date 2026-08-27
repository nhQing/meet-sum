import { describe, expect, it } from 'vitest'
import { explainCliFailure, extractCliMessage, isContextLengthError } from '../src/main/lib/cliAgent'

/** Đúng khối JSON Claude Code CLI in ra khi API trả lỗi — chép từ lỗi thật của người dùng. */
const apiErrorEnvelope = JSON.stringify({
  is_error: true,
  duration_api_ms: 0,
  num_turns: 1,
  stop_reason: 'stop_sequence',
  session_id: 'a183e911-73f4-4c79-b814-c952120626cd',
  total_cost_usd: 0,
  usage: {
    output_tokens_details: { thinking_tokens: 0 },
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
    service_tier: 'standard'
  },
  modelUsage: {},
  permission_denials: [],
  terminal_reason: 'api_error'
})

const withResult = (result: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ is_error: true, result, terminal_reason: 'api_error', usage: {}, ...extra })

describe('extractCliMessage', () => {
  it('moi được câu lỗi thật trong trường result', () => {
    expect(extractCliMessage(withResult('Có gì đó sai')).message).toBe('Có gì đó sai')
  })

  it('đọc được {"error":{"message":...}} kiểu Anthropic API', () => {
    const raw = JSON.stringify({ error: { message: 'overloaded_error' } })
    expect(extractCliMessage(raw).message).toBe('overloaded_error')
  })

  it('JSON Lines thì lấy dòng cuối', () => {
    const raw = '{"type":"start"}\n{"is_error":true,"result":"cuoi cung"}'
    expect(extractCliMessage(raw).message).toBe('cuoi cung')
  })

  it('không phải JSON thì trả rỗng chứ không nổ', () => {
    expect(extractCliMessage('command not found').envelope).toBeNull()
    expect(extractCliMessage('').message).toBe('')
  })
})

describe('explainCliFailure — nói được người dùng phải làm gì', () => {
  it('lỗi API không tốn token: nêu 3 nguyên nhân kèm lệnh thử nhanh', () => {
    const msg = explainCliFailure('Claude Code CLI', 'claude', 1, apiErrorEnvelope, '', 50000)
    expect(msg).toContain('không tốn token nào')
    expect(msg).toContain('hết lượt dùng')
    expect(msg).toContain('claude -p "xin chào"')
    // Không được ném nguyên khối JSON vào mặt người dùng
    expect(msg).not.toContain('cache_creation_input_tokens')
    expect(msg).not.toContain('session_id')
  })

  it('hết lượt dùng thì bảo chờ hoặc đổi provider', () => {
    const msg = explainCliFailure('Claude Code CLI', 'claude', 1, withResult('Claude usage limit reached'), '', 100)
    expect(msg).toContain('hết lượt dùng')
    expect(msg).toContain('đổi tạm sang')
  })

  it('quá dài thì nói rõ dài bao nhiêu và app sẽ tự chia', () => {
    const msg = explainCliFailure('Claude Code CLI', 'claude', 1, withResult('prompt is too long'), '', 420_000)
    expect(msg).toContain('quá dài')
    expect(msg).toContain('420k ký tự')
    expect(msg).toContain('Độ dài mỗi phần khi tóm tắt')
  })

  it('chưa đăng nhập thì chỉ đúng lệnh phải chạy', () => {
    const msg = explainCliFailure('Gemini CLI', 'gemini', 1, '', 'Error: not logged in', 100)
    expect(msg).toContain('đăng nhập')
    expect(msg).toContain('"gemini"')
  })

  it('máy chủ quá tải thì bảo chờ rồi thử lại', () => {
    const msg = explainCliFailure('Codex CLI', 'codex', 1, withResult('overloaded_error'), '', 100)
    expect(msg).toContain('quá tải')
  })

  it('lỗi mạng/proxy tách riêng khỏi lỗi tài khoản', () => {
    const msg = explainCliFailure('Copilot CLI', 'copilot', 1, '', 'getaddrinfo ENOTFOUND api.example.com', 100)
    expect(msg).toContain('mạng')
    expect(msg).not.toContain('hết lượt dùng')
  })

  it('CLI chỉ in chữ thường thì vẫn hiện được chi tiết', () => {
    const msg = explainCliFailure('CLI khác', 'mycli', 127, '', 'command not found: mycli', 100)
    expect(msg).toContain('command not found')
  })

  it('không in ra gì cả thì vẫn có câu tử tế', () => {
    const msg = explainCliFailure('CLI khác', 'mycli', 1, '', '', 100)
    expect(msg).toContain('không rõ nguyên nhân')
    expect(msg.length).toBeGreaterThan(20)
  })
})

describe('isContextLengthError', () => {
  it('nhận ra các cách báo "quá dài" khác nhau của từng nhà cung cấp', () => {
    for (const m of [
      'prompt is too long: 250000 tokens > 200000 maximum',
      'This model’s maximum context length is 128000 tokens',
      'Request too large',
      'input length exceeds the limit'
    ]) {
      expect(isContextLengthError(m)).toBe(true)
    }
  })

  it('không nhầm lỗi khác thành lỗi độ dài', () => {
    expect(isContextLengthError('usage limit reached')).toBe(false)
    expect(isContextLengthError('not logged in')).toBe(false)
    expect(isContextLengthError('')).toBe(false)
  })
})
