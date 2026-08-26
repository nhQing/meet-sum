import type {
  ApiProviderId,
  CliProviderConfig,
  CliProviderId,
  LlmProviderConfig,
  Settings
} from '../../shared/types'

export const SPEAKER_COLORS = [
  '#4da3ff',
  '#f2994a',
  '#27c19a',
  '#bb6bd9',
  '#eb5757',
  '#f2c94c',
  '#56ccf2',
  '#9b9bff',
  '#6fcf97',
  '#ff8fab'
]

export function colorForIndex(i: number): string {
  return SPEAKER_COLORS[i % SPEAKER_COLORS.length]
}

export const DEFAULT_SUMMARY_PROMPT = `Bạn là trợ lý phân tích cuộc họp. Dưới đây là bản bóc băng có gán tên người nói.

Hãy nghiên cứu kỹ toàn bộ nội dung và trả về JSON đúng schema được yêu cầu, với các nguyên tắc:
- Viết bằng tiếng Việt tự nhiên, GIỮ NGUYÊN các thuật ngữ tiếng Anh chuyên môn (không dịch máy móc).
- Bám sát nội dung thực tế, không suy diễn hay bịa thêm thông tin không có trong bản bóc băng.
- Nêu rõ ai quyết định điều gì, ai chịu trách nhiệm việc gì.
- Nếu có số liệu, deadline, tên hệ thống/sản phẩm thì phải ghi lại chính xác.
- Với mỗi hạng mục cần làm (action item), ghi rõ người phụ trách; nếu không xác định được thì để "Chưa rõ".`

function provider(
  id: ApiProviderId,
  label: string,
  baseUrl: string,
  model: string
): LlmProviderConfig {
  return { id, label, baseUrl, model, apiKey: '' }
}

function cli(
  id: CliProviderId,
  label: string,
  bin: string,
  args: string[],
  extra: Partial<CliProviderConfig> = {}
): CliProviderConfig {
  return {
    id,
    label,
    bin,
    args,
    input: 'stdin',
    output: 'text',
    jsonPath: '',
    model: '',
    timeoutSec: 1200,
    ...extra
  }
}

/**
 * Preset cho các CLI agent phổ biến. Tất cả đều đẩy bản bóc băng qua stdin và
 * nhận hướng dẫn qua tham số dòng lệnh — người dùng sửa được toàn bộ trong Cài đặt.
 */
export function defaultCliProviders(): Record<CliProviderId, CliProviderConfig> {
  return {
    'claude-cli': cli(
      'claude-cli',
      'Claude Code CLI',
      'claude',
      ['-p', '{prompt}', '--output-format', 'json', '--permission-mode', 'dontAsk', '--model', '{model}'],
      {
        output: 'json',
        jsonPath: 'result',
        model: 'sonnet',
        note: 'Model dùng alias: sonnet / opus / haiku. Đăng nhập bằng chính subscription Claude của bạn.'
      }
    ),
    'gemini-cli': cli(
      'gemini-cli',
      'Gemini CLI',
      'gemini',
      ['-p', '{prompt}', '--output-format', 'json', '-m', '{model}'],
      {
        output: 'json',
        jsonPath: 'response',
        note: 'Bỏ trống Model để dùng model mặc định của Gemini CLI. Kết quả nằm ở trường "response".'
      }
    ),
    'copilot-cli': cli(
      'copilot-cli',
      'GitHub Copilot CLI',
      'copilot',
      ['-p', '{prompt}', '-s', '--allow-all-tools', '--model={model}'],
      {
        output: 'text',
        note: 'Cờ -s để chỉ in ra câu trả lời. Copilot CLI không có JSON output nên đọc thẳng stdout. Nếu không muốn cho phép chạy tool, xoá --allow-all-tools (có thể sẽ bị treo chờ xác nhận).'
      }
    ),
    'codex-cli': cli(
      'codex-cli',
      'OpenAI Codex CLI',
      'codex',
      ['exec', '--skip-git-repo-check', '--output-last-message', '{outfile}', '-m', '{model}', '{prompt}'],
      {
        output: 'file',
        note: 'Codex ghi câu trả lời cuối vào file tạm ({outfile}) nên không lẫn log. Bỏ trống Model để dùng mặc định.'
      }
    ),
    'custom-cli': cli('custom-cli', 'CLI khác (tự cấu hình)', '', ['-p', '{prompt}'], {
      note: 'Điền lệnh và tham số của CLI bạn dùng. Chỗ thay thế: {prompt} {model} {doc} {docfile} {outfile}.'
    })
  }
}

export function defaultSettings(): Settings {
  return {
    engine: 'local',
    language: 'vi',
    keepEnglishTerms: true,
    glossary: '',
    glossaryIncludeSpeakers: true,

    localAsr: 'python',
    fwModelSize: 'large-v3',
    fwDevice: 'auto',
    whisperBinPath: '',
    whisperModelPath: '',
    whisperThreads: 4,
    pythonPath: '',
    enableDiarization: true,
    hfToken: '',
    fixedSpeakerCount: 0,

    asrProvider: 'gemini',
    voiceMatchThreshold: 0.72,

    llm: {
      active: 'claude-cli',
      providers: {
        claude: provider('claude', 'Claude (Anthropic)', 'https://api.anthropic.com', 'claude-sonnet-4-5'),
        openai: provider('openai', 'OpenAI (GPT)', 'https://api.openai.com/v1', 'gpt-4.1'),
        gemini: provider(
          'gemini',
          'Google Gemini',
          'https://generativelanguage.googleapis.com/v1beta',
          'gemini-2.5-pro'
        ),
        glm: provider('glm', 'GLM (Zhipu)', 'https://open.bigmodel.cn/api/paas/v4', 'glm-4.6'),
        custom: provider('custom', 'Khác (OpenAI-compatible)', 'http://localhost:11434/v1', 'qwen2.5:14b')
      }
    },

    cliProviders: defaultCliProviders(),

    summaryPrompt: DEFAULT_SUMMARY_PROMPT,

    autoUpdateCheck: true,
    updateToken: ''
  }
}
