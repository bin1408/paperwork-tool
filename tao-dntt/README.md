# Công cụ hóa đơn và giấy đề nghị thanh toán

## Công cụ của Thỏ Hằm — GitHub Pages

Trang GitHub Pages chỉ cung cấp công cụ lập giấy đề nghị thanh toán tại `web/giay-de-nghi-thanh-toan.html`. Trang chính chuyển thẳng đến công cụ này; giao diện tra cứu hóa đơn đã được gỡ khỏi website. Ứng dụng desktop tra cứu hóa đơn ở phần dưới vẫn độc lập.

Thư mục `web/` là website tĩnh chạy trong trình duyệt, không có backend, không tải hóa đơn lên máy chủ và không lưu lịch sử. PDF được đọc tạm trong bộ nhớ trình duyệt; PDF.js và Tesseract.js cùng dữ liệu OCR được tải từ CDN, nhưng nội dung hóa đơn không được gửi đến các dịch vụ đó.

GitHub Actions workflow tại `.github/workflows/deploy-pages.yml` triển khai riêng nội dung `web/`, không đưa ứng dụng desktop lên website. Để bật Pages lần đầu, vào **Settings → Pages**, chọn **GitHub Actions** làm nguồn triển khai. Sau khi GitHub triển khai thành công, site có địa chỉ `https://bin1408.github.io/paperwork-tool/`.

Website dùng chung giao diện HDB trong `hdb-ui.css` ở thư mục gốc repository; workflow sao chép stylesheet này vào nội dung Pages khi triển khai.

Site GitHub Pages công khai cần truy cập được cho mọi người, kể cả khi mã nguồn của repository vẫn private. Khả năng xuất bản Pages từ private repository phụ thuộc gói GitHub.

### Tạo Giấy đề nghị thanh toán

Mở trang chính hoặc `web/giay-de-nghi-thanh-toan.html`. Công cụ dùng trực tiếp mẫu Word `web/templates/payment-request.docx`, cho nhập Người đề nghị (được điền vào trường họ tên và phần ký tên), Chức vụ, đọc ngày/số hóa đơn, các dòng hàng hóa và tổng tiền sau thuế từ PDF, rồi điền dòng **Tổng Cộng** và số tiền bằng chữ. Tài liệu xuất ra là `.docx`; nội dung chèn mới dùng Times New Roman cỡ 12.

Mẫu Word duy nhất `web/templates/payment-request.docx` là mẫu chính và được giữ bố cục khi điền. PDF.js và Tesseract.js được tải từ CDN để đọc hóa đơn PDF và OCR khi cần; JSZip được tải để cập nhật DOCX trong trình duyệt. Nội dung hóa đơn và tài liệu tạo ra không được gửi đến CDN hay máy chủ của dự án. Bộ đọc nhận diện nhãn Việt/Anh phổ biến, các dòng hàng hóa, ngày, ký hiệu/số hóa đơn và tổng tiền. Kết quả độ tin cậy thấp được báo để người dùng kiểm tra; hãy đối chiếu thông tin trước khi tải.

Để thay mẫu sau này, cập nhật `web/templates/payment-request.docx`. File mẫu PDF cũ đã được gỡ bỏ.

Kiểm thử parser: `node --test web/tests/payment-request-parser.test.mjs`.

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
