# MeetSum — Hướng dẫn cài đặt & sử dụng

Ứng dụng desktop (Windows / macOS) để **bóc băng video cuộc họp đã tải sẵn**, **tách và đặt tên người nói**,
**tóm tắt bằng AI** và **xuất báo cáo PDF**.

- Không có database, không có server. Mọi thứ là **file JSON trên máy bạn**.
- Video **chỉ được đọc tại chỗ** (import đường dẫn), app không copy video đi đâu.
- Có thể chạy **100% offline** (local engine + LLM local), hoặc dùng API của Claude / Gemini / GPT / GLM.

---

## 1. Chạy thử nhanh (dev mode)

Cần: **Node.js 20+** và **Git**.

```bash
npm install
npm run dev
```

`ffmpeg` đã được nhúng sẵn trong app (qua `@ffmpeg-installer/ffmpeg`), bạn không cần cài riêng.

## 2. Đóng gói thành file cài đặt

```bash
npm run build:win     # Windows -> dist/MeetSum-1.0.0-win-x64.exe (NSIS installer)
npm run build:mac     # macOS   -> dist/MeetSum-1.0.0-mac-arm64.dmg (và x64)
npm run build:dir     # chỉ build thư mục, không tạo installer (test nhanh)
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

> macOS: nếu chưa có Apple Developer ID, file .dmg sẽ không được ký. Lần đầu mở cần
> chuột phải → Open, hoặc `xattr -dr com.apple.quarantine /Applications/MeetSum.app`.

---

## 2b. Ký số cho nội bộ (bỏ cảnh báo "Unknown publisher")

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

Cần Python 3.9–3.12 trên máy:

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

Tuỳ chọn khác: nếu bạn đã có **whisper.cpp**, chọn backend `whisper.cpp` rồi trỏ tới
`whisper-cli(.exe)` và file model `ggml-large-v3.bin`.

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
6. Bấm **Xuất PDF** — chọn có kèm bản bóc băng đầy đủ và mốc thời gian hay không.

Click vào mốc thời gian trong hội thoại để **nhảy tới đúng giây đó trong video**;
bật **Theo video** để hội thoại tự cuộn theo lúc phát.

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

## 6. Dữ liệu được lưu ở đâu

| Đường dẫn | Nội dung |
|---|---|
| `%APPDATA%\meetsum\MeetSumData\` (Windows)<br>`~/Library/Application Support/meetsum/MeetSumData/` (macOS) | Thư mục gốc dữ liệu |
| `settings.json` | Cài đặt, API key, prompt |
| `speakers.json` | **Danh bạ giọng nói**: tên + voiceprint, dùng để nhận ra người nói ở video sau |
| `projects/<id>/project.json` | Một cuộc họp: đường dẫn video, người nói, toàn bộ hội thoại, tóm tắt, ghi chú |
| `projects/<id>/work/` | audio tạm, kết quả thô của engine, file HTML trung gian của PDF |
| `exports/` | PDF xuất ra (khi không tự chọn nơi lưu) |

Muốn backup hoặc chuyển máy: copy cả thư mục `MeetSumData`. Muốn xoá sạch: xoá thư mục đó.

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
| Bóc băng rất chậm trên CPU | Đổi **Kích thước model** sang `medium` hoặc `small`, hoặc dùng GPU / API. |
| Tóm tắt lỗi JSON | Model quá nhỏ. Dùng model mạnh hơn (Claude Sonnet, GPT-4.1, Gemini 2.5 Pro, GLM-4.6). |
| `Cannot read properties of undefined (reading 'pipeline')` | Bạn đang mở `localhost:5173` bằng Chrome/Edge. Phải dùng **cửa sổ MeetSum** mà `npm run dev` tự mở ra. |
| `GatedRepoError: 401 Client Error` | Chưa xin quyền / chưa có token HuggingFace cho pyannote. Xem mục 3, Cách A. Nhớ bấm *Agree* ở **cả** `speaker-diarization-3.1` **và** `segmentation-3.0`. |
| `Không tìm thấy CLI "<tên>"` | Gõ `<tên> --version` trong terminal. Không ra gì thì CLI chưa cài / chưa vào PATH — điền đường dẫn tuyệt đối ở Cài đặt → AI. |
| `<CLI> chưa đăng nhập` | Mở terminal, chạy chính lệnh đó một lần và đăng nhập, rồi thử lại. |
| CLI chạy xong nhưng không trả về nội dung | Sai kiểu đọc kết quả. Với CLI không có JSON output thì đổi "Đọc kết quả từ" sang **stdout**; với JSON thì kiểm tra lại tên trường. |
| CLI treo không xong | Nó đang chờ xác nhận quyền. Thêm cờ tự động duyệt của CLI đó vào phần tham số (ví dụ `--allow-all-tools`, `--yolo`). |
| Windows chặn không cho cài | SmartScreen chặn app chưa ký. Bấm **More info → Run anyway**, hoặc chạy thẳng `dist\win-unpacked\MeetSum.exe`, hoặc ký số theo mục 2b. |
| Build in ra chữ đỏ nhưng vẫn ra file | Không phải lỗi. PowerShell tô đỏ mọi thứ ghi ra stderr, mà vite/electron-builder ghi log ở đó. Kiểm tra bằng `$LASTEXITCODE` — ra `0` là thành công. |
| Build lỗi `Cannot create symbolic link` | Xem mục **Lỗi hay gặp khi build trên Windows** ở phần 2. |

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
  preload/index.ts         Cầu nối an toàn (contextBridge) -> window.api
  renderer/                UI React + Tailwind
python/pipeline.py         faster-whisper + pyannote + trích voiceprint
```
