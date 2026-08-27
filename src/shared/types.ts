/** Kiểu dữ liệu dùng chung giữa main process và renderer. */

export type EngineMode = 'local' | 'api'

/** CLI agent chạy sẵn trên máy — dùng phiên đăng nhập của chính CLI đó, không cần API key. */
export type CliProviderId = 'claude-cli' | 'gemini-cli' | 'copilot-cli' | 'codex-cli' | 'custom-cli'

export type ApiProviderId = 'claude' | 'openai' | 'gemini' | 'glm' | 'custom'

export type LlmProviderId = CliProviderId | ApiProviderId

export const CLI_PROVIDER_IDS: CliProviderId[] = [
  'claude-cli',
  'gemini-cli',
  'copilot-cli',
  'codex-cli',
  'custom-cli'
]

export function isCliProvider(id: LlmProviderId): id is CliProviderId {
  return (CLI_PROVIDER_IDS as string[]).includes(id)
}

/**
 * Cấu hình gọi một CLI agent. Các chỗ thay thế dùng được trong `args`:
 *   {prompt}  – hướng dẫn tóm tắt
 *   {model}   – model (bỏ trống thì token này và cờ đứng trước nó bị loại bỏ)
 *   {doc}     – toàn bộ bản bóc băng (chỉ dùng khi input = 'arg')
 *   {docfile} – đường dẫn file tạm chứa bản bóc băng
 *   {outfile} – đường dẫn file tạm để CLI ghi kết quả (dùng khi output = 'file')
 */
export interface CliProviderConfig {
  id: CliProviderId
  label: string
  /** Lệnh hoặc đường dẫn tuyệt đối tới binary */
  bin: string
  args: string[]
  /** Bản bóc băng được đưa vào CLI qua đâu */
  input: 'stdin' | 'arg'
  /** Kết quả đọc từ đâu: stdout thuần, JSON trong stdout, hay file do CLI ghi ra */
  output: 'text' | 'json' | 'file'
  /** Tên trường chứa nội dung trong JSON trả về, ví dụ 'result' (claude) hoặc 'response' (gemini) */
  jsonPath: string
  model: string
  timeoutSec: number
  /** Ghi chú hiển thị trong Cài đặt */
  note?: string
}

export interface LlmProviderConfig {
  id: ApiProviderId
  label: string
  baseUrl: string
  model: string
  apiKey: string
}

export interface Settings {
  /** Engine dùng để bóc băng: chạy local hay gọi API */
  engine: EngineMode
  /** Ngôn ngữ chính của video (mã ISO, 'auto' = tự nhận diện) */
  language: string
  /** Bật dịch/chuẩn hoá các từ tiếng Anh lẫn trong câu tiếng Việt */
  keepEnglishTerms: boolean
  /** Tên riêng + thuật ngữ hay xuất hiện, mồi cho model để bớt nghe sai. Mỗi dòng hoặc cách nhau bằng dấu phẩy. */
  glossary: string
  /** Tự thêm tên những người đã có trong danh bạ giọng nói vào phần mồi */
  glossaryIncludeSpeakers: boolean
  /**
   * Mô tả bối cảnh cuộc họp bằng câu chữ tự do, mồi kèm danh sách thuật ngữ.
   * VibeVoice-ASR nhận cả mô tả nền chứ không chỉ danh sách từ khoá.
   */
  meetingContext: string

  // --- Local engine ---
  /** Backend ASR chạy local: 'python' = faster-whisper (dễ cài), 'whispercpp' = binary whisper.cpp */
  localAsr: 'python' | 'whispercpp' | 'vibevoice'
  /** Kích thước model faster-whisper: tiny/base/small/medium/large-v3 */
  fwModelSize: string
  /** cpu | cuda | auto */
  fwDevice: string
  /** Model VibeVoice-ASR trên HuggingFace (chỉ dùng khi localAsr = 'vibevoice') */
  vibevoiceModel: string
  whisperBinPath: string
  whisperModelPath: string
  whisperThreads: number
  /** Python dùng cho diarization (pyannote). Để trống = tự dò trong PATH */
  pythonPath: string
  enableDiarization: boolean
  /** HuggingFace token cho pyannote (chỉ cần lần đầu tải model) */
  hfToken: string
  /** Số người nói nếu biết trước (0 = tự động) */
  fixedSpeakerCount: number

  // --- API engine ---
  asrProvider: 'gemini' | 'openai'
  /** Ngưỡng cosine để coi 2 giọng là cùng một người (0.4 - 0.95) */
  voiceMatchThreshold: number

  llm: {
    active: LlmProviderId
    providers: Record<ApiProviderId, LlmProviderConfig>
  }

  /** Các CLI agent cài sẵn trên máy (claude, gemini, copilot, codex...) */
  cliProviders: Record<CliProviderId, CliProviderConfig>

  /** Prompt tóm tắt, người dùng có thể sửa */
  summaryPrompt: string
  /**
   * Bản bóc băng dài hơn ngần này ký tự thì tự chia thành nhiều phần, tóm tắt
   * từng phần rồi ghép lại. 0 = tắt, luôn gửi một phát (sẽ lỗi với họp dài).
   */
  summaryChunkChars: number

  // --- Cập nhật ---
  /** Tự kiểm tra bản mới trên GitHub Releases khi mở app */
  autoUpdateCheck: boolean
  /** GitHub token (quyền đọc repo) — chỉ cần nếu repo phát hành ở chế độ riêng tư */
  updateToken: string
}

export interface SpeakerProfile {
  /** id nội bộ, ví dụ spk_ab12 */
  id: string
  /** Tên hiển thị: 'user_1' nếu chưa đặt tên */
  name: string
  /** Người dùng đã tự đặt tên hay chưa */
  named: boolean
  color: string
  role?: string
  note?: string
  /** Vector đặc trưng giọng nói (voiceprint) để nhận ra ở các video sau */
  embedding?: number[]
  /** Số lần đã gặp giọng này */
  seen?: number
  updatedAt?: string
}

export interface TranscriptSegment {
  id: string
  start: number
  end: number
  speakerId: string
  text: string
  /** Độ tin cậy của phần gán người nói (0..1) */
  confidence?: number
  edited?: boolean
}

export interface SummarySection {
  title: string
  body?: string
  bullets?: string[]
}

export interface MeetingSummary {
  title: string
  oneLiner: string
  language: string
  participants: { name: string; role?: string; contribution?: string }[]
  sections: SummarySection[]
  decisions: string[]
  actionItems: { owner: string; task: string; due?: string }[]
  openQuestions: string[]
  keywords: string[]
  generatedAt: string
  provider: string
  model: string
  /** Được ghép từ mấy phần — chỉ có khi bản bóc băng dài phải chia nhỏ */
  parts?: number
  /** Thời điểm người dùng sửa tay gần nhất */
  editedAt?: string
}

export type ProjectStatus =
  | 'new'
  | 'queued'
  | 'extracting'
  | 'diarizing'
  | 'transcribing'
  | 'paused'
  | 'ready'
  | 'summarizing'
  | 'done'
  | 'error'

export interface Project {
  id: string
  name: string
  videoPath: string
  audioPath?: string
  durationSec?: number
  createdAt: string
  updatedAt: string
  status: ProjectStatus
  error?: string
  /** Cảnh báo: vẫn có kết quả nhưng thiếu một phần (ví dụ chưa tách được người nói) */
  warning?: string
  engineUsed?: EngineMode
  /** Đã bóc băng tới giây thứ mấy — dùng để chạy tiếp sau khi tạm dừng */
  progressSec?: number
  /** Người nói trong CHÍNH cuộc họp này */
  speakers: SpeakerProfile[]
  segments: TranscriptSegment[]
  summary?: MeetingSummary
  notes?: string
  /** Cuộc họp này được nhập từ gói chia sẻ của người khác chứ không tự bóc băng */
  sharedFrom?: SharedOrigin
}

/** Dấu vết nguồn gốc của một cuộc họp được nhập từ gói .meetsum */
export interface SharedOrigin {
  /** id của cuộc họp trên máy người xuất — dùng để nhận ra đã nhập rồi */
  projectId: string
  exportedAt: string
  exportedBy?: string
  /** Tên file video gốc trên máy người xuất, chỉ để hiển thị */
  videoName?: string
}

/**
 * Gói chia sẻ một hay nhiều cuộc họp. Là JSON thuần, không nén, không mã hoá —
 * cố tình như vậy để 5 năm sau vẫn đọc được bằng bất cứ thứ gì, đúng tinh thần
 * "không database, chỉ file JSON trên máy bạn" của app.
 *
 * KHÔNG kèm video/audio: bản bóc băng của một cuộc họp 1 tiếng chỉ vài trăm KB,
 * gửi qua Zalo/Teams thoải mái, còn video thì hàng GB.
 */
export interface MeetingBundle {
  format: 'meetsum-bundle'
  version: number
  exportedAt: string
  exportedBy?: string
  appVersion?: string
  /** Có kèm vector giọng nói hay không */
  includesVoiceprints: boolean
  /** Danh bạ giọng nói của những người xuất hiện trong các cuộc họp dưới đây */
  speakers: SpeakerProfile[]
  meetings: BundleMeeting[]
}

export interface BundleMeeting {
  /** id trên máy người xuất */
  id: string
  name: string
  createdAt: string
  durationSec?: number
  /** Chỉ tên file, không phải đường dẫn — người nhận không có video này */
  videoName?: string
  speakers: SpeakerProfile[]
  segments: TranscriptSegment[]
  summary?: MeetingSummary
  /** Ghi chú riêng, chỉ có khi người xuất chủ động tick */
  notes?: string
}

/** Mô tả một gói đã đọc được, để xem trước rồi mới nhập. */
export interface BundleInfo {
  path: string
  exportedAt: string
  exportedBy?: string
  includesVoiceprints: boolean
  speakerCount: number
  meetings: {
    /** id trên máy người xuất */
    id: string
    name: string
    createdAt: string
    durationSec?: number
    segmentCount: number
    speakerNames: string[]
    hasSummary: boolean
    hasNotes: boolean
    /** Đã nhập gói này trước đó rồi — id cuộc họp đang có trên máy */
    existingProjectId?: string
  }[]
}

export interface ImportBundleResult {
  imported: { projectId: string; name: string }[]
  skipped: string[]
  speakersAdded: number
  speakersMerged: number
  renamed: { from: string; to: string }[]
}

export interface ProjectSummaryRow {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  status: ProjectStatus
  durationSec?: number
  speakerCount: number
  segmentCount: number
  hasSummary: boolean
  /** Nhập từ gói chia sẻ của người khác, không tự bóc băng trên máy này */
  shared?: boolean
}

export interface PipelineProgress {
  projectId: string
  stage: ProjectStatus
  /** 0..100, -1 = không xác định */
  percent: number
  message: string
}

export interface DoctorResult {
  ffmpeg: { ok: boolean; detail: string }
  whisperBin: { ok: boolean; detail: string }
  whisperModel: { ok: boolean; detail: string }
  python: { ok: boolean; detail: string }
  diarization: { ok: boolean; detail: string }
  cliAgent: { ok: boolean; detail: string }
  llm: { ok: boolean; detail: string }
}
