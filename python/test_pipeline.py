# -*- coding: utf-8 -*-
"""Test cho phần logic thuần trong pipeline.py — chạy được không cần model."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline import (  # noqa: E402
    VIBEVOICE_SAMPLE_RATE,
    VibeVoiceTicker,
    clean_hallucination,
    keep_ranges,
    resample_audio,
    resolve_threads,
    trim_from,
    vv_pending_windows,
    vv_percent,
    vv_windows,
    _collapse_repeats,
    _vv_local_turns,
    _vv_merge,
)

# Chuỗi có thật người dùng gặp, chép nguyên từ ảnh chụp màn hình
THUC_TE = (
    "Hãy subscribe cho kênh lalaschool Để không bỏ lỡ những video hấp dẫn "
    "Hãy subscribe cho kênh Ghiền Mì Gõ Để không bỏ lỡ những video hấp dẫn "
    "Hãy subscribe cho kênh lalaschool Để không bỏ lỡ những video hấp dẫn "
    "Hãy subscribe cho kênh Ghiền Mì Gõ Để không bỏ lỡ những video hấp dẫn "
    "Hãy subscribe cho kênh Ghiền Mì Gõ Để không bỏ lỡ những video hấp dẫn "
    "Bây giờ anh em đấy, câu này là cho Dương vô hội này này."
)


class LocAoGiac(unittest.TestCase):
    def test_giu_lai_loi_noi_that_lan_trong_cau_rac(self):
        """Quan trọng nhất: KHÔNG được bỏ cả lượt, vì lời thật hay nằm lẫn ở cuối."""
        out, n = clean_hallucination(THUC_TE)
        self.assertEqual(out, "Bây giờ anh em đấy, câu này là cho Dương vô hội này này.")
        self.assertEqual(n, 5)

    def test_lai_toan_cau_rac_thi_ra_rong_de_bi_bo(self):
        out, n = clean_hallucination(
            "Hãy subscribe cho kênh Ghiền Mì Gõ Để không bỏ lỡ những video hấp dẫn"
        )
        self.assertEqual(out, "")
        self.assertGreater(n, 0)

    def test_khong_dung_vao_cau_hop_binh_thuong(self):
        for cau in [
            "Dân số. Bọn tỉnh Lào Cai là bao nhiêu người?",
            "Chốt nhé anh em, mai gửi proposal.",
            "Doanh thu quý này tăng mười tám phần trăm.",
        ]:
            out, n = clean_hallucination(cau)
            self.assertEqual(out, cau)
            self.assertEqual(n, 0)

    def test_tu_subscribe_dung_nghia_khong_bi_cat(self):
        """Người ta có thể nói 'subscribe' thật trong cuộc họp kỹ thuật."""
        cau = "Bên mình cần subscribe gói API của họ trước."
        out, n = clean_hallucination(cau)
        self.assertEqual(out, cau)
        self.assertEqual(n, 0)

    def test_khong_phan_biet_hoa_thuong(self):
        out, _ = clean_hallucination("HÃY SUBSCRIBE CHO KÊNH GHIỀN MÌ GÕ")
        self.assertEqual(out, "")

    def test_rong_va_none_khong_no(self):
        self.assertEqual(clean_hallucination("")[0], "")
        self.assertEqual(clean_hallucination(None)[0], None)
        self.assertEqual(clean_hallucination("   ")[1], 0)

    def test_cau_tieng_anh_hay_bi_bia_o_doan_im_lang(self):
        out, n = clean_hallucination("Thank you for watching!")
        self.assertEqual(out, "")
        self.assertGreater(n, 0)


class HoCauQuangCao(unittest.TestCase):
    """
    Bắt theo HỌ CÂU, vì mấy câu outro YouTube biến thể vô tận, chép tay không xuể.
    Nhưng phải chặt: cắt nhầm câu họp thật còn tệ hơn sót câu rác.
    """

    PHAI_GO = [
        "Hãy đăng ký kênh để ủng hộ kênh của mình nhé!",
        "Các bạn hãy đăng kí cho kênh",
        "Nhớ đăng kí cho kênh mình nhé",
        "Hãy subscribe cho kênh Ghiền Mì Gõ Để không bỏ lỡ những video hấp dẫn",
    ]

    # Câu họp thật có chứa "đăng ký kênh" / "subscribe" theo nghĩa công việc
    KHONG_DUOC_DUNG = [
        "Bên marketing cần đăng ký kênh phân phối mới trong quý này.",
        "Team đăng ký kênh bán hàng qua đại lý nhé anh.",
        "Anh đăng ký kênh Slack cho team mình nhé.",
        "Mình cần subscribe gói API của họ trước.",
    ]

    def test_go_het_cac_bien_the(self):
        for t in self.PHAI_GO:
            out, n = clean_hallucination(t)
            self.assertEqual(out, "", "chưa gỡ được: %s" % t)
            self.assertGreater(n, 0)

    def test_khong_cat_nham_cau_hop_that(self):
        for t in self.KHONG_DUOC_DUNG:
            out, n = clean_hallucination(t)
            self.assertEqual(out, t, "cắt nhầm câu thật: %s" % t)
            self.assertEqual(n, 0)

    def test_nguoi_dung_tu_them_cau_chan(self):
        t = "Xin chào quý vị và các bạn, hôm nay chúng ta họp sprint."
        self.assertEqual(clean_hallucination(t)[1], 0)
        out, n = clean_hallucination(t, ["xin chào quý vị và các bạn"])
        self.assertGreater(n, 0)
        self.assertIn("hôm nay chúng ta họp sprint", out)

    def test_danh_sach_them_rong_hoac_none_khong_no(self):
        t = "Câu bình thường."
        self.assertEqual(clean_hallucination(t, None)[0], t)
        self.assertEqual(clean_hallucination(t, [])[0], t)
        self.assertEqual(clean_hallucination(t, ["", "   "])[0], t)


class DoiTanSoLayMau(unittest.TestCase):
    """
    ffmpeg tách audio ở 16kHz cho Whisper, nhưng VibeVoice-ASR ĐÒI 24kHz và
    từ chối thẳng nếu sai. Bản trước thiếu bước này nên bóc băng chết ngay.
    """

    def _sin(self, n, sr=16000):
        import numpy as np

        return np.sin(2 * np.pi * 440 * np.arange(n) / sr).astype("float32")

    def test_16k_len_24k_dung_so_mau(self):
        x = self._sin(16000)
        y, sr = resample_audio(x, 16000, VIBEVOICE_SAMPLE_RATE)
        self.assertEqual(sr, 24000)
        self.assertEqual(len(y), 24000)

    def test_cung_tan_so_thi_giu_nguyen(self):
        x = self._sin(1600)
        y, sr = resample_audio(x, 16000, 16000)
        self.assertEqual(sr, 16000)
        self.assertEqual(len(y), len(x))

    def test_rong_khong_no(self):
        import numpy as np

        y, _ = resample_audio(np.array([], dtype="float32"), 16000, 24000)
        self.assertEqual(len(y), 0)

    def test_giu_duoc_hinh_dang_song(self):
        """Đổi tần số xong vẫn phải là sóng sin chứ không thành rác."""
        import numpy as np

        x = self._sin(16000)
        y, _ = resample_audio(x, 16000, 24000)
        self.assertLess(abs(float(np.max(y)) - 1.0), 0.05)
        self.assertLess(abs(float(np.min(y)) + 1.0), 0.05)


class GopCauLap(unittest.TestCase):
    def test_lap_ba_lan_tro_len_thi_gop(self):
        out = _collapse_repeats("Chốt nhé. Chốt nhé. Chốt nhé. Chốt nhé. Xong rồi.")
        self.assertEqual(out.count("Chốt nhé"), 2)
        self.assertIn("Xong rồi", out)

    def test_lap_hai_lan_la_binh_thuong_khi_noi(self):
        cau = "Đúng rồi. Đúng rồi."
        self.assertEqual(_collapse_repeats(cau), cau)

    def test_cac_cau_khac_nhau_giu_nguyen_het(self):
        cau = "Một. Hai. Ba. Bốn."
        self.assertEqual(_collapse_repeats(cau), cau)


class SoLuong(unittest.TestCase):
    def test_khong_dat_thi_dung_het_so_nhan(self):
        self.assertEqual(resolve_threads(0), max(1, os.cpu_count() or 4))
        self.assertEqual(resolve_threads(""), max(1, os.cpu_count() or 4))
        self.assertEqual(resolve_threads(None), max(1, os.cpu_count() or 4))

    def test_dat_bao_nhieu_dung_bay_nhieu(self):
        self.assertEqual(resolve_threads(6), 6)
        self.assertEqual(resolve_threads("12"), 12)

    def test_gia_tri_rac_khong_no(self):
        self.assertGreaterEqual(resolve_threads("abc"), 1)


class VungBoQua(unittest.TestCase):
    """
    Đổi "đoạn cần bỏ" thành "đoạn cần giữ". Sai ở đây là bóc nhầm đoạn hoặc mất
    nội dung mà không ai biết, nên test kỹ cả các ca người dùng thao tác ẩu.
    """

    def test_bo_dau_video(self):
        self.assertEqual(keep_ranges([{"start": 0, "end": 600}], 3600), [(600.0, 3600.0)])

    def test_bo_giua_thi_tach_lam_hai(self):
        self.assertEqual(
            keep_ranges([{"start": 600, "end": 1200}], 3600),
            [(0.0, 600.0), (1200.0, 3600.0)],
        )

    def test_bo_nhieu_doan(self):
        self.assertEqual(
            keep_ranges([{"start": 0, "end": 600}, {"start": 2700, "end": 3000}], 3600),
            [(600.0, 2700.0), (3000.0, 3600.0)],
        )

    def test_cac_doan_chong_lan_duoc_gop_lai(self):
        self.assertEqual(
            keep_ranges([{"start": 300, "end": 1200}, {"start": 900, "end": 1800}], 3600),
            [(0.0, 300.0), (1800.0, 3600.0)],
        )

    def test_danh_dau_nguoc_dau_duoi_van_hieu_dung(self):
        self.assertEqual(keep_ranges([{"start": 1200, "end": 600}], 3600), [(0.0, 600.0), (1200.0, 3600.0)])

    def test_vuot_qua_do_dai_thi_kep_lai(self):
        self.assertEqual(keep_ranges([{"start": 3000, "end": 99999}], 3600), [(0.0, 3000.0)])

    def test_bo_het_thi_khong_con_gi(self):
        self.assertEqual(keep_ranges([{"start": 0, "end": 3600}], 3600), [])

    def test_khong_bo_gi_thi_giu_ca_video(self):
        self.assertEqual(keep_ranges([], 3600), [(0.0, 3600.0)])

    def test_doan_qua_ngan_thi_bo_qua_cho_khoi_vun(self):
        self.assertEqual(keep_ranges([{"start": 10, "end": 10.01}], 3600), [(0.0, 3600.0)])

    def test_du_lieu_rac_khong_lam_no(self):
        self.assertEqual(keep_ranges([{"start": "x", "end": None}], 3600), [(0.0, 3600.0)])
        self.assertEqual(keep_ranges(None, 3600), [(0.0, 3600.0)])

    def test_khong_biet_do_dai_thi_tra_rong(self):
        self.assertEqual(keep_ranges([{"start": 0, "end": 10}], 0), [])

    def test_tong_thoi_gian_giu_lai_dung_bang_hieu(self):
        keep = keep_ranges([{"start": 0, "end": 600}, {"start": 2700, "end": 3000}], 3600)
        self.assertAlmostEqual(sum(b - a for a, b in keep), 3600 - 600 - 300, places=3)


class CuaSoVibeVoice(unittest.TestCase):
    def test_video_90_phut_chia_hai_cua_so(self):
        self.assertEqual(vv_windows(5413.0), [(0.0, 3000.0), (3000.0, 5413.0)])

    def test_video_ngan_hon_mot_cua_so_thi_chi_mot(self):
        self.assertEqual(vv_windows(600.0), [(0.0, 600.0)])

    def test_audio_rong_van_tra_mot_cua_so_khong_no(self):
        self.assertEqual(vv_windows(0.0), [(0.0, 0.0)])


class ChonCuaSoConPhaiChay(unittest.TestCase):
    """
    Chỗ từng có bug mất trắng 40 phút cuối: cũ đếm theo SỐ THỨ TỰ cửa sổ, mà khi
    chạy tiếp thì app đã cắt bỏ phần audio đã xong, nên cửa sổ số 0 của lần chạy
    mới là phần audio HOÀN TOÀN MỚI — bị nhầm là "đã xong" rồi bỏ qua luôn.
    """

    def test_chua_chay_gi_thi_phai_chay_het(self):
        self.assertEqual(len(vv_pending_windows(vv_windows(5413.0), 0.0, 0.0)), 2)

    def test_chay_tiep_sau_khi_xong_cua_so_1_KHONG_duoc_bo_qua_phan_con_lai(self):
        # App cắt audio từ giây 3000, nên clip mới dài 2413s -> đúng 1 cửa sổ
        pending = vv_pending_windows(vv_windows(2413.0), offset=3000.0, done_sec=3000.0)
        self.assertEqual(len(pending), 1, "bỏ qua cửa sổ này = mất trắng 40 phút cuối")
        self.assertEqual(pending[0][1], 0.0)

    def test_khong_cat_audio_thi_cua_so_da_xong_moi_bi_bo_qua(self):
        # Đường "vùng bỏ qua": audio giữ nguyên nên mốc cửa sổ là tuyệt đối
        pending = vv_pending_windows(vv_windows(5413.0), offset=0.0, done_sec=3000.0)
        self.assertEqual([i for i, _s, _e in pending], [1])

    def test_xong_het_thi_khong_con_gi_phai_chay(self):
        self.assertEqual(vv_pending_windows(vv_windows(5413.0), 0.0, 5413.0), [])

    def test_dung_giua_cua_so_thi_cua_so_do_van_phai_chay_lai(self):
        pending = vv_pending_windows(vv_windows(5413.0), offset=0.0, done_sec=1200.0)
        self.assertEqual([i for i, _s, _e in pending], [0, 1])


class CatTrungKhiChayTiep(unittest.TestCase):
    def test_bo_cau_nam_trong_doan_sap_boc_lai(self):
        segs = [{"start": 0, "end": 5}, {"start": 1190, "end": 1199}, {"start": 1250, "end": 1260}]
        self.assertEqual(len(trim_from(segs, 1200.0)), 2)

    def test_khong_co_gi_can_cat_thi_giu_nguyen(self):
        segs = [{"start": 0, "end": 5}]
        self.assertEqual(trim_from(segs, 1200.0), segs)

    def test_du_lieu_rac_khong_lam_no(self):
        self.assertEqual(trim_from([{"end": 3}], 10.0), [{"end": 3}])


class PhanTramTienDo(unittest.TestCase):
    def test_bam_theo_so_giay_audio_da_xong(self):
        self.assertEqual(vv_percent(0, 5413), 3)
        self.assertEqual(vv_percent(2706, 5413), 47)
        self.assertEqual(vv_percent(5413, 5413), 95)

    def test_nhieu_moc_giua_cua_so_cho_ra_nhieu_gia_tri_khac_nhau(self):
        # Cũ: cả video 90 phút chỉ hiện được 3 con số 5 -> 54 -> 99
        self.assertGreater(len({vv_percent(t, 3000) for t in range(0, 3000, 180)}), 10)

    def test_khong_biet_do_dai_thi_khong_chia_cho_0(self):
        self.assertEqual(vv_percent(100, 0), 5)

    def test_khong_bao_gio_bao_100_de_khong_nhay_truoc_buoc_gan_nguoi_noi(self):
        self.assertLessEqual(vv_percent(10**9, 5413), 96)


PARSED = [
    {"Start": 0.0, "End": 4.0, "Speaker": 0, "Content": "Chào cả nhà."},
    {"Start": 4.5, "End": 9.0, "Speaker": 1, "Content": "Bắt đầu sprint review nhé."},
    {"Start": 9.5, "End": 12.0, "Speaker": 0, "Content": "Ừ, chốt luôn."},
]


class DoiKetQuaParseThanhLuotNoi(unittest.TestCase):
    def test_cong_moc_cua_so_vao_thoi_gian(self):
        out = _vv_local_turns(PARSED, 1, 3000.0, 0.0, False, None)
        self.assertEqual(out[0]["start"], 3000.0)
        self.assertEqual(out[2]["end"], 3012.0)

    def test_offset_khi_audio_bi_cat_cung_duoc_cong(self):
        out = _vv_local_turns(PARSED, 0, 0.0, 1200.0, False, None)
        self.assertEqual(out[0]["start"], 1200.0)

    def test_bo_luot_cuoi_khi_model_dang_sinh_do_dang(self):
        # Giữa lúc sinh, lượt cuối luôn còn dở: chữ cắt giữa câu, mốc End chưa có
        out = _vv_local_turns(PARSED, 0, 0.0, 0.0, False, None, drop_last=True)
        self.assertEqual(len(out), 2)

    def test_nguoi_noi_duoc_danh_dau_theo_cua_so_de_khong_lan_nhau(self):
        a = _vv_local_turns(PARSED, 0, 0.0, 0.0, False, None)
        b = _vv_local_turns(PARSED, 1, 3000.0, 0.0, False, None)
        self.assertEqual({x["speaker"] for x in a} & {x["speaker"] for x in b}, set())

    def test_chi_dem_cau_ao_giac_o_lan_gop_cuoi(self):
        rac = [
            {
                "Start": 0,
                "End": 3,
                "Speaker": 0,
                "Content": "Hãy subscribe cho kênh Ghiền Mì Gõ Để không bỏ lỡ những video hấp dẫn",
            }
        ]
        dem = [0]
        _vv_local_turns(rac, 0, 0.0, 0.0, True, None, counter=dem)
        self.assertGreater(dem[0], 0)
        # Tick giữa cửa sổ không truyền counter -> không đếm trùng nhiều lần
        _vv_local_turns(rac, 0, 0.0, 0.0, True, None, counter=None)
        self.assertGreater(dem[0], 0)

    def test_du_lieu_rac_bi_bo_qua_chu_khong_lam_no(self):
        out = _vv_local_turns(
            [{"Start": "x"}, {"Start": 1, "End": 2, "Content": "ok"}], 0, 0.0, 0.0, False, None
        )
        self.assertEqual(len(out), 1)

    def test_end_som_hon_start_thi_bi_keo_bang_start(self):
        out = _vv_local_turns([{"Start": 10, "End": 2, "Content": "x"}], 0, 0.0, 0.0, False, None)
        self.assertEqual(out[0]["end"], out[0]["start"])


class GopKetQuaCuaSo(unittest.TestCase):
    def test_khong_co_voiceprint_thi_danh_so_moi_chu_khong_doan_bua(self):
        local = _vv_local_turns(PARSED, 0, 0.0, 0.0, False, None)
        turns, segs, voices = _vv_merge(local, [], {}, {}, 0.72)
        self.assertEqual(sorted({t["speaker"] for t in turns}), ["SPEAKER_00", "SPEAKER_01"])
        self.assertEqual(len(segs), 3)
        self.assertEqual(voices, {})

    def test_goi_lai_nhieu_lan_voi_cung_base_thi_KHONG_nhan_doi_cau(self):
        """Điều kiện sống còn của việc ghi checkpoint giữa cửa sổ."""
        local = _vv_local_turns(PARSED, 0, 0.0, 0.0, False, None)
        base_turns = [{"start": -5, "end": -1, "speaker": "SPEAKER_00"}]
        a = _vv_merge(local, base_turns, {}, {}, 0.72)
        b = _vv_merge(local, base_turns, {}, {}, 0.72)
        self.assertEqual(a[0], b[0])
        self.assertEqual(a[1], b[1])
        self.assertEqual(len(base_turns), 1, "base bị sửa thì mỗi tick lại cộng dồn thêm")

    def test_danh_so_nguoi_noi_tiep_noi_qua_cac_cua_so(self):
        base_turns = [
            {"start": 0, "end": 5, "speaker": "SPEAKER_00"},
            {"start": 5, "end": 9, "speaker": "SPEAKER_01"},
        ]
        local = _vv_local_turns(PARSED, 1, 3000.0, 0.0, False, None)
        turns, _segs, _v = _vv_merge(local, base_turns, {}, {}, 0.72)
        self.assertEqual(sorted({t["speaker"] for t in turns[2:]}), ["SPEAKER_02", "SPEAKER_03"])

    def test_giong_khop_voiceprint_thi_ghep_lai_dung_nguoi_cu(self):
        local = _vv_local_turns(PARSED, 1, 3000.0, 0.0, False, None)
        base_voices = {"SPEAKER_00": [1.0, 0.0, 0.0]}
        emb = {"vv1_s0": [1.0, 0.0, 0.0], "vv1_s1": [0.0, 1.0, 0.0]}
        turns, _segs, voices = _vv_merge(local, [], base_voices, emb, 0.72)
        self.assertEqual(turns[0]["speaker"], "SPEAKER_00")
        self.assertIn("SPEAKER_01", voices)

    def test_hai_nguoi_khong_bi_gop_vao_cung_mot_ten(self):
        local = _vv_local_turns(PARSED, 0, 0.0, 0.0, False, None)
        # Cả hai giọng đều khớp SPEAKER_00: chỉ một người được nhận, người kia phải là mới
        base_voices = {"SPEAKER_00": [1.0, 0.0]}
        emb = {"vv0_s0": [1.0, 0.0], "vv0_s1": [0.99, 0.01]}
        turns, _segs, _v = _vv_merge(local, [], base_voices, emb, 0.72)
        self.assertEqual(len({t["speaker"] for t in turns}), 2)

    def test_cau_rong_khong_vao_transcript_nhung_van_tinh_la_luot_noi(self):
        local = [{"start": 0, "end": 3, "speaker": "vv0_s0", "text": ""}]
        turns, segs, _v = _vv_merge(local, [], {}, {}, 0.72)
        self.assertEqual(len(turns), 1)
        self.assertEqual(segs, [])


class _ProcessorGia:
    """Processor giả: decode ra một lượt nói cho mỗi 10 token nhận được."""

    def decode(self, ids, return_format=None):
        row = ids[0]
        n = len(row.tolist()) if hasattr(row, "tolist") else len(row)
        return [
            [
                {"Start": i, "End": i + 1, "Speaker": 0, "Content": "c%d" % i}
                for i in range(n // 10)
            ]
        ]


class TickerBamTheoToken(unittest.TestCase):
    def test_bo_prompt_o_lan_put_dau_tien(self):
        t = VibeVoiceTicker(_ProcessorGia(), lambda items: None, every_tokens=1000)
        t.put([1, 2, 3, 4, 5])  # transformers đẩy chính prompt vào đây
        t.put([9])  # token model sinh ra
        self.assertEqual(t.skip, 5)
        self.assertEqual(t.ids[t.skip :], [9])

    def test_khong_co_prompt_thi_khong_an_mat_token_that(self):
        t = VibeVoiceTicker(_ProcessorGia(), lambda items: None, every_tokens=1000)
        t.put([7])
        self.assertEqual(t.skip, 0)
        self.assertEqual(t.ids[t.skip :], [7])

    def test_bao_lai_sau_moi_n_token_chu_khong_moi_token(self):
        got = []
        t = VibeVoiceTicker(_ProcessorGia(), lambda items: got.append(len(items)), every_tokens=20)
        t.put([0] * 3)
        for _ in range(60):
            t.put([1])
        self.assertEqual(len(got), 3)

    def test_callback_no_thi_khong_lam_chet_luot_boc_bang(self):
        def hong(items):
            raise RuntimeError("ghi checkpoint hỏng")

        t = VibeVoiceTicker(_ProcessorGia(), hong, every_tokens=5)
        t.put([0] * 3)
        for _ in range(20):
            t.put([1])
        t.end()

    def test_parse_hong_thi_tra_rong_chu_khong_no(self):
        class Vo:
            def decode(self, ids, return_format=None):
                raise ValueError("chữ đang dở dang giữa một lượt nói")

        t = VibeVoiceTicker(Vo(), lambda items: None)
        t.put([1, 2, 3])
        t.put([4])
        self.assertEqual(t.parsed(), [])

    def test_gia_tri_la_khong_lam_no(self):
        t = VibeVoiceTicker(_ProcessorGia(), lambda items: None, every_tokens=1000)
        t.put(None)
        t.put(object())
        t.put(5)
        self.assertEqual(t.ids, [5])


if __name__ == "__main__":
    unittest.main(verbosity=2)
