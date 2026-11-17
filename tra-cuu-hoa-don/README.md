# Công cụ tra cứu hóa đơn điện tử

Công cụ đọc hóa đơn PDF có lớp văn bản, trích xuất thông tin cần tra cứu, mở cổng chính thức của Cục Thuế và chờ bạn tự nhập CAPTCHA. Công cụ không đọc, giải hoặc vượt CAPTCHA.

## Cài đặt

- macOS/Linux: `bash cai_dat.sh`
- Windows: chạy `cai_dat.bat`

Cần có Python 3 và Google Chrome.

## Chạy

- macOS/Linux: `bash chay.sh`
- Windows: chạy `chay.bat`

Mỗi lượt chạy, dán đường dẫn tới hóa đơn PDF vào Terminal/Command Prompt (có thể kéo thả file PDF vào cửa sổ). Công cụ lấy mã số thuế trong khu vực người bán, bỏ qua mã `0300608092`, bỏ ký tự đầu của ký hiệu, rồi trích xuất số hóa đơn và tổng cộng tiền thanh toán. Các giá trị tìm được sẽ hiện ra trước khi tra cứu. Trước khi điền form, công cụ tự đóng hộp thoại thông báo của Cục Thuế nếu hộp thoại này đang xuất hiện. Hiện tại chỉ hỗ trợ PDF có lớp văn bản; PDF scan/ảnh chưa được OCR.

Khi Chrome hiện CAPTCHA, nhập mã đó tại lời nhắc trong Terminal/Command Prompt; công cụ điền mã vào trang và nhấn **Tìm kiếm**. Nếu kết quả báo CAPTCHA sai, nhập lại CAPTCHA. Nếu không tồn tại hóa đơn, công cụ yêu cầu cung cấp file hóa đơn khác.

Khi trang xác nhận hóa đơn tồn tại, Chrome được mở toàn màn hình và công cụ chụp trực tiếp màn hình chính của máy tính. Không thay đổi CSS, zoom, kích thước hay nội dung website; ảnh PNG giữ nguyên giao diện đang hiển thị. Nếu các trường và kết quả không cùng nằm trong màn hình hiện tại, công cụ báo lỗi thay vì chỉnh sửa giao diện để ép chúng vào ảnh. Trên macOS, cần cấp quyền Screen Recording cho ứng dụng đang chạy công cụ nếu hệ điều hành yêu cầu.

Ảnh PNG và PDF (chứa chính ảnh chụp màn hình) được lưu tại `~/tra_cuu_hoa_don/ket_qua/<thời-gian>/` với tên `tra_cuu_hoa_don_VAT.png` và `tra_cuu_hoa_don_VAT.pdf`. Mỗi lượt có thư mục riêng để không ghi đè kết quả trước đó.
