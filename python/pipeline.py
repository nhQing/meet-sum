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


def do_check():
    info = {
        "python": sys.version.split()[0],
        "faster_whisper": has_module("faster_whisper"),
        "pyannote": has_module("pyannote.audio"),
        "torch": has_module("torch"),
        "numpy": has_module("numpy"),
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


def run_asr(
    audio,
    language,
    model_size,
    device,
    offset=0.0,
    full_duration=0.0,
    ckpt=None,
    ckpt_path=None,
    stop_file=None,
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
    ensure_fw_model(model_size)
    progress("transcribing", 99, f"Đang nạp model {model_size} ({device}/{compute})")
    model = WhisperModel(model_size, device=device, compute_type=compute)

    ckpt = ckpt if ckpt is not None else {}
    out = list(ckpt.get("segments") or [])
    if offset > 0:
        progress("transcribing", 0, "Chạy tiếp từ phút %d, đã có %d câu" % (int(offset / 60), len(out)))
    else:
        progress("transcribing", 0, "Đang phân tích âm thanh")

    lang = None if not language or language == "auto" else language
    segments_iter, info = model.transcribe(
        audio,
        language=lang,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
        beam_size=5,
        condition_on_previous_text=True,
        word_timestamps=False,
    )
    clip_total = float(getattr(info, "duration", 0) or 0)
    total = full_duration or (clip_total + offset)

    stopped = False
    last_write = 0.0
    for seg in segments_iter:
        text = (seg.text or "").strip()
        end_abs = float(seg.end) + offset
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
    if stopped:
        progress("transcribing", min(98, int(ckpt.get("asr_done_sec", 0) / total * 98)) if total else 0,
                 "Đã tạm dừng, giữ lại %d câu" % len(out))
    else:
        progress("transcribing", 99, f"Xong {len(out)} câu")
    return out, {"language": getattr(info, "language", language), "duration": total}, stopped


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

    # Trích voiceprint cho từng người nói để nhận ra ở các cuộc họp sau
    embeddings = {}
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
        progress("diarizing", 95, "Đã trích voiceprint")
    except Exception as exc:  # embedding là tuỳ chọn, thiếu vẫn chạy được
        sys.stderr.write(f"WARN embedding: {exc}\n")

    return turns, embeddings


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
        need_diar = args.mode in ("full", "diarize") and not ckpt.get("diar_done")
        if args.mode in ("full", "diarize") and ckpt.get("diar_done"):
            progress("diarizing", 70, "Đã có kết quả tách người nói từ lần trước")

        if need_diar:
            try:
                turns, embeddings = run_diarize(args.audio, args.hf_token, args.num_speakers, device)
                result["turns"] = turns
                result["embeddings"] = embeddings
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
                offset=offset,
                full_duration=full_duration,
                ckpt=ckpt,
                ckpt_path=args.checkpoint,
                stop_file=args.stop_file,
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
                    "status": result.get("status"),
                },
                ensure_ascii=False,
            )
        )
    else:
        print(payload)


if __name__ == "__main__":
    sys.exit(main())
