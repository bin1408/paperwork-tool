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

export function mergeOcrDescription(
  nativeDescription,
  ocrDescription,
  confidence = 100,
) {
  if (confidence < 80) return nativeDescription;
  const nativeWords = tokenizeDescription(nativeDescription);
  const ocrWords = tokenizeDescription(ocrDescription);
  if (!nativeWords.length || !ocrWords.length) return nativeDescription;

  const nativeText = nativeWords.map(normalizeWord).join(" ");
  const ocrText = ocrWords.map(normalizeWord).join(" ");
  if (
    Math.abs(nativeText.length - ocrText.length) /
      Math.max(nativeText.length, ocrText.length) >
      0.05 ||
    characterSimilarity(nativeText, ocrText) < 0.75 ||
    (!nativeText.startsWith(ocrText.slice(0, 24)) &&
      !ocrText.startsWith(nativeText.slice(0, 24)))
  ) {
    return nativeDescription;
  }

  const rows = Array.from({ length: nativeWords.length + 1 }, () =>
    Array(ocrWords.length + 1),
  );
  rows[0][0] = { cost: 0, previous: null, operation: null };
  for (let i = 1; i <= nativeWords.length; i += 1) {
    rows[i][0] = { cost: i, previous: [i - 1, 0], operation: "delete" };
  }
  for (let j = 1; j <= ocrWords.length; j += 1) {
    rows[0][j] = { cost: j, previous: [0, j - 1], operation: "insert" };
  }

  for (let i = 1; i <= nativeWords.length; i += 1) {
    for (let j = 1; j <= ocrWords.length; j += 1) {
      const sameWord =
        normalizeWord(nativeWords[i - 1]) === normalizeWord(ocrWords[j - 1]);
      const choices = [
        {
          cost: rows[i - 1][j - 1].cost + (sameWord ? 0 : 1.2),
          previous: [i - 1, j - 1],
          operation: sameWord ? "match" : "replace",
        },
        { cost: rows[i - 1][j].cost + 1, previous: [i - 1, j], operation: "delete" },
        { cost: rows[i][j - 1].cost + 1, previous: [i, j - 1], operation: "insert" },
      ];
      rows[i][j] = choices.reduce((best, choice) =>
        choice.cost < best.cost ? choice : best,
      );
    }
  }

  const merged = [];
  let i = nativeWords.length;
  let j = ocrWords.length;
  while (i > 0 || j > 0) {
    const cell = rows[i][j];
    if (cell.operation === "match") {
      merged.push(nativeWords[i - 1]);
    } else if (cell.operation === "replace" || cell.operation === "insert") {
      merged.push(ocrWords[j - 1]);
    }
    [i, j] = cell.previous;
  }
  return merged.reverse().join(" ");
}

function tokenizeDescription(text) {
  return text.match(/[\p{L}\p{N}]+(?:[./-][\p{L}\p{N}]+)*[.,;:]?/gu) ?? [];
}

function normalizeWord(word) {
  return word
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/[.,;:]+$/g, "");
}

function characterSimilarity(first, second) {
  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let i = 1; i <= first.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= second.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (first[i - 1] === second[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - previous[second.length] / Math.max(first.length, second.length);
}

const DATE_LABEL =
  /(?:ngày\s*(?:lập(?:\s*(?:hóa|hoá)\s*đơn)?|(?:hóa|hoá)\s*đơn)|invoice\s*date|date)\s*[:：]?\s*(\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4})/i;
const INVOICE_NUMBER_LABEL =
  /(?:số\s*(?:\(\s*invoice\s*no\.?\s*\)|(?:hóa|hoá)\s*đơn)|invoice\s*no\.?)\s*[:：]?\s*([A-Z0-9][A-Z0-9./-]*)/i;
const DESCRIPTION_LABEL =
  /(?:nội\s*dung(?:\s*(?:(?:hóa|hoá)\s*đơn|thanh\s*toán))?|tên\s*hàng\s*(?:hóa|hoá)\s*,?\s*dịch\s*vụ|description|goods\s*(?:and|&)\s*services)\s*[:：]?\s*(.*)/i;
const TOTAL_LABEL =
  /(?:tổng\s*cộng\s*tiền\s*thanh\s*toán|tổng\s*tiền\s*thanh\s*toán|tổng\s*thanh\s*toán|total\s*payment|amount\s*payable)(?:\s*\(\s*total\s*\))?\s*[:：]?\s*(.*)/i;

export function extractPaymentRequestInvoice(text) {
  const lines = text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    invoiceDate: extractInvoiceDate(text, lines),
    invoiceNumber: text.match(INVOICE_NUMBER_LABEL)?.[1] ?? "",
    description: extractDescription(lines),
    total: extractTotal(lines),
  };
}

export function extractOcrDescription(text) {
  const lines = text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const itemIndex = lines.findIndex((line) => /^\d+\s*[|.)-]\s+\S/.test(line));
  if (itemIndex < 0) return "";

  const description = [];
  for (const line of lines.slice(itemIndex)) {
    if (isTableHeader(line) || isTableColumnIndex(line)) continue;
    const startsItem = /^\d+\s*[|.)-]?\s+\S/.test(line);
    if (startsItem && description.length > 0) break;
    const cleaned = (startsItem ? line.replace(/^\d+\s*[|.)-]?\s+/, "") : line)
      .replace(/\s+\d{1,3}(?:[.,]\d{3})+$/, "")
      .replace(/^[|:;,.]+\s*/, "")
      .replace(/\s*[|=]+\s*$/, "")
      .trim();
    if (cleaned) description.push(cleaned);
  }
  return description.join(" ");
}

function extractInvoiceDate(text, lines) {
  const labeled = text.match(DATE_LABEL)?.[1];
  if (labeled) return normalizeDate(labeled);

  const labeledVietnameseDate = text.match(
    /ngày(?:\s*\([^)]*\))?\s+(\d{1,2})\s+tháng(?:\s*\([^)]*\))?\s+(\d{1,2})\s+năm(?:\s*\([^)]*\))?\s+(\d{4})/i,
  );
  if (labeledVietnameseDate) {
    return normalizeDate(
      `${labeledVietnameseDate[1]}/${labeledVietnameseDate[2]}/${labeledVietnameseDate[3]}`,
    );
  }

  const vietnameseDate = text.match(
    /ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/i,
  );
  if (vietnameseDate) {
    return normalizeDate(
      `${vietnameseDate[1]}/${vietnameseDate[2]}/${vietnameseDate[3]}`,
    );
  }

  const dateLine = lines.find((line) => /^ngày\s*[:：]?\s*\d/i.test(line));
  const generalDate = dateLine?.match(/(\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4})/);
  return generalDate ? normalizeDate(generalDate[1]) : "";
}

function normalizeDate(value) {
  const parts = value.split(/[./-]/).map((part) => Number(part.trim()));
  if (parts.length !== 3) return "";
  const [day, month, year] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "";
  }
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function extractDescription(lines) {
  const index = lines.findIndex((line) => DESCRIPTION_LABEL.test(line));
  if (index < 0) return "";
  const match = lines[index].match(DESCRIPTION_LABEL);
  const inlineDescription = match?.[1]?.trim();
  if (inlineDescription && !isTableHeader(inlineDescription)) {
    return inlineDescription;
  }

  const description = [];
  for (const line of lines.slice(index + 1)) {
    if (isTableHeader(line) || isTableColumnIndex(line)) continue;
    if (
      /^(?:cộng tiền hàng|tổng cộng tiền thanh toán|thuế suất|tiền thuế|đơn vị cung cấp giải pháp|số tiền viết bằng chữ|amount\s*\(in words\))/i.test(
        line,
      )
    ) {
      break;
    }

    const startsItem = /^\d+\s*[|.)-]?\s+\S/.test(line);
    if (startsItem && description.length > 0) break;
    const cleaned = (startsItem ? line.replace(/^\d+\s*[|.)-]?\s+/, "") : line)
      .replace(/\s+\d{1,3}(?:[.,]\d{3})+$/, "")
      .replace(/^[|:;,.]+\s*/, "")
      .replace(/\s*[|=]+\s*$/, "")
      .trim();
    if (cleaned) description.push(cleaned);
  }
  return description.join(" ");
}

function isTableHeader(line) {
  return /(?:\bđvt\b|\bsố lượng\b|\bđơn giá\b|\bthành tiền\b|\buom\b|\bquantity\b|\bprice\b|\bamount\b)/i.test(
    line,
  );
}

function isTableColumnIndex(line) {
  return /^(?:\d+\s+){2,}\d+(?:\s*=\s*[\dx]+)?$/i.test(line);
}

function extractTotal(lines) {
  const index = lines.findIndex((line) => TOTAL_LABEL.test(line));
  if (index < 0) return "";

  const match = lines[index].match(TOTAL_LABEL);
  const inlineAmount = match?.[1]?.trim();
  const amountText = inlineAmount || lines[index + 1] || "";
  const amount = amountText.match(/\d[\d\s.,]*/)?.[0];
  if (!amount) return "";

  try {
    return normalizeTotal(amount);
  } catch {
    return "";
  }
}

const ONES = [
  "không",
  "một",
  "hai",
  "ba",
  "bốn",
  "năm",
  "sáu",
  "bảy",
  "tám",
  "chín",
];
const SCALES = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ", "tỷ tỷ"];

function readGroup(value, forceHundreds = false) {
  const hundreds = Math.floor(value / 100);
  const tens = Math.floor((value % 100) / 10);
  const units = value % 10;
  const words = [];

  if (hundreds > 0) words.push(ONES[hundreds], "trăm");
  else if (forceHundreds) words.push("không", "trăm");

  if (tens > 1) {
    words.push(`${ONES[tens]} mươi`);
    if (units === 1) words.push("mốt");
    else if (units === 4) words.push("tư");
    else if (units === 5) words.push("lăm");
    else if (units > 0) words.push(ONES[units]);
  } else if (tens === 1) {
    words.push("mười");
    if (units === 5) words.push("lăm");
    else if (units > 0) words.push(ONES[units]);
  } else if (units > 0) {
    if (hundreds > 0 || forceHundreds) words.push("lẻ");
    words.push(ONES[units]);
  }
  return words.join(" ");
}

export function amountInVietnameseWords(value) {
  const digits = String(value);
  if (!/^\d+$/.test(digits) || digits.length > SCALES.length * 3) {
    throw new Error("Số tiền không hợp lệ hoặc vượt quá giới hạn đọc bằng chữ.");
  }

  const groups = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.push(Number(digits.slice(Math.max(0, end - 3), end)));
  }
  while (groups.length > 1 && groups.at(-1) === 0) groups.pop();

  if (groups.length === 1 && groups[0] === 0) return "Không đồng";

  const words = [];
  let hasHigherGroup = false;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group === 0) continue;

    const forceHundreds = hasHigherGroup && group < 100;
    words.push(readGroup(group, forceHundreds));
    if (SCALES[index]) words.push(SCALES[index]);
    hasHigherGroup = true;
  }
  const phrase = words.join(" ");
  return `${phrase.charAt(0).toLocaleUpperCase("vi-VN")}${phrase.slice(1)} đồng`;
}
