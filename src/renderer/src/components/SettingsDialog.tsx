import { useEffect, useState } from 'react'
import { FolderOpen, RefreshCw, Stethoscope, Trash2, CheckCircle2, XCircle } from 'lucide-react'
import type {
  ApiProviderId,
  CliProviderConfig,
  CliProviderId,
  DoctorResult,
  LlmProviderConfig,
  LlmProviderId,
  Settings,
  SpeakerProfile
} from '../../../shared/types'
import { isCliProvider } from '../../../shared/types'
import { Field, Modal, Segmented, Spinner, Toggle } from './Ui'
import UpdatePanel from './UpdatePanel'

const TABS = [
  { id: 'engine', label: 'Bóc băng' },
  { id: 'ai', label: 'AI & API key' },
  { id: 'prompt', label: 'Prompt tóm tắt' },
  { id: 'voices', label: 'Danh bạ giọng nói' },
  { id: 'doctor', label: 'Kiểm tra hệ thống' },
  { id: 'update', label: 'Cập nhật' }
] as const

type TabId = (typeof TABS)[number]['id']

const LANGS = [
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'en', label: 'English' },
  { value: 'auto', label: 'Tự nhận diện' }
]

/**
 * Tên model truyền thẳng cho faster-whisper.
 *
 * KHÔNG đưa distil-large-v3 vào đây: nó nhanh hơn large-v3 tới 6,3 lần nhưng
 * CHỈ hỗ trợ tiếng Anh, dùng cho cuộc họp tiếng Việt là ra rác.
 */
const MODEL_SIZES = [
  { value: 'large-v3', label: 'large-v3 — chính xác nhất (mặc định)' },
  { value: 'turbo', label: 'turbo — nhanh hơn ~8 lần, kém chính xác hơn chút' },
  { value: 'medium', label: 'medium' },
  { value: 'small', label: 'small' },
  { value: 'base', label: 'base' },
  { value: 'tiny', label: 'tiny — nhanh nhất, sai nhiều' }
]

export default function SettingsDialog({
  open,
  settings,
  onClose,
  onSave
}: {
  open: boolean
  settings: Settings
  onClose: () => void
  onSave: (patch: Partial<Settings>) => Promise<void>
}): JSX.Element {
  const [tab, setTab] = useState<TabId>('engine')
  const [draft, setDraft] = useState<Settings>(settings)
  const [doctor, setDoctor] = useState<DoctorResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [book, setBook] = useState<SpeakerProfile[]>([])
  const [mergeNote, setMergeNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => setDraft(settings), [settings, open])
  useEffect(() => {
    if (open && tab === 'voices') void window.api.speakers.book().then(setBook)
  }, [open, tab])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }))

  const activeProvider = draft.llm.providers[draft.llm.active as ApiProviderId]
  const activeCli: CliProviderConfig | null = isCliProvider(draft.llm.active)
    ? draft.cliProviders[draft.llm.active]
    : null

  const setCli = (patch: Partial<CliProviderConfig>): void =>
    setDraft((d) => {
      const id = d.llm.active as CliProviderId
      return { ...d, cliProviders: { ...d.cliProviders, [id]: { ...d.cliProviders[id], ...patch } } }
    })

  const resetCliPreset = async (): Promise<void> => {
    const presets = await window.api.settings.defaultCli()
    const id = draft.llm.active as CliProviderId
    if (presets[id]) setDraft((d) => ({ ...d, cliProviders: { ...d.cliProviders, [id]: presets[id] } }))
  }

  /** Dựng lại dòng lệnh sẽ chạy, để người dùng thấy trước. */
  const cliPreview = (cfg: CliProviderConfig): string => {
    const out: string[] = []
    for (const raw of cfg.args) {
      if (raw.includes('{model}') && !cfg.model.trim()) {
        // Xem mục buildArgs trong cliAgent.ts: chỉ bỏ cờ trước khi token là giá trị rời
        if (raw.trim() === '{model}') {
          const prev = out[out.length - 1]
          if (prev !== undefined && prev.startsWith('-') && !prev.includes('=')) out.pop()
        }
        continue
      }
      out.push(
        raw
          .replaceAll('{prompt}', '"<hướng dẫn tóm tắt>"')
          .replaceAll('{model}', cfg.model)
          .replaceAll('{doc}', '"<bản bóc băng>"')
          .replaceAll('{docfile}', '<file tạm>')
          .replaceAll('{outfile}', '<file kết quả>')
      )
    }
    const pipe = cfg.input === 'stdin' ? '<bản bóc băng> | ' : ''
    return `${pipe}${cfg.bin || '<lệnh>'} ${out.join(' ')}`
  }

  const setProvider = (patch: Partial<LlmProviderConfig>): void =>
    setDraft((d) => {
      const id = d.llm.active as ApiProviderId
      return { ...d, llm: { ...d.llm, providers: { ...d.llm.providers, [id]: { ...d.llm.providers[id], ...patch } } } }
    })

  const pick = async (
    title: string,
    extensions: string[] | undefined,
    key: 'whisperBinPath' | 'whisperModelPath' | 'pythonPath'
  ): Promise<void> => {
    const p = await window.api.dialog.pickFile({ title, extensions })
    if (p) set(key, p)
  }

  const pickCliBin = async (): Promise<void> => {
    const p = await window.api.dialog.pickFile({ title: 'Chọn file thực thi của CLI' })
    if (p) setCli({ bin: p })
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await onSave(draft)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const runDoctor = async (): Promise<void> => {
    setChecking(true)
    try {
      await onSave(draft)
      setDoctor(await window.api.doctor.run())
    } finally {
      setChecking(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Cài đặt"
      subtitle="Mọi thiết lập được lưu trong file settings.json trên máy bạn."
      onClose={onClose}
      width="max-w-3xl"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Huỷ
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving && <Spinner size={13} />}
            Lưu cài đặt
          </button>
        </>
      }
    >
      <div className="flex gap-1 mb-5 border-b border-ink-800 pb-2 flex-wrap">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'tab-active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'engine' && (
        <div>
          <Field label="Chạy bằng gì" hint="Local: không cần internet, dữ liệu không ra khỏi máy. API: nhanh và chính xác hơn với tiếng Việt nhưng phải upload audio.">
            <Segmented
              value={draft.engine}
              onChange={(v) => set('engine', v)}
              options={[
                { value: 'local', label: 'Local (offline)' },
                { value: 'api', label: 'Qua API' }
              ]}
            />
          </Field>

          <Field
            label="Từ điển thuật ngữ"
            hint="Tên riêng, tên sản phẩm, thuật ngữ nội bộ — mỗi dòng hoặc cách nhau bằng dấu phẩy. Được mồi cho model trước khi bóc băng nên bớt nghe sai hẳn. Tối đa 60 từ có tác dụng."
          >
            <textarea
              className="textarea min-h-[76px] text-[13px]"
              value={draft.glossary}
              onChange={(e) => set('glossary', e.target.value)}
              placeholder="MaiMoney, KYC, onboarding, e-wallet, Quỳnh, Tuấn"
            />
          </Field>

          <Toggle
            checked={draft.glossaryIncludeSpeakers}
            onChange={(v) => set('glossaryIncludeSpeakers', v)}
            label="Thêm cả tên người trong danh bạ giọng nói"
            hint="Tên đã đặt trong danh bạ được ghép vào phần mồi, để model nghe đúng tên người khi họ được gọi trong cuộc họp."
          />

          <Toggle
            checked={draft.boostQuietVoices === true}
            onChange={(v) => set('boostQuietVoices', v)}
            label="Kéo người nói nhỏ lên ngang người nói to"
            hint="Cho họp có người ngồi xa mic. Đo trên file thử: chênh lệch giữa người to và người nhỏ giảm từ 24dB xuống 10dB. Đổi lại cũng khuếch đại tiếng ồn nền, nên chỉ bật khi thật sự cần. Bật xong app tự tách lại âm thanh ở lần bóc sau."
          />

          <Field
            label="Độ nhạy nghe tiếng nói"
            hint="Thấp hơn = nghe kỹ hơn, bắt được người nói nhỏ hoặc ngồi xa mic, đổi lại nhiều tiếng ồn lọt vào. Mặc định 0.5. Thấy AI bỏ sót người nói thì hạ về 0.3."
          >
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={draft.vadThreshold}
                onChange={(e) => set('vadThreshold', Number(e.target.value))}
                className="grow accent-brand-500"
                disabled={draft.disableVad}
              />
              <span className="text-[12px] font-mono tabular-nums text-ink-300 w-8">
                {draft.vadThreshold.toFixed(2)}
              </span>
            </div>
          </Field>

          <Toggle
            checked={draft.disableVad === true}
            onChange={(v) => set('disableVad', v)}
            label="Tắt hẳn bộ lọc tiếng nói (VAD)"
            hint="Đưa TOÀN BỘ audio cho model, không bỏ sót câu nào. Đổi lại chậm hơn và dễ sinh câu bịa ở đoạn im lặng. Chỉ bật khi vẫn mất tiếng dù đã hạ độ nhạy hết cỡ."
          />

          <Toggle
            checked={draft.antiHallucination !== false}
            onChange={(v) => set('antiHallucination', v)}
            label="Lọc câu quảng cáo do model bịa ra"
            hint="Whisper học từ phụ đề YouTube nên ở đoạn IM LẶNG nó hay nhả ra câu kiểu “Hãy subscribe cho kênh Ghiền Mì Gõ…”, dù video không hề có quảng cáo. Bật thì app gỡ những câu đó và chặn model lặp vô hạn. Tắt nếu thấy nó cắt nhầm lời nói thật."
          />

          {draft.antiHallucination !== false && (
            <Field
              label="Câu bịa khác cần chặn (không bắt buộc)"
              hint="Gặp câu quảng cáo kiểu khác mà app chưa chặn thì chép nguyên văn vào đây, mỗi dòng một câu. Không phân biệt hoa thường."
            >
              <textarea
                className="textarea min-h-[60px] text-[13px]"
                value={draft.extraHallucinationPhrases}
                onChange={(e) => set('extraHallucinationPhrases', e.target.value)}
                placeholder={'xin chào quý vị và các bạn\nchúc các bạn xem video vui vẻ'}
              />
            </Field>
          )}

          <Field
            label="Bối cảnh cuộc họp (không bắt buộc)"
            hint="Một hai câu mô tả cuộc họp bàn về cái gì. Model dùng làm ngữ cảnh chứ không chỉ dò từ khoá — hiệu quả rõ nhất với VibeVoice-ASR, nhưng faster-whisper cũng nhận."
          >
            <textarea
              className="textarea min-h-[60px] text-[13px]"
              value={draft.meetingContext}
              onChange={(e) => set('meetingContext', e.target.value)}
              placeholder="Họp sản phẩm của MaiMoney về luồng onboarding và eKYC cho ví điện tử."
            />
          </Field>

          <Field label="Ngôn ngữ chính của video">
            <select className="input" value={draft.language} onChange={(e) => set('language', e.target.value)}>
              {LANGS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>

          {draft.engine === 'local' ? (
            <>
              <Field label="Backend bóc băng local">
                <Segmented
                  value={draft.localAsr}
                  onChange={(v) => set('localAsr', v)}
                  options={[
                    { value: 'python', label: 'faster-whisper' },
                    { value: 'vibevoice', label: 'VibeVoice-ASR' },
                    { value: 'whispercpp', label: 'whisper.cpp' }
                  ]}
                />
              </Field>

              <div className="rounded-lg border border-ink-800 bg-ink-850/50 p-3 text-[12.5px] leading-relaxed mb-4">
                {draft.localAsr === 'vibevoice' ? (
                  <>
                    <b className="text-brand-300">Một model làm cả bóc băng lẫn tách người nói.</b> Không cần
                    pyannote, <b>không cần token HuggingFace</b> — hết hẳn lỗi 401. Model của Microsoft, giấy phép
                    MIT, có tiếng Việt và xử lý được câu lẫn tiếng Anh.
                    <br />
                    Vì trả thẳng ra ai-nói-gì-lúc-nào nên không phải ghép ASR với diarization — đỡ được kiểu lỗi
                    gộp nhầm 2–3 người vào một lượt nói.
                    <br />
                    <span className="text-amber-300">Cần biết:</span> vẫn nên cài pyannote để lấy voiceprint (nhớ
                    giọng qua các cuộc họp). Model chưa xử lý được nói chồng tiếng. Nên bóc thử một cuộc họp thật
                    rồi so với faster-whisper trước khi chuyển hẳn.
                  </>
                ) : draft.localAsr === 'python' ? (
                  <>
                    <b>Đường quen thuộc:</b> faster-whisper bóc chữ, pyannote tách người nói, app ghép lại. Chính
                    xác và đã chạy ổn, nhưng pyannote cần <b>token HuggingFace</b> và phải bấm Agree ở 3 repo.
                  </>
                ) : (
                  <>
                    <b>Không cần Python:</b> chạy binary whisper.cpp có sẵn. Nhẹ nhất, nhưng vẫn cần pyannote
                    (tức là cần Python) nếu muốn tách người nói.
                  </>
                )}
              </div>

              {draft.localAsr === 'vibevoice' ? (
                <div className="grid sm:grid-cols-2 gap-x-4">
                  <Field
                    label="Model VibeVoice-ASR"
                    hint="Bản mặc định chạy tốt trên GPU. Máy chỉ có CPU thì cân nhắc bản BitNet nhẹ hơn nhiều."
                  >
                    <input
                      className="input"
                      value={draft.vibevoiceModel}
                      onChange={(e) => set('vibevoiceModel', e.target.value)}
                      placeholder="microsoft/VibeVoice-ASR-HF"
                    />
                  </Field>
                  <Field label="Thiết bị">
                    <select className="input" value={draft.fwDevice} onChange={(e) => set('fwDevice', e.target.value)}>
                      <option value="auto">Tự chọn</option>
                      <option value="cpu">CPU</option>
                      <option value="cuda">GPU (CUDA)</option>
                    </select>
                  </Field>
                </div>
              ) : draft.localAsr === 'python' ? (
                <div className="grid sm:grid-cols-2 gap-x-4">
                  <Field
                    label="Model"
                    hint="large-v3 chính xác nhất cho tiếng Việt (~3GB). Máy yếu hoặc cần nhanh thì thử turbo — cùng nhà OpenAI, rút gọn từ chính large-v3."
                  >
                    <select className="input" value={draft.fwModelSize} onChange={(e) => set('fwModelSize', e.target.value)}>
                      {MODEL_SIZES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                      {!MODEL_SIZES.some((m) => m.value === draft.fwModelSize) && (
                        <option value={draft.fwModelSize}>{draft.fwModelSize}</option>
                      )}
                    </select>
                  </Field>
                  <Field label="Thiết bị">
                    <select className="input" value={draft.fwDevice} onChange={(e) => set('fwDevice', e.target.value)}>
                      <option value="auto">Tự chọn</option>
                      <option value="cpu">CPU</option>
                      <option value="cuda">GPU (CUDA)</option>
                    </select>
                  </Field>
                  <Field
                    label="Số luồng CPU"
                    hint="0 = dùng hết số nhân của máy. faster-whisper mặc định chỉ 4 luồng dù máy có bao nhiêu nhân, nên để 0 là cách tăng tốc rẻ nhất."
                  >
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={draft.asrThreads}
                      onChange={(e) => set('asrThreads', Math.max(0, Number(e.target.value) || 0))}
                    />
                  </Field>
                  <Field
                    label="Số khúc chạy cùng lượt (batch)"
                    hint="Cắt audio theo đoạn có tiếng nói rồi chạy nhiều đoạn một lượt — nhanh hơn 2–4 lần. Đặt 0 hoặc 1 để tắt nếu thấy sai nhiều hoặc máy thiếu RAM."
                  >
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={32}
                      value={draft.asrBatchSize}
                      onChange={(e) => set('asrBatchSize', Math.max(0, Math.min(32, Number(e.target.value) || 0)))}
                    />
                  </Field>
                </div>
              ) : (
                <>
                  <Field label="Đường dẫn whisper-cli">
                    <div className="flex gap-2">
                      <input className="input" value={draft.whisperBinPath} onChange={(e) => set('whisperBinPath', e.target.value)} placeholder="C:\tools\whisper.cpp\whisper-cli.exe" />
                      <button className="btn-outline shrink-0" onClick={() => void pick('Chọn whisper-cli', undefined, 'whisperBinPath')}>
                        <FolderOpen size={14} />
                      </button>
                    </div>
                  </Field>
                  <Field label="File model .bin">
                    <div className="flex gap-2">
                      <input className="input" value={draft.whisperModelPath} onChange={(e) => set('whisperModelPath', e.target.value)} placeholder="ggml-large-v3.bin" />
                      <button className="btn-outline shrink-0" onClick={() => void pick('Chọn model ggml', ['bin'], 'whisperModelPath')}>
                        <FolderOpen size={14} />
                      </button>
                    </div>
                  </Field>
                </>
              )}

              <Field label="Đường dẫn Python" hint="Để trống nếu python đã có trong PATH. Cần cho việc tách người nói (pyannote).">
                <div className="flex gap-2">
                  <input className="input" value={draft.pythonPath} onChange={(e) => set('pythonPath', e.target.value)} placeholder="python" />
                  <button className="btn-outline shrink-0" onClick={() => void pick('Chọn python', undefined, 'pythonPath')}>
                    <FolderOpen size={14} />
                  </button>
                </div>
              </Field>

              <Toggle
                checked={draft.enableDiarization}
                onChange={(v) => set('enableDiarization', v)}
                label="Tách người nói + lưu voiceprint (pyannote)"
                hint="Cần cài: pip install “pyannote.audio>=3.1” torch torchaudio. Tắt đi thì mọi câu sẽ gán cho một người."
              />

              <Field
                label="HuggingFace token"
                hint="Bắt buộc nếu bật tách người nói — model pyannote bị giới hạn truy cập nên thiếu token sẽ lỗi 401."
              >
                <input
                  className="input"
                  type="password"
                  value={draft.hfToken}
                  onChange={(e) => set('hfToken', e.target.value)}
                  placeholder="hf_..."
                />
              </Field>

              {draft.enableDiarization && !draft.hfToken && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12.5px] text-ink-200 leading-relaxed mb-3">
                  <b className="text-amber-300">Chưa có token — tách người nói sẽ lỗi.</b> Lấy token miễn phí, mất
                  khoảng 2 phút:
                  <ol className="mt-1.5 space-y-1 text-ink-300">
                    <li>1. Đăng nhập https://huggingface.co</li>
                    <li>
                      2. Bấm <b>Agree and access repository</b> ở cả hai trang:
                      <br />
                      <code className="text-ink-200">huggingface.co/pyannote/speaker-diarization-3.1</code>
                      <br />
                      <code className="text-ink-200">huggingface.co/pyannote/segmentation-3.0</code>
                    </li>
                    <li>
                      3. Tạo token loại <b>Read</b> tại{' '}
                      <code className="text-ink-200">huggingface.co/settings/tokens</code>
                    </li>
                    <li>4. Dán vào ô trên rồi Lưu cài đặt</li>
                  </ol>
                  <p className="mt-2 text-ink-400">
                    Muốn app nhớ giọng qua nhiều cuộc họp thì xin quyền thêm ở{' '}
                    <code className="text-ink-300">huggingface.co/pyannote/embedding</code>. Không muốn làm bước
                    này: tắt công tắc phía trên, hoặc chuyển sang <b>Qua API</b> với Gemini (tự tách người nói,
                    không cần token).
                  </p>
                </div>
              )}
            </>
          ) : (
            <Field label="Dịch vụ bóc băng" hint="Gemini nghe trực tiếp file và tự tách người nói. Whisper API của OpenAI chỉ bóc chữ, phần người nói sẽ do LLM suy luận (kém chính xác hơn).">
              <Segmented
                value={draft.asrProvider}
                onChange={(v) => set('asrProvider', v)}
                options={[
                  { value: 'gemini', label: 'Gemini (có tách người nói)' },
                  { value: 'openai', label: 'OpenAI Whisper' }
                ]}
              />
            </Field>
          )}

          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Số người nói (nếu biết trước)" hint="0 = để hệ thống tự đoán.">
              <input
                className="input"
                type="number"
                min={0}
                max={20}
                value={draft.fixedSpeakerCount}
                onChange={(e) => set('fixedSpeakerCount', Number(e.target.value))}
              />
            </Field>
            <Field
              label={`Ngưỡng nhận ra giọng cũ: ${draft.voiceMatchThreshold.toFixed(2)}`}
              hint="Cao hơn = khắt khe hơn, ít nhận sai người nhưng dễ bỏ sót."
            >
              <input
                type="range"
                min={0.4}
                max={0.95}
                step={0.01}
                value={draft.voiceMatchThreshold}
                onChange={(e) => set('voiceMatchThreshold', Number(e.target.value))}
                className="w-full accent-brand-500 h-9"
              />
            </Field>
          </div>
        </div>
      )}

      {tab === 'ai' && (
        <div>
          <Field
            label="Dùng gì để tóm tắt"
            hint="CLI agent chạy bằng phiên đăng nhập sẵn có trên máy — không cần API key, không tính tiền theo token."
          >
            <select
              className="input"
              value={draft.llm.active}
              onChange={(e) =>
                setDraft((d) => ({ ...d, llm: { ...d.llm, active: e.target.value as LlmProviderId } }))
              }
            >
              <optgroup label="CLI agent trên máy (không cần API key)">
                {Object.values(draft.cliProviders).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Gọi API (cần API key)">
                {Object.values(draft.llm.providers).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </Field>

          {activeCli ? (
            <>
              <Field
                label="Lệnh / đường dẫn"
                hint="Chỉ cần tên lệnh nếu nó có trong PATH. App tự dò thêm ~/.local/bin và các vị trí cài phổ biến."
              >
                <div className="flex gap-2">
                  <input
                    className="input font-mono text-[12.5px]"
                    value={activeCli.bin}
                    onChange={(e) => setCli({ bin: e.target.value })}
                    placeholder="claude / gemini / copilot / codex"
                  />
                  <button className="btn-outline shrink-0" onClick={() => void pickCliBin()}>
                    Chọn…
                  </button>
                </div>
              </Field>

              <div className="grid sm:grid-cols-2 gap-x-4">
                <Field label="Model" hint="Bỏ trống = dùng model mặc định của CLI đó.">
                  <input
                    className="input font-mono text-[12.5px]"
                    value={activeCli.model}
                    onChange={(e) => setCli({ model: e.target.value })}
                    placeholder="(mặc định)"
                  />
                </Field>
                <Field label="Chờ tối đa (giây)" hint="Transcript dài + model mạnh có thể mất vài phút.">
                  <input
                    className="input"
                    type="number"
                    min={30}
                    max={7200}
                    value={activeCli.timeoutSec}
                    onChange={(e) => setCli({ timeoutSec: Number(e.target.value) || 1200 })}
                  />
                </Field>
              </div>

              <Field
                label="Tham số dòng lệnh"
                hint="Mỗi dòng một tham số. Chỗ thay thế: {prompt} {model} {doc} {docfile} {outfile}. Nếu Model bỏ trống thì dòng chứa {model} và cờ đứng trước nó sẽ tự bị loại."
              >
                <textarea
                  className="textarea min-h-[150px] font-mono text-[12px]"
                  value={activeCli.args.join('\n')}
                  onChange={(e) =>
                    setCli({ args: e.target.value.split('\n').filter((x) => x.trim() !== '') })
                  }
                />
              </Field>

              <div className="grid sm:grid-cols-3 gap-x-4">
                <Field label="Đưa transcript vào">
                  <select
                    className="input"
                    value={activeCli.input}
                    onChange={(e) => setCli({ input: e.target.value as CliProviderConfig['input'] })}
                  >
                    <option value="stdin">stdin (khuyến nghị)</option>
                    <option value="arg">tham số {'{doc}'}</option>
                  </select>
                </Field>
                <Field label="Đọc kết quả từ">
                  <select
                    className="input"
                    value={activeCli.output}
                    onChange={(e) => setCli({ output: e.target.value as CliProviderConfig['output'] })}
                  >
                    <option value="text">stdout (văn bản thuần)</option>
                    <option value="json">JSON trong stdout</option>
                    <option value="file">file {'{outfile}'}</option>
                  </select>
                </Field>
                <Field label="Trường JSON">
                  <input
                    className="input font-mono text-[12.5px]"
                    value={activeCli.jsonPath}
                    disabled={activeCli.output !== 'json'}
                    onChange={(e) => setCli({ jsonPath: e.target.value })}
                    placeholder="result"
                  />
                </Field>
              </div>

              <div className="mb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] font-semibold uppercase tracking-wider text-ink-400">
                    Lệnh sẽ chạy
                  </span>
                  <button className="btn-ghost text-[12px]" onClick={() => void resetCliPreset()}>
                    Khôi phục preset gốc
                  </button>
                </div>
                <pre className="rounded-lg border border-ink-800 bg-ink-950 p-3 text-[11.5px] font-mono text-ink-200 overflow-x-auto whitespace-pre-wrap break-all">
                  {cliPreview(activeCli)}
                </pre>
              </div>

              {activeCli.note && <p className="hint mb-3">{activeCli.note}</p>}

              <div className="rounded-lg border border-brand-500/30 bg-brand-500/10 p-3 text-[12.5px] text-ink-200 leading-relaxed">
                <b className="text-brand-200">Không cần API key.</b> MeetSum chạy CLI ngay trên máy bạn bằng
                phiên đăng nhập sẵn có của nó. Bản bóc băng đi qua stdin nên không đụng giới hạn độ dài dòng lệnh.
                <br />
                Vào tab <b>Kiểm tra hệ thống</b> để xác nhận app tìm thấy CLI.
                <br />
                <span className="text-ink-400">
                  Lưu ý: CLI agent chỉ làm phần tóm tắt/phân tích. Phần nghe và bóc băng video vẫn cần Python
                  (local) hoặc Gemini (API) vì các CLI này không xử lý được audio.
                </span>
              </div>
            </>
          ) : (
            <>
              <Field label="API key" hint="Key được lưu ở dạng văn bản trong settings.json trên máy bạn, không gửi đi đâu khác ngoài nhà cung cấp bạn chọn.">
                <input
                  className="input"
                  type="password"
                  value={activeProvider?.apiKey ?? ''}
                  onChange={(e) => setProvider({ apiKey: e.target.value })}
                  placeholder={activeProvider?.id === 'claude' ? 'sk-ant-...' : 'sk-...'}
                />
              </Field>

              <div className="grid sm:grid-cols-2 gap-x-4">
                <Field label="Model">
                  <input
                    className="input"
                    value={activeProvider?.model ?? ''}
                    onChange={(e) => setProvider({ model: e.target.value })}
                  />
                </Field>
                <Field label="Base URL">
                  <input
                    className="input"
                    value={activeProvider?.baseUrl ?? ''}
                    onChange={(e) => setProvider({ baseUrl: e.target.value })}
                  />
                </Field>
              </div>

              <p className="hint">
                Muốn chạy hoàn toàn offline cả phần tóm tắt? Chọn <b>Khác (OpenAI-compatible)</b> và trỏ về Ollama /
                LM Studio, ví dụ <code className="text-ink-300">http://localhost:11434/v1</code>.
              </p>
            </>
          )}
        </div>
      )}

      {tab === 'prompt' && (
        <div>
          <Field label="Prompt tóm tắt" hint="Đây là hướng dẫn gửi cho AI. Bạn có thể thêm yêu cầu riêng, ví dụ tập trung vào rủi ro hoặc số liệu.">
            <textarea
              className="textarea min-h-[240px] font-mono text-[12px]"
              value={draft.summaryPrompt}
              onChange={(e) => set('summaryPrompt', e.target.value)}
            />
          </Field>

          <Field
            label="Độ dài mỗi phần khi tóm tắt (ký tự)"
            hint="Cuộc họp dài thì bản bóc băng vượt giới hạn của model. App tự chia theo lượt nói (không cắt giữa câu), tóm tắt từng phần rồi ghép lại. Model báo vẫn quá dài thì giảm số này xuống. Đặt 0 để tắt, luôn gửi một lần — họp dài sẽ lỗi."
          >
            <input
              className="input"
              type="number"
              min={0}
              step={5000}
              value={draft.summaryChunkChars}
              onChange={(e) => set('summaryChunkChars', Math.max(0, Number(e.target.value) || 0))}
            />
            <p className="hint mt-1.5">
              {draft.summaryChunkChars > 0
                ? `≈ ${Math.round(draft.summaryChunkChars / 2500)}k token mỗi phần, tương đương khoảng ${Math.max(
                    1,
                    Math.round(draft.summaryChunkChars / 9000)
                  )} phút họp. Mặc định 45000 an toàn với mọi model.`
                : 'Đang TẮT tự chia phần — cuộc họp dài sẽ báo lỗi "prompt is too long".'}
            </p>
          </Field>
        </div>
      )}

      {tab === 'voices' && (
        <div>
          <p className="hint mb-3">
            Danh bạ giọng nói ({book.length}) được lưu trong <code className="text-ink-300">speakers.json</code>. Khi
            nhập video mới, app so khớp voiceprint để tự điền lại tên. Mỗi lần gặp lại, mẫu giọng được trộn thêm
            theo trung bình có trọng số chứ không ghi đè.
          </p>

          {book.length > 0 && book.every((s) => !s.embedding?.length) && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12.5px] text-ink-200 leading-relaxed mb-3">
              <b className="text-amber-300">Chưa giọng nào có voiceprint.</b> App sẽ không nhận ra ai ở cuộc họp
              sau. Thường là do chưa xin quyền model{' '}
              <code className="text-ink-300">pyannote/embedding</code> trên HuggingFace — đây là repo thứ ba,
              tách biệt với <code className="text-ink-300">speaker-diarization-3.1</code> và{' '}
              <code className="text-ink-300">segmentation-3.0</code>. Vào{' '}
              <code className="text-ink-300">huggingface.co/pyannote/embedding</code> bấm Agree rồi bóc băng lại.
            </div>
          )}

          <div className="space-y-1.5">
            {book.length === 0 && <p className="hint py-6 text-center">Chưa có giọng nào được ghi nhớ.</p>}
            {book.map((s) => (
              <div key={s.id} className="rounded-lg border border-ink-800 bg-ink-850/50 px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-[13px] font-medium">{s.name}</span>
                  {s.role && <span className="text-[11.5px] text-ink-400">· {s.role}</span>}
                  <span className="grow" />
                  <span className="text-[11px] text-ink-500">
                    {s.embedding?.length ? (
                      `voiceprint ${s.embedding.length}d`
                    ) : (
                      <span className="text-amber-400/90">chưa có voiceprint</span>
                    )}{' '}
                    · gặp {s.seen ?? 1} lần
                  </span>
                  <button
                    className="text-ink-500 hover:text-red-400"
                    title="Xoá khỏi danh bạ"
                    onClick={async () => setBook(await window.api.speakers.bookRemove(s.id))}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {book.length > 1 && (
                  <div className="flex items-center gap-2 mt-1.5 pl-5">
                    <span className="text-[11px] text-ink-500 shrink-0">Thật ra là cùng người với</span>
                    <select
                      className="input h-6 !py-0 text-[11.5px] w-auto max-w-[190px]"
                      value=""
                      onChange={async (e) => {
                        const dropId = e.target.value
                        if (!dropId) return
                        e.target.value = ''
                        const other = book.find((x) => x.id === dropId)
                        const ok = window.confirm(
                          `Gộp "${other?.name}" vào "${s.name}"?\n\n` +
                            'Hai mẫu giọng sẽ được học chung, số lần gặp cộng dồn, và mọi cuộc họp đang dùng ' +
                            `"${other?.name}" sẽ chuyển sang "${s.name}". Không hoàn tác được.`
                        )
                        if (!ok) return
                        const res = await window.api.speakers.bookMerge(s.id, dropId)
                        setBook(res.book)
                        setMergeNote(
                          `Đã gộp vào "${s.name}". Cập nhật ${res.projectsUpdated} cuộc họp đang dùng giọng cũ.`
                        )
                      }}
                    >
                      <option value="">— chọn giọng để gộp vào —</option>
                      {book
                        .filter((x) => x.id !== s.id)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name} (gặp {x.seen ?? 1} lần)
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>
            ))}
          </div>

          {mergeNote && <p className="hint mt-3 text-emerald-300">{mergeNote}</p>}
        </div>
      )}

      {tab === 'doctor' && (
        <div>
          <button className="btn-primary mb-4" onClick={runDoctor} disabled={checking}>
            {checking ? <Spinner size={13} /> : <Stethoscope size={14} />}
            Kiểm tra môi trường
          </button>
          {!doctor && <p className="hint">Bấm để kiểm tra ffmpeg, Python, pyannote, CLI agent và kết nối AI.</p>}
          {doctor && (
            <div className="space-y-1.5">
              <DoctorRow label="ffmpeg (tách audio)" state={doctor.ffmpeg} />
              <DoctorRow label="Python + faster-whisper" state={doctor.python} />
              <DoctorRow label="Tách người nói (pyannote)" state={doctor.diarization} />
              <DoctorRow label="whisper.cpp binary" state={doctor.whisperBin} />
              <DoctorRow label="whisper.cpp model" state={doctor.whisperModel} />
              <DoctorRow label="CLI agent trên máy" state={doctor.cliAgent} />
              <DoctorRow label="Kết nối AI tóm tắt" state={doctor.llm} />
            </div>
          )}
          <p className="hint mt-4 flex items-center gap-1.5">
            <RefreshCw size={12} />
            Cài đặt sẽ được lưu trước khi kiểm tra.
          </p>
        </div>
      )}

      {tab === 'update' && <UpdatePanel draft={draft} set={set} />}
    </Modal>
  )
}

function DoctorRow({ label, state }: { label: string; state: { ok: boolean; detail: string } }): JSX.Element {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-ink-800 bg-ink-850/50 px-3 py-2">
      {state.ok ? (
        <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
      ) : (
        <XCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
      )}
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{label}</div>
        <div className="hint break-words whitespace-pre-line">{state.detail}</div>
      </div>
    </div>
  )
}
