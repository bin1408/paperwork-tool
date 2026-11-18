import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tra_cuu_hoa_don


class TrichXuatHoaDonTests(unittest.TestCase):
    def setUp(self):
        self.van_ban = """Ký hiệu (Serial No.): 1C26TIX
Số (Invoice No.): 99
Đơn vị bán hàng (Seller): CÔNG TY BÁN HÀNG
Mã số thuế (Tax Code): 1 2 3 4 5 6 7 8 9 0
Đơn vị mua hàng (Buyer): NGÂN HÀNG
Mã số thuế (Tax Code): 0 3 0 0 6 0 8 0 9 2
Tổng cộng tiền thanh toán (Total): 123.456.789
"""

    def test_extracts_fields_and_excludes_buyer_tax_code(self):
        self.assertEqual(
            tra_cuu_hoa_don.trich_xuat_thong_tin(self.van_ban),
            {
                "mst": "1234567890",
                "ky_hieu": "C26TIX",
                "so_hoa_don": "99",
                "tong_tien": "123456789",
            },
        )

    def test_does_not_use_buyer_tax_code_if_seller_code_is_excluded(self):
        van_ban = self.van_ban.replace(
            "1 2 3 4 5 6 7 8 9 0", "0 3 0 0 6 0 8 0 9 2"
        )
        with self.assertRaisesRegex(ValueError, "Không tìm thấy mã số thuế"):
            tra_cuu_hoa_don.trich_xuat_thong_tin(van_ban)

    def test_normalizes_grouped_total(self):
        self.assertEqual(
            tra_cuu_hoa_don.chuan_hoa_tong_tien("1.497.640.473"),
            "1497640473",
        )


if __name__ == "__main__":
    unittest.main()
