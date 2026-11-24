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
      invoiceSerial: "",
      invoiceNumber: "00000045",
      items: [],
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
      invoiceSerial: "",
      invoiceNumber: "48",
      items: [{
        stt: "1",
        description: "Dịch vụ quảng cáo đợt cuối theo biên bản nghiệm thu của hợp đồng số IPX/2025/HDB/0020 kỳ ngày 08/08/2025 và Phụ lục 01 đính kèm.",
        amount: "1386704142",
      }],
      description:
        "Dịch vụ quảng cáo đợt cuối theo biên bản nghiệm thu của hợp đồng số IPX/2025/HDB/0020 kỳ ngày 08/08/2025 và Phụ lục 01 đính kèm.",
      total: "1497640473",
    },
  );
});

test("extracts the full item description from the attached invoice layout", () => {
  assert.equal(
    extractPaymentRequestInvoice(`Tên hàng hóa, dịch vụ
Item
ĐVT
Unit
Số lượng
Quantity
Đơn giá
Price
Thành tiền
Amount
1 2 3 4 5 6=4x5
1
Chi phí dịch vụ đợt 2 theo Biên bản nghiệm thu của hợp đồng số
201224/HDKT-HDB-PMAX-HD ký ngày 20/12/2024 và Phụ
lục 01 số PL01 - 201224/HDKT-HDB-PMAX-HD ký ngày
01/04/2025
1.670.113.399
Cộng tiền hàng (Total Amount): 1.670.113.399`).description,
    "Chi phí dịch vụ đợt 2 theo Biên bản nghiệm thu của hợp đồng số 201224/HDKT-HDB-PMAX-HD ký ngày 20/12/2024 và Phụ lục 01 số PL01 - 201224/HDKT-HDB-PMAX-HD ký ngày 01/04/2025",
  );
});

test("extracts the invoice number and wrapped description from the Game Euro invoice", () => {
  assert.deepEqual(
    extractPaymentRequestInvoice(`Ngày (Date) 26 tháng (month) 06 năm (year) 2024
Số (No.): 00000065
Tên hàng hóa, dịch vụ
(Name of goods and services)
Đơn vị tính
(Unit)
Số lượng
(Quantity)
Đơn giá
(Unit price)
Thành tiền
(Amount)
1
Dịch vụ quảng cáo đợt 1 theo hợp đồng số
120624/HDKT/HDBANK-
APPROI/GAMEEURO2024 ký ngày
12/06/2024 và PL01 -
120624/HDKT/HDBANK-
APPROI/GAMEEURO2024 ký ngày
12/06/2024
832.956.396
Cộng tiền hàng (Total before VAT): 832.956.396
Tổng tiền thanh toán (Total amount): 899.592.908`),
    {
      invoiceDate: "26/06/2024",
      invoiceSerial: "",
      invoiceNumber: "00000065",
      items: [{
        stt: "1",
        description: "Dịch vụ quảng cáo đợt 1 theo hợp đồng số 120624/HDKT/HDBANK-APPROI/GAMEEURO2024 ký ngày 12/06/2024 và PL01 - 120624/HDKT/HDBANK-APPROI/GAMEEURO2024 ký ngày 12/06/2024",
        amount: "832956396",
      }],
      description:
        "Dịch vụ quảng cáo đợt 1 theo hợp đồng số 120624/HDKT/HDBANK-APPROI/GAMEEURO2024 ký ngày 12/06/2024 và PL01 - 120624/HDKT/HDBANK-APPROI/GAMEEURO2024 ký ngày 12/06/2024",
      total: "899592908",
    },
  );
});

test("ignores tax formulas and amount columns in the Google invoice description", () => {
  const text = `Ngày (Date) 02 tháng (month) 11 năm (year) 2026
Ký hiệu (Serial): 1C26T GG
Số (No.): 3520676
Tên hàng hóa, dịch vụ
(Description)
Đơn vị tính
(Unit)
Số lượng
(Quantity)
Đơn giá
(Unit Price)
chưa có thuế GTGT
Thuế suất
(VAT rate %)
Thành tiền
(Amount)
Thành tiền có thuế GTGT
(Amount including VAT)
Tiền thuế GTGT
(VAT Amount)
(1) (2) (3) (4) (5) (6) = (4) x (5) (7) (8) = (6) x (7) (9) = (6) + (8)
1 Dịch vụ quảng cáo Google: Dịch vụ 1 85.977.890 85.977.890 8% 6.878.231 92.856.121
Ads
Tổng tiền theo từng loại thuế suất
KCT (Not taxable) 0% 5% 8% 10% Tổng cộng (Total)
Tổng tiền thanh toán (Total payment): 92.856.121`;
  const result = extractPaymentRequestInvoice(text);
  assert.equal(result.invoiceDate, "02/11/2026");
  assert.equal(result.invoiceNumber, "3520676");
  assert.equal(result.description, "Dịch vụ quảng cáo Google: Ads");
  assert.equal(result.total, "92856121");
  assert.equal(extractOcrDescription(text), "Dịch vụ quảng cáo Google: Ads");
});

test("reads the scanned pharmacy invoice fields and all six medicine rows after OCR", () => {
  const result = extractPaymentRequestInvoice(`BỆNH VIỆN TAI MŨI HỌNG
Mã số thuế: 0301269050
Ký hiệu: 2K26TDP
Số: 43397
Ngày 27 Tháng 02 Năm 2026
HÓA ĐƠN BÁN HÀNG (Sử dụng nhà thuốc)
STT Tên hàng hóa, dịch vụ Đơn vị tính Số lượng Đơn giá Thành tiền
1 2 3 4 5 6=4x5
1 Wizosone 90 liều xịt,Lọ (Việt Nam) Lọ 1 124.950 124.950
2 BICELOR 375 DT, 375mg,Viên (Việt Nam) Viên 20 9.309 186.180
3 BROSAFE 100 F.I.P units, 100 F.I.P units,Viên (Công ty cổ phần Dược Trung ương Mediplantex,Việt Nam) Viên 20 8.097 161.940
4 ALLERGEX 8mg, 8mg,Viên (Công ty cổ phần dược phẩm OPV,Việt Nam) Viên 20 7.661 153.220
5 SAVI•TOUX 600mg, 600mg,Viên sủi (Công ty cổ phần dược phẩm SaVi,Việt Nam) Viên sủi 10 5.478 54.780
6 TAHERO 650 mg; 10ml, 650 mg; 10ml,Ống (Công ty CP dược phẩm Phương Đông,Việt Nam) Ống 10 8.218 82.180
Cộng tiền hàng hóa, dịch vụ: 763.250
Số tiền viết bằng chữ: Bảy trăm sáu mươi ba nghìn hai trăm năm mươi đồng.`);

  assert.equal(result.invoiceSerial, "2K26TDP");
  assert.equal(result.invoiceNumber, "43397");
  assert.equal(result.invoiceDate, "27/02/2026");
  assert.equal(result.total, "763250");
  assert.equal(result.items.length, 6);
  assert.deepEqual(result.items.map((item) => item.stt), ["1", "2", "3", "4", "5", "6"]);
  assert.deepEqual(result.items.map((item) => item.amount), ["124950", "186180", "161940", "153220", "54780", "82180"]);
  assert.equal(result.items[0].description, "Wizosone 90 liều xịt,Lọ (Việt Nam)");
});

test("uses the requested Vietnamese date, invoice number, item columns, and final total row", () => {
  const result = extractPaymentRequestInvoice(`Ngày 27 tháng 02 năm 2026
Số (No.): 43397
STT Tên hàng hóa, dịch vụ Đơn vị tính Số lượng Đơn giá Thành tiền
1 2 3 4 5 6=4x5
1 Thuốc A Viên 2 10.000 20.000
2 Thuốc B Hộp 1 30.000 30.000
Tổng cộng: 50.000`);
  assert.equal(result.invoiceDate, "27/02/2026");
  assert.equal(result.invoiceNumber, "43397");
  assert.deepEqual(result.items.map((item) => [item.stt, item.description, item.amount]), [
    ["1", "Thuốc A", "20000"],
    ["2", "Thuốc B", "30000"],
  ]);
  assert.equal(result.total, "50000");
});

test("uses Thành tiền rather than unit price or VAT columns", () => {
  const result = extractPaymentRequestInvoice(`Ngày 18 tháng 07 năm 2026
Số (No.):
00003420
STT Tên hàng hóa, dịch vụ Đơn vị Số lượng Đơn giá Thành tiền Thuế suất Tiền thuế Thành tiền sau thuế
1 2 3 4 5 6 7 8 9
1 Trám răng Răng 3,00 450.000 1.350.000 X X
Không chịu thuế GTGT (VAT exemption): 1.350.000 X 1.350.000
Tổng cộng (Total): 1.350.000 0 1.350.000`);
  assert.equal(result.invoiceNumber, "00003420");
  assert.equal(result.invoiceDate, "18/07/2026");
  assert.deepEqual(result.items, [{
    stt: "1",
    description: "Trám răng",
    amount: "1350000",
  }]);
  assert.equal(result.total, "1350000");
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
