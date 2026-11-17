const EXCLUDED_TAX_CODE = "0300608092";

export function extractInvoice(text) {
  const lines = text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const sellerStart = lines.findIndex((line) =>
    /(?:đơn vị\s*bán hàng|người bán|\bseller\b)/i.test(line),
  );
  if (sellerStart < 0) {
    throw new Error("Không xác định được khu vực đơn vị bán hàng.");
  }

  let buyerStart = lines.findIndex(
    (line, index) =>
      index > sellerStart &&
      /(?:đơn vị\s*mua hàng|người mua|\bbuyer\b)/i.test(line),
  );
  if (buyerStart < 0) buyerStart = lines.length;
  const sellerLines = lines.slice(sellerStart, buyerStart);
  const taxLabel = /(?:mã\s*số\s*thuế|\btax\s*code\b|\bmst\b)/i;
  const taxCodes = new Set();

  sellerLines.forEach((line, index) => {
    if (!taxLabel.test(line)) return;
    const region = sellerLines.slice(index, index + 3).join(" ");
    const candidates = region.matchAll(
      /(?:^|[^\d])((?:\d[\s.-]*){9}\d)(?!\d)/g,
    );
    for (const candidate of candidates) {
      const code = candidate[1].replace(/\D/g, "");
      if (code.length === 10 && code !== EXCLUDED_TAX_CODE) taxCodes.add(code);
    }
  });

  if (taxCodes.size === 0) {
    throw new Error(
      `Không tìm thấy mã số thuế người bán hợp lệ (đã loại trừ ${EXCLUDED_TAX_CODE}).`,
    );
  }
  if (taxCodes.size > 1) {
    throw new Error("Tìm thấy nhiều mã số thuế trong khu vực người bán.");
  }

  const serialMatch = text.match(
    /(?:ký\s*hiệu(?:\s*\(\s*serial(?:\s*no\.?)?\s*\))?|serial(?:\s*no\.?)?)\s*[:：]\s*([A-Z0-9][A-Z0-9./-]*)/i,
  );
  if (!serialMatch || serialMatch[1].length < 2) {
    throw new Error("Không tìm thấy ký hiệu hóa đơn hợp lệ.");
  }

  const invoiceMatch = text.match(
    /(?:\bSố\s*\(\s*Invoice\s*No\.?\s*\)|\bSố\s*hóa\s*đơn|\bInvoice\s*No\.?)\s*[:：]\s*([0-9][0-9.,]*)/i,
  );
  if (!invoiceMatch) throw new Error("Không tìm thấy số hóa đơn.");

  const totalMatch = text.match(
    /(?:Tổng\s*cộng\s*tiền\s*thanh\s*toán(?:\s*\(\s*Total\s*\))?|\(\s*Total\s*\))\s*[:：]\s*([0-9](?:[0-9.,]|\s(?=\d))*)/i,
  );
  if (!totalMatch) throw new Error("Không tìm thấy tổng cộng tiền thanh toán.");

  return {
    taxCode: [...taxCodes][0],
    serial: serialMatch[1].slice(1),
    invoiceNumber: invoiceMatch[1],
    total: normalizeTotal(totalMatch[1]),
  };
}

export function normalizeTotal(value) {
  const compact = value.replace(/\s/g, "");
  if (/^\d+$/.test(compact)) return compact;
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(compact)) {
    return compact.replace(/[.,]/g, "");
  }
  throw new Error(
    "Tổng tiền phải là số nguyên, có thể có dấu phân tách hàng nghìn.",
  );
}
