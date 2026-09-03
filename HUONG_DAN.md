# MeetSum — Hướng dẫn cài đặt & sử dụng

Ứng dụng desktop (Windows / macOS) để **bóc băng video cuộc họp đã tải sẵn**, **tách và đặt tên người nói**,
**tóm tắt bằng AI** và **xuất báo cáo PDF**.

- Không có database, không có server. Mọi thứ là **file JSON trên máy bạn**.
- Video **chỉ được đọc tại chỗ** (import đường dẫn), app không copy video đi đâu.
- Có thể chạy **100% offline** (local engine + LLM local), hoặc dùng API của Claude / Gemini / GPT / GLM.
- API key được **mã hoá bằng Keychain / DPAPI** trước khi ghi xuống file.
- Giọng nói được **ghi nhớ qua các cuộc họp**: đặt tên một lần, lần sau tự điền đúng người.
- Sửa tay được **mọi thứ** AI làm sai, có `Ctrl/⌘+Z` để lùi lại.
- Xuất **PDF, Word, Markdown, phụ đề .srt/.vtt, text thuần**.
- Tìm được **xuyên tất cả cuộc họp** đã lưu.
- Ba backend bóc băng local để chọn, trong đó **VibeVoice-ASR không cần token HuggingFace**.
- Cuộc họp dài thì **tự chia phần, tóm tắt từng phần rồi ghép lại** — không còn lỗi "quá dài".
- **Chia sẻ cuộc họp qua Teams/Zalo/Drive bằng một file** — người nhận nhập vào là có ngay
  bản bóc băng, không phải chạy lại.

---

## 1. Chạy thử nhanh (dev mode)

> **Dự án này dùng `pnpm`**, không phải `npm`. Trong repo có `pnpm-lock.yaml` và
> `pnpm-workspace.yaml`. Chạy `npm install` chồng lên cây thư mục do pnpm cài sẽ tạo ra trạng
> thái lai và **giấu mất các xung đột phiên bản** — pnpm bắt lỗi đó còn npm thì bỏ qua.
> Lỡ chạy nhầm `npm install` rồi thì: xoá `node_modules` và `package-lock.json`, chạy lại
> `pnpm install`.

Cần: **Node.js 20+** và **Git**.

```bash
pnpm install
pnpm run dev
```

`ffmpeg` đã được nhúng sẵn trong app (qua `@ffmpeg-installer/ffmpeg`), bạn không cần cài riêng.

## 2. Đóng gói thành file cài đặt

```bash
pnpm run build:win     # Windows -> dist/MeetSum-1.0.0-win-x64.exe (NSIS installer)
pnpm run build:mac     # macOS   -> dist/MeetSum-1.0.0-mac-arm64.dmg (và x64)
pnpm run build:dir     # chỉ build thư mục, không tạo installer (test nhanh)
```

### Lỗi hay gặp khi build trên Windows

```
cannot execute  cause=exit status 2
ERROR: Cannot create symbolic link : A required privilege is not held by the client
  ...\electron-builder\Cache\winCodeSign\...\darwin\10.12\lib\libcrypto.dylib
```

electron-builder tải bộ **winCodeSign** (để ký số file .exe) nhưng trong đó có symlink của macOS,
mà Windows không cho tạo symlink khi thiếu quyền. App này **không cần ký số**, nên trong
`electron-builder.yml` đã đặt `win.signAndEditExecutable: false` — build sẽ chạy qua bước đó.

Đánh đổi: file `MeetSum.exe` giữ icon mặc định của Electron (icon MeetSum vẫn hiện ở
**installer**, ở **cửa sổ app** và trên **taskbar** vì được set lúc runtime).
Muốn .exe có icon + thông tin phiên bản riêng:

1. Bật **Developer Mode**: Settings → Privacy & security → For developers → *Developer Mode: On*
   (hoặc mở terminal bằng *Run as administrator*).
2. Đổi `signAndEditExecutable: false` → `true` trong `electron-builder.yml`.
3. Build lại.

### Đóng gói cho macOS

**Bắt buộc build trên máy Mac.** Không thể tạo bản .dmg từ Windows: ffmpeg và ffprobe được cài
theo đúng nền tảng của máy chạy `install` (`@ffmpeg-installer/darwin-arm64` hoặc `darwin-x64`),
nên build từ Windows sẽ đóng gói nhầm binary của Windows vào app macOS.

```bash
pnpm install
pnpm build:mac        # -> dist/MeetSum-1.0.0-mac-arm64.dmg (và x64)
```

**Lần đầu mở app sẽ bị Gatekeeper chặn** vì chưa ký bằng Apple Developer ID:
*"MeetSum không thể mở vì Apple không thể kiểm tra..."* — chuột phải vào app trong Applications
→ **Open** → **Open** lần nữa. Chỉ cần làm một lần.

Nếu báo *"MeetSum bị hỏng và không thể mở"* (xảy ra khi tải file .dmg qua mạng), gỡ cờ cách ly:

```bash
xattr -dr com.apple.quarantine /Applications/MeetSum.app
```

**Khác biệt quan trọng so với Windows:** cách ký số self-signed ở mục 2b **không dùng được cho
macOS**. Gatekeeper chỉ chấp nhận chữ ký từ **Apple Developer ID** (99 USD/năm) kèm bước
**notarization** gửi app lên Apple duyệt. Certificate tự tạo không có tác dụng gì. Nếu chỉ dùng
nội bộ vài máy thì cứ để đồng nghiệp chuột phải → Open là xong.

Ký ad-hoc (chỉ giúp app chạy trên chính máy vừa build, không giúp máy khác):

```bash
codesign --force --deep --sign - dist/mac-arm64/MeetSum.app
```


---

## 2b. Ký số cho nội bộ trên Windows (bỏ cảnh báo "Unknown publisher")

> Mục này **chỉ áp dụng cho Windows**. Ba script trong `scripts/` đều là PowerShell.
> macOS xử lý khác hẳn — xem mục *Đóng gói cho macOS* ở trên.

Windows chặn app chưa ký số bằng SmartScreen. Với bản dùng nội bộ, ký bằng **certificate tự tạo**
là đủ để hết cảnh báo trên các máy đã cài certificate đó — miễn phí, không cần mua gì.

### Trên máy build (làm một lần)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\make-signing-cert.ps1
```

Script sẽ hỏi mật khẩu rồi tạo hai file trong `certs\`:

| File | Vai trò |
|---|---|
| `MaiMoney-CodeSigning.pfx` | **Bí mật** — chỉ nằm trên máy build, đã được `.gitignore` |
| `MaiMoney-CodeSigning.cer` | Gửi cho đồng nghiệp, không chứa khoá bí mật |

### Build bản đã ký

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-signed.ps1
```

Script hỏi mật khẩu `.pfx`, build, rồi in ra trạng thái chữ ký của từng file
(`Valid` là đạt). Muốn tự chạy tay:

```powershell
$env:CSC_LINK = "$PWD\certs\MaiMoney-CodeSigning.pfx"
$env:CSC_KEY_PASSWORD = "<mật khẩu>"
pnpm build:win:signed
```

> `build:win:signed` bật lại `signAndEditExecutable`, nên **cần Developer Mode**
> (Settings → Privacy & security → For developers) hoặc terminal Administrator,
> nếu không sẽ gặp lỗi symbolic link lúc giải nén winCodeSign.

### Trên máy đồng nghiệp (làm một lần)

Gửi họ 2 file: `MaiMoney-CodeSigning.cer` và `scripts\install-signing-cert.ps1`, để cùng thư mục.
Họ mở **Terminal (Admin)** rồi chạy:

```powershell
powershell -ExecutionPolicy Bypass -File install-signing-cert.ps1
```

Sau đó cài MeetSum như bình thường — publisher hiện là **MaiMoney**.

### Cần biết trước

- Certificate tự ký **chỉ được tin cậy trên máy đã cài `.cer`**. Máy lạ vẫn cảnh báo như cũ.
- Cách này **không tạo được uy tín SmartScreen** trên diện rộng. Muốn phát hành ra ngoài
  công ty thì phải mua certificate **OV** từ CA (DigiCert, Sectigo, GlobalSign...),
  khoảng 150–300 USD/năm và bắt buộc có USB token/HSM từ tháng 6/2023.
- **Azure Artifact Signing** (tên cũ: Trusted Signing, ~10 USD/tháng) rẻ hơn nhiều nhưng
  hiện chỉ mở cho tổ chức ở **Mỹ, Canada, EU, Anh** — công ty ở Việt Nam chưa đăng ký được.
- Certificate **EV** từ 2024 **không còn** bỏ qua SmartScreen ngay lập tức nữa, nên không
  đáng trả thêm tiền chỉ vì lý do đó.
- Certificate tạo bởi script có hạn 3 năm. Hết hạn thì chạy lại `make-signing-cert.ps1`
  và phát lại file `.cer` cho mọi người.

### Không muốn ký số

Bản build local không mang "Mark of the Web" nên thường chạy thẳng được:

```
dist\win-unpacked\MeetSum.exe
```

Còn nếu gặp bảng xanh *"Windows protected your PC"*: bấm **More info** → **Run anyway**.
File tải từ mạng bị đánh dấu thì gỡ trước bằng `Unblock-File .\dist\MeetSum-1.0.0-win-x64.exe`.

---

## 3. Chuẩn bị engine bóc băng

Mở app → nút **⚙ Cài đặt** → tab **Bóc băng**. Có 2 lựa chọn, đổi được bất cứ lúc nào.

### Cách A — Local, offline hoàn toàn (khuyến nghị cho dữ liệu nội bộ)

Cần Python 3.9–3.12 trên máy. macOS cài bằng `brew install python@3.12` hoặc tải .pkg từ
python.org; Windows tải từ python.org và nhớ tick *Add python.exe to PATH*.

```bash
# Bóc băng (bắt buộc)
pip install faster-whisper

# Tách người nói + voiceprint (rất nên có, đây là phần nhận diện giọng mỗi người)
pip install "pyannote.audio>=3.1" torch torchaudio
```

Nếu có GPU NVIDIA, cài `torch` bản CUDA để nhanh hơn 5–10 lần:
`pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121`

**Model pyannote bị gated** — bắt buộc phải xin quyền + có token, nếu không sẽ lỗi
`GatedRepoError: 401 Client Error` khi bóc băng. Làm một lần, khoảng 2 phút:

1. Đăng nhập / đăng ký https://huggingface.co
2. Bấm **Agree and access repository** ở **cả hai** trang (thiếu một cái là vẫn 401):
   - https://huggingface.co/pyannote/speaker-diarization-3.1
   - https://huggingface.co/pyannote/segmentation-3.0
   - thêm https://huggingface.co/pyannote/embedding nếu muốn app **nhớ giọng qua nhiều cuộc họp**
3. Tạo access token loại **Read** ở https://huggingface.co/settings/tokens
4. Dán token vào Cài đặt → Bóc băng → **HuggingFace token** → Lưu

Không muốn làm bước này thì tắt công tắc *Tách người nói* (vẫn bóc băng bình thường, nhưng
mọi câu gộp vào một người), hoặc dùng **Qua API** với Gemini — Gemini tự tách người nói.

> Nếu tách người nói lỗi giữa chừng, app **không bỏ dở**: nó vẫn bóc băng xong và hiện
> cảnh báo màu vàng, bạn tự gán người nói bằng tay hoặc xử lý token rồi chạy lại.

Sau đó bấm **Cài đặt → Kiểm tra hệ thống** để xác nhận mọi thứ xanh.

> **Riêng macOS:** app mở từ Finder/Dock không kế thừa `PATH` trong `~/.zshrc`, nên mặc định
> nó không thấy Homebrew hay pyenv. MeetSum đã tự thêm `/opt/homebrew/bin`, `/usr/local/bin`,
> `~/.local/bin`, `~/.pyenv/shims` vào PATH của tiến trình con và tự dò các bản Python cài từ
> Homebrew, pyenv và python.org. Cài Python ở chỗ khác thì điền thẳng đường dẫn vào
> Cài đặt → **Đường dẫn Python**. Điều này áp dụng cho cả các CLI agent (claude, gemini, codex...).

Tuỳ chọn khác: nếu bạn đã có **whisper.cpp**, chọn backend `whisper.cpp` rồi trỏ tới
`whisper-cli(.exe)` và file model `ggml-large-v3.bin`.

### Mồi tên riêng & thuật ngữ (nên làm, rất đáng)

Cài đặt → tab **Bóc băng** → ô **Tên riêng & thuật ngữ hay gặp**. Mỗi dòng hoặc cách nhau
bằng dấu phẩy:

```
MaiMoney, KYC, onboarding, e-wallet
Quỳnh, Tuấn, Thảo
```

Danh sách này được đưa vào `initial_prompt` của Whisper trước khi bóc băng, nên model biết
trước những chữ sẽ nghe thấy. Hiệu quả rõ nhất với **tên người Việt** và **thuật ngữ tiếng Anh
lẫn trong câu tiếng Việt** — đúng kiểu họp của mình. Không mồi thì `KYC` dễ ra "ka i xi",
`onboarding` ra "on bo đinh".

Bật thêm **Tự thêm tên trong danh bạ giọng nói**: mọi người đã được đặt tên ở các cuộc họp
trước sẽ tự vào danh sách mồi, không phải gõ lại. Tên kiểu `user_3` bị bỏ qua. Tổng cộng chặn
ở 60 từ để không tràn cửa sổ ngữ cảnh của model.

### Bóc băng nhanh hơn (đọc trước khi ngồi chờ 2 tiếng)

Câu hỏi tự nhiên là: *"sao không chia nhỏ video ra rồi chạy đa luồng?"* Ý đúng, nhưng cách làm
naive — cắt video thành N khúc rồi mở N tiến trình — lại **chậm hơn**:

- Mỗi tiến trình nạp **một bản model riêng**. `large-v3` int8 khoảng 3 GB, 4 tiến trình là 12 GB
  RAM. Máy 16 GB bắt đầu swap, và swap thì chậm hơn mọi thứ khác.
- CTranslate2 (lõi của faster-whisper) **đã** chia phép nhân ma trận ra nhiều luồng. N tiến trình
  mỗi cái đòi hết số nhân thì chúng tranh nhau CPU, tổng lại còn chậm hơn một tiến trình.
- Cắt rời làm **mất ngữ cảnh**: `condition_on_previous_text` mang ngữ cảnh câu trước sang câu sau,
  đúng chỗ giúp nghe đúng tên riêng tiếng Việt. Cắt độc lập là mất phần đó.
- **Tách người nói không cắt được như vậy**: pyannote gom nhóm giọng trên toàn file. Cắt rời thì
  "người 1" của khúc 1 không liên quan gì tới "người 1" của khúc 2.

Ba cách **thật sự** hiệu quả, đã gắn sẵn trong Cài đặt → **Bóc băng**:

| Cách | Được gì |
|---|---|
| **Số luồng CPU = 0** | Dùng hết số nhân của máy |
| **Số khúc chạy cùng lượt (batch) = 8** | Nhanh hơn khoảng **2–4 lần** |
| Đổi model sang `medium` / `small` | Nhanh gấp mấy lần, đổi lại kém chính xác hơn |

**Về số luồng:** faster-whisper mặc định `cpu_threads = 4` **bất kể máy có bao nhiêu nhân**. Máy
16 nhân mà chỉ chạy 4 luồng là bỏ không 3/4 CPU. Để **0** thì app dùng hết. Xem lại ở
**Kiểm tra hệ thống**, dòng Python ghi rõ `CPU 16 nhân · dùng hết số nhân, lô 8`.

**Về chia lô:** đây chính là "chia nhỏ rồi chạy song song" nhưng làm đúng — VAD cắt audio thành
các khúc **có tiếng nói**, rồi nhiều khúc được chạy trong *cùng một lượt suy luận*, trên **một
model duy nhất trong RAM**. Số liệu chính thức của faster-whisper: model `small` trên CPU giảm từ
1 phút 42 xuống 51 giây; `large-v2` int8 từ 59 giây xuống 16 giây.

Đặt **0** hoặc **1** để tắt chia lô, nếu máy thiếu RAM hoặc thấy kết quả kém đi — chia lô xử lý
từng khúc độc lập nên hơi mất ngữ cảnh giữa các khúc so với chạy tuần tự.

> Tạm dừng / chạy tiếp vẫn hoạt động bình thường khi bật chia lô: kết quả vẫn trả về từng câu một
> nên checkpoint vẫn ghi được như cũ.

Còn muốn chạy **nhiều cuộc họp** một lượt thì dùng **hàng đợi** (mục 5d) — chạy lần lượt, vì như
trên, chạy song song hai cuộc họp trên cùng một CPU chỉ làm cả hai chậm hơn.

### Chọn backend nào?

Cài đặt → **Bóc băng** → *Backend bóc băng local*. Ba lựa chọn, đổi được bất cứ lúc nào:

| | faster-whisper | **VibeVoice-ASR** | whisper.cpp |
|---|---|---|---|
| Bóc chữ | faster-whisper | VibeVoice | whisper.cpp |
| Tách người nói | pyannote (bước riêng) | **cùng một lượt** | pyannote (bước riêng) |
| Token HuggingFace | **bắt buộc** | **không cần** | bắt buộc (nếu tách người nói) |
| Cần Python | có | có | chỉ khi tách người nói |
| Giấy phép model | MIT / gated | MIT, không gated | MIT |

**VibeVoice-ASR** là model của Microsoft, làm bóc chữ + tách người nói + mốc thời gian trong
**một lượt duy nhất**. Đáng thử vì ba lý do rất cụ thể:

1. **Hết lỗi 401.** pyannote đòi bấm *Agree* ở 3 repo rồi tạo token HuggingFace — đây là chỗ
   hay chết nhất khi cài máy mới. VibeVoice không gated, không cần token.
2. **Đỡ kiểu lỗi gộp nhầm người.** Đường cũ chạy ASR và diarization riêng rồi app tự ghép lại;
   chính bước ghép đó hay dồn 2–3 người vào một lượt nói (nên mới cần nút **Tách lượt**).
   VibeVoice trả thẳng ra ai-nói-gì-lúc-nào.
3. **Tiếng Việt lẫn tiếng Anh** là tính năng gốc của model, không phải chống chế.

Cài:

```bash
pip install -U "transformers>=5.14" torch torchaudio
# Nên cài thêm, để nhớ giọng qua các cuộc họp (xem ngay dưới):
pip install "pyannote.audio>=3.1"
```

> **Vẫn nên cài pyannote.** VibeVoice tách được người nói *trong* một cuộc họp, nhưng **không
> trả về voiceprint** — mà voiceprint mới là thứ giúp app nhận ra đúng người ở các cuộc họp
> sau. Thiếu nó thì mất luôn danh bạ giọng nói, và cuộc họp dài trên 50 phút cũng khó ghép
> đúng người giữa các đoạn (xem dưới). Cái này chỉ cần `pyannote.audio`, **không cần token**.

**Cuộc họp dài hơn 50 phút** được cắt thành nhiều đoạn vì model nhận tối đa 60 phút mỗi lượt.
App dùng voiceprint để ghép người nói giữa các đoạn. Không có voiceprint thì mỗi đoạn đánh số
người nói riêng, app báo rõ và bạn bấm **Gộp** để nhập lại — cố tình làm vậy vì tách dư ra thì
bấm Gộp một lần là xong, còn gán nhầm hai người thành một thì phải sửa tay từng lượt nói.

**Máy chỉ có CPU**: bản mặc định (`microsoft/VibeVoice-ASR-HF`) nặng, nên chạy GPU. Microsoft
có bản **BitNet 1.58 GB chạy CPU** nhanh hơn whisper.cpp khoảng 1,6–2,3 lần, nhưng hiện phải
tự compile `VibeASR.cpp` nên MeetSum chưa gắn sẵn.

**Chưa nên chuyển hẳn ngay.** Bóc thử **một cuộc họp thật** rồi so với faster-whisper trước đã.
Model chưa xử lý được nói chồng tiếng (hai người nói cùng lúc thì nó thiên về người nói to hơn),
và chính nhóm tác giả thừa nhận bản tinh chỉnh tập trung vào tiếng Anh và tiếng Trung nên các
ngôn ngữ khác có thể yếu hơn con số công bố.

### Mồi bối cảnh, không chỉ danh sách từ

Ngoài ô *Từ điển thuật ngữ*, có thêm ô **Bối cảnh cuộc họp** — một hai câu mô tả cuộc họp bàn
về cái gì:

```
Họp sản phẩm của MaiMoney về luồng onboarding và eKYC cho ví điện tử.
```

VibeVoice nhận cả câu chữ tự do làm ngữ cảnh chứ không chỉ dò từ khoá, nên mô tả bối cảnh giúp
nó đoán đúng hơn hẳn ở những chỗ nghe không rõ. faster-whisper cũng dùng được ô này.

### Cách B — Qua API (nhanh, không cần cài gì)

- **Gemini** (khuyến nghị): nghe trực tiếp file audio và **tự tách người nói**. Chỉ cần API key.
- **OpenAI Whisper**: bóc chữ rất tốt nhưng **không tách người nói**; app sẽ nhờ LLM suy luận lượt nói,
  kết quả gần đúng, bạn chỉnh lại trong app.

Lưu ý: cách này audio được upload lên nhà cung cấp bạn chọn.

## 4. Cấu hình AI tóm tắt

Cài đặt → tab **AI & API key**.

### Cách A — CLI agent trên máy (mặc định, không cần API key)

Nếu máy đã cài sẵn CLI agent và đã đăng nhập, chọn nó trong nhóm
**"CLI agent trên máy (không cần API key)"** là xong — dùng luôn subscription của CLI đó,
không trả tiền theo token.

Preset có sẵn:

| Provider | Lệnh | Lệnh thực tế app chạy | Đọc kết quả |
|---|---|---|---|
| Claude Code CLI | `claude` | `claude -p "<prompt>" --output-format json --permission-mode dontAsk --model sonnet` | JSON, trường `result` |
| Gemini CLI | `gemini` | `gemini -p "<prompt>" --output-format json -m <model>` | JSON, trường `response` |
| GitHub Copilot CLI | `copilot` | `copilot -p "<prompt>" -s --allow-all-tools --model=<model>` | stdout thuần (`-s` để bỏ log) |
| OpenAI Codex CLI | `codex` | `codex exec --skip-git-repo-check --output-last-message <file> -m <model> "<prompt>"` | file kết quả |
| CLI khác | tự điền | tự cấu hình hoàn toàn | tuỳ chọn |

Bản bóc băng luôn được đẩy qua **stdin**, nên video dài bao nhiêu cũng không đụng giới hạn
độ dài dòng lệnh của Windows.

**Tuỳ biến:** mọi thứ đều sửa được trong Cài đặt → AI: tên lệnh/đường dẫn, danh sách tham số,
model, thời gian chờ, transcript đi qua stdin hay tham số, kết quả đọc từ stdout/JSON/file.
Các chỗ thay thế dùng trong tham số:

| Placeholder | Ý nghĩa |
|---|---|
| `{prompt}` | hướng dẫn tóm tắt (system prompt) |
| `{model}` | model — **bỏ trống thì token này và cờ đứng ngay trước nó bị loại bỏ** |
| `{doc}` | toàn bộ bản bóc băng (khi chọn đưa vào bằng tham số) |
| `{docfile}` | đường dẫn file tạm chứa bản bóc băng |
| `{outfile}` | file tạm để CLI ghi kết quả (khi chọn đọc kết quả từ file) |

Ô **"Lệnh sẽ chạy"** hiển thị trước dòng lệnh cuối cùng để bạn kiểm tra. Nút
**Khôi phục preset gốc** đưa cấu hình về mặc định nếu sửa hỏng.

Điều kiện dùng được:

1. Mở terminal gõ `<lệnh> --version` phải ra số phiên bản.
2. Đăng nhập một lần bằng chính CLI đó.
3. Vào tab **Kiểm tra hệ thống** → dòng *CLI agent trên máy* phải xanh.

App tự dò lệnh trong PATH, `~/.local/bin`, `%LOCALAPPDATA%\Programs\...` và `%APPDATA%\npm`.
Không tìm ra thì điền đường dẫn tuyệt đối.

> **Claude Desktop không dùng được** — nó là app chat, không có giao diện dòng lệnh.
> App cố tình bỏ qua mọi đường dẫn `claude` nằm trong `WindowsApps` để không chạy nhầm rồi treo.

> **Các CLI này không nghe được audio.** Chúng chỉ làm phần tóm tắt/phân tích từ bản bóc băng
> đã có. Phần nghe video và tách người nói vẫn phải dùng Python (local) hoặc Gemini (API) ở mục 3.

### Cách B — API key

Chọn Claude / OpenAI / Gemini / GLM, dán key, đổi model nếu muốn.

Muốn tóm tắt cũng offline: chọn **Khác (OpenAI-compatible)** và trỏ về Ollama hoặc LM Studio,
ví dụ Base URL `http://localhost:11434/v1`, model `qwen2.5:14b`.

Tab **Prompt tóm tắt** cho phép sửa hướng dẫn gửi cho AI (ví dụ: tập trung vào rủi ro, vào số liệu...).

---

## 5. Luồng sử dụng

1. **Nhập video cuộc họp** — chọn 1 hoặc nhiều file mp4/mov/mkv/webm/mp3/wav… (đã tải sẵn trên máy).
2. Bấm **Bóc băng**. App sẽ: tách audio → tách người nói → bóc chữ → gán người nói cho từng câu.
3. Trong bảng **Người nói**, người chưa biết tên hiện là `user_1`, `user_2`, …
   **Click vào `user_(n)`** → nhập tên thật, vai trò, màu → **Lưu và ghi nhớ**.
   - Tên + *voiceprint* (vector đặc trưng giọng) được ghi vào `speakers.json`.
   - **Video sau có cùng giọng đó sẽ tự điền đúng tên.**
   - Bấm **Gợi ý tên** để AI dò trong hội thoại xem ai tự giới thiệu / được gọi tên.
4. Sửa nội dung: **nhấn đúp** vào một câu để sửa chữ; dùng ô select dưới tên để **đổi người nói** cho câu đó;
   nếu một người bị tách thành 2 giọng, mở dialog người nói → **Gộp**.
5. Bấm **Tóm tắt** — AI đọc toàn bộ hội thoại và trả về: chủ đề, người tham gia, quyết định,
   việc cần làm (kèm người phụ trách), vấn đề còn treo, từ khoá.
6. Bấm **Xuất** — chọn PDF, Word, Markdown, phụ đề hoặc text thuần (mục 5g).

Click vào mốc thời gian trong hội thoại để **nhảy tới đúng giây đó trong video**;
bật **Theo video** để hội thoại tự cuộn theo lúc phát.

Nhiều video một lượt thì dùng **hàng đợi** (mục 5d) — chọn hết rồi để máy chạy, không phải
ngồi canh từng cái. Bấm `?` để xem bảng phím tắt.

Đồng nghiệp cũng cần bản bóc băng này? Bấm **Chia sẻ** (mục 5h) — họ nhập file vào là xong,
không phải chạy lại 1–2 tiếng CPU.

---

## 5a. Sửa lại kết quả của AI

AI nghe sai chữ, gộp nhầm hai người vào một lượt, hay tóm tắt lệch ý là chuyện thường.
Mọi thứ đều sửa tay được, sửa xong lưu thẳng vào file JSON của dự án.

### Hội thoại

| Muốn làm gì | Thao tác |
|---|---|
| Tua video tới đoạn nào | **Bấm một cái vào dòng đó** |
| Sửa nội dung câu | Nhấn đúp vào chữ · Ctrl+Enter để lưu, Esc để huỷ |
| Đổi người nói cho một lượt | Ô chọn nhỏ dưới tên người nói (hiện khi rê chuột) |
| Đặt tên / đổi tên người nói | Bấm vào tên (`user_1`, `user_2`…) |
| **Tách một lượt thành nhiều người** | Nút kéo ✂ bên phải dòng |
| Gộp lượt này vào lượt trên | Nút mũi tên ↑ bên phải dòng |
| Xoá hẳn một lượt | Nút thùng rác bên phải dòng |

**Tách lượt nói** là thao tác hay cần nhất khi diarization gộp nhầm 2–3 người:

1. Bấm nút ✂ ở lượt bị gộp.
2. Đặt con trỏ vào đúng chỗ đổi người nói trong ô nội dung, bấm **Tách tại đây**.
   Dòng gợi ý bên cạnh cho thấy trước điểm cắt: `…phần trăm chị ạ. | Vâng nhưng chi phí…`
3. Chọn người nói cho từng phần.
4. Mốc thời gian được ước lượng theo vị trí chữ. Muốn **chính xác**: bấm **Nghe** để phát
   đúng đoạn đó, dừng video ngay chỗ đổi giọng, rồi bấm **Lấy từ video** — mốc lấy đúng
   thời điểm video đang dừng.
5. Cần 3 phần trở lên thì cứ tách tiếp phần vừa tạo.

### Tóm tắt

Bấm nút **Sửa** ở góc phải bản tóm tắt để chuyển sang chế độ chỉnh. Sửa được tiêu đề, câu
tóm tắt, người tham gia, từng chủ đề và từng ý, quyết định, việc cần làm (người phụ trách,
hạn), vấn đề còn treo, từ khoá — thêm/bớt từng dòng thoải mái.

Bản sửa tay được đánh dấu *"đã sửa tay"* kèm thời điểm. Bấm **Tóm tắt lại** sẽ để AI viết
lại từ đầu và **ghi đè** bản sửa tay, nên cân nhắc trước khi bấm.

> Bản xuất PDF luôn lấy nội dung mới nhất, nên cứ sửa cho đúng rồi mới xuất.

---

## 5b. Tạm dừng và chạy tiếp

Chạy local với `large-v3` trên CPU rất chậm — video 1 tiếng có thể mất 1–2 tiếng. Không cần
để máy chạy liên tục:

- Đang bóc băng, bấm **Tạm dừng** trên thanh trên cùng. App xử lý nốt câu đang dở rồi lưu
  tiến độ và dừng.
- Trạng thái đổi thành **Đang tạm dừng**, nút chính thành **Tiếp tục 23:05/1:01:40** (đã xong
  bao nhiêu / tổng bao nhiêu). Bấm là chạy tiếp từ đúng chỗ dở.
- Tắt app, **restart máy**, thậm chí **mất điện** — vẫn tiếp tục được. Tiến độ nằm trong file
  `checkpoint.json` của dự án, ghi lại sau mỗi ~5 giây audio, ghi kiểu atomic nên không hỏng
  file khi mất điện giữa lúc ghi.
- Mở app lần sau, dự án nào còn kẹt ở trạng thái "đang chạy" sẽ tự chuyển sang **Đang tạm dừng**
  để bấm Tiếp tục.
- Muốn bỏ tiến độ cũ và làm lại từ đầu: bấm **Làm lại**.

Những gì được giữ lại giữa các lần chạy:

| Thứ | Có giữ không |
|---|---|
| Âm thanh đã tách khỏi video | Có — không phải tách lại |
| Model đã tải về | Có — nằm trong cache HuggingFace |
| Kết quả tách người nói | Có — xong một lần là xong |
| Các câu đã bóc băng | Có — mất tối đa vài câu cuối |

Bản bóc băng dở vẫn đọc được ngay trong tab **Hội thoại** khi đang tạm dừng.

> Phần chạy qua API (Gemini/OpenAI) không có tạm dừng — nó vốn chỉ mất vài phút.

---

## 5b2. Cuộc họp dài: AI tự chia phần rồi tóm tắt từng phần

Bản bóc băng một cuộc họp 2–3 tiếng dài hơn cửa sổ ngữ cảnh của model, gửi một phát là gặp
`prompt is too long`. App tự xử lý, không cần làm gì:

1. **Chia theo lượt nói** — không bao giờ cắt giữa câu ai đang nói.
2. **Rút gọn từng phần** thành bản trung gian dạng chữ (nội dung đã bàn, quyết định, việc cần
   làm, vấn đề còn treo, ai đóng góp gì, số liệu đáng nhớ).
3. **Ghép các bản rút gọn** lại rồi mới sinh bản tóm tắt cuối. Họp cả ngày, ghép xong vẫn dài
   quá thì rút gọn thêm một vòng nữa.

Trong lúc chạy, thanh trạng thái hiện rõ đang ở đâu: *"Bản bóc băng dài 148k ký tự — chia làm
4 phần"* → *"Đang tóm tắt phần 2/4 (28:15 – 56:40)"* → *"Đang ghép 4 phần thành bản tóm tắt
chung"*. Bản tóm tắt xong có ghi **"ghép từ 4 phần"** ở dòng thông tin.

Mỗi phần đều được ghi mốc thời gian và danh sách người nói, nên bản tóm tắt cuối vẫn bám đúng
diễn biến trước sau chứ không thành một đống ý rời rạc.

**Nếu model vẫn kêu dài**: mỗi model một cửa sổ khác nhau, con số trong Cài đặt chỉ là phỏng
đoán. App tự chia nhỏ hơn nữa và thử lại (tối đa 3 lần, mỗi lần nhỏ đi 3 lần) rồi mới báo lỗi.

Chỉnh tay ở Cài đặt → **Prompt tóm tắt** → *Độ dài mỗi phần khi tóm tắt*:

| Giá trị | Nghĩa là |
|---|---|
| `45000` (mặc định) | ≈ 18k token mỗi phần, an toàn với mọi model |
| Nhỏ hơn | Model nhỏ / cửa sổ hẹp. Nhiều phần hơn = nhiều lượt gọi hơn = tốn hơn |
| Lớn hơn | Model cửa sổ lớn (Gemini 2.5 Pro, Claude Sonnet). Ít lượt gọi, bản tóm tắt sát nội dung hơn |
| `0` | **Tắt** tự chia, luôn gửi một lần — họp dài sẽ lỗi |

> Cuộc họp ngắn vẫn được gửi **một lần duy nhất** như trước, không tốn thêm lượt gọi nào.
> Chỉ khi vượt ngưỡng app mới chia.

---

## 5c. Danh bạ giọng nói dùng chung cho mọi cuộc họp

Đặt tên một người **một lần**, các cuộc họp sau tự điền đúng tên người đó.

Cách hoạt động: mỗi lượt nói được pyannote trích ra một *voiceprint* (vector 512 chiều). Khi
bạn bấm **Lưu và ghi nhớ**, tên + voiceprint vào `speakers.json`. Video sau, app so cosine
giữa giọng mới và từng giọng đã biết; vượt **Ngưỡng nhận ra giọng cũ** (mặc định 0.72) thì
gán luôn tên đó.

Ba điều đáng biết:

- **Học dần, không ghi đè.** Mỗi lần gặp lại một người, voiceprint được trộn theo trung bình
  có trọng số với số lần đã gặp (`seen`), chặn trọng số ở 8 để vẫn thích nghi được khi bạn
  đổi mic. Nhờ vậy một hôm bị ốm khàn tiếng hay một lượt lẫn tiếng ồn **không phá được** mẫu
  giọng đã học tốt — kiểu ghi đè cũ thì một mẫu rác là mất luôn.
- **Gộp hai giọng cùng một người.** Cài đặt → tab **Danh bạ giọng nói** → chọn người → **Gộp vào**.
  Hay cần khi cùng một người bị tách thành 2 mục vì họp bằng 2 thiết bị khác nhau. Gộp thì
  voiceprint được trộn theo số lần gặp, giữ lại bên đã có tên, và **mọi cuộc họp cũ** cũng
  được cập nhật theo.
- **Ngưỡng bao nhiêu là đúng?** Nhận sai người → tăng lên 0.78–0.82 (khắt khe hơn, thà để
  `user_n` còn hơn gán sai). Cùng một người mà cứ ra `user_n` mới → giảm về 0.65–0.70.

Danh bạ nằm gọn trong `speakers.json`, xoá từng người hoặc xoá cả file đều được.

---

## 5d. Xếp hàng nhiều cuộc họp

Có 5 video cần bóc băng thì không phải ngồi canh từng cái. Chọn nhiều dự án → **Thêm vào hàng đợi**.

- App chạy **lần lượt một cái một** — chạy song song trên CPU chỉ làm cả hai chậm hơn.
- Dự án đang chờ hiện trạng thái **Trong hàng đợi** kèm số thứ tự; bấm ✕ để lấy ra khỏi hàng.
- Một dự án lỗi **không làm dừng cả hàng** — nó ghi lỗi rồi sang cái tiếp theo.
- Cài đặt được đọc lại ở đầu mỗi dự án, nên đang chạy hàng đợi mà đổi model vẫn có tác dụng
  cho những cái sau.
- Kết hợp được với tạm dừng: bấm **Tạm dừng** thì cái đang chạy dừng lại, hàng đợi dừng theo.

Thực tế hay dùng: tối bỏ hết video của tuần vào hàng đợi, sáng mai lên đọc.

---

## 5e. Tìm kiếm và thay thế

| Muốn gì | Ở đâu |
|---|---|
| Tìm trong cuộc họp đang mở | Ô tìm trên đầu tab Hội thoại, hoặc `Ctrl/⌘+F` |
| Thay hàng loạt một từ bị nghe sai | `Ctrl/⌘+H` → thanh **Tìm & thay thế** |
| Tìm trong **tất cả** cuộc họp đã lưu | `Ctrl/⌘+Shift+F` |

**Tìm & thay thế** là thứ tiết kiệm nhiều thời gian nhất khi AI nghe sai một tên riêng: nó
sai *nhất quán* cả buổi, nên sửa một lần là xong. Thanh này đếm sẵn số chỗ khớp trước khi
bạn bấm, có tuỳ chọn **phân biệt hoa/thường** và **đúng cả từ** (không sửa `KYC` bên trong
`KYCv2`). Thay xong vẫn `Ctrl/⌘+Z` lùi lại được nếu thấy sai.

**Tìm trong tất cả cuộc họp** trả về kết quả nhóm theo từng cuộc họp, phân biệt chỗ tìm thấy
nằm trong hội thoại hay trong bản tóm tắt; bấm vào là mở cuộc họp đó và tua tới đúng giây.
Càng dùng lâu đây càng là giá trị chính của app: *"ba tháng nay ai nói gì về KYC"*.

---

## 5f. Hoàn tác

Mọi thao tác **sửa tay** đều lùi lại được bằng `Ctrl/⌘+Z` hoặc nút ↺ trên thanh trên cùng
(nút hiện tên thao tác sẽ bị lùi, ví dụ *"tách lượt nói"*). Nhớ 25 bước gần nhất cho mỗi
cuộc họp.

Lùi được: sửa chữ, tách / gộp / xoá lượt nói, đổi người nói, đổi tên người, thay thế hàng
loạt, sửa tóm tắt.

Không lùi được: kết quả do pipeline sinh ra (bóc băng lại, tóm tắt lại) — những cái đó chạy
lại là có. Lịch sử nằm trong RAM nên **tắt app là mất**; đây là lưới an toàn cho những cú
bấm sai, không phải bản lưu phiên bản.

---

## 5g. Xuất ra định dạng khác PDF

Nút **Xuất** → chọn định dạng:

| Định dạng | Dùng khi |
|---|---|
| **PDF** | Bản báo cáo chính thức, có bố cục đẹp |
| **Word (.docx)** | Gửi cấp trên, còn sửa tiếp — file .docx thật, có heading, bullet, bảng việc cần làm |
| **Phụ đề (.srt)** | Gắn lại lên video, mỗi lượt một dòng kèm `[Tên người]` |
| **Phụ đề web (.vtt)** | Cho player HTML5 trên web |
| **Markdown (.md)** | Dán vào Notion, wiki, GitHub |
| **Text thuần (.txt)** | Dán vào chat, email. Không in mốc thời gian thì các lượt liền nhau của cùng một người được gộp lại cho dễ đọc |

Mốc thời gian quá 1 tiếng vẫn đúng giờ (`01:01:01,750`), và bản xuất luôn lấy nội dung mới
nhất — kể cả phần bạn vừa sửa tay.

---

## 5h. Chia sẻ cuộc họp cho người khác

Đây là chỗ tiết kiệm nhiều thời gian nhất khi cả team dùng app: bóc băng 1 tiếng video
mất 1–2 tiếng CPU, còn gửi file thì mất 5 giây. **Đồng nghiệp không phải bóc băng lại.**

### Người gửi

1. Mở cuộc họp → bấm **Chia sẻ** trên thanh trên cùng.
2. Tick những cuộc họp muốn gửi (gửi được nhiều cuộc họp trong một file).
3. Điền tên mình vào **Tên người gửi** (không bắt buộc) — người nhận sẽ thấy khi xem trước gói.
4. Bấm **Tạo file chia sẻ**, chọn chỗ lưu.
5. App mở sẵn thư mục chứa file. **Kéo thẳng vào cửa sổ chat Teams/Zalo**, hoặc bỏ vào
   thư mục Google Drive / OneDrive đã sync trên máy là xong.

### Người nhận

1. Tải file `.meetsum` về máy.
2. Mở MeetSum → **Nhập gói được chia sẻ** ở cột trái → chọn file.
3. App hiện **xem trước**: ai gửi, gửi ngày nào, mấy cuộc họp, mỗi cuộc họp bao nhiêu lượt
   nói, có những ai, có kèm mẫu giọng nói không. Xem xong mới bấm **Nhập**.
4. Nhập rồi thì sửa được mọi thứ như cuộc họp tự bóc băng: sửa chữ, tách lượt, đổi tên,
   tóm tắt lại, xuất PDF, chia sẻ tiếp cho người khác.

### Trong gói có gì

| Có | Không có |
|---|---|
| Toàn bộ hội thoại kèm mốc thời gian | **Video** — hàng GB, và người nhận thường không cần |
| Tên + vai trò người nói | Đường dẫn thư mục trên máy người gửi (chỉ giữ tên file video) |
| Bản tóm tắt | Ghi chú riêng — **mặc định không kèm**, muốn gửi thì tick riêng |
| Mẫu giọng nói (voiceprint) của những người trong cuộc họp | API key, cài đặt của bạn |

Một cuộc họp 1 tiếng ra file khoảng **vài trăm KB** — Zalo, Teams, Gmail đều gửi được thoải mái.

### Mẫu giọng nói khi nhập vào

Gói có kèm voiceprint, nên sau khi nhập, **những cuộc họp mà người nhận tự bóc băng về sau
cũng tự điền đúng tên** những người này. Cả team dần dùng chung một danh bạ giọng nói mà
không ai phải làm gì thêm.

Cách xử lý khi trùng:

- Giọng trong gói khớp với người **bạn đã đặt tên** → giữ **tên của bạn**, và app báo lại
  chỗ nào bị đổi (ví dụ *"Quỳnh → Chị Quỳnh (BOD)"*). Bạn biết đồng nghiệp mình hơn, mà tên
  đó đang dùng ở các cuộc họp khác của bạn rồi.
- Mẫu giọng được **trộn** theo số lần gặp của cả hai bên, không ghi đè — nhận gói nhiều lần
  cũng không làm lệch mẫu giọng đã học tốt.
- Những người **khác nhau trong cùng một gói** thì luôn giữ khác nhau. Người gửi đã tách họ
  ra rồi, app không tự gộp lại.
- Không muốn nhận voiceprint thì tắt công tắc trong hộp thoại nhập — vẫn nhập được nội dung.

### Cuộc họp nhập về không có video

Đúng như thiết kế. Khung phát sẽ ghi rõ *"nhập từ gói chia sẻ nên không kèm video"* kèm tên
file video gốc, và nút **Bóc băng** bị tắt (không có video thì không có gì để bóc).

Nếu bạn tình cờ **có sẵn file video đó** trên máy: bấm **Tôi có file video này** rồi chọn
file. Từ đó bấm vào lượt nói là tua tới đúng giây, và bóc băng lại được nếu muốn.

Cuộc họp nhập từ gói có nhãn **chia sẻ** ở cột trái để phân biệt với cuộc họp bạn tự bóc băng.

### Cần biết trước

> Nội dung trong file nằm **dạng chữ thường**, ai mở bằng Notepad cũng đọc được toàn bộ hội
> thoại. Cố tình làm vậy để 5 năm sau vẫn đọc được không cần app. Nghĩa là: **đừng gửi qua
> kênh mà bạn không gửi chính cuộc họp đó qua.** Cuộc họp nhạy cảm thì nén có mật khẩu trước
> khi gửi, hoặc chỉ gửi trong kênh nội bộ.

Nhập lại đúng gói đã nhập trước đó thì app **tự nhận ra** và bỏ tick cuộc họp đó, kèm cảnh
báo — tick lại thì sẽ tạo thêm một bản nữa, bản cũ vẫn giữ nguyên.

Gói được đánh số phiên bản định dạng. Gói tạo bởi bản app mới hơn sẽ được báo *"hãy cập nhật
app rồi thử lại"* thay vì đọc bừa rồi hỏng dữ liệu.

---

## 6. Dữ liệu được lưu ở đâu

| Đường dẫn | Nội dung |
|---|---|
| `%APPDATA%\meetsum\MeetSumData\` (Windows)<br>`~/Library/Application Support/meetsum/MeetSumData/` (macOS) | Thư mục gốc dữ liệu |
| `settings.json` | Cài đặt, prompt, và **API key / token đã được mã hoá** |
| `speakers.json` | **Danh bạ giọng nói**: tên + voiceprint, dùng để nhận ra người nói ở video sau |
| `projects/<id>/project.json` | Một cuộc họp: đường dẫn video, người nói, toàn bộ hội thoại, tóm tắt, ghi chú |
| `projects/<id>/work/` | audio tạm, kết quả thô của engine, file HTML trung gian của PDF |
| `exports/` | PDF và gói `.meetsum` xuất ra (khi không tự chọn nơi lưu) |

Muốn backup hoặc chuyển máy: copy cả thư mục `MeetSumData`. Muốn xoá sạch: xoá thư mục đó.

**Về API key và token:** chúng không còn nằm dạng chữ thường trong `settings.json`. Trước khi
ghi xuống file, app mã hoá bằng **Keychain** (macOS) / **DPAPI** (Windows) qua `safeStorage`
của Electron, giá trị trên đĩa có tiền tố `enc:v1:`. Nghĩa là:

- Ai đọc được file `settings.json` (đồng bộ cloud, backup, người khác dùng chung máy) **cũng
  không đọc ra được key**.
- Key được khoá theo **tài khoản người dùng trên máy đó**. Copy `MeetSumData` sang máy khác
  thì mọi thứ khác vẫn dùng được, riêng key trở về rỗng — nhập lại một lần là xong. App
  **không** báo lỗi hay không mở được vì chuyện này.
- Cài cũ đang lưu key dạng chữ thường sẽ tự được mã hoá ở lần lưu cài đặt kế tiếp.
- Máy Linux không có keyring thì tự động quay về lưu chữ thường thay vì chặn không cho dùng.

---

## 6b. Phím tắt

Bấm `?` ở bất cứ đâu để mở bảng phím tắt. Soát lại bản bóc băng bằng bàn phím nhanh hơn
dùng chuột rất nhiều.

| Phím | Việc |
|---|---|
| `Space` / `K` | Phát / dừng |
| `J` / `L` | Lùi / tiến 5 giây |
| `←` / `→` | Lùi / tiến 2 giây |
| `1` … `9` | Nhảy tới 10% … 90% thời lượng |
| `N` / `P` | Lượt nói sau / trước (video tua theo) |
| `E` | Sửa nội dung lượt đang phát |
| `Ctrl/⌘+F` | Nhảy vào ô tìm kiếm trong cuộc họp này |
| `Ctrl/⌘+H` | Mở thanh tìm & thay thế |
| `Ctrl/⌘+Shift+F` | Tìm trong tất cả cuộc họp |
| `Ctrl/⌘+Z` | Hoàn tác thao tác sửa tay gần nhất |
| `Ctrl/⌘+S` | Lưu ghi chú (ở tab Ghi chú) |
| `?` | Bảng phím tắt |
| `Esc` | Đóng hộp thoại / huỷ đang sửa |

Phím tắt tự tắt khi bạn đang gõ trong ô nhập hoặc đang có hộp thoại mở, nên không bao giờ
"ăn" mất chữ đang gõ.

---

## 7. Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| “Không phát được video này trong app” | Codec Chromium không đọc được (ví dụ H.265, một số MKV). Bóc băng & tóm tắt **vẫn chạy bình thường** vì dùng ffmpeg. |
| `Không tìm thấy Python chạy được pipeline.py` | Thông báo lỗi sẽ liệt kê từng lệnh đã thử và lý do. Cài Python 3.10–3.12 từ python.org (tick *Add python.exe to PATH*), hoặc Cài đặt → **Đường dẫn Python** trỏ trực tiếp tới `python.exe`, hoặc chuyển engine sang **Qua API**. |
| `Python ... chưa có thư viện cần thiết` | Copy đúng lệnh `pip install` trong thông báo và chạy. Nếu máy có nhiều bản Python, dùng đúng đường dẫn app báo. |
| pyannote lỗi tải model | Kiểm tra đã *Agree* điều khoản 2 model và token còn hiệu lực. |
| Chỉ ra 1 người nói | Bật **Tách người nói**; nếu vẫn vậy, đặt **Số người nói** = số thật rồi bóc băng lại. |
| Nhận sai người ở video mới | Giảm/tăng **Ngưỡng nhận ra giọng cũ** (mặc định 0.72). Cao hơn = khắt khe hơn. |
| Bóc băng rất chậm trên CPU | Kiểm tra trước: **Kiểm tra hệ thống** → dòng Python có ghi `dùng hết số nhân` và `lô 8` không. Nếu chưa, vào Cài đặt → Bóc băng đặt **Số luồng CPU = 0** và **batch = 8**. Sau đó mới nghĩ tới đổi model sang `medium`/`small`, hoặc dùng GPU / API. |
| Bật chia lô thấy nghe sai nhiều hơn | Chia lô xử lý từng khúc độc lập nên mất chút ngữ cảnh. Đặt **batch = 0** để về chạy tuần tự. |
| Bật chia lô bị hết RAM | Giảm batch xuống 4 hoặc 2, hoặc đặt 0 để tắt. |
| Tóm tắt lỗi JSON | Thông báo hiện luôn đoạn model đã trả về. Thường do model quá nhỏ — đổi sang Claude Sonnet, GPT-4.1, Gemini 2.5 Pro, GLM-4.6. Dùng CLI thì kiểm tra thêm "Đọc kết quả từ" và tên trường JSON. |
| `prompt is too long` khi tóm tắt | App tự chia phần rồi thử lại. Nếu vẫn lỗi: Cài đặt → Prompt tóm tắt → giảm **Độ dài mỗi phần khi tóm tắt** (xem mục 5b2). |
| CLI báo lỗi kèm một khối JSON toàn số 0 | `terminal_reason: api_error` + 0 token = request chưa tới được model. Theo thứ tự: hết lượt dùng trong khung giờ → phiên đăng nhập hết hạn → mạng/VPN/proxy. Thử `claude -p "xin chào"` trong terminal: cũng lỗi thì vấn đề ở CLI, không phải MeetSum. |
| Tóm tắt chạy rất lâu, thấy "Đang tóm tắt phần 3/9" | Bình thường với cuộc họp dài — app đang tóm tắt từng phần. Cứ để chạy. |
| `Cannot read properties of undefined (reading 'pipeline')` | Bạn đang mở `localhost:5173` bằng Chrome/Edge. Phải dùng **cửa sổ MeetSum** mà `pnpm run dev` tự mở ra. |
| Ngại vụ token HuggingFace | Cài đặt → Bóc băng → đổi backend sang **VibeVoice-ASR**: không gated, không cần token. |
| VibeVoice: `chưa chạy được VibeVoice-ASR` | Thiếu transformers hoặc bản cũ. Chạy `pip install -U "transformers>=5.14" torch torchaudio`. |
| VibeVoice: cuộc họp dài ra quá nhiều người nói | Không có voiceprint để ghép người giữa các đoạn. Cài `pyannote.audio` (không cần token), hoặc bấm **Gộp** để nhập những người trùng lại. |
| `GatedRepoError: 401 Client Error` | Chưa xin quyền / chưa có token HuggingFace cho pyannote. Xem mục 3, Cách A. Nhớ bấm *Agree* ở **cả** `speaker-diarization-3.1` **và** `segmentation-3.0`. |
| `Không tìm thấy CLI "<tên>"` | Gõ `<tên> --version` trong terminal. Không ra gì thì CLI chưa cài / chưa vào PATH — điền đường dẫn tuyệt đối ở Cài đặt → AI. |
| `<CLI> chưa đăng nhập` | Mở terminal, chạy chính lệnh đó một lần và đăng nhập, rồi thử lại. |
| CLI chạy xong nhưng không trả về nội dung | Sai kiểu đọc kết quả. Với CLI không có JSON output thì đổi "Đọc kết quả từ" sang **stdout**; với JSON thì kiểm tra lại tên trường. |
| CLI treo không xong | Nó đang chờ xác nhận quyền. Thêm cờ tự động duyệt của CLI đó vào phần tham số (ví dụ `--allow-all-tools`, `--yolo`). |
| Windows chặn không cho cài | SmartScreen chặn app chưa ký. Bấm **More info → Run anyway**, hoặc chạy thẳng `dist\win-unpacked\MeetSum.exe`, hoặc ký số theo mục 2b. |
| Build in ra chữ đỏ nhưng vẫn ra file | Không phải lỗi. PowerShell tô đỏ mọi thứ ghi ra stderr, mà vite/electron-builder ghi log ở đó. Kiểm tra bằng `$LASTEXITCODE` — ra `0` là thành công. |
| Build lỗi `Cannot create symbolic link` | Xem mục **Lỗi hay gặp khi build trên Windows** ở phần 2. |
| Sửa sai, muốn lùi lại | `Ctrl/⌘+Z` hoặc nút ↺ trên thanh trên cùng. Nhớ 25 bước, nhưng **mất khi tắt app**. |
| Cùng một người ra 2 mục trong danh bạ | Cài đặt → **Danh bạ giọng nói** → chọn người → **Gộp vào**. Mọi cuộc họp cũ cũng được cập nhật theo. |
| Nhập lại API key mà app vẫn báo chưa có | Bạn vừa copy `MeetSumData` từ máy khác. Key được mã hoá theo tài khoản máy cũ nên không giải mã được — nhập lại một lần là xong. |
| Tab Cập nhật báo `Không đọc được danh sách phát hành` | Repo đang riêng tư. Điền GitHub token (quyền đọc repo) ở tab đó. |
| macOS: có bản mới nhưng không có nút cài | Đúng như thiết kế — bản không ký Developer ID không tự cài được. Bấm **Mở trang tải về** rồi thay `.dmg` thủ công. |
| Xuất .docx báo lỗi | Thiếu package `docx`. Chạy `pnpm install` lại rồi build. |
| `ERR_PACKAGE_PATH_NOT_EXPORTED ... './module-runner'` khi chạy test | Xung đột phiên bản: `vitest` 4 cần vite ≥ 6, mà dự án dùng vite 5 (vì `electron-vite` 2.3 chỉ nhận vite ^4/^5). Đã ghim `vitest` về `^3.2.7` — chạy `pnpm install` lại. |
| Test chạy được bằng npm nhưng lỗi bằng pnpm | Đúng như thiết kế của pnpm: nó dựng cây thư mục chặt nên bắt được xung đột peer, còn npm hoisting thì che đi. Tin pnpm, đừng đổi sang npm để né. |
| `File này không phải gói MeetSum` | Chọn nhầm file, hoặc file tải từ Zalo/Teams bị dở. Tải lại rồi thử. |
| `Gói này được tạo bởi bản MeetSum mới hơn` | Người gửi dùng bản mới hơn bạn. Cài đặt → Cập nhật → kiểm tra bản mới. |
| Nhập gói xong nhưng không xem lại được video | Đúng như thiết kế, gói không kèm video. Có sẵn file video thì bấm **Tôi có file video này** ở khung phát. |
| Nhập gói xong tên người nói khác tên người gửi đặt | Tên bạn đã đặt trong danh bạ được ưu tiên. Muốn theo tên người gửi thì bấm vào tên để sửa lại. |
| Nhập gói mà nút Bóc băng bị mờ | Cuộc họp nhập về không có video trên máy bạn nên không có gì để bóc. |

---

## 7b. Cập nhật app

Cài đặt → tab **Cập nhật**.

- App tự **kiểm tra** bản mới trên GitHub Releases khi mở (tắt được bằng công tắc). Chỉ kiểm
  tra rồi báo, **không bao giờ tự tải** — để không ngốn mạng lúc đang bóc băng.
- **Windows:** bấm **Tải bản mới** → có thanh tiến độ → xong bấm **Cài và mở lại app**.
  Chạy được vì `verifyUpdateCodeSignature: false` trong `electron-builder.yml` (bản nội bộ
  ký bằng chứng chỉ tự tạo, không phải chứng chỉ mua của CA).
- **macOS:** Squirrel.Mac **bắt buộc** app phải ký bằng Apple Developer ID mới cho tự cài,
  nên bản nội bộ không tự cài được. App sẽ báo có bản mới và mở trang tải; bạn tải `.dmg`
  rồi kéo vào Applications như lần đầu. Nói thẳng vậy còn hơn để nó báo lỗi khó hiểu.
- Repo `nhQing/meet-sum` đang ở chế độ **riêng tư** thì phải điền **GitHub token** (chỉ cần
  quyền đọc repo) vào tab này, không thì không đọc được danh sách phát hành. Token được mã
  hoá như API key (xem mục 6).
- Chạy `pnpm run dev` thì không kiểm tra — app báo rõ "đang chạy bản dev".

### Người phát hành làm gì

```bash
# Đổi version trong package.json trước (ví dụ 1.0.0 -> 1.0.1)
$env:GH_TOKEN = "ghp_..."      # PowerShell; macOS/Linux: export GH_TOKEN=...
pnpm run release:win            # build + upload lên GitHub Releases
pnpm run release:mac
```

Lệnh này đẩy cả file cài **và** file `latest.yml` / `latest-mac.yml` — app của mọi người đọc
đúng file đó để biết có bản mới. Chỉ chạy `pnpm run build:win` như cũ thì máy khác **không**
nhận được thông báo cập nhật.

---

## 8. Cấu trúc mã nguồn

```
src/
  shared/types.ts          Kiểu dữ liệu dùng chung
  main/                    Electron main process
    index.ts               Tạo cửa sổ, đăng ký protocol & IPC
    ipc/index.ts           Toàn bộ IPC handler
    lib/
      paths.ts store.ts    Đọc/ghi JSON (atomic), danh bạ giọng nói
      ffmpeg.ts            Tách / nén / cắt audio
      localEngine.ts       Gọi pipeline Python & whisper.cpp
      apiEngine.ts         Gemini (có diarization) + OpenAI Whisper
      merge.ts             Gán người nói cho từng câu, so khớp voiceprint
      llm.ts summarize.ts  Gọi LLM, tóm tắt, gợi ý tên, suy luận lượt nói
      pdf.ts               Sinh HTML báo cáo + printToPDF
      mediaProtocol.ts     Protocol meetsum:// phát video local (hỗ trợ tua)
      voice.ts             Cosine, chuẩn hoá, trộn voiceprint (học dần thay vì ghi đè)
      history.ts           Hoàn tác các thao tác sửa tay (25 bước, trong RAM)
      exporters.ts         Xuất .srt / .vtt / .md / .txt / .docx
      updater.ts           Kiểm tra & cài bản mới qua GitHub Releases
      bundle.ts            Đóng gói / đọc / nhập file .meetsum để chia sẻ giữa các máy
python/pipeline.py         3 backend local: faster-whisper + pyannote, VibeVoice-ASR, whisper.cpp
      pipeline.ts          Điều phối, hàng đợi tuần tự, checkpoint tạm dừng/tiếp tục
  preload/index.ts         Cầu nối an toàn (contextBridge) -> window.api
  renderer/                UI React + Tailwind
python/pipeline.py         faster-whisper + pyannote + trích voiceprint
test/                      Test cho phần logic thuần (vitest)
scripts/                   Script PowerShell ký số cho bản Windows nội bộ
```

### Chạy test

```bash
pnpm test          # chạy một lượt
pnpm run test:watch
pnpm run typecheck # TypeScript strict, cả main và renderer
```

Test phủ các phần logic thuần, không cần Electron thật: trộn voiceprint, dựng dòng lệnh cho
CLI agent, mồi thuật ngữ, các bộ xuất file, so sánh phiên bản. `electron` được thay bằng bản
giả trong `test/stubs/electron.ts`.

Bộ test này đã bắt được lỗi thật: với CLI dùng cờ dạng `--model={model}`, khi để trống Model
thì hàm dựng tham số xoá lây cả cờ đứng trước — đúng lúc đó là cờ `-s` của Copilot CLI, làm
Copilot in thêm log và app đọc sai kết quả.
