# -*- coding: utf-8 -*-
"""Test cho phần logic thuần trong pipeline.py — chạy được không cần model."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline import (  # noqa: E402
    clean_hallucination,
    keep_ranges,
    resolve_threads,
    _collapse_repeats,
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
