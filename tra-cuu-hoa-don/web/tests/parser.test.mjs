import assert from "node:assert/strict";
import test from "node:test";
import { extractInvoice, normalizeTotal } from "../invoice-parser.mjs";

const invoice = `ĐƠN VỊ BÁN HÀNG: CÔNG TY MẪU
Mã số thuế: 0302287334
Ký hiệu (Serial): 1C26TAG
Số (Invoice No.): 00000364
Tổng cộng tiền thanh toán (Total): 513.186.123
ĐƠN VỊ MUA HÀNG: CÔNG TY KHÁCH
Mã số thuế: 0300608092`;

test("extracts seller details and ignores buyer tax code", () => {
  assert.deepEqual(extractInvoice(invoice), {
    taxCode: "0302287334",
    serial: "C26TAG",
    invoiceNumber: "00000364",
    total: "513186123",
  });
});

test("accepts serial labels with or without the No abbreviation", () => {
  assert.equal(extractInvoice(invoice.replace("(Serial)", "(Serial No.)")).serial, "C26TAG");
});

test("rejects invoices where the only seller tax code is excluded", () => {
  const text = invoice
    .replace("0302287334", "0300608092")
    .replace("0300608092", "0300608092");
  assert.throws(() => extractInvoice(text), /đã loại trừ 0300608092/);
});

test("normalizes grouped totals and rejects decimal formats", () => {
  assert.equal(normalizeTotal("1.234.567"), "1234567");
  assert.equal(normalizeTotal("513 186 123"), "513186123");
  assert.throws(() => normalizeTotal("1.234,56"), /số nguyên/);
});
