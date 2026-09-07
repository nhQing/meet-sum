#!/usr/bin/env python3
"""
MeetSum local pipeline
======================
Bóc băng (ASR) + tách người nói (diarization) + trích voiceprint, chạy hoàn toàn offline.

Cách dùng:
  python pipeline.py --audio audio.wav --out result.json --mode full \
      --language vi --model-size large-v3 --device auto --num-speakers 0

--mode:
  full     : ASR (faster-whisper) + diarization (pyannote) + embedding
  asr      : chỉ ASR
  diarize  : chỉ diarization + embedding
  check    : kiểm tra thư viện đã cài chưa (in JSON rồi thoát)

Cài đặt phụ thuộc:
  pip install faster-whisper
  pip install "pyannote.audio>=3.1" torch torchaudio      (tuỳ chọn, cho diarization)

Tiến độ được in ra stderr dạng:  PROGRESS <stage> <percent> <message>
Kết quả cuối in ra stdout dạng JSON.
"""
import argparse
import json
import os
import sys
import traceback


def progress(stage, percent, message=""):
    sys.stderr.write(f"PROGRESS {stage} {int(percent)} {message}\n")
    sys.stderr.flush()


def has_module(name):
    try:
        __import__(name)
        return True
    except Exception:
        return False


def _has_vibevoice():
    """transformers >= 5.14 mới có lớp VibeVoiceAsr."""
    try:
        import transformers  # noqa: F401
        from transformers import VibeVoiceAsrForConditionalGeneration  # noqa: F401

        return True
    except Exception:
        return False


def do_check():
    info = {
        "python": sys.version.split()[0],
        "faster_whisper": has_module("faster_whisper"),
        "pyannote": has_module("pyannote.audio"),
        "transformers": has_module("transformers"),
        "vibevoice": _has_vibevoice(),
        "soundfile": has_module("soundfile"),
        "torch": has_module("torch"),
        "numpy": has_module("numpy"),
        "cpu_count": os.cpu_count() or 0,
    }
    if info["torch"]:
        try:
            import torch

            info["cuda"] = bool(torch.cuda.is_available())
            info["torch_version"] = torch.__version__
        except Exception:
            info["cuda"] = False
    print(json.dumps(info, ensure_ascii=False))


def load_checkpoint(path):
    """Đọc tiến độ đã lưu. Hỏng hoặc chưa có thì coi như bắt đầu từ đầu."""
    empty = {"segments": [], "turns": [], "embeddings": {}, "asr_done_sec": 0.0, "diar_done": False}
    if not path or not os.path.exists(path):
        return empty
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        for k, v in empty.items():
            data.setdefault(k, v)
        return data
    except Exception:
        return empty


def save_checkpoint(path, data):
    """Ghi kiểu atomic: ghi file tạm rồi đổi tên, để mất điện giữa chừng không hỏng file."""
    if not path:
        return
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False)
        os.replace(tmp, path)
    except Exception as exc:
        sys.stderr.write("WARN ghi checkpoint: %s\n" % exc)


def stop_requested(stop_file):
    return bool(stop_file) and os.path.exists(stop_file)


def classify_error(exc):
    """Đổi lỗi thư viện thành mã máy đọc được để phía app hiển thị hướng dẫn tiếng Việt."""
    text = f"{type(exc).__name__}: {exc}"
    low = text.lower()
    if "gatedrepo" in low or "401" in low or "gated repo" in low or "is restricted" in low:
        return "HF_GATED|" + text
    if "connectionerror" in low or "max retries" in low or "getaddrinfo" in low:
        return "HF_OFFLINE|" + text
    if "out of memory" in low or "cuda" in low and "memory" in low:
        return "OOM|" + text
    return "OTHER|" + text


def pick_device(requested):
    if requested and requested != "auto":
        return requested
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


# Dung lượng model faster-whisper, dùng để ước lượng % khi tải lần đầu (MB).
FW_MODEL_MB = {
    "tiny": 75,
    "tiny.en": 75,
    "base": 145,
    "base.en": 145,
    "small": 484,
    "small.en": 484,
    "medium": 1530,
    "medium.en": 1530,
    "large-v1": 3090,
    "large-v2": 3090,
    "large-v3": 3090,
    "large": 3090,
    "distil-large-v3": 1510,
    "turbo": 1620,
    "large-v3-turbo": 1620,
}


def _dir_size_mb(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total / (1024 * 1024)


def ensure_fw_model(model_size, stage="transcribing"):
    """
    Tải model faster-whisper TRƯỚC khi nạp, vừa tải vừa báo số MB.
    Không có bước này thì lần đầu chạy sẽ đứng im vài chục phút mà không biết tới đâu.
    Trả về True nếu đã tải xong (hoặc đã có sẵn), False nếu không tải trước được
    (khi đó cứ để WhisperModel tự xoay xở).
    """
    if os.path.sep in model_size or "/" in model_size:
        return False  # người dùng trỏ thẳng tới thư mục model trên máy

    try:
        import threading
        from huggingface_hub import snapshot_download
        from huggingface_hub.constants import HF_HUB_CACHE
    except Exception:
        return False

    repo = "Systran/faster-whisper-" + model_size
    cache_dir = os.path.join(HF_HUB_CACHE, "models--" + repo.replace("/", "--"))
    expected = FW_MODEL_MB.get(model_size, 1500)

    # Đã có sẵn gần đủ dung lượng -> coi như cache hợp lệ, khỏi báo gì
    if os.path.isdir(cache_dir) and _dir_size_mb(cache_dir) >= expected * 0.9:
        return False

    state = {"done": False, "error": None}

    def _worker():
        try:
            snapshot_download(repo_id=repo)
        except Exception as exc:  # mạng hỏng / repo đổi tên -> để WhisperModel báo lỗi
            state["error"] = exc
        finally:
            state["done"] = True

    progress(stage, 1, "Chuẩn bị tải model %s (~%d MB, chỉ tải một lần)" % (model_size, expected))
    th = threading.Thread(target=_worker, daemon=True)
    th.start()

    last = -1.0
    while not state["done"]:
        th.join(timeout=2.0)
        got = _dir_size_mb(cache_dir) if os.path.isdir(cache_dir) else 0.0
        if got - last >= 5 or last < 0:
            last = got
            pct = max(1, min(97, int(got / expected * 100)))
            # Ước lượng dung lượng có thể lệch; vượt mốc rồi thì bỏ mẫu số đi cho khỏi khó hiểu
            if got > expected:
                msg = "Đang tải model %s — %d MB (chỉ tải một lần)" % (model_size, got)
            else:
                msg = "Đang tải model %s — %d/%d MB (chỉ tải một lần)" % (model_size, got, expected)
            progress(stage, pct, msg)

    if state["error"] is not None:
        sys.stderr.write("WARN tai model: %s\n" % state["error"])
        return False

    progress(stage, 98, "Đã tải xong model, đang nạp vào bộ nhớ")
    return True


# ---------------------------------------------------------------- Ảo giác của Whisper

# Whisper học từ phụ đề YouTube, nên câu kêu gọi subscribe của mấy kênh lớn xuất
# hiện dày đặc trong dữ liệu huấn luyện tiếng Việt. Gặp đoạn IM LẶNG hoặc chỉ có
# tiếng ồn, model không có gì để nghe nên "bịa" ra chính những câu đó — dù video
# không hề có quảng cáo. Đây là hiện tượng đã biết, không phải lỗi của app.
HALLUCINATION_PHRASES = [
    "hãy subscribe cho kênh ghiền mì gõ để không bỏ lỡ những video hấp dẫn",
    "hãy subscribe cho kênh lalaschool để không bỏ lỡ những video hấp dẫn",
    "hãy subscribe cho kênh để không bỏ lỡ những video hấp dẫn",
    # Câu ảo giác hay bị cắt cụt ở đầu hoặc cuối đoạn, nên phải bắt được cả mảnh.
    # Khớp theo thứ tự DÀI TRƯỚC (xem sắp xếp bên dưới) để mảnh dài được gỡ trọn
    # thành một lần, thay vì bị xé thành hai mảnh nhỏ.
    "để không bỏ lỡ những video hấp dẫn",
    "hãy subscribe cho kênh",
    "ghiền mì gõ",
    "lalaschool",
    "hẹn gặp lại các bạn ở video tiếp theo",
    "hãy đăng ký kênh để ủng hộ kênh của mình nhé",
    "hãy đăng ký kênh để ủng hộ kênh",
    "các bạn hãy đăng kí cho kênh",
    "các bạn hãy đăng ký cho kênh",
    "đăng ký kênh để ủng hộ",
    "cảm ơn các bạn đã theo dõi",
    "cảm ơn các bạn đã xem video",
    "đừng quên like và subscribe",
    "nhớ đăng ký kênh để xem thêm nhiều video",
    # tiếng Anh / tiếng Trung cũng hay bị, hay gặp ở đoạn im lặng
    "thank you for watching",
    "thanks for watching",
    "subscribe to my channel",
    "please subscribe",
    "字幕由amara.org社群提供",
    "字幕志愿者",
]


# Ngoài các câu chép nguyên văn ở trên, bắt thêm theo HỌ CÂU: mấy câu outro
# YouTube biến thể vô tận ("hãy đăng ký", "nhớ đăng kí cho kênh", "subscribe
# kênh mình nhé"...), chép tay không xuể.
#
# Điều kiện phải CHẶT: chỉ tính là rác khi có cả gốc "đăng ký/subscribe kênh"
# LẪN một đuôi kiểu outro. Nếu chỉ cần thấy "đăng ký kênh" là cắt thì một cuộc
# họp bàn về marketing nói câu đó thật sẽ bị mất chữ.
_SUB_STEM = (
    r"(?:hãy\s+|nhớ\s+|các\s+bạn\s+hãy\s+|đừng\s+quên\s+)?"
    r"(?:đăng\s*k[yýií]|subscribe)\s*(?:cho\s+)?(?:kênh|channel)\b"
)

_HALLUCINATION_FAMILY = [
    # Dấu hiệu MẠNH — chỉ có ở câu outro YouTube, cho phép cách xa
    _SUB_STEM + r"[^.!?]{0,60}?(?:để\s+không\s+bỏ\s+lỡ|video\s+hấp\s+dẫn|ủng\s+hộ\s+kênh|ủng\s+hộ\s+mình)",
    # Dấu hiệu YẾU ("của mình nhé") — phải DÍNH LIỀN sau "kênh".
    # Nới ra là ăn nhầm câu họp thật: "đăng ký kênh bán hàng qua đại lý nhé anh"
    # cũng có "đăng ký kênh" và "nhé", chỉ khác là ở giữa có danh từ công việc.
    _SUB_STEM + r"\s*(?:của\s+)?mình\s+(?:nhé|nha)\b",
]


def _norm_text(t):
    """Bỏ dấu câu và khoảng trắng thừa để so khớp, GIỮ NGUYÊN dấu tiếng Việt."""
    import re
    return re.sub(r"[^\w\s]", " ", (t or "").lower()).strip()


def _collapse_repeats(text):
    """
    Gộp các câu giống hệt nhau lặp liên tiếp thành một.

    Vòng lặp ảo giác thường ra dạng "A. A. A. A." — người thật hiếm khi nói lặp
    y nguyên 3 lần liền, nên chỉ gộp từ lần thứ 3 trở đi cho an toàn.
    """
    import re
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", text or "") if p.strip()]
    if len(parts) < 3:
        return text
    out = []
    run = 1
    for i, p in enumerate(parts):
        if i > 0 and _norm_text(p) == _norm_text(parts[i - 1]):
            run += 1
            if run >= 3:
                continue
        else:
            run = 1
        out.append(p)
    return " ".join(out) if out else text


def clean_hallucination(text, extra=None):
    """
    Gỡ các câu ảo giác đã biết ra khỏi một lượt nói.

    Cố tình KHÔNG bỏ cả lượt: thực tế model hay chèn câu rác vào GIỮA lời nói
    thật, ví dụ "...hấp dẫn Bây giờ anh em đấy, câu này là cho Dương". Bỏ cả
    lượt là mất luôn phần thật.

    Trả về (text_đã_sạch, số_chỗ_đã_gỡ).
    """
    import re
    if not text or not text.strip():
        return text, 0

    cleaned = text
    removed = 0
    # Dài trước ngắn sau: "hãy subscribe cho kênh ghiền mì gõ để không bỏ lỡ..."
    # phải được gỡ nguyên câu, chứ không phải gỡ "ghiền mì gõ" rồi bỏ lại phần đầu.
    phrases = list(HALLUCINATION_PHRASES) + [p for p in (extra or []) if p and p.strip()]
    for phrase in sorted(phrases, key=len, reverse=True):
        # so khớp không phân biệt hoa thường và không phụ thuộc dấu câu ở giữa
        pattern = re.compile(
            r"\s*".join(re.escape(w) for w in phrase.split()),
            re.IGNORECASE,
        )
        cleaned, n = pattern.subn(" ", cleaned)
        removed += n

    for pat in _HALLUCINATION_FAMILY:
        cleaned, n = re.subn(pat, " ", cleaned, flags=re.IGNORECASE)
        removed += n

    cleaned = _collapse_repeats(cleaned)
    # dọn khoảng trắng và dấu câu mồ côi còn sót lại sau khi cắt
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = re.sub(r"^[\s.,;:!?-]+", "", cleaned).strip()
    return cleaned, removed


def keep_ranges(skip, total):
    """
    Đổi danh sách đoạn CẦN BỎ thành danh sách đoạn CẦN GIỮ.

    Người dùng đánh dấu "bỏ phút 0-10 và 45-50", còn model thì cần biết "chạy
    phút 10-45 và 50-hết". Chỗ này dễ sai nên tách riêng ra để test:
    các đoạn bỏ có thể chồng lấn nhau, lộn ngược đầu đuôi, hoặc vượt quá độ dài.

    Trả về [(start, end), ...] theo mốc thời gian GỐC của video.
    """
    total = float(total or 0)
    if total <= 0:
        return []

    # Chuẩn hoá: đảo lại nếu người dùng đánh dấu ngược, kẹp vào trong độ dài video
    norm = []
    for r in skip or []:
        try:
            a = float(r.get("start", 0) if isinstance(r, dict) else r[0])
            b = float(r.get("end", 0) if isinstance(r, dict) else r[1])
        except Exception:
            continue
        if b < a:
            a, b = b, a
        a = max(0.0, min(a, total))
        b = max(0.0, min(b, total))
        if b - a > 0.05:
            norm.append((a, b))
    if not norm:
        return [(0.0, total)]

    # Gộp các đoạn bỏ chồng lấn / dính nhau
    norm.sort()
    merged = [list(norm[0])]
    for a, b in norm[1:]:
        if a <= merged[-1][1] + 0.01:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])

    keep = []
    cursor = 0.0
    for a, b in merged:
        if a - cursor > 0.05:
            keep.append((round(cursor, 3), round(a, 3)))
        cursor = max(cursor, b)
    if total - cursor > 0.05:
        keep.append((round(cursor, 3), round(total, 3)))
    return keep


def resolve_threads(requested):
    """
    Số luồng cho CTranslate2.

    QUAN TRỌNG: faster-whisper mặc định cpu_threads=4 bất kể máy có bao nhiêu nhân.
    Trước đây app không truyền tham số này, nên máy 16 nhân vẫn chỉ chạy 4 luồng —
    tức là bỏ không 3/4 CPU. 0 = tự dùng hết số nhân thấy được.
    """
    try:
        n = int(requested or 0)
    except Exception:
        n = 0
    if n > 0:
        return n
    return max(1, os.cpu_count() or 4)


def run_asr(
    audio,
    language,
    model_size,
    device,
    initial_prompt="",
    offset=0.0,
    full_duration=0.0,
    ckpt=None,
    ckpt_path=None,
    stop_file=None,
    threads=0,
    batch_size=8,
    anti_hallucination=True,
    extra_phrases=None,
    use_vad=True,
    vad_threshold=0.5,
    clip_ranges=None,
):
    """
    Bóc băng, ghi tiến độ ra checkpoint sau mỗi câu.

    offset        : audio truyền vào đã bị cắt bỏ `offset` giây đầu (khi chạy tiếp),
                    nên mọi mốc thời gian phải cộng thêm.
    full_duration : độ dài video gốc, để tính % cho đúng khi chạy tiếp.
    Trả về (segments, meta, stopped).
    """
    from faster_whisper import WhisperModel

    compute = "float16" if device == "cuda" else "int8"
    n_threads = resolve_threads(threads)
    ensure_fw_model(model_size)
    progress("transcribing", 99, f"Đang nạp model {model_size} ({device}/{compute}, {n_threads} luồng)")
    model = WhisperModel(model_size, device=device, compute_type=compute, cpu_threads=n_threads)

    # Bóc băng theo lô: VAD cắt audio thành các khúc có tiếng nói, rồi chạy nhiều
    # khúc trong CÙNG một lượt suy luận. Đây mới là cách "chia nhỏ rồi chạy song
    # song" đúng đắn — vẫn một model duy nhất trong RAM, thay vì mở N tiến trình
    # mỗi cái nạp riêng một bản model 3GB rồi tranh nhau CPU.
    runner = model
    batched = False
    try:
        bs = int(batch_size or 0)
    except Exception:
        bs = 0
    if bs > 1:
        try:
            from faster_whisper import BatchedInferencePipeline

            runner = BatchedInferencePipeline(model=model)
            batched = True
        except Exception as exc:
            # Bản faster-whisper cũ chưa có lớp này -> chạy kiểu cũ, không phải lỗi
            sys.stderr.write("WARN khong dung duoc batching: %s\n" % exc)

    ckpt = ckpt if ckpt is not None else {}
    out = list(ckpt.get("segments") or [])
    if offset > 0:
        progress("transcribing", 0, "Chạy tiếp từ phút %d, đã có %d câu" % (int(offset / 60), len(out)))
    else:
        progress("transcribing", 0, "Đang phân tích âm thanh")

    lang = None if not language or language == "auto" else language
    # initial_prompt: mồi trước cho model biết các tên riêng / thuật ngữ sắp gặp,
    # giảm hẳn chuyện nghe sai "MaiMoney" thành "mai money".
    total_hint = float(full_duration or 0)
    tr_kwargs = dict(
        language=lang,
        initial_prompt=initial_prompt.strip() or None,
        vad_filter=bool(use_vad),
        # VAD quyết định đoạn nào ĐƯỢC ĐƯA cho model. Đặt sai là mất luôn tiếng
        # nói thật mà không có cách nào biết, nên mọi con số ở đây đều phải cân
        # nhắc theo hướng "thà nghe dư còn hơn bỏ sót".
        #
        #  threshold      : xác suất tối thiểu để coi là tiếng nói (mặc định
        #                   thư viện 0.5). Người nói nhỏ, ngồi xa mic, hoặc
        #                   phòng ồn thì tụt dưới 0.5 và bị bỏ luôn -> hạ xuống.
        #  speech_pad_ms  : đệm hai đầu mỗi đoạn tiếng nói. Mặc định THƯ VIỆN là
        #                   400. Bản trước tôi đặt 200 tưởng là an toàn, hoá ra
        #                   là CẮT BỚT một nửa phần đệm nên hay mất chữ đầu/cuối câu.
        vad_parameters={
            "threshold": vad_threshold,
            "min_silence_duration_ms": 700 if anti_hallucination else 400,
            "speech_pad_ms": 400,
        },
        beam_size=5,
        # Tài liệu chính thức của faster-whisper: tắt cái này thì "model bớt bị
        # kẹt trong vòng lặp lỗi, ví dụ lặp lại vô hạn". Đổi lại là mất chút
        # ngữ cảnh giữa các cửa sổ — nhưng phần mồi thuật ngữ vẫn còn, mà một
        # đoạn toàn câu rác thì tệ hơn nhiều so với mất chút ngữ cảnh.
        condition_on_previous_text=not anti_hallucination,
        word_timestamps=bool(anti_hallucination),
    )
    if anti_hallucination:
        # Tham số sinh ra đúng cho việc này: phát hiện nghi ngờ ảo giác thì bỏ
        # qua khoảng lặng dài hơn ngưỡng. Chỉ chạy khi word_timestamps=True.
        tr_kwargs["hallucination_silence_threshold"] = 2.0

    # Vùng bỏ qua: dùng clip_timestamps của chính faster-whisper thay vì tự cắt
    # ghép audio bằng ffmpeg. Nó trả mốc thời gian theo TIMELINE GỐC của video,
    # nên bấm vào lượt nói vẫn tua đúng chỗ — đúng thứ người dùng cần.
    if clip_ranges:
        pts = []
        for a_, b_ in clip_ranges:
            pts.append(round(float(a_), 3))
            pts.append(round(float(b_), 3))
        tr_kwargs["clip_timestamps"] = pts
        bo = total_hint - sum(b_ - a_ for a_, b_ in clip_ranges) if total_hint else 0
        progress(
            "transcribing",
            0,
            "Bỏ qua %d phút đã đánh dấu, chỉ bóc %d đoạn" % (max(0, round(bo / 60)), len(clip_ranges)),
        )
    if batched:
        tr_kwargs["batch_size"] = bs
        progress("transcribing", 0, "Bóc băng theo lô %d khúc, %d luồng CPU" % (bs, n_threads))
    try:
        segments_iter, info = runner.transcribe(audio, **tr_kwargs)
    except TypeError as exc:
        # Bản faster-whisper khác nhau nhận bộ tham số khác nhau; đừng để app chết
        # chỉ vì một tham số lạ — bỏ batching rồi chạy lại kiểu cũ.
        sys.stderr.write("WARN transcribe khong nhan tham so: %s\n" % exc)
        tr_kwargs.pop("batch_size", None)
        batched = False
        segments_iter, info = model.transcribe(audio, **tr_kwargs)
    clip_total = float(getattr(info, "duration", 0) or 0)
    total = full_duration or (clip_total + offset)

    stopped = False
    last_write = 0.0
    dropped = 0
    for seg in segments_iter:
        text = (seg.text or "").strip()
        end_abs = float(seg.end) + offset
        if text and anti_hallucination:
            text, n = clean_hallucination(text, extra_phrases)
            if n:
                dropped += n
        if text:
            out.append({"start": float(seg.start) + offset, "end": end_abs, "text": text})

        ckpt["segments"] = out
        ckpt["asr_done_sec"] = end_abs
        # Ghi checkpoint mỗi 5 giây audio để không tốn I/O mà vẫn mất tối đa vài câu
        if end_abs - last_write >= 5:
            last_write = end_abs
            save_checkpoint(ckpt_path, ckpt)

        if total:
            progress(
                "transcribing",
                min(98, int(end_abs / total * 98)),
                "Đang bóc băng — %d/%d giây audio, %d câu" % (int(end_abs), int(total), len(out)),
            )

        if stop_requested(stop_file):
            stopped = True
            break

    save_checkpoint(ckpt_path, ckpt)
    if dropped:
        progress("transcribing", 99, "Đã gỡ %d câu quảng cáo do model bịa ra ở đoạn im lặng" % dropped)
    if stopped:
        progress("transcribing", min(98, int(ckpt.get("asr_done_sec", 0) / total * 98)) if total else 0,
                 "Đã tạm dừng, giữ lại %d câu" % len(out))
    else:
        progress("transcribing", 99, f"Xong {len(out)} câu")
    return (
        out,
        {
            "language": getattr(info, "language", language),
            "duration": total,
            "threads": n_threads,
            "batch_size": bs if batched else 0,
            "hallucinations_removed": dropped,
        },
        stopped,
    )


def extract_embeddings(audio, turns, hf_token, stage="diarizing"):
    """
    Trích voiceprint cho từng người nói, để nhận ra họ ở các cuộc họp sau.

    Tách riêng khỏi run_diarize vì VibeVoice-ASR tự tách người nói nhưng KHÔNG
    trả về vector giọng — mà danh bạ giọng nói xuyên cuộc họp lại là thứ giá trị
    nhất của app. Nên backend nào cũng phải chạy qua đây.

    Trả về (embeddings, emb_error). Thiếu voiceprint thì vẫn bóc băng được, chỉ
    là mất trí nhớ xuyên cuộc họp — nên lỗi ở đây không bao giờ được làm hỏng cả
    lượt chạy.
    """
    import numpy as np

    embeddings = {}
    kwargs = {"use_auth_token": hf_token} if hf_token else {}
    try:
        from pyannote.audio import Inference, Model
        from pyannote.core import Segment

        emb_model = Model.from_pretrained("pyannote/embedding", **kwargs)
        inference = Inference(emb_model, window="whole")
        by_speaker = {}
        for t in turns:
            if t["end"] - t["start"] < 1.0:
                continue
            by_speaker.setdefault(t["speaker"], []).append(t)
        for spk, items in by_speaker.items():
            # Lấy vài lượt DÀI nhất: đoạn dài thì voiceprint sạch hơn đoạn "vâng", "ừ"
            items = sorted(items, key=lambda x: x["end"] - x["start"], reverse=True)[:6]
            vecs = []
            for it in items:
                try:
                    v = inference.crop(audio, Segment(it["start"], it["end"]))
                    vecs.append(np.asarray(v).reshape(-1))
                except Exception:
                    continue
            if vecs:
                m = np.mean(np.stack(vecs), axis=0)
                n = np.linalg.norm(m)
                if n > 0:
                    m = m / n
                embeddings[spk] = [float(x) for x in m.tolist()]
        progress(stage, 95, "Đã trích voiceprint")
        return embeddings, None
    except Exception as exc:
        sys.stderr.write("WARN embedding: %s\n" % exc)
        return embeddings, classify_error(exc)


def _cosine(a, b):
    import numpy as np

    if not a or not b or len(a) != len(b):
        return 0.0
    va = np.asarray(a, dtype="float64")
    vb = np.asarray(b, dtype="float64")
    na = np.linalg.norm(va)
    nb = np.linalg.norm(vb)
    if na == 0 or nb == 0:
        return 0.0
    return float(va.dot(vb) / (na * nb))


def resample_audio(x, src_sr, dst_sr):
    """
    Đổi tần số lấy mẫu.

    ffmpeg của app tách audio ở 16kHz vì Whisper cần đúng mức đó, nhưng
    VibeVoice-ASR được huấn luyện ở 24kHz và TỪ CHỐI THẲNG nếu đưa sai
    (ValueError ... trained using a sampling rate of 24000).

    Đây là nâng tần số (16k -> 24k) nên nội suy tuyến tính là chấp nhận được:
    tín hiệu gốc vốn đã bị giới hạn băng thông ở 8kHz, không có nguy cơ chồng
    phổ. Vẫn ưu tiên torchaudio/scipy nếu máy có, cho sạch hơn.
    """
    import numpy as np

    if not src_sr or src_sr == dst_sr or len(x) == 0:
        return x, src_sr or dst_sr

    try:
        import torch
        import torchaudio

        t = torch.from_numpy(np.asarray(x, dtype="float32"))
        out = torchaudio.functional.resample(t, int(src_sr), int(dst_sr))
        return out.numpy(), dst_sr
    except Exception:
        pass

    try:
        from math import gcd
        from scipy.signal import resample_poly

        g = gcd(int(src_sr), int(dst_sr))
        return resample_poly(x, int(dst_sr) // g, int(src_sr) // g).astype("float32"), dst_sr
    except Exception:
        pass

    n_out = int(round(len(x) * float(dst_sr) / float(src_sr)))
    if n_out <= 1:
        return x, src_sr
    src_t = np.linspace(0.0, 1.0, num=len(x), endpoint=False, dtype="float64")
    dst_t = np.linspace(0.0, 1.0, num=n_out, endpoint=False, dtype="float64")
    return np.interp(dst_t, src_t, np.asarray(x, dtype="float64")).astype("float32"), dst_sr


def read_wav_window(path, start_sec, end_sec, target_sr=None):
    """
    Đọc một đoạn audio thành mảng float32 mono.

    Dùng thư viện chuẩn `wave` thay vì soundfile/librosa: audio do ffmpeg của app
    tách ra luôn là WAV PCM 16kHz mono, nên không cần bắt người dùng cài thêm gì.
    Có soundfile thì dùng, vì nó đọc được cả định dạng lạ.
    """
    import numpy as np

    try:
        import soundfile as sf

        info = sf.info(path)
        sr = info.samplerate
        start = int(max(0, start_sec) * sr)
        stop = int(end_sec * sr) if end_sec else None
        data, sr = sf.read(path, start=start, stop=stop, dtype="float32", always_2d=True)
        mono = data.mean(axis=1)
        if target_sr:
            return resample_audio(mono, sr, target_sr)
        return mono, sr
    except Exception:
        pass

    import wave

    with wave.open(path, "rb") as wf:
        sr = wf.getframerate()
        ch = wf.getnchannels()
        width = wf.getsampwidth()
        total = wf.getnframes()
        start = min(total, int(max(0, start_sec) * sr))
        stop = min(total, int(end_sec * sr)) if end_sec else total
        wf.setpos(start)
        raw = wf.readframes(max(0, stop - start))

    if width != 2:
        raise RuntimeError("Chỉ đọc được WAV PCM 16-bit, file này %d-bit" % (width * 8))
    data = np.frombuffer(raw, dtype="<i2").astype("float32") / 32768.0
    if ch > 1:
        data = data.reshape(-1, ch).mean(axis=1)
    if target_sr:
        return resample_audio(data, sr, target_sr)
    return data, sr


def wav_duration(path):
    try:
        import wave

        with wave.open(path, "rb") as wf:
            return wf.getnframes() / float(wf.getframerate())
    except Exception:
        return 0.0


# VibeVoice-ASR nhận tối đa 60 phút mỗi lượt (64K token). Chừa biên an toàn.
# Đặt biến môi trường MEETSUM_VV_WINDOW_SEC để thử nghiệm với cửa sổ nhỏ.
VIBEVOICE_WINDOW_SEC = int(os.environ.get("MEETSUM_VV_WINDOW_SEC") or 50 * 60)

# VibeVoice-ASR được huấn luyện ở 24kHz và từ chối audio ở tần số khác.
VIBEVOICE_SAMPLE_RATE = 24000


def run_vibevoice(
    audio,
    model_id,
    device,
    initial_prompt="",
    offset=0.0,
    full_duration=0.0,
    ckpt=None,
    ckpt_path="",
    stop_file="",
    voice_threshold=0.72,
    hf_token="",
    anti_hallucination=True,
    extra_phrases=None,
):
    """
    Bóc băng + tách người nói + mốc thời gian trong MỘT lượt bằng VibeVoice-ASR.

    Khác hẳn đường faster-whisper + pyannote: ở đó ASR và diarization chạy riêng
    rồi app phải tự ghép lại, và chính bước ghép đó là chỗ hay gộp nhầm 2-3 người
    vào một lượt nói. Ở đây model trả thẳng ra ai-nói-gì-lúc-nào.

    Trả về (segments, turns, embeddings, meta, emb_error, stopped).
    """
    import numpy as np
    from transformers import AutoProcessor, VibeVoiceAsrForConditionalGeneration

    ckpt = ckpt if ckpt is not None else {}

    progress("transcribing", 2, "Đang tải model VibeVoice-ASR (%s)" % device)
    processor = AutoProcessor.from_pretrained(model_id)
    model = VibeVoiceAsrForConditionalGeneration.from_pretrained(
        model_id, device_map="auto" if device == "cuda" else None
    )
    try:
        if device != "cuda":
            model = model.to("cpu")
    except Exception:
        pass

    clip_len = wav_duration(audio)
    total = full_duration or (clip_len + offset)

    # Chia cửa sổ vì model chỉ nhận 60 phút một lượt
    windows = []
    pos = 0.0
    while pos < clip_len - 0.5:
        windows.append((pos, min(clip_len, pos + VIBEVOICE_WINDOW_SEC)))
        pos += VIBEVOICE_WINDOW_SEC
    if not windows:
        windows = [(0.0, clip_len)]

    segments = list(ckpt.get("segments") or [])
    turns = list(ckpt.get("turns") or [])
    hallucinated = [0]  # bọc list để hàm con ghi vào được
    # Bảng giọng nói dùng chung cho mọi cửa sổ: {tên chung: vector}
    global_voices = dict(ckpt.get("vv_voices") or {})
    done_windows = int(ckpt.get("vv_done_windows") or 0)
    stopped = False

    for wi, (w_start, w_end) in enumerate(windows):
        if wi < done_windows:
            continue
        if stop_requested(stop_file):
            stopped = True
            break

        label = "" if len(windows) == 1 else " (đoạn %d/%d)" % (wi + 1, len(windows))
        span = w_end - w_start
        span_txt = "%d phút" % round(span / 60) if span >= 60 else "%d giây" % round(span)
        progress(
            "transcribing",
            min(96, 5 + int(w_start / max(1.0, clip_len) * 90)),
            "Đang bóc băng%s — VibeVoice đọc %s audio trong một lượt" % (label, span_txt),
        )

        wav, sr = read_wav_window(audio, w_start, w_end, target_sr=VIBEVOICE_SAMPLE_RATE)
        inputs = processor.apply_transcription_request(
            audio=wav, sampling_rate=sr, prompt=initial_prompt or None
        )
        try:
            inputs = inputs.to(model.device, model.dtype)
        except Exception:
            pass
        output_ids = model.generate(**inputs)
        cut = inputs["input_ids"].shape[1]
        parsed = processor.decode(output_ids[:, cut:], return_format="parsed")[0]

        # Ghép giọng của cửa sổ này vào bảng chung. Speaker 0 của đoạn 2 KHÔNG
        # phải Speaker 0 của đoạn 1 — model đánh số lại từ đầu mỗi lượt.
        local_turns = []
        for item in parsed:
            try:
                st = float(item.get("Start", 0)) + w_start + offset
                en = float(item.get("End", st)) + w_start + offset
            except Exception:
                continue
            spk_local = "vv%d_s%s" % (wi, item.get("Speaker", 0))
            text = (item.get("Content") or "").strip()
            # VibeVoice cũng là model sinh chữ nên cũng bịa được ở đoạn im lặng
            if text and anti_hallucination:
                text, n = clean_hallucination(text, extra_phrases)
                hallucinated[0] += n
            local_turns.append({"start": st, "end": en, "speaker": spk_local, "text": text})

        # Ghép giọng của cửa sổ này vào bảng chung.
        # Số thứ tự người nói phải tiếp nối trên toàn file, không đếm lại mỗi đoạn.
        rename = {}
        next_idx = 0
        for name in list(global_voices.keys()) + [t["speaker"] for t in turns]:
            if str(name).startswith("SPEAKER_"):
                try:
                    next_idx = max(next_idx, int(str(name).split("_")[1]) + 1)
                except Exception:
                    pass

        local_speakers = sorted({t["speaker"] for t in local_turns})
        # Voiceprint của từng giọng trong đoạn này — thứ duy nhất cho biết
        # "Speaker 0" của đoạn sau có phải cùng người với đoạn trước hay không.
        local_emb, _ = (
            extract_embeddings(audio, local_turns, hf_token, stage="transcribing")
            if len(windows) > 1
            else ({}, None)
        )

        used = set()
        for spk in local_speakers:
            best, best_score = None, 0.0
            for gname, gvec in global_voices.items():
                if gname in used:
                    continue
                score = _cosine(local_emb.get(spk, []), gvec)
                if score > best_score:
                    best, best_score = gname, score
            if best and best_score >= voice_threshold:
                used.add(best)
                rename[spk] = best
            else:
                # Chưa từng gặp, HOẶC không có voiceprint để đối chiếu -> coi là người mới.
                # Không đoán bừa rằng "Speaker 0" của đoạn sau vẫn là người cũ: gán nhầm
                # hai người thành một thì phải sửa tay từng lượt nói, còn tách dư ra thì
                # chỉ cần bấm Gộp một lần. Thà dư còn hơn sai.
                rename[spk] = "SPEAKER_%02d" % next_idx
                next_idx += 1

        # Nhớ lại giọng vừa gặp, KỂ CẢ ở đoạn đầu tiên — nếu không thì đoạn sau
        # không có gì để đối chiếu và sẽ đánh số lại từ đầu, biến 2 người thành 6.
        for spk, gname in rename.items():
            if spk in local_emb and gname not in global_voices:
                global_voices[gname] = local_emb[spk]

        for t in local_turns:
            name = rename.get(t["speaker"], t["speaker"])
            turns.append({"start": t["start"], "end": t["end"], "speaker": name})
            if t["text"]:
                segments.append({"start": t["start"], "end": t["end"], "text": t["text"], "speaker": name})

        ckpt["segments"] = segments
        ckpt["turns"] = turns
        ckpt["vv_voices"] = global_voices
        ckpt["vv_done_windows"] = wi + 1
        ckpt["asr_done_sec"] = w_end + offset
        save_checkpoint(ckpt_path, ckpt)

    segments.sort(key=lambda x: x["start"])
    turns.sort(key=lambda x: x["start"])

    # Voiceprint cuối cùng tính trên toàn bộ file, chính xác hơn từng cửa sổ
    embeddings, emb_error = extract_embeddings(audio, turns, hf_token, stage="transcribing")
    if not embeddings and global_voices:
        embeddings = global_voices
        emb_error = None

    if not embeddings and not emb_error:
        emb_error = "NO_EMBEDDING|Không trích được voiceprint nào (các lượt nói có thể quá ngắn)"

    split_warning = None
    if len(windows) > 1 and not embeddings:
        split_warning = (
            "NO_VOICEPRINT_SPLIT|Cuộc họp dài nên phải chia làm %d đoạn, mà không có voiceprint "
            "để biết người nói ở đoạn sau có phải người của đoạn trước không. "
            "Mỗi đoạn vì thế được đánh số người nói riêng — hãy dùng nút Gộp để nhập những "
            "người trùng lại. Cài pyannote.audio để lần sau app tự ghép đúng." % len(windows)
        )

    n_spk = len({t["speaker"] for t in turns})
    if stopped:
        progress("transcribing", 90, "Đã tạm dừng, giữ lại %d câu" % len(segments))
    else:
        progress("transcribing", 99, "Xong %d câu, %d người nói" % (len(segments), n_spk))

    return (
        segments,
        turns,
        embeddings,
        {
            "duration": total,
            "backend": "vibevoice",
            "model": model_id,
            "windows": len(windows),
            "hallucinations_removed": hallucinated[0],
        },
        emb_error,
        stopped,
        split_warning,
    )


def run_diarize(audio, hf_token, num_speakers, device):
    """Trả về (turns, embeddings). turns = [{start,end,speaker}], embeddings = {speaker: [floats]}"""
    import numpy as np
    from pyannote.audio import Pipeline

    progress("diarizing", 3, "Đang tải model tách người nói")
    kwargs = {}
    if hf_token:
        kwargs["use_auth_token"] = hf_token
    pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", **kwargs)
    try:
        import torch

        if device == "cuda":
            pipeline.to(torch.device("cuda"))
    except Exception:
        pass

    dz_kwargs = {}
    if num_speakers and int(num_speakers) > 0:
        dz_kwargs["num_speakers"] = int(num_speakers)

    # Hook báo tiến độ từng bước của pyannote. Tự viết chứ không dùng ProgressHook
    # có sẵn, vì cái đó in ra stdout và sẽ làm hỏng JSON kết quả.
    step_labels = {
        "segmentation": "phân đoạn giọng nói",
        "speaker_counting": "đếm số người nói",
        "embeddings": "trích đặc trưng giọng",
        "discrete_diarization": "ghép lượt nói",
    }
    seen_steps = []

    def hook(step_name, step_artifact=None, file=None, total=None, completed=None):
        label = step_labels.get(step_name, step_name)
        if step_name not in seen_steps:
            seen_steps.append(step_name)
        base = 20 + (len(seen_steps) - 1) * 12
        if total and completed is not None and total > 0:
            pct = min(68, base + int(completed / total * 12))
            progress("diarizing", pct, "Tách người nói — %s %d/%d" % (label, completed, total))
        else:
            progress("diarizing", min(68, base), "Tách người nói — %s" % label)

    progress("diarizing", 20, "Đang phân tích giọng nói")
    try:
        diarization = pipeline(audio, hook=hook, **dz_kwargs)
    except TypeError:
        # bản pyannote cũ không nhận tham số hook
        diarization = pipeline(audio, **dz_kwargs)

    turns = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        turns.append({"start": float(turn.start), "end": float(turn.end), "speaker": str(speaker)})
    turns.sort(key=lambda t: t["start"])
    progress("diarizing", 70, f"Tìm thấy {len({t['speaker'] for t in turns})} giọng nói")

    embeddings, emb_error = extract_embeddings(audio, turns, hf_token)
    return turns, embeddings, emb_error


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio")
    ap.add_argument("--out")
    ap.add_argument("--mode", default="full", choices=["full", "asr", "diarize", "check"])
    ap.add_argument("--language", default="vi")
    ap.add_argument("--model-size", default="large-v3")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--hf-token", default="")
    ap.add_argument("--num-speakers", default="0")
    # --- chạy tiếp / tạm dừng ---
    ap.add_argument("--checkpoint", default="", help="File JSON lưu tiến độ, dùng để chạy tiếp")
    ap.add_argument("--stop-file", default="", help="File cờ; xuất hiện thì dừng gọn gàng")
    ap.add_argument("--audio-offset", default="0", help="Audio đã bị cắt bao nhiêu giây đầu")
    ap.add_argument("--full-duration", default="0", help="Độ dài video gốc, tính theo giây")
    ap.add_argument(
        "--asr-backend",
        default="faster-whisper",
        choices=["faster-whisper", "vibevoice"],
        help="faster-whisper = ASR rồi pyannote tách người nói; vibevoice = một model làm cả hai",
    )
    ap.add_argument("--vibevoice-model", default="microsoft/VibeVoice-ASR-HF")
    ap.add_argument("--threads", default="0", help="Số luồng CPU cho ASR; 0 = dùng hết số nhân")
    ap.add_argument("--batch-size", default="8", help="Số khúc audio chạy cùng một lượt; 0/1 = tắt")
    ap.add_argument(
        "--extra-hallucinations",
        default="",
        help="Các câu ảo giác người dùng tự thêm, cách nhau bằng xuống dòng",
    )
    ap.add_argument("--no-vad", default="0", help="1 = tắt hẳn VAD, đưa toàn bộ audio cho model")
    ap.add_argument("--vad-threshold", default="0.5", help="Ngưỡng coi là tiếng nói; thấp hơn = nghe kỹ hơn")
    ap.add_argument(
        "--skip-ranges",
        default="",
        help='JSON các đoạn bỏ qua, ví dụ [{"start":0,"end":600}]',
    )
    ap.add_argument(
        "--anti-hallucination",
        default="1",
        help="1 = lọc câu model bịa ra ở đoạn im lặng (câu subscribe kênh YouTube)",
    )
    ap.add_argument("--voice-threshold", default="0.72", help="Ngưỡng cosine ghép giọng giữa các đoạn dài")
    ap.add_argument(
        "--initial-prompt",
        default="",
        help="Danh sách tên riêng / thuật ngữ, mồi cho model để bớt nghe sai",
    )
    args = ap.parse_args()

    if args.mode == "check":
        do_check()
        return 0

    if not args.audio or not os.path.exists(args.audio):
        print(json.dumps({"error": "Không tìm thấy file audio"}, ensure_ascii=False))
        return 2

    offset = float(args.audio_offset or 0)
    full_duration = float(args.full_duration or 0)
    ckpt = load_checkpoint(args.checkpoint)

    # Vùng bỏ qua do người dùng đánh dấu -> đổi thành vùng cần giữ
    parsed_clips = None
    if args.skip_ranges:
        try:
            skips = json.loads(args.skip_ranges)
            if skips:
                parsed_clips = keep_ranges(skips, full_duration or wav_duration(args.audio))
                if not parsed_clips:
                    print(
                        json.dumps(
                            {"error": "OTHER|Bạn đã đánh dấu bỏ qua toàn bộ video, không còn gì để bóc băng."},
                            ensure_ascii=False,
                        )
                    )
                    return 2
        except Exception as exc:
            sys.stderr.write("WARN doc skip-ranges: %s\n" % exc)

    extra_phrases = [
        line.strip().lower()
        for line in (args.extra_hallucinations or "").split("\n")
        if line.strip()
    ]

    device = pick_device(args.device)
    result = {
        "segments": ckpt.get("segments") or [],
        "turns": ckpt.get("turns") or [],
        "embeddings": ckpt.get("embeddings") or {},
        "meta": {"device": device},
        "status": "done",
    }

    # Bấm tạm dừng ngay trước khi tiến trình kịp khởi động
    if stop_requested(args.stop_file):
        result["status"] = "paused"
        write_result(args, result)
        return 0

    try:
        # VibeVoice-ASR làm cả bóc băng lẫn tách người nói trong một lượt, nên
        # bỏ hẳn nhánh chạy pyannote riêng rồi ghép lại.
        if args.asr_backend == "vibevoice" and args.mode in ("full", "asr", "diarize"):
            segments, turns, embeddings, meta, emb_error, stopped, split_warning = run_vibevoice(
                args.audio,
                args.vibevoice_model,
                device,
                initial_prompt=args.initial_prompt,
                offset=offset,
                full_duration=full_duration,
                ckpt=ckpt,
                ckpt_path=args.checkpoint,
                stop_file=args.stop_file,
                voice_threshold=float(args.voice_threshold or 0.72),
                hf_token=args.hf_token,
                anti_hallucination=str(args.anti_hallucination) not in ("0", "false", "False"),
                extra_phrases=extra_phrases,
            )
            result["segments"] = segments
            result["turns"] = turns
            result["embeddings"] = embeddings
            result["meta"].update(meta)
            result["asr_done_sec"] = ckpt.get("asr_done_sec", 0)
            # Engine đã gán người nói cho từng câu — phía app không được ghép lại lần nữa
            result["preassigned"] = True
            if emb_error:
                result["embedding_error"] = emb_error
            if split_warning:
                result["warning"] = split_warning
            if stopped:
                result["status"] = "paused"
            write_result(args, result)
            return 0

        need_diar = args.mode in ("full", "diarize") and not ckpt.get("diar_done")
        if args.mode in ("full", "diarize") and ckpt.get("diar_done"):
            progress("diarizing", 70, "Đã có kết quả tách người nói từ lần trước")

        if need_diar:
            try:
                turns, embeddings, emb_error = run_diarize(args.audio, args.hf_token, args.num_speakers, device)
                result["turns"] = turns
                result["embeddings"] = embeddings
                if emb_error:
                    result["embedding_error"] = emb_error
                ckpt["turns"] = turns
                ckpt["embeddings"] = embeddings
                ckpt["diar_done"] = True
                save_checkpoint(args.checkpoint, ckpt)
            except Exception as exc:
                sys.stderr.write(traceback.format_exc())
                code = classify_error(exc)
                if args.mode == "diarize":
                    result["error"] = code
                else:
                    # Vẫn bóc băng được, chỉ là không tách được người nói
                    result["warning"] = code
                    ckpt["diar_done"] = True  # đừng thử lại mãi ở lần chạy tiếp
                    save_checkpoint(args.checkpoint, ckpt)
                    progress("transcribing", 0, "Bỏ qua tách người nói, tiếp tục bóc băng")

        if stop_requested(args.stop_file):
            result["status"] = "paused"
            write_result(args, result)
            return 0

        if args.mode in ("full", "asr"):
            segments, meta, stopped = run_asr(
                args.audio,
                args.language,
                args.model_size,
                device,
                initial_prompt=args.initial_prompt,
                offset=offset,
                full_duration=full_duration,
                ckpt=ckpt,
                ckpt_path=args.checkpoint,
                stop_file=args.stop_file,
                threads=args.threads,
                batch_size=args.batch_size,
                anti_hallucination=str(args.anti_hallucination) not in ("0", "false", "False"),
                extra_phrases=extra_phrases,
                use_vad=str(args.no_vad) in ("0", "false", "False"),
                vad_threshold=float(args.vad_threshold or 0.5),
                clip_ranges=parsed_clips,
            )
            result["segments"] = segments
            result["meta"].update(meta)
            result["asr_done_sec"] = ckpt.get("asr_done_sec", 0)
            if stopped:
                result["status"] = "paused"
    except Exception as exc:
        sys.stderr.write(traceback.format_exc())
        result["error"] = classify_error(exc)

    write_result(args, result)
    return 1 if result.get("error") else 0


def write_result(args, result):
    payload = json.dumps(result, ensure_ascii=False)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(payload)
        print(
            json.dumps(
                {
                    "out": args.out,
                    "error": result.get("error"),
                    "warning": result.get("warning"),
                    "embedding_error": result.get("embedding_error"),
                    "status": result.get("status"),
                },
                ensure_ascii=False,
            )
        )
    else:
        print(payload)


if __name__ == "__main__":
    sys.exit(main())
