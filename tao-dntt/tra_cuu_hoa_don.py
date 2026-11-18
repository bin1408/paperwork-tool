"""Tra cứu hóa đơn trên cổng chính thức của Cục Thuế và lưu bằng chứng PDF."""

import base64
import re
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    from mss import tools as mss_tools
    from mss import mss
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit(
        "Python này chưa có các thư viện cần thiết. Hãy chạy cai_dat.sh (macOS/Linux) "
        "hoặc cai_dat.bat (Windows) trước."
    )

URL_TRA_CUU = "https://hoadondientu.gdt.gov.vn/"
TEN_FILE = "tra_cuu_hoa_don_VAT"
THU_MUC_DU_LIEU = Path.home() / "tra_cuu_hoa_don"
MST_LOAI_TRU = "0300608092"


def nhap_thong_tin():
    while True:
        duong_dan = input(
            "\nĐường dẫn hóa đơn PDF (có thể kéo thả file vào đây): "
        ).strip().strip("\"'")
        if not duong_dan:
            print("Bạn cần cung cấp đường dẫn file hóa đơn.")
            continue

        tep = Path(duong_dan).expanduser()
        if not tep.is_file():
            print(f"Không tìm thấy file: {tep}")
            continue
        if tep.suffix.casefold() != ".pdf":
            print("Hiện công cụ nhận hóa đơn dạng PDF.")
            continue

        try:
            thong_tin = doc_thong_tin_hoa_don(tep)
        except (OSError, PdfReadError, ValueError) as loi:
            print(f"Không đọc được thông tin hóa đơn: {loi}")
            continue

        print("\nThông tin trích xuất từ hóa đơn:")
        print(f"Mã số thuế người bán: {thong_tin['mst']}")
        print(f"Ký hiệu hóa đơn: {thong_tin['ky_hieu']}")
        print(f"Số hóa đơn: {thong_tin['so_hoa_don']}")
        print(f"Tổng tiền thanh toán: {thong_tin['tong_tien']}")
        return thong_tin


def doc_thong_tin_hoa_don(tep):
    reader = PdfReader(str(tep))
    if reader.is_encrypted:
        raise ValueError("PDF được mã hóa; hãy gửi bản PDF có thể mở được.")

    van_ban = "\n".join(
        page.extract_text(extraction_mode="layout") or "" for page in reader.pages
    )
    if not van_ban.strip():
        raise ValueError(
            "PDF không có lớp văn bản đọc được. Hóa đơn scan/ảnh cần OCR, "
            "hiện chưa được hỗ trợ."
        )
    return trich_xuat_thong_tin(van_ban)


def trich_xuat_thong_tin(van_ban):
    cac_dong = van_ban.splitlines()
    dau_nguoi_ban = next(
        (
            vi_tri
            for vi_tri, dong in enumerate(cac_dong)
            if re.search(
                r"(?:đơn vị\s*bán hàng|người bán|\bseller\b)", dong, re.I
            )
        ),
        None,
    )
    if dau_nguoi_ban is None:
        raise ValueError("Không xác định được khu vực đơn vị bán hàng trong hóa đơn.")

    dau_nguoi_mua = next(
        (
            vi_tri
            for vi_tri in range(dau_nguoi_ban + 1, len(cac_dong))
            if re.search(
                r"(?:đơn vị\s*mua hàng|người mua|\bbuyer\b)",
                cac_dong[vi_tri],
                re.I,
            )
        ),
        len(cac_dong),
    )
    cac_dong_nguoi_ban = cac_dong[dau_nguoi_ban:dau_nguoi_mua]
    mau_nhan_mst = re.compile(r"(?:mã\s*số\s*thuế|\btax\s*code\b|\bmst\b)", re.I)
    cac_mst = set()
    for vi_tri, dong in enumerate(cac_dong_nguoi_ban):
        if not mau_nhan_mst.search(dong):
            continue
        vung_gia_tri = "\n".join(cac_dong_nguoi_ban[vi_tri : vi_tri + 3])
        for ung_vien in re.findall(
            r"(?<!\d)(?:\d[\s.-]*){9}\d(?!\d)", vung_gia_tri
        ):
            mst = re.sub(r"\D", "", ung_vien)
            if len(mst) == 10 and mst != MST_LOAI_TRU:
                cac_mst.add(mst)
    if not cac_mst:
        raise ValueError(
            "Không tìm thấy mã số thuế người bán hợp lệ (đã loại trừ "
            f"{MST_LOAI_TRU})."
        )
    if len(cac_mst) > 1:
        raise ValueError("Tìm thấy nhiều mã số thuế trong khu vực người bán.")

    mau_ky_hieu = re.compile(
        r"(?:ký\s*hiệu(?:\s*\(\s*serial\s*no\.?\s*\))?|serial\s*no\.?)"
        r"\s*[:：]\s*([A-Z0-9][A-Z0-9./-]*)",
        re.I,
    )
    khop_ky_hieu = mau_ky_hieu.search(van_ban)
    if not khop_ky_hieu or len(khop_ky_hieu.group(1)) < 2:
        raise ValueError("Không tìm thấy ký hiệu hóa đơn hợp lệ.")
    ky_hieu = khop_ky_hieu.group(1)[1:]

    khop_so = re.search(
        r"(?:\bSố\s*\(\s*Invoice\s*No\.?\s*\)|\bSố\s*hóa\s*đơn|"
        r"\bInvoice\s*No\.?)\s*[:：]\s*([0-9][0-9.,]*)",
        van_ban,
        re.I,
    )
    if not khop_so:
        raise ValueError("Không tìm thấy số hóa đơn.")

    khop_tong = re.search(
        r"(?:Tổng\s*cộng\s*tiền\s*thanh\s*toán(?:\s*\(\s*Total\s*\))?|"
        r"\(\s*Total\s*\))\s*[:：]\s*([0-9](?:[0-9.,]|\s(?=\d))*)",
        van_ban,
        re.I,
    )
    if not khop_tong:
        raise ValueError("Không tìm thấy tổng cộng tiền thanh toán.")

    return {
        "mst": next(iter(cac_mst)),
        "ky_hieu": ky_hieu,
        "so_hoa_don": khop_so.group(1),
        "tong_tien": chuan_hoa_tong_tien(khop_tong.group(1)),
    }


def chuan_hoa_tong_tien(gia_tri):
    so_lien_tuc = "".join(gia_tri.split())
    if re.fullmatch(r"\d+", so_lien_tuc):
        return so_lien_tuc
    if re.fullmatch(r"\d{1,3}(?:[.,]\d{3})+", so_lien_tuc):
        return re.sub(r"[.,]", "", so_lien_tuc)
    raise ValueError(
        "Tổng tiền cần là số nguyên; có thể dùng dấu chấm hoặc phẩy để phân "
        "tách hàng nghìn (ví dụ 1.234.567)."
    )


def tim_chrome():
    ung_vien = (
        Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        Path.home() / "Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        Path("C:/Program Files/Google/Chrome/Application/chrome.exe"),
        Path("C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"),
        Path.home() / "AppData/Local/Google/Chrome/Application/chrome.exe",
        Path("/usr/bin/google-chrome"),
        Path("/usr/bin/chromium"),
    )
    for duong_dan in ung_vien:
        if duong_dan.is_file():
            return str(duong_dan)
    raise RuntimeError(
        "Không tìm thấy Google Chrome. Hãy cài Chrome rồi chạy lại công cụ."
    )


def dong_thong_bao(page):
    page.get_by_role("textbox", name=re.compile(r"MST người bán", re.I)).wait_for(
        state="visible", timeout=15000
    )
    thong_bao = page.get_by_role("dialog").filter(
        has_text=re.compile(r"CỤC THUẾ THÔNG BÁO", re.I)
    )
    if not thong_bao.count() or not thong_bao.first.is_visible():
        return

    nut_dong = thong_bao.first.get_by_role(
        "button", name=re.compile(r"^(close|đóng)$", re.I)
    )
    if not nut_dong.count() or not nut_dong.first.is_visible():
        raise RuntimeError("Không tìm thấy nút đóng thông báo của Cục Thuế.")
    nut_dong.first.click(timeout=3000)
    thong_bao.first.wait_for(state="hidden", timeout=5000)


def dien_thong_tin(page, thong_tin):
    cac_o = (
        (r"MST người bán", thong_tin["mst"]),
        (r"Ký hiệu hóa đơn", thong_tin["ky_hieu"]),
        (r"Số hóa đơn", thong_tin["so_hoa_don"]),
        (r"Tổng tiền thanh toán", thong_tin["tong_tien"]),
    )
    for nhan, gia_tri in cac_o:
        page.get_by_role("textbox", name=re.compile(nhan, re.I)).fill(gia_tri)


def trang_thai_tra_cuu(page, thong_tin):
    noi_dung = page.locator("body").inner_text().casefold()
    noi_dung_gon = " ".join(noi_dung.split())

    if any(
        cum_tu in noi_dung_gon
        for cum_tu in (
            "không tồn tại hóa đơn",
            "không tìm thấy hóa đơn",
            "không có hóa đơn",
        )
    ):
        return "khong_ton_tai"

    if any(
        cum_tu in noi_dung_gon
        for cum_tu in (
            "captcha không đúng",
            "mã captcha không đúng",
            "captcha không hợp lệ",
            "mã xác nhận không đúng",
        )
    ):
        return "captcha_sai"

    if any(
        cum_tu in noi_dung_gon
        for cum_tu in ("tồn tại hóa đơn", "hóa đơn tồn tại")
    ):
        return "ton_tai"

    so_hoa_don = thong_tin["so_hoa_don"].casefold()
    for hang in page.locator("table tbody tr, [role='row']").all():
        if not hang.is_visible():
            continue
        noi_dung_hang = " ".join(hang.inner_text().split()).casefold()
        if (
            noi_dung_hang
            and so_hoa_don in noi_dung_hang
            and "không có dữ liệu" not in noi_dung_hang
        ):
            return "ton_tai"
    return None


def doi_ket_qua(page, thong_tin, timeout=30):
    het_gio = time.monotonic() + timeout
    while time.monotonic() < het_gio:
        trang_thai = trang_thai_tra_cuu(page, thong_tin)
        if trang_thai:
            return trang_thai
        page.wait_for_timeout(400)
    return None


def luu_ket_qua(page):
    page.wait_for_timeout(500)
    page.evaluate("() => document.fonts.ready")

    cac_o_can_chup = (
        r"MST người bán",
        r"Ký hiệu hóa đơn",
        r"Số hóa đơn",
        r"Tổng tiền thanh toán",
    )
    cac_khung = [
        page.get_by_role("textbox", name=re.compile(nhan, re.I)).bounding_box()
        for nhan in cac_o_can_chup
    ]
    ket_qua = page.get_by_text(
        re.compile(r"Tồn tại hóa đơn có thông tin trùng khớp", re.I)
    ).bounding_box()
    kich_thuoc = page.evaluate(
        "() => ({width: window.innerWidth, height: window.innerHeight})"
    )
    cac_khung.extend((ket_qua,))
    if any(
        not khung
        or khung["x"] < 0
        or khung["y"] < 0
        or khung["x"] + khung["width"] > kich_thuoc["width"]
        or khung["y"] + khung["height"] > kich_thuoc["height"]
        for khung in cac_khung
    ):
        raise RuntimeError(
            "Các trường tra cứu và kết quả không cùng nằm trong màn hình hiện tại. "
            "Hãy phóng to Chrome/toàn màn hình và giữ nguyên giao diện website rồi thử lại."
        )

    dau_thoi_gian = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    thu_muc = THU_MUC_DU_LIEU / "ket_qua" / dau_thoi_gian
    thu_muc.mkdir(parents=True, exist_ok=False)
    anh = thu_muc / f"{TEN_FILE}.png"
    pdf = thu_muc / f"{TEN_FILE}.pdf"
    with mss() as chup_man_hinh:
        man_hinh = chup_man_hinh.monitors[1]
        khung_hinh = chup_man_hinh.grab(man_hinh)
        mss_tools.to_png(khung_hinh.rgb, khung_hinh.size, output=str(anh))

    anh_data = base64.b64encode(anh.read_bytes()).decode("ascii")
    trang_pdf = page.context.new_page()
    try:
        huong = "landscape" if man_hinh["width"] > man_hinh["height"] else "portrait"
        trang_pdf.set_content(
            f"""<!doctype html>
            <html><head><meta charset="utf-8"><style>
            @page {{ size: A4 {huong}; margin: 0; }}
            html, body {{ margin: 0; width: 100%; height: 100%; }}
            img {{ display: block; width: 100%; height: 100%; object-fit: contain; }}
            </style></head>
            <body><img src="data:image/png;base64,{anh_data}"></body></html>"""
        )
        trang_pdf.pdf(
            path=str(pdf),
            format="A4",
            landscape=huong == "landscape",
            print_background=True,
            margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
        )
    finally:
        trang_pdf.close()
    return anh, pdf


def chay_tra_cuu(page):
    while True:
        thong_tin = nhap_thong_tin()
        dong_thong_bao(page)
        dien_thong_tin(page, thong_tin)

        while True:
            o_captcha = page.get_by_role(
                "textbox", name=re.compile(r"Nhập mã captcha", re.I)
            )
            if not o_captcha.is_visible():
                raise RuntimeError("Không tìm thấy ô nhập CAPTCHA trên trang tra cứu.")

            captcha = input(
                "Nhập mã CAPTCHA đang hiển thị trên Chrome, rồi nhấn Enter: "
            ).strip()
            if not captcha:
                print("Mã CAPTCHA không được để trống.")
                continue
            o_captcha.fill(captcha)
            page.get_by_role("button", name=re.compile(r"^Tìm kiếm$", re.I)).click()

            trang_thai = doi_ket_qua(page, thong_tin)
            if trang_thai == "captcha_sai":
                print(
                    "Mã CAPTCHA chưa đúng. Hãy nhập mã mới; nếu hình không đổi, "
                    "làm mới CAPTCHA trên trang trước."
                )
                continue
            break

        if trang_thai == "khong_ton_tai":
            print("Không tồn tại hóa đơn. Vui lòng nhập lại thông tin hóa đơn.")
            continue

        if trang_thai != "ton_tai":
            raise RuntimeError(
                "Không xác định được kết quả tra cứu sau 30 giây. "
                "Kiểm tra nội dung trang Chrome và thử lại; không tạo file khi "
                "chưa xác nhận hóa đơn tồn tại."
            )

        anh, pdf = luu_ket_qua(page)
        print("Đã xác nhận hóa đơn tồn tại.")
        print(f"Ảnh chụp: {anh}")
        print(f"PDF: {pdf}")
        return


def main():
    try:
        chrome = tim_chrome()
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=False,
                executable_path=chrome,
                args=["--start-fullscreen"],
            )
            context = browser.new_context(no_viewport=True)
            try:
                page = context.new_page()
                page.set_default_timeout(15000)
                page.goto(URL_TRA_CUU, wait_until="domcontentloaded", timeout=60000)
                chay_tra_cuu(page)
            finally:
                context.close()
                browser.close()
    except KeyboardInterrupt:
        print("\nĐã dừng theo yêu cầu.")
    except Exception as loi:
        print(f"Lỗi: {loi}", file=sys.stderr)
        raise SystemExit(1) from loi


if __name__ == "__main__":
    main()
