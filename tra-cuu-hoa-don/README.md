# Công cụ tra cứu hóa đơn điện tử

Công cụ đọc hóa đơn PDF có lớp văn bản, trích xuất thông tin cần tra cứu, mở cổng chính thức của Cục Thuế và chờ bạn tự nhập CAPTCHA. Công cụ không đọc, giải hoặc vượt CAPTCHA.

## Phiên bản web trên GitHub Pages

Thư mục `web/` chứa phiên bản web tĩnh chạy trực tiếp trong trình duyệt. Trang không có backend, không tải hóa đơn lên máy chủ và không lưu lịch sử. PDF được đọc tạm trong bộ nhớ trình duyệt; thư viện PDF.js và Tesseract.js cùng dữ liệu OCR được tải từ CDN, nhưng nội dung hóa đơn không được gửi đến các dịch vụ đó.

GitHub Actions workflow tại `.github/workflows/deploy-pages.yml` triển khai riêng nội dung `web/` mà không đưa ứng dụng desktop vào website. Để bật Pages lần đầu, vào **Settings → Pages**, chọn **GitHub Actions** làm nguồn triển khai. Sau khi GitHub triển khai thành công, site có địa chỉ `https://bin1408.github.io/paperwork-tool/`.

Trang web trích xuất thông tin PDF (OCR trang đầu cho bản scan), nhưng không thể tự điền hoặc đọc kết quả từ trang Cục Thuế ở tab khác do giới hạn bảo mật của trình duyệt. Người dùng tự nhập CAPTCHA, tra cứu trên website chính thức và dùng chức năng **In → Lưu thành PDF** của trình duyệt để tải kết quả. Bố cục PDF được quyết định bởi trang Cục Thuế và có thể khác giao diện màn hình.

Site GitHub Pages công khai cần truy cập được cho mọi người, kể cả khi mã nguồn của repository vẫn private. Khả năng xuất bản Pages từ private repository phụ thuộc gói GitHub.

Kiểm thử parser web: `node --test web/tests/parser.test.mjs`.

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
