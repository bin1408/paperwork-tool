import assert from "node:assert/strict";
import test from "node:test";
import {
  amountInVietnameseWords,
  extractOcrDescription,
  extractPaymentRequestInvoice,
  mergeOcrDescription,
  normalizeTotal,
} from "../payment-request-parser.mjs";

test("extracts and normalizes invoice date, number, description, and after-tax total", () => {
  assert.deepEqual(
    extractPaymentRequestInvoice(`Ngày hóa đơn: 7/2/2026
Số hóa đơn: 00000045
Tên hàng hóa, dịch vụ: Dịch vụ tư vấn triển khai
Tổng cộng tiền thanh toán (Total): 1.234.567`),
    {
      invoiceDate: "07/02/2026",
      invoiceNumber: "00000045",
      description: "Dịch vụ tư vấn triển khai",
      total: "1234567",
    },
  );
});

test("accepts invoice content labels on a separate line", () => {
  assert.equal(
    extractPaymentRequestInvoice(`Nội dung thanh toán:
Mua thiết bị văn phòng`).description,
    "Mua thiết bị văn phòng",
  );
});

test("uses high-confidence OCR to correct garbled PDF text and keeps existing accents", () => {
  assert.equal(
    mergeOcrDescription(
      "Dịch vụ quảng cáo đợt cuối theo biên bản nghiệm thu của hợp đồng số IPX/2025/HDB/0020 kỳ ngày 08/08/2025 và Phụ lục 01 đính kq m.",
      "Dịch vụ quảng cáo đợt cuối theo biên bản nghiệm thu của hợp đồng số IPX/2025/HDB/0020 kỳ ngày 08/08/2025 va Phụ lục 01 đính kèm.",
      95,
    ),
    "Dịch vụ quảng cáo đợt cuối theo biên bản nghiệm thu của hợp đồng số IPX/2025/HDB/0020 kỳ ngày 08/08/2025 và Phụ lục 01 đính kèm.",
  );
  assert.equal(
    mergeOcrDescription("Nội dung gốc.", "Nội dung Ocr.", 60),
    "Nội dung gốc.",
  );
  assert.equal(
    mergeOcrDescription(
      "Dịch vụ quảng cáo đợt cuối theo biên bản nghiệm thu của hợp đồng số IPX/2025/HDB/0020 kỳ ngày 08/08/2025 và Phụ lục 01 đính kèm.",
      "Dịch vụ quảng cáo đợt cuối theo biên bản nghiệm thu của hợp đồng số IPX/2025/HDB/0020 kỳ ngày 08/08/2025 và Phụ lục 01",
      95,
    ),
    "Dịch vụ quảng cáo đợt cuối theo biên bản nghiệm thu của hợp đồng số IPX/2025/HDB/0020 kỳ ngày 08/08/2025 và Phụ lục 01 đính kèm.",
  );
});

test("extracts OCR item text even when the scanned table heading is garbled", () => {
  assert.equal(
    extractOcrDescription(`»u lên hàng hóa, dịch vụ
No. Item
1 | Dịch vụ quảng cáo đợt cuối theo biên bản nghiệm thu của hợp
dong sô IPX/2025/HDB/0020 kỳ ngày 08/08/2025 và Phụ lục 01
đính kèm.`),
    "Dịch vụ quảng cáo đợt cuối theo biên bản nghiệm thu của hợp dong sô IPX/2025/HDB/0020 kỳ ngày 08/08/2025 và Phụ lục 01 đính kèm.",
  );
});

test("extracts dates and item descriptions from bilingual invoice tables", () => {
  assert.deepEqual(
    extractPaymentRequestInvoice(`Ngày (Day) 01 tháng (month) 10 năm (year) 2026
Số (Invoice No.) : 48
Tên hàng hóa, dịch vụ Đvt Số lượng Đơn giá Thành tiền
Item UOM Quantity Price Amount
1 2 3 4 5 6=4x5
1 Dịch vụ quảng cáo đợt cuối theo biên bản nghiệm thu của hợp 1.386.704.142
đồng số IPX/2025/HDB/0020 kỳ ngày 08/08/2025 và Phụ lục 01
đính kèm.
Đơn vị cung cấp giải pháp hóa đơn điện tử: Công ty FAST
Cộng tiền hàng (Total Amount) : 1.386.704.142
Thuế suất GTGT (VAT Rate) : 8% Tiền thuế GTGT (VAT) : 110.936.331
Tổng cộng tiền thanh toán (Total) : 1.497.640.473`),
    {
      invoiceDate: "01/10/2026",
      invoiceNumber: "48",
      description:
        "Dịch vụ quảng cáo đợt cuối theo biên bản nghiệm thu của hợp đồng số IPX/2025/HDB/0020 kỳ ngày 08/08/2025 và Phụ lục 01 đính kèm.",
      total: "1497640473",
    },
  );
});

test("accepts Vietnamese written dates and rejects invalid calendar dates", () => {
  assert.equal(
    extractPaymentRequestInvoice("Ngày 9 tháng 11 năm 2025").invoiceDate,
    "09/11/2025",
  );
  assert.equal(
    extractPaymentRequestInvoice("Ngày lập hóa đơn: 31/02/2025").invoiceDate,
    "",
  );
});

test("reads common Vietnamese currency amounts", () => {
  assert.equal(amountInVietnameseWords("0"), "Không đồng");
  assert.equal(amountInVietnameseWords("21"), "Hai mươi mốt đồng");
  assert.equal(amountInVietnameseWords("104"), "Một trăm lẻ bốn đồng");
  assert.equal(
    amountInVietnameseWords("1005"),
    "Một nghìn không trăm lẻ năm đồng",
  );
  assert.equal(
    amountInVietnameseWords("1000001"),
    "Một triệu không trăm lẻ một đồng",
  );
  assert.equal(
    amountInVietnameseWords("1497640473"),
    "Một tỷ bốn trăm chín mươi bảy triệu sáu trăm bốn mươi nghìn bốn trăm bảy mươi ba đồng",
  );
  assert.throws(() => amountInVietnameseWords("12.5"), /không hợp lệ/);
});

test("normalizes grouped totals and rejects decimal formats", () => {
  assert.equal(normalizeTotal("1.234.567"), "1234567");
  assert.equal(normalizeTotal("513 186 123"), "513186123");
  assert.throws(() => normalizeTotal("1.234,56"), /số nguyên/);
});
